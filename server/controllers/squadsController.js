// server/controllers/squadsController.js
// APIs administrativas de Squads (mission §24/§25). Sem frontend.
//
// RBAC:
//   admin       -> tudo
//   coordenador -> somente o proprio Squad (listar, membros, atribuir
//                  cliente do proprio squad). Transferencia entre squads e
//                  ativar/desativar squad sao admin-only (§26).

const squadService = require("../services/squads/squadService");
const squadsRepo = require("../services/squads/squadsRepository");
const migracaoService = require("../services/squads/squadsMigracaoService");

function erroResposta(res, err, contexto) {
  const status = Number.isFinite(Number(err?.statusCode)) ? Number(err.statusCode) : 500;
  if (status >= 500) console.error(`[squads] ${contexto}:`, err?.message);
  const body = { ok: false, erro: err?.message || "Erro interno." };
  if (err?.code) body.code = err.code;
  return res.status(status).json(body);
}

function ehAdmin(req) {
  return String(req.user?.role || "").toLowerCase() === "admin";
}

// Middleware: admin OU coordenador do :id (squad da rota).
async function requireSquadAdmin(req, res, next) {
  try {
    if (ehAdmin(req)) return next();
    const squadId = Number(req.params.id);
    if (Number.isInteger(squadId) && (await squadsRepo.ehCoordenadorDoSquad(req.user.id, squadId))) {
      req.coordenadorDoSquad = squadId;
      return next();
    }
    return res.status(403).json({ ok: false, erro: "Acesso restrito ao coordenador do squad ou a um administrador." });
  } catch (err) {
    return erroResposta(res, err, "requireSquadAdmin");
  }
}

/* ─────────────────────────── squads ─────────────────────────── */

async function listar(req, res) {
  try {
    if (ehAdmin(req)) {
      const squads = await squadsRepo.listarSquads({ apenasAtivos: req.query.ativos === "true" });
      return res.json({ ok: true, squads });
    }
    // Nao-admin: so os squads onde e membro.
    const memberships = await squadsRepo.membershipsDoUsuario(req.user.id);
    const ids = memberships.map((m) => m.squad_id);
    const squads = ids.length ? await squadsRepo.listarSquads({ squadIds: ids }) : [];
    return res.json({ ok: true, squads });
  } catch (err) {
    return erroResposta(res, err, "listar");
  }
}

async function obter(req, res) {
  try {
    const squad = await squadsRepo.obterSquadPorId(req.params.id);
    if (!squad) return res.status(404).json({ ok: false, erro: "Squad não encontrado." });
    return res.json({ ok: true, squad });
  } catch (err) {
    return erroResposta(res, err, "obter");
  }
}

async function criar(req, res) {
  try {
    const squad = await squadService.criarSquad(
      { nome: req.body?.nome, slug: req.body?.slug },
      req.user.id
    );
    return res.status(201).json({ ok: true, squad });
  } catch (err) {
    return erroResposta(res, err, "criar");
  }
}

async function editar(req, res) {
  try {
    const patch = {};
    if (req.body?.nome !== undefined) patch.nome = req.body.nome;
    // slug e ativo sao admin-only (coordenador so muda o nome do proprio squad).
    if (ehAdmin(req)) {
      if (req.body?.slug !== undefined) patch.slug = req.body.slug;
      if (req.body?.ativo !== undefined) patch.ativo = req.body.ativo;
    }
    const squad = await squadService.editarSquad(req.params.id, patch, req.user.id);
    return res.json({ ok: true, squad });
  } catch (err) {
    return erroResposta(res, err, "editar");
  }
}

async function definirAtivo(req, res) {
  try {
    const squad = await squadService.editarSquad(
      req.params.id,
      { ativo: Boolean(req.body?.ativo) },
      req.user.id
    );
    return res.json({ ok: true, squad });
  } catch (err) {
    return erroResposta(res, err, "definirAtivo");
  }
}

/* ─────────────────────────── membros ─────────────────────────── */

async function listarMembros(req, res) {
  try {
    const membros = await squadsRepo.membrosDoSquad(req.params.id);
    return res.json({ ok: true, membros });
  } catch (err) {
    return erroResposta(res, err, "listarMembros");
  }
}

async function adicionarMembro(req, res) {
  try {
    const membership = await squadService.adicionarMembro(
      req.params.id,
      req.body?.userId,
      { funcao: req.body?.funcao || "membro", isPrimary: req.body?.isPrimary === true },
      req.user.id
    );
    return res.status(201).json({ ok: true, membership });
  } catch (err) {
    return erroResposta(res, err, "adicionarMembro");
  }
}

async function removerMembro(req, res) {
  try {
    const r = await squadService.removerMembro(req.params.id, req.params.userId, req.user.id);
    return res.json({ ok: true, ...r });
  } catch (err) {
    return erroResposta(res, err, "removerMembro");
  }
}

async function definirPrincipal(req, res) {
  try {
    const r = await squadService.definirPrincipal(req.params.id, req.params.userId, req.user.id);
    return res.json({ ok: true, ...r });
  } catch (err) {
    return erroResposta(res, err, "definirPrincipal");
  }
}

async function definirFuncao(req, res) {
  try {
    const membership = await squadService.definirFuncao(
      req.params.id, req.params.userId, req.body?.funcao, req.user.id
    );
    return res.json({ ok: true, membership });
  } catch (err) {
    return erroResposta(res, err, "definirFuncao");
  }
}

/* ─────────────────────── clientes do squad ─────────────────────── */

async function listarClientes(req, res) {
  try {
    const clientes = await squadsRepo.clientesDoSquad(req.params.id);
    return res.json({ ok: true, clientes });
  } catch (err) {
    return erroResposta(res, err, "listarClientes");
  }
}

async function atribuirCliente(req, res) {
  try {
    const r = await squadService.atribuirCliente(
      req.params.id,
      req.body?.clienteId,
      { motivo: req.body?.motivo || null },
      req.user.id
    );
    return res.status(201).json({ ok: true, vinculo: r });
  } catch (err) {
    return erroResposta(res, err, "atribuirCliente");
  }
}

// admin-only (rota). Transfere um cliente PARA o :id (squad de destino).
async function transferirCliente(req, res) {
  try {
    const r = await squadService.transferirCliente(
      req.params.clienteId,
      req.params.id,
      { motivo: req.body?.motivo || null },
      req.user.id
    );
    return res.json({ ok: true, resultado: r });
  } catch (err) {
    return erroResposta(res, err, "transferirCliente");
  }
}

async function historicoCliente(req, res) {
  try {
    const historico = await squadsRepo.historicoDoCliente(req.params.clienteId);
    return res.json({ ok: true, historico });
  } catch (err) {
    return erroResposta(res, err, "historicoCliente");
  }
}

/* ─────────────────────────── migração ─────────────────────────── */

async function auditoriaMigracao(req, res) {
  try {
    const relatorio = await migracaoService.auditoria();
    return res.json({ ok: true, ...relatorio });
  } catch (err) {
    return erroResposta(res, err, "auditoriaMigracao");
  }
}

module.exports = {
  requireSquadAdmin,
  listar,
  obter,
  criar,
  editar,
  definirAtivo,
  listarMembros,
  adicionarMembro,
  removerMembro,
  definirPrincipal,
  definirFuncao,
  listarClientes,
  atribuirCliente,
  transferirCliente,
  historicoCliente,
  auditoriaMigracao,
};
