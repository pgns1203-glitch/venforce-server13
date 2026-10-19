// server/services/painelContas/painelContasAcesso.js
// Escopo do Painel de Contas — regra própria do Painel, INDEPENDENTE da flag
// global SQUADS_ENFORCEMENT (que continua governando os outros módulos via
// authorizationService). Liberado para toda a equipe interna em 19/10/2026
// (antes: só coordenador/gestor do Squad, decisões de 01/10 e 15/10):
//
//   admin        → todos os clientes ativos.
//   interno      → clientes ativos cujo Squad VIGENTE (cliente_squad_history,
//   (user/membro/  fim_em IS NULL) é um Squad ATIVO em que o usuário tem
//   interno)       membership ativa — qualquer função (coordenador, gestor,
//                  analista, auxiliar, membro...). Vários Squads = a união das
//                  carteiras; o filtro de Squad da tela só RECORTA isto.
//   gestor do    → clientes ativos em que o usuário (interno) é responsável
//   cliente        ativo com papel = 'gestor' (cliente_responsaveis). Vínculo
//                  vigente que vale sozinho, só para LEITURA (ver escrita).
//   interno sem  → carteira VAZIA (tipo "nenhum"). Nunca "todos os clientes".
//   vínculo
//   demais       → sem acesso (seller, shopee_reviewer, desconhecido).
//
// O squadId que o frontend manda é filtro de exibição; a carteira sai SEMPRE
// destas queries.
//
// ESCRITA (lançamento manual): este escopo E a carteira global
// (authorizationService) — interseção, nunca ampliação. Com SQUADS_ENFORCEMENT
// desligado a carteira global de um interno é "todos", então é este escopo
// que restringe; ligado, as duas coincidem para quem é membro do Squad.

const pool = require("../../config/database");
const { resolverClienteRef, ehAdmin } = require("../squads/authorizationService");
const { ROLES_COBRADAS_NA_AUDITORIA } = require("../squads/rolesInternas");

// Papéis internos — fonte canônica (rolesInternas). Inclui `interno`, que
// requireAutomacoesAccess não aceita: por isso o Painel tem gate próprio.
const ROLES_INTERNAS = ROLES_COBRADAS_NA_AUDITORIA.set;

function ehInternoPainel(user) {
  return ROLES_INTERNAS.has(String(user?.role || "").toLowerCase());
}

function podeUsarPainel(user) {
  return ehAdmin(user) || ehInternoPainel(user);
}

function erro(statusCode, code, mensagem, extra = {}) {
  const e = new Error(mensagem);
  e.statusCode = statusCode;
  e.code = code;
  Object.assign(e, extra);
  return e;
}

function escopoVazio(tipo) {
  return { tipo, squads: [], squadsCoordenados: [], squadsGeridos: [], clientesComoGestor: 0, clientes: [] };
}

/**
 * @returns {Promise<{
 *   tipo: "admin"|"carteira"|"nenhum"|"sem_papel",
 *   squads: Array<{id:number,nome:string,slug:string,funcao:string|null}>,
 *   squadsCoordenados: Array<{id:number,nome:string,slug:string}>,
 *   squadsGeridos: Array<{id:number,nome:string,slug:string}>,
 *   clientesComoGestor: number,
 *   clientes: Array<{id:number,slug:string,nome:string}>,
 * }>}
 */
async function resolverEscopoPainel(user = {}, db = pool) {
  if (ehAdmin(user)) {
    const { rows } = await db.query(
      `/* painelAcesso:ADMIN_TODOS */
       SELECT c.id, c.slug, c.nome FROM clientes c
        WHERE c.ativo = true ORDER BY c.nome ASC`
    );
    return { ...escopoVazio("admin"), clientes: rows };
  }
  if (!ehInternoPainel(user)) return escopoVazio("sem_papel");

  const userId = Number(user?.id);
  if (!Number.isInteger(userId) || userId <= 0) return escopoVazio("nenhum");

  const [squadsDoUsuario, clientesDosSquads, clientesGestor] = await Promise.all([
    db.query(
      `/* painelAcesso:SQUADS_DO_USUARIO */
       SELECT s.id, s.nome, s.slug, sm.funcao
         FROM squad_members sm
         JOIN squads s ON s.id = sm.squad_id AND s.ativo = true
        WHERE sm.user_id = $1 AND sm.ativo = true
        ORDER BY s.nome ASC`,
      [userId]
    ),
    db.query(
      `/* painelAcesso:CLIENTES_DOS_SQUADS */
       SELECT DISTINCT c.id, c.slug, c.nome
         FROM cliente_squad_history csh
         JOIN clientes c ON c.id = csh.cliente_id AND c.ativo = true
         JOIN squads s ON s.id = csh.squad_id AND s.ativo = true
         JOIN squad_members sm ON sm.squad_id = s.id
          AND sm.user_id = $1 AND sm.ativo = true
        WHERE csh.fim_em IS NULL`,
      [userId]
    ),
    db.query(
      `/* painelAcesso:CLIENTES_GESTOR */
       SELECT DISTINCT c.id, c.slug, c.nome
         FROM cliente_responsaveis r
         JOIN clientes c ON c.id = r.cliente_id AND c.ativo = true
        WHERE r.user_id = $1 AND r.ativo = true AND r.papel = 'gestor'`,
      [userId]
    ),
  ]);

  const porId = new Map();
  for (const c of [...clientesDosSquads.rows, ...clientesGestor.rows]) porId.set(Number(c.id), c);
  const clientes = [...porId.values()].sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
  const temVinculo = squadsDoUsuario.rows.length > 0 || clientesGestor.rows.length > 0;

  // squad_members é único por (squad_id, user_id): uma linha por Squad.
  const squads = squadsDoUsuario.rows.map((s) => ({ id: Number(s.id), nome: s.nome, slug: s.slug, funcao: s.funcao || null }));
  const semFuncao = ({ id, nome, slug }) => ({ id, nome, slug });
  return {
    tipo: temVinculo ? "carteira" : "nenhum",
    squads,
    squadsCoordenados: squads.filter((s) => s.funcao === "coordenador").map(semFuncao),
    squadsGeridos: squads.filter((s) => s.funcao === "gestor").map(semFuncao),
    clientesComoGestor: clientesGestor.rows.length,
    clientes,
  };
}

// Resolve + autoriza UM cliente no escopo do Painel. Lança:
//   404 CLIENTE_NAO_ENCONTRADO
//   403 CLIENTE_FORA_DA_CARTEIRA (mesmo código canônico da carteira)
async function assertClienteNoPainel(user, ref, db = pool) {
  const cliente = await resolverClienteRef(ref, db);
  if (!cliente) throw erro(404, "CLIENTE_NAO_ENCONTRADO", "Cliente não encontrado.");
  // Admin: mesmo bypass de canAccessCliente (inclui cliente inativo).
  if (ehAdmin(user)) return cliente;

  const userId = Number(user?.id);
  const negado = () => erro(403, "CLIENTE_FORA_DA_CARTEIRA", "Cliente fora da sua carteira no Painel de Contas.", { clienteId: cliente.id });
  if (!ehInternoPainel(user) || !Number.isInteger(userId) || userId <= 0 || cliente.ativo === false) throw negado();

  const { rows } = await db.query(
    `/* painelAcesso:PODE_VER_CLIENTE */
     SELECT 1
      WHERE EXISTS (
              SELECT 1
                FROM cliente_squad_history csh
                JOIN squads s ON s.id = csh.squad_id AND s.ativo = true
                JOIN squad_members sm ON sm.squad_id = s.id
                 AND sm.user_id = $1 AND sm.ativo = true
               WHERE csh.cliente_id = $2 AND csh.fim_em IS NULL)
         OR EXISTS (
              SELECT 1 FROM cliente_responsaveis r
               WHERE r.cliente_id = $2 AND r.user_id = $1 AND r.ativo = true AND r.papel = 'gestor')`,
    [userId, cliente.id]
  );
  if (!rows.length) throw negado();
  return cliente;
}

// Gate de PAPEL das rotas do Painel: admin + papéis internos (inclui
// `interno`). Fica no lugar de requireAutomacoesAccess só aqui — Automações,
// Design e os demais módulos continuam com o gate deles.
function requirePainelContasAccess(req, res, next) {
  if (podeUsarPainel(req.user)) return next();
  return res.status(403).json({
    ok: false,
    code: "PAINEL_SEM_ACESSO",
    erro: "O Painel de Contas é exclusivo da equipe interna.",
  });
}

// Middleware das rotas por cliente (`/:clienteId/...`), leitura e escrita.
// Na escrita roda junto da carteira global (interseção) e o service repete as
// duas checagens.
function requireClienteNoPainel(param = "clienteId") {
  return async function clienteNoPainel(req, res, next) {
    try {
      req.clienteAutorizado = await assertClienteNoPainel(req.user || {}, req.params?.[param]);
      return next();
    } catch (err) {
      const status = Number.isFinite(Number(err?.statusCode)) ? Number(err.statusCode) : 500;
      if (status >= 500) {
        console.error("[painelContas] erro ao autorizar cliente:", err?.message);
        return res.status(500).json({ ok: false, erro: "Erro ao autorizar o acesso ao cliente." });
      }
      return res.status(status).json({ ok: false, code: err.code, erro: err.message });
    }
  };
}

module.exports = {
  resolverEscopoPainel, assertClienteNoPainel, requireClienteNoPainel,
  requirePainelContasAccess, podeUsarPainel,
};
