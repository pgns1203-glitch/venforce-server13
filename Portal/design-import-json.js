// Portal/design-import-json.js
// -----------------------------------------------------------------------------
// Importador de JSON nativo (schema "vf-design-document") para a Biblioteca
// de Templates. PURO — recebe texto já lido pelo modal, nunca um File.
//
// Nunca executa o conteúdo do arquivo: o JSON só passa por JSON.parse e pela
// validação/sanitização de design-document-model.js.
// -----------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DESIGN_IMPORT_JSON = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function createJsonImporter(deps) {
    const documentModel = deps && deps.documentModel;
    if (!documentModel) throw new Error("createJsonImporter precisa de documentModel.");

    function parseJson(text) {
      try {
        return { ok: true, data: JSON.parse(text) };
      } catch {
        return { ok: false, data: null };
      }
    }

    // input: { text, fileName, sizeBytes }
    //
    // Validação ANTES de qualquer normalização: sanitizeDocument() completa
    // campos ausentes com defaults (é o que queremos ao gravar um documento
    // já confiável), mas isso mascararia exatamente os JSONs incompletos que
    // esta etapa precisa rejeitar (schema ausente, sem páginas, sem nome...).
    // Só depois de aprovado pela validação estrita o documento é aceito tal
    // como veio do arquivo.
    function analyze(input) {
      const source = input || {};
      const parsed = parseJson(source.text || "");
      if (!parsed.ok) {
        return { ok: false, codigo: "JSON_INVALIDO", mensagem: "O arquivo não é um JSON válido." };
      }
      if (!documentModel.isPlainObject(parsed.data)) {
        return { ok: false, codigo: "JSON_INVALIDO", mensagem: "O arquivo precisa representar um objeto JSON." };
      }
      const validation = documentModel.validateDocument(parsed.data);
      if (!validation.ok) {
        return { ok: false, codigo: validation.codigo, mensagem: validation.mensagem };
      }
      const document = parsed.data;
      return {
        ok: true,
        document,
        summary: {
          format: "json",
          fileName: source.fileName || null,
          sizeBytes: Number(source.sizeBytes) || documentModel.estimateDocumentSize(document),
          name: document.name,
          pageCount: document.pages.length,
          objectCount: documentModel.countObjects(document),
          warnings: [],
        },
      };
    }

    // analyzeResult: retorno de analyze() com ok:true.
    // options: { name, clienteId, accountRef, itemType }
    // Devolve { document, warnings } — mesmo contrato de build() dos
    // importadores de SVG e imagem, para o modal poder tratar os três de
    // forma uniforme.
    function build(analyzeResult, options) {
      const chosen = options || {};
      const base = analyzeResult.document;
      const document = documentModel.sanitizeDocument({
        ...base,
        id: documentModel.generateId(),
        name: chosen.name || base.name,
        clienteId: chosen.clienteId ?? base.clienteId ?? null,
        accountRef: chosen.itemType === "artwork" ? (chosen.accountRef || null) : null,
        itemType: chosen.itemType === "artwork" ? "artwork" : "template",
        source: { type: "json", originalFileName: analyzeResult.summary.fileName },
        legacySource: null,
      });
      return { document, warnings: [] };
    }

    return Object.freeze({
      id: "json",
      label: "JSON nativo (.json / .vfdesign.json)",
      accept: [".vfdesign.json", ".json"],
      analyze,
      build,
    });
  }

  return { createJsonImporter };
});
