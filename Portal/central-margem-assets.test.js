/*
 * Cache-busting dos arquivos da Central de Margem.
 *
 * Produção (Render + Cloudflare) serve o Portal com `s-maxage=300`: cada
 * arquivo fica em cache sozinho. Depois do #330 o navegador recebeu o
 * central-margem.js NOVO com o central-margem-layout.css ANTIGO — a Bancada
 * saiu sem grid (cabeçalho grudado, radio virando barra, nomes cortados).
 *
 * A tag de cada arquivo da Central leva `?v=<hash do conteúdo>`: mudou o
 * arquivo, muda a URL, e HTML/JS/CSS de versões diferentes não se misturam.
 * Este teste falha quando o arquivo muda e o `?v=` do HTML não acompanha, e
 * imprime a tag certa.
 */
"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORTAL_DIR = __dirname;
const HTML = fs.readFileSync(path.join(PORTAL_DIR, "central-margem.html"), "utf8");

// Os arquivos próprios da Central (os compartilhados do Portal ficam como estão).
const ARQUIVOS = [
  "css/pages/central-margem-v2.css",
  "css/pages/central-margem-layout.css",
  "central-margem-api.js",
  "central-margem-promo-fonte.js",
  "central-margem.js",
];

function versao(arquivo) {
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(PORTAL_DIR, arquivo))).digest("hex").slice(0, 10);
}

let checks = 0;
function check(name, fn) { fn(); checks += 1; console.log(`ok ${checks} - ${name}`); }

for (const arquivo of ARQUIVOS) {
  check(`${arquivo} com ?v= do conteúdo atual`, () => {
    const atributo = arquivo.endsWith(".css") ? "href" : "src";
    const esperado = `${atributo}="${arquivo}?v=${versao(arquivo)}"`;
    const achados = HTML.match(new RegExp(`${atributo}="${arquivo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\?[^"]*)?"`, "g")) || [];
    assert.strictEqual(achados.length, 1, `central-margem.html deve carregar ${arquivo} uma vez (achados: ${achados.join(", ") || "nenhum"})`);
    assert.strictEqual(achados[0], esperado, `${arquivo} mudou: troque no central-margem.html\n  ${achados[0]}\npor\n  ${esperado}`);
  });
}

console.log(`# ${checks} testes de cache-busting concluídos`);
