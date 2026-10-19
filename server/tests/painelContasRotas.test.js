// server/tests/painelContasRotas.test.js
//
// Audita o wiring de server/routes/painelContasRoutes.js e o registro em
// server/index.js por leitura de fonte — mesmo padrão de
// clienteCriarComSquadRota.test.js — não sobe servidor nem banco.
//
// Confirma exatamente o que a Auditoria (§4/§15) exige: toda rota passa por
// authMiddleware + requirePainelContasAccess (gate de papel PRÓPRIO do Painel:
// admin + papéis internos, inclusive `interno`); as LEITURAS com :clienteId
// passam pelo escopo do Painel (requireClienteNoPainel) e as ESCRITAS pelo
// escopo do Painel E pela carteira (requireClienteNaCarteira) ANTES do
// controller — nunca "o cliente existe, logo acessa". O gate de Automações
// (requireAutomacoesAccess) NÃO foi ampliado.

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
ok("importa requirePainelContasAccess do módulo de acesso do Painel", /\{[^}]*requirePainelContasAccess[^}]*\} = require\("\.\.\/services\/painelContas\/painelContasAcesso"\)/.test(rotas));
ok("não usa mais requireAutomacoesAccess (gate de outro módulo)", !rotas.includes('require("../middlewares/accessMiddleware")') && !/router\.\w+\([^)]*requireAutomacoesAccess/.test(rotas));
ok("importa requireClienteNaCarteira", rotas.includes('require("../middlewares/carteiraMiddleware")'));

const linhaLista = rotas.match(/router\.get\("\/",[^)]*\)/)?.[0] || "";
ok('GET "/" (lista) exige authMiddleware + requirePainelContasAccess', linhaLista.includes("authMiddleware") && linhaLista.includes("requirePainelContasAccess"));

const linhaMeses = rotas.match(/router\.get\("\/:clienteId\/meses",[^)]*\)/)?.[0] || "";
ok('GET ":clienteId/meses" exige authMiddleware + requirePainelContasAccess + noPainel', linhaMeses.includes("authMiddleware") && linhaMeses.includes("requirePainelContasAccess") && linhaMeses.includes("noPainel"));

const linhaSemanas = rotas.match(/router\.get\("\/:clienteId\/meses\/:competencia\/semanas",[^)]*\)/)?.[0] || "";
ok('GET "...semanas" exige authMiddleware + requirePainelContasAccess + noPainel', linhaSemanas.includes("authMiddleware") && linhaSemanas.includes("requirePainelContasAccess") && linhaSemanas.includes("noPainel"));

const linhaSemanasContas = rotas.match(/router\.get\("\/:clienteId\/contas\/semanas",[^)]*\)/)?.[0] || "";
ok('GET "...contas/semanas" exige authMiddleware + requirePainelContasAccess + noPainel', linhaSemanasContas.includes("authMiddleware") && linhaSemanasContas.includes("requirePainelContasAccess") && linhaSemanasContas.includes("noPainel"));

const linhaComposicao = rotas.match(/router\.get\("\/:clienteId\/contas\/composicao",[^)]*\)/)?.[0] || "";
ok('GET "...contas/composicao" exige authMiddleware + requirePainelContasAccess + noPainel', linhaComposicao.includes("authMiddleware") && linhaComposicao.includes("requirePainelContasAccess") && linhaComposicao.includes("noPainel"));

// Lançamento manual: escopo do Painel E carteira global (interseção).
ok('PUT/DELETE do lançamento manual usam o path com :clienteId/:contaId/:competencia', rotas.includes('"/:clienteId/contas/:contaId/manual/:competencia"'));
const linhaPut = rotas.match(/router\.put\(manual,[^)]*\)/)?.[0] || "";
ok("PUT manual exige authMiddleware + requirePainelContasAccess + noPainel + naCarteira", linhaPut.includes("authMiddleware") && linhaPut.includes("requirePainelContasAccess") && linhaPut.includes("noPainel") && linhaPut.includes("naCarteira"));
const linhaDelete = rotas.match(/router\.delete\(manual,[^)]*\)/)?.[0] || "";
ok("DELETE manual exige authMiddleware + requirePainelContasAccess + noPainel + naCarteira", linhaDelete.includes("authMiddleware") && linhaDelete.includes("requirePainelContasAccess") && linhaDelete.includes("noPainel") && linhaDelete.includes("naCarteira"));

// Atualização sob demanda dispara sync no Mercado Livre: mesmo gate de
// POST /central-vendas/:slug/sync-runs (requireAdmin + carteira).
ok('atualização usa o path "/:clienteId/atualizar/:competencia"', rotas.includes('"/:clienteId/atualizar/:competencia"'));
const linhaAtualizarPost = rotas.match(/router\.post\(atualizar,[^)]*\)/)?.[0] || "";
ok("POST atualizar exige authMiddleware + requireAdmin + naCarteira", linhaAtualizarPost.includes("authMiddleware") && linhaAtualizarPost.includes("requireAdmin") && linhaAtualizarPost.includes("naCarteira"));
const linhaAtualizarGet = rotas.match(/router\.get\(atualizar,[^)]*\)/)?.[0] || "";
ok("GET atualizar exige authMiddleware + requireAdmin + naCarteira", linhaAtualizarGet.includes("authMiddleware") && linhaAtualizarGet.includes("requireAdmin") && linhaAtualizarGet.includes("naCarteira"));

// Rastreabilidade (leitura) do lançamento manual: escopo do Painel.
const linhaLancamentos = rotas.match(/router\.get\("\/:clienteId\/contas\/:contaId\/manual",[^)]*\)/)?.[0] || "";
ok('GET "...contas/:contaId/manual" exige authMiddleware + requirePainelContasAccess + noPainel', linhaLancamentos.includes("authMiddleware") && linhaLancamentos.includes("requirePainelContasAccess") && linhaLancamentos.includes("noPainel"));
const linhaHistorico = rotas.match(/router\.get\(`\$\{manual\}\/historico`,[^)]*\)/)?.[0] || "";
ok('GET "...manual/:competencia/historico" exige authMiddleware + requirePainelContasAccess + noPainel', linhaHistorico.includes("authMiddleware") && linhaHistorico.includes("requirePainelContasAccess") && linhaHistorico.includes("noPainel"));
ok('noPainel = requireClienteNoPainel("clienteId")', /requireClienteNoPainel\("clienteId"\)/.test(rotas));
ok("nenhuma leitura por cliente usa só a carteira global", !/router\.get\("\/:clienteId[^)]*naCarteira/.test(rotas));

// naCarteira precisa ser requireClienteNaCarteira("clienteId") — o param real da rota.
ok('naCarteira = requireClienteNaCarteira("clienteId") (bate com o :clienteId da rota)', /requireClienteNaCarteira\("clienteId"\)/.test(rotas));

const index = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
ok('server/index.js importa painelContasRoutes', index.includes('require("./routes/painelContasRoutes")'));
ok('server/index.js monta app.use("/painel-contas", painelContasRoutes)', index.includes('app.use("/painel-contas", painelContasRoutes)'));

// Wiring não deve ter sido inserido DEPOIS de alguma rota curinga que capturaria o prefixo antes.
const posMontagem = index.indexOf('app.use("/painel-contas", painelContasRoutes)');
const posMe = index.indexOf('app.use("/me", meRoutes)');
ok("montagem de /painel-contas ocorre na mesma vizinhança de /me e /squads (não depois de rota curinga)", posMontagem > 0 && posMe > 0 && Math.abs(posMontagem - posMe) < 500);

// ── Comportamento do gate de papel (sem banco) ─────────────────────────────
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://nobody@127.0.0.1:1/teste-sem-banco";
const { requirePainelContasAccess } = require("../services/painelContas/painelContasAcesso");
const { requireAutomacoesAccess } = require("../middlewares/accessMiddleware");
function passa(gate, role) {
  let liberou = false;
  let status = null;
  const res = { status(c) { status = c; return this; }, json() { return this; } };
  gate({ user: role === undefined ? undefined : { id: 1, role } }, res, () => { liberou = true; });
  return liberou ? 200 : status;
}
for (const role of ["admin", "user", "membro", "interno", "INTERNO"]) {
  ok(`Painel: papel "${role}" passa no gate`, passa(requirePainelContasAccess, role) === 200);
}
for (const role of ["seller", "shopee_reviewer", "", "qualquer", undefined]) {
  ok(`Painel: papel "${role}" → 403`, passa(requirePainelContasAccess, role) === 403);
}
ok("Automações continua SEM o papel interno (permissão global não ampliada)", passa(requireAutomacoesAccess, "interno") === 403);
ok("Automações continua com user/membro/admin", ["admin", "user", "membro"].every((r) => passa(requireAutomacoesAccess, r) === 200));

console.log(`\npainelContasRotas.test.js: ${checks} verificações passaram.`);
