#!/usr/bin/env node
// server/scripts/sentinel-demo-server.js
// Servidor de DEMO LOCAL: monta SÓ /auth + /me + /sentinel + estático do Portal (Shell real).
// NÃO é o server/index.js: não lê server/.env, não roda workers/schedulers,
// não faz migrations de boot e só aceita PostgreSQL local (ver sentinel-demo-lib).
//
//   node server/scripts/sentinel-demo-seed.js     # 1x (recria o banco sentinel_demo)
//   node server/scripts/sentinel-demo-server.js   # http://127.0.0.1:8787/sentinel.html
//
// SQUADS_ENFORCEMENT=on por padrão (é o que isola um Squad do outro).

const { preparar } = require("./sentinel-demo-lib");
const { pool } = preparar();
process.env.SQUADS_ENFORCEMENT = process.env.SQUADS_ENFORCEMENT || "on";
process.env.JWT_SECRET = process.env.JWT_SECRET || "sentinel-demo-local-secret-nao-usar-em-producao-0123456789";

const fs = require("fs");
const path = require("path");
const express = require("express");

const app = express();
app.use(express.json());
app.use("/auth", require("../routes/authRoutes"));
app.use("/sentinel", require("../routes/sentinelRoutes"));
app.use("/me", require("../routes/meRoutes")); // boot do Shell (GET /me/context)

// Portal estático com o Shell REAL, apontado para ESTE servidor (nunca produção):
//  - HTML recebe <meta name="vf-api-base"> (lido por vf-config.js);
//  - .js com a URL de produção hardcoded é servido com ela trocada pela origem local.
// Só na demo: a página padrão pós-login (carteira/visão/cliente-operação) exige o schema completo
// do Portal (/me/portfolio e outros). Leva ao Sentinel; nada de produção é alterado.
app.get(/^\/(carteira|visao|cliente-operacao)\.html$/, (req, res) => res.redirect(302, "/sentinel.html"));

const PORTAL = path.join(__dirname, "..", "..", "Portal");
const origem = (req) => `${req.protocol}://${req.get("host")}`;
app.get(/\.html$|^\/$/, (req, res, next) => {
  const arq = path.join(PORTAL, req.path === "/" ? "index.html" : path.normalize(req.path).replace(/^(\.\.[/\\])+/, ""));
  if (!arq.startsWith(PORTAL) || !fs.existsSync(arq)) return next();
  const html = fs.readFileSync(arq, "utf8").replace(/<head>/i, `<head>\n<meta name="vf-api-base" content="${origem(req)}">`);
  res.type("html").send(html);
});
// Qualquer .js do Portal com a URL de produção hardcoded (login.js, seller.js...) é servido
// apontando para a origem local: a demo nunca manda credencial/token à produção.
app.get(/\.js$/, (req, res, next) => {
  const arq = path.join(PORTAL, path.normalize(req.path));
  if (!arq.startsWith(PORTAL) || !fs.existsSync(arq)) return next();
  res.type("js").send(fs.readFileSync(arq, "utf8").split("https://venforce-server.onrender.com").join(origem(req)));
});
app.use(express.static(PORTAL));

const PORT = Number(process.env.SENTINEL_DEMO_PORT) || 8787;
const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`Sentinel demo em http://127.0.0.1:${PORT}/sentinel.html  (enforcement=${process.env.SQUADS_ENFORCEMENT})`);
  console.log("Usuários (senha demo1234): admin@demo.test, ana@demo.test, bia@demo.test, caio@demo.test, vendedor@demo.test");
});
process.on("SIGINT", () => server.close(() => pool.end().then(() => process.exit(0))));
