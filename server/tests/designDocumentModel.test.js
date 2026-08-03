// server/tests/designDocumentModel.test.js
// Modelo puro do documento da Biblioteca de Templates (schema
// "vf-design-document"): criação, validação, sanitização, operações de
// página e contagem de objetos — sem navegador.

const assert = require("assert");
const model = require("../../Portal/design-document-model");

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
  console.log("\n=== design-document-model ===\n");

  // 1. Criação de documento
  const doc = model.createDocument({ name: "Template teste", clienteId: 7 });
  eq("schema correto", doc.schema, model.SCHEMA);
  eq("versão atual", doc.version, model.CURRENT_VERSION);
  ok("id gerado", typeof doc.id === "string" && doc.id.length > 0);
  eq("clienteId numérico", doc.clienteId, 7);
  eq("uma página padrão", doc.pages.length, 1);
  eq("página padrão 1200x1200", [doc.pages[0].width, doc.pages[0].height], [1200, 1200]);
  eq("origem padrão é blank", doc.source.type, "blank");

  // 2. Validação de documento
  ok("documento recém-criado é válido", model.validateDocument(doc).ok);
  eq("schema ausente é inválido", model.validateDocument({}).codigo, "SCHEMA_INVALIDO");
  eq("sem páginas é inválido", model.validateDocument({ ...doc, pages: [] }).codigo, "PAGINAS_AUSENTES");
  eq("página sem fabricJson é inválida", model.validateDocument({
    ...doc, pages: [{ id: "p1", name: "P1", width: 100, height: 100 }],
  }).codigo, "PAGINA_SEM_CONTEUDO");
  eq("versão futura é rejeitada", model.validateDocument({ ...doc, version: 999 }).codigo, "VERSAO_FUTURA");
  const duplicated = { ...doc, pages: [doc.pages[0], { ...doc.pages[0] }] };
  eq("páginas com id duplicado são inválidas", model.validateDocument(duplicated).codigo, "PAGINA_DUPLICADA");

  // 12. Documento acima do limite permitido
  const hugeObjects = Array.from({ length: 50000 }, (_, i) => ({ type: "rect", id: i, data: "x".repeat(200) }));
  const huge = { ...doc, pages: [{ ...doc.pages[0], fabricJson: { objects: hugeObjects } }] };
  const hugeValidation = model.validateDocument(huge);
  ok("documento gigante é rejeitado", !hugeValidation.ok);
  eq("código de tamanho excedido", hugeValidation.codigo, "DOCUMENTO_MUITO_GRANDE");

  // Sanitização nunca lança, mesmo com lixo
  const sanitized = model.sanitizeDocument({ name: 123, pages: "não é array", clienteId: "abc" });
  ok("sanitizeDocument sempre devolve documento válido", model.validateDocument(sanitized).ok);
  eq("sanitizeDocument não inventa clienteId", sanitized.clienteId, null);

  // 8. Criação, duplicação e exclusão de página
  const withSecondPage = model.addPage(doc, { name: "Página 2" });
  eq("página adicionada", withSecondPage.pages.length, 2);
  eq("nova página herda tamanho", [withSecondPage.pages[1].width, withSecondPage.pages[1].height], [1200, 1200]);

  const duplicatedPages = model.duplicatePage(withSecondPage, withSecondPage.pages[0].id);
  eq("duplicação insere logo após a original", duplicatedPages.pages.length, 3);
  ok("cópia tem id novo", duplicatedPages.pages[1].id !== duplicatedPages.pages[0].id);
  ok("cópia é nomeada com sufixo", duplicatedPages.pages[1].name.includes("cópia"));

  const removed = model.removePage(duplicatedPages, duplicatedPages.pages[1].id);
  eq("página removida", removed.pages.length, 2);
  const removedLast = model.removePage(model.createDocument({}), doc.pages[0].id);
  eq("não remove a última página do documento", removedLast.pages.length, 1);

  const renamed = model.renamePage(withSecondPage, withSecondPage.pages[0].id, "Capa");
  eq("renomeia a página certa", renamed.pages[0].name, "Capa");

  const reordered = model.reorderPages(withSecondPage, [withSecondPage.pages[1].id, withSecondPage.pages[0].id]);
  eq("reordena páginas", reordered.pages.map((p) => p.id), [withSecondPage.pages[1].id, withSecondPage.pages[0].id]);
  const badReorder = model.reorderPages(withSecondPage, ["id-que-nao-existe"]);
  eq("reordenação incompleta é ignorada", badReorder.pages.map((p) => p.id), withSecondPage.pages.map((p) => p.id));

  // 10. Contagem de objetos
  const withObjects = model.updatePageContent(doc, doc.pages[0].id, {
    objects: [
      { type: "rect" },
      { type: "group", objects: [{ type: "text" }, { type: "text" }] },
    ],
  });
  eq("conta objetos recursivamente (1 + 1 grupo + 2 filhos)", model.countObjects(withObjects), 4);
  eq("documento sem páginas conta zero", model.countObjects({}), 0);

  // Detecção de documento legado
  ok("documento atual não é legado", !model.isLegacyDocument(doc));
  ok("objeto vazio é legado", model.isLegacyDocument({}));
  ok("documento com schema antigo é legado", model.isLegacyDocument({ templateId: "x" }));

  console.log(`\n${checks} verificações concluídas.\n`);
})();
