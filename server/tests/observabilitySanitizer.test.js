// server/tests/observabilitySanitizer.test.js
// Redação é a parte da observabilidade que não pode falhar em silêncio: um
// token que vaza para observability_requests fica gravado no PostgreSQL e sai
// em qualquer export. Estes testes fixam o comportamento.
//
// Roda sem infra: node tests/observabilitySanitizer.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const S = require("../utils/observabilitySanitizer");

let passou = 0;
const ok = (nome, condicao) => {
  assert.ok(condicao, `FALHOU: ${nome}`);
  passou++;
  console.log(`  ok  ${nome}`);
};

console.log("\n▸ 1. Chaves sensíveis");
{
  const sensiveis = [
    "authorization", "Authorization", "cookie", "Set-Cookie", "token", "access_token",
    "refresh_token", "api_key", "apikey", "x-api-key", "password", "senha", "secret",
    "client_secret", "credential", "private_key", "code", "jwt",
  ];
  sensiveis.forEach((chave) => {
    ok(`"${chave}" é tratada como sensível`, S.isSensitiveKey(chave) === true);
  });

  // O ponto crítico: `code` por substring destruiria colunas legítimas.
  const legitimas = ["status_code", "statusCode", "error_code", "zip_code", "codigo_barras", "content_type", "duration_ms", "request_id"];
  legitimas.forEach((chave) => {
    ok(`"${chave}" NÃO é mascarada`, S.isSensitiveKey(chave) === false);
  });
}

console.log("\n▸ 2. Valores que parecem segredo");
{
  ok("Bearer é detectado", S.looksSensitiveValue("Bearer abc.def.ghi"));
  ok("JWT solto é detectado", S.looksSensitiveValue("eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MX0.assinatura"));
  ok("api key vf_ é detectada", S.looksSensitiveValue("vf_" + "a".repeat(32)));
  ok("chave privada PEM é detectada", S.looksSensitiveValue("-----BEGIN RSA PRIVATE KEY-----\nMIIE"));
  ok("texto comum não é detectado", S.looksSensitiveValue("Base não encontrada") === false);
  ok("slug comum não é detectado", S.looksSensitiveValue("loja-meli-principal") === false);
}

console.log("\n▸ 3. Máscara nunca devolve o segredo");
{
  const token = "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MX0.assinaturaSuperSecreta";
  const mascarado = S.maskValue(`Bearer ${token}`);
  ok("prefixo Bearer é preservado", mascarado.startsWith("Bearer "));
  ok("nenhum trecho do token sobrevive", mascarado.indexOf("eyJ") === -1 && mascarado.indexOf("assinatura") === -1);
  ok("valor puro vira [redacted]", S.maskValue("qualquer-senha") === S.REDACTED);
}

console.log("\n▸ 4. Truncamento de strings");
{
  const longa = "x".repeat(5000);
  const cortada = S.truncateString(longa, 100);
  ok("string é cortada no limite", cortada.length < 200);
  ok("truncamento é explícito", cortada.includes("truncado"));
  ok("string curta passa intacta", S.truncateString("ok", 100) === "ok");

  const objeto = S.sanitizeValue({ texto: longa }, { maxString: 50 });
  ok("truncamento vale dentro de objetos", objeto.texto.length < 120);
}

console.log("\n▸ 5. Objetos circulares e limites estruturais");
{
  const circular = { nome: "raiz" };
  circular.eu = circular;
  circular.lista = [circular, { dentro: circular }];

  let resultado;
  assert.doesNotThrow(() => { resultado = S.sanitizeValue(circular); }, "sanitizeValue não pode lançar em ciclo");
  ok("ciclo vira marcador", JSON.stringify(resultado).includes("[circular]"));
  ok("JSON.stringify funciona no resultado", typeof JSON.stringify(resultado) === "string");

  const profundo = { a: { b: { c: { d: { e: { f: { g: "fundo" } } } } } } };
  const limitado = S.sanitizeValue(profundo, { maxDepth: 3 });
  ok("profundidade é limitada", JSON.stringify(limitado).includes("profundidade máxima"));

  const arrayGrande = S.sanitizeValue(Array.from({ length: 500 }, (_, i) => i), { maxArray: 10 });
  ok("array é limitado", arrayGrande.length === 11);
  ok("itens omitidos são declarados", String(arrayGrande[10]).includes("490 itens omitidos"));

  const muitasChaves = {};
  for (let i = 0; i < 200; i++) muitasChaves["k" + i] = i;
  const chavesLimitadas = S.sanitizeValue(muitasChaves, { maxKeys: 5 });
  ok("quantidade de chaves é limitada", Object.keys(chavesLimitadas).length === 6);
}

console.log("\n▸ 6. Prototype pollution");
{
  const malicioso = JSON.parse('{"__proto__": {"invadido": true}, "constructor": {"x": 1}, "ok": 1}');
  const limpo = S.sanitizeValue(malicioso);
  ok("__proto__ é descartado", !Object.prototype.hasOwnProperty.call(limpo, "__proto__"));
  ok("constructor é descartado", !Object.prototype.hasOwnProperty.call(limpo, "constructor"));
  ok("Object.prototype não foi tocado", ({}).invadido === undefined);
  ok("chaves legítimas sobrevivem", limpo.ok === 1);
}

console.log("\n▸ 7. Sanitização de URL");
{
  const comToken = S.sanitizeUrl("/auth/callback?code=abc123&state=xyz&cliente=alpha");
  ok("query `code` é mascarada", comToken.includes(`code=${encodeURIComponent(S.REDACTED)}`) || comToken.includes("code=%5Bredacted%5D"));
  ok("query neutra sobrevive", comToken.includes("cliente=alpha"));

  const comJwtNaUrl = S.sanitizeUrl("/api/x?access_token=eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MX0.zzz");
  ok("access_token some da URL", comJwtNaUrl.indexOf("eyJ") === -1);

  const jwtNoPath = S.sanitizeUrl("/download/eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MX0.assinatura/arquivo.xlsx");
  ok("segmento de path com JWT é mascarado", jwtNoPath.indexOf("eyJ") === -1);
  ok("resto do path sobrevive", jwtNoPath.includes("arquivo.xlsx"));

  const comCredencial = S.sanitizeUrl("https://user:senha@api.exemplo.com/rota");
  ok("credencial embutida na URL some", comCredencial.indexOf("senha") === -1);

  ok("URL relativa continua relativa", S.sanitizeUrl("/bases?ativo=true").startsWith("/bases"));
  ok("URL absoluta continua absoluta", S.sanitizeUrl("https://api.x.com/y").startsWith("https://"));
  ok("URL inválida não lança", typeof S.sanitizeUrl("::::") === "string");
  ok("sanitizePath descarta a query", S.sanitizePath("/bases?x=1") === "/bases");
}

console.log("\n▸ 8. Headers, stack e arquivos");
{
  const headers = S.sanitizeHeaders({
    authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig",
    "x-api-key": "vf_" + "b".repeat(32),
    "content-type": "application/json",
    cookie: "sessao=1",
  });
  ok("authorization é mascarado", headers.authorization.indexOf("eyJ") === -1);
  ok("x-api-key é mascarado", headers["x-api-key"] === S.REDACTED);
  ok("cookie é mascarado", headers.cookie === S.REDACTED);
  ok("content-type sobrevive", headers["content-type"] === "application/json");

  const stack = S.sanitizeStack(Array.from({ length: 50 }, (_, i) => `  at fn${i} (arquivo.js:${i})`).join("\n"));
  ok("stack é limitada em linhas", stack.split("\n").length <= 12);

  const arquivo = S.summarizeFile({ name: "custos junho/2026.xlsx", size: 918273, type: "application/vnd.ms-excel" });
  ok("nome do arquivo é sanitizado", arquivo.arquivo.indexOf("/") === -1);
  ok("extensão é extraída", arquivo.extensao === "xlsx");
  ok("tamanho é preservado", arquivo.bytes === 918273);
  ok("nenhum conteúdo binário é guardado", !("conteudo" in arquivo) && !("buffer" in arquivo));
}

console.log("\n▸ 9. Redação de payload realista");
{
  const payload = {
    usuario: { email: "pessoa@venforce.com", senha: "segredo123" },
    headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJpZCI6MX0.sig" },
    ml: { access_token: "APP_USR-123456", refresh_token: "TG-abc" },
    status_code: 500,
    resultado: { ok: false, erro: "Base não encontrada" },
  };
  const limpo = S.sanitizeValue(payload);
  const texto = JSON.stringify(limpo);

  ok("senha não aparece", texto.indexOf("segredo123") === -1);
  ok("JWT não aparece", texto.indexOf("eyJ") === -1);
  ok("access_token não aparece", texto.indexOf("APP_USR-123456") === -1);
  ok("refresh_token não aparece", texto.indexOf("TG-abc") === -1);
  ok("status_code sobrevive como número", limpo.status_code === 500);
  ok("mensagem de erro sobrevive", limpo.resultado.erro === "Base não encontrada");
  ok("e-mail sobrevive (necessário para achar quem quebrou)", limpo.usuario.email === "pessoa@venforce.com");
}

console.log("\n▸ 10. Contrato de redação frontend × backend");
{
  // O coletor do navegador tem a própria cópia das listas (não dá para
  // require CommonJS no browser). Se as listas divergirem, o backend continua
  // sendo a autoridade — mas a divergência precisa ser intencional, não
  // acidental. Este teste falha quando alguém edita um lado só.
  const arquivoCliente = path.join(__dirname, "..", "..", "Portal", "vf-debug-client.js");
  const fonte = fs.readFileSync(arquivoCliente, "utf8");

  const extrair = (nome) => {
    const bloco = fonte.match(new RegExp(`var ${nome} = \\[([\\s\\S]*?)\\];`));
    if (!bloco) return null;
    return bloco[1].split(",").map((t) => t.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  };

  const partesCliente = extrair("SENSITIVE_KEY_PARTS");
  const exatasCliente = extrair("SENSITIVE_KEY_EXACT");

  ok("o coletor declara SENSITIVE_KEY_PARTS", Array.isArray(partesCliente) && partesCliente.length > 0);
  ok("o coletor declara SENSITIVE_KEY_EXACT", Array.isArray(exatasCliente) && exatasCliente.length > 0);
  ok("listas de substring idênticas ao backend",
    JSON.stringify(partesCliente.slice().sort()) === JSON.stringify(S.SENSITIVE_KEY_PARTS.slice().sort()));
  ok("listas exatas idênticas ao backend",
    JSON.stringify(exatasCliente.slice().sort()) === JSON.stringify(S.SENSITIVE_KEY_EXACT.slice().sort()));

  ok("o coletor nunca lê o corpo da response original",
    /response\.clone\(\)/.test(fonte) && !/(?<!clone\(\)\.)\bresponse\.(text|json)\(/.test(fonte));
  ok("o coletor não grava o JWT em evento", fonte.indexOf("localStorage.getItem(TOKEN_KEY)") !== -1 && !/token:\s*localStorage/.test(fonte));
}

console.log(`\n${passou} verificações passaram. Sanitização da observabilidade OK.\n`);
