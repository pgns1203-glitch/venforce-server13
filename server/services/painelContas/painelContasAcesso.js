// server/services/painelContas/painelContasAcesso.js
// Escopo de LEITURA do Painel de Contas — regra própria do Painel, decidida
// pela gestão em 01/10/2026 e INDEPENDENTE da flag global SQUADS_ENFORCEMENT
// (que continua governando os outros módulos via authorizationService):
//
//   admin        → todos os clientes ativos.
//   coordenador  → clientes ativos cujo Squad VIGENTE (cliente_squad_history,
//                  fim_em IS NULL) é um Squad ATIVO em que o usuário tem
//                  membership ativa com funcao = 'coordenador'.
//   gestor       → clientes ativos em que o usuário é responsável ativo com
//                  papel = 'gestor' (cliente_responsaveis). Hoje não há
//                  nenhum gestor ativo cadastrado: ninguém ganha acesso por
//                  suposição, mas o vínculo correto passa a valer sozinho
//                  quando existir.
//   demais       → sem acesso (auxiliar, designer, membro comum, sem vínculo).
//
// Não existe role "coordenador" nem "gestor": são vínculos reais do banco
// (função no Squad e responsabilidade no cliente), não papéis globais. O gate
// de papel continua antes disto (requireAutomacoesAccess: admin/user/membro).
//
// LEITURA apenas. Lançamento manual exige ISTO e, além disso, o gate de
// escrita que já existia (papel + carteira global) — nunca amplia escrita.

const pool = require("../../config/database");
const { resolverClienteRef, ehAdmin } = require("../squads/authorizationService");

function erro(statusCode, code, mensagem, extra = {}) {
  const e = new Error(mensagem);
  e.statusCode = statusCode;
  e.code = code;
  Object.assign(e, extra);
  return e;
}

/**
 * @returns {Promise<{
 *   tipo: "admin"|"carteira"|"nenhum",
 *   squadsCoordenados: Array<{id:number,nome:string,slug:string}>,
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
    return { tipo: "admin", squadsCoordenados: [], clientesComoGestor: 0, clientes: rows };
  }

  const userId = Number(user?.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return { tipo: "nenhum", squadsCoordenados: [], clientesComoGestor: 0, clientes: [] };
  }

  const [coordenados, clientesCoordenados, clientesGestor] = await Promise.all([
    db.query(
      `/* painelAcesso:SQUADS_COORDENADOS */
       SELECT s.id, s.nome, s.slug
         FROM squad_members sm
         JOIN squads s ON s.id = sm.squad_id AND s.ativo = true
        WHERE sm.user_id = $1 AND sm.ativo = true AND sm.funcao = 'coordenador'
        ORDER BY s.nome ASC`,
      [userId]
    ),
    db.query(
      `/* painelAcesso:CLIENTES_COORDENADOS */
       SELECT DISTINCT c.id, c.slug, c.nome
         FROM cliente_squad_history csh
         JOIN clientes c ON c.id = csh.cliente_id AND c.ativo = true
         JOIN squads s ON s.id = csh.squad_id AND s.ativo = true
         JOIN squad_members sm ON sm.squad_id = s.id
          AND sm.user_id = $1 AND sm.ativo = true AND sm.funcao = 'coordenador'
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
  for (const c of [...clientesCoordenados.rows, ...clientesGestor.rows]) porId.set(Number(c.id), c);
  const clientes = [...porId.values()].sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
  const temVinculo = coordenados.rows.length > 0 || clientesGestor.rows.length > 0;

  return {
    tipo: temVinculo ? "carteira" : "nenhum",
    squadsCoordenados: coordenados.rows.map((s) => ({ id: Number(s.id), nome: s.nome, slug: s.slug })),
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
  if (!Number.isInteger(userId) || userId <= 0 || cliente.ativo === false) throw negado();

  const { rows } = await db.query(
    `/* painelAcesso:PODE_VER_CLIENTE */
     SELECT 1
      WHERE EXISTS (
              SELECT 1
                FROM cliente_squad_history csh
                JOIN squads s ON s.id = csh.squad_id AND s.ativo = true
                JOIN squad_members sm ON sm.squad_id = s.id
                 AND sm.user_id = $1 AND sm.ativo = true AND sm.funcao = 'coordenador'
               WHERE csh.cliente_id = $2 AND csh.fim_em IS NULL)
         OR EXISTS (
              SELECT 1 FROM cliente_responsaveis r
               WHERE r.cliente_id = $2 AND r.user_id = $1 AND r.ativo = true AND r.papel = 'gestor')`,
    [userId, cliente.id]
  );
  if (!rows.length) throw negado();
  return cliente;
}

// Middleware das rotas de LEITURA por cliente (`/:clienteId/...`). Fica no
// lugar de requireClienteNaCarteira nessas rotas; as de escrita continuam com
// a carteira global E o escopo do Painel (no service).
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

module.exports = { resolverEscopoPainel, assertClienteNoPainel, requireClienteNoPainel };
