// server/services/promoSnapshot/promoSnapshotProcessor.js
// Promo Snapshot — processor de UM run (chamado pelo worker depois do claim).
//
//   run (conta + seller explícitos, nunca auto-resolvidos)
//     → valida conta (do cliente, MELI, ativa, seller igual ao do run) e grant
//       utilizável DESTA conta
//     → lista o catálogo ativo por scan (token da conta, retry por página,
//       guardas contra truncamento/cursor repetido/sem progresso)
//     → retomada: reaproveita os lotes concluídos de um run interrompido
//     → lotes sequenciais: GET /seller-promotions/items/{MLB} por item
//       (concorrência limitada, retry por requisição, 429/Retry-After pausa o
//       processo inteiro), sale_price só para itens com promoção iniciada,
//       vigência por campanha com cache no run
//     → grava lote (linhas + progresso + heartbeat) só se o run ainda estiver
//       `running` (fencing)
//   → devolve o resultado; quem decide completed/partial e promove o snapshot
//     é o run service (markRunCompleted).
//
// SOMENTE LEITURA: todo acesso ao ML passa por promoSnapshotMlLeitor (GET,
// lista fechada de caminhos). Nenhuma escrita comercial é possível daqui.

const pool = require("../../config/database");
const repoPadrao = require("./promoSnapshotRepository");
const { resolvePromoSnapshotConfig, validarInvariantesHeartbeat } = require("./promoSnapshotConfig");
const { criarLeitorMl, PromoSnapshotLeituraError } = require("./promoSnapshotMlLeitor");
const normalize = require("./promoSnapshotNormalize");
const { executarComRetry, esperar, MarginSnapshotStopError } = require("../motorMargem/marginSnapshotRetry");
const { createRateLimiter } = require("../motorMargem/marginSnapshotRateLimiter");
const { redigirSegredos } = require("../motorMargem/marginSnapshotSanitize");
const { logEvento } = require("../motorMargem/marginSnapshotLog");
const { pLimit, chunk } = require("../automacoes/promocoesRetornoService");

const SCAN_LIMIT = 100;

// O run deixou de ser `running` (reconciliado por outra instância, conta
// reconectada a outro seller…). Estende o erro de parada para atravessar o
// executarComRetry sem virar "falha recuperável" — nada mais é lido nem
// gravado por este processo.
class PromoSnapshotFencingError extends MarginSnapshotStopError {
  constructor() {
    super("O run deixou de estar em execução (provável reconciliação por heartbeat); processamento interrompido.");
    this.name = "PromoSnapshotFencingError";
    this.code = "PROMO_SNAPSHOT_RUN_NAO_ESTA_MAIS_RUNNING";
  }
}

function erroTipado(code, message, extra = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, extra);
  return err;
}

function mensagemCurta(err) {
  return redigirSegredos(err?.message || "Erro desconhecido.", 500);
}

// Um limiter por processo para o Promo Snapshot (espaçamento entre
// requisições + pausa global depois de 429).
let limiterDoProcesso = null;
function obterLimiterDoProcesso(config) {
  if (!limiterDoProcesso) limiterDoProcesso = createRateLimiter({ minIntervalMs: config.requestIntervalMs });
  return limiterDoProcesso;
}

// Conta do run: pertence ao cliente, é MELI, está ativa e o seller vinculado
// é o MESMO do run (conta reconectada a outro ML nunca herda o run). Grant
// utilizável resolvido pelo seller da conta — nunca o principal do cliente.
async function validarContaPadrao(run, { db }) {
  const { obterConta } = require("../clienteContas/clienteContaService");
  const { createMlTokenService } = require("../mlTokenService");
  let conta;
  try {
    conta = await obterConta(run.clienteContaId, db);
  } catch (err) {
    throw erroTipado("PROMO_SNAPSHOT_CONTA_NAO_ENCONTRADA", "Conta do run não encontrada.");
  }
  if (Number(conta.cliente_id) !== Number(run.clienteId)) {
    throw erroTipado("PROMO_SNAPSHOT_CONTA_DE_OUTRO_CLIENTE", "A conta do run não pertence ao cliente do run.");
  }
  if (String(conta.marketplace || "").toLowerCase() !== "meli") {
    throw erroTipado("PROMO_SNAPSHOT_MARKETPLACE_INCOMPATIVEL", "A conta do run não é Mercado Livre.");
  }
  if (conta.ativo === false) throw erroTipado("PROMO_SNAPSHOT_CONTA_INATIVA", "A conta foi desativada.");
  if (!conta.external_account_id || String(conta.external_account_id) !== run.sellerId) {
    throw erroTipado("PROMO_SNAPSHOT_SELLER_DIVERGENTE", "O seller vinculado à conta mudou desde que o run foi criado.");
  }
  try {
    await createMlTokenService({ db }).resolveMlGrant({ clienteId: run.clienteId, mlUserId: run.sellerId, requireUsable: true });
  } catch (err) {
    throw erroTipado(err?.code || "PROMO_SNAPSHOT_GRANT_INDISPONIVEL", mensagemCurta(err));
  }
  return { conta };
}

async function processPromoSnapshotRun(run, deps = {}) {
  if (!run || !run.id) throw new Error("processPromoSnapshotRun: run é obrigatório.");
  if (!run.clienteContaId || !run.sellerId) {
    throw new Error("processPromoSnapshotRun: run.clienteContaId e run.sellerId são obrigatórios (nunca auto-resolver).");
  }
  if (String(run.marketplace || "").toLowerCase() !== "meli") {
    throw erroTipado("PROMO_SNAPSHOT_MARKETPLACE_NAO_SUPORTADO", `Marketplace "${run.marketplace}" não suportado.`);
  }

  const db = deps.db || pool;
  const logger = deps.logger || console;
  const signal = deps.signal || null;
  const config = deps.config || resolvePromoSnapshotConfig(deps.env);
  // Uma request em voo não renova heartbeat: timeout + heartbeat precisam
  // caber folgados na janela de stale. Config montada à mão que viole isso
  // falha o run AQUI, antes de qualquer chamada ao ML (a do env já vem
  // limitada por resolvePromoSnapshotConfig).
  validarInvariantesHeartbeat(config);
  const sleep = deps.sleep || esperar;
  const clock = deps.clock || (() => Date.now());
  const repo = deps.repo || repoPadrao;
  const limiter = deps.rateLimiter || obterLimiterDoProcesso(config);
  const validarConta = deps.validarConta || validarContaPadrao;
  const agoraIso = deps.agoraIso || (() => new Date().toISOString());

  const inicio = clock();
  const stats = {
    retries: 0, rateLimits: 0, lotes: 0, lotesFalhos: 0, itensReaproveitados: 0, vigenciasConsultadas: 0,
    salePriceConsultados: 0, heartbeats: 0, paginasCatalogo: 0,
  };

  function evento(nivel, nome, campos = {}) {
    logEvento(logger, nivel, nome, {
      run_id: run.id, cliente_id: run.clienteId, cliente_conta_id: run.clienteContaId, seller_id: run.sellerId, ...campos,
    });
  }
  function verificarParada() {
    if (signal?.aborted) throw new MarginSnapshotStopError();
  }
  function fencing() {
    return new PromoSnapshotFencingError();
  }

  // ── Heartbeat cooperativo ───────────────────────────────────────────────
  // Renovado antes de cada chamada ao ML e entre fatias de toda espera
  // (backoff, Retry-After, cooldown do rate limiter), com intervalo de no
  // máximo 1/4 da janela de stale; uma request individual dura no máximo
  // requestTimeoutMs, também ≤ 1/4 da janela. Uma leitura legítima que
  // demora (retry + backoff ou uma request lenta) nunca faz outra instância
  // reconciliar o run como morto. Não há timer solto: se o processo travar
  // de verdade, o heartbeat para — e o run é recuperado como deve.
  const intervaloBatimento = Math.max(1, Number(config.heartbeatIntervalMs)); // já ≤ stale/4 (validado acima)
  let ultimoBatimento = clock();
  let batimentoEmVoo = null;
  let runPerdido = false;
  async function bater(forcar = false) {
    if (runPerdido) throw fencing();
    if (!forcar && clock() - ultimoBatimento < intervaloBatimento) return;
    if (!batimentoEmVoo) {
      batimentoEmVoo = (async () => {
        try {
          const ok = await repo.touchHeartbeat(run.id, db);
          if (!ok) runPerdido = true;
          else { ultimoBatimento = clock(); stats.heartbeats += 1; }
        } finally {
          batimentoEmVoo = null;
        }
      })();
    }
    await batimentoEmVoo;
    if (runPerdido) throw fencing();
  }
  async function dormirComBatimento(ms, sig) {
    let restante = Number(ms) || 0;
    while (restante > 0) {
      const fatia = Math.min(restante, intervaloBatimento);
      // eslint-disable-next-line no-await-in-loop
      await sleep(fatia, sig);
      restante -= fatia;
      if (sig?.aborted) return;
      // eslint-disable-next-line no-await-in-loop
      await bater();
    }
  }

  // Contadores do lote corrente (zerados a cada lote gravado).
  let contadoresLote = { retries: 0, rateLimits: 0 };
  function aoRetentar(etapa, extra = {}) {
    return ({ tentativa, delayMs, classificacao }) => {
      stats.retries += 1;
      contadoresLote.retries += 1;
      if (classificacao.rateLimited) {
        stats.rateLimits += 1;
        contadoresLote.rateLimits += 1;
        // 429 é por aplicação: todas as leituras do processo esperam.
        limiter.penalizar(delayMs);
        evento("warn", "promo_snapshot_rate_limited", {
          etapa, ...extra, tentativa: tentativa + 1, delay_ms: delayMs, status: classificacao.status ?? null,
        });
      }
    };
  }

  // ── 1. Conta + grant ────────────────────────────────────────────────────
  await validarConta(run, { db, deps });
  verificarParada();

  const leitor = deps.leitor || criarLeitorMl({
    clienteId: run.clienteId, sellerId: run.sellerId, timeoutMs: config.requestTimeoutMs, mlFetch: deps.mlFetch,
  });

  async function comVez(fn) {
    // Cooldown longo do limiter (pausa global pós-429): esperado em fatias,
    // com heartbeat; o resíduo fica com o próprio limiter.
    const cooldown = typeof limiter.estado === "function" ? Number(limiter.estado().cooldownRestanteMs) || 0 : 0;
    if (cooldown > intervaloBatimento) await dormirComBatimento(cooldown, signal);
    // A fila do limiter é compartilhada por todos os runs deste processo. Com
    // várias reservas, a espera pode ser muito maior que requestIntervalMs;
    // use o sleep deste run para renovar o heartbeat durante toda ela.
    await limiter.aguardarVez(signal, dormirComBatimento);
    verificarParada();
    await bater();
    return fn();
  }
  function comRetry(fn, etapa, extra) {
    return executarComRetry(() => comVez(fn), { config, sleep: dormirComBatimento, signal, onRetry: aoRetentar(etapa, extra) });
  }

  // ── 2. Catálogo ativo (scan) ────────────────────────────────────────────
  // Nunca truncamento silencioso nem loop infinito. Qualquer anomalia do
  // cursor falha o run ANTES de ler promoções (o snapshot bom anterior fica
  // intacto — falha não mexe no ponteiro), com motivo seguro (sem scroll_id
  // nem token na mensagem):
  //   - página não vazia sem scroll_id e SEM paging.total nela (malformada:
  //     não prova que o catálogo acabou);
  //   - página não vazia sem scroll_id com paging.total > anúncios lidos;
  //   - scroll_id repetido (mesma regra de services/full/fullPagination);
  //   - página repetida / cursor sem progresso (página só com ids já vistos);
  //   - teto de páginas (maxCatalogItems / 100 + folga);
  //   - fim do scan com menos anúncios que o último paging.total.
  const ids = [];
  const vistos = new Set();
  const scrollsUsados = new Set();
  let scrollId = null;
  let pagina = 0;
  let totalAnunciado = null;
  let assinaturaAnterior = null;
  const maxPaginas = Math.ceil(config.maxCatalogItems / SCAN_LIMIT) + 5;
  const falhaCatalogo = (motivo, detalhe) => erroTipado(
    "PROMO_SNAPSHOT_CATALOGO_INCONSISTENTE",
    `Paginação do catálogo inconsistente (${motivo}) na página ${pagina}: ${detalhe}. Nada foi publicado; o último snapshot bom foi preservado.`,
    { motivo }
  );
  for (;;) {
    verificarParada();
    const params = new URLSearchParams({ search_type: "scan", limit: String(SCAN_LIMIT), status: "active" });
    if (scrollId) params.set("scroll_id", scrollId);
    const caminho = `/users/${encodeURIComponent(run.sellerId)}/items/search?${params.toString()}`;
    // Página ok mas sem `results` é resposta parcial/malformada: retenta e,
    // se persistir, o run falha — nunca vira "fim do catálogo" (isso
    // apagaria promoções dos itens não listados).
    const tentativa = await comRetry(async () => {
      const resp = await leitor.getOuErro(caminho);
      if (!resp.data || !Array.isArray(resp.data.results)) {
        throw new PromoSnapshotLeituraError("Página do catálogo sem `results` (resposta parcial).", {
          code: "PROMO_SNAPSHOT_RESPOSTA_PARCIAL", statusCode: 502,
        });
      }
      return resp;
    }, "catalogo", { pagina });
    if (!tentativa.ok) {
      throw erroTipado(
        "PROMO_SNAPSHOT_CATALOGO_FALHOU",
        `Falha ao listar o catálogo (página ${pagina + 1}, ${tentativa.attempts} tentativa(s)): ${mensagemCurta(tentativa.error)}`
      );
    }
    const data = tentativa.value.data;
    const resultados = data.results;
    const pagingTotal = data.paging && Number.isFinite(Number(data.paging.total)) && data.paging.total !== null
      ? Number(data.paging.total) : null;
    if (pagingTotal !== null) totalAnunciado = pagingTotal;
    let novos = 0;
    const idsPagina = [];
    for (const id of resultados) {
      const s = String(id || "").trim();
      if (!s) continue;
      idsPagina.push(s);
      if (!vistos.has(s)) { vistos.add(s); ids.push(s); novos += 1; }
    }
    pagina += 1;
    stats.paginasCatalogo = pagina;
    if (ids.length > config.maxCatalogItems) {
      throw erroTipado(
        "PROMO_SNAPSHOT_CATALOGO_EXCEDE_LIMITE",
        `O catálogo passou de ${config.maxCatalogItems} anúncios ativos (PROMO_SNAPSHOT_MAX_CATALOG_ITEMS); nada foi truncado.`
      );
    }
    await bater(true);
    evento("log", "promo_snapshot_page_processed", { etapa: "catalogo", pagina, processed_count: ids.length, total_ml: totalAnunciado });
    if (!resultados.length) break; // fim natural do scan
    const assinatura = idsPagina.join(",");
    if (novos === 0) {
      throw assinatura === assinaturaAnterior
        ? falhaCatalogo("PAGINA_REPETIDA", `a página ${pagina} repetiu exatamente a anterior`)
        : falhaCatalogo("CURSOR_SEM_PROGRESSO", `a página ${pagina} só trouxe anúncios já lidos`);
    }
    assinaturaAnterior = assinatura;
    const proximo = String(data.scroll_id || "").trim();
    if (!proximo) {
      // Página NÃO vazia sem cursor só encerra o scan se ELA MESMA trouxer
      // paging.total e ele confirmar que tudo foi lido. Sem paging nesta
      // página não há como distinguir "fim" de "resposta truncada" — nunca
      // é conclusão segura (o fim normal do scan é a página vazia).
      if (pagingTotal === null) {
        throw falhaCatalogo(
          "SEM_METADADOS_CONTINUIDADE",
          `a página ${pagina} trouxe ${idsPagina.length} anúncio(s) sem scroll_id e sem paging.total (${ids.length} lidos até aqui)`
        );
      }
      if (ids.length < pagingTotal) {
        throw falhaCatalogo("SCROLL_AUSENTE", `o ML não mandou cursor com ${ids.length} de ${pagingTotal} anúncio(s) lidos`);
      }
      break;
    }
    if (proximo === scrollId || scrollsUsados.has(proximo)) {
      throw falhaCatalogo("SCROLL_REPETIDO", "o cursor devolvido já tinha sido usado");
    }
    if (pagina >= maxPaginas) {
      throw falhaCatalogo("PAGINAS_EXCEDIDAS", `mais de ${maxPaginas} páginas para um teto de ${config.maxCatalogItems} anúncios`);
    }
    scrollsUsados.add(proximo);
    scrollId = proximo;
  }
  if (totalAnunciado !== null && ids.length < totalAnunciado) {
    throw falhaCatalogo("TOTAL_INCOMPATIVEL", `${ids.length} anúncio(s) lidos para paging.total ${totalAnunciado}`);
  }
  const total = ids.length;
  if (!(await repo.registrarTotal({ runId: run.id, itensTotal: total }, db))) throw fencing();

  // ── 3. Retomada ─────────────────────────────────────────────────────────
  let feitos = new Set();
  let snapshotAt = null;
  if (run.resumedFromRunId) {
    const copia = await repo.copiarLotesRetomados({ run, fromRunId: run.resumedFromRunId, catalogItemIds: ids }, db);
    if (copia === null) throw fencing();
    if (copia.itens.length) {
      feitos = new Set(copia.itens);
      stats.itensReaproveitados = copia.itens.length;
      // O snapshot é tão velho quanto a leitura mais antiga que o compõe.
      snapshotAt = copia.startedAt ? new Date(copia.startedAt).toISOString() : null;
      evento("log", "promo_snapshot_run_resumed", {
        retomado_de: run.resumedFromRunId, processed_count: copia.itens.length, promocoes: copia.promocoes,
      });
    }
  }

  // ── 4. Lotes ────────────────────────────────────────────────────────────
  const pendentes = ids.filter((id) => !feitos.has(id));
  const lotes = chunk(pendentes, config.batchSize);
  const limitar = pLimit(config.itemConcurrency);
  const vigencias = new Map(); // "id::tipo" → Promise<{inicio,fim}|null> (cache do run)
  const passoLog = Math.max(1, Math.ceil(lotes.length / 20));
  let processados = feitos.size;
  let falhas = 0;
  let falhasConsecutivas = 0;

  async function lerPromocoes(itemId) {
    const caminho = `/seller-promotions/items/${encodeURIComponent(itemId)}?app_version=v2`;
    // 404 = item sem promoções (não é falha de leitura).
    const t = await comRetry(async () => {
      const resp = await leitor.getOuErro(caminho, { vazioEm: [404] });
      if (resp.vazio) return [];
      const lista = normalize.extrairLista(resp.data);
      if (lista === null) {
        throw new PromoSnapshotLeituraError("Promoções do item fora do formato documentado.", {
          code: "PROMO_SNAPSHOT_RESPOSTA_PARCIAL", statusCode: 502,
        });
      }
      return lista;
    }, "promocoes_item", { item_id: itemId });
    if (!t.ok) return { ok: false, erro: t.error };
    return { ok: true, lista: t.value };
  }

  async function lerSalePrice(itemId) {
    stats.salePriceConsultados += 1;
    const caminho = `/items/${encodeURIComponent(itemId)}/sale_price?context=channel_marketplace`;
    const t = await comRetry(() => leitor.getOuErro(caminho), "sale_price", { item_id: itemId });
    if (!t.ok) return null; // ativa/nao_aplicada ficam null — nunca chute
    const d = t.value.data || {};
    const promotionId = d.metadata && d.metadata.promotion_id != null ? String(d.metadata.promotion_id) : null;
    const amount = Number.isFinite(Number(d.amount)) ? Number(d.amount) : null;
    return { promotionId, amount };
  }

  function vigencia(chave, { promotionId, tipo }) {
    if (!vigencias.has(chave)) {
      stats.vigenciasConsultadas += 1;
      const caminho = `/seller-promotions/promotions/${encodeURIComponent(promotionId)}?promotion_type=${encodeURIComponent(tipo)}&app_version=v2`;
      vigencias.set(chave, comRetry(() => leitor.getOuErro(caminho), "vigencia", { promotion_id: promotionId }).then((t) => {
        if (!t.ok) return null;
        const d = t.value.data || {};
        return d.start_date || d.finish_date ? { inicio: d.start_date || null, fim: d.finish_date || null } : null;
      }));
    }
    return vigencias.get(chave);
  }

  for (let i = 0; i < lotes.length; i += 1) {
    verificarParada();
    const lote = lotes[i];
    const seq = i + 1;
    const observedAt = agoraIso();

    const leituras = await Promise.all(lote.map((itemId) => limitar(async () => {
      const r = await lerPromocoes(itemId);
      if (!r.ok) return { itemId, ok: false, erro: r.erro };
      let saleInfo = null;
      if (config.resolveActive && normalize.temPromocaoIniciada(r.lista)) saleInfo = await lerSalePrice(itemId);
      const mapaVig = new Map();
      if (config.resolveVigencia) {
        for (const [chave, alvo] of normalize.chavesSemVigencia(r.lista)) {
          // eslint-disable-next-line no-await-in-loop
          const v = await vigencia(chave, alvo);
          if (v) mapaVig.set(chave, v);
        }
      }
      return { itemId, ok: true, lista: r.lista, saleInfo, vigencias: mapaVig };
    })));

    const linhas = [];
    const itensFalhos = [];
    for (const l of leituras) {
      if (!l.ok) { itensFalhos.push(l.itemId); continue; }
      linhas.push(...normalize.normalizarPromocoesDoItem({
        itemId: l.itemId, lista: l.lista, saleInfo: l.saleInfo, vigencias: l.vigencias, observedAt,
      }));
    }

    const atualizado = await repo.registrarLote({ run, seq, itemIds: lote, itensFalhos, linhas, contadores: contadoresLote }, db);
    if (!atualizado) throw fencing();
    ultimoBatimento = clock(); // o lote gravado também renova o heartbeat
    contadoresLote = { retries: 0, rateLimits: 0 };
    stats.lotes += 1;
    processados += lote.length;
    falhas += itensFalhos.length;

    if (itensFalhos.length === lote.length) {
      falhasConsecutivas += 1;
      stats.lotesFalhos += 1;
      const ultimoErro = leituras.find((l) => !l.ok)?.erro;
      evento("error", "promo_snapshot_batch_failed", {
        seq, itens: lote.length, falhas_consecutivas: falhasConsecutivas, erro: mensagemCurta(ultimoErro),
      });
      if (falhasConsecutivas >= config.maxConsecutiveBatchFailures) {
        throw erroTipado(
          "PROMO_SNAPSHOT_LOTES_FALHANDO",
          `${falhasConsecutivas} lote(s) seguidos sem nenhuma leitura; run interrompido. Último erro: ${mensagemCurta(ultimoErro)}`
        );
      }
    } else {
      falhasConsecutivas = 0;
    }

    if (seq % passoLog === 0 || seq === lotes.length) {
      evento("log", "promo_snapshot_page_processed", {
        etapa: "promocoes", lote: seq, lotes: lotes.length, processed_count: processados, total, falhas,
      });
    }
  }

  if (total > 0 && falhas === pendentes.length && pendentes.length > 0 && feitos.size === 0) {
    throw erroTipado("PROMO_SNAPSHOT_NENHUM_ITEM_LIDO", `Nenhum dos ${total} anúncio(s) teve as promoções lidas neste run.`);
  }

  const resultado = {
    total,
    processados,
    falhas,
    snapshotAt,
    stats: { ...stats, duracaoMs: clock() - inicio },
  };
  await repo.mergeRunMetadata({ runId: run.id, patch: { processor: resultado.stats } }, db);
  return resultado;
}

module.exports = { processPromoSnapshotRun, validarContaPadrao, PromoSnapshotFencingError, SCAN_LIMIT };
