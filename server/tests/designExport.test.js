// server/tests/designExport.test.js
// Exportação da Biblioteca de Templates: nome de arquivo, serialização do
// documento e download via um DOM/URL/Blob falsos — sem navegador real.

const assert = require("assert");
const documentModel = require("../../Portal/design-document-model");
const exportLib = require("../../Portal/design-export");
const snap = require("./helpers/svgSnapshot");

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
  console.log("\n=== design-export ===\n");

  eq("sanitiza nome removendo acentos e espaços", exportLib.sanitizeFilename("Título Ação Ç", "x"), "titulo-acao-c");
  eq("nome vazio cai no fallback", exportLib.sanitizeFilename("   ", "modelo"), "modelo");
  ok("timestamp não tem : nem .", !/[:.]/.test(exportLib.timestampForFile(new Date("2026-01-02T03:04:05.000Z"))));

  const doc = documentModel.createDocument({ name: "Carrossel Lavadora", legacySource: { format: "builder", raw: { huge: "x".repeat(1000) } } });
  const jsonName = exportLib.buildJsonFileName(doc, new Date("2026-01-02T03:04:05.000Z"));
  ok("nome do json usa o nome do documento", jsonName.startsWith("carrossel-lavadora-"));
  ok("nome do json termina em .vfdesign.json", jsonName.endsWith(".vfdesign.json"));

  const pngName = exportLib.buildPngFileName(doc, { name: "Página 1" }, new Date("2026-01-02T03:04:05.000Z"));
  ok("nome do png inclui documento e página", pngName.includes("carrossel-lavadora") && pngName.includes("pagina-1"));
  ok("nome do png termina em .png", pngName.endsWith(".png"));

  const serialized = JSON.parse(exportLib.serializeDocumentForExport(doc));
  ok("exportação não inclui legacySource (evita duplicar dado bruto)", !("legacySource" in serialized));
  eq("exportação preserva nome e schema", [serialized.name, serialized.schema], ["Carrossel Lavadora", documentModel.SCHEMA]);

  // downloadBlob com DOM/URL falsos, injetados (mesmo fake usado nos testes
  // do renderer de SVG).
  const fakeDoc = snap.criarDocumentoFake();
  fakeDoc.body = snap.criarElemento("body");
  const urls = [];
  const fakeUrl = { createObjectURL: (blob) => { urls.push(blob); return "blob:fake"; }, revokeObjectURL: () => {} };
  const lib = exportLib.createDesignExport({ documentModel });
  const result = lib.downloadBlob({ marker: "blob" }, "arquivo.json", { documentLike: fakeDoc, urlLike: fakeUrl });
  eq("blob passado ao URL falso", urls[0].marker, "blob");
  eq("nome de arquivo devolvido", result.fileName, "arquivo.json");
  eq("link foi anexado ao body e removido", fakeDoc.body.children.length, 0);

  // exportDocumentAsJson recusa documento inválido
  ok("recusa exportar documento inválido", (() => {
    try { lib.exportDocumentAsJson({}, { documentLike: fakeDoc, urlLike: fakeUrl, BlobImpl: class {} }); return false; } catch { return true; }
  })());

  console.log(`\n${checks} verificações concluídas.\n`);
})();
