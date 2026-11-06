#!/usr/bin/env node
// server/scripts/financeiro/fechamentoAssistidoServer.js
//
// Interface web LOCAL da bancada de fechamento assistido.
//
//   node scripts/financeiro/fechamentoAssistidoServer.js [--port 4789]
//   → abrir http://localhost:4789
//
// - Escuta só em 127.0.0.1 (não fica exposta na rede).
// - Sem banco, sem Portal, sem request externo: só chama runFechamentoAssistido
//   (motor oficial + overrides temporários) sobre as planilhas enviadas.
// - As planilhas ficam em memória enquanto o processo roda; nada é gravado
//   em disco. Fechou o processo, acabou.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const {
  runFechamentoAssistido,
  parseInputBuffers,
  sha256,
} = require("./fechamentoAssistido");

const HTML_PATH = path.join(__dirname, "fechamentoAssistido.html");
const MAX_BODY_BYTES = 80 * 1024 * 1024;
const MAX_SESSIONS = 10;

// sessionId → { inputs, files, createdAt }
const sessions = new Map();

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Arquivos grandes demais (limite 80 MB no total)."), { bancada: true }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(Object.assign(new Error("JSON inválido."), { bancada: true }));
      }
    });
    req.on("error", reject);
  });
}

function decodeFile(entry) {
  if (!entry || !entry.base64) return null;
  return Buffer.from(entry.base64, "base64");
}

function publicRun(run, session) {
  return {
    sessionId: session.id,
    arquivos: session.files,
    summaryOriginal: run.summaryOriginal,
    summaryAssisted: run.summaryAssisted,
    comparison: run.comparison,
    rowsOriginal: run.rowsOriginal,
    rowsAssisted: run.rowsAssisted,
    outOfRevenueOriginal: run.outOfRevenueOriginal,
    outOfRevenueAssisted: run.outOfRevenueAssisted,
    differences: run.differences,
    audit: run.audit,
    warnings: run.warnings,
    executiveNotes: run.assisted.summary.executiveNotes || [],
  };
}

function runSession(session, overrides) {
  const run = runFechamentoAssistido({ ...session.inputs, overrides: overrides || null });
  return publicRun(run, session);
}

async function handleLoad(req, res) {
  const body = await readJsonBody(req);
  const buffers = {
    performanceBuffer: decodeFile(body.performance),
    ordersBuffer: decodeFile(body.orders),
    costsBuffer: decodeFile(body.costs),
  };
  const files = {};
  for (const [label, key] of [["performance", "performanceBuffer"], ["orders", "ordersBuffer"], ["costs", "costsBuffer"]]) {
    if (buffers[key]) files[label] = { nome: body[label].name || label, bytes: buffers[key].length, sha256: sha256(buffers[key]) };
  }
  const inputs = parseInputBuffers(buffers);
  const session = { id: crypto.randomUUID(), inputs, files, createdAt: Date.now() };
  const payload = runSession(session, body.overrides);
  sessions.set(session.id, session);
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  sendJson(res, 200, payload);
}

async function handleRun(req, res) {
  const body = await readJsonBody(req);
  const session = sessions.get(String(body.sessionId || ""));
  if (!session) {
    sendJson(res, 404, { error: "Sessão não encontrada (o servidor foi reiniciado?). Processe as planilhas de novo." });
    return;
  }
  sendJson(res, 200, runSession(session, body.overrides));
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(fs.readFileSync(HTML_PATH));
        return;
      }
      if (req.method === "POST" && req.url === "/api/load") return await handleLoad(req, res);
      if (req.method === "POST" && req.url === "/api/run") return await handleRun(req, res);
      sendJson(res, 404, { error: "Rota não encontrada." });
    } catch (error) {
      if (!error.bancada) console.error(error);
      sendJson(res, error.bancada || error.statusCode ? 400 : 500, { error: error.message });
    }
  });
}

if (require.main === module) {
  const portIndex = process.argv.indexOf("--port");
  const port = portIndex > -1 ? Number(process.argv[portIndex + 1]) : 4789;
  createServer().listen(port, "127.0.0.1", () => {
    console.log(`Bancada de fechamento assistido: http://localhost:${port}`);
    console.log("Local apenas (127.0.0.1). Sem banco. Ctrl+C encerra e descarta tudo.");
  });
}

module.exports = { createServer };
