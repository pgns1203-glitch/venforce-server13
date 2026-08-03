// server/tests/designImportJson.test.js
// Importador de JSON nativo: aceita um vf-design-document válido, rejeita
// JSON malformado e documentos fora do schema — sem navegador.

const assert = require("assert");
const documentModel = require("../../Portal/design-document-model");
const { createJsonImporter } = require("../../Portal/design-import-json");
const { createImportRegistry } = require("../../Portal/design-import-registry");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

(() => {
  console.log("\n=== design-import-json ===\n");

  const importer = createJsonImporter({ documentModel });
  const registry = createImportRegistry();
  registry.register(importer);

  eq("registro resolve .json", registry.resolveByFileName("modelo.json").id, "json");
  eq("registro resolve .vfdesign.json", registry.resolveByFileName("modelo.vfdesign.json").id, "json");
  ok("registro não resolve .svg", !registry.resolveByFileName("arte.svg"));

  // 3. Importação de JSON válido
  const validDoc = documentModel.createDocument({ name: "Template válido" });
  const validResult = importer.analyze({ text: JSON.stringify(validDoc), fileName: "modelo.json", sizeBytes: 500 });
  ok("JSON válido é aceito", validResult.ok);
  eq("resumo traz o nome", validResult.summary.name, "Template válido");
  eq("resumo traz 1 página", validResult.summary.pageCount, 1);

  // 4. Rejeição de JSON inválido
  const brokenSyntax = importer.analyze({ text: "{ isso não é json", fileName: "quebrado.json" });
  ok("JSON com sintaxe quebrada é rejeitado", !brokenSyntax.ok);
  eq("código de sintaxe inválida", brokenSyntax.codigo, "JSON_INVALIDO");

  const notADocument = importer.analyze({ text: JSON.stringify({ pages: [] }), fileName: "vazio.json" });
  ok("JSON sem schema reconhecido é rejeitado", !notADocument.ok);
  eq("código de schema ausente", notADocument.codigo, "SCHEMA_INVALIDO");

  const noPages = importer.analyze({
    text: JSON.stringify({ ...validDoc, pages: [] }), fileName: "sem-paginas.json",
  });
  ok("JSON com schema válido mas sem páginas é rejeitado", !noPages.ok);
  eq("código de páginas ausentes", noPages.codigo, "PAGINAS_AUSENTES");

  // build() gera um documento novo, com id próprio, no cliente/tipo escolhidos.
  // Contrato { document, warnings } — igual ao dos importadores de SVG e imagem.
  const built = importer.build(validResult, { name: "Renomeado na importação", clienteId: 42, itemType: "template" });
  ok("build gera novo id", built.document.id !== validDoc.id);
  eq("build aplica o nome escolhido", built.document.name, "Renomeado na importação");
  eq("build aplica o cliente escolhido", built.document.clienteId, 42);
  eq("build marca a origem como json", built.document.source.type, "json");
  ok("documento construído é válido", documentModel.validateDocument(built.document).ok);
  eq("json não gera avisos", built.warnings, []);

  console.log(`\n${checks} verificações concluídas.\n`);
})();
