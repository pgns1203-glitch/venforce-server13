// server/services/painelContas/painelContasOperacional.js
// Núcleo PURO do Painel de Contas operacional: para UMA competência, resolve
// cada conta/operação do cliente e o consolidado do cliente. Sem query aqui.
//
// ── Escopo (o que o número representa) ─────────────────────────────────────
// CONTA       → o import PUBLICADO da Central de Vendas daquela conta na
//               competência (resumo_json = buildResumoCentralVendas, o MESMO
//               número que a Central mostra ao selecionar a conta).
// CONSOLIDADO → soma auditável das contas. FAT e LC somam; MC = ΣLC ÷ Σbase,
//               onde base é a receita com custo da Central (a mesma definição
//               de buildResumoCentralVendas) ou o FAT no lançamento manual. Se
//               o snapshot mensal (cliente_360_resumos_mensais) foi gerado
//               EXATAMENTE com os imports atuais, ele é usado — é a mesma soma,
//               e ainda carrega a precedência de MC do fechamento oficial.
//
// ── Precedência por conta ──────────────────────────────────────────────────
// import publicado (API) > lançamento manual > nada. Manual existente sob um
// automático continua visível e auditável (substituidoPorAutomatico), nunca
// apagado nem somado.
//
// ── Status ─────────────────────────────────────────────────────────────────
// Só afirma causa com evidência: cadastro da conta (ativa, marketplace,
// external_account_id) e o último sync_run da competência. Sem evidência, o
// texto é "Ainda não sincronizada nesta competência" — nunca "a API falhou".

const { round2, deriveResumo, calcularAcos, asFiniteOrNull } = require("./painelContasMetricas");
const { calcularTacos } = require("../cliente360/cliente360AdsService");

const MARKETPLACES = { meli: "Mercado Livre", shopee: "Shopee" };
const ORDEM_MARKETPLACE = ["meli", "shopee"];
// Só o Mercado Livre tem sincronização automática da Central de Vendas (é o
// contrato de centralVendasSyncRunService.criarSyncRun, não uma escolha daqui).
const MARKETPLACES_COM_SYNC = new Set(["meli"]);
// Causas que pedem ação humana (conectar, lançar, investigar o sync).
const CAUSAS_ACIONAVEIS = new Set(["sem_conexao", "sem_integracao", "erro_sync", "nao_publicado"]);

const ROTULO_STATUS = {
  sincronizado: "Sincronizado",
  manual: "Manual",
  parcial: "Parcial",
  sem_dados: "Sem dados",
  sem_conta: "Sem conta",
  sem_conexao: "Sem conexão",
  sem_integracao: "Sem integração",
  sincronizando: "Sincronizando",
  erro_sync: "Erro de sync",
  nao_publicado: "Não publicado",
  conta_inativa: "Conta inativa",
};

const RESUMO_CAUSA = {
  sem_conexao: "sem conexão",
  sem_integracao: "sem integração",
  erro_sync: "com erro de sync",
  sincronizando: "sincronizando",
  nao_publicado: "sem publicação",
  sem_dados: "não sincronizada",
};

function rotuloMarketplace(marketplace) {
  const mp = String(marketplace || "").toLowerCase();
  return MARKETPLACES[mp] || (mp ? mp[0].toUpperCase() + mp.slice(1) : "Marketplace");
}

// "Squad 8 - Legado" (slug squad-8-legado) é o bucket do rollout de Squads:
// clientes fora da operação atual. Reconhecido pelo slug/nome — não há flag
// própria no cadastro de Squads.
function ehSquadLegado(squad) {
  if (!squad) return false;
  return /(^|[-\s])legado($|[-\s])/i.test(String(squad.slug || "")) || /\blegado\b/i.test(String(squad.nome || ""));
}

function iso(valor) {
  if (!valor) return null;
  return valor instanceof Date ? valor.toISOString() : String(valor);
}

function dia(valor) {
  if (!valor) return null;
  return valor instanceof Date ? valor.toISOString().slice(0, 10) : String(valor).slice(0, 10);
}

function montarResumo({ fat = null, lc = null, mc = null, ads = null, gmvAds = null }) {
  return {
    fat, lc, mc, ads,
    acos: calcularAcos(ads, gmvAds),
    tacos: calcularTacos(ads, fat),
    com: null, atv: null, nps: null,
  };
}

function status(codigo, motivo = null, extra = {}) {
  return { codigo, rotulo: ROTULO_STATUS[codigo] || codigo, motivo, ...extra };
}

function manualView(row, { substituidoPorAutomatico = false } = {}) {
  if (!row) return null;
  const fat = asFiniteOrNull(row.faturamento);
  const ads = asFiniteOrNull(row.investimento_ads);
  return {
    id: Number(row.id),
    valores: montarResumo({
      fat,
      lc: asFiniteOrNull(row.lucro_contribuicao),
      mc: asFiniteOrNull(row.margem_contribuicao),
      ads,
      gmvAds: asFiniteOrNull(row.gmv_ads),
    }),
    gmvAds: asFiniteOrNull(row.gmv_ads),
    observacao: row.observacao || null,
    criadoEm: iso(row.created_at),
    atualizadoEm: iso(row.updated_at),
    atualizadoPor: row.updated_by_nome || null,
    atualizadoPorId: row.updated_by != null ? Number(row.updated_by) : null,
    substituidoPorAutomatico,
  };
}

function ordenarContas(rows) {
  const pos = (mp) => {
    const i = ORDEM_MARKETPLACE.indexOf(String(mp || "").toLowerCase());
    return i === -1 ? ORDEM_MARKETPLACE.length : i;
  };
  return [...rows].sort((a, b) => {
    if (pos(a.marketplace) !== pos(b.marketplace)) return pos(a.marketplace) - pos(b.marketplace);
    if (String(a.marketplace) !== String(b.marketplace)) return String(a.marketplace).localeCompare(String(b.marketplace));
    if (!!a.is_primary !== !!b.is_primary) return a.is_primary ? -1 : 1;
    return Number(a.id) - Number(b.id);
  });
}

function statusSemDado(row, run) {
  const mp = String(row.marketplace || "").toLowerCase();
  if (!MARKETPLACES_COM_SYNC.has(mp)) return status("sem_integracao", "Marketplace sem integração automática");
  if (!String(row.external_account_id || "").trim()) return status("sem_conexao", `${rotuloMarketplace(mp)} não conectado`);
  if (run?.status === "queued" || run?.status === "running") return status("sincronizando", "Sincronização em andamento");
  if (run?.status === "failed") {
    const codigo = run.error_code || null;
    return status("erro_sync", `Última sincronização falhou${codigo ? ` (${codigo})` : ""}`, { erroCodigo: codigo, em: iso(run.created_at) });
  }
  if (run?.status === "completed") return status("nao_publicado", "Última sincronização terminou sem publicar dados", { em: iso(run.created_at) });
  return status("sem_dados", "Ainda não sincronizada nesta competência");
}

/**
 * @param {Array} rows  cliente_contas do cliente
 * @param {{importPorConta:Map, manualPorConta:Map, runPorConta:Map}} fontes
 */
function resolverContas(rows, { importPorConta = new Map(), manualPorConta = new Map(), runPorConta = new Map() } = {}) {
  const ordinais = new Map();
  return ordenarContas(rows || []).map((row) => {
    const id = Number(row.id);
    const mp = String(row.marketplace || "").toLowerCase();
    const ordinal = (ordinais.get(mp) || 0) + 1;
    ordinais.set(mp, ordinal);
    const base = {
      id,
      nome: row.nome || null,
      slug: row.slug || null,
      marketplace: mp,
      marketplaceRotulo: rotuloMarketplace(mp),
      rotulo: `${rotuloMarketplace(mp)} ${ordinal}${row.nome ? ` · ${row.nome}` : ""}`,
      ativa: row.ativo !== false,
      conectada: Boolean(String(row.external_account_id || "").trim()),
      principal: row.is_primary === true,
      avisos: [],
      resumo: null,
      baseMc: null,
      fonte: null,
      atualizadoEm: null,
      dadosAte: null,
      importId: null,
      manual: null,
      podeLancarManual: false,
    };

    const man = manualPorConta.get(id) || null;
    if (!base.ativa) {
      return { ...base, status: status("conta_inativa", "Conta inativa — fora do consolidado"), manual: manualView(man) };
    }

    const imp = importPorConta.get(id) || null;
    const run = runPorConta.get(id) || null;

    if (imp) {
      const fat = asFiniteOrNull(imp.faturamento);
      const mcPct = asFiniteOrNull(imp.margem_contribuicao_percentual);
      const avisos = [];
      if (imp.completeness_status && imp.completeness_status !== "complete") {
        avisos.push(`Completude parcial (${imp.completeness_status}) na última publicação`);
      }
      const publicadoEm = imp.published_at ? new Date(imp.published_at).getTime() : 0;
      if (run?.status === "failed" && new Date(run.created_at).getTime() > publicadoEm) {
        avisos.push(`Última sincronização falhou${run.error_code ? ` (${run.error_code})` : ""}; exibindo a última publicação`);
      }
      return {
        ...base,
        status: status("sincronizado"),
        avisos,
        // Ads é medido por cliente (ads_resumos_mensais, loja "todas"): não
        // existe investimento por conta — null, nunca rateio.
        resumo: montarResumo({ fat, lc: asFiniteOrNull(imp.lucro_contribuicao), mc: mcPct === null ? null : mcPct / 100 }),
        baseMc: asFiniteOrNull(imp.faturamento_com_custo),
        fonte: { tipo: "api", rotulo: imp.publication_status === "legacy" ? "Planilha (Central)" : "API" },
        atualizadoEm: iso(imp.published_at || imp.created_at),
        dadosAte: dia(imp.coverage_date_to),
        importId: Number(imp.id),
        manual: manualView(man, { substituidoPorAutomatico: true }),
      };
    }

    if (man) {
      const view = manualView(man);
      return {
        ...base,
        status: status("manual", "Lançado manualmente"),
        resumo: view.valores,
        baseMc: view.valores.fat,
        fonte: { tipo: "manual", rotulo: "Manual" },
        atualizadoEm: view.atualizadoEm,
        manual: view,
        gmvAds: view.gmvAds,
        podeLancarManual: true,
      };
    }

    return { ...base, status: statusSemDado(row, run), podeLancarManual: true };
  });
}

function somar(valores) {
  const conhecidos = valores.filter((v) => v !== null && v !== undefined);
  return conhecidos.length ? round2(conhecidos.reduce((s, v) => s + Number(v), 0)) : null;
}

function mesmoConjunto(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const x = [...a].map(Number).sort((p, q) => p - q);
  const y = [...b].map(Number).sort((p, q) => p - q);
  return x.every((v, i) => v === y[i]);
}

function motivoSemDados(operacionais) {
  if (operacionais.length === 1) return operacionais[0].status.motivo;
  const contagem = new Map();
  for (const c of operacionais) contagem.set(c.status.codigo, (contagem.get(c.status.codigo) || 0) + 1);
  const partes = [...contagem.entries()].map(([codigo, n]) => `${n} ${RESUMO_CAUSA[codigo] || codigo}`);
  return `${operacionais.length} contas sem dados: ${partes.join(", ")}`;
}

/**
 * @param {object} p
 * @param {Array} p.contas       saída de resolverContas
 * @param {object|null} p.snapshot  linha mapeada de cliente_360_resumos_mensais DA competência
 * @param {object|null} p.adsCliente  {investimentoAds, gmvAds, atualizadoEm} de ads_resumos_mensais
 */
function consolidarCliente({ contas = [], snapshot = null, adsCliente = null }) {
  const operacionais = contas.filter((c) => c.ativa);
  const comDado = operacionais.filter((c) => c.resumo && c.resumo.fat !== null);
  const n = operacionais.length;
  const k = comDado.length;
  const precisaAtencaoContas = operacionais.some((c) => CAUSAS_ACIONAVEIS.has(c.status.codigo));

  let escopo;
  if (n === 0) escopo = { tipo: "nenhum", rotulo: "Nenhuma conta ativa" };
  else if (n === 1) escopo = { tipo: "conta", rotulo: operacionais[0].rotulo };
  else escopo = { tipo: "consolidado", rotulo: k > 0 && k < n ? `Consolidado · ${k} de ${n} contas` : `Consolidado · ${n} contas` };
  escopo = { ...escopo, contasOperacionais: n, contasComDado: k };

  const vazio = {
    resumo: null, fonte: null, atualizadoEm: null, dadosAte: null, origem: null,
  };

  // Nenhuma conta com dado: o snapshot do cliente (fluxo manual do Cliente 360
  // ou snapshot sem detalhamento) ainda é dado DA competência — mostrado com
  // escopo "cliente" para ninguém confundi-lo com a soma das contas.
  if (k === 0) {
    if (snapshot) {
      return {
        escopo: { ...escopo, tipo: "cliente", rotulo: "Cliente · sem detalhamento por conta" },
        status: status("sincronizado", "Snapshot do cliente sem detalhamento por conta", { precisaAtencao: false }),
        resumo: deriveResumo(snapshot),
        fonte: { tipo: "api", rotulo: "API (snapshot do cliente)" },
        atualizadoEm: snapshot.sincronizadoEm || null,
        dadosAte: snapshot.centralDadosAte || null,
        origem: "snapshot_cliente",
      };
    }
    if (n === 0) {
      return { ...vazio, escopo, status: status("sem_conta", "Nenhuma conta/operação ativa cadastrada", { precisaAtencao: true }) };
    }
    return { ...vazio, escopo, status: status("sem_dados", motivoSemDados(operacionais), { precisaAtencao: precisaAtencaoContas }) };
  }

  const temManual = comDado.some((c) => c.fonte?.tipo === "manual");
  const temApi = comDado.some((c) => c.fonte?.tipo === "api");
  const fonte = temManual && temApi
    ? { tipo: "misto", rotulo: "API + manual" }
    : temManual ? { tipo: "manual", rotulo: "Manual" } : { tipo: "api", rotulo: "API" };

  const statusCliente = k < n
    ? status("parcial", `${k} de ${n} contas com dados`, { precisaAtencao: precisaAtencaoContas })
    : temManual ? status("manual", null, { precisaAtencao: false }) : status("sincronizado", null, { precisaAtencao: false });

  const datasAte = comDado.map((c) => c.dadosAte).filter(Boolean).sort();
  const atualizacoes = comDado.map((c) => c.atualizadoEm).filter(Boolean).sort();

  // Snapshot gerado exatamente com os imports vigentes: é a mesma soma, com a
  // precedência de MC do fechamento e o Ads daquela versão.
  const snapshotCasa = snapshot && k === n && !temManual
    && mesmoConjunto(snapshot.centralImportIds, comDado.map((c) => c.importId));
  if (snapshotCasa) {
    return {
      escopo,
      status: statusCliente,
      resumo: deriveResumo(snapshot),
      fonte: snapshot.mcFonte === "fechamento_oficial" ? { tipo: "api", rotulo: "API · MC do fechamento oficial" } : fonte,
      atualizadoEm: snapshot.sincronizadoEm || atualizacoes[atualizacoes.length - 1] || null,
      dadosAte: snapshot.centralDadosAte || datasAte[0] || null,
      origem: "snapshot",
    };
  }

  const fat = somar(comDado.map((c) => c.resumo.fat));
  const comLc = comDado.filter((c) => c.resumo.lc !== null);
  const lc = somar(comLc.map((c) => c.resumo.lc));
  const base = comLc.reduce((s, c) => s + (Number(c.baseMc) || 0), 0);
  const mc = lc !== null && base > 0 ? round2((lc / base) * 100) / 100 : null;

  // Ads: o resumo mensal de Ads do cliente (automático) vence; sem ele, a soma
  // dos lançamentos manuais das contas. Nunca misturar os dois.
  let ads = null;
  let gmvAds = null;
  if (adsCliente) {
    ads = asFiniteOrNull(adsCliente.investimentoAds);
    gmvAds = asFiniteOrNull(adsCliente.gmvAds);
  } else {
    const manuais = comDado.filter((c) => c.fonte?.tipo === "manual");
    ads = somar(manuais.map((c) => c.resumo.ads));
    gmvAds = somar(manuais.map((c) => c.gmvAds ?? null));
  }

  return {
    escopo,
    status: statusCliente,
    resumo: montarResumo({ fat, lc, mc, ads, gmvAds }),
    fonte,
    atualizadoEm: atualizacoes[atualizacoes.length - 1] || null,
    dadosAte: datasAte[0] || null,
    origem: "contas",
  };
}

module.exports = {
  resolverContas,
  consolidarCliente,
  ehSquadLegado,
  rotuloMarketplace,
  montarResumo,
  MARKETPLACES_COM_SYNC,
  CAUSAS_ACIONAVEIS,
};
