// server/tests/squadServiceMutacoes.test.js
//
// Invariantes de escrita de Squads (mission §29, §34):
//   - slug de squad duplicado -> 409
//   - membership duplicada -> 1 linha (ON CONFLICT), nunca 2
//   - 2 principais para o mesmo usuário -> impossível (índice parcial)
//   - remoção do principal -> promove a próxima
//   - transferência de cliente -> transacional, fecha histórico antigo
//   - transferência para squad inativo -> 409
//   - cliente com 2 squads ativos -> impossível
//
// Mock em memória com connect()/BEGIN/COMMIT/ROLLBACK. Os índices parciais
// únicos do Postgres são reproduzidos à mão (lançam { code: "23505" }).

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const pool = require("../config/database");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
async function lanca(label, fn, codeEsperado) {
  let e;
  try { await fn(); } catch (err) { e = err; }
  assert.ok(e, `FALHOU (não lançou): ${label}`);
  if (codeEsperado) assert.ok(e.code === codeEsperado || e.statusCode === codeEsperado, `FALHOU (code/status): ${label} — veio ${e.code}/${e.statusCode}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

function novoModelo() {
  return {
    squads: [
      { id: 10, nome: "Alpha", slug: "alpha", ativo: true },
      { id: 20, nome: "Beta", slug: "beta", ativo: true },
      { id: 30, nome: "Inativo", slug: "inativo", ativo: false },
    ],
    users: [{ id: 100, role: "membro" }, { id: 200, role: "membro" }],
    members: [], // {id, squad_id, user_id, is_primary, funcao, ativo, created_at}
    clientes: [{ id: 1 }, { id: 2 }],
    history: [], // {id, cliente_id, squad_id, fim_em, ...}
    seqMember: 1,
    seqHistory: 1,
    seqSquad: 100,
  };
}

function instalar(m) {
  const oq = pool.query;
  const oc = pool.connect;

  function query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();

    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(q) || q.includes("pg_advisory") || /^(CREATE|ALTER|DROP|DO )/i.test(q)) {
      return { rows: [] };
    }

    // ── squads ──
    if (q.startsWith("SELECT 1 FROM squads WHERE slug = $1")) {
      return { rows: m.squads.filter((s) => s.slug === params[0]).map(() => ({ "?column?": 1 })) };
    }
    if (q.startsWith("INSERT INTO squads")) {
      if (m.squads.some((s) => s.slug === params[1])) { const e = new Error("dup"); e.code = "23505"; throw e; }
      const s = { id: m.seqSquad++, nome: params[0], slug: params[1], ativo: true, created_at: new Date(), updated_at: new Date() };
      m.squads.push(s);
      return { rows: [s] };
    }
    if (q.startsWith("UPDATE squads SET")) {
      const id = params[params.length - 1];
      const s = m.squads.find((x) => x.id === Number(id));
      if (!s) return { rows: [] };
      // aplica campos na ordem: patches montados nome,slug,ativo
      let i = 0;
      if (q.includes("nome = $")) s.nome = params[i++];
      if (q.includes("slug = $")) { const nv = params[i++]; if (m.squads.some((x) => x.slug === nv && x.id !== s.id)) { const e = new Error("dup"); e.code = "23505"; throw e; } s.slug = nv; }
      if (q.includes("ativo = $")) s.ativo = params[i++];
      return { rows: [{ ...s }] };
    }
    if (q.startsWith("SELECT id, ativo FROM squads WHERE id = $1")) {
      return { rows: m.squads.filter((s) => s.id === Number(params[0])).map((s) => ({ id: s.id, ativo: s.ativo })) };
    }

    // ── users ──
    if (q.startsWith("SELECT id, role FROM users WHERE id = $1")) {
      return { rows: m.users.filter((u) => u.id === Number(params[0])) };
    }

    // ── squad_members ──
    if (q.startsWith("SELECT COUNT(*)::int AS total FROM squad_members WHERE user_id = $1 AND ativo = true AND squad_id <> $2")) {
      const total = m.members.filter((mm) => mm.user_id === Number(params[0]) && mm.ativo && mm.squad_id !== Number(params[1])).length;
      return { rows: [{ total }] };
    }
    if (q.startsWith("UPDATE squad_members SET is_primary = false, updated_at = NOW() WHERE user_id = $1 AND is_primary = true")) {
      m.members.forEach((mm) => { if (mm.user_id === Number(params[0]) && mm.is_primary) mm.is_primary = false; });
      return { rows: [] };
    }
    if (q.startsWith("INSERT INTO squad_members")) {
      const [squad_id, user_id, is_primary, funcao] = params;
      let mm = m.members.find((x) => x.squad_id === Number(squad_id) && x.user_id === Number(user_id));
      if (mm) {
        mm.ativo = true; mm.funcao = funcao;
        if (is_primary) mm.is_primary = true;
      } else {
        mm = { id: m.seqMember++, squad_id: Number(squad_id), user_id: Number(user_id), is_primary: !!is_primary, funcao, ativo: true, created_at: new Date(Date.now() + m.seqMember) };
        m.members.push(mm);
      }
      // índice parcial único: 1 principal ativo por user
      if (m.members.filter((x) => x.user_id === Number(user_id) && x.is_primary && x.ativo).length > 1) {
        const e = new Error("dois principais"); e.code = "23505"; throw e;
      }
      return { rows: [{ ...mm }] };
    }
    if (q.startsWith("SELECT id, is_primary FROM squad_members WHERE squad_id = $1 AND user_id = $2 AND ativo = true FOR UPDATE")) {
      return { rows: m.members.filter((mm) => mm.squad_id === Number(params[0]) && mm.user_id === Number(params[1]) && mm.ativo).map((mm) => ({ id: mm.id, is_primary: mm.is_primary })) };
    }
    if (q.startsWith("SELECT id FROM squad_members WHERE squad_id = $1 AND user_id = $2 AND ativo = true FOR UPDATE")) {
      return { rows: m.members.filter((mm) => mm.squad_id === Number(params[0]) && mm.user_id === Number(params[1]) && mm.ativo).map((mm) => ({ id: mm.id })) };
    }
    if (q.startsWith("UPDATE squad_members SET ativo = false, is_primary = false, updated_at = NOW() WHERE id = $1")) {
      const mm = m.members.find((x) => x.id === Number(params[0]));
      if (mm) { mm.ativo = false; mm.is_primary = false; }
      return { rows: [] };
    }
    if (q.startsWith("SELECT id FROM squad_members WHERE user_id = $1 AND ativo = true ORDER BY created_at ASC, id ASC LIMIT 1")) {
      const cand = m.members.filter((mm) => mm.user_id === Number(params[0]) && mm.ativo).sort((a, b) => a.created_at - b.created_at || a.id - b.id)[0];
      return { rows: cand ? [{ id: cand.id }] : [] };
    }
    if (q.startsWith("UPDATE squad_members SET is_primary = true, updated_at = NOW() WHERE id = $1")) {
      const mm = m.members.find((x) => x.id === Number(params[0]));
      if (mm) mm.is_primary = true;
      if (m.members.filter((x) => x.user_id === mm.user_id && x.is_primary && x.ativo).length > 1) {
        const e = new Error("dois principais"); e.code = "23505"; throw e;
      }
      return { rows: [] };
    }
    if (q.startsWith("UPDATE squad_members SET funcao = $1")) {
      const mm = m.members.find((x) => x.squad_id === Number(params[1]) && x.user_id === Number(params[2]) && x.ativo);
      if (!mm) return { rows: [] };
      mm.funcao = params[0];
      return { rows: [{ ...mm }] };
    }

    // ── clientes / cliente_squad_history ──
    if (q.startsWith("SELECT id FROM clientes WHERE id = $1")) {
      return { rows: m.clientes.filter((c) => c.id === Number(params[0])) };
    }
    if (q.includes("FROM cliente_squad_history WHERE cliente_id = $1 AND fim_em IS NULL")) {
      return { rows: m.history.filter((h) => h.cliente_id === Number(params[0]) && h.fim_em === null).map((h) => ({ id: h.id, squad_id: h.squad_id })) };
    }
    if (q.startsWith("UPDATE cliente_squad_history SET fim_em = NOW() WHERE id = $1")) {
      const h = m.history.find((x) => x.id === Number(params[0]));
      if (h) h.fim_em = new Date().toISOString();
      return { rows: [] };
    }
    if (q.startsWith("UPDATE cliente_squad_history SET fim_em = NOW(), motivo")) {
      const rows = [];
      m.history.forEach((h) => { if (h.cliente_id === Number(params[0]) && h.fim_em === null) { h.fim_em = new Date().toISOString(); rows.push({ id: h.id, squad_id: h.squad_id }); } });
      return { rows };
    }
    if (q.startsWith("INSERT INTO cliente_squad_history")) {
      const [cliente_id, squad_id, alterado_por, motivo] = params;
      if (m.history.some((h) => h.cliente_id === Number(cliente_id) && h.fim_em === null)) {
        const e = new Error("dois squads ativos"); e.code = "23505"; throw e;
      }
      const h = { id: m.seqHistory++, cliente_id: Number(cliente_id), squad_id: Number(squad_id), fim_em: null, alterado_por, motivo, inicio_em: new Date() };
      m.history.push(h);
      return { rows: [{ id: h.id, cliente_id: h.cliente_id, squad_id: h.squad_id, inicio_em: h.inicio_em }] };
    }

    return { rows: [] };
  }

  pool.query = (s, p) => Promise.resolve().then(() => query(s, p));
  pool.connect = async () => ({ query: (s, p) => Promise.resolve().then(() => query(s, p)), release() {} });
  return () => { pool.query = oq; pool.connect = oc; };
}

const squadService = require("../services/squads/squadService");

async function run() {
  const m = novoModelo();
  const restaurar = instalar(m);
  try {
    // slug duplicado
    await lanca("criarSquad com slug 'alpha' já existente -> 409", () => squadService.criarSquad({ nome: "Outro", slug: "alpha" }), "SQUAD_SLUG_DUPLICADO");
    const s = await squadService.criarSquad({ nome: "Squad Gamma" });
    ok("criarSquad gera slug único a partir do nome", s.slug === "squad-gamma");

    // membership: primeira vira principal
    const m1 = await squadService.adicionarMembro(10, 100, {});
    ok("primeira membership do user 100 vira principal automaticamente", m1.is_primary === true);
    // segunda membership: NÃO principal
    const m2 = await squadService.adicionarMembro(20, 100, {});
    ok("segunda membership do user 100 NÃO é principal", m2.is_primary === false);
    ok("user 100 tem exatamente 1 principal", m.members.filter((x) => x.user_id === 100 && x.is_primary && x.ativo).length === 1);

    // adicionar de novo no mesmo squad: 1 linha (ON CONFLICT)
    await squadService.adicionarMembro(10, 100, { funcao: "coordenador" });
    ok("re-adicionar no squad 10 não cria segunda linha (ON CONFLICT)", m.members.filter((x) => x.squad_id === 10 && x.user_id === 100).length === 1);
    ok("funcao foi atualizada para coordenador", m.members.find((x) => x.squad_id === 10 && x.user_id === 100).funcao === "coordenador");

    // trocar principal explicitamente
    await squadService.definirPrincipal(20, 100);
    ok("definirPrincipal(20) move o principal e mantém unicidade", m.members.find((x) => x.squad_id === 20 && x.user_id === 100).is_primary === true && m.members.filter((x) => x.user_id === 100 && x.is_primary).length === 1);

    // remover o principal -> promove o outro
    await squadService.removerMembro(20, 100);
    ok("remover a membership principal promove a restante a principal", m.members.filter((x) => x.user_id === 100 && x.is_primary && x.ativo).length === 1 && m.members.find((x) => x.squad_id === 10 && x.user_id === 100).is_primary === true);

    // ── cliente ↔ squad ──
    const v1 = await squadService.atribuirCliente(10, 1, {});
    ok("atribuirCliente: cliente 1 -> squad 10 (abre histórico)", v1.squad_id === 10);
    await lanca("atribuirCliente de novo (cliente já tem squad) -> 409", () => squadService.atribuirCliente(20, 1, {}), "CLIENTE_JA_TEM_SQUAD");

    // transferência
    const t = await squadService.transferirCliente(1, 20, { motivo: "realinhamento" });
    ok("transferirCliente 1: Alpha -> Beta, fecha histórico antigo", t.squad_id === 20 && t.squadOrigemId === 10);
    ok("apenas 1 histórico aberto para o cliente 1 após transferência", m.history.filter((h) => h.cliente_id === 1 && h.fim_em === null).length === 1);
    ok("histórico antigo preservado com fim_em preenchido", m.history.filter((h) => h.cliente_id === 1 && h.fim_em !== null).length === 1);

    await lanca("transferir para squad inativo (30) -> 409 SQUAD_INATIVO", () => squadService.transferirCliente(1, 30, {}), "SQUAD_INATIVO");

    const semMud = await squadService.transferirCliente(1, 20, {});
    ok("transferir para o mesmo squad -> sem mudança", semMud.semMudanca === true);

    await lanca("transferir cliente sem squad ativo (2) -> 409 CLIENTE_SEM_SQUAD", () => squadService.transferirCliente(2, 10, {}), "CLIENTE_SEM_SQUAD");

    console.log(`\nsquadServiceMutacoes.test.js: ${checks} verificações passaram.`);
  } finally {
    restaurar();
  }
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
