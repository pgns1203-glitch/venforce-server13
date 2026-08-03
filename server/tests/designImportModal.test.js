// server/tests/designImportModal.test.js
// Máquina de estados do modal de importação (Arquivo -> Revisão -> Salvar):
// resolução de importador por extensão, transições de etapa e o payload
// final enviado para build() — sem navegador.

const assert = require("assert");
const documentModel = require("../../Portal/design-document-model");
const { createJsonImporter } = require("../../Portal/design-import-json");
const { createImageImporter } = require("../../Portal/design-import-image");
const { createImportRegistry } = require("../../Portal/design-import-registry");
const { createImportController } = require("../../Portal/design-import-modal");

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

(async () => {
  console.log("\n=== design-import-modal ===\n");

  const registry = createImportRegistry();
  registry.register(createJsonImporter({ documentModel }));
  registry.register(createImageImporter({ documentModel }));

  const controller = createImportController({ registry });
  eq("etapa inicial é 'file'", controller.getState().step, "file");

  // Formato não suportado
  const unsupported = controller.analyzeFile({ name: "arquivo.psd", size: 10 }, "conteúdo");
  ok("formato não suportado mantém etapa 'file'", unsupported.step === "file");
  ok("mensagem de erro lista os formatos aceitos", /Formato não suportado/.test(unsupported.errorMessage));

  // Etapa 1 -> 2 com um JSON válido
  const validDoc = documentModel.createDocument({ name: "Importado" });
  const afterJson = controller.analyzeFile({ name: "modelo.json", size: 200 }, JSON.stringify(validDoc));
  eq("avança para revisão", afterJson.step, "review");
  eq("resumo traz o nome", afterJson.analysis.summary.name, "Importado");

  // Não é possível pular direto para salvar sem escolher opções da revisão
  const afterSave = controller.goToSave({ itemType: "template", clienteId: 7 });
  eq("avança para salvar", afterSave.step, "save");
  eq("clienteId default vem da tela", afterSave.saveDefaults.clienteId, 7);

  const saved = await controller.confirmSave({ name: "Nome final" });
  ok("documento final é válido", documentModel.validateDocument(saved.document).ok);
  eq("nome escolhido é aplicado", saved.document.name, "Nome final");
  eq("cliente default aplicado quando não sobrescrito", saved.document.clienteId, 7);

  // voltar() só permite ir para trás, nunca pular etapas para frente
  controller.reset();
  controller.analyzeFile({ name: "modelo.json", size: 200 }, JSON.stringify(validDoc));
  const backAttempt = controller.backTo("save");
  eq("backTo não avança etapas", backAttempt.step, "review");
  const backOk = controller.backTo("file");
  eq("backTo volta de verdade", backOk.step, "file");

  // Fluxo de imagem: rawInput é {dataUrl,width,height,mimeType}, não texto.
  controller.reset();
  const afterImage = controller.analyzeFile(
    { name: "produto.png", size: 900, type: "image/png" },
    { dataUrl: PNG_1X1, width: 500, height: 500, mimeType: "image/png" },
  );
  eq("imagem também avança para revisão", afterImage.step, "review");
  ok("aviso de camada única presente", afterImage.analysis.summary.warnings.length > 0);
  controller.goToSave({ itemType: "artwork", clienteId: 4, accountRef: "meli:1" });
  const savedImage = await controller.confirmSave({});
  eq("artwork recebe accountRef", savedImage.document.accountRef, "meli:1");
  eq("tipo de item aplicado", savedImage.document.itemType, "artwork");

  // Tentar salvar sem ter revisado antes é erro explícito, nunca silencioso
  const freshController = createImportController({ registry });
  await assert.rejects(() => freshController.confirmSave({}), /Etapa inválida/);

  console.log(`\n${checks} verificações concluídas.\n`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
