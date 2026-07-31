// Portal/design-template-engine.js
// -----------------------------------------------------------------------------
// Motor PURO de templates do Estúdio de Templates.
//
// Aqui não existe DOM, fetch, localStorage, IndexedDB nem Canvas. Só regras:
// schema da definição de template, registro de templates, criação de projeto
// padrão a partir de uma definição, hidratação de projeto salvo e resolução
// das páginas de um template.
//
// Uma definição de template é só dados serializáveis (id, nome, páginas com
// rendererId, defaults, limites de sanitização). Nenhuma função de
// renderização entra aqui — quem decide o que rendererId significa é a tela,
// através de um registro interno de funções (ver PAGE_RENDERERS em
// design-templates.js). Este módulo nunca executa código recebido no JSON.
//
// É esse arquivo que os testes de Node exercitam (server/tests/designTemplateEngine.test.js).
// O navegador consome via <script> e lê window.VF_DESIGN_TEMPLATE_ENGINE.
// -----------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DESIGN_TEMPLATE_ENGINE = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Schema do PROJETO salvo (localStorage), não da definição do template.
  // Continua 2 pelo mesmo motivo de sempre: schema V2 separa arquivo original,
  // versão editada e parâmetros de edição da imagem do produto.
  const PROJECT_SCHEMA_VERSION = 2;

  const ZOOM_LEVELS = [75, 100, 125];

  /* ── utilitários ──────────────────────────────────────────────────────── */

  function clamp(value, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return min;
    return Math.min(max, Math.max(min, number));
  }

  function isHexColor(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || ""));
  }

  function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  // Mesma regra que a tela já usava: valor vazio/nulo cai no default; o
  // resultado é sempre cortado no tamanho máximo do schema do template.
  function sanitizeText(value, fallback, maxLength) {
    const source = value || fallback;
    return String(source).slice(0, maxLength || 500);
  }

  /* ── validação de definição de template ───────────────────────────────── */

  function templateError(codigo, mensagem) {
    return { ok: false, codigo, mensagem };
  }

  // Nunca lança. Devolve { ok, codigo, mensagem }. É a única porta de entrada
  // que decide se uma definição pode virar template utilizável.
  function validateTemplateDefinition(definition) {
    if (!definition || typeof definition !== "object") {
      return templateError("DEFINICAO_INVALIDA", "A definição do template precisa ser um objeto.");
    }
    if (!isNonEmptyString(definition.id)) {
      return templateError("ID_AUSENTE", "A definição do template precisa de um id.");
    }
    if (!isNonEmptyString(definition.name)) {
      return templateError("NOME_AUSENTE", "A definição do template precisa de um nome.");
    }
    if (!definition.canvas || typeof definition.canvas !== "object"
      || !(Number(definition.canvas.width) > 0) || !(Number(definition.canvas.height) > 0)) {
      return templateError("CANVAS_INVALIDO", "A definição do template precisa de canvas.width e canvas.height positivos.");
    }
    if (!Array.isArray(definition.pages) || definition.pages.length === 0) {
      return templateError("PAGINAS_AUSENTES", "A definição do template precisa de ao menos uma página.");
    }

    const idsVistos = new Set();
    for (let index = 0; index < definition.pages.length; index += 1) {
      const page = definition.pages[index];
      if (!page || typeof page !== "object"
        || !isNonEmptyString(page.id) || !isNonEmptyString(page.name) || !isNonEmptyString(page.rendererId)) {
        return templateError("PAGINA_INVALIDA", "Cada página precisa de id, name e rendererId (texto).");
      }
      // O preset é dado, não código: uma função aqui seria execução de
      // conteúdo armazenado, exatamente o que este motor precisa evitar.
      if (typeof page.renderer === "function" || typeof page.render === "function"
        || typeof page.rendererId === "function") {
        return templateError("RENDERER_EXECUTAVEL", "A página não pode declarar uma função de renderização.");
      }
      if (idsVistos.has(page.id)) {
        return templateError("PAGINA_DUPLICADA", `A página "${page.id}" está duplicada na definição.`);
      }
      idsVistos.add(page.id);
    }

    if (!definition.defaults || typeof definition.defaults !== "object") {
      return templateError("DEFAULTS_AUSENTES", "A definição do template precisa de defaults.");
    }

    return { ok: true, codigo: "OK", mensagem: "" };
  }

  function normalizeContentSchema(schema) {
    const source = schema && typeof schema === "object" ? schema : {};
    const normalized = {};
    Object.keys(source).forEach((key) => {
      const maxLength = Number(source[key] && source[key].maxLength);
      normalized[key] = { maxLength: Number.isFinite(maxLength) && maxLength > 0 ? maxLength : 500 };
    });
    return normalized;
  }

  function normalizeFieldSchema(schema, key, fallbackMaxLength) {
    const rule = schema && typeof schema === "object" ? schema[key] : null;
    const maxLength = Number(rule && rule.maxLength);
    return { maxLength: Number.isFinite(maxLength) && maxLength > 0 ? maxLength : fallbackMaxLength };
  }

  function normalizePalette(palette) {
    const source = palette && typeof palette === "object" ? palette : {};
    const fallback = { primary: "#123047", secondary: "#ef6f55", background: "#f4efe5", text: "#12202b" };
    return {
      primary: isHexColor(source.primary) ? source.primary : fallback.primary,
      secondary: isHexColor(source.secondary) ? source.secondary : fallback.secondary,
      background: isHexColor(source.background) ? source.background : fallback.background,
      text: isHexColor(source.text) ? source.text : fallback.text,
    };
  }

  // Definição -> definição normalizada e congelada, pronta para uso pela tela.
  // Lança se a definição for estruturalmente inválida: não há normalização
  // segura para um template sem id, sem páginas ou com página duplicada — é
  // erro de configuração, não dado de usuário.
  function normalizeTemplateDefinition(definition) {
    const validation = validateTemplateDefinition(definition);
    if (!validation.ok) {
      const error = new Error(validation.mensagem);
      error.codigo = validation.codigo;
      throw error;
    }

    const pages = definition.pages.map((page) => Object.freeze({
      id: String(page.id),
      name: String(page.name),
      rendererId: String(page.rendererId),
    }));

    const defaultsSource = definition.defaults;
    const productSource = defaultsSource.product && typeof defaultsSource.product === "object" ? defaultsSource.product : {};
    const contentSource = defaultsSource.content && typeof defaultsSource.content === "object" ? defaultsSource.content : {};

    return Object.freeze({
      id: String(definition.id),
      name: String(definition.name),
      segment: String(definition.segment || ""),
      marketplace: String(definition.marketplace || ""),
      canvas: Object.freeze({
        width: Math.round(Number(definition.canvas.width)),
        height: Math.round(Number(definition.canvas.height)),
      }),
      pages: Object.freeze(pages),
      defaults: Object.freeze({
        clienteNome: String(defaultsSource.clienteNome || "Cliente personalizado"),
        marcaNome: String(defaultsSource.marcaNome || "NOVA"),
        palette: Object.freeze(normalizePalette(defaultsSource.palette)),
        product: Object.freeze({
          name: String(productSource.name || "Produto"),
          subtitle: String(productSource.subtitle || ""),
        }),
        content: Object.freeze({ ...contentSource }),
        selectedPage: Number.isInteger(defaultsSource.selectedPage) ? defaultsSource.selectedPage : 0,
        compareMode: defaultsSource.compareMode === "original" ? "original" : "custom",
        zoom: ZOOM_LEVELS.includes(Number(defaultsSource.zoom)) ? Number(defaultsSource.zoom) : 100,
      }),
      contentSchema: Object.freeze(normalizeContentSchema(definition.contentSchema)),
      productSchema: Object.freeze({
        name: normalizeFieldSchema(definition.productSchema, "name", 64),
        subtitle: normalizeFieldSchema(definition.productSchema, "subtitle", 120),
      }),
      clientSchema: Object.freeze({
        clienteNome: normalizeFieldSchema(definition.clientSchema, "clienteNome", 80),
        marcaNome: normalizeFieldSchema(definition.clientSchema, "marcaNome", 40),
      }),
    });
  }

  /* ── registro de templates ────────────────────────────────────────────── */

  // Cada definição é normalizada e validada aqui. Ids duplicados são erro de
  // configuração do catálogo (dois presets com o mesmo id) e derrubam o boot
  // de propósito, em vez de silenciosamente esconder um dos dois.
  function createTemplateRegistry(definitions) {
    if (!Array.isArray(definitions) || definitions.length === 0) {
      throw new Error("O registro de templates precisa de ao menos uma definição.");
    }

    const list = [];
    const byId = new Map();

    definitions.forEach((definition) => {
      const normalized = normalizeTemplateDefinition(definition);
      if (byId.has(normalized.id)) {
        throw new Error(`Id de template duplicado no registro: "${normalized.id}".`);
      }
      byId.set(normalized.id, normalized);
      list.push(normalized);
    });

    return {
      getAll: () => list.slice(),
      getById: (id) => byId.get(String(id)) || null,
      getDefault: () => list[0],
    };
  }

  function getTemplatePageDefinitions(definition) {
    return definition.pages.slice();
  }

  /* ── projeto padrão ───────────────────────────────────────────────────── */

  // Sem o módulo de imagem (não carregado / falhou), a tela ainda funciona em
  // modo reduzido — este é o mesmo fallback que a tela já aplicava antes da
  // extração para o motor.
  function fallbackEmptyImage() {
    return { id: null, dataUrl: null, url: null, fileName: "", mimeType: "", width: null, height: null };
  }

  function fallbackDefaultProduct() {
    return {
      originalImage: fallbackEmptyImage(),
      editedImage: fallbackEmptyImage(),
      editing: {},
      placement: { scale: 100, x: 50, y: 50 },
    };
  }

  function buildProduct(definition, imageModel) {
    const base = imageModel ? imageModel.createDefaultProduct() : fallbackDefaultProduct();
    return {
      ...base,
      name: definition.defaults.product.name,
      subtitle: definition.defaults.product.subtitle,
    };
  }

  function buildEmptyImage(imageModel) {
    return imageModel ? imageModel.createEmptyImageRef() : fallbackEmptyImage();
  }

  // Projeto novo a partir de uma definição de template já normalizada.
  // `helpers.imageModel` é opcional (mesma degradação graciosa de sempre).
  function createProjectFromTemplate(definition, helpers) {
    const imageModel = helpers && helpers.imageModel;
    return {
      version: PROJECT_SCHEMA_VERSION,
      templateId: definition.id,
      clienteId: null,
      clienteNome: definition.defaults.clienteNome,
      marcaNome: definition.defaults.marcaNome,
      palette: { ...definition.defaults.palette },
      product: buildProduct(definition, imageModel),
      logo: buildEmptyImage(imageModel),
      content: { ...definition.defaults.content },
      selectedPage: definition.defaults.selectedPage,
      view: "library",
      compareMode: definition.defaults.compareMode,
      zoom: definition.defaults.zoom,
    };
  }

  /* ── hidratação de projeto salvo ───────────────────────────────────────── */

  // Só a parte de imagens/enquadramento — igual à tela fazia antes, delegando
  // ao modelo de imagem quando disponível.
  function hydrateImages(stored, imageModel) {
    if (!imageModel) {
      return { product: fallbackDefaultProduct(), logo: fallbackEmptyImage(), migrado: false };
    }

    const versao = imageModel.detectSchemaVersion(stored);
    if (versao === 2) {
      return {
        product: imageModel.normalizeProductImages(stored.product),
        logo: imageModel.normalizeImageRef(stored.logo),
        migrado: false,
      };
    }

    const migracao = imageModel.migrateImagesFromV1(stored);
    return {
      product: migracao.product,
      logo: migracao.logo,
      migrado: true,
      logoDescartado: migracao.logoDescartado,
    };
  }

  // Projeto salvo (ou null/corrompido) -> { project, migration }.
  // `migration` é null quando não houve migração V1->V2, ou
  // { logoDescartado } quando houve — a tela decide o que fazer com isso
  // (persistir de novo, avisar o usuário).
  //
  // Se o templateId salvo não bate com o da definição informada (template
  // removido, ou o preset resolvido é o fallback do registro), o projeto é
  // descartado inteiro e o padrão do template atual é usado — mesma regra que
  // a tela já aplicava quando só existia um template.
  function hydrateProjectFromTemplate(stored, definition, helpers) {
    const imageModel = helpers && helpers.imageModel;
    const defaults = createProjectFromTemplate(definition, helpers);

    if (!stored || typeof stored !== "object" || stored.templateId !== definition.id) {
      return { project: defaults, migration: null };
    }

    const imagens = hydrateImages(stored, imageModel);
    const migration = imagens.migrado ? { logoDescartado: Boolean(imagens.logoDescartado) } : null;

    const content = {};
    Object.keys(defaults.content).forEach((key) => {
      const rule = definition.contentSchema[key] || { maxLength: 500 };
      const storedValue = stored.content && typeof stored.content === "object" ? stored.content[key] : undefined;
      content[key] = sanitizeText(storedValue, defaults.content[key], rule.maxLength);
    });

    const storedPalette = stored.palette && typeof stored.palette === "object" ? stored.palette : {};
    const storedProduct = stored.product && typeof stored.product === "object" ? stored.product : {};

    const project = {
      ...defaults,
      clienteId: stored.clienteId ?? null,
      clienteNome: sanitizeText(stored.clienteNome, defaults.clienteNome, definition.clientSchema.clienteNome.maxLength),
      marcaNome: sanitizeText(stored.marcaNome, defaults.marcaNome, definition.clientSchema.marcaNome.maxLength),
      palette: {
        primary: isHexColor(storedPalette.primary) ? storedPalette.primary : defaults.palette.primary,
        secondary: isHexColor(storedPalette.secondary) ? storedPalette.secondary : defaults.palette.secondary,
        background: isHexColor(storedPalette.background) ? storedPalette.background : defaults.palette.background,
        text: isHexColor(storedPalette.text) ? storedPalette.text : defaults.palette.text,
      },
      product: {
        ...imagens.product,
        name: sanitizeText(storedProduct.name, defaults.product.name, definition.productSchema.name.maxLength),
        subtitle: sanitizeText(storedProduct.subtitle, defaults.product.subtitle, definition.productSchema.subtitle.maxLength),
      },
      logo: imagens.logo,
      content,
      selectedPage: clamp(stored.selectedPage ?? 0, 0, definition.pages.length - 1),
      view: stored.view === "editor" ? "editor" : "library",
      compareMode: stored.compareMode === "original" ? "original" : "custom",
      zoom: ZOOM_LEVELS.includes(Number(stored.zoom)) ? Number(stored.zoom) : 100,
    };

    return { project, migration };
  }

  return {
    PROJECT_SCHEMA_VERSION,

    validateTemplateDefinition,
    normalizeTemplateDefinition,
    createTemplateRegistry,
    getTemplatePageDefinitions,

    createProjectFromTemplate,
    hydrateProjectFromTemplate,
  };
});
