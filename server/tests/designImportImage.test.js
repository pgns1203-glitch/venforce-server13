// server/tests/designImportImage.test.js
// Importador de imagem única (PNG/JPG/WebP): sempre vira uma página com um
// objeto de imagem, com aviso de "sem camadas" — sem navegador.

const assert = require("assert");
const documentModel = require("../../Portal/design-document-model");
const { createImageImporter, MAX_IMAGE_BYTES, SINGLE_LAYER_NOTICE } = require("../../Portal/design-import-image");

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

const PNG_1X1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

(() => {
  console.log("\n=== design-import-image ===\n");

  const importer = createImageImporter({ documentModel });

  // 7. Importação de imagem como camada única
  const analyzed = importer.analyze({
    dataUrl: PNG_1X1, mimeType: "image/png", width: 800, height: 600, fileName: "produto.png", sizeBytes: 1200,
  });
  ok("PNG válido é aceito", analyzed.ok);
  ok("aviso de camada única presente", analyzed.summary.warnings.includes(SINGLE_LAYER_NOTICE));

  const built = importer.build(analyzed, { name: "Produto", clienteId: 3, itemType: "template" });
  ok("documento construído é válido", documentModel.validateDocument(built.document).ok);
  eq("uma única página", built.document.pages.length, 1);
  eq("um único objeto de imagem", built.document.pages[0].fabricJson.objects.length, 1);
  eq("objeto é do tipo image", built.document.pages[0].fabricJson.objects[0].type, "image");
  eq("dimensões da imagem preservadas", [built.document.pages[0].width, built.document.pages[0].height], [800, 600]);

  // Formato não suportado
  const badFormat = importer.analyze({ dataUrl: "data:image/gif;base64,AA==", mimeType: "image/gif", fileName: "anim.gif", sizeBytes: 100 });
  ok("GIF é rejeitado", !badFormat.ok);
  eq("código de formato não suportado", badFormat.codigo, "FORMATO_NAO_SUPORTADO");

  // Tamanho acima do limite
  const tooBig = importer.analyze({ dataUrl: PNG_1X1, mimeType: "image/png", fileName: "grande.png", sizeBytes: MAX_IMAGE_BYTES + 1 });
  ok("arquivo grande demais é rejeitado", !tooBig.ok);
  eq("código de arquivo grande", tooBig.codigo, "ARQUIVO_MUITO_GRANDE");

  console.log(`\n${checks} verificações concluídas.\n`);
})();
