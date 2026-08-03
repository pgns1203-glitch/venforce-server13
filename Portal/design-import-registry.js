// Portal/design-import-registry.js
// -----------------------------------------------------------------------------
// Registro PURO de importadores da Biblioteca de Templates.
//
// Um importador é só dados + funções: { id, label, accept, analyze, build }.
// Este módulo não sabe ler arquivo, não conhece FileReader nem Image — só
// resolve, por extensão, qual importador cuida de um nome de arquivo.
//
// Novo formato = registrar mais um importador aqui. Nada no modal de
// importação (design-import-modal.js) precisa mudar para isso.
// -----------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DESIGN_IMPORT_REGISTRY = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createImportRegistry() {
    const importers = [];

    function register(importer) {
      if (!importer || typeof importer.id !== "string" || !importer.id) {
        throw new Error("Importador precisa de um id.");
      }
      if (!Array.isArray(importer.accept) || importer.accept.length === 0) {
        throw new Error(`Importador "${importer.id}" precisa de extensões aceitas (accept).`);
      }
      if (typeof importer.analyze !== "function" || typeof importer.build !== "function") {
        throw new Error(`Importador "${importer.id}" precisa de analyze() e build().`);
      }
      if (importers.some((existing) => existing.id === importer.id)) {
        throw new Error(`Importador duplicado: "${importer.id}".`);
      }
      importers.push(importer);
    }

    // Extensões mais específicas primeiro (".vfdesign.json" antes de
    // ".json"): um importador cujo accept liste a mais específica ganha
    // mesmo que outro também aceite ".json".
    function resolveByFileName(fileName) {
      const lower = String(fileName || "").toLowerCase();
      const matches = importers
        .map((importer) => ({
          importer,
          extension: importer.accept.find((ext) => lower.endsWith(ext.toLowerCase())),
        }))
        .filter((entry) => entry.extension);
      if (matches.length === 0) return null;
      matches.sort((a, b) => b.extension.length - a.extension.length);
      return matches[0].importer;
    }

    function list() {
      return importers.slice();
    }

    function acceptedExtensions() {
      return [...new Set(importers.flatMap((importer) => importer.accept))];
    }

    return Object.freeze({ register, resolveByFileName, list, acceptedExtensions });
  }

  return { createImportRegistry };
});
