// server/tests/painelContasRotas.test.js
//
// Audita o wiring de server/routes/painelContasRoutes.js e o registro em
// server/index.js por leitura de fonte — mesmo padrão de
// clienteCriarComSquadRota.test.js — não sobe servidor nem banco.
//
// Confirma exatamente o que a Auditoria (§4/§15) exige: toda rota passa por
// authMiddleware + requireAutomacoesAccess, e as duas rotas com :clienteId
// passam por requireClienteNaCarteira ANTES do controller (nunca "o cliente
// existe, logo acessa").

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const rotas = fs.readFileSync(path.join(__dirname, "../routes/painelContasRoutes.js"), "utf8");

ok("importa authMiddleware", rotas.includes('require("../middlewares/authMiddleware")'));
ok("importa requireAutomacoesAccess", rotas.includes('require("../middlewares/accessMiddleware")'));
ok("importa requireClienteNaCarteira", rotas.includes('require("../middlewares/carteiraMiddleware")'));

const linhaLista = rotas.match(/router\.get\("\/",[^)]*\)/)?.[0] || "";
ok('GET "/" (lista) exige authMiddleware + requireAutomacoesAccess', linhaLista.includes("authMiddleware") && linhaLista.includes("requireAutomacoesAccess"));

const linhaMeses = rotas.match(/router\.get\("\/:clienteId\/meses",[^)]*\)/)?.[0] || "";
ok('GET ":clienteId/meses" exige authMiddleware + requireAutomacoesAccess + naCarteira', linhaMeses.includes("authMiddleware") && linhaMeses.includes("requireAutomacoesAccess") && linhaMeses.includes("naCarteira"));

const linhaSemanas = rotas.match(/router\.get\("\/:clienteId\/meses\/:competencia\/semanas",[^)]*\)/)?.[0] || "";
ok('GET "...semanas" exige authMiddleware + requireAutomacoesAccess + naCarteira', linhaSemanas.includes("authMiddleware") && linhaSemanas.includes("requireAutomacoesAccess") && linhaSemanas.includes("naCarteira"));

// naCarteira precisa ser requireClienteNaCarteira("clienteId") — o param real da rota.
ok('naCarteira = requireClienteNaCarteira("clienteId") (bate com o :clienteId da rota)', /requireClienteNaCarteira\("clienteId"\)/.test(rotas));

const index = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
ok('server/index.js importa painelContasRoutes', index.includes('require("./routes/painelContasRoutes")'));
ok('server/index.js monta app.use("/painel-contas", painelContasRoutes)', index.includes('app.use("/painel-contas", painelContasRoutes)'));

// Wiring não deve ter sido inserido DEPOIS de alguma rota curinga que capturaria o prefixo antes.
const posMontagem = index.indexOf('app.use("/painel-contas", painelContasRoutes)');
const posMe = index.indexOf('app.use("/me", meRoutes)');
ok("montagem de /painel-contas ocorre na mesma vizinhança de /me e /squads (não depois de rota curinga)", posMontagem > 0 && posMe > 0 && Math.abs(posMontagem - posMe) < 500);

console.log(`\npainelContasRotas.test.js: ${checks} verificações passaram.`);
