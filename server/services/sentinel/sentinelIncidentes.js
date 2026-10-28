// server/services/sentinel/sentinelIncidentes.js
// Motor de incidentes do Sentinel V0-b: sentinel_pedidos/checkpoints → sentinel_incidentes.
//
// Três detectores (puros) + persistência (transacional, por conta):
//   margem_negativa  — pedidos que CONTAM COMO VENDA (sentinelClassificacao) com
//                      margem_valor < 0, agrupados por conta + produto (MLB, ou
//                      "MLB1+MLB2" no pedido multiproduto ⇒ um pedido nunca conta 2x).
//                      Impacto = perda observada só de pedidos calculado/confirmado;
//                      pedidos pendentes aparecem à parte e rebaixam a severidade.
//   custo_pendente   — itens de pedidos-venda sem custo confiável (sem_custo /
//                      custo_ambiguo), por conta + MLB. Impacto = receita exposta;
//                      NÃO é prejuízo.
//   leitura_atrasada — conta monitorada cujo checkpoint está atrás do relógio além
//                      do limite. O checkpoint avança mesmo sem pedidos novos, então
//                      "conta sem vendas" não dispara.
//
// Idempotência: impacto e contagens são recalculados do zero a cada avaliação
// (nunca somados ao valor anterior). Evento 'atualizado' só quando o fingerprint
// da evidência muda — reavaliar sem mudança não gera histórico.
//
// Ciclo de vida: aberto → reconhecido → resolvido (humano). O motor nunca resolve.
// Resolvido + nova ocorrência POSTERIOR à resolução ⇒ reaberto (mesma linha).
// Condição que some da janela ⇒ condicao_ativa=false + evento 'condicao_encerrada'
// (status não muda: quem encerra é a operação).

const crypto = require("crypto");
const { classificarPedido } = require("./sentinelClassificacao");

const DIA_MS = 24 * 60 * 60 * 1000;

function numEnv(env, nome, padrao) {
  const v = Number(env[nome]);
  return Number.isFinite(v) && v > 0 ? v : padrao;
}

function configIncidentes(env = process.env) {
  return {
    janelaDias: numEnv(env, "SENTINEL_INCIDENTE_JANELA_DIAS", 30),
    leituraLimiteMin: numEnv(env, "SENTINEL_LEITURA_LIMITE_MIN", 120),
    perdaCritica: numEnv(env, "SENTINEL_PERDA_CRITICA", 500),
    perdaAlta: numEnv(env, "SENTINEL_PERDA_ALTA", 100),
    pedidosCritico: numEnv(env, "SENTINEL_PEDIDOS_CRITICO", 10),
    pedidosAlta: numEnv(env, "SENTINEL_PEDIDOS_ALTA", 3),
    receitaAlta: numEnv(env, "SENTINEL_RECEITA_SEM_CUSTO_ALTA", 2000),
    receitaMedia: numEnv(env, "SENTINEL_RECEITA_SEM_CUSTO_MEDIA", 500),
    maxPedidosDetalhe: 200,
  };
}

const r2 = (n) => Math.round(Number(n) * 100) / 100;
const brl = (n) => `R$ ${r2(n).toFixed(2).replace(".", ",")}`;
const ms = (d) => (d ? new Date(d).getTime() : null);
const iso = (m) => (m === null || m === undefined ? null : new Date(m).toISOString());

function hash(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

function itensDe(p) {
  const it = typeof p.itens === "string" ? JSON.parse(p.itens) : p.itens;
  return Array.isArray(it) ? it : [];
}

function chaveProduto(itens) {
  const mlbs = [...new Set(itens.map((i) => String(i.item_id || "?")))].sort();
  return mlbs.length ? mlbs.join("+") : "?";
}

// Semana ISO simplificada (segunda-feira UTC) p/ "evolução recente".
function semanaDe(m) {
  const d = new Date(m);
  const dia = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dia)).toISOString().slice(0, 10);
}

// ─── Detectores (puros) ─────────────────────────────────────────────────────

function detectarMargemNegativa(pedidos, cfg) {
  const grupos = new Map();
  for (const p of pedidos) {
    const c = classificarPedido(p);
    if (c.elegibilidade === "excluido") continue;
    if (p.margem_valor === null || p.margem_valor === undefined || Number(p.margem_valor) >= 0) continue;
    if (c.confiabilidade === "inconclusivo") continue;
    const itens = itensDe(p);
    const chave = chaveProduto(itens);
    const g = grupos.get(chave) || { chave, pedidos: [], skus: new Set() };
    g.pedidos.push({ p, c });
    for (const i of itens) if (i.sku) g.skus.add(i.sku);
    grupos.set(chave, g);
  }
  const out = [];
  for (const g of grupos.values()) {
    const observados = g.pedidos.filter((x) => x.c.confiabilidade === "calculado" || x.c.confiabilidade === "confirmado");
    const pendentes = g.pedidos.filter((x) => x.c.confiabilidade === "pendente");
    const perda = r2(observados.reduce((s, x) => s - Number(x.p.margem_valor), 0));
    const perdaPendente = r2(pendentes.reduce((s, x) => s - Number(x.p.margem_valor), 0));
    // Faturamento ausente nunca vira 0: margem média só quando TODOS os observados têm faturamento.
    const semFat = observados.filter((x) => x.p.faturamento === null || x.p.faturamento === undefined).length;
    const fat = semFat ? null : r2(observados.reduce((s, x) => s + Number(x.p.faturamento), 0));
    const datas = g.pedidos.map((x) => ms(x.p.data_pedido)).filter((v) => v !== null);
    const confiabilidade = observados.length
      ? (observados.every((x) => x.c.confiabilidade === "confirmado") ? "confirmado" : "calculado")
      : "pendente";
    let severidade;
    if (!observados.length) severidade = "baixa";
    else if (perda >= cfg.perdaCritica || observados.length >= cfg.pedidosCritico) severidade = "critica";
    else if (perda >= cfg.perdaAlta || observados.length >= cfg.pedidosAlta) severidade = "alta";
    else severidade = "media";
    const evol = new Map();
    for (const x of g.pedidos) {
      const k = semanaDe(ms(x.p.data_pedido) ?? 0);
      const e = evol.get(k) || { semana: k, pedidos: 0, perda: 0 };
      e.pedidos += 1;
      e.perda = r2(e.perda - Number(x.p.margem_valor));
      evol.set(k, e);
    }
    const ordenados = [...g.pedidos].sort((a, b) => (ms(b.p.data_pedido) ?? 0) - (ms(a.p.data_pedido) ?? 0));
    const margemMedia = fat ? r2((-perda / fat) * 100) : null;
    out.push({
      tipo: "margem_negativa",
      chave: g.chave,
      severidade,
      confiabilidade,
      titulo: `Margem negativa em ${g.chave}`,
      motivo: observados.length
        ? `${observados.length} pedido(s) com lucro de contribuição negativo nos últimos ${cfg.janelaDias} dias: perda observada ${brl(perda)}`
          + (margemMedia !== null ? ` (margem ${String(margemMedia).replace(".", ",")}% sobre ${brl(fat)})` : "")
          + (pendentes.length ? `; mais ${pendentes.length} pedido(s) com cálculo pendente (${brl(perdaPendente)}, fora do impacto)` : "")
          + ". Claims/devoluções não verificadas."
        : `${pendentes.length} pedido(s) com margem negativa, mas cálculo pendente (componente faltando): ${brl(perdaPendente)} não entra como perda observada.`,
      proxima_acao: "Revisar preço, custo e frete do produto na Central de Margem.",
      impacto_tipo: "perda_contribuicao",
      impacto_valor: perda,
      pedidos_afetados: g.pedidos.length,
      primeira_ocorrencia: iso(datas.length ? Math.min(...datas) : null),
      ultima_ocorrencia: iso(datas.length ? Math.max(...datas) : null),
      detalhes: {
        janelaDias: cfg.janelaDias,
        pedidosObservados: observados.length,
        pedidosPendentes: pendentes.length,
        perdaPendente,
        faturamentoObservado: fat,
        pedidosSemFaturamento: semFat,
        margemMediaPct: margemMedia,
        skus: [...g.skus].sort(),
        evolucao: [...evol.values()].sort((a, b) => a.semana.localeCompare(b.semana)),
        pedidos: ordenados.slice(0, cfg.maxPedidosDetalhe).map((x) => String(x.p.pedido_id)),
      },
      pedidos_ids: g.pedidos.map((x) => String(x.p.pedido_id)).sort(),
      fingerprint: hash({
        pedidos: g.pedidos.map((x) => [String(x.p.pedido_id), String(x.p.margem_valor), String(x.p.faturamento), x.c.confiabilidade]).sort(),
        skus: [...g.skus].sort(), severidade,
      }),
    });
  }
  return out;
}

function detectarCustoPendente(pedidos, cfg) {
  const grupos = new Map();
  for (const p of pedidos) {
    if (p.estado_margem !== "sem_custo" && p.estado_margem !== "custo_ambiguo") continue;
    const c = classificarPedido(p);
    if (c.elegibilidade === "excluido") continue;
    const itens = itensDe(p);
    let problemas = itens.filter((i) => i.estado_custo && i.estado_custo !== "ok");
    // Ambiguidade no nível do pedido (mesmo MLB com custos diferentes): todos os itens.
    if (!problemas.length) problemas = itens.map((i) => ({ ...i, estado_custo: p.estado_margem }));
    for (const i of problemas) {
      const chave = String(i.item_id || "?");
      const g = grupos.get(chave) || { chave, pedidos: new Map(), receita: 0, itensSemPreco: 0, motivos: {}, skus: new Set() };
      // Preço/quantidade ausente nunca vira 0: o item fica fora da soma e é contado à parte.
      const preco = i.preco === null || i.preco === undefined ? null : Number(i.preco);
      const qtd = i.quantidade === null || i.quantidade === undefined ? null : Number(i.quantidade);
      if (preco === null || qtd === null || !Number.isFinite(preco) || !Number.isFinite(qtd)) g.itensSemPreco += 1;
      else g.receita += preco * qtd;
      g.motivos[i.estado_custo] = (g.motivos[i.estado_custo] || 0) + 1;
      if (i.sku) g.skus.add(i.sku);
      g.pedidos.set(String(p.pedido_id), p);
      grupos.set(chave, g);
    }
  }
  const out = [];
  for (const g of grupos.values()) {
    const receita = r2(g.receita);
    const datas = [...g.pedidos.values()].map((p) => ms(p.data_pedido)).filter((v) => v !== null);
    const ambiguo = (g.motivos.custo_ambiguo || 0) > 0;
    const severidade = receita >= cfg.receitaAlta ? "alta" : receita >= cfg.receitaMedia ? "media" : "baixa";
    const ids = [...g.pedidos.values()].sort((a, b) => (ms(b.data_pedido) ?? 0) - (ms(a.data_pedido) ?? 0)).map((p) => String(p.pedido_id));
    out.push({
      tipo: "custo_pendente",
      chave: g.chave,
      severidade,
      confiabilidade: "inconclusivo",
      titulo: ambiguo ? `Custo ambíguo para ${g.chave}` : `Produto sem custo: ${g.chave}`,
      motivo: `${ids.length} pedido(s) nos últimos ${cfg.janelaDias} dias com ${brl(receita)} de receita sem custo confiável`
        + (g.itensSemPreco ? ` (mais ${g.itensSemPreco} item(ns) sem preço, fora da soma)` : "")
        + ` (${Object.entries(g.motivos).map(([k, v]) => `${k}: ${v}`).join(", ")}). Margem não determinável — isto não é prejuízo comprovado.`,
      proxima_acao: ambiguo
        ? "Desambiguar o custo (variação/SKU) na Base de custos do cliente."
        : "Cadastrar o custo do produto na Base de custos do cliente.",
      impacto_tipo: "receita_sem_custo",
      impacto_valor: receita,
      pedidos_afetados: ids.length,
      primeira_ocorrencia: iso(datas.length ? Math.min(...datas) : null),
      ultima_ocorrencia: iso(datas.length ? Math.max(...datas) : null),
      detalhes: { janelaDias: cfg.janelaDias, motivos: g.motivos, itensSemPreco: g.itensSemPreco, skus: [...g.skus].sort(), pedidos: ids.slice(0, cfg.maxPedidosDetalhe) },
      pedidos_ids: [...ids].sort(),
      fingerprint: hash({ ids: [...ids].sort(), receita, motivos: g.motivos, skus: [...g.skus].sort(), severidade }),
    });
  }
  return out;
}

// Erro bruto (ML/rede/banco) nunca vai inteiro para a API: tira qualquer coisa com
// cara de credencial/URL e corta. A categoria (categoriaErro) é o que a UI usa.
const PADROES_SENSIVEIS = [
  // Par "chave: valor" PRIMEIRO (senão a regra só da chave deixa o valor exposto).
  /\b(?:(?:access|refresh|id)_?token|token|senha|password|passwd|secret|api[_-]?key|authorization)\b\s*[:=]\s*(?:Bearer\s+)?\S+/gi,
  /\b(?:access|refresh|id)_?token\b\S*/gi,
  /\bBearer\s+\S+/gi,
  /\b(?:APP_USR|TG)-[\w-]+/g,
  /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi,
  /\b(?:senha|password|passwd|secret|api[_-]?key)\b\S*/gi,
];

function sanitizarErro(erro) {
  if (erro === null || erro === undefined || erro === "") return null;
  let s = String(erro);
  for (const re of PADROES_SENSIVEIS) s = s.replace(re, "[redigido]");
  return s.length > 160 ? `${s.slice(0, 157)}...` : s;
}

function categoriaErro(erro) {
  const e = String(erro || "");
  if (!e) return null;
  if (/TOKEN/i.test(e)) return "token";
  if (/ORCAMENTO/i.test(e)) return "orcamento";
  if (/SEM_SELLER/i.test(e)) return "conta";
  if (/LOCK/i.test(e)) return "concorrencia";
  return "api";
}

// Estado de leitura de UMA conta (puro): usado pelo detector e pela API de saúde.
function avaliarLeitura(checkpoint, agoraMs, cfg) {
  if (!checkpoint) return { situacao: "nao_monitorada", atrasoSegundos: null };
  const limiteMs = cfg.leituraLimiteMin * 60 * 1000;
  const cp = ms(checkpoint.ultimo_date_last_updated);
  const exec = ms(checkpoint.ultima_execucao_em);
  const categoria = categoriaErro(checkpoint.ultimo_erro);
  const atrasoMs = cp !== null ? Math.max(0, agoraMs - cp) : null;
  const base = { atrasoSegundos: atrasoMs === null ? null : Math.round(atrasoMs / 1000), categoriaErro: categoria, ultimoErro: sanitizarErro(checkpoint.ultimo_erro) };
  if (cp === null) {
    // Nunca avançou: só é incidente depois do limite desde a primeira tentativa.
    if (exec !== null && agoraMs - exec <= limiteMs && !categoria) return { ...base, situacao: "nunca_lida" };
    return { ...base, situacao: "atrasada", inicioMs: exec ?? agoraMs };
  }
  if (atrasoMs > limiteMs) return { ...base, situacao: categoria ? "erro" : "atrasada", inicioMs: cp + limiteMs };
  return { ...base, situacao: categoria ? "ok_com_erro" : "ok" };
}

function detectarLeituraAtrasada(checkpoint, agoraMs, cfg) {
  const l = avaliarLeitura(checkpoint, agoraMs, cfg);
  if (l.situacao !== "atrasada" && l.situacao !== "erro") return [];
  const limiteMs = cfg.leituraLimiteMin * 60 * 1000;
  const exec = ms(checkpoint.ultima_execucao_em);
  const workerParado = exec === null || agoraMs - exec > limiteMs;
  const critica = l.categoriaErro === "token" || (l.atrasoSegundos !== null && l.atrasoSegundos * 1000 > 4 * limiteMs);
  const horas = l.atrasoSegundos === null ? null : Math.round((l.atrasoSegundos / 3600) * 10) / 10;
  let motivo;
  let acao;
  if (l.categoriaErro === "token") {
    motivo = "Token do Mercado Livre indisponível; o Sentinel não renova tokens.";
    acao = "Renovar a conexão da conta pelo Portal (Clientes → Contas).";
  } else if (workerParado) {
    motivo = `Nenhuma execução do Sentinel há mais de ${cfg.leituraLimiteMin} min.`;
    acao = "Verificar se o worker do Sentinel está ativo.";
  } else if (l.categoriaErro) {
    motivo = `Coleta falhando (${l.categoriaErro}): ${l.ultimoErro}`;
    acao = l.categoriaErro === "orcamento" ? "Revisar orçamento de chamadas da conta." : "Investigar o erro da coleta no log do worker.";
  } else {
    motivo = "Checkpoint de leitura não avança.";
    acao = "Investigar o log do worker do Sentinel.";
  }
  const categoria = l.categoriaErro || (workerParado ? "worker_parado" : "sem_avanco");
  return [{
    tipo: "leitura_atrasada",
    chave: "conta",
    severidade: critica ? "critica" : "alta",
    confiabilidade: "operacional",
    titulo: horas === null ? "Conta nunca lida pelo Sentinel" : `Leitura atrasada há ${String(horas).replace(".", ",")} h`,
    motivo,
    proxima_acao: acao,
    impacto_tipo: null,
    impacto_valor: null,
    pedidos_afetados: 0,
    primeira_ocorrencia: iso(l.inicioMs),
    ultima_ocorrencia: iso(l.inicioMs),
    pedidos_ids: [],
    detalhes: { atrasoSegundos: l.atrasoSegundos, limiteMin: cfg.leituraLimiteMin, categoria, ultimoErro: l.ultimoErro, ultimaExecucaoEm: checkpoint.ultima_execucao_em, checkpoint: checkpoint.ultimo_date_last_updated },
    // Sem o atraso em segundos: senão cada ciclo viraria um evento 'atualizado'.
    fingerprint: hash({ categoria, critica }),
  }];
}

// ─── Persistência ───────────────────────────────────────────────────────────

// Incidente resolvido reabre só com ocorrência NOVA: margem/custo ⇒ algum pedido
// que não estava no conjunto observado quando foi resolvido (inclui pedido antigo
// que só depois ficou negativo / sem custo); leitura ⇒ atraso que começou depois
// da resolução. Mesmo pedido com valor diferente não reabre (o incidente já
// cobria aquele pedido). Devolve a evidência ou null.
function novaOcorrencia(atual, cand, resolvidoMs) {
  if (cand.tipo === "leitura_atrasada") {
    const inicio = ms(cand.ultima_ocorrencia);
    return inicio !== null && resolvidoMs !== null && inicio > resolvidoMs ? { inicioAtraso: cand.ultima_ocorrencia } : null;
  }
  const antes = new Set((atual.pedidos_ids || []).map(String));
  const novos = (cand.pedidos_ids || []).map(String).filter((id) => !antes.has(id));
  return novos.length ? { pedidosNovos: novos.slice(0, 50) } : null;
}

const CAMPOS_METRICA = ["severidade", "confiabilidade", "titulo", "motivo", "proxima_acao", "impacto_tipo", "impacto_valor",
  "pedidos_afetados", "primeira_ocorrencia", "ultima_ocorrencia", "detalhes", "fingerprint", "pedidos_ids"];

async function comTransacao(db, fn) {
  // Pool ⇒ conexão dedicada; Client (já conectado, ex. conexão do lock) ⇒ usa direto.
  const ehPool = typeof db.connect === "function" && "totalCount" in db;
  const client = ehPool ? await db.connect() : null;
  const c = client || db;
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    if (client) client.release();
  }
}

async function registrarEvento(c, incidenteId, evento, ator, statusAntes, statusDepois, dados = {}) {
  await c.query(
    `INSERT INTO sentinel_incidente_eventos (incidente_id, evento, ator, status_antes, status_depois, dados)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [incidenteId, evento, ator, statusAntes, statusDepois, JSON.stringify(dados)]
  );
}

function valoresMetrica(cand) {
  return CAMPOS_METRICA.map((k) => (k === "detalhes" ? JSON.stringify(cand.detalhes || {}) : cand[k] ?? null));
}

// Avalia UMA conta: detecta, cria/atualiza/reabre/encerra condição. Transacional e
// serializado por conta (advisory xact lock) ⇒ dois avaliadores simultâneos não
// duplicam incidente nem evento.
async function avaliarIncidentesConta(db, contaId, opts = {}) {
  const cfg = { ...configIncidentes(opts.env), ...(opts.config || {}) };
  const agoraMs = opts.agora ? ms(opts.agora) : Date.now();
  const desde = new Date(agoraMs - cfg.janelaDias * DIA_MS).toISOString();
  return comTransacao(db, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('vf:sentinel:incidentes'), $1::int)", [contaId]);
    // Conta apagada (checkpoint órfão, sem FK): nada a avaliar nem a gravar —
    // os incidentes dela já cascatearam junto com a conta.
    const conta = (await c.query("SELECT ativo FROM cliente_contas WHERE id = $1", [contaId])).rows[0];
    if (!conta) return { contaId, ignorada: "conta_inexistente", abertos: 0, atualizados: 0, reabertos: 0, encerrados: 0, inalterados: 0 };
    // Conta desativada: o worker deixa de lê-la (seleciona só ativas) — isso não é
    // falha de leitura nem ocorrência nova. Nenhum detector roda; só a condição de
    // leitura é encerrada; incidentes financeiros ficam intactos (status e impacto).
    const desativada = conta.ativo !== true;
    const pedidos = (await c.query(
      `SELECT pedido_id, data_pedido, status_ml, estado_margem, pendencias, claims_verificado, faturamento, margem_valor, margem_pct, itens
         FROM sentinel_pedidos WHERE cliente_conta_id = $1 AND data_pedido >= $2`,
      [contaId, desde]
    )).rows;
    const checkpoint = (await c.query("SELECT * FROM sentinel_checkpoints WHERE cliente_conta_id = $1", [contaId])).rows[0] || null;
    const candidatos = desativada ? [] : [
      ...detectarMargemNegativa(pedidos, cfg),
      ...detectarCustoPendente(pedidos, cfg),
      ...detectarLeituraAtrasada(checkpoint, agoraMs, cfg),
    ];
    const existentes = new Map((await c.query(
      "SELECT * FROM sentinel_incidentes WHERE cliente_conta_id = $1 FOR UPDATE", [contaId]
    )).rows.map((r) => [`${r.tipo}|${r.chave}`, r]));
    const agoraIso = new Date(agoraMs).toISOString();
    const resumo = { contaId, abertos: 0, atualizados: 0, reabertos: 0, encerrados: 0, inalterados: 0, ...(desativada ? { contaDesativada: true } : {}) };
    const vistos = new Set();

    for (const cand of candidatos) {
      const k = `${cand.tipo}|${cand.chave}`;
      vistos.add(k);
      const atual = existentes.get(k);
      if (!atual) {
        const r = await c.query(
          `INSERT INTO sentinel_incidentes (cliente_conta_id, tipo, chave, status, ${CAMPOS_METRICA.join(", ")}, condicao_ativa, aberto_em, avaliado_em)
           VALUES ($1, $2, $3, 'aberto', ${CAMPOS_METRICA.map((_, i) => `$${i + 4}`).join(", ")}, TRUE, $${CAMPOS_METRICA.length + 4}, $${CAMPOS_METRICA.length + 4})
           RETURNING id`,
          [contaId, cand.tipo, cand.chave, ...valoresMetrica(cand), agoraIso]
        );
        await registrarEvento(c, r.rows[0].id, "aberto", "sentinel", null, "aberto",
          { impacto: cand.impacto_valor, pedidos: cand.pedidos_afetados, severidade: cand.severidade });
        resumo.abertos += 1;
        continue;
      }
      // Linha anterior à coluna pedidos_ids (conjunto vazio, mas o incidente tem pedidos):
      // preenche a linha de base em silêncio — sem evento e sem reabrir.
      if (cand.tipo !== "leitura_atrasada" && !(atual.pedidos_ids || []).length && (cand.pedidos_ids || []).length) {
        await c.query("UPDATE sentinel_incidentes SET pedidos_ids = $2 WHERE id = $1", [atual.id, cand.pedidos_ids]);
        atual.pedidos_ids = cand.pedidos_ids;
      }
      const resolvidoMs = ms(atual.resolvido_em);
      const novos = atual.status === "resolvido" ? novaOcorrencia(atual, cand, resolvidoMs) : null;
      const reabrir = !!novos;
      const mudou = atual.fingerprint !== cand.fingerprint || atual.condicao_ativa !== true;
      if (atual.status === "resolvido" && !reabrir) {
        // Resolvido sem ocorrência nova: registra só o que se observa, sem histórico.
        await c.query(
          `UPDATE sentinel_incidentes SET condicao_ativa = TRUE, avaliado_em = $2 WHERE id = $1`, [atual.id, agoraIso]);
        resumo.inalterados += 1;
        continue;
      }
      if (!reabrir && !mudou) {
        await c.query("UPDATE sentinel_incidentes SET avaliado_em = $2 WHERE id = $1", [atual.id, agoraIso]);
        resumo.inalterados += 1;
        continue;
      }
      const sets = CAMPOS_METRICA.map((col, i) => `${col} = $${i + 2}`).join(", ");
      const n = CAMPOS_METRICA.length + 2;
      await c.query(
        `UPDATE sentinel_incidentes SET ${sets}, condicao_ativa = TRUE, avaliado_em = $${n}, updated_at = $${n}
           ${reabrir ? `, status = 'reaberto', reaberto_em = $${n}, vezes_reaberto = vezes_reaberto + 1,
              reconhecido_em = NULL, reconhecido_por = NULL, resolvido_em = NULL, resolvido_por = NULL,
              motivo_resolucao = NULL, observacao_resolucao = NULL` : ""}
         WHERE id = $1`,
        [atual.id, ...valoresMetrica(cand), agoraIso]
      );
      const dados = {
        impactoAntes: atual.impacto_valor === null ? null : Number(atual.impacto_valor), impactoDepois: cand.impacto_valor,
        pedidosAntes: atual.pedidos_afetados, pedidosDepois: cand.pedidos_afetados,
        severidadeAntes: atual.severidade, severidadeDepois: cand.severidade,
      };
      if (reabrir) {
        await registrarEvento(c, atual.id, "reaberto", "sentinel", "resolvido", "reaberto",
          { ...dados, novaOcorrencia: novos, resolvidoEm: iso(resolvidoMs) });
        resumo.reabertos += 1;
      } else {
        await registrarEvento(c, atual.id, "atualizado", "sentinel", atual.status, atual.status, dados);
        resumo.atualizados += 1;
      }
    }

    for (const [k, atual] of existentes) {
      if (vistos.has(k) || !atual.condicao_ativa) continue;
      // Conta desativada: só a LEITURA deixa de ser observada (o worker não a lê mais).
      // Margem/custo continuam como estavam — o impacto não some do resumo.
      if (desativada && atual.tipo !== "leitura_atrasada") continue;
      await c.query("UPDATE sentinel_incidentes SET condicao_ativa = FALSE, avaliado_em = $2, updated_at = $2 WHERE id = $1", [atual.id, agoraIso]);
      if (atual.status !== "resolvido") {
        await registrarEvento(c, atual.id, "condicao_encerrada", "sentinel", atual.status, atual.status,
          { motivo: desativada ? "conta desativada"
            : atual.tipo === "leitura_atrasada" ? "leitura voltou ao normal" : `sem ocorrência nos últimos ${cfg.janelaDias} dias` });
      }
      resumo.encerrados += 1;
    }
    return resumo;
  });
}

// ─── Ações humanas ──────────────────────────────────────────────────────────

function erro(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

const TRANSICOES = {
  reconhecer: { de: ["aberto", "reaberto"], para: "reconhecido" },
  resolver: { de: ["aberto", "reaberto", "reconhecido"], para: "resolvido" },
};

async function transicionar(db, id, acao, { ator, motivo = null, observacao = null } = {}) {
  if (!ator || !String(ator).trim()) throw erro("ATOR_OBRIGATORIO", "Ação exige o usuário que a executa.");
  if (acao === "resolver" && (!motivo || !String(motivo).trim())) throw erro("MOTIVO_OBRIGATORIO", "Informe o motivo da resolução.");
  const t = TRANSICOES[acao];
  const obs = observacao && String(observacao).trim() ? String(observacao).trim().slice(0, 2000) : null;
  const mot = motivo ? String(motivo).trim().slice(0, 500) : null;
  return comTransacao(db, async (c) => {
    const atual = (await c.query("SELECT id, status FROM sentinel_incidentes WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!atual) throw erro("INCIDENTE_NAO_ENCONTRADO", "Incidente não encontrado.");
    if (!t.de.includes(atual.status)) {
      throw erro("TRANSICAO_INVALIDA", `Não é possível ${acao} um incidente ${atual.status}.`);
    }
    if (acao === "reconhecer") {
      await c.query(
        "UPDATE sentinel_incidentes SET status = 'reconhecido', reconhecido_em = NOW(), reconhecido_por = $2, updated_at = NOW() WHERE id = $1",
        [id, String(ator)]);
    } else {
      await c.query(
        `UPDATE sentinel_incidentes SET status = 'resolvido', resolvido_em = NOW(), resolvido_por = $2,
                motivo_resolucao = $3, observacao_resolucao = $4, updated_at = NOW() WHERE id = $1`,
        [id, String(ator), mot, obs]);
    }
    await registrarEvento(c, id, t.para, String(ator), atual.status, t.para, { motivo: mot, observacao: obs });
    return id;
  }).then(() => obterIncidente(db, id));
}

const reconhecerIncidente = (db, id, opts) => transicionar(db, id, "reconhecer", opts);
const resolverIncidente = (db, id, opts) => transicionar(db, id, "resolver", opts);

// ─── Leitura (API) ──────────────────────────────────────────────────────────

const SQL_CONTEXTO = `
  LEFT JOIN cliente_contas cc ON cc.id = i.cliente_conta_id
  LEFT JOIN clientes cl ON cl.id = cc.cliente_id
  LEFT JOIN LATERAL (
    SELECT s.id, s.nome FROM cliente_squad_history h JOIN squads s ON s.id = h.squad_id
     WHERE h.cliente_id = cc.cliente_id AND h.fim_em IS NULL ORDER BY h.id DESC LIMIT 1
  ) sq ON TRUE`;

const RANK_SEVERIDADE = "CASE i.severidade WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END";
const RANK_STATUS = "CASE i.status WHEN 'reaberto' THEN 0 WHEN 'aberto' THEN 1 WHEN 'reconhecido' THEN 2 ELSE 3 END";

function paraDto(r) {
  // Leitura também sanitiza: incidentes gravados antes do sanitizador podem ter erro bruto.
  if (r.tipo === "leitura_atrasada") {
    r = { ...r, motivo: sanitizarErro(r.motivo) ?? r.motivo,
      detalhes: r.detalhes ? { ...r.detalhes, ultimoErro: sanitizarErro(r.detalhes.ultimoErro) } : r.detalhes };
  }
  const impacto = r.impacto_valor === null ? null : Number(r.impacto_valor);
  const rotuloImpacto = r.impacto_tipo === "perda_contribuicao" ? `perda observada ${brl(impacto)}`
    : r.impacto_tipo === "receita_sem_custo" ? `receita sem custo ${brl(impacto)} (não é prejuízo)` : "operacional (sem valor)";
  return {
    id: Number(r.id),
    contaId: r.cliente_conta_id,
    clienteId: r.cliente_id ?? null,
    clienteNome: r.cliente_nome ?? null,
    clienteSlug: r.cliente_slug ?? null,
    contaNome: r.conta_nome ?? null,
    squad: r.squad_id ? { id: r.squad_id, nome: r.squad_nome } : null,
    tipo: r.tipo,
    chave: r.chave,
    status: r.status,
    severidade: r.severidade,
    confiabilidade: r.confiabilidade,
    condicaoAtiva: r.condicao_ativa,
    titulo: r.titulo,
    motivo: r.motivo,
    proximaAcao: r.proxima_acao,
    impacto: { tipo: r.impacto_tipo, valor: impacto },
    prioridade: { explicacao: `severidade ${r.severidade} · ${rotuloImpacto} · ${r.pedidos_afetados} pedido(s)` },
    pedidosAfetados: r.pedidos_afetados,
    primeiraOcorrencia: r.primeira_ocorrencia,
    ultimaOcorrencia: r.ultima_ocorrencia,
    abertoEm: r.aberto_em,
    reconhecido: r.reconhecido_em ? { em: r.reconhecido_em, por: r.reconhecido_por } : null,
    resolvido: r.resolvido_em ? { em: r.resolvido_em, por: r.resolvido_por, motivo: r.motivo_resolucao, observacao: r.observacao_resolucao } : null,
    reabertoEm: r.reaberto_em,
    vezesReaberto: r.vezes_reaberto,
    avaliadoEm: r.avaliado_em,
    detalhes: r.detalhes || {},
  };
}

const COLUNAS_CONTEXTO = "i.*, cc.cliente_id, cc.nome AS conta_nome, cl.nome AS cliente_nome, cl.slug AS cliente_slug, sq.id AS squad_id, sq.nome AS squad_nome";

function exigirContas(contaIds) {
  if (!Array.isArray(contaIds)) throw erro("CONTAS_OBRIGATORIAS", "contaIds (já autorizadas) é obrigatório.");
  return contaIds.map(Number).filter((n) => Number.isInteger(n) && n > 0);
}

async function listarIncidentes(db, f = {}) {
  const contas = exigirContas(f.contaIds);
  if (!contas.length) return { itens: [], total: 0 };
  const where = ["i.cliente_conta_id = ANY($1::int[])"];
  const params = [contas];
  const add = (sql, v) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
  const lista = (v) => (Array.isArray(v) ? v : String(v).split(",")).map((s) => String(s).trim()).filter(Boolean);
  if (f.tipo) add("i.tipo = ANY(?::text[])", lista(f.tipo));
  if (f.status) add("i.status = ANY(?::text[])", lista(f.status));
  if (f.severidade) add("i.severidade = ANY(?::text[])", lista(f.severidade));
  if (f.desde) add("i.ultima_ocorrencia >= ?", new Date(f.desde).toISOString());
  if (f.ate) add("i.ultima_ocorrencia <= ?", new Date(f.ate).toISOString());
  if (f.busca) {
    params.push(`%${String(f.busca).slice(0, 100)}%`);
    where.push(`(i.chave ILIKE $${params.length} OR i.titulo ILIKE $${params.length})`);
  }
  const limit = Math.min(Math.max(Number(f.limit) || 50, 1), 200);
  const offset = Math.max(Number(f.offset) || 0, 0);
  const whereSql = where.join(" AND ");
  const total = Number((await db.query(`SELECT COUNT(*)::int AS n FROM sentinel_incidentes i WHERE ${whereSql}`, params)).rows[0].n);
  const rows = (await db.query(
    `SELECT ${COLUNAS_CONTEXTO} FROM sentinel_incidentes i ${SQL_CONTEXTO}
      WHERE ${whereSql}
      ORDER BY ${RANK_STATUS}, ${RANK_SEVERIDADE}, i.impacto_valor DESC NULLS LAST, i.ultima_ocorrencia DESC NULLS LAST, i.id
      LIMIT ${limit} OFFSET ${offset}`, params)).rows;
  return { itens: rows.map(paraDto), total };
}

async function contaDoIncidente(db, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const r = await db.query("SELECT cliente_conta_id FROM sentinel_incidentes WHERE id = $1", [n]);
  return r.rows[0]?.cliente_conta_id ?? null;
}

async function obterIncidente(db, id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) return null;
  const r = (await db.query(`SELECT ${COLUNAS_CONTEXTO} FROM sentinel_incidentes i ${SQL_CONTEXTO} WHERE i.id = $1`, [n])).rows[0];
  if (!r) return null;
  const dto = paraDto(r);
  dto.eventos = (await db.query(
    "SELECT id, evento, ator, status_antes, status_depois, dados, criado_em FROM sentinel_incidente_eventos WHERE incidente_id = $1 ORDER BY criado_em, id", [n]
  )).rows.map((e) => ({ id: Number(e.id), evento: e.evento, ator: e.ator, statusAntes: e.status_antes, statusDepois: e.status_depois, dados: e.dados, criadoEm: e.criado_em }));
  const ids = Array.isArray(dto.detalhes.pedidos) ? dto.detalhes.pedidos : [];
  dto.pedidos = ids.length ? (await db.query(
    `SELECT pedido_id, data_pedido, status_ml, estado_margem, pendencias, claims_verificado, faturamento, comissao, frete, custo, imposto, margem_valor, margem_pct, itens
       FROM sentinel_pedidos WHERE cliente_conta_id = $1 AND pedido_id = ANY($2::text[]) ORDER BY data_pedido DESC`,
    [r.cliente_conta_id, ids]
  )).rows.map((p) => {
    const c = classificarPedido(p);
    const num = (v) => (v === null || v === undefined ? null : Number(v));
    return {
      pedidoId: p.pedido_id, dataPedido: p.data_pedido, statusMl: p.status_ml,
      faturamento: num(p.faturamento), comissao: num(p.comissao), frete: num(p.frete), custo: num(p.custo), imposto: num(p.imposto),
      margemValor: num(p.margem_valor), margemPct: num(p.margem_pct),
      elegibilidade: c.elegibilidade, confiabilidade: c.confiabilidade, motivosConfiabilidade: c.motivosConfiabilidade,
      itens: itensDe(p).map((i) => ({ itemId: i.item_id, sku: i.sku, quantidade: i.quantidade, preco: i.preco, custoUnitario: i.custo_unitario, estadoCusto: i.estado_custo })),
    };
  }) : [];
  return dto;
}

async function saudeContas(db, { contaIds, agora, env } = {}) {
  const contas = exigirContas(contaIds);
  if (!contas.length) return [];
  const cfg = configIncidentes(env);
  const agoraMs = agora ? ms(agora) : Date.now();
  const rows = (await db.query(
    `SELECT cc.id AS conta_id, cc.nome AS conta_nome, cc.cliente_id, cc.ativo, cl.nome AS cliente_nome, cl.slug AS cliente_slug,
            sq.id AS squad_id, sq.nome AS squad_nome, ck.cliente_conta_id AS ck_conta, ck.ultimo_date_last_updated,
            ck.ultima_execucao_em, ck.ultimo_erro, ck.pedidos_processados_ultima
       FROM cliente_contas cc
       JOIN clientes cl ON cl.id = cc.cliente_id
       LEFT JOIN sentinel_checkpoints ck ON ck.cliente_conta_id = cc.id
       LEFT JOIN LATERAL (
         SELECT s.id, s.nome FROM cliente_squad_history h JOIN squads s ON s.id = h.squad_id
          WHERE h.cliente_id = cc.cliente_id AND h.fim_em IS NULL ORDER BY h.id DESC LIMIT 1
       ) sq ON TRUE
      WHERE cc.id = ANY($1::int[])
      ORDER BY cl.nome, cc.nome`, [contas])).rows;
  return rows.map((r) => {
    // Conta desativada não é monitorada (o worker não a lê): nunca "atrasada".
    const desativada = r.ativo !== true;
    const l = desativada ? { situacao: "desativada", atrasoSegundos: null } : avaliarLeitura(r.ck_conta ? r : null, agoraMs, cfg);
    return {
      contaId: r.conta_id, clienteId: r.cliente_id, clienteNome: r.cliente_nome, clienteSlug: r.cliente_slug, contaNome: r.conta_nome,
      squad: r.squad_id ? { id: r.squad_id, nome: r.squad_nome } : null,
      ativo: !desativada,
      monitorada: !!r.ck_conta && !desativada,
      ultimaExecucaoEm: r.ultima_execucao_em || null,
      checkpoint: r.ultimo_date_last_updated || null,
      atrasoSegundos: l.atrasoSegundos ?? null,
      ultimoErro: sanitizarErro(r.ultimo_erro),
      situacao: l.situacao,
      limiteMin: cfg.leituraLimiteMin,
    };
  });
}

async function resumoMonitoramento(db, { contaIds, agora, env } = {}) {
  const contas = exigirContas(contaIds);
  const cfg = configIncidentes(env);
  const agoraMs = agora ? ms(agora) : Date.now();
  const vazio = {
    contasMonitoradas: 0, contasAtrasadas: 0, incidentesAbertos: 0, incidentesCriticos: 0,
    perdaContribuicaoObservada: 0, receitaCustoPendente: 0, ultimaAtualizacao: null,
    cobertura: { pedidos: 0, vendas: 0, porConfiabilidade: { calculado: 0, pendente: 0, confirmado: 0, inconclusivo: 0 }, excluidos: {} },
    monitoramentoAtivo: false, janelaDias: cfg.janelaDias,
  };
  if (!contas.length) return vazio;
  const saude = await saudeContas(db, { contaIds: contas, agora: agoraMs, env });
  const monitoradas = saude.filter((s) => s.monitorada);
  const inc = (await db.query(
    `SELECT COUNT(*) FILTER (WHERE status <> 'resolvido')::int AS abertos,
            COUNT(*) FILTER (WHERE status <> 'resolvido' AND severidade = 'critica')::int AS criticos,
            COALESCE(SUM(impacto_valor) FILTER (WHERE status <> 'resolvido' AND condicao_ativa AND impacto_tipo = 'perda_contribuicao'), 0) AS perda,
            COALESCE(SUM(impacto_valor) FILTER (WHERE status <> 'resolvido' AND condicao_ativa AND impacto_tipo = 'receita_sem_custo'), 0) AS receita,
            MAX(avaliado_em) AS avaliado
       FROM sentinel_incidentes WHERE cliente_conta_id = ANY($1::int[])`, [contas])).rows[0];
  const desde = new Date(agoraMs - cfg.janelaDias * DIA_MS).toISOString();
  const peds = (await db.query(
    `SELECT status_ml, estado_margem, pendencias, claims_verificado, margem_valor
       FROM sentinel_pedidos WHERE cliente_conta_id = ANY($1::int[]) AND data_pedido >= $2`, [contas, desde])).rows;
  const cobertura = { ...vazio.cobertura, porConfiabilidade: { ...vazio.cobertura.porConfiabilidade }, excluidos: {} };
  cobertura.pedidos = peds.length;
  for (const p of peds) {
    const c = classificarPedido(p);
    if (c.elegibilidade === "excluido") { cobertura.excluidos[c.motivoExclusao] = (cobertura.excluidos[c.motivoExclusao] || 0) + 1; continue; }
    cobertura.vendas += 1;
    cobertura.porConfiabilidade[c.confiabilidade] = (cobertura.porConfiabilidade[c.confiabilidade] || 0) + 1;
  }
  const ultimas = monitoradas.map((s) => ms(s.ultimaExecucaoEm)).filter((v) => v !== null);
  return {
    contasMonitoradas: monitoradas.length,
    contasAtrasadas: monitoradas.filter((s) => s.situacao === "atrasada" || s.situacao === "erro").length,
    incidentesAbertos: inc.abertos,
    incidentesCriticos: inc.criticos,
    perdaContribuicaoObservada: r2(inc.perda),
    receitaCustoPendente: r2(inc.receita),
    ultimaAtualizacao: iso(ultimas.length ? Math.max(...ultimas) : null),
    ultimaAvaliacao: inc.avaliado || null,
    cobertura,
    monitoramentoAtivo: monitoradas.length > 0,
    janelaDias: cfg.janelaDias,
  };
}

// ─── Saúde operacional (F4) ─────────────────────────────────────────────────
// Visão "alguém precisa agir?" sem depender de ninguém olhar a fila. Tudo
// derivado na leitura (sem tabela nova): estado do worker pela última execução
// registrada, situação de cada conta, incidentes abertos e cobertura financeira.
// Alertas são internos ao Portal (nenhum envio externo). "Sem pedidos recentes"
// é informação, nunca falha: o checkpoint avança mesmo sem venda.

function lerMs(env, nome, padrao) {
  const v = Number(env[nome]);
  return Number.isFinite(v) && v > 0 ? v : padrao;
}

async function resumoOperacional(db, { contaIds, agora, env = process.env } = {}) {
  const contas = exigirContas(contaIds);
  const cfg = configIncidentes(env);
  const agoraMs = agora ? ms(agora) : Date.now();
  const intervaloMs = lerMs(env, "SENTINEL_POLL_INTERVAL_MS", 180000) + lerMs(env, "SENTINEL_CICLO_MAX_MS", 300000);
  const limiteMs = cfg.leituraLimiteMin * 60 * 1000;
  const saude = contas.length ? await saudeContas(db, { contaIds: contas, agora: agoraMs, env }) : [];
  const resumo = await resumoMonitoramento(db, { contaIds: contas, agora: agoraMs, env });
  const monit = saude.filter((s) => s.monitorada);

  const execs = monit.map((s) => ms(s.ultimaExecucaoEm)).filter((v) => v !== null);
  const ultimaExec = execs.length ? Math.max(...execs) : null;
  const idadeWorker = ultimaExec === null ? null : Math.max(0, agoraMs - ultimaExec);
  let estadoWorker = "sem_dados";
  if (idadeWorker !== null) estadoWorker = idadeWorker <= 2 * intervaloMs ? "ativo" : idadeWorker <= limiteMs ? "atrasado" : "parado";

  const ultimos = contas.length ? (await db.query(
    `SELECT cliente_conta_id, MAX(data_pedido) AS ultimo FROM sentinel_pedidos
      WHERE cliente_conta_id = ANY($1::int[]) GROUP BY 1`, [contas])).rows : [];
  const ultimoPedido = new Map(ultimos.map((r) => [r.cliente_conta_id, ms(r.ultimo)]));
  const porSev = { critica: 0, alta: 0, media: 0, baixa: 0 };
  if (contas.length) {
    for (const r of (await db.query(
      `SELECT severidade, COUNT(*)::int AS n FROM sentinel_incidentes
        WHERE cliente_conta_id = ANY($1::int[]) AND status <> 'resolvido' GROUP BY 1`, [contas])).rows) porSev[r.severidade] = r.n;
  }

  const contagem = { monitoradas: monit.length, ok: 0, atrasadas: 0, erroToken: 0, erroApi: 0, nuncaLidas: 0, semPedidosRecentes: 0 };
  const alertas = [];
  const nome = (s) => `${s.clienteNome} · ${s.contaNome}`;
  for (const s of monit) {
    const cat = categoriaErro(s.ultimoErro);
    if (s.situacao === "ok" || s.situacao === "ok_com_erro") contagem.ok += 1;
    if (s.situacao === "atrasada" || s.situacao === "erro") {
      contagem.atrasadas += 1;
      alertas.push({ nivel: cat === "token" || (s.atrasoSegundos ?? 0) * 1000 > 4 * limiteMs ? "critico" : "aviso", codigo: "LEITURA_ATRASADA",
        mensagem: `${nome(s)}: leitura atrasada há ${Math.round((s.atrasoSegundos ?? 0) / 60)} min.`, contaId: s.contaId });
    }
    if (s.situacao === "nunca_lida") {
      contagem.nuncaLidas += 1;
      alertas.push({ nivel: "info", codigo: "NUNCA_LIDA", mensagem: `${nome(s)}: ainda sem primeira leitura.`, contaId: s.contaId });
    }
    if (cat === "token") {
      contagem.erroToken += 1;
      alertas.push({ nivel: "critico", codigo: "TOKEN_INDISPONIVEL", mensagem: `${nome(s)}: token ML indisponível — renovar pelo Portal (o Sentinel não renova).`, contaId: s.contaId });
    } else if (cat) {
      contagem.erroApi += 1;
      alertas.push({ nivel: "aviso", codigo: "COLETA_COM_ERRO", mensagem: `${nome(s)}: última coleta com erro (${cat}).`, contaId: s.contaId });
    }
    const up = ultimoPedido.get(s.contaId) ?? null;
    if ((s.situacao === "ok" || s.situacao === "ok_com_erro") && (up === null || agoraMs - up > DIA_MS)) {
      contagem.semPedidosRecentes += 1;
      alertas.push({ nivel: "info", codigo: "SEM_PEDIDOS_RECENTES", mensagem: `${nome(s)}: nenhum pedido nas últimas 24 h (leitura em dia — não é falha).`, contaId: s.contaId });
    }
  }
  if (estadoWorker === "parado") alertas.push({ nivel: "critico", codigo: "WORKER_PARADO", mensagem: `Nenhuma execução do Sentinel há ${Math.round(idadeWorker / 60000)} min.`, contaId: null });
  else if (estadoWorker === "atrasado") alertas.push({ nivel: "aviso", codigo: "WORKER_ATRASADO", mensagem: `Última execução do Sentinel há ${Math.round(idadeWorker / 60000)} min (esperado ≤ ${Math.round((2 * intervaloMs) / 60000)}).`, contaId: null });
  if (porSev.critica) alertas.push({ nivel: "aviso", codigo: "INCIDENTES_CRITICOS", mensagem: `${porSev.critica} incidente(s) crítico(s) em aberto.`, contaId: null });
  const vendas = resumo.cobertura.vendas;
  const naoCalculadas = resumo.cobertura.porConfiabilidade.pendente + resumo.cobertura.porConfiabilidade.inconclusivo;
  if (vendas && naoCalculadas / vendas > 0.2) {
    alertas.push({ nivel: "aviso", codigo: "COBERTURA_BAIXA", mensagem: `${naoCalculadas} de ${vendas} venda(s) sem margem calculável (custo/frete pendente).`, contaId: null });
  }
  if (vendas) alertas.push({ nivel: "info", codigo: "CLAIMS_NAO_VERIFICADAS", mensagem: "Margens são 'calculadas': claims/devoluções não são consultadas pelo Sentinel.", contaId: null });
  const ordem = { critico: 0, aviso: 1, info: 2 };
  alertas.sort((a, b) => ordem[a.nivel] - ordem[b.nivel]);

  const idades = monit.map((s) => s.atrasoSegundos).filter((v) => v !== null && v !== undefined);
  const cps = monit.map((s) => ms(s.checkpoint)).filter((v) => v !== null);
  return {
    worker: { estado: estadoWorker, ultimaExecucaoEm: iso(ultimaExec), idadeSegundos: idadeWorker === null ? null : Math.round(idadeWorker / 1000), intervaloEsperadoSegundos: Math.round(intervaloMs / 1000) },
    contas: contagem,
    checkpointIdadeMaxSegundos: idades.length ? Math.max(...idades) : null,
    ultimaColetaOkEm: iso(cps.length ? Math.max(...cps) : null),
    incidentesAbertosPorSeveridade: porSev,
    cobertura: resumo.cobertura,
    alertas,
    limiteLeituraMin: cfg.leituraLimiteMin,
  };
}

// ─── Vigia (fora do worker) ─────────────────────────────────────────────────
// Se o worker parar, ninguém avaliaria leitura_atrasada. O vigia roda no
// processo do Portal (OPT-IN: SENTINEL_VIGIA_LEITURA_ENABLED=1) e reavalia
// todas as contas com checkpoint. Só escreve em sentinel_incidentes/eventos;
// nunca chama o ML. Sem as tabelas de incidentes, não faz nada.

async function avaliarContasMonitoradas(db, opts = {}) {
  const { incidentesDisponiveis } = require("./sentinelSchema");
  if (!(await incidentesDisponiveis(db))) return { pulado: "sem_tabelas", contas: [] };
  const ids = (await db.query("SELECT cliente_conta_id FROM sentinel_checkpoints ORDER BY cliente_conta_id")).rows.map((r) => r.cliente_conta_id);
  const contas = [];
  for (const id of ids) {
    try {
      contas.push(await avaliarIncidentesConta(db, id, opts));
    } catch (err) {
      contas.push({ contaId: id, erro: String(err?.message || err).slice(0, 300) });
    }
  }
  return { pulado: null, contas };
}

function iniciarVigiaLeitura({ db, intervaloMs, env = process.env } = {}) {
  if (!db) throw new Error("iniciarVigiaLeitura exige `db`.");
  const passo = intervaloMs || numEnv(env, "SENTINEL_VIGIA_INTERVALO_MS", 15 * 60 * 1000);
  let rodando = false;
  const tick = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const r = await avaliarContasMonitoradas(db, { env });
      const erros = r.contas.filter((c) => c.erro);
      if (erros.length) console.error(`[sentinel-vigia] ${erros.length} conta(s) com erro na avaliação: ${erros.map((e) => e.contaId).join(", ")}`);
    } catch (err) {
      console.error(`[sentinel-vigia] falhou: ${err.message}`);
    } finally {
      rodando = false;
    }
  };
  const timer = setInterval(tick, passo);
  if (typeof timer.unref === "function") timer.unref();
  console.log(`[sentinel-vigia] ativo a cada ${Math.round(passo / 1000)}s`);
  return { parar: () => clearInterval(timer), tick };
}

module.exports = {
  sanitizarErro,
  resumoOperacional,
  avaliarContasMonitoradas,
  iniciarVigiaLeitura,
  configIncidentes,
  detectarMargemNegativa,
  detectarCustoPendente,
  detectarLeituraAtrasada,
  avaliarLeitura,
  avaliarIncidentesConta,
  reconhecerIncidente,
  resolverIncidente,
  listarIncidentes,
  obterIncidente,
  contaDoIncidente,
  saudeContas,
  resumoMonitoramento,
};
