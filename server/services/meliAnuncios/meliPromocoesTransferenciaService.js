// server/services/meliAnuncios/meliPromocoesTransferenciaService.js
// -----------------------------------------------------------------------------
// Módulo: Anúncios Meli — "Transferir promoção".
//
// Move anúncios de uma promoção (origem) para outra (destino) — o caso típico é
// a virada de mês: passar tudo da "Vendex Outubro" para a "Vendex Novembro".
// Disparado só por clique; sem cron, sem job em banco. O front lista os
// anúncios da origem e manda lotes pequenos para `transferir`, que é síncrono.
//
// Por anúncio (sempre relendo o estado AO VIVO, nunca o que o front guardou):
//   1. precisa participar da origem (started/active/pending);
//   2. ENTRA no destino primeiro — se o ML recusar, nada mudou:
//        DEAL/SELLER_CAMPAIGN → aplicarPromocao, com o MESMO preço que o
//                               anúncio tem na origem (o vendedor escolhe);
//        tipos de ACEITE      → participarPromocaoAceite (o ML define o preço);
//   3. só então SAI da origem (se `removerOrigem`). Entrou e não saiu =
//      status "parcial": o anúncio ficou nas duas, e o motivo diz por quê.
// Já estar no destino não é erro: só falta sair da origem.
// -----------------------------------------------------------------------------

const { TIPOS_ESCRITA_PRECO, TIPOS_ESCRITA_ACEITE } = require("./promocaoTiposSuportados");

const MAX_ITENS_POR_LOTE = 15;
// Cada anúncio faz ~10 chamadas ao ML (releituras + escritas): o ML devolve 429
// com facilidade. Falha transitória é refeita com espera antes de virar erro.
const MAX_TENTATIVAS = 4;
const PAUSA_ENTRE_ITENS_MS = 300;
const STATUS_PARTICIPA = new Set(["started", "active", "pending"]);

function falha(codigo, motivo, extra = {}) {
  return { ok: false, codigo, motivo, ...extra };
}

function defaults(deps = {}) {
  return {
    mlFetch: deps.mlFetch || ((...a) => require("../../utils/mlClient").mlFetch(...a)),
    sleep: deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))),
    logger: deps.logger || console,
    listarPromocoesDoItemDetalhado: deps.listarPromocoesDoItemDetalhado || ((...a) => require("./meliPromocoesService").listarPromocoesDoItemDetalhado(...a)),
    aplicarPromocao: deps.aplicarPromocao || ((...a) => require("./meliPromocoesEscritaService").aplicarPromocao(...a)),
    participarPromocaoAceite: deps.participarPromocaoAceite || ((...a) => require("./meliPromocoesEscritaService").participarPromocaoAceite(...a)),
    sairPromocao: deps.sairPromocao || ((...a) => require("./meliPromocoesEscritaService").sairPromocao(...a)),
    registrarLog: deps.registrarLog || ((...a) => require("../activityLogService").registrarLog(...a)),
    carregarAnuncios: deps.carregarAnuncios || (async (clienteId, itemIds) => {
      if (!itemIds.length) return new Map();
      const pool = require("../../config/database");
      const { rows } = await pool.query(
        `SELECT item_id, titulo, thumbnail FROM meli_anuncios WHERE cliente_id = $1 AND item_id = ANY($2::text[])`,
        [clienteId, itemIds]
      );
      return new Map(rows.map((r) => [String(r.item_id), r]));
    }),
  };
}

function lerPromocaoRef(bruto) {
  const b = bruto && typeof bruto === "object" ? bruto : {};
  const id = b.id != null ? String(b.id).trim() : "";
  const tipo = b.tipo != null ? String(b.tipo).trim().toUpperCase() : "";
  return id && tipo ? { id, tipo } : null;
}

function validarPar(body) {
  const origem = lerPromocaoRef(body && body.origem);
  const destino = lerPromocaoRef(body && body.destino);
  if (!origem) return falha("ORIGEM_INVALIDA", "Informe a promoção de origem (origem.id e origem.tipo).", { httpStatus: 400 });
  if (!destino) return falha("DESTINO_INVALIDO", "Informe a promoção de destino (destino.id e destino.tipo).", { httpStatus: 400 });
  if (origem.id === destino.id && origem.tipo === destino.tipo) {
    return falha("ORIGEM_IGUAL_DESTINO", "A origem e o destino são a mesma promoção.", { httpStatus: 400 });
  }
  return { ok: true, origem, destino };
}

// ─── GET /promocoes-transferir/itens ─────────────────────────────────────────

/** Anúncios que participam da promoção de origem (started/active/pending). */
async function listarItens({ clienteId, mlUserId, origem }, deps = {}) {
  const d = defaults(deps);
  const ref = lerPromocaoRef(origem);
  if (!ref) return { ...falha("ORIGEM_INVALIDA", "Informe a promoção de origem (id e tipo)."), httpStatus: 400 };

  const porItem = new Map();
  for (const status of ["started", "pending"]) {
    const caminho =
      `/seller-promotions/promotions/${encodeURIComponent(ref.id)}/items` +
      `?promotion_type=${encodeURIComponent(ref.tipo)}&status=${status}&app_version=v2`;
    // Lido na hora: o serviço do Radar puxa o pool do banco.
    const lido = await (deps.paginarSellerPromotions || require("./meliPromocoesRebateService").paginarSellerPromotions)(d,{ clienteId, mlUserId, caminho });
    // "pending" é complemento: só "started" falhando derruba a leitura.
    if (!lido.ok) {
      if (status === "started") return falha("ERRO_ML", `Não foi possível ler os anúncios da promoção no Mercado Livre${lido.status ? ` (HTTP ${lido.status})` : ""}.`);
      continue;
    }
    for (const it of lido.resultados) {
      const id = it.id != null ? String(it.id).toUpperCase() : null;
      const st = String(it.status || status).toLowerCase();
      if (!id || !STATUS_PARTICIPA.has(st) || porItem.has(id)) continue;
      const preco = Number(it.price);
      porItem.set(id, { itemId: id, status: st, preco: Number.isFinite(preco) && preco > 0 ? preco : null });
    }
  }

  const ids = Array.from(porItem.keys());
  const anuncios = await d.carregarAnuncios(clienteId, ids);
  const itens = ids.map((id) => {
    const a = anuncios.get(id) || {};
    return { ...porItem.get(id), titulo: a.titulo || null, thumbnail: a.thumbnail || null };
  });
  return { ok: true, total: itens.length, itens };
}

// ─── Um anúncio ──────────────────────────────────────────────────────────────

function esperaMs(r, tentativa) {
  const ra = Number(r && r.retryAfter);
  if (Number.isFinite(ra) && ra >= 0) return Math.min(ra * 1000, 15000);
  return Math.min(1500 * 2 ** (tentativa - 1), 10000);
}

// Falha que costuma passar sozinha: limite de requisições, erro 5xx do ML, ou
// a releitura que o serviço de escrita faz por dentro e que, num 429, vem como
// "promoção não encontrada". Nunca refaz escrita que pode ter chegado ao ML
// (timeout com envio = `incerto`/`enviado`).
function ehTransitoria(r) {
  if (!r || r.ok || r.incerto || r.enviado === true) return false;
  return /^ML_HTTP_(429|5\d\d)$/.test(String(r.codigo || "")) ||
    ["PROMOCAO_NAO_ENCONTRADA", "ML_TIMEOUT_LEITURA", "ML_DEADLINE_EXCEEDED", "ML_LEITURA_FALHOU"].includes(r.codigo);
}

async function comRetry(d, fn) {
  let r;
  for (let t = 1; t <= MAX_TENTATIVAS; t += 1) {
    r = await fn();
    if (!r || r.ok || !ehTransitoria(r)) return r;
    if (t < MAX_TENTATIVAS) await d.sleep(esperaMs(r, t));
  }
  return r;
}

// Lê as promoções do anúncio SEM engolir a falha (listarPromocoesDoItem devolve
// lista vazia num 429 — o que aqui viraria "fora da origem" por engano).
async function lerPromocoes(d, args) {
  let r = null;
  for (let t = 1; t <= MAX_TENTATIVAS; t += 1) {
    r = await d.listarPromocoesDoItemDetalhado(args);
    if (r && r.ok) return { ok: true, lista: r.promocoes };
    const st = r && r.status;
    const transitorio = st == null || st === 429 || st >= 500;
    if (!transitorio) break;
    if (t < MAX_TENTATIVAS) await d.sleep(esperaMs(r, t));
  }
  return falha("ML_LEITURA_FALHOU", `Não foi possível ler as promoções do anúncio no Mercado Livre${r && r.status ? ` (HTTP ${r.status})` : ""}.`);
}

async function transferirItem(d, { clienteId, mlUserId, itemId, origem, destino, removerOrigem }) {
  const leitura = await lerPromocoes(d, { clienteId, itemId, mlUserId });
  if (!leitura.ok) return { ...leitura, transitorio: true };
  const lista = leitura.lista;
  const mesma = (p, ref) => String(p.id) === ref.id && p.tipo === ref.tipo;
  const naOrigem = lista.find((p) => mesma(p, origem) && STATUS_PARTICIPA.has(p.status));
  if (!naOrigem) return falha("FORA_DA_ORIGEM", "O anúncio não participa mais da promoção de origem.");
  const noDestino = lista.find((p) => mesma(p, destino));
  if (!noDestino) return falha("DESTINO_INDISPONIVEL", "A promoção de destino não está disponível para este anúncio.");

  let precoConfirmado = null;
  const jaNoDestino = STATUS_PARTICIPA.has(noDestino.status);

  if (!jaNoDestino) {
    if (noDestino.status !== "candidate") {
      return falha("DESTINO_INDISPONIVEL", "O anúncio não pode entrar na promoção de destino agora.");
    }
    let entrada;
    if (TIPOS_ESCRITA_PRECO.has(noDestino.tipo)) {
      if (!(naOrigem.precoFinal > 0)) {
        return falha("PRECO_ORIGEM_INDISPONIVEL", "Não foi possível ler o preço do anúncio na origem para repeti-lo no destino.");
      }
      entrada = await comRetry(d, () => d.aplicarPromocao({
        clienteId, itemId, mlUserId, promotionId: noDestino.id, precoNovo: naOrigem.precoFinal,
      }));
    } else if (TIPOS_ESCRITA_ACEITE.has(noDestino.tipo)) {
      entrada = await comRetry(d, () => d.participarPromocaoAceite({
        clienteId, itemId, mlUserId, promotionId: noDestino.id, tipo: noDestino.tipo,
      }));
    } else {
      return falha("TIPO_SEM_ESCRITA", "Este tipo de promoção de destino não aceita participação automática por aqui.");
    }
    if (!entrada || !entrada.ok) {
      return falha((entrada && entrada.codigo) || "FALHA_AO_ENTRAR", (entrada && entrada.motivo) || "Não foi possível entrar na promoção de destino.", {
        incerto: Boolean(entrada && entrada.incerto),
        transitorio: ehTransitoria(entrada),
      });
    }
    precoConfirmado = entrada.precoConfirmado ?? null;
  }

  if (!removerOrigem) {
    return jaNoDestino
      ? { ok: true, resultado: "ignorado", motivo: "Já estava na promoção de destino.", precoConfirmado }
      : { ok: true, resultado: "ok", precoConfirmado };
  }

  const saida = await comRetry(d, () => d.sairPromocao({ clienteId, itemId, mlUserId, promotionId: naOrigem.id, tipo: naOrigem.tipo }));
  // Já fora da origem (ex.: tentativa anterior chegou ao ML): objetivo cumprido.
  if (saida && !saida.ok && saida.codigo === "PROMOCAO_NAO_PARTICIPA") return { ok: true, resultado: "ok", precoConfirmado };
  if (!saida || !saida.ok) {
    return {
      ok: true,
      resultado: "parcial",
      codigo: (saida && saida.codigo) || "FALHA_AO_SAIR",
      motivo: `${jaNoDestino ? "Já estava no destino" : "Entrou no destino"}, mas não saiu da origem: ${(saida && saida.motivo) || "erro desconhecido"}`,
      precoConfirmado,
      transitorio: ehTransitoria(saida),
    };
  }
  return { ok: true, resultado: "ok", precoConfirmado };
}

// ─── POST /promocoes-transferir/executar ─────────────────────────────────────

/**
 * body: { origem:{id,tipo}, destino:{id,tipo}, itemIds:[MLB…] (≤ MAX_ITENS_POR_LOTE),
 *         removerOrigem?: boolean (padrão true) }
 * → { ok:true, resultados:[{ itemId, status:"ok"|"parcial"|"ignorado"|"falha", codigo, motivo, precoConfirmado }] }
 */
async function transferir({ cliente, contexto, body, user, ip = null } = {}, deps = {}) {
  const d = defaults(deps);
  const par = validarPar(body);
  if (!par.ok) return par;
  const { origem, destino } = par;

  const brutos = body && body.itemIds;
  if (!Array.isArray(brutos) || !brutos.length) {
    return falha("ITEM_IDS_INVALIDOS", "Informe os anúncios a transferir (itemIds).", { httpStatus: 400 });
  }
  const itemIds = Array.from(new Set(brutos.map((x) => String(x || "").trim().toUpperCase()).filter(Boolean)));
  if (itemIds.some((id) => !/^MLB\d+$/.test(id))) {
    return falha("ITEM_IDS_INVALIDOS", "itemIds aceita só anúncios no formato MLB123.", { httpStatus: 400 });
  }
  if (itemIds.length > MAX_ITENS_POR_LOTE) {
    return falha("ITEM_IDS_INVALIDOS", `No máximo ${MAX_ITENS_POR_LOTE} anúncios por lote.`, { httpStatus: 400 });
  }
  if (!contexto || !contexto.mlUserId) return falha("CONTA_SEM_GRANT_ML", "A conta não tem conexão do Mercado Livre vinculada.");
  const removerOrigem = body.removerOrigem !== false;

  const resultados = [];
  for (const itemId of itemIds) {
    if (resultados.length) await d.sleep(PAUSA_ENTRE_ITENS_MS);
    let r;
    try {
      r = await transferirItem(d, { clienteId: cliente.id, mlUserId: contexto.mlUserId, itemId, origem, destino, removerOrigem });
    } catch (err) {
      r = falha("ERRO_INTERNO", `Erro ao transferir: ${(err && err.message) || "erro desconhecido"}`);
    }
    const status = r.ok ? r.resultado : "falha";
    resultados.push({
      itemId,
      status,
      codigo: r.codigo || null,
      motivo: r.motivo || null,
      precoConfirmado: r.precoConfirmado ?? null,
      ...(r.incerto ? { incerto: true } : {}),
      ...(r.transitorio ? { transitorio: true } : {}),
    });

    try {
      await d.registrarLog({
        userId: user ? user.id ?? null : null,
        userEmail: user ? user.email ?? null : null,
        userNome: user ? user.nome ?? null : null,
        acao: "anuncios_meli.promocoes.transferir",
        detalhes: {
          cliente_slug: cliente.slug,
          cliente_conta_id: contexto.contaId ?? null,
          item_id: itemId,
          origem,
          destino,
          remover_origem: removerOrigem,
          resultado: status,
          preco_confirmado: r.precoConfirmado ?? null,
          codigo: r.codigo || null,
          motivo: r.motivo || null,
        },
        ip,
        status: status === "falha" || status === "parcial" ? "erro" : "sucesso",
      });
    } catch (_) {
      // falha de log não derruba o lote
    }
  }
  return { ok: true, resultados };
}

// ─── POST /promocoes-transferir/promocoes (criar campanha do vendedor) ───────

function dataValida(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Cria uma SELLER_CAMPAIGN (FLEXIBLE_PERCENTAGE — o único sub_type da doc,
 * campanhas-do-vendedor.md) para servir de destino. body: { nome, inicio, fim }
 * com datas "AAAA-MM-DD"; o ML considera início/fim do dia. Nome repetido,
 * data passada etc. voltam como falha do próprio ML.
 */
async function criarPromocao({ cliente, contexto, body, user, ip = null } = {}, deps = {}) {
  const d = defaults(deps);
  const b = body || {};
  const nome = typeof b.nome === "string" ? b.nome.trim() : "";
  if (!nome) return falha("NOME_INVALIDO", "Informe o nome da promoção.", { httpStatus: 400 });
  if (nome.length > 120) return falha("NOME_INVALIDO", "O nome da promoção pode ter no máximo 120 caracteres.", { httpStatus: 400 });
  if (!dataValida(b.inicio) || !dataValida(b.fim)) {
    return falha("DATAS_INVALIDAS", "Informe as datas de início e fim (AAAA-MM-DD).", { httpStatus: 400 });
  }
  if (b.fim < b.inicio) return falha("DATAS_INVALIDAS", "A data de fim não pode ser anterior à de início.", { httpStatus: 400 });
  if (!contexto || !contexto.mlUserId) return falha("CONTA_SEM_GRANT_ML", "A conta não tem conexão do Mercado Livre vinculada.");

  const { motivoDoErroMl, codigoDoErroMl } = deps.erros || require("./meliConteudoService");
  const resp = await d.mlFetch(cliente.id, "/seller-promotions/promotions?app_version=v2", {
    method: "POST",
    body: JSON.stringify({
      promotion_type: "SELLER_CAMPAIGN",
      name: nome,
      sub_type: "FLEXIBLE_PERCENTAGE",
      start_date: `${b.inicio}T00:00:00`,
      finish_date: `${b.fim}T00:00:00`,
    }),
    mlUserId: contexto.mlUserId,
  });
  const ok = Boolean(resp && resp.ok && resp.data && resp.data.id);
  const codigo = ok ? null : codigoDoErroMl(resp && resp.data, resp && resp.status);
  const motivo = ok ? null : motivoDoErroMl(resp && resp.data, resp && resp.status);

  try {
    await d.registrarLog({
      userId: user ? user.id ?? null : null,
      userEmail: user ? user.email ?? null : null,
      userNome: user ? user.nome ?? null : null,
      acao: "anuncios_meli.promocoes.criar",
      detalhes: {
        cliente_slug: cliente.slug,
        cliente_conta_id: contexto.contaId ?? null,
        nome, inicio: b.inicio, fim: b.fim,
        promotion_id: ok ? String(resp.data.id) : null,
        codigo, motivo,
      },
      ip,
      status: ok ? "sucesso" : "erro",
    });
  } catch (_) {
    // falha de log não derruba a criação
  }
  if (!ok) return falha(codigo || "FALHA_AO_CRIAR", motivo || "Não foi possível criar a promoção no Mercado Livre.");

  const p = resp.data;
  return {
    ok: true,
    promocao: {
      id: String(p.id),
      tipo: p.type || "SELLER_CAMPAIGN",
      nome: p.name || nome,
      status: String(p.status || "pending").toLowerCase(),
      inicio: p.start_date || null,
      fim: p.finish_date || null,
    },
  };
}

module.exports = {
  criarPromocao,
  listarItens,
  transferir,
  transferirItem,
  validarPar,
  MAX_ITENS_POR_LOTE,
};
