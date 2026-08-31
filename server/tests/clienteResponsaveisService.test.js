// server/tests/clienteResponsaveisService.test.js
//
// P2.4 — Responsabilidades de Cliente. Regras verificadas:
//   - atribuir gestor / auxiliar / designer
//   - coordenador do Squad pode ser gestor (excepcional)
//   - papel inválido -> 400 PAPEL_INVALIDO
//   - responsável seller/shopee_reviewer -> 422 RESPONSAVEL_INVALIDO
//   - usuário fora do Squad ativo -> 409 RESPONSAVEL_SEM_ACESSO
//   - escape de migração exige permitirSemAcesso:true + motivoMigracao
//   - cliente sem Squad (pré-migração) -> sem checagem de acesso
//   - remover último gestor -> 409 GESTOR_OBRIGATORIO (só na remoção manual)
//   - motivoMigracao destrava a remoção do último gestor
//   - trocar gestor -> encerra o antigo, ativa o novo, sem passar por bloqueio
//   - RESPONSABILIDADE NÃO É AUTORIZAÇÃO (o serviço nunca consulta authz)
//
// Mock em memória de pool.query/connect, casando por marcador /* squads:... */.

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
  if (codeEsperado) {
    assert.ok(
      e.code === codeEsperado || e.statusCode === codeEsperado,
      `FALHOU (code/status): ${label} — veio ${e.code}/${e.statusCode}`
    );
  }
  checks += 1;
  console.log(`  ok  ${label}`);
}

function novoModelo() {
  return {
    clientes: [
      { id: 1, slug: "acme", nome: "Acme", ativo: true },
      { id: 2, slug: "sem-squad", nome: "Sem Squad", ativo: true },
    ],
    users: [
      { id: 10, nome: "Gestora", email: "gestora@vf.com", role: "membro" },
      { id: 11, nome: "Auxiliar", email: "aux@vf.com", role: "membro" },
      { id: 12, nome: "Designer", email: "design@vf.com", role: "user" },
      { id: 13, nome: "Coord", email: "coord@vf.com", role: "membro" },
      { id: 14, nome: "DeFora", email: "defora@vf.com", role: "membro" },
      { id: 15, nome: "Admin", email: "admin@vf.com", role: "admin" },
      { id: 16, nome: "Seller", email: "seller@vf.com", role: "seller" },
      { id: 17, nome: "Gestora2", email: "gestora2@vf.com", role: "membro" },
    ],
    // cliente_squad_history (ativo): cliente 1 -> squad 100; cliente 2 -> nenhum
    squadAtivo: { 1: 100 },
    // squad_members ativos do squad 100
    members: [
      { squad_id: 100, user_id: 10, ativo: true },
      { squad_id: 100, user_id: 11, ativo: true },
      { squad_id: 100, user_id: 12, ativo: true },
      { squad_id: 100, user_id: 13, ativo: true },
      { squad_id: 100, user_id: 17, ativo: true },
    ],
    responsaveis: [], // {id, cliente_id, user_id, papel, ativo, encerrado_em, encerrado_por, motivo, criado_por}
    seq: 1,
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

    if (q.startsWith("SELECT id, slug, nome, ativo FROM clientes WHERE id = $1")) {
      return { rows: m.clientes.filter((c) => c.id === Number(params[0])) };
    }
    if (q.startsWith("SELECT id, nome, email, role FROM users WHERE id = $1")) {
      return { rows: m.users.filter((u) => u.id === Number(params[0])) };
    }

    if (q.includes("squads:ACESSO_ESTRUTURAL_AO_SQUAD")) {
      const [cid, uid] = params.map(Number);
      const sid = m.squadAtivo[cid];
      if (!sid) return { rows: [] };
      const membro = m.members.some((x) => x.squad_id === sid && x.user_id === uid && x.ativo);
      return { rows: [{ squad_id: sid, membro }] };
    }

    if (q.includes("squads:RESPONSAVEIS_DO_CLIENTE")) {
      const cid = Number(params[0]);
      const soAtivos = q.includes("AND cr.ativo = true");
      const linhas = m.responsaveis
        .filter((r) => r.cliente_id === cid && (!soAtivos || r.ativo))
        .map((r) => {
          const u = m.users.find((x) => x.id === r.user_id) || {};
          return {
            id: r.id, cliente_id: r.cliente_id, user_id: r.user_id, papel: r.papel, ativo: r.ativo,
            criado_por: r.criado_por || null, created_at: "2026-08-28", updated_at: "2026-08-28",
            encerrado_em: r.encerrado_em || null, encerrado_por: r.encerrado_por || null, motivo: r.motivo || null,
            user_nome: u.nome, user_email: u.email, user_role: u.role,
          };
        });
      return { rows: linhas };
    }

    if (q.includes("squads:GET_RESPONSAVEL")) {
      const [cid, uid, papel] = [Number(params[0]), Number(params[1]), String(params[2])];
      const r = m.responsaveis.find((x) => x.cliente_id === cid && x.user_id === uid && x.papel === papel);
      return { rows: r ? [{ ...r }] : [] };
    }

    if (q.includes("squads:CONTAR_RESPONSAVEIS_ATIVOS")) {
      const [cid, papel] = [Number(params[0]), String(params[1])];
      const total = m.responsaveis.filter((x) => x.cliente_id === cid && x.papel === papel && x.ativo).length;
      return { rows: [{ total }] };
    }

    if (q.includes("squads:UPSERT_RESPONSAVEL")) {
      const [cid, uid, papel, criadoPor] = [Number(params[0]), Number(params[1]), String(params[2]), params[3]];
      let r = m.responsaveis.find((x) => x.cliente_id === cid && x.user_id === uid && x.papel === papel);
      if (r) {
        r.ativo = true; r.encerrado_em = null; r.encerrado_por = null; r.motivo = null;
        if (r.criado_por == null) r.criado_por = criadoPor;
      } else {
        r = { id: m.seq++, cliente_id: cid, user_id: uid, papel, ativo: true, encerrado_em: null, encerrado_por: null, motivo: null, criado_por: criadoPor };
        m.responsaveis.push(r);
      }
      return { rows: [{ ...r, created_at: "2026-08-28", updated_at: "2026-08-28" }] };
    }

    if (q.includes("squads:ENCERRAR_RESPONSAVEL")) {
      const [cid, uid, papel, encPor, motivo] = [Number(params[0]), Number(params[1]), String(params[2]), params[3], params[4]];
      const r = m.responsaveis.find((x) => x.cliente_id === cid && x.user_id === uid && x.papel === papel && x.ativo);
      if (!r) return { rows: [] };
      r.ativo = false; r.encerrado_em = "2026-08-28"; r.encerrado_por = encPor; r.motivo = motivo || r.motivo;
      return { rows: [{ id: r.id, cliente_id: cid, user_id: uid, papel }] };
    }

    return { rows: [] };
  }

  pool.query = (s, p) => Promise.resolve().then(() => query(s, p));
  pool.connect = async () => ({ query: (s, p) => Promise.resolve().then(() => query(s, p)), release() {} });
  return () => { pool.query = oq; pool.connect = oc; };
}

const service = require("../services/squads/clienteResponsaveisService");
const squadsRepo = require("../services/squads/squadsRepository");

async function run() {
  const m = novoModelo();
  const restaurar = instalar(m);
  squadsRepo._resetEnsuredParaTeste();
  try {
    // ── atribuir os 3 papéis (usuários com acesso ao Squad) ──
    await service.atribuir(1, { userId: 10, papel: "gestor" }, 999);
    ok("gestor atribuído e vigente", m.responsaveis.some((r) => r.user_id === 10 && r.papel === "gestor" && r.ativo));
    ok("criado_por registrado", m.responsaveis.find((r) => r.user_id === 10 && r.papel === "gestor").criado_por === 999);

    await service.atribuir(1, { userId: 11, papel: "auxiliar" }, 999);
    await service.atribuir(1, { userId: 12, papel: "designer" }, 999);
    ok("auxiliar e designer atribuídos", m.responsaveis.filter((r) => r.ativo && ["auxiliar", "designer"].includes(r.papel)).length === 2);

    // ── coordenador do Squad como gestor (excepcional): user 13 é membro ──
    await service.atribuir(1, { userId: 13, papel: "gestor" }, 999);
    ok("coordenador do Squad pode ser gestor (2 gestores agora)", m.responsaveis.filter((r) => r.papel === "gestor" && r.ativo).length === 2);

    // ── papel inválido ──
    await lanca("papel inválido -> PAPEL_INVALIDO", () => service.atribuir(1, { userId: 10, papel: "chefe" }, 999), "PAPEL_INVALIDO");

    // ── seller não pode ser responsável ──
    await lanca("seller -> RESPONSAVEL_INVALIDO", () => service.atribuir(1, { userId: 16, papel: "auxiliar" }, 999), "RESPONSAVEL_INVALIDO");

    // ── usuário fora do Squad ativo ──
    await lanca("user fora do Squad -> RESPONSAVEL_SEM_ACESSO", () => service.atribuir(1, { userId: 14, papel: "auxiliar" }, 999), "RESPONSAVEL_SEM_ACESSO");
    await lanca("permitirSemAcesso SEM motivoMigracao -> ainda RESPONSAVEL_SEM_ACESSO",
      () => service.atribuir(1, { userId: 14, papel: "auxiliar", permitirSemAcesso: true }, 999), "RESPONSAVEL_SEM_ACESSO");
    await service.atribuir(1, { userId: 14, papel: "auxiliar", permitirSemAcesso: true, motivoMigracao: "carga inicial P2.9" }, 999);
    ok("escape de migração (permitirSemAcesso + motivoMigracao) atribui", m.responsaveis.some((r) => r.user_id === 14 && r.papel === "auxiliar" && r.ativo));

    // ── admin como responsável: acessa qualquer cliente, sem escape ──
    await service.atribuir(1, { userId: 15, papel: "designer" }, 999);
    ok("admin pode ser responsável sem escape", m.responsaveis.some((r) => r.user_id === 15 && r.papel === "designer" && r.ativo));

    // ── cliente sem Squad ativo (pré-migração): sem checagem de acesso ──
    await service.atribuir(2, { userId: 14, papel: "gestor" }, 999);
    ok("cliente sem Squad: atribui sem checar acesso", m.responsaveis.some((r) => r.cliente_id === 2 && r.user_id === 14 && r.papel === "gestor" && r.ativo));

    // ── remover: último gestor protegido só na remoção manual ──
    // cliente 1 tem 2 gestores (10 e 13). Remover 13 é ok.
    await service.remover(1, { userId: 13, papel: "gestor" }, 999);
    ok("remover gestor quando há 2 -> ok", m.responsaveis.find((r) => r.user_id === 13 && r.papel === "gestor").ativo === false);

    await lanca("remover o ÚLTIMO gestor sem motivoMigracao -> GESTOR_OBRIGATORIO",
      () => service.remover(1, { userId: 10, papel: "gestor" }, 999), "GESTOR_OBRIGATORIO");

    await service.remover(1, { userId: 10, papel: "gestor", motivoMigracao: "cliente descontinuado" }, 999);
    ok("motivoMigracao destrava a remoção do último gestor", m.responsaveis.find((r) => r.user_id === 10 && r.papel === "gestor").ativo === false);

    // ── remover auxiliar único: sem bloqueio ──
    await service.remover(1, { userId: 11, papel: "auxiliar" }, 999);
    ok("remover auxiliar único -> ok (sem regra de obrigatoriedade)", m.responsaveis.find((r) => r.user_id === 11 && r.papel === "auxiliar").ativo === false);

    await lanca("remover responsável inexistente -> RESPONSAVEL_NAO_ENCONTRADO",
      () => service.remover(1, { userId: 99, papel: "designer" }, 999), "RESPONSAVEL_NAO_ENCONTRADO");

    // ── trocar gestor: encerra o antigo, ativa o novo, sem bloqueio ──
    await service.atribuir(1, { userId: 10, papel: "gestor" }, 999); // reativa 10 como gestor
    const t = await service.trocar(1, "gestor", { novoUserId: 17 }, 999);
    ok("trocar: novo gestor (17) vigente", m.responsaveis.some((r) => r.user_id === 17 && r.papel === "gestor" && r.ativo));
    ok("trocar: gestor antigo (10) encerrado", m.responsaveis.find((r) => r.user_id === 10 && r.papel === "gestor").ativo === false);
    ok("trocar: encerrados reportados", Array.isArray(t.encerrados) && t.encerrados.includes(10));
    ok("trocar: nunca esbarra em GESTOR_OBRIGATORIO", m.responsaveis.filter((r) => r.cliente_id === 1 && r.papel === "gestor" && r.ativo).length === 1);

    // ── trocar para alguém de fora do Squad exige escape ──
    await lanca("trocar gestor por user de fora do Squad -> RESPONSAVEL_SEM_ACESSO",
      () => service.trocar(1, "gestor", { novoUserId: 14 }, 999), "RESPONSAVEL_SEM_ACESSO");

    // ── listar ──
    const lista = await service.listar(1);
    ok("listar: só vigentes por padrão", lista.responsaveis.every((r) => r.ativo));
    ok("listar: gestorAusente=false (17 é gestor)", lista.gestorAusente === false);
    const listaHist = await service.listar(1, { incluirEncerrados: true });
    ok("listar histórico: inclui encerrados", listaHist.responsaveis.some((r) => !r.ativo));

    console.log(`\nclienteResponsaveisService.test.js: ${checks} verificações passaram.`);
  } finally {
    restaurar();
  }
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
