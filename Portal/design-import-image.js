// Portal/design-import-image.js
// -----------------------------------------------------------------------------
// Importador de imagem única (PNG, JPG, WebP) para a Biblioteca de Templates.
// PURO — recebe os metadados já lidos pelo modal (dataUrl, dimensões,
// mimeType), nunca um File/Image do navegador.
//
// Uma imagem sempre vira UMA página com UM objeto de imagem: não há camadas
// para separar, então "importar" aqui é sempre "colar a imagem inteira".
// -----------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DESIGN_IMPORT_IMAGE = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ACCEPTED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  const SINGLE_LAYER_NOTICE = "Arquivo sem camadas. A arte original foi adicionada como fundo bloqueado. Você pode adicionar novos elementos por cima.";

  function createImageImporter(deps) {
    const config = deps || {};
    const documentModel = config.documentModel;
    if (!documentModel) throw new Error("createImageImporter precisa de documentModel.");

    // input: { dataUrl, mimeType, width, height, fileName, sizeBytes }
    function analyze(input) {
      const source = input || {};
      if (!ACCEPTED_MIME_TYPES.includes(source.mimeType)) {
        return { ok: false, codigo: "FORMATO_NAO_SUPORTADO", mensagem: "Use PNG, JPG ou WebP." };
      }
      const sizeBytes = Number(source.sizeBytes) || 0;
      if (sizeBytes > MAX_IMAGE_BYTES) {
        return { ok: false, codigo: "ARQUIVO_MUITO_GRANDE", mensagem: "A imagem tem mais de 8 MB." };
      }
      if (!source.dataUrl) {
        return { ok: false, codigo: "SEM_CONTEUDO", mensagem: "Não foi possível ler o arquivo de imagem." };
      }
      const width = Math.round(Number(source.width)) || 1200;
      const height = Math.round(Number(source.height)) || 1200;

      return {
        ok: true,
        dataUrl: source.dataUrl,
        summary: {
          format: "image",
          fileName: source.fileName || null,
          sizeBytes,
          mimeType: source.mimeType,
          width,
          height,
          pageCount: 1,
          objectCount: 1,
          warnings: [SINGLE_LAYER_NOTICE],
        },
      };
    }

    // analyzeResult: retorno de analyze() com ok:true. options: { name,
    // clienteId, accountRef, itemType }.
    function build(analyzeResult, options) {
      const chosen = options || {};
      const { width, height } = analyzeResult.summary;
      const pageSize = documentModel.createPage({ name: "Página 1", width, height });
      const scale = Math.min(pageSize.width / width, pageSize.height / height);
      const renderedWidth = width * scale;
      const renderedHeight = height * scale;

      const page = documentModel.createPage({
        name: "Página 1",
        width: pageSize.width,
        height: pageSize.height,
        fabricJson: {
          version: "6.9.1",
          objects: [{
            type: "image",
            src: analyzeResult.dataUrl,
            vfId: documentModel.generateId(),
            vfName: "Arte original",
            vfType: "background-image",
            vfLocked: true,
            vfHidden: false,
            selectable: false,
            evented: false,
            left: (pageSize.width - renderedWidth) / 2,
            top: (pageSize.height - renderedHeight) / 2,
            width,
            height,
            scaleX: scale,
            scaleY: scale,
            angle: 0,
            opacity: 1,
          }],
        },
      });

      const document = documentModel.createDocument({
        name: chosen.name || analyzeResult.summary.fileName || "Imagem importada",
        clienteId: chosen.clienteId ?? null,
        accountRef: chosen.itemType === "artwork" ? (chosen.accountRef || null) : null,
        itemType: chosen.itemType === "artwork" ? "artwork" : "template",
        source: { type: "image", originalFileName: analyzeResult.summary.fileName },
        pages: [page],
      });

      return { document, warnings: [SINGLE_LAYER_NOTICE] };
    }

    return Object.freeze({
      id: "image",
      label: "Imagem (PNG, JPG, WebP)",
      accept: [".png", ".jpg", ".jpeg", ".webp"],
      analyze,
      build,
    });
  }

  return { createImageImporter, ACCEPTED_MIME_TYPES, MAX_IMAGE_BYTES, SINGLE_LAYER_NOTICE };
});
