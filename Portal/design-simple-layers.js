// Portal/design-simple-layers.js
// -----------------------------------------------------------------------------
// Painel de objetos do Editor Reduzido: lê e manipula a lista de objetos de
// uma página (um canvas Fabric), usando sempre as propriedades vfId/vfName/
// vfType/vfLocked/vfHidden.
//
// Recebe o canvas por injeção (createSimpleLayers não importa fabric): no
// navegador é um fabric.Canvas de verdade, nos testes é um canvas falso com
// a mesma superfície (getObjects, remove, bringObjectToFront, ...). Isso
// mantém a lógica de listar/renomear/ocultar/bloquear/reordenar testável
// sem Fabric.js nem DOM.
// -----------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DESIGN_SIMPLE_LAYERS = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TYPE_LABELS = {
    text: "Texto", textbox: "Texto", "i-text": "Texto",
    image: "Imagem",
    rect: "Retângulo",
    circle: "Círculo",
    group: "Grupo", "legacy-group": "Grupo (legado)",
    path: "Forma",
  };

  function defaultNameFor(object, index) {
    const label = TYPE_LABELS[object?.type] || "Objeto";
    return `${label} ${index + 1}`;
  }

  function createSimpleLayers(deps) {
    const documentModel = deps && deps.documentModel;
    if (!documentModel) throw new Error("createSimpleLayers precisa de documentModel.");

    function findByLayerId(canvas, layerId) {
      return canvas.getObjects().find((object) => object.vfId === layerId) || null;
    }

    // Topo da lista de UI = objeto que aparece na frente do canvas (fim do
    // array interno do Fabric). getObjects() vem do fundo para a frente.
    function listLayers(canvas) {
      const objects = canvas.getObjects();
      return objects.map((object, index) => ({
        id: object.vfId,
        name: object.vfName || defaultNameFor(object, index),
        type: object.vfType || object.type,
        visible: object.visible !== false,
        locked: Boolean(object.vfLocked),
      })).reverse();
    }

    function setVisible(canvas, layerId, visible) {
      const object = findByLayerId(canvas, layerId);
      if (!object) return false;
      object.visible = Boolean(visible);
      object.vfHidden = !object.visible;
      canvas.requestRenderAll();
      return true;
    }

    function toggleVisible(canvas, layerId) {
      const object = findByLayerId(canvas, layerId);
      if (!object) return false;
      return setVisible(canvas, layerId, object.visible === false);
    }

    function setLocked(canvas, layerId, locked) {
      const object = findByLayerId(canvas, layerId);
      if (!object) return false;
      object.vfLocked = Boolean(locked);
      object.selectable = !object.vfLocked;
      object.evented = !object.vfLocked;
      canvas.requestRenderAll();
      return true;
    }

    function toggleLocked(canvas, layerId) {
      const object = findByLayerId(canvas, layerId);
      if (!object) return false;
      return setLocked(canvas, layerId, !object.vfLocked);
    }

    function rename(canvas, layerId, name) {
      const object = findByLayerId(canvas, layerId);
      if (!object) return false;
      object.vfName = documentModel.sanitizeText(name, object.vfName || "Objeto", 80);
      return true;
    }

    function remove(canvas, layerId) {
      const object = findByLayerId(canvas, layerId);
      if (!object) return false;
      canvas.remove(object);
      canvas.requestRenderAll();
      return true;
    }

    function bringToFront(canvas, layerId) {
      const object = findByLayerId(canvas, layerId);
      if (!object) return false;
      if (object.vfType === "background-image") return false;
      canvas.bringObjectToFront(object);
      canvas.requestRenderAll();
      return true;
    }

    function sendToBack(canvas, layerId) {
      const object = findByLayerId(canvas, layerId);
      if (!object) return false;
      canvas.sendObjectToBack(object);
      const background = canvas.getObjects().find((item) => item.vfType === "background-image");
      if (background && background !== object) canvas.sendObjectToBack(background);
      canvas.requestRenderAll();
      return true;
    }

    // Um degrau na pilha — usado pelas setas "subir"/"descer" do painel.
    function moveUp(canvas, layerId) {
      const object = findByLayerId(canvas, layerId);
      if (!object) return false;
      canvas.bringObjectForward(object);
      canvas.requestRenderAll();
      return true;
    }

    function moveDown(canvas, layerId) {
      const object = findByLayerId(canvas, layerId);
      if (!object) return false;
      canvas.sendObjectBackwards(object);
      canvas.requestRenderAll();
      return true;
    }

    return Object.freeze({
      TYPE_LABELS,
      defaultNameFor,
      findByLayerId,
      listLayers,
      setVisible,
      toggleVisible,
      setLocked,
      toggleLocked,
      rename,
      remove,
      bringToFront,
      sendToBack,
      moveUp,
      moveDown,
    });
  }

  return { createSimpleLayers, TYPE_LABELS, defaultNameFor };
});
