// server/tests/designSimpleEditor.test.js
// Núcleo puro do Editor Reduzido: quais campos de propriedade cada tipo de
// objeto mostra, os defaults de um objeto inserido e o payload de "salvar
// versão" — sem Fabric.js nem navegador (a orquestração real do canvas só
// roda no navegador, ver createSimpleEditor).

const assert = require("assert");
const documentModel = require("../../Portal/design-document-model");
const { propertyFieldsFor, buildInsertedObject, buildSaveState } = require("../../Portal/design-simple-editor");

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
  console.log("\n=== design-simple-editor (núcleo puro) ===\n");

  const commonKeys = ["left", "top", "width", "height", "angle", "opacity"];

  const textFields = propertyFieldsFor({ type: "textbox" }).map((f) => f.key);
  ok("texto tem campos comuns", commonKeys.every((key) => textFields.includes(key)));
  ok("texto tem conteúdo, fonte e cor", ["text", "fontSize", "fontFamily", "fill"].every((key) => textFields.includes(key)));
  ok("todo objeto expõe visível e bloqueado", ["visible", "locked"].every((key) => textFields.includes(key)));

  const rectFields = propertyFieldsFor({ type: "rect" }).map((f) => f.key);
  ok("forma tem preenchimento e contorno", ["fill", "stroke", "strokeWidth"].every((key) => rectFields.includes(key)));
  ok("forma não tem campos de texto", !rectFields.includes("text"));

  const imageFields = propertyFieldsFor({ type: "image" }).map((f) => f.key);
  ok("imagem tem os campos comuns", commonKeys.every((key) => imageFields.includes(key)));
  ok("imagem tem recorte básico (cropX/cropY)", ["cropX", "cropY"].every((key) => imageFields.includes(key)));
  ok("imagem não tem preenchimento de forma", !imageFields.includes("fill"));

  ok("largura e altura são derivadas (somente leitura)",
    propertyFieldsFor({ type: "rect" }).find((f) => f.key === "width").derived === true);

  // Inserção básica: sempre com vfId/vfType/vfName e vfLocked/vfHidden falsos.
  const text = buildInsertedObject("text", { vfId: "id-1" });
  eq("texto inserido", [text.type, text.vfType, text.vfLocked, text.vfHidden], ["textbox", "text", false, false]);

  const rect = buildInsertedObject("rect", { vfId: "id-2" });
  eq("retângulo inserido", rect.type, "rect");

  const circle = buildInsertedObject("circle", { vfId: "id-3" });
  eq("círculo inserido", circle.type, "circle");

  const logo = buildInsertedObject("logo", { vfId: "id-4", src: "data:image/png;base64,AA==" });
  eq("logo vira imagem com vfType logo", [logo.type, logo.vfType], ["image", "logo"]);

  ok("tipo desconhecido lança erro explícito", (() => {
    try { buildInsertedObject("vetor", {}); return false; } catch { return true; }
  })());

  // Salvar versão: grava a página ativa de volta no documento, sem tocar
  // nas demais páginas.
  const doc = documentModel.addPage(documentModel.createDocument({ name: "Projeto" }), { name: "Página 2" });
  const [firstPage, secondPage] = doc.pages;
  const newFabricJson = { version: "6.9.1", objects: [{ type: "rect" }] };
  const saved = buildSaveState(doc, firstPage.id, newFabricJson, "data:image/png;base64,THUMB==");
  eq("página ativa recebe o novo fabricJson", saved.document.pages[0].fabricJson, newFabricJson);
  eq("outras páginas não são tocadas", saved.document.pages[1], secondPage);
  eq("thumbnail é repassado", saved.thumbnail, "data:image/png;base64,THUMB==");
  ok("documento salvo continua válido", documentModel.validateDocument(saved.document).ok);

  console.log(`\n${checks} verificações concluídas.\n`);
})();
