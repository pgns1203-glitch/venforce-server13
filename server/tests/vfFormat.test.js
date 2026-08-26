// server/tests/vfFormat.test.js
//
// F0.1B — cobre a formatação canônica do Shell V3: Portal/vf-format.js.
// O módulo é ES Module puro (sem DOM), carregado aqui via import()
// dinâmico a partir de um runner CommonJS — mesmo padrão de execução
// isolada (`node <arquivo>.test.js`) de server/tests/run-all.js.

const assert = require("assert");
const path = require("path");

let checks = 0;
function eq(label, actual, expected) {
  assert.strictEqual(actual, expected, `${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function matches(label, actual, regex) {
  assert.ok(regex.test(actual), `FALHOU: ${label} — "${actual}" não bate com ${regex}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

(async () => {
  const modPath = path.join(__dirname, "..", "..", "Portal", "vf-format.js");
  const { escapeHTML, moeda, numero, percentual, data, desde, normalizarBusca, iniciais, format } = await import(`file://${modPath}`);

  console.log("\n▸ escapeHTML");
  {
    eq("<", escapeHTML("<script>"), "&lt;script&gt;");
    eq(">", escapeHTML("a>b"), "a&gt;b");
    eq("&", escapeHTML("a&b"), "a&amp;b");
    eq("aspas simples", escapeHTML("it's"), "it&#39;s");
    eq("aspas duplas", escapeHTML('say "hi"'), "say &quot;hi&quot;");
    eq("texto normal", escapeHTML("Cliente N97"), "Cliente N97");
    eq("string vazia", escapeHTML(""), "");
    eq("combinação (ordem: & primeiro)", escapeHTML(`<a href="x">O'Brien & Cia</a>`),
      "&lt;a href=&quot;x&quot;&gt;O&#39;Brien &amp; Cia&lt;/a&gt;");
  }

  console.log("\n▸ moeda");
  {
    matches("valor positivo", moeda(1234.5), /^R\$\s1\.234,50$/);
    matches("zero", moeda(0), /^R\$\s0,00$/);
    matches("valor negativo", moeda(-15.5), /^-R\$\s15,50$/);
    matches("casas decimais (arredonda)", moeda(9.999), /^R\$\s10,00$/);
    matches("pt-BR (separador de milhar)", moeda(1000000), /^R\$\s1\.000\.000,00$/);
  }

  console.log("\n▸ número");
  {
    eq("inteiro", numero(42), "42");
    eq("decimal com 2 casas", numero(1234.5, 2), "1.234,50");
    eq("separador pt-BR de milhar", numero(1234567), "1.234.567");
    eq("decimal padrão (0 casas) arredonda", numero(3.7), "4");
  }

  console.log("\n▸ percentual");
  {
    eq("positivo", percentual(0.105), "10,5%");
    eq("zero", percentual(0), "0,0%");
    eq("decimal com 0 casas", percentual(0.5, 0), "50%");
    eq("negativo", percentual(-0.02), "-2,0%");
  }

  console.log("\n▸ data");
  {
    matches("formato válido (dd/mm/aaaa, hh:mm)", data("2026-08-26T13:05:00Z"), /^\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}$/);
    eq("string vazia → ausente", data(""), "—");
    eq("string inválida → ausente", data("não é uma data"), "—");
    eq("null → ausente", data(null), "—");
    eq("undefined → ausente", data(undefined), "—");
    eq("aceita instância de Date", data(new Date("2026-01-01T00:00:00Z")).length > 0, true);
  }

  console.log("\n▸ valores problemáticos — contrato explícito de null/undefined/NaN");
  {
    eq("moeda(null)", moeda(null), "—");
    eq("moeda(undefined)", moeda(undefined), "—");
    eq("moeda(NaN)", moeda(NaN), "—");
    eq("numero(null)", numero(null), "—");
    eq("numero(undefined)", numero(undefined), "—");
    eq("numero(NaN)", numero(NaN), "—");
    eq("percentual(null)", percentual(null), "—");
    eq("percentual(undefined)", percentual(undefined), "—");
    eq("percentual(NaN)", percentual(NaN), "—");
    eq("data(NaN)", data(NaN), "—");
    // escapeHTML nunca retorna "ausente" — string vazia é o contrato, para
    // não vazar o caractere "—" para dentro de atributos HTML.
    eq("escapeHTML(null)", escapeHTML(null), "");
    eq("escapeHTML(undefined)", escapeHTML(undefined), "");
    eq("escapeHTML(NaN) — não é null/undefined, vira texto", escapeHTML(NaN), "NaN");
  }

  console.log("\n▸ desde (F0.5 — 'última sync' relativa)");
  {
    const agora = new Date("2026-08-26T15:00:00Z");
    eq("nulo → nunca", desde(null, agora), "nunca");
    eq("undefined → nunca", desde(undefined, agora), "nunca");
    eq("string vazia → nunca", desde("", agora), "nunca");
    eq("data inválida → ausente", desde("não é uma data", agora), "—");
    eq("< 1 min → agora", desde("2026-08-26T14:59:45Z", agora), "agora");
    eq("20 min", desde("2026-08-26T14:40:00Z", agora), "há 20 min");
    eq("2 h", desde("2026-08-26T13:00:00Z", agora), "há 2 h");
    eq("ontem (24h-47h)", desde("2026-08-25T14:00:00Z", agora), "ontem");
    eq("5 dias", desde("2026-08-21T15:00:00Z", agora), "há 5 dias");
    matches("30+ dias cai para data absoluta (dd/mm/aaaa)", desde("2026-01-01T00:00:00Z", agora), /^\d{2}\/\d{2}\/\d{4}$/);
  }

  console.log("\n▸ normalizarBusca (F0.5/F1.1 — typeahead sem acento)");
  {
    eq("remove acentos e caixa", normalizarBusca("São João"), "sao joao");
    eq("trim", normalizarBusca("  N97  "), "n97");
    eq("null → string vazia", normalizarBusca(null), "");
    eq("undefined → string vazia", normalizarBusca(undefined), "");
    eq("já normalizado permanece igual", normalizarBusca("mercado livre"), "mercado livre");
  }

  console.log("\n▸ iniciais (F0.5 — avatar do rodapé)");
  {
    eq("nome completo", iniciais("Pedro Gomes"), "PG");
    eq("nome único", iniciais("Admin"), "A");
    eq("nome vazio → V (Venforce)", iniciais(""), "V");
    eq("null → V", iniciais(null), "V");
    eq("undefined → V", iniciais(undefined), "V");
    eq("nome com espaços extras", iniciais("  Ana   Ribeiro  "), "AR");
    eq("nome com 3+ partes usa primeira e última", iniciais("Maria Clara Souza"), "MS");
  }

  console.log("\n▸ ponte window.VF.format (mesma referência do módulo, sem DOM aqui)");
  {
    eq("format.escapeHTML === escapeHTML", format.escapeHTML, escapeHTML);
    eq("format.moeda === moeda", format.moeda, moeda);
    eq("format.numero === numero", format.numero, numero);
    eq("format.percentual === percentual", format.percentual, percentual);
    eq("format.data === data", format.data, data);
    eq("format.desde === desde", format.desde, desde);
    eq("format.normalizarBusca === normalizarBusca", format.normalizarBusca, normalizarBusca);
    eq("format.iniciais === iniciais", format.iniciais, iniciais);
  }

  console.log(`\n✓ vfFormat: ${checks} verificações`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
