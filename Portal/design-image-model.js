// Portal/design-image-model.js
// -----------------------------------------------------------------------------
// Núcleo PURO do editor de imagem do Estúdio de Templates.
//
// Aqui não existe DOM, Fabric.js, fetch, localStorage nem IndexedDB. Só regras:
// schema do projeto, migração V1 -> V2, limites dos ajustes, histórico de
// desfazer/refazer, validação de arquivo e coleta de imagens órfãs.
//
// É esse arquivo que os testes de Node exercitam (server/tests/designImage*.test.js).
// O navegador consome via <script> e lê window.VF_DESIGN_IMAGE_MODEL.
// -----------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DESIGN_IMAGE_MODEL = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCHEMA_VERSION = 2;

  // Limites de arquivo. O caminho "servidor" normaliza com Sharp e aceita mais;
  // o caminho "local" (servidor indisponível) precisa caber em armazenamento
  // do navegador, por isso continua conservador.
  const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
  const MAX_LOCAL_BYTES = 2 * 1024 * 1024;

  // Formatos rasterizados seguros. SVG fica fora de propósito: um SVG é um
  // documento executável e o projeto não tem sanitizador. Ver docs.
  const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];
  const ALLOWED_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

  // Abaixo disso a arte de 1200x1200 fica visivelmente macia.
  const LOW_RESOLUTION_PX = 600;

  const HISTORY_LIMIT = 50;

  // Faixas dos ajustes. Brilho/contraste/saturação em -100..100 (0 = neutro)
  // para o usuário; a conversão para a escala do Fabric fica no editor.
  const ADJUSTMENT_RANGES = {
    rotation: { min: 0, max: 360 },
    brightness: { min: -100, max: 100 },
    contrast: { min: -100, max: 100 },
    saturation: { min: -100, max: 100 },
    sharpen: { min: 0, max: 100 },
    scale: { min: 10, max: 400 },
    shadowBlur: { min: 0, max: 100 },
    shadowOffset: { min: -100, max: 100 },
    shadowOpacity: { min: 0, max: 100 },
  };

  // Enquadramento dentro da peça: mesmos limites que a tela já usava em V1.
  const PLACEMENT_RANGES = {
    scale: { min: 60, max: 145 },
    x: { min: 20, max: 80 },
    y: { min: 20, max: 80 },
  };

  const TRANSPARENT = "transparent";

  /* ── utilitários ──────────────────────────────────────────────────────── */

  function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
  }

  function clampRange(value, range, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return clamp(number, range.min, range.max);
  }

  function isHexColor(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || ""));
  }

  function normalizeRotation(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    const wrapped = number % 360;
    return Math.round((wrapped < 0 ? wrapped + 360 : wrapped) * 100) / 100;
  }

  function isDataImageUrl(value) {
    return typeof value === "string" && /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(value);
  }

  function positiveIntOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
  }

  function extensionOf(fileName) {
    const match = /\.([a-z0-9]+)$/i.exec(String(fileName || "").trim());
    return match ? match[1].toLowerCase() : "";
  }

  // Nomes de arquivo chegam do sistema operacional do usuário: podem conter
  // caminho, separadores, controle e unicode invisível. Só o nome interessa.
  function sanitizeFileName(value) {
    const raw = String(value == null ? "" : value);
    const base = raw.split(/[\\/]/).pop() || "";
    return base
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u2028\u2029\uFEFF]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
  }

  function newImageId(prefix, random) {
    const rnd = typeof random === "function" ? random() : Math.random();
    const suffix = Math.floor(rnd * 1e9).toString(36);
    return `${prefix}-${Date.now().toString(36)}-${suffix}`;
  }

  /* ── validação de arquivo ─────────────────────────────────────────────── */

  // Retorna { ok, codigo, mensagem, mimeType, extensao }. Nunca lança.
  // `mode` é "servidor" (padrão, limite maior) ou "local".
  function validateImageFile(file, options) {
    const mode = options && options.mode === "local" ? "local" : "servidor";
    const maxBytes = mode === "local" ? MAX_LOCAL_BYTES : MAX_UPLOAD_BYTES;

    if (!file) {
      return { ok: false, codigo: "ARQUIVO_AUSENTE", mensagem: "Nenhum arquivo foi selecionado." };
    }

    const fileName = sanitizeFileName(file.name);
    const mimeType = String(file.type || "").toLowerCase().split(";")[0].trim();
    const extension = extensionOf(fileName);

    if (mimeType === "image/svg+xml" || extension === "svg") {
      return {
        ok: false,
        codigo: "SVG_NAO_SUPORTADO",
        mensagem: "SVG não é aceito aqui. Use PNG, JPG ou WebP.",
      };
    }

    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return {
        ok: false,
        codigo: "TIPO_INVALIDO",
        mensagem: "Formato não suportado. Use PNG, JPG ou WebP.",
      };
    }

    // Extensão e MIME precisam concordar: o MIME vem do navegador e pode ser
    // forjado por renomeação. Discordância é sinal de arquivo suspeito.
    if (extension && !ALLOWED_EXTENSIONS.includes(extension)) {
      return {
        ok: false,
        codigo: "EXTENSAO_INVALIDA",
        mensagem: "A extensão do arquivo não corresponde a uma imagem suportada.",
      };
    }

    const size = Number(file.size);
    if (!Number.isFinite(size) || size <= 0) {
      return { ok: false, codigo: "ARQUIVO_VAZIO", mensagem: "O arquivo selecionado está vazio." };
    }
    if (size > maxBytes) {
      const limite = Math.round(maxBytes / (1024 * 1024));
      return {
        ok: false,
        codigo: "ARQUIVO_GRANDE",
        mensagem: `Imagem muito grande. O limite é de ${limite} MB.`,
      };
    }

    return { ok: true, codigo: "OK", mensagem: "", mimeType, extensao: extension, fileName };
  }

  function isLowResolution(width, height) {
    const w = Number(width);
    const h = Number(height);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return false;
    return Math.min(w, h) < LOW_RESOLUTION_PX;
  }

  /* ── ajustes (editing) ────────────────────────────────────────────────── */

  function createDefaultEditing() {
    return {
      crop: null,
      rotation: 0,
      flipX: false,
      flipY: false,
      scale: 100,
      offsetX: 0,
      offsetY: 0,
      brightness: 0,
      contrast: 0,
      saturation: 0,
      sharpen: 0,
      backgroundColor: TRANSPARENT,
      shadow: { enabled: false, blur: 0, offsetX: 0, offsetY: 0, opacity: 0 },
    };
  }

  // Crop em pixels da imagem ORIGINAL (não da tela). Guardar em pixels-fonte
  // torna o recorte independente do zoom do editor e reversível.
  function normalizeCrop(crop) {
    if (!crop || typeof crop !== "object") return null;
    const x = Number(crop.x);
    const y = Number(crop.y);
    const width = Number(crop.width);
    const height = Number(crop.height);
    if (![x, y, width, height].every((value) => Number.isFinite(value))) return null;
    if (width <= 0 || height <= 0) return null;
    return {
      x: Math.max(0, Math.round(x)),
      y: Math.max(0, Math.round(y)),
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
    };
  }

  function normalizeShadow(shadow) {
    const defaults = createDefaultEditing().shadow;
    if (!shadow || typeof shadow !== "object") return defaults;
    return {
      enabled: shadow.enabled === true,
      blur: clampRange(shadow.blur, ADJUSTMENT_RANGES.shadowBlur, defaults.blur),
      offsetX: clampRange(shadow.offsetX, ADJUSTMENT_RANGES.shadowOffset, defaults.offsetX),
      offsetY: clampRange(shadow.offsetY, ADJUSTMENT_RANGES.shadowOffset, defaults.offsetY),
      opacity: clampRange(shadow.opacity, ADJUSTMENT_RANGES.shadowOpacity, defaults.opacity),
    };
  }

  function normalizeEditing(editing) {
    const defaults = createDefaultEditing();
    if (!editing || typeof editing !== "object") return defaults;
    const backgroundColor = isHexColor(editing.backgroundColor)
      ? String(editing.backgroundColor).toLowerCase()
      : TRANSPARENT;
    return {
      crop: normalizeCrop(editing.crop),
      rotation: normalizeRotation(editing.rotation),
      flipX: editing.flipX === true,
      flipY: editing.flipY === true,
      scale: clampRange(editing.scale, ADJUSTMENT_RANGES.scale, defaults.scale),
      offsetX: clamp(Number.isFinite(Number(editing.offsetX)) ? editing.offsetX : 0, -2000, 2000),
      offsetY: clamp(Number.isFinite(Number(editing.offsetY)) ? editing.offsetY : 0, -2000, 2000),
      brightness: clampRange(editing.brightness, ADJUSTMENT_RANGES.brightness, defaults.brightness),
      contrast: clampRange(editing.contrast, ADJUSTMENT_RANGES.contrast, defaults.contrast),
      saturation: clampRange(editing.saturation, ADJUSTMENT_RANGES.saturation, defaults.saturation),
      sharpen: clampRange(editing.sharpen, ADJUSTMENT_RANGES.sharpen, defaults.sharpen),
      backgroundColor,
      shadow: normalizeShadow(editing.shadow),
    };
  }

  function cloneEditing(editing) {
    const normalized = normalizeEditing(editing);
    return {
      ...normalized,
      crop: normalized.crop ? { ...normalized.crop } : null,
      shadow: { ...normalized.shadow },
    };
  }

  // Comparação estrutural barata — os ajustes são objetos planos e pequenos.
  function editingEquals(a, b) {
    const left = normalizeEditing(a);
    const right = normalizeEditing(b);
    return JSON.stringify(left) === JSON.stringify(right);
  }

  // "Neutro" = nada a aplicar. Usado para decidir se a imagem editada some.
  function isNeutralEditing(editing) {
    return editingEquals(editing, createDefaultEditing());
  }

  /* ── referências de imagem ────────────────────────────────────────────── */

  function createEmptyImageRef() {
    return {
      id: null,
      dataUrl: null,
      url: null,
      fileName: "",
      mimeType: "",
      width: null,
      height: null,
    };
  }

  function normalizeImageRef(ref) {
    const empty = createEmptyImageRef();
    if (!ref || typeof ref !== "object") return empty;
    const mimeType = String(ref.mimeType || "").toLowerCase().split(";")[0].trim();
    return {
      id: ref.id == null || ref.id === "" ? null : String(ref.id).slice(0, 80),
      dataUrl: isDataImageUrl(ref.dataUrl) ? ref.dataUrl : null,
      url: typeof ref.url === "string" && /^https?:\/\//i.test(ref.url) ? ref.url.slice(0, 500) : null,
      fileName: sanitizeFileName(ref.fileName),
      mimeType: ALLOWED_MIME_TYPES.includes(mimeType) ? mimeType : "",
      width: positiveIntOrNull(ref.width),
      height: positiveIntOrNull(ref.height),
    };
  }

  function hasImage(ref) {
    const normalized = normalizeImageRef(ref);
    return Boolean(normalized.dataUrl || normalized.id);
  }

  // Fonte efetiva usada pelas 7 peças: a editada ganha da original.
  function resolveProductImageSource(product) {
    if (!product || typeof product !== "object") return null;
    const edited = normalizeImageRef(product.editedImage);
    if (edited.dataUrl) return edited.dataUrl;
    const original = normalizeImageRef(product.originalImage);
    return original.dataUrl || null;
  }

  function normalizePlacement(placement) {
    const defaults = { scale: 100, x: 50, y: 50 };
    if (!placement || typeof placement !== "object") return defaults;
    return {
      scale: clampRange(placement.scale, PLACEMENT_RANGES.scale, defaults.scale),
      x: clampRange(placement.x, PLACEMENT_RANGES.x, defaults.x),
      y: clampRange(placement.y, PLACEMENT_RANGES.y, defaults.y),
    };
  }

  function createDefaultProduct() {
    return {
      originalImage: createEmptyImageRef(),
      editedImage: createEmptyImageRef(),
      editing: createDefaultEditing(),
      placement: { scale: 100, x: 50, y: 50 },
    };
  }

  function normalizeProductImages(product) {
    const source = product && typeof product === "object" ? product : {};
    return {
      originalImage: normalizeImageRef(source.originalImage),
      editedImage: normalizeImageRef(source.editedImage),
      editing: normalizeEditing(source.editing),
      placement: normalizePlacement(source.placement),
    };
  }

  /* ── migração V1 -> V2 ────────────────────────────────────────────────── */

  // Detecta o formato salvo. Projetos anteriores gravavam
  // product.imageDataUrl / product.scale / logoDataUrl na raiz.
  function detectSchemaVersion(stored) {
    if (!stored || typeof stored !== "object") return null;
    const declared = Number(stored.version);
    if (Number.isFinite(declared) && declared >= 2) return 2;
    return 1;
  }

  // Converte só a parte de imagens/enquadramento. O restante do projeto
  // (paleta, textos, cliente) continua sendo responsabilidade da tela.
  //
  // `makeId` é injetável para deixar o teste determinístico.
  function migrateImagesFromV1(stored, options) {
    const makeId = (options && typeof options.makeId === "function")
      ? options.makeId
      : (prefix) => newImageId(prefix);

    const source = stored && typeof stored === "object" ? stored : {};
    const legacyProduct = source.product && typeof source.product === "object" ? source.product : {};

    const product = createDefaultProduct();
    product.placement = normalizePlacement({
      scale: legacyProduct.scale,
      x: legacyProduct.x,
      y: legacyProduct.y,
    });

    if (isDataImageUrl(legacyProduct.imageDataUrl)) {
      product.originalImage = normalizeImageRef({
        id: makeId("prod"),
        dataUrl: legacyProduct.imageDataUrl,
        fileName: legacyProduct.fileName,
        mimeType: mimeFromDataUrl(legacyProduct.imageDataUrl),
      });
    }

    // O logo do V1 aceitava SVG. Um data URL de SVG não passa em
    // normalizeImageRef e é descartado de propósito — a tela avisa o usuário.
    const logo = isDataImageUrl(source.logoDataUrl)
      ? normalizeImageRef({
        id: makeId("logo"),
        dataUrl: source.logoDataUrl,
        fileName: source.logoFileName,
        mimeType: mimeFromDataUrl(source.logoDataUrl),
      })
      : createEmptyImageRef();

    const logoDescartado = Boolean(source.logoDataUrl) && !logo.dataUrl;

    return { product, logo, logoDescartado };
  }

  function mimeFromDataUrl(dataUrl) {
    const match = /^data:(image\/[a-z+]+);base64,/i.exec(String(dataUrl || ""));
    return match ? match[1].toLowerCase() : "";
  }

  /* ── separação leve / pesada para armazenamento ───────────────────────── */

  // Devolve { leve, blobs }: `leve` vai para o localStorage (sem base64),
  // `blobs` é [{ id, dataUrl }] e vai para o IndexedDB.
  function splitProjectForStorage(project) {
    const blobs = [];
    const clone = JSON.parse(JSON.stringify(project || {}));

    const strip = (ref) => {
      if (!ref || typeof ref !== "object") return createEmptyImageRef();
      const normalized = normalizeImageRef(ref);
      if (normalized.dataUrl && normalized.id) {
        blobs.push({ id: normalized.id, dataUrl: normalized.dataUrl });
      }
      return { ...normalized, dataUrl: null };
    };

    if (clone.product && typeof clone.product === "object") {
      clone.product.originalImage = strip(clone.product.originalImage);
      clone.product.editedImage = strip(clone.product.editedImage);
    }
    clone.logo = strip(clone.logo);

    return { leve: clone, blobs };
  }

  // Todos os ids de imagem que o projeto ainda referencia.
  function collectImageIds(project) {
    const ids = [];
    const push = (ref) => {
      const normalized = normalizeImageRef(ref);
      if (normalized.id) ids.push(normalized.id);
    };
    if (project && typeof project === "object") {
      if (project.product && typeof project.product === "object") {
        push(project.product.originalImage);
        push(project.product.editedImage);
      }
      push(project.logo);
    }
    return [...new Set(ids)];
  }

  // Ids guardados que ninguém referencia mais -> podem ser apagados.
  function collectOrphanIds(project, storedIds) {
    const alive = new Set(collectImageIds(project));
    return [...new Set(Array.isArray(storedIds) ? storedIds : [])]
      .filter((id) => typeof id === "string" && id && !alive.has(id));
  }

  /* ── histórico (desfazer / refazer) ───────────────────────────────────── */

  // Guarda SÓ os parâmetros de edição (objeto plano de ~15 campos).
  // Nenhuma cópia de imagem entra aqui — é o ponto central do requisito.
  function createHistory(initialEditing, options) {
    const limit = Math.max(2, Number(options && options.limit) || HISTORY_LIMIT);
    return {
      limit,
      index: 0,
      entries: [cloneEditing(initialEditing)],
    };
  }

  function historyCurrent(history) {
    if (!history || !Array.isArray(history.entries) || !history.entries.length) {
      return createDefaultEditing();
    }
    const index = clamp(history.index, 0, history.entries.length - 1);
    return cloneEditing(history.entries[index]);
  }

  // Entrada idêntica à atual é ignorada: evita empilhar ruído de slider.
  function historyPush(history, editing) {
    const base = history && Array.isArray(history.entries) && history.entries.length
      ? history
      : createHistory(editing, { limit: history && history.limit });
    const index = clamp(base.index, 0, base.entries.length - 1);
    if (editingEquals(base.entries[index], editing)) {
      return { ...base, index, entries: base.entries.slice() };
    }
    const entries = base.entries.slice(0, index + 1);
    entries.push(cloneEditing(editing));
    const overflow = Math.max(0, entries.length - base.limit);
    const trimmed = overflow ? entries.slice(overflow) : entries;
    return { ...base, entries: trimmed, index: trimmed.length - 1 };
  }

  function canUndo(history) {
    return Boolean(history && Array.isArray(history.entries) && history.index > 0);
  }

  function canRedo(history) {
    return Boolean(history && Array.isArray(history.entries) && history.index < history.entries.length - 1);
  }

  function historyUndo(history) {
    if (!canUndo(history)) return { ...history, entries: history.entries.slice() };
    return { ...history, index: history.index - 1, entries: history.entries.slice() };
  }

  function historyRedo(history) {
    if (!canRedo(history)) return { ...history, entries: history.entries.slice() };
    return { ...history, index: history.index + 1, entries: history.entries.slice() };
  }

  /* ── sessão de edição ─────────────────────────────────────────────────── */

  // Uma sessão encapsula "o que o modal está editando agora". Cancelar
  // simplesmente joga a sessão fora; o projeto nunca é tocado no meio.
  function createEditingSession(product, options) {
    const normalized = normalizeProductImages(product);
    const editing = cloneEditing(normalized.editing);
    return {
      originalImage: normalized.originalImage,
      baseline: cloneEditing(editing),
      history: createHistory(editing, options),
    };
  }

  function sessionEditing(session) {
    return historyCurrent(session && session.history);
  }

  function sessionHasChanges(session) {
    if (!session) return false;
    return !editingEquals(session.baseline, sessionEditing(session));
  }

  // Resultado do "Aplicar edição": novo product, sem mutar o recebido.
  // `rendered` = { dataUrl, width, height } produzido pelo canvas, ou null
  // quando a edição é neutra (aí a imagem editada é descartada).
  function applyEditingToProduct(product, editing, rendered, options) {
    const makeId = (options && typeof options.makeId === "function")
      ? options.makeId
      : (prefix) => newImageId(prefix);

    const base = normalizeProductImages(product);
    const nextEditing = cloneEditing(editing);

    if (!hasImage(base.originalImage)) {
      return { ...base, editing: createDefaultEditing() };
    }

    if (isNeutralEditing(nextEditing) || !rendered || !isDataImageUrl(rendered.dataUrl)) {
      return { ...base, editedImage: createEmptyImageRef(), editing: nextEditing };
    }

    return {
      ...base,
      editing: nextEditing,
      editedImage: normalizeImageRef({
        id: makeId("edit"),
        dataUrl: rendered.dataUrl,
        fileName: base.originalImage.fileName,
        mimeType: mimeFromDataUrl(rendered.dataUrl),
        width: rendered.width,
        height: rendered.height,
      }),
    };
  }

  // "Restaurar imagem original": mantém o upload, zera edição e derivada.
  function restoreOriginalImage(product) {
    const base = normalizeProductImages(product);
    return {
      ...base,
      editedImage: createEmptyImageRef(),
      editing: createDefaultEditing(),
    };
  }

  // "Remover imagem": limpa tudo, inclusive o enquadramento na peça.
  function clearProductImage(product) {
    const base = normalizeProductImages(product);
    return {
      ...base,
      originalImage: createEmptyImageRef(),
      editedImage: createEmptyImageRef(),
      editing: createDefaultEditing(),
      placement: normalizePlacement(base.placement),
    };
  }

  return {
    SCHEMA_VERSION,
    MAX_UPLOAD_BYTES,
    MAX_LOCAL_BYTES,
    ALLOWED_MIME_TYPES,
    ALLOWED_EXTENSIONS,
    LOW_RESOLUTION_PX,
    HISTORY_LIMIT,
    ADJUSTMENT_RANGES,
    PLACEMENT_RANGES,
    TRANSPARENT,

    clamp,
    clampRange,
    isHexColor,
    isDataImageUrl,
    mimeFromDataUrl,
    normalizeRotation,
    sanitizeFileName,
    newImageId,

    validateImageFile,
    isLowResolution,

    createDefaultEditing,
    normalizeEditing,
    cloneEditing,
    editingEquals,
    isNeutralEditing,
    normalizeCrop,
    normalizeShadow,

    createEmptyImageRef,
    normalizeImageRef,
    hasImage,
    resolveProductImageSource,
    normalizePlacement,
    createDefaultProduct,
    normalizeProductImages,

    detectSchemaVersion,
    migrateImagesFromV1,

    splitProjectForStorage,
    collectImageIds,
    collectOrphanIds,

    createHistory,
    historyCurrent,
    historyPush,
    historyUndo,
    historyRedo,
    canUndo,
    canRedo,

    createEditingSession,
    sessionEditing,
    sessionHasChanges,
    applyEditingToProduct,
    restoreOriginalImage,
    clearProductImage,
  };
});
