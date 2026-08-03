// Portal/design-document-model.js
// -----------------------------------------------------------------------------
// Modelo PURO do documento da Biblioteca de Templates (schema "vf-design-document").
//
// Aqui não existe DOM, fetch, localStorage, IndexedDB, Canvas nem Fabric.
// Só dados e regras: criar documento, validar, sanitizar, adicionar/duplicar/
// excluir/reordenar página, contar objetos e detectar/envelopar documentos
// antigos (a conversão de fato — renderizar o legado em SVG e carregar no
// Fabric — mora em design-legacy-migration.js, que já tem DOM e Fabric).
//
// Nunca executa conteúdo do documento: fabricJson é tratado como dado opaco.
// -----------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DESIGN_DOCUMENT_MODEL = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCHEMA = "vf-design-document";
  const CURRENT_VERSION = 1;
  const DEFAULT_PAGE_SIZE = { width: 1200, height: 1200 };
  // Teto conservador para o documento inteiro (document_json no banco). É
  // menor que o limite real do backend de propósito: sobra margem para o
  // banco recusar por outros motivos (overhead de coluna, outros campos do
  // registro) sem que o cliente ache que devia ter passado.
  const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
  const SOURCE_TYPES = ["blank", "json", "svg", "image", "legacy"];

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function ok() {
    return { ok: true, codigo: "OK", mensagem: "" };
  }

  function fail(codigo, mensagem) {
    return { ok: false, codigo, mensagem };
  }

  function generateId() {
    if (typeof globalThis !== "undefined" && globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    // Fallback só para ambientes sem crypto.randomUUID (Node antigo em teste).
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function sanitizeText(value, fallback, maxLength) {
    const source = typeof value === "string" ? value : fallback;
    return String(source ?? "").slice(0, maxLength || 200);
  }

  function sanitizeDimension(value, fallback) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number) || number <= 0) return fallback;
    return Math.min(number, 8000);
  }

  function isHexColor(value) {
    return /^#[0-9a-f]{3,8}$/i.test(String(value || ""));
  }

  /* ── página ───────────────────────────────────────────────────────────── */

  function createPage(input) {
    const source = isPlainObject(input) ? input : {};
    return {
      id: isNonEmptyString(source.id) ? source.id : generateId(),
      name: sanitizeText(source.name, "Página", 80),
      width: sanitizeDimension(source.width, DEFAULT_PAGE_SIZE.width),
      height: sanitizeDimension(source.height, DEFAULT_PAGE_SIZE.height),
      background: isHexColor(source.background) ? source.background : "#ffffff",
      fabricJson: isPlainObject(source.fabricJson) ? source.fabricJson : { version: "6.9.1", objects: [] },
    };
  }

  function sanitizePage(page) {
    return createPage(page);
  }

  /* ── documento ────────────────────────────────────────────────────────── */

  // options: { name, clienteId, accountRef, source: { type, originalFileName }, pages, itemType }
  function createDocument(options) {
    const source = isPlainObject(options) ? options : {};
    const pages = Array.isArray(source.pages) && source.pages.length
      ? source.pages.map(createPage)
      : [createPage({ name: "Página 1" })];

    const sourceInfo = isPlainObject(source.source) ? source.source : {};
    return {
      schema: SCHEMA,
      version: CURRENT_VERSION,
      id: isNonEmptyString(source.id) ? source.id : generateId(),
      name: sanitizeText(source.name, "Template sem nome", 120),
      clienteId: Number.isFinite(Number(source.clienteId)) ? Number(source.clienteId) : null,
      accountRef: isNonEmptyString(source.accountRef) ? source.accountRef : null,
      itemType: source.itemType === "artwork" ? "artwork" : "template",
      source: {
        type: SOURCE_TYPES.includes(sourceInfo.type) ? sourceInfo.type : "blank",
        originalFileName: isNonEmptyString(sourceInfo.originalFileName) ? sourceInfo.originalFileName.slice(0, 200) : null,
      },
      pages,
      legacySource: source.legacySource ?? null,
      thumbnail: isNonEmptyString(source.thumbnail) ? source.thumbnail : null,
    };
  }

  function isVfDesignDocument(value) {
    return isPlainObject(value) && value.schema === SCHEMA;
  }

  // Documento não reconhecido (nulo, corrompido, ou schema antigo/ausente).
  function isLegacyDocument(value) {
    if (!isPlainObject(value)) return true;
    return value.schema !== SCHEMA;
  }

  function estimateDocumentSize(document) {
    try {
      return JSON.stringify(document || {}).length;
    } catch {
      return Infinity;
    }
  }

  // Nunca lança. Devolve { ok, codigo, mensagem }.
  function validateDocument(document) {
    if (!isPlainObject(document)) {
      return fail("DOCUMENTO_INVALIDO", "O documento precisa ser um objeto.");
    }
    if (document.schema !== SCHEMA) {
      return fail("SCHEMA_INVALIDO", `O documento precisa do schema "${SCHEMA}".`);
    }
    if (!Number.isInteger(document.version) || document.version < 1) {
      return fail("VERSAO_INVALIDA", "O documento precisa de uma versão numérica válida.");
    }
    if (document.version > CURRENT_VERSION) {
      return fail("VERSAO_FUTURA", "Este documento foi salvo por uma versão mais nova do estúdio.");
    }
    if (!isNonEmptyString(document.name)) {
      return fail("NOME_AUSENTE", "O documento precisa de um nome.");
    }
    if (!Array.isArray(document.pages) || document.pages.length === 0) {
      return fail("PAGINAS_AUSENTES", "O documento precisa de ao menos uma página.");
    }
    const idsVistos = new Set();
    for (let index = 0; index < document.pages.length; index += 1) {
      const page = document.pages[index];
      if (!isPlainObject(page) || !isNonEmptyString(page.id) || !isNonEmptyString(page.name)) {
        return fail("PAGINA_INVALIDA", "Cada página precisa de id e name (texto).");
      }
      if (!(Number(page.width) > 0) || !(Number(page.height) > 0)) {
        return fail("PAGINA_SEM_TAMANHO", `A página "${page.name}" precisa de width e height positivos.`);
      }
      if (!isPlainObject(page.fabricJson)) {
        return fail("PAGINA_SEM_CONTEUDO", `A página "${page.name}" precisa de fabricJson (objeto).`);
      }
      if (idsVistos.has(page.id)) {
        return fail("PAGINA_DUPLICADA", `A página "${page.id}" está duplicada no documento.`);
      }
      idsVistos.add(page.id);
    }
    const size = estimateDocumentSize(document);
    if (size > MAX_DOCUMENT_BYTES) {
      return fail("DOCUMENTO_MUITO_GRANDE", `O documento tem ${(size / 1024 / 1024).toFixed(2)} MB, acima do limite de ${(MAX_DOCUMENT_BYTES / 1024 / 1024).toFixed(0)} MB.`);
    }
    return ok();
  }

  // Nunca lança: sempre devolve um documento normalizado, mesmo a partir de
  // dados parcialmente inválidos (é o mesmo espírito de sanitizeText nos
  // outros módulos do estúdio — corta/normaliza em vez de recusar).
  function sanitizeDocument(document) {
    const source = isPlainObject(document) ? document : {};
    const built = createDocument({
      id: source.id,
      name: source.name,
      clienteId: source.clienteId,
      accountRef: source.accountRef,
      itemType: source.itemType,
      source: source.source,
      pages: Array.isArray(source.pages) && source.pages.length ? source.pages : undefined,
      legacySource: source.legacySource,
      thumbnail: source.thumbnail,
    });
    return built;
  }

  /* ── operações de página ──────────────────────────────────────────────── */

  function withPages(document, pages) {
    return { ...document, pages };
  }

  function addPage(document, pageInput) {
    const page = createPage({
      ...pageInput,
      width: pageInput?.width ?? document.pages[0]?.width,
      height: pageInput?.height ?? document.pages[0]?.height,
    });
    return withPages(document, [...document.pages, page]);
  }

  function duplicatePage(document, pageId) {
    const index = document.pages.findIndex((page) => page.id === pageId);
    if (index === -1) return document;
    const original = document.pages[index];
    const copy = {
      ...JSON.parse(JSON.stringify(original)),
      id: generateId(),
      name: `${original.name} (cópia)`,
    };
    const pages = document.pages.slice();
    pages.splice(index + 1, 0, copy);
    return withPages(document, pages);
  }

  function removePage(document, pageId) {
    if (document.pages.length <= 1) return document;
    const pages = document.pages.filter((page) => page.id !== pageId);
    if (pages.length === document.pages.length) return document;
    return withPages(document, pages);
  }

  function renamePage(document, pageId, name) {
    const pages = document.pages.map((page) => (
      page.id === pageId ? { ...page, name: sanitizeText(name, page.name, 80) } : page
    ));
    return withPages(document, pages);
  }

  function updatePageContent(document, pageId, fabricJson) {
    const pages = document.pages.map((page) => (
      page.id === pageId ? { ...page, fabricJson: isPlainObject(fabricJson) ? fabricJson : page.fabricJson } : page
    ));
    return withPages(document, pages);
  }

  // `orderedIds` precisa conter exatamente os mesmos ids das páginas atuais;
  // caso contrário a reordenação é ignorada (documento volta inalterado) —
  // silenciosamente aceitar uma lista incompleta apagaria páginas.
  function reorderPages(document, orderedIds) {
    if (!Array.isArray(orderedIds) || orderedIds.length !== document.pages.length) return document;
    const byId = new Map(document.pages.map((page) => [page.id, page]));
    const reordered = orderedIds.map((id) => byId.get(id));
    if (reordered.some((page) => !page)) return document;
    return withPages(document, reordered);
  }

  /* ── contagem de objetos ──────────────────────────────────────────────── */

  function countObjectsInFabricJson(fabricJson) {
    const objects = Array.isArray(fabricJson?.objects) ? fabricJson.objects : [];
    let total = 0;
    objects.forEach((object) => {
      total += 1;
      if (Array.isArray(object?.objects)) {
        total += countObjectsInFabricJson(object);
      }
    });
    return total;
  }

  function countObjects(document) {
    if (!isPlainObject(document) || !Array.isArray(document.pages)) return 0;
    return document.pages.reduce((total, page) => total + countObjectsInFabricJson(page.fabricJson), 0);
  }

  return Object.freeze({
    SCHEMA,
    CURRENT_VERSION,
    DEFAULT_PAGE_SIZE,
    MAX_DOCUMENT_BYTES,
    SOURCE_TYPES,

    generateId,
    isPlainObject,
    isHexColor,
    sanitizeText,

    createPage,
    sanitizePage,
    createDocument,
    isVfDesignDocument,
    isLegacyDocument,
    estimateDocumentSize,
    validateDocument,
    sanitizeDocument,

    addPage,
    duplicatePage,
    removePage,
    renamePage,
    updatePageContent,
    reorderPages,

    countObjectsInFabricJson,
    countObjects,
  });
});
