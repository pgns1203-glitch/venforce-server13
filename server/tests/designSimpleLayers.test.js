// server/tests/designSimpleLayers.test.js
// Painel de objetos do Editor Reduzido: listar, renomear, ocultar, bloquear,
// reordenar e excluir — usando um canvas Fabric falso (mesma superfície de
// getObjects/remove/bringObjectToFront/... da API real do Fabric 6), sem
// depender do Fabric.js nem de navegador.

const assert = require("assert");
const documentModel = require("../../Portal/design-document-model");
const { createSimpleLayers } = require("../../Portal/design-simple-layers");

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

// Canvas falso: array bottom -> top, igual ao Fabric real.
function createFakeCanvas(objects) {
  let list = objects.slice();
  let rendered = 0;
  return {
    getObjects: () => list,
    remove: (object) => { list = list.filter((o) => o !== object); },
    requestRenderAll: () => { rendered += 1; },
    bringObjectToFront: (object) => { list = [...list.filter((o) => o !== object), object]; },
    sendObjectToBack: (object) => { list = [object, ...list.filter((o) => o !== object)]; },
    bringObjectForward: (object) => {
      const index = list.indexOf(object);
      if (index === -1 || index === list.length - 1) return;
      [list[index], list[index + 1]] = [list[index + 1], list[index]];
    },
    sendObjectBackwards: (object) => {
      const index = list.indexOf(object);
      if (index <= 0) return;
      [list[index - 1], list[index]] = [list[index], list[index - 1]];
    },
    get renderCount() { return rendered; },
  };
}

(() => {
  console.log("\n=== design-simple-layers ===\n");

  const layers = createSimpleLayers({ documentModel });

  const objA = { type: "rect", vfId: "a", vfName: "Fundo" };
  const objB = { type: "textbox", vfId: "b", vfName: "Título" };
  const objC = { type: "image", vfId: "c" };
  const canvas = createFakeCanvas([objA, objB, objC]);

  // Lista vem do topo (frente) para o fundo.
  eq("lista em ordem de frente para trás", layers.listLayers(canvas).map((l) => l.id), ["c", "b", "a"]);
  eq("objeto sem vfName ganha nome padrão por tipo", layers.listLayers(canvas).find((l) => l.id === "c").name, "Imagem 3");
  eq("tipo exposto", layers.listLayers(canvas).find((l) => l.id === "b").type, "textbox");
  ok("visível por padrão", layers.listLayers(canvas).find((l) => l.id === "a").visible);
  ok("destravado por padrão", !layers.listLayers(canvas).find((l) => l.id === "a").locked);

  // Renomear
  ok("renomeia objeto existente", layers.rename(canvas, "a", "Fundo azul"));
  eq("nome atualizado na listagem", layers.listLayers(canvas).find((l) => l.id === "a").name, "Fundo azul");
  ok("renomear objeto inexistente devolve false", !layers.rename(canvas, "zzz", "Nada"));

  // Ocultar / mostrar
  ok("oculta objeto", layers.toggleVisible(canvas, "b"));
  eq("objeto marcado como oculto", layers.listLayers(canvas).find((l) => l.id === "b").visible, false);
  eq("vfHidden espelha o estado", objB.vfHidden, true);
  ok("mostra de novo", layers.toggleVisible(canvas, "b"));
  eq("objeto visível de novo", layers.listLayers(canvas).find((l) => l.id === "b").visible, true);

  // Bloquear / destravar
  ok("bloqueia objeto", layers.toggleLocked(canvas, "c"));
  eq("objeto marcado como bloqueado", layers.listLayers(canvas).find((l) => l.id === "c").locked, true);
  eq("bloqueado fica não-selecionável", objC.selectable, false);
  ok("destrava de novo", layers.toggleLocked(canvas, "c"));
  eq("objeto destravado", layers.listLayers(canvas).find((l) => l.id === "c").locked, false);

  // Reordenar (z-order)
  ok("envia para trás", layers.sendToBack(canvas, "c"));
  eq("c foi para o fundo", canvas.getObjects()[0], objC);
  ok("traz para frente", layers.bringToFront(canvas, "a"));
  eq("a está na frente", canvas.getObjects()[canvas.getObjects().length - 1], objA);
  ok("sobe um degrau", layers.moveUp(canvas, "b"));
  ok("desce um degrau", layers.moveDown(canvas, "b"));

  // Excluir
  ok("remove objeto existente", layers.remove(canvas, "b"));
  eq("lista sem o objeto removido", layers.listLayers(canvas).map((l) => l.id).includes("b"), false);
  eq("dois objetos restantes", canvas.getObjects().length, 2);
  ok("remover id inexistente devolve false e não quebra", !layers.remove(canvas, "b"));

  ok("todas as operações renderizam de novo", canvas.renderCount > 0);

  console.log(`\n${checks} verificações concluídas.\n`);
})();
