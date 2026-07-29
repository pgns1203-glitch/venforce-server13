// server/controllers/observabilityController.js
// Camada HTTP da observabilidade. Só admin chega aqui (ver routes).
// Falha de banco vira 503 com `degradado: true` — o Control Center precisa
// distinguir "não há dados" de "não consegui ler os dados".

"use strict";

const service = require("../services/observabilityService");
const S = require("../utils/observabilitySanitizer");

const CONFIRMACAO_PURGE = "EXCLUIR HISTORICO";

function falhar(res, err, contexto) {
  const mensagem = S.sanitizeMessage(err?.message, 300) || "erro desconhecido";
  const indisponivel = /relation .* does not exist|ECONNREFUSED|ETIMEDOUT|termina|Connection terminated|password authentication/i
    .test(err?.message || "");
  console.error(`[observability] ${contexto}: ${mensagem}`);
  return res.status(indisponivel ? 503 : 500).json({
    ok: false,
    erro: indisponivel
      ? "Histórico indisponível: o PostgreSQL não respondeu ou as tabelas de observabilidade ainda não existem."
      : mensagem,
    degradado: true,
    contexto,
  });
}

async function getSummary(req, res) {
  try {
    const resumo = await service.getSummary(req.query);
    res.json({ ok: true, resumo });
  } catch (err) {
    falhar(res, err, "summary");
  }
}

async function listRequests(req, res) {
  try {
    const dados = await service.listRequests(req.query);
    res.json({ ok: true, ...dados });
  } catch (err) {
    falhar(res, err, "requests");
  }
}

async function getRequestDetail(req, res) {
  try {
    const detalhe = await service.getRequestDetail(req.params.requestId);
    if (!detalhe) {
      return res.status(404).json({
        ok: false,
        erro: "Nenhum registro encontrado para este request id.",
        motivo: "pode ter expirado pela retenção, nunca ter sido persistido ou o id estar errado",
      });
    }
    res.json({ ok: true, detalhe });
  } catch (err) {
    falhar(res, err, "request-detail");
  }
}

async function getErrors(req, res) {
  try {
    const erros = await service.getErrors(req.query);
    res.json({ ok: true, ...erros });
  } catch (err) {
    falhar(res, err, "errors");
  }
}

async function getSessions(req, res) {
  try {
    const sessoes = await service.getSessions(req.query);
    res.json({ ok: true, sessoes });
  } catch (err) {
    falhar(res, err, "sessions");
  }
}

function ingestClientEvents(req, res) {
  try {
    const corpo = req.body || {};
    const eventos = Array.isArray(corpo) ? corpo : corpo.events;

    if (!Array.isArray(eventos)) {
      return res.status(400).json({
        ok: false,
        erro: "Envie { events: [...] } com no máximo " + service.CLIENT_BATCH_MAX_EVENTS + " eventos.",
      });
    }

    const resultado = service.ingestClientEvents(eventos, {
      userId: req.user?.id ?? null,
      userEmail: req.user?.email ?? null,
    });

    res.json({ ok: true, ...resultado, limiteLote: service.CLIENT_BATCH_MAX_EVENTS });
  } catch (err) {
    // Ingestão nunca devolve 500 por evento malformado: o navegador não deve
    // ficar reenviando lote quebrado em loop.
    console.error("[observability] ingestão de eventos falhou:", err.message);
    res.status(400).json({ ok: false, erro: S.sanitizeMessage(err.message, 240) });
  }
}

async function getHealth(req, res) {
  try {
    const saude = await service.getHealth();
    res.json({ ok: true, saude });
  } catch (err) {
    falhar(res, err, "health");
  }
}

async function postHealthCheck(req, res) {
  try {
    const alvos = Array.isArray(req.body?.alvos) ? req.body.alvos.map(String) : null;
    const resultado = await service.runHealthChecks(alvos);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    falhar(res, err, "health-check");
  }
}

function getRoutes(req, res) {
  try {
    const inventario = service.buildRouteInventory(req.app);
    res.json({ ok: inventario.ok, ...inventario });
  } catch (err) {
    res.status(500).json({ ok: false, erro: S.sanitizeMessage(err.message, 240), rotas: [] });
  }
}

async function getRouteStats(req, res) {
  try {
    const estatisticas = await service.getRouteStats(req.query);
    res.json({ ok: true, estatisticas });
  } catch (err) {
    falhar(res, err, "route-stats");
  }
}

async function getExport(req, res) {
  try {
    const formato = String(req.query.format || "json").toLowerCase();
    const linhas = await service.exportRequests(req.query);
    const carimbo = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

    if (formato === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="observabilidade-${carimbo}.csv"`);
      return res.send(service.toCsv(linhas));
    }

    res.setHeader("Content-Disposition", `attachment; filename="observabilidade-${carimbo}.json"`);
    res.json({ ok: true, geradoEm: new Date().toISOString(), total: linhas.length, requests: linhas });
  } catch (err) {
    falhar(res, err, "export");
  }
}

async function postPurge(req, res) {
  try {
    if (String(req.body?.confirmacao || "") !== CONFIRMACAO_PURGE) {
      return res.status(400).json({
        ok: false,
        erro: `Confirmação obrigatória. Envie { "confirmacao": "${CONFIRMACAO_PURGE}" }.`,
      });
    }
    const removidos = await service.purge({ before: req.body?.antesDe });
    res.json({ ok: true, ...removidos });
  } catch (err) {
    falhar(res, err, "purge");
  }
}

module.exports = {
  CONFIRMACAO_PURGE,
  getSummary,
  listRequests,
  getRequestDetail,
  getErrors,
  getSessions,
  ingestClientEvents,
  getHealth,
  postHealthCheck,
  getRoutes,
  getRouteStats,
  getExport,
  postPurge,
};
