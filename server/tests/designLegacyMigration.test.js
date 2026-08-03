// server/tests/designLegacyMigration.test.js
// Migração de documentos antigos (Construtor Modular e Editor único) para o
// schema "vf-design-document", sem navegador: detecção de formato,
// renderização das páginas antigas via o renderizador existente, grupo único
// quando não há conversor de SVG->Fabric, e preservação do original em
// legacySource.

const assert = require("assert");
const path = require("path");

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

const portalDir = path.join(__dirname, "..", "..", "Portal");
const snap = require("./helpers/svgSnapshot");

const documentModel = require(path.join(portalDir, "design-document-model"));
const templateEngine = require(path.join(portalDir, "design-template-engine"));
const templatePresets = require(path.join(portalDir, "design-template-presets"));
const componentsLib = require(path.join(portalDir, "design-template-components"));
const layoutsLib = require(path.join(portalDir, "design-template-layouts"));
const templateRendererLib = require(path.join(portalDir, "design-template-renderer"));
const builderModel = require(path.join(portalDir, "design-template-builder-model"));
const imageModel = require(path.join(portalDir, "design-image-model"));
const { createLegacyMigration } = require(path.join(portalDir, "design-legacy-migration"));

(async () => {
  console.log("\n=== design-legacy-migration ===\n");

  function migration(extra) {
    return createLegacyMigration({
      documentModel,
      templateEngine,
      templatePresets,
      componentsLib,
      layoutsLib,
      templateRendererLib,
      builderModel,
      documentLike: snap.criarDocumentoFake(),
      serializeNode: (node) => snap.serializarSvg(node),
      ...extra,
    });
  }

  // Detecção de formato
  const migrator = migration();
  eq("documento novo é 'current'", migrator.detectFormat(documentModel.createDocument({})), "current");
  eq("objeto vazio é 'empty'", migrator.detectFormat({}), "empty");
  eq("null é 'empty'", migrator.detectFormat(null), "empty");
  eq("projeto do editor único é 'editor'", migrator.detectFormat({ templateId: "carregador-portatil" }), "editor");

  const builderProject = builderModel.createDefaultProject({ imageModel, name: "Carrossel antigo", clienteId: 11 });
  eq("projeto do construtor é 'builder'", migrator.detectFormat(builderProject), "builder");

  // 9. Migração de documento antigo — formato do Construtor, sem conversor
  // de SVG (ambiente sem navegador): cai no grupo único por página.
  const migratedBuilder = await migrator.migrateDocument(builderProject, { clienteId: 11, itemType: "template" });
  eq("formato identificado", migratedBuilder.format, "builder");
  ok("documento migrado é válido no novo schema", documentModel.validateDocument(migratedBuilder.document).ok);
  eq("mesma quantidade de páginas do projeto antigo", migratedBuilder.document.pages.length, builderProject.pages.filter((p) => p.incluida !== false).length || migratedBuilder.document.pages.length);
  ok("aviso de edição limitada presente (sem conversor)", migratedBuilder.warnings.includes(migrator.LIMITED_EDIT_WARNING));
  ok("original preservado em legacySource", migratedBuilder.document.legacySource
    && migratedBuilder.document.legacySource.format === "builder"
    && migratedBuilder.document.legacySource.raw.id === builderProject.id);
  ok("página migrada é um grupo travado", migratedBuilder.document.pages[0].fabricJson.objects[0].type === "group"
    && migratedBuilder.document.pages[0].fabricJson.objects[0].vfLocked === true);
  ok("SVG original guardado na página para referência", typeof migratedBuilder.document.pages[0].fabricJson.objects[0].vfLegacySvg === "string"
    && migratedBuilder.document.pages[0].fabricJson.objects[0].vfLegacySvg.includes("svg"));

  // Formato do editor único, também sem conversor
  const editorProject = { version: 2, templateId: "carregador-portatil", clienteNome: "Cliente Editor", marcaNome: "NOVA", palette: {}, product: {}, logo: {}, content: {} };
  const migratedEditor = await migrator.migrateDocument(editorProject, { itemType: "template" });
  eq("formato identificado (editor)", migratedEditor.format, "editor");
  ok("documento migrado (editor) é válido", documentModel.validateDocument(migratedEditor.document).ok);
  ok("aviso de edição limitada presente (editor)", migratedEditor.warnings.includes(migrator.LIMITED_EDIT_WARNING));

  // Com um conversor de SVG->Fabric injetado, a migração decompõe objetos de
  // verdade (não cai no grupo único).
  const migratorWithFabric = migration({
    svgToFabricJson: async () => ({ version: "6.9.1", objects: [{ type: "textbox" }, { type: "rect" }] }),
  });
  const migratedWithFabric = await migratorWithFabric.migrateDocument(builderProject, { clienteId: 11, itemType: "template" });
  ok("com conversor, nenhum aviso de edição limitada", !migratedWithFabric.warnings.includes(migratorWithFabric.LIMITED_EDIT_WARNING));
  ok("páginas decompostas em objetos reais", migratedWithFabric.document.pages.every((page) => page.fabricJson.objects.every((o) => o.type !== "group")));

  // Documento já no schema novo não é remexido além de sanitizeDocument
  const current = documentModel.createDocument({ name: "Já migrado" });
  const noop = await migrator.migrateDocument(current, {});
  eq("documento atual não gera aviso", noop.warnings.length, 0);
  eq("formato current preserva o nome", noop.document.name, "Já migrado");

  console.log(`\n${checks} verificações concluídas.\n`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
