// server/tests/designImportSvg.test.js
// Importador de SVG: sanitização (remove foreignObject/on*/javascript:/
// recursos externos), rejeição de <script>, e importação como grupo único
// quando não há função de conversão para Fabric — sem navegador.

const assert = require("assert");
const documentModel = require("../../Portal/design-document-model");
const { createSvgImporter, sanitizeSvgMarkup } = require("../../Portal/design-import-svg");

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

(async () => {
  console.log("\n=== design-import-svg ===\n");

  // 6. Rejeição de SVG com script
  const withScript = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>alert(1)</script></svg>`;
  const scriptResult = sanitizeSvgMarkup(withScript);
  ok("SVG com <script> é rejeitado", !scriptResult.ok);
  eq("código de script bloqueado", scriptResult.codigo, "SVG_SCRIPT_BLOQUEADO");

  // 5. Sanitização de SVG (foreignObject, on*, javascript:, recursos externos)
  const dirty = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
    <foreignObject><div>html embutido</div></foreignObject>
    <rect width="10" height="10" onclick="alert(1)" />
    <a href="javascript:alert(1)"><text>clique</text></a>
    <image href="https://evil.example.com/x.png" />
    <circle cx="5" cy="5" r="5" />
  </svg>`;
  const cleaned = sanitizeSvgMarkup(dirty);
  ok("SVG sem script é aceito", cleaned.ok);
  ok("foreignObject removido", !cleaned.sanitized.includes("foreignObject"));
  ok("atributo on* removido", !/onclick/i.test(cleaned.sanitized));
  ok("URL javascript: neutralizada", !cleaned.sanitized.includes("javascript:"));
  ok("recurso externo removido", !cleaned.sanitized.includes("evil.example.com"));
  ok("avisos foram reportados", cleaned.warnings.length >= 3);

  const notSvg = sanitizeSvgMarkup("<html></html>");
  ok("conteúdo sem <svg> é rejeitado", !notSvg.ok);
  eq("código de svg inválido", notSvg.codigo, "SVG_INVALIDO");

  // Importador completo, sem svgToFabricJson (ambiente sem navegador):
  // deve cair no grupo único.
  const importer = createSvgImporter({ documentModel });
  const safeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150">
    <rect width="300" height="150" fill="#fff" />
    <text x="10" y="20">Olá</text>
  </svg>`;
  const analyzed = importer.analyze({ text: safeSvg, fileName: "arte.svg", sizeBytes: safeSvg.length });
  ok("SVG seguro é aceito", analyzed.ok);
  eq("dimensões lidas do svg", [analyzed.summary.width, analyzed.summary.height], [300, 150]);
  ok("conta objetos reconhecidos (rect + text)", analyzed.summary.objectCount >= 2);

  const built = await importer.build(analyzed, { name: "SVG importado", clienteId: 5, itemType: "template" });
  ok("build produz documento válido", documentModel.validateDocument(built.document).ok);
  eq("página única", built.document.pages.length, 1);
  const [object] = built.document.pages[0].fabricJson.objects;
  eq("sem conversor, entra como grupo único travado", object.type, "group");
  ok("grupo guarda o SVG original para referência", object.vfLegacySvg.includes("<svg"));
  ok("aviso de grupo único presente", built.warnings.some((w) => w.toLowerCase().includes("grupo")));

  // Com um conversor injetado, a página vira objetos Fabric de verdade.
  const importerWithFabric = createSvgImporter({
    documentModel,
    svgToFabricJson: async () => ({ version: "6.9.1", objects: [{ type: "rect" }, { type: "textbox" }] }),
  });
  const analyzed2 = importerWithFabric.analyze({ text: safeSvg, fileName: "arte.svg" });
  const built2 = await importerWithFabric.build(analyzed2, { name: "SVG decomposto", itemType: "template" });
  eq("com conversor, objetos são preservados", built2.document.pages[0].fabricJson.objects.length, 2);
  ok("não usa mais o grupo único", built2.document.pages[0].fabricJson.objects[0].type !== "group");

  console.log(`\n${checks} verificações concluídas.\n`);
})();
