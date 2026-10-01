// server/tests/painelContasOperacionalService.test.js
//
// Contrato do Painel de Contas OPERACIONAL (painelContasService) sem Postgres:
// um modelo em memória responde às queries marcadas /* authz:... */,
// /* squads:... */ e /* painelContas:... */.
//
//   A  competência exata: snapshots de jun e ago, tela em set → SEM DADOS
//   B  multiconta (caso AMR): consolidado + contas separadas
//   C  consolidado parcial: 2 de 3 contas
//   D  Squad 8 · Legado fora por padrão; volta com mostrarLegado=true
//   E  manual sem automático → valor com fonte MANUAL
//   F  automático vence manual; manual continua registrado
//   G  filtros (competência/squad/status/marketplace/busca/legado) nunca furam a carteira
//   I  query param nunca alcança cliente/conta fora da carteira (lista e escrita)
//   J  seções por marketplace (ML / Shopee / TikTok Shop)
//   K  competências independentes + rastreabilidade do lançamento
//   L  acesso por Squad no Painel: admin · coordenador · gestor · demais
//      (independente de SQUADS_ENFORCEMENT; escrita = interseção)
//   -  performance: número FIXO de queries, independente do nº de clientes

process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/teste-sem-banco";
process.env.SQUADS_ENFORCEMENT = "on";

const assert = require("assert");
const pool = require("../config/database");

let checks = 0;
let concluido = false;
process.on("exit", () => {
  if (!concluido) {
    console.error(`painelContasOperacionalService.test.js: NÃO concluiu (parou após ${checks} verificações)`);
    process.exitCode = 1;
  }
});
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label} — recebido ${JSON.stringify(actual)}`);
  checks += 1;
}
async function rejeita(label, promise, statusCode, code) {
  let erro = null;
  try { await promise; } catch (e) { erro = e; }
  ok(`${label} (rejeitou)`, erro !== null);
  ok(`${label} (${statusCode}${code ? ` ${code}` : ""}) — recebido ${erro?.statusCode} ${erro?.code}`, erro && erro.statusCode === statusCode && (!code || erro.code === code));
}

// ─────────────────────────── modelo em memória ───────────────────────────

function importRow(id, contaId, competencia, { fat, lc, fatComCusto = fat, status = "published", de = `${competencia}-01`, ate = `${competencia}-28`, publicado = `${competencia}-29T06:00:00.000Z` }) {
  return {
    id, cliente_conta_id: contaId, competencia, publication_status: status,
    coverage_date_from: de, coverage_date_to: ate, published_at: status === "published" ? publicado : null,
    created_at: publicado, sync_run_id: id + 1000,
    faturamento: fat, faturamento_com_custo: fatComCusto, lucro_contribuicao: lc,
    margem_contribuicao_percentual: lc !== null && fatComCusto > 0 ? Math.round((lc / fatComCusto) * 10000) / 100 : null,
    completeness_status: "complete",
  };
}

function novoModelo() {
  return {
    clientes: [
      { id: 1, slug: "amr-ecommerce", nome: "AMR ecommerce", ativo: true },
      { id: 2, slug: "red-fish", nome: "Red Fish", ativo: true },
      { id: 3, slug: "coremix", nome: "Coremix Loja", ativo: true },
      { id: 4, slug: "carpei", nome: "Carpei", ativo: true },
      { id: 5, slug: "velho-legado", nome: "Velho Legado", ativo: true },
      { id: 6, slug: "fora-da-carteira", nome: "Fora da Carteira", ativo: true },
    ],
    squads: [
      { id: 10, nome: "Squad 6", slug: "squad-6", ativo: true },
      { id: 20, nome: "Squad 2", slug: "squad-2", ativo: true },
      { id: 80, nome: "Squad 8 - Legado", slug: "squad-8-legado", ativo: true },
    ],
    // Ana coordena o Squad 6 e o legado; Beto coordena o Squad 2. Carla e
    // Dani são membros comuns do Squad 2 (sem coordenação).
    members: [
      { squad_id: 10, user_id: 100, is_primary: true, funcao: "coordenador", ativo: true },
      { squad_id: 80, user_id: 100, is_primary: false, funcao: "coordenador", ativo: true },
      { squad_id: 20, user_id: 200, is_primary: true, funcao: "coordenador", ativo: true },
      { squad_id: 20, user_id: 400, is_primary: true, funcao: "membro", ativo: true },
      { squad_id: 20, user_id: 500, is_primary: true, funcao: "membro", ativo: true },
    ],
    // Responsabilidades por cliente (cliente_responsaveis). Começa vazio,
    // como em produção; o bloco L cria os vínculos.
    responsaveis: [],
    history: [
      { cliente_id: 1, squad_id: 10, fim_em: null },
      { cliente_id: 2, squad_id: 10, fim_em: null },
      { cliente_id: 3, squad_id: 10, fim_em: null },
      { cliente_id: 4, squad_id: 10, fim_em: null },
      { cliente_id: 5, squad_id: 80, fim_em: null },
      { cliente_id: 6, squad_id: 20, fim_em: null },
    ],
    contas: [
      // AMR: 3 contas ML (caso real que parecia faturamento errado)
      { id: 11, cliente_id: 1, marketplace: "meli", nome: "AMARO SOLUÇÕES", slug: "amr-1", external_account_id: "ML11", is_primary: true, ativo: true },
      { id: 12, cliente_id: 1, marketplace: "meli", nome: "AMR 2", slug: "amr-2", external_account_id: "ML12", is_primary: false, ativo: true },
      { id: 13, cliente_id: 1, marketplace: "meli", nome: "AMR 3", slug: "amr-3", external_account_id: "ML13", is_primary: false, ativo: true },
      // Red Fish: 1 conta ML, snapshots antigos (jun/ago) mas nada em set
      { id: 21, cliente_id: 2, marketplace: "meli", nome: "RED FISH", slug: "red-1", external_account_id: "ML21", is_primary: true, ativo: true },
      // Coremix: Shopee (sem integração automática)
      { id: 31, cliente_id: 3, marketplace: "shopee", nome: "COREMIX SHOP", slug: "core-1", external_account_id: null, is_primary: true, ativo: true },
      // Carpei: ML não conectado
      { id: 41, cliente_id: 4, marketplace: "meli", nome: "CARPEI", slug: "carpei-1", external_account_id: null, is_primary: true, ativo: true },
      { id: 51, cliente_id: 5, marketplace: "meli", nome: "LEGADO", slug: "leg-1", external_account_id: "ML51", is_primary: true, ativo: true },
      { id: 61, cliente_id: 6, marketplace: "meli", nome: "OUTRO", slug: "out-1", external_account_id: "ML61", is_primary: true, ativo: true },
    ],
    resumos: [
      { cliente_id: 2, competencia: "2026-06", faturamento: 90000, mc_media: 0.2, ads_investido: null, payload_json: {}, sincronizado_em: "2026-07-01T00:00:00.000Z" },
      { cliente_id: 2, competencia: "2026-08", faturamento: 95000, mc_media: 0.21, ads_investido: null, payload_json: {}, sincronizado_em: "2026-09-01T00:00:00.000Z" },
    ],
    imports: [
      importRow(1101, 11, "2026-09", { fat: 2833602, lc: 425040 }),
      importRow(1201, 12, "2026-09", { fat: 800000, lc: 120000 }),
      importRow(1301, 13, "2026-09", { fat: 420512, lc: 63000 }),
      importRow(5101, 51, "2026-09", { fat: 1000, lc: 100 }),
      importRow(6101, 61, "2026-09", { fat: 7777, lc: 777 }),
    ],
    runs: [],
    ads: [
      { cliente_slug: "amr-ecommerce", mes_ref: "2026-09", loja_campanha: "todas", investimento_ads: 120000, gmv_ads: 900000, updated_at: "2026-09-29T07:00:00.000Z" },
    ],
    manuais: [],
    historico: [],
    users: [{ id: 100, nome: "Ana" }, { id: 200, nome: "Beto" }, { id: 1, nome: "Admin" }, { id: 400, nome: "Carla" }, { id: 500, nome: "Dani" }],
  };
}

function portfolioInterno(m, userId) {
  const squadsDoUser = new Set(m.members.filter((x) => x.user_id === userId && x.ativo).map((x) => x.squad_id));
  return m.clientes
    .filter((c) => c.ativo && m.history.some((h) => h.cliente_id === c.id && h.fim_em === null && squadsDoUser.has(h.squad_id)))
    .map(({ id, slug, nome }) => ({ id, slug, nome }));
}

// Espelho em memória das queries de painelContasAcesso.
function coordenadosDe(m, userId) {
  return m.members.filter((x) => x.user_id === userId && x.ativo && x.funcao === "coordenador"
    && m.squads.some((sq) => sq.id === x.squad_id && sq.ativo)).map((x) => x.squad_id);
}
function clientesPainel(m, userId) {
  const sqs = new Set(coordenadosDe(m, userId));
  const porSquad = m.clientes.filter((c) => c.ativo && m.history.some((h) => h.cliente_id === c.id && h.fim_em === null && sqs.has(h.squad_id)));
  const porGestor = m.clientes.filter((c) => c.ativo && m.responsaveis.some((r) => r.cliente_id === c.id && r.user_id === userId && r.ativo && r.papel === "gestor"));
  return { porSquad, porGestor };
}

function nomeDe(m, userId) {
  return (m.users.find((u) => u.id === userId) || {}).nome || null;
}

function instalarMock(m) {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const contagem = { total: 0, porTag: new Map() };
  const contar = (tag) => { contagem.total += 1; contagem.porTag.set(tag, (contagem.porTag.get(tag) || 0) + 1); };

  async function query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();
    if (q.includes("CREATE TABLE IF NOT EXISTS painel_contas_lancamentos_manuais")) { contar("ensure:painel"); return { rows: [] }; }
    // DDL dos ensures (Squads roda arquivos de migration, que começam com comentário).
    if (/^(--|CREATE|ALTER|DROP|BEGIN|COMMIT|ROLLBACK|DO )/i.test(q) || q.includes("pg_advisory")) return { rows: [] };

    if (q.includes("painelAcesso:ADMIN_TODOS")) { contar("authz"); return { rows: m.clientes.filter((c) => c.ativo).map(({ id, slug, nome }) => ({ id, slug, nome })) }; }
    if (q.includes("painelAcesso:SQUADS_COORDENADOS")) {
      contar("authz");
      return { rows: coordenadosDe(m, params[0]).map((id) => m.squads.find((sq) => sq.id === id)).map(({ id, nome, slug }) => ({ id, nome, slug })) };
    }
    if (q.includes("painelAcesso:CLIENTES_COORDENADOS")) { contar("authz"); return { rows: clientesPainel(m, params[0]).porSquad.map(({ id, slug, nome }) => ({ id, slug, nome })) }; }
    if (q.includes("painelAcesso:CLIENTES_GESTOR")) { contar("authz"); return { rows: clientesPainel(m, params[0]).porGestor.map(({ id, slug, nome }) => ({ id, slug, nome })) }; }
    if (q.includes("painelAcesso:PODE_VER_CLIENTE")) {
      contar("authz");
      const { porSquad, porGestor } = clientesPainel(m, params[0]);
      return { rows: [...porSquad, ...porGestor].some((c) => c.id === Number(params[1])) ? [{ x: 1 }] : [] };
    }
    if (q.includes("authz:PORTFOLIO_INTERNAL_ENFORCEMENT_OFF")) { contar("authz"); return { rows: m.clientes.filter((c) => c.ativo).map(({ id, slug, nome }) => ({ id, slug, nome })) }; }
    if (q.includes("authz:CAN_ACCESS_ENFORCEMENT_OFF")) { contar("authz"); return { rows: m.clientes.some((c) => c.id === Number(params[0])) ? [{ x: 1 }] : [] }; }
    if (q.includes("authz:PORTFOLIO_ADMIN_ALL")) { contar("authz"); return { rows: m.clientes.filter((c) => c.ativo).map(({ id, slug, nome }) => ({ id, slug, nome })) }; }
    if (q.includes("authz:PORTFOLIO_SELLER")) { contar("authz"); return { rows: [] }; }
    if (q.includes("authz:PORTFOLIO_INTERNAL_BY_SQUAD")) { contar("authz"); return { rows: portfolioInterno(m, params[0]) }; }
    if (q.includes("authz:CAN_ACCESS_ADMIN")) { contar("authz"); return { rows: m.clientes.some((c) => c.id === Number(params[0])) ? [{ x: 1 }] : [] }; }
    if (q.includes("authz:CAN_ACCESS_INTERNAL")) { contar("authz"); return { rows: portfolioInterno(m, params[0]).some((c) => c.id === Number(params[1])) ? [{ x: 1 }] : [] }; }
    if (q.includes("authz:RESOLVE_CLIENTE_ID")) { contar("authz"); return { rows: m.clientes.filter((c) => c.id === Number(params[0])) }; }
    if (q.includes("authz:RESOLVE_CLIENTE_SLUG")) { contar("authz"); return { rows: m.clientes.filter((c) => c.slug === params[0]) }; }

    if (q.includes("squads:MEMBERSHIPS_DO_USUARIO")) {
      contar("squads");
      return {
        rows: m.members.filter((x) => x.user_id === params[0] && x.ativo).map((x) => {
          const s = m.squads.find((y) => y.id === x.squad_id);
          return { squad_id: s.id, is_primary: x.is_primary, funcao: x.funcao, squad_nome: s.nome, squad_slug: s.slug, squad_ativo: s.ativo };
        }),
      };
    }
    if (q.includes("squads:SQUADS_ATIVOS_DE_CLIENTES")) {
      contar("squads");
      return {
        rows: (params[0] || []).map((cid) => {
          const h = m.history.find((x) => x.cliente_id === cid && x.fim_em === null);
          if (!h) return null;
          const s = m.squads.find((y) => y.id === h.squad_id);
          return { cliente_id: cid, squad_id: s.id, squad_nome: s.nome, squad_slug: s.slug, squad_ativo: s.ativo };
        }).filter(Boolean),
      };
    }

    const ids = Array.isArray(params[0]) ? params[0].map(Number) : [];
    if (q.includes("painelContas:RESUMO_DA_COMPETENCIA")) {
      contar("painel:resumo");
      return {
        rows: m.resumos.filter((r) => ids.includes(r.cliente_id) && r.competencia === params[1]).map((r) => ({
          ...r, cliente_slug: m.clientes.find((c) => c.id === r.cliente_id).slug,
        })),
      };
    }
    if (q.includes("painelContas:ULTIMA_COMPETENCIA")) {
      contar("painel:ultima");
      const out = new Map();
      for (const r of m.resumos) if (ids.includes(r.cliente_id) && (!out.has(r.cliente_id) || r.competencia > out.get(r.cliente_id))) out.set(r.cliente_id, r.competencia);
      return { rows: [...out.entries()].map(([cliente_id, competencia]) => ({ cliente_id, competencia })) };
    }
    if (q.includes("painelContas:RESUMOS_DO_ANO")) {
      contar("painel:resumosAno");
      return { rows: m.resumos.filter((r) => r.cliente_id === params[0] && String(r.competencia).startsWith(String(params[1]).slice(0, 4))) };
    }
    if (q.includes("painelContas:CONTAS_DOS_CLIENTES")) { contar("painel:contas"); return { rows: m.contas.filter((c) => ids.includes(c.cliente_id)) }; }
    if (q.includes("painelContas:IMPORTS_DA_COMPETENCIA")) { contar("painel:imports"); return { rows: m.imports.filter((i) => ids.includes(i.cliente_conta_id) && i.competencia === params[1]) }; }
    if (q.includes("painelContas:ULTIMO_RUN_POR_CONTA")) { contar("painel:runs"); return { rows: m.runs.filter((r) => ids.includes(r.cliente_conta_id)) }; }
    if (q.includes("painelContas:ADS_DA_COMPETENCIA")) { contar("painel:ads"); return { rows: m.ads.filter((a) => params[0].includes(a.cliente_slug) && a.mes_ref === params[1]) }; }
    if (q.includes("painelContas:MANUAIS_DA_COMPETENCIA")) {
      contar("painel:manuais");
      return {
        rows: m.manuais.filter((x) => ids.includes(x.cliente_conta_id) && x.competencia === params[1])
          .map((x) => ({ ...x, updated_by_nome: nomeDe(m, x.updated_by), created_by_nome: nomeDe(m, x.created_by) })),
      };
    }
    if (q.includes("painelContas:MANUAIS_DA_CONTA")) {
      contar("painel:manuaisConta");
      return {
        rows: m.manuais.filter((x) => x.cliente_conta_id === params[0] && x.cliente_id === params[1])
          .sort((a, b) => b.competencia.localeCompare(a.competencia))
          .map((x) => ({ ...x, updated_by_nome: nomeDe(m, x.updated_by), created_by_nome: nomeDe(m, x.created_by) })),
      };
    }
    if (q.includes("painelContas:HISTORICO_DA_CONTA")) {
      contar("painel:historicoConta");
      return {
        rows: m.historico.filter((h) => h.conta === params[0] && h.cliente_id === params[1] && h.competencia === params[2])
          .map((h) => ({ ...h, valores_json: h.valores, user_nome: nomeDe(m, h.user_id) }))
          .reverse(),
      };
    }
    if (q.includes("painelContas:CONTA_DO_CLIENTE")) {
      contar("painel:conta");
      return { rows: m.contas.filter((c) => c.id === Number(params[0]) && c.cliente_id === Number(params[1])) };
    }
    if (q.includes("painelContas:UPSERT_MANUAL")) {
      contar("painel:upsert");
      const [clienteId, contaId, competencia, fat, lc, mc, ads, gmv, obs, uid, dataRef] = params;
      let row = m.manuais.find((x) => x.cliente_conta_id === contaId && x.competencia === competencia);
      const inserido = !row;
      if (!row) {
        row = { id: m.manuais.length + 1, cliente_id: clienteId, cliente_conta_id: contaId, competencia, created_by: uid, created_at: "2026-09-29T12:00:00.000Z" };
        m.manuais.push(row);
      }
      Object.assign(row, { faturamento: fat, lucro_contribuicao: lc, margem_contribuicao: mc, investimento_ads: ads, gmv_ads: gmv, observacao: obs, data_referencia: dataRef, updated_by: uid, updated_at: "2026-09-29T12:00:00.000Z" });
      return { rows: [{ ...row, inserido }] };
    }
    if (q.includes("painelContas:DELETE_MANUAL")) {
      contar("painel:delete");
      const idx = m.manuais.findIndex((x) => x.cliente_conta_id === params[0] && x.competencia === params[1] && x.cliente_id === params[2]);
      if (idx === -1) return { rows: [] };
      const [row] = m.manuais.splice(idx, 1);
      return { rows: [row] };
    }
    if (q.includes("painelContas:HISTORICO_MANUAL")) {
      contar("painel:historico");
      const removido = q.includes("'removido'");
      m.historico.push({
        id: m.historico.length + 1, created_at: `2026-09-29T12:00:${String(m.historico.length).padStart(2, "0")}.000Z`,
        lancamento_id: params[0], cliente_id: params[1], conta: params[2], competencia: params[3],
        acao: removido ? "removido" : params[4],
        valores: JSON.parse(removido ? params[4] : params[5]),
        user_id: removido ? params[5] : params[6],
      });
      return { rows: [] };
    }

    throw new Error(`SQL inesperado no teste: ${q.slice(0, 100)}`);
  }

  pool.query = (sql, params) => query(sql, params);
  pool.connect = async () => ({ query: (sql, params) => query(sql, params), release() {} });
  return { restaurar: () => { pool.query = originalQuery; pool.connect = originalConnect; }, contagem };
}

const service = require("../services/painelContas/painelContasService");

const U = {
  ana: { id: 100, role: "membro" },   // coordena Squad 6 + Squad 8 (legado)
  beto: { id: 200, role: "membro" },  // coordena Squad 2
  carla: { id: 400, role: "user" },   // membro comum do Squad 2
  dani: { id: 500, role: "membro" },  // membro comum do Squad 2
  admin: { id: 1, role: "admin" },
  seller: { id: 300, role: "seller" },
};
const SET = "2026-09";

async function run() {
  const m = novoModelo();
  const { restaurar, contagem } = instalarMock(m);
  try {
    // =======================================================================
    // A — competência exata
    // =======================================================================
    const lista = await service.listar(U.ana, { competencia: SET });
    eq("A: resposta declara a competência", lista.competencia, SET);
    const red = lista.clientes.find((c) => c.slug === "red-fish");
    eq("A: Red Fish em set/2026 = sem dados (NÃO agosto)", [red.status.codigo, red.resumo], ["sem_dados", null]);
    eq("A: último dado disponível só como informação explícita", red.ultimaCompetenciaComDado, "2026-08");
    ok("A: nenhuma competência diferente de set aparece como dado da linha", lista.clientes.every((c) => c.competencia === SET));
    const redAgo = (await service.listar(U.ana, { competencia: "2026-08" })).clientes.find((c) => c.slug === "red-fish");
    eq("A: trocando para ago/2026, o dado de ago aparece", redAgo.resumo.fat, 95000);
    await rejeita("A: competência inválida → 400", service.listar(U.ana, { competencia: "2026-13" }), 400);
    const padrao = await service.listar(U.ana, {}, { agora: new Date("2026-09-30T23:30:00-03:00") });
    eq("A: sem competência → mês corrente em America/Sao_Paulo", padrao.competencia, "2026-09");
    const virada = await service.listar(U.ana, {}, { agora: new Date("2026-10-01T02:30:00Z") });
    eq("A: 01/10 02:30 UTC ainda é 30/09 em São Paulo", virada.competencia, "2026-09");

    // =======================================================================
    // B — AMR: consolidado + contas
    // =======================================================================
    const amr = lista.clientes.find((c) => c.slug === "amr-ecommerce");
    eq("B: consolidado = soma das 3 contas", amr.resumo.fat, 2833602 + 800000 + 420512);
    eq("B: escopo explícito", amr.escopo.rotulo, "Consolidado · 3 contas");
    eq("B: expansão mostra cada conta com seu FAT", amr.contas.map((c) => [c.rotulo, c.resumo.fat]), [
      ["Mercado Livre 1 · AMARO SOLUÇÕES", 2833602],
      ["Mercado Livre 2 · AMR 2", 800000],
      ["Mercado Livre 3 · AMR 3", 420512],
    ]);
    eq("B: Ads do cliente no consolidado", amr.resumo.ads, 120000);
    ok("B: Ads não é rateado por conta", amr.contas.every((c) => c.resumo.ads === null));
    eq("B: status sincronizado, fonte API", [amr.status.codigo, amr.fonte.tipo], ["sincronizado", "api"]);

    // =======================================================================
    // C — 2 de 3 contas
    // =======================================================================
    const importConta13 = m.imports.find((i) => i.cliente_conta_id === 13);
    m.imports = m.imports.filter((i) => i !== importConta13);
    m.runs.push({ id: 9, cliente_conta_id: 13, status: "failed", error_code: "ML_GRANT_REVOKED", created_at: "2026-09-29T06:00:00.000Z" });
    const amrParcial = (await service.listar(U.ana, { competencia: SET })).clientes.find((c) => c.slug === "amr-ecommerce");
    eq("C: parcial, 2 de 3", [amrParcial.status.codigo, amrParcial.status.motivo], ["parcial", "2 de 3 contas com dados"]);
    eq("C: consolidado soma só as 2 contas com dado", amrParcial.resumo.fat, 2833602 + 800000);
    const c3 = amrParcial.contas.find((c) => c.id === 13);
    eq("C: conta 3 sem valor inventado, com a causa evidenciada", [c3.resumo, c3.status.codigo, c3.status.erroCodigo], [null, "erro_sync", "ML_GRANT_REVOKED"]);
    ok("C: parcial com causa acionável precisa de atenção", amrParcial.status.precisaAtencao === true);
    m.imports.push(importConta13);
    m.runs = [];

    // Causas distintas para "sem dados"
    const core = lista.clientes.find((c) => c.slug === "coremix");
    const carpei = lista.clientes.find((c) => c.slug === "carpei");
    eq("Coremix: Shopee sem integração automática", [core.status.codigo, core.status.motivo], ["sem_dados", "Marketplace sem integração automática"]);
    eq("Carpei: Mercado Livre não conectado", carpei.status.motivo, "Mercado Livre não conectado");
    ok("Coremix: pode lançar dados", core.podeLancarManual === true);

    // =======================================================================
    // D — Legado
    // =======================================================================
    ok("D: legado fora da lista por padrão", !lista.clientes.some((c) => c.slug === "velho-legado"));
    eq("D: legado fora das contagens, mas informado", [lista.resumoCarteira.operacionais, lista.resumoCarteira.legadoOcultos], [4, 1]);
    ok("D: squad legado fora das opções de squad por padrão", !lista.squadsDisponiveis.some((s) => s.slug === "squad-8-legado"));
    const comLegado = await service.listar(U.ana, { competencia: SET, mostrarLegado: "true" });
    const leg = comLegado.clientes.find((c) => c.slug === "velho-legado");
    ok("D: mostrarLegado=true traz o cliente marcado como legado", leg && leg.legado === true);
    eq("D: com legado, entra na contagem", comLegado.resumoCarteira.operacionais, 5);

    // =======================================================================
    // Resumo da carteira
    // =======================================================================
    eq("resumo: com dados / sem dados / parciais / manuais / atenção", lista.resumoCarteira, {
      operacionais: 4, comDados: 1, semDados: 3, parciais: 0, manuais: 0, automaticos: 1, atencao: 2, legadoOcultos: 1,
    });

    // =======================================================================
    // E — manual sem automático
    // =======================================================================
    const salvo = await service.salvarLancamentoManual(U.ana, "3", "31", SET, {
      faturamento: 50000, lucroContribuicao: 7500, investimentoAds: 2000, gmvAds: 10000, observacao: "planilha Shopee",
    });
    ok("E: salvar devolve a conta com fonte manual", salvo.conta.fonte.tipo === "manual" && salvo.conta.resumo.fat === 50000);
    ok("E: MC derivado de LC/FAT", Math.abs(salvo.conta.resumo.mc - 0.15) < 1e-9);
    eq("E: auditoria registrou criação com o usuário", [m.historico[0].acao, m.historico[0].user_id], ["criado", 100]);
    const coreManual = (await service.listar(U.ana, { competencia: SET })).clientes.find((c) => c.slug === "coremix");
    eq("E: lista mostra o valor manual com fonte MANUAL", [coreManual.resumo.fat, coreManual.fonte.tipo, coreManual.status.codigo], [50000, "manual", "manual"]);
    eq("E: quem lançou fica visível", coreManual.contas[0].manual.atualizadoPor, "Ana");
    await service.salvarLancamentoManual(U.ana, "3", "31", SET, { faturamento: 51000, lucroContribuicao: 7500 });
    eq("E: alteração também é auditada", m.historico[1].acao, "alterado");

    // =======================================================================
    // F — automático vence manual
    // =======================================================================
    await rejeita(
      "F: com import automático publicado, lançamento manual é recusado",
      service.salvarLancamentoManual(U.ana, "1", "11", SET, { faturamento: 1 }),
      409, "AUTOMATICO_DISPONIVEL"
    );
    // Manual antigo gravado antes do automático chegar:
    m.manuais.push({ id: 77, cliente_id: 2, cliente_conta_id: 21, competencia: SET, faturamento: 90000, lucro_contribuicao: 9000, margem_contribuicao: 0.1, investimento_ads: null, gmv_ads: null, observacao: "estimativa", created_by: 100, updated_by: 100, created_at: "2026-09-05T00:00:00.000Z", updated_at: "2026-09-05T00:00:00.000Z" });
    let redF = (await service.listar(U.ana, { competencia: SET })).clientes.find((c) => c.slug === "red-fish");
    eq("F: antes do automático, o manual preenche", [redF.fonte.tipo, redF.resumo.fat], ["manual", 90000]);
    m.imports.push(importRow(2101, 21, SET, { fat: 98000, lc: 12000 }));
    redF = (await service.listar(U.ana, { competencia: SET })).clientes.find((c) => c.slug === "red-fish");
    eq("F: automático chegou → principal", [redF.fonte.tipo, redF.resumo.fat], ["api", 98000]);
    ok("F: manual antigo continua visível e auditável", redF.contas[0].manual && redF.contas[0].manual.substituidoPorAutomatico === true && redF.contas[0].manual.valores.fat === 90000);
    ok("F: o registro manual não foi apagado", m.manuais.some((x) => x.id === 77));

    // =======================================================================
    // G — filtros
    // =======================================================================
    const nomes = (r) => r.clientes.map((c) => c.slug).sort();
    eq("G: status=com_dados", nomes(await service.listar(U.ana, { competencia: SET, status: "com_dados" })), ["amr-ecommerce", "coremix", "red-fish"]);
    eq("G: status=sem_dados", nomes(await service.listar(U.ana, { competencia: SET, status: "sem_dados" })), ["carpei"]);
    eq("G: status=manual", nomes(await service.listar(U.ana, { competencia: SET, status: "manual" })), ["coremix"]);
    eq("G: status=automatico", nomes(await service.listar(U.ana, { competencia: SET, status: "automatico" })), ["amr-ecommerce", "red-fish"]);
    eq("G: status=atencao", nomes(await service.listar(U.ana, { competencia: SET, status: "atencao" })), ["carpei"]);
    eq("G: marketplace=shopee", nomes(await service.listar(U.ana, { competencia: SET, marketplace: "shopee" })), ["coremix"]);
    eq("G: busca por slug", nomes(await service.listar(U.ana, { competencia: SET, busca: "CARP" })), ["carpei"]);
    const filtrado = await service.listar(U.ana, { competencia: SET, status: "sem_dados" });
    eq("G: contagens do topo ignoram o filtro de status (continuam da carteira filtrada)", filtrado.resumoCarteira.operacionais, 4);
    eq("G: marketplaces disponíveis vêm do cadastro", (await service.listar(U.ana, { competencia: SET })).marketplacesDisponiveis.map((x) => x.codigo), ["meli", "shopee"]);
    await rejeita("G: status desconhecido → 400", service.listar(U.ana, { competencia: SET, status: "qualquer" }), 400);

    // =======================================================================
    // I — autorização
    // =======================================================================
    ok("I: Ana nunca vê cliente de outro squad", !lista.clientes.some((c) => c.slug === "fora-da-carteira"));
    eq("I: squadId de outro squad não amplia a carteira", (await service.listar(U.ana, { competencia: SET, squadId: 20 })).clientes.length, 0);
    eq("I: legado + busca pelo cliente de fora continua vazio", (await service.listar(U.ana, { competencia: SET, busca: "fora", mostrarLegado: "true" })).clientes.length, 0);
    await rejeita("I: seller não tem carteira no Painel", service.listar(U.seller, { competencia: SET }), 403, "PAINEL_SEM_ACESSO");
    await rejeita("I: lançar em cliente fora da carteira → 403", service.salvarLancamentoManual(U.ana, "6", "61", SET, { faturamento: 1 }), 403, "CLIENTE_FORA_DA_CARTEIRA");
    await rejeita("I: conta de OUTRO cliente pelo path → 404", service.salvarLancamentoManual(U.ana, "3", "61", SET, { faturamento: 1 }), 404, "CONTA_NAO_ENCONTRADA");
    await rejeita("I: remover lançamento de cliente fora da carteira → 403", service.removerLancamentoManual(U.ana, "6", "61", SET), 403);
    await rejeita("I: papel sem permissão de lançamento → 403", service.salvarLancamentoManual(U.seller, "3", "31", SET, { faturamento: 1 }), 403);
    await rejeita("manual: competência futura → 400", service.salvarLancamentoManual(U.ana, "3", "31", "2027-01", { faturamento: 1 }, { agora: new Date("2026-09-29T12:00:00Z") }), 400);
    await rejeita("manual: payload inconsistente → 422", service.salvarLancamentoManual(U.ana, "3", "31", SET, { faturamento: 100, lucroContribuicao: 10, margemContribuicao: 0.5 }), 422, "MANUAL_INCONSISTENTE");
    await rejeita("manual: conta inativa → 409", (() => { m.contas.find((c) => c.id === 41).ativo = false; return service.salvarLancamentoManual(U.ana, "4", "41", SET, { faturamento: 1 }); })(), 409, "CONTA_INATIVA");
    m.contas.find((c) => c.id === 41).ativo = true;
    ok("permissões: membro pode lançar", lista.permissoes.lancarManual === true);
    // Atualizar sob demanda dispara sync no ML: mesmo gate do sync manual da
    // Central (admin). Membro vê o frescor, não o botão.
    ok("permissões: membro NÃO atualiza sob demanda", lista.permissoes.atualizarDados === false);
    ok("membro: nenhuma linha carrega estado de atualização", lista.clientes.every((c) => c.atualizacao === null));
    const listaAdmin = await service.listar(U.admin, { competencia: SET });
    ok("permissões: admin atualiza sob demanda", listaAdmin.permissoes.atualizarDados === true);
    ok("admin: sem atualização em curso → atualizacao null", listaAdmin.clientes.every((c) => c.atualizacao === null));

    const removido = await service.removerLancamentoManual(U.ana, "3", "31", SET);
    ok("remover: devolve a conta sem manual", removido.removido === true && removido.conta.manual === null);
    eq("remover: fica na trilha de auditoria", m.historico[m.historico.length - 1].acao, "removido");
    await rejeita("remover inexistente → 404", service.removerLancamentoManual(U.ana, "3", "31", SET), 404, "LANCAMENTO_NAO_ENCONTRADO");

    // =======================================================================
    // J — seções por marketplace (ML / Shopee / TikTok Shop)
    // =======================================================================
    m.contas.push({ id: 32, cliente_id: 3, marketplace: "tiktok", nome: "COREMIX TT", slug: "core-tt", external_account_id: null, is_primary: true, ativo: true });
    let consol = await service.listar(U.ana, { competencia: SET });
    let coreJ = consol.clientes.find((c) => c.slug === "coremix");
    const tt = coreJ.contas.find((c) => c.id === 32);
    eq("J: conta TikTok sem dado → sem integração (não 'API falhou')", [tt.status.codigo, tt.rotulo], ["sem_integracao", "TikTok Shop 1 · COREMIX TT"]);
    ok("J: TikTok aceita lançamento manual", tt.podeLancarManual === true);
    eq("J: seções fixas na ordem, com fonte e contagem", consol.secoesMarketplace.map((x) => [x.codigo, x.fonte, x.clientes]), [
      ["meli", "api", 3], ["shopee", "manual", 1], ["tiktok", "manual", 1],
    ]);
    eq("J: visão padrão = consolidado", consol.visao.codigo, null);

    await service.salvarLancamentoManual(U.ana, "3", "31", SET, { faturamento: 50000, lucroContribuicao: 7500, dataReferencia: "2026-09-28" });
    await service.salvarLancamentoManual(U.ana, "3", "32", SET, { faturamento: 20000 });
    consol = await service.listar(U.ana, { competencia: SET });
    coreJ = consol.clientes.find((c) => c.slug === "coremix");
    eq("J: consolidado do cliente soma Shopee + TikTok", [coreJ.resumo.fat, coreJ.fonte.tipo, coreJ.contas.length], [70000, "manual", 2]);

    const secShopee = await service.listar(U.ana, { competencia: SET, marketplace: "shopee" });
    const coreS = secShopee.clientes.find((c) => c.slug === "coremix");
    eq("J: seção Shopee recalcula só com a conta Shopee", [coreS.resumo.fat, coreS.contas.map((c) => c.id)], [50000, [31]]);
    eq("J: seção declara a fonte", [secShopee.visao.codigo, secShopee.visao.fonte], ["shopee", "manual"]);
    eq("J: 'dados até' do manual vem da data de referência", coreS.contas[0].dadosAte, "2026-09-28");

    const secTiktok = await service.listar(U.ana, { competencia: SET, marketplace: "tiktok" });
    eq("J: seção TikTok só com a conta TikTok", secTiktok.clientes.map((c) => [c.slug, c.resumo.fat, c.status.codigo]), [["coremix", 20000, "manual"]]);
    ok("J: Ads do ML não entra na seção TikTok", secTiktok.clientes[0].resumo.ads === null);

    const secMl = await service.listar(U.ana, { competencia: SET, marketplace: "meli" });
    const amrMl = secMl.clientes.find((c) => c.slug === "amr-ecommerce");
    ok("J: seção ML não lista cliente só-Shopee/TikTok", !secMl.clientes.some((c) => c.slug === "coremix"));
    eq("J: seção ML mantém o número da conta e o Ads do cliente", [amrMl.resumo.fat, amrMl.resumo.ads], [2833602 + 800000 + 420512, 120000]);
    eq("J: marketplace sem conta → lista vazia, não erro", (await service.listar(U.ana, { competencia: SET, marketplace: "magalu" })).clientes.length, 0);
    await rejeita("J: marketplace malformado → 400", service.listar(U.ana, { competencia: SET, marketplace: "x y" }), 400, "MARKETPLACE_INVALIDO");

    // =======================================================================
    // K — competências independentes + rastreabilidade
    // =======================================================================
    await service.salvarLancamentoManual(U.ana, "3", "31", "2026-08", { faturamento: 40000, dataReferencia: "2026-08-31" });
    await service.salvarLancamentoManual(U.ana, "3", "31", SET, { faturamento: 52000, dataReferencia: "2026-09-29" });
    const ago = (await service.listar(U.ana, { competencia: "2026-08", marketplace: "shopee" })).clientes.find((c) => c.slug === "coremix");
    const set = (await service.listar(U.ana, { competencia: SET, marketplace: "shopee" })).clientes.find((c) => c.slug === "coremix");
    eq("K: salvar setembro não sobrescreve agosto", [ago.resumo.fat, set.resumo.fat], [40000, 52000]);
    eq("K: cada competência guarda a própria data de referência", [ago.contas[0].dadosAte, set.contas[0].dadosAte], ["2026-08-31", "2026-09-29"]);
    eq("K: campo ausente continua ausente (LC não vira 0)", set.contas[0].resumo.lc, null);

    const lancs = await service.listarLancamentosDaConta(U.ana, "3", "31");
    eq("K: competências lançadas da conta, mais recente primeiro", lancs.lancamentos.map((l) => [l.competencia, l.valores.fat, l.dataReferencia]), [
      [SET, 52000, "2026-09-29"], ["2026-08", 40000, "2026-08-31"],
    ]);
    eq("K: responsável e fonte em cada registro", [lancs.lancamentos[0].criadoPor, lancs.lancamentos[0].atualizadoPor, lancs.lancamentos[0].fonte.tipo, lancs.lancamentos[0].statusRegistro], ["Ana", "Ana", "manual", "vigente"]);

    const hist = await service.listarHistoricoLancamento(U.ana, "3", "31", SET);
    ok("K: trilha preserva criação, remoção e alterações (mais recente primeiro)", hist.historico.length >= 3 && hist.historico[0].acao === "alterado" && hist.historico.some((h) => h.acao === "removido") && hist.historico[hist.historico.length - 1].acao === "criado");
    eq("K: trilha guarda valores e data de referência de cada versão", [hist.historico[0].valores.faturamento, hist.historico[0].valores.dataReferencia, hist.historico[0].por], [52000, "2026-09-29", "Ana"]);
    eq("K: trilha de agosto é separada", (await service.listarHistoricoLancamento(U.ana, "3", "31", "2026-08")).historico.map((h) => h.acao), ["criado"]);

    await rejeita("K: data de referência fora da competência → 422", service.salvarLancamentoManual(U.ana, "3", "31", SET, { faturamento: 1, dataReferencia: "2026-08-31" }), 422, "MANUAL_INVALIDO");
    await rejeita("K: data de referência futura → 422", service.salvarLancamentoManual(U.ana, "3", "31", SET, { faturamento: 1, dataReferencia: "2026-09-30" }, { agora: new Date("2026-09-29T12:00:00-03:00") }), 422, "MANUAL_INVALIDO");
    await rejeita("K: data de referência inexistente → 422", service.salvarLancamentoManual(U.ana, "3", "31", SET, { faturamento: 1, dataReferencia: "2026-09-31" }), 422, "MANUAL_INVALIDO");
    await rejeita("K: histórico de conta de outro cliente pelo path → 404", service.listarHistoricoLancamento(U.ana, "3", "61", SET), 404, "CONTA_NAO_ENCONTRADA");
    await rejeita("K: histórico de cliente fora da carteira → 403", service.listarHistoricoLancamento(U.ana, "6", "61", SET), 403);
    await rejeita("K: lançamentos de cliente fora da carteira → 403", service.listarLancamentosDaConta(U.ana, "6", "61"), 403);
    await rejeita("K: competência inválida no histórico → 400", service.listarHistoricoLancamento(U.ana, "3", "31", "2026-9"), 400);

    m.contas = m.contas.filter((c) => c.id !== 32);
    m.manuais = m.manuais.filter((x) => x.cliente_conta_id !== 32 && x.cliente_conta_id !== 31);

    // =======================================================================
    // L — acesso por Squad no Painel
    // =======================================================================
    const slugs = (r) => r.clientes.map((c) => c.slug).sort();
    eq("L: admin vê todos os Squads", slugs(await service.listar(U.admin, { competencia: SET, mostrarLegado: "true" })),
      ["amr-ecommerce", "carpei", "coremix", "fora-da-carteira", "red-fish", "velho-legado"]);
    eq("L: coordenador vê só os clientes dos Squads que coordena", slugs(await service.listar(U.beto, { competencia: SET })), ["fora-da-carteira"]);
    const acessoAna = (await service.listar(U.ana, { competencia: SET })).acesso;
    eq("L: a resposta diz de onde vem a carteira", [acessoAna.tipo, acessoAna.squadsCoordenados.map((x) => x.nome)], ["carteira", ["Squad 6", "Squad 8 - Legado"]]);

    await rejeita("L: membro comum (sem coordenação nem gestão) não recebe acesso", service.listar(U.carla, { competencia: SET }), 403, "PAINEL_SEM_ACESSO");
    await rejeita("L: membro comum não lê histórico de cliente do próprio Squad", service.listarMeses(U.carla, "6"), 403, "CLIENTE_FORA_DA_CARTEIRA");
    await rejeita("L: membro comum não lê semanas das contas", service.listarSemanasDasContas(U.carla, "6", SET), 403);
    await rejeita("L: membro comum não lança, mesmo com o cliente na carteira global", service.salvarLancamentoManual(U.carla, "6", "61", SET, { faturamento: 1 }), 403);

    process.env.SQUADS_ENFORCEMENT = "off";
    await rejeita("L: flag global desligada não abre o Painel para membro comum", service.listar(U.carla, { competencia: SET }), 403, "PAINEL_SEM_ACESSO");
    eq("L: flag global desligada não amplia a carteira do coordenador", slugs(await service.listar(U.beto, { competencia: SET })), ["fora-da-carteira"]);
    process.env.SQUADS_ENFORCEMENT = "on";

    // Auxiliar/designer não dão acesso; gestor dá, só ao próprio cliente.
    m.responsaveis.push({ cliente_id: 6, user_id: 400, papel: "auxiliar", ativo: true });
    await rejeita("L: auxiliar do cliente não recebe acesso", service.listar(U.carla, { competencia: SET }), 403, "PAINEL_SEM_ACESSO");
    m.responsaveis.push({ cliente_id: 6, user_id: 400, papel: "gestor", ativo: true });
    const listaGestora = await service.listar(U.carla, { competencia: SET });
    eq("L: gestor vê só a carteira a que está vinculado", [slugs(listaGestora), listaGestora.acesso.tipo, listaGestora.acesso.clientesComoGestor], [["fora-da-carteira"], "carteira", 1]);
    ok("L: gestor lê o histórico do próprio cliente", (await service.listarMeses(U.carla, "6")).ok === true);
    await rejeita("L: gestor não lê cliente de que não é gestor", service.listarMeses(U.carla, "1"), 403, "CLIENTE_FORA_DA_CARTEIRA");
    m.responsaveis.find((r) => r.papel === "gestor" && r.user_id === 400).ativo = false;
    await rejeita("L: gestão encerrada (ativo=false) tira o acesso", service.listar(U.carla, { competencia: SET }), 403, "PAINEL_SEM_ACESSO");

    // Gestor de cliente FORA da carteira global de escrita: lê, não lança.
    m.responsaveis.push({ cliente_id: 3, user_id: 500, papel: "gestor", ativo: true });
    const listaDani = await service.listar(U.dani, { competencia: SET });
    const coreDani = listaDani.clientes.find((c) => c.slug === "coremix");
    ok("L: gestor vê o cliente que gere", Boolean(coreDani));
    ok("L: escrita não é ampliada — sem a carteira global, não oferece lançar", coreDani.podeLancarManual === false && coreDani.contas.every((c) => c.podeLancarManual === false));
    await rejeita("L: e o servidor recusa o lançamento", service.salvarLancamentoManual(U.dani, "3", "31", SET, { faturamento: 1 }), 403, "CLIENTE_FORA_DA_CARTEIRA");
    m.responsaveis = [];

    // Squad inativo e membership inativa não dão acesso.
    m.squads.find((sq) => sq.id === 20).ativo = false;
    await rejeita("L: coordenador de Squad inativo perde o acesso", service.listar(U.beto, { competencia: SET }), 403, "PAINEL_SEM_ACESSO");
    m.squads.find((sq) => sq.id === 20).ativo = true;
    m.members.find((x) => x.user_id === 200).ativo = false;
    await rejeita("L: coordenação encerrada (membership inativa) tira o acesso", service.listar(U.beto, { competencia: SET }), 403, "PAINEL_SEM_ACESSO");
    m.members.find((x) => x.user_id === 200).ativo = true;

    // Isolamento entre carteiras pelo path.
    await rejeita("L: coordenador não lê cliente de outro Squad pelo path", service.listarSemanas(U.beto, "1", SET), 403, "CLIENTE_FORA_DA_CARTEIRA");
    await rejeita("L: histórico de lançamento de outro Squad → 403", service.listarHistoricoLancamento(U.beto, "3", "31", SET), 403);
    await rejeita("L: cliente inexistente → 404", service.listarMeses(U.beto, "9999"), 404, "CLIENTE_NAO_ENCONTRADO");

    // =======================================================================
    // Performance: número fixo de queries, sem N+1
    // =======================================================================
    contagem.total = 0;
    contagem.porTag.clear();
    await service.listar(U.admin, { competencia: SET, mostrarLegado: "true" });
    const umaVez = ["painel:resumo", "painel:ultima", "painel:contas", "painel:imports", "painel:runs", "painel:ads", "painel:manuais"];
    ok(`lista: cada leitura em lote roda 1x — ${JSON.stringify([...contagem.porTag])}`, umaVez.every((t) => contagem.porTag.get(t) === 1));
    const totalComSeis = contagem.total;
    for (let i = 7; i < 40; i++) {
      m.clientes.push({ id: i, slug: `extra-${i}`, nome: `Extra ${i}`, ativo: true });
      m.history.push({ cliente_id: i, squad_id: 10, fim_em: null });
      m.contas.push({ id: 1000 + i, cliente_id: i, marketplace: "meli", nome: `E${i}`, slug: `e-${i}`, external_account_id: `X${i}`, is_primary: true, ativo: true });
    }
    contagem.total = 0;
    await service.listar(U.admin, { competencia: SET, mostrarLegado: "true" });
    eq("lista: 6 ou 39 clientes, mesma quantidade de queries", contagem.total, totalComSeis);
    ok("lista: segredo nenhum no payload", !/access_token|refresh_token|client_secret|api_key|error_message/i.test(JSON.stringify(lista)));

    concluido = true;
    console.log(`painelContasOperacionalService.test.js: ${checks} verificações OK`);
  } finally {
    restaurar();
  }
}

run().catch((err) => { console.error(err); process.exit(1); });
