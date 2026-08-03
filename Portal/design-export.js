// Portal/design-export.js
// -----------------------------------------------------------------------------
// Exportação da Biblioteca de Templates: nome de arquivo, serialização do
// documento para JSON nativo e download de blobs (página em PNG, documento
// em .vfdesign.json).
//
// As partes que só existem no navegador (Blob, URL.createObjectURL, <a
// download>) recebem `documentLike`/`urlLike` por injeção, com o
// document/URL globais como padrão — mesmo padrão de dependência explícita
// dos outros módulos do estúdio. Isso deixa nome de arquivo e serialização
// testáveis em Node, e o download real funcionando no navegador sem mudar
// uma linha.
// -----------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DESIGN_EXPORT = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeSearch(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  }

  function sanitizeFilename(value, fallback) {
    const normalized = normalizeSearch(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
    return normalized || fallback;
  }

  function timestampForFile(now) {
    return (now || new Date()).toISOString().replace(/[:.]/g, "-");
  }

  function buildJsonFileName(document, now) {
    return `${sanitizeFilename(document?.name, "template")}-${timestampForFile(now)}.vfdesign.json`;
  }

  function buildPngFileName(document, page, now) {
    return `${sanitizeFilename(document?.name, "template")}-${sanitizeFilename(page?.name, "pagina")}-${timestampForFile(now)}.png`;
  }

  // Documento pronto para sair do estúdio: sem o histórico bruto do formato
  // antigo (legacySource.raw pode duplicar o mesmo conteúdo do documento
  // novo) — o arquivo exportado é só o projeto atual, reimportável pelo
  // próprio importador de JSON.
  function serializeDocumentForExport(document) {
    const { legacySource, ...rest } = document || {};
    return JSON.stringify(rest, null, 2);
  }

  function createDesignExport(deps) {
    const config = deps || {};
    const documentModel = config.documentModel;
    if (!documentModel) throw new Error("createDesignExport precisa de documentModel.");

    function downloadBlob(blob, fileName, injected) {
      const documentLike = (injected && injected.documentLike) || (typeof document !== "undefined" ? document : null);
      const urlLike = (injected && injected.urlLike) || (typeof URL !== "undefined" ? URL : null);
      if (!documentLike || !urlLike) throw new Error("downloadBlob precisa de document e URL (navegador).");
      const url = urlLike.createObjectURL(blob);
      const link = documentLike.createElement("a");
      link.href = url;
      link.download = fileName;
      documentLike.body.appendChild(link);
      link.click();
      link.remove();
      const revoke = () => urlLike.revokeObjectURL(url);
      if (typeof setTimeout === "function") setTimeout(revoke, 1000);
      else revoke();
      return { url, fileName };
    }

    function exportDocumentAsJson(document, injected) {
      const validation = documentModel.validateDocument(document);
      if (!validation.ok) throw new Error(validation.mensagem);
      const payload = serializeDocumentForExport(document);
      const BlobImpl = (injected && injected.BlobImpl) || (typeof Blob !== "undefined" ? Blob : null);
      if (!BlobImpl) throw new Error("exportDocumentAsJson precisa de Blob (navegador).");
      const blob = new BlobImpl([payload], { type: "application/json;charset=utf-8" });
      return downloadBlob(blob, buildJsonFileName(document), injected);
    }

    // `canvas` é o fabric.Canvas da página ativa no Editor Reduzido.
    async function exportPageAsPng(canvas, document, page, injected) {
      const dataUrl = canvas.toDataURL({ format: "png", multiplier: 1 });
      const fetchImpl = (injected && injected.fetchImpl) || (typeof fetch === "function" ? fetch : null);
      if (!fetchImpl) throw new Error("exportPageAsPng precisa de fetch (navegador) para converter o PNG.");
      const response = await fetchImpl(dataUrl);
      const blob = await response.blob();
      return downloadBlob(blob, buildPngFileName(document, page), injected);
    }

    return Object.freeze({
      sanitizeFilename,
      timestampForFile,
      buildJsonFileName,
      buildPngFileName,
      serializeDocumentForExport,
      downloadBlob,
      exportDocumentAsJson,
      exportPageAsPng,
    });
  }

  return {
    createDesignExport,
    sanitizeFilename,
    timestampForFile,
    buildJsonFileName,
    buildPngFileName,
    serializeDocumentForExport,
  };
});
