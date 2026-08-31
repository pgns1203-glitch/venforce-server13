// server/controllers/clienteResponsaveisController.js
// P2.4 — Responsabilidades de Cliente. Sem frontend nesta fase.
//
// RESPONSABILIDADE NÃO É AUTORIZAÇÃO. Estas rotas NÃO concedem nem checam
// acesso a dado operacional — só organizam gestor/auxiliar/designer. O gate
// de acesso ao Cliente continua sendo o Squad (requireClienteNaCarteira).
//
// RBAC de administração:
//   admin        -> gerencia responsáveis de qualquer Cliente
//   coordenador  -> SOMENTE Clientes do próprio Squad. Coordenador de Squad
//                   NÃO é admin global: fora do seu Squad, não administra nada.
//   demais       -> leitura (quando o Cliente está na carteira), sem escrita.

const service = require("../services/squads/clienteResponsaveisService");
const squadsRepo = require("../services/squads/squadsRepository");

function ehAdmin(req) {
  return String(req.user?.role || "").toLowerCase() === "admin";
}

function erroResposta(res, err, contexto) {
  const status = Number.isFinite(Number(err?.statusCode)) ? Number(err.statusCode) : 500;
  if (status >= 500) console.error(`[responsaveis] ${contexto}:`, err?.message);
  const body = { ok: false, erro: err?.message || "Erro interno." };
  if (err?.code) body.code = err.code;
  return res.status(status).json(body);
}

// admin OU coordenador do Squad ATIVO do cliente da rota. Roda depois de
// requireClienteNaCarteira("cliente") — usa req.clienteAutorizado.
async function requireResponsabilidadeAdmin(req, res, next) {
  try {
    if (ehAdmin(req)) return next();
    const clienteId = req.clienteAutorizado?.id;
    if (!clienteId) {
      return res.status(404).json({ ok: false, code: "CLIENTE_NAO_ENCONTRADO", erro: "Cliente não encontrado." });
    }
    const squadAtivo = await squadsRepo.squadAtivoDoCliente(clienteId);
    if (squadAtivo && (await squadsRepo.ehCoordenadorDoSquad(req.user.id, squadAtivo.squad_id))) {
      req.coordenadorDoSquad = squadAtivo.squad_id;
      return next();
    }
    return res.status(403).json({
      ok: false,
      code: "RESPONSABILIDADE_ADMIN_REQUERIDA",
      erro: "Administração de responsáveis restrita ao coordenador do Squad do cliente ou a um administrador.",
    });
  } catch (err) {
    return erroResposta(res, err, "requireResponsabilidadeAdmin");
  }
}

async function listar(req, res) {
  try {
    const dados = await service.listar(req.clienteAutorizado.id, {
      incluirEncerrados: req.query.historico === "true",
    });
    return res.json({ ok: true, ...dados });
  } catch (err) {
    return erroResposta(res, err, "listar");
  }
}

async function atribuir(req, res) {
  try {
    const r = await service.atribuir(
      req.clienteAutorizado.id,
      {
        userId: req.body?.userId,
        papel: req.body?.papel,
        permitirSemAcesso: req.body?.permitirSemAcesso === true,
        motivoMigracao: req.body?.motivoMigracao || null,
      },
      req.user.id
    );
    return res.status(201).json({ ok: true, ...r });
  } catch (err) {
    return erroResposta(res, err, "atribuir");
  }
}

async function trocar(req, res) {
  try {
    const r = await service.trocar(
      req.clienteAutorizado.id,
      req.params.papel,
      {
        novoUserId: req.body?.userId,
        permitirSemAcesso: req.body?.permitirSemAcesso === true,
        motivoMigracao: req.body?.motivoMigracao || null,
      },
      req.user.id
    );
    return res.json({ ok: true, ...r });
  } catch (err) {
    return erroResposta(res, err, "trocar");
  }
}

async function remover(req, res) {
  try {
    const r = await service.remover(
      req.clienteAutorizado.id,
      {
        userId: req.params.userId,
        papel: req.params.papel,
        motivoMigracao: req.body?.motivoMigracao || null,
      },
      req.user.id
    );
    return res.json({ ok: true, ...r });
  } catch (err) {
    return erroResposta(res, err, "remover");
  }
}

module.exports = { requireResponsabilidadeAdmin, listar, atribuir, trocar, remover };
