// server/tests/jwtSecretSeguranca.test.js
//
// V3 P2.7 BLOCO Q — segurança de configuração do segredo de assinatura.
//
// O BUG: cinco arquivos faziam, cada um por conta própria,
//     const JWT_SECRET = process.env.JWT_SECRET || "venforce_secret_local";
// Um segredo de assinatura escrito no código não é segredo: quem lê o
// repositório consegue FORJAR um JWT com role:"admin" e passar por qualquer
// middleware de autorização — inclusive o bypass de admin do
// authorizationService. E era silencioso: subir em produção sem JWT_SECRET não
// dava erro nem aviso.
//
// Este teste NÃO assume ambiente de produção para a suíte: ele chama a função
// pura `resolverJwtSecret` com o ambiente que quer exercitar, então rodar a
// suíte continua ergonômico (BLOCO Q: "não quebrar suíte por assumir env de
// produção em testes").

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  resolverJwtSecret,
  getJwtSecret,
  SEGREDO_DEV,
  TAMANHO_MINIMO_PRODUCAO,
} = require("../config/jwtSecret");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function lancaCom(label, fn, verificar) {
  let erro = null;
  try { fn(); } catch (e) { erro = e; }
  assert.ok(erro, `FALHOU (nao lancou): ${label}`);
  if (verificar) assert.ok(verificar(erro), `FALHOU (erro inesperado): ${label} — ${erro.message}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const SEGREDO_FORTE = "a".repeat(TAMANHO_MINIMO_PRODUCAO);

// ------------------------------------------------------------- PRODUCAO
lancaCom("producao SEM JWT_SECRET nao sobe (era fallback silencioso)",
  () => resolverJwtSecret({ jwtSecret: undefined, nodeEnv: "production" }),
  (e) => e.code === "JWT_SECRET_INSEGURO" && /obrigat/i.test(e.message));

lancaCom("producao com JWT_SECRET vazio nao sobe",
  () => resolverJwtSecret({ jwtSecret: "   ", nodeEnv: "production" }),
  (e) => e.code === "JWT_SECRET_INSEGURO");

lancaCom("producao RECUSA explicitamente o segredo de desenvolvimento",
  () => resolverJwtSecret({ jwtSecret: SEGREDO_DEV, nodeEnv: "production" }),
  (e) => e.code === "JWT_SECRET_INSEGURO" && /desenvolvimento/i.test(e.message));

lancaCom("producao recusa segredo curto demais para forca bruta offline",
  () => resolverJwtSecret({ jwtSecret: "curto", nodeEnv: "production" }),
  (e) => e.code === "JWT_SECRET_INSEGURO" && new RegExp(String(TAMANHO_MINIMO_PRODUCAO)).test(e.message));

ok("producao com segredo proprio e forte sobe normalmente",
  resolverJwtSecret({ jwtSecret: SEGREDO_FORTE, nodeEnv: "production" }) === SEGREDO_FORTE);

ok("producao tolera espacos em volta do segredo",
  resolverJwtSecret({ jwtSecret: `  ${SEGREDO_FORTE}  `, nodeEnv: "production" }) === SEGREDO_FORTE);

ok("PRODUCTION em caixa alta tambem e producao",
  (() => { try { resolverJwtSecret({ jwtSecret: "", nodeEnv: "PRODUCTION" }); return false; } catch { return true; } })());

// ----------------------------------------------------------- DEV / TESTE
ok("dev sem JWT_SECRET continua ergonomico (fallback local)",
  resolverJwtSecret({ jwtSecret: undefined, nodeEnv: "development" }) === SEGREDO_DEV);
ok("ambiente de teste sem JWT_SECRET tambem funciona",
  resolverJwtSecret({ jwtSecret: undefined, nodeEnv: "test" }) === SEGREDO_DEV);
ok("NODE_ENV ausente e tratado como dev",
  resolverJwtSecret({ jwtSecret: undefined, nodeEnv: undefined }) === SEGREDO_DEV);
ok("dev com segredo proprio usa o proprio, mesmo curto",
  resolverJwtSecret({ jwtSecret: "meu-segredo-de-dev", nodeEnv: "development" }) === "meu-segredo-de-dev");

// --------------------------------------------- getJwtSecret e process.env
{
  const envAntes = { jwt: process.env.JWT_SECRET, node: process.env.NODE_ENV };
  try {
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = "test";
    ok("getJwtSecret resolve pelo process.env", getJwtSecret() === SEGREDO_DEV);

    // Cache tem que ser invalidado quando o env muda — senao o valor congela
    // na ordem de import, que era metade do problema original.
    process.env.JWT_SECRET = "outro-segredo-de-dev";
    ok("getJwtSecret reage a mudanca de env (cache invalidado)", getJwtSecret() === "outro-segredo-de-dev");

    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = SEGREDO_DEV;
    lancaCom("getJwtSecret aplica a regra de producao", () => getJwtSecret(), (e) => e.code === "JWT_SECRET_INSEGURO");
  } finally {
    if (envAntes.jwt === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = envAntes.jwt;
    if (envAntes.node === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = envAntes.node;
  }
}

// ------------------------- nenhum arquivo volta a ter o fallback embutido
{
  const raiz = path.join(__dirname, "..");
  const ignorar = new Set(["node_modules", "tests", "uploads", "downloads", ".git"]);
  const ofensores = [];
  (function varrer(dir) {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ignorar.has(entrada.name)) continue;
      const completo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) { varrer(completo); continue; }
      if (!entrada.name.endsWith(".js")) continue;
      if (completo === path.join(raiz, "config", "jwtSecret.js")) continue; // a unica fonte
      if (fs.readFileSync(completo, "utf8").includes(SEGREDO_DEV)) ofensores.push(completo);
    }
  })(raiz);
  ok(`o segredo de dev existe em UM lugar so (encontrado em: ${ofensores.join(", ") || "nenhum outro"})`, ofensores.length === 0);
}

console.log(`\njwtSecretSeguranca.test.js: ${checks} verificacoes passaram.`);
