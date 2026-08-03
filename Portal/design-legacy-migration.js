// Portal/design-legacy-migration.js
// -----------------------------------------------------------------------------
// Migração de documentos antigos (formato do Editor único e do Construtor
// Modular) para o novo schema "vf-design-document".
//
// A parte de decisão (que formato é este documento? quais páginas ele tem?
// como cada página vira SVG?) é PURA e roda com o mesmo document/renderer
// falso já usado em server/tests/designTemplateRenderer.test.js — nenhuma
// dependência de navegador aqui.
//
// A parte que só existe no navegador (SVG -> objetos Fabric) entra por
// injeção via `svgToFabricJson(svgMarkup, page)`. Quando essa função não é
// fornecida, ou falha, a página é importada como um único grupo travado — a
// mesma degradação descrita na atividade ("Template antigo convertido com
// edição limitada") — e o original nunca é apagado (`legacySource`).
// -----------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DESIGN_LEGACY_MIGRATION = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const LIMITED_EDIT_WARNING = "Template antigo convertido com edição limitada";

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  // Projeto do Construtor Modular: tem `pages`, e cada página tem rendererId
  // (ver design-template-builder-model.js). Diferencia do editor único, cujo
  // projeto nunca guarda as páginas — elas vêm da definição do template.
  function isBuilderFormat(stored) {
    return isPlainObject(stored) && Array.isArray(stored.pages) && stored.pages.length > 0
      && stored.pages.every((page) => page && typeof page.rendererId === "string");
  }

  // Projeto do editor único (design-templates.js / design-template-engine.js):
  // aponta um templateId e não guarda páginas.
  function isEditorFormat(stored) {
    return isPlainObject(stored) && typeof stored.templateId === "string" && stored.templateId.length > 0
      && !Array.isArray(stored.pages);
  }

  // "current" | "builder" | "editor" | "unknown" | "empty"
  function detectFormat(stored, documentModel) {
    if (!isPlainObject(stored) || Object.keys(stored).length === 0) return "empty";
    if (documentModel.isVfDesignDocument(stored)) return "current";
    if (isBuilderFormat(stored)) return "builder";
    if (isEditorFormat(stored)) return "editor";
    return "unknown";
  }

  function createLegacyMigration(deps) {
    const config = deps || {};
    const documentModel = config.documentModel;
    const templateEngine = config.templateEngine;
    const templatePresets = config.templatePresets;
    const componentsLib = config.componentsLib;
    const layoutsLib = config.layoutsLib;
    const templateRendererLib = config.templateRendererLib;
    const builderModel = config.builderModel;
    const documentLike = config.documentLike;
    // (svgMarkup, { width, height }) -> Promise<fabricJson|null>. Ausente em
    // Node; fornecida pela tela no navegador (ver design-simple-editor.js).
    const svgToFabricJson = typeof config.svgToFabricJson === "function" ? config.svgToFabricJson : null;
    // (node) -> string. Padrão: XMLSerializer do navegador.
    const serializeNode = typeof config.serializeNode === "function"
      ? config.serializeNode
      : (node) => (typeof XMLSerializer !== "undefined" ? new XMLSerializer().serializeToString(node) : "");

    if (!documentModel) throw new Error("createLegacyMigration precisa de documentModel.");

    function svgRenderer() {
      if (!componentsLib || !layoutsLib || !templateRendererLib || !documentLike) return null;
      return templateRendererLib.createTemplateRenderer({ documentLike, componentsLib, layoutsLib });
    }

    // Devolve [{ id, name, width, height, svgMarkup }] — uma entrada por
    // página do projeto antigo, já com o SVG serializado.
    function renderLegacyPages(stored, format) {
      const renderer = svgRenderer();
      if (!renderer) return [];

      if (format === "builder") {
        if (!builderModel || !templateEngine) return [];
        const definition = templateEngine.normalizeTemplateDefinition(builderModel.buildTemplateDefinition(stored));
        const project = builderModel.toRenderProject(stored);
        const svgs = renderer.renderAllPages({ template: definition, project, mode: "export" });
        return definition.pages.map((page, index) => ({
          id: page.id,
          name: page.name,
          width: definition.canvas.width,
          height: definition.canvas.height,
          svgMarkup: serializeNode(svgs[index]),
        }));
      }

      if (format === "editor") {
        if (!templatePresets || !templateEngine) return [];
        const registry = templateEngine.createTemplateRegistry(templatePresets.TEMPLATE_DEFINITIONS);
        const definition = registry.getById(stored.templateId) || registry.getDefault();
        const { project } = templateEngine.hydrateProjectFromTemplate(stored, definition, {});
        const svgs = renderer.renderAllPages({ template: definition, project, mode: "export" });
        return definition.pages.map((page, index) => ({
          id: page.id,
          name: page.name,
          width: definition.canvas.width,
          height: definition.canvas.height,
          svgMarkup: serializeNode(svgs[index]),
        }));
      }

      return [];
    }

    // Página que não pôde ser decomposta em objetos Fabric: um único grupo
    // travado, com o SVG original guardado como imagem de fundo textual (o
    // navegador decide como pintar isso — aqui só descrevemos o dado).
    function limitedGroupPage(legacyPage) {
      return documentModel.createPage({
        id: legacyPage.id,
        name: legacyPage.name,
        width: legacyPage.width,
        height: legacyPage.height,
        fabricJson: {
          version: "6.9.1",
          objects: [{
            type: "group",
            vfId: documentModel.generateId(),
            vfName: legacyPage.name,
            vfType: "legacy-group",
            vfLocked: true,
            vfHidden: false,
            left: 0,
            top: 0,
            width: legacyPage.width,
            height: legacyPage.height,
            objects: [],
            // Guardado para a tela poder desenhar o SVG original como
            // referência visual, sem ser um objeto editável.
            vfLegacySvg: legacyPage.svgMarkup,
          }],
        },
      });
    }

    async function convertPage(legacyPage) {
      if (!svgToFabricJson) return { page: limitedGroupPage(legacyPage), limited: true };
      try {
        const fabricJson = await svgToFabricJson(legacyPage.svgMarkup, legacyPage);
        if (!fabricJson || !Array.isArray(fabricJson.objects)) {
          return { page: limitedGroupPage(legacyPage), limited: true };
        }
        return {
          page: documentModel.createPage({
            id: legacyPage.id,
            name: legacyPage.name,
            width: legacyPage.width,
            height: legacyPage.height,
            fabricJson,
          }),
          limited: false,
        };
      } catch {
        return { page: limitedGroupPage(legacyPage), limited: true };
      }
    }

    // stored: document_json bruto do item (template ou arte) antigo.
    // context: { name, clienteId, accountRef, itemType }.
    // Devolve { document, format, warnings: string[] }. `format === "current"`
    // significa que não havia nada para migrar (documento já é o schema novo).
    async function migrateDocument(stored, context) {
      const info = context || {};
      const format = detectFormat(stored, documentModel);

      if (format === "current") {
        return { document: documentModel.sanitizeDocument(stored), format, warnings: [] };
      }

      const legacyPages = format === "builder" || format === "editor" ? renderLegacyPages(stored, format) : [];
      const warnings = [];

      let pages;
      if (legacyPages.length === 0) {
        pages = [documentModel.createPage({ name: "Página 1" })];
        if (format !== "empty") warnings.push(LIMITED_EDIT_WARNING);
      } else {
        const converted = await Promise.all(legacyPages.map(convertPage));
        pages = converted.map((entry) => entry.page);
        if (converted.some((entry) => entry.limited)) warnings.push(LIMITED_EDIT_WARNING);
      }

      const document = documentModel.createDocument({
        name: info.name || stored?.name || stored?.clienteNome || "Template migrado",
        clienteId: info.clienteId ?? stored?.clienteId ?? null,
        accountRef: info.accountRef ?? null,
        itemType: info.itemType === "artwork" ? "artwork" : "template",
        source: { type: "legacy", originalFileName: null },
        pages,
        legacySource: { format, raw: JSON.parse(JSON.stringify(stored || {})) },
      });

      return { document, format, warnings };
    }

    return Object.freeze({
      LIMITED_EDIT_WARNING,
      detectFormat: (stored) => detectFormat(stored, documentModel),
      renderLegacyPages,
      migrateDocument,
    });
  }

  return { createLegacyMigration, isBuilderFormat, isEditorFormat, LIMITED_EDIT_WARNING };
});
