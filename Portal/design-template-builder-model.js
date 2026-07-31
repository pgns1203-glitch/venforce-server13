// Portal/design-template-builder-model.js
// -----------------------------------------------------------------------------
// Núcleo PURO do Construtor Modular de Carrosséis.
//
// Aqui não existe DOM, fetch, localStorage, IndexedDB nem Canvas. Só as regras
// do construtor: catálogo de páginas modulares, segmentos, estilos visuais,
// projeto padrão, inclusão/remoção/reordenação de páginas, sanitização,
// validação e a conversão do projeto em uma definição de template que o motor
// (design-template-engine.js) já sabe consumir.
//
// O construtor NUNCA fornece função de renderização: uma página é só um id
// (`rendererId`) resolvido no registro controlado de design-template-layouts.js.
// Um id fora do catálogo é erro explícito, nunca uma página silenciosa.
//
// É este arquivo que os testes de Node exercitam
// (server/tests/designTemplateBuilder.test.js). O navegador consome via
// <script> e lê window.VF_DESIGN_TEMPLATE_BUILDER_MODEL.
// -----------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DESIGN_TEMPLATE_BUILDER_MODEL = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const BUILDER_SCHEMA_VERSION = 1;
  const CANVAS = { width: 1200, height: 1200 };
  const ZOOM_LEVELS = [75, 100, 125];

  // Tetos de lista: acima disso a arte não comporta mais itens sem virar
  // texto ilegível, então o excesso é cortado no modelo (não no desenho).
  const MAX_BENEFITS = 3;
  const MAX_SPECS = 6;
  const MAX_PACKAGE_ITEMS = 6;

  /* ── catálogo de páginas modulares ────────────────────────────────────── */

  // `id` é exatamente o rendererId registrado em design-template-layouts.js.
  // `required: true` marca a capa: pode ser reordenada, nunca removida.
  const PAGE_TYPES = [
    {
      id: "cover-split-v1",
      name: "Capa dividida",
      description: "Produto em destaque com título e benefício principal.",
      dataHint: "Nome do produto, benefício principal e imagem",
      fields: ["product.name", "content.mainBenefit"],
      required: true,
    },
    {
      id: "benefits-three-cards-v1",
      name: "Benefícios em três cards",
      description: "Até três benefícios numerados ao lado do produto.",
      dataHint: "Benefício 1, 2 e 3",
      fields: ["content.benefit1", "content.benefit2", "content.benefit3"],
      required: false,
    },
    {
      id: "specifications-grid-v1",
      name: "Especificações em grade",
      description: "Ficha técnica em grade de chave e valor.",
      dataHint: "Especificações técnicas, uma por linha",
      fields: ["content.specs"],
      required: false,
    },
    {
      id: "package-list-v1",
      name: "Conteúdo da embalagem",
      description: "Lista numerada do que acompanha o produto.",
      dataHint: "Conteúdo da embalagem, um item por linha",
      fields: ["content.packageItems"],
      required: false,
    },
    {
      id: "dimensions-technical-v1",
      name: "Dimensões técnicas",
      description: "Medidas reais com cotas e marcadores técnicos.",
      dataHint: "Largura, altura ou profundidade",
      fields: ["content.width", "content.height", "content.depth"],
      required: false,
    },
  ];

  const PAGE_TYPE_IDS = PAGE_TYPES.map((page) => page.id);
  const REQUIRED_PAGE_IDS = PAGE_TYPES.filter((page) => page.required).map((page) => page.id);

  const SEGMENTS = ["Ferramentas", "Moda", "Móveis", "Cosméticos", "Eletrônicos", "Geral"];

  // Cada estilo é só uma paleta inicial + escolhas visuais controladas. A
  // designer troca as cores depois: o estilo nunca sobrescreve o que ela
  // ajustou (ver applyStyle, que só age quando o estilo muda de fato).
  const STYLES = [
    {
      id: "industrial-claro",
      name: "Industrial claro",
      palette: { primary: "#2f4858", secondary: "#f08a24", background: "#f2f0ec", text: "#1b2731" },
    },
    {
      id: "tecnico-escuro",
      name: "Técnico escuro",
      palette: { primary: "#16202b", secondary: "#3fb6a8", background: "#e8ecef", text: "#111a22" },
    },
    {
      id: "minimalista",
      name: "Minimalista",
      palette: { primary: "#2b2b2b", secondary: "#8a8f98", background: "#fafafa", text: "#1a1a1a" },
    },
    {
      id: "comercial",
      name: "Comercial",
      palette: { primary: "#123f8c", secondary: "#e8443a", background: "#f5f7fb", text: "#101a2c" },
    },
    {
      id: "elegante",
      name: "Elegante",
      palette: { primary: "#3c2f4a", secondary: "#c2a15c", background: "#f6f2ee", text: "#241d2c" },
    },
  ];

  const STYLE_IDS = STYLES.map((style) => style.id);

  /* ── schemas de sanitização ───────────────────────────────────────────── */

  const CONTENT_SCHEMA = {
    mainBenefit: { maxLength: 120 },
    benefit1: { maxLength: 90 },
    benefit2: { maxLength: 90 },
    benefit3: { maxLength: 90 },
    specs: { maxLength: 420, maxLines: MAX_SPECS },
    packageItems: { maxLength: 360, maxLines: MAX_PACKAGE_ITEMS },
    width: { maxLength: 18 },
    height: { maxLength: 18 },
    depth: { maxLength: 18 },
    howToUse: { maxLength: 220 },
    warranty: { maxLength: 160 },
    shipping: { maxLength: 160 },
  };

  const PRODUCT_SCHEMA = { name: { maxLength: 64 }, subtitle: { maxLength: 140 } };
  const CLIENT_SCHEMA = { clienteNome: { maxLength: 80 }, marcaNome: { maxLength: 40 } };
  const PROJECT_NAME_MAX = 80;

  /* ── utilitários puros ────────────────────────────────────────────────── */

  function isHexColor(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || ""));
  }

  function isPlainText(value) {
    return typeof value === "string" || typeof value === "number";
  }

  // Regra central contra "undefined" e "[object Object]" na arte: só texto e
  // número viram conteúdo; qualquer outra coisa (objeto, null, função,
  // array) some. Nada é convertido às cegas com String().
  function sanitizeText(value, maxLength) {
    if (!isPlainText(value)) return "";
    return String(value).slice(0, maxLength || 200);
  }

  // Lista digitada uma por linha: descarta vazias, corta no teto de linhas e
  // aplica o limite total de caracteres depois de limpar.
  function sanitizeLines(value, rule) {
    if (!isPlainText(value)) return "";
    return String(value)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, rule.maxLines || MAX_SPECS)
      .join("\n")
      .slice(0, rule.maxLength || 400);
  }

  function countLines(value) {
    if (!isPlainText(value)) return 0;
    return String(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length;
  }

  function clampZoom(value) {
    return ZOOM_LEVELS.includes(Number(value)) ? Number(value) : 100;
  }

  function newProjectId(random) {
    const rnd = typeof random === "function" ? random() : Math.random();
    return `crs-${Date.now().toString(36)}-${Math.floor(rnd * 1e9).toString(36)}`;
  }

  function getPageType(id) {
    return PAGE_TYPES.find((page) => page.id === String(id)) || null;
  }

  function isKnownPageId(id) {
    return PAGE_TYPES.some((page) => page.id === String(id));
  }

  function getStyle(id) {
    return STYLES.find((style) => style.id === String(id)) || null;
  }

  function builderError(codigo, mensagem) {
    const error = new Error(mensagem);
    error.codigo = codigo;
    return error;
  }

  /* ── imagens ──────────────────────────────────────────────────────────── */

  // Sem o modelo de imagem (módulo não carregado) o construtor continua de pé
  // em modo reduzido — mesma degradação graciosa do resto do estúdio.
  function fallbackEmptyImage() {
    return { id: null, dataUrl: null, url: null, fileName: "", mimeType: "", width: null, height: null };
  }

  function emptyImage(imageModel) {
    return imageModel ? imageModel.createEmptyImageRef() : fallbackEmptyImage();
  }

  function defaultProduct(imageModel) {
    if (imageModel) return imageModel.createDefaultProduct();
    return {
      originalImage: fallbackEmptyImage(),
      editedImage: fallbackEmptyImage(),
      editing: {},
      placement: { scale: 100, x: 50, y: 50 },
    };
  }

  /* ── projeto padrão ───────────────────────────────────────────────────── */

  // Conteúdo inicial de exemplo: o construtor abre com um carrossel visível e
  // coerente, que a designer sobrescreve. Sem isso a primeira tela seria uma
  // sequência de peças em branco.
  const DEFAULT_CONTENT = {
    mainBenefit: "Resolve o trabalho pesado em um único passo.",
    benefit1: "Motor de alto rendimento para uso contínuo.",
    benefit2: "Montagem rápida, sem ferramenta extra.",
    benefit3: "Acabamento resistente para o dia a dia.",
    specs: "Potência: 650 W\nReservatório: 800 ml\nVazão: 650 ml/min\nTensão: 220 V",
    packageItems: "1 produto\n1 manual de uso\n1 cabo de energia",
    width: "28 cm",
    height: "42 cm",
    depth: "19 cm",
    howToUse: "Conecte, selecione a intensidade e comece a usar.",
    warranty: "Garantia de 12 meses contra defeitos de fabricação.",
    shipping: "Envio rápido com acompanhamento do pedido.",
  };

  function createDefaultContent() {
    return { ...DEFAULT_CONTENT };
  }

  // options: { id, name, segment, style, clienteId, clienteNome, marcaNome,
  //            imageModel, random }
  function createDefaultProject(options) {
    const config = options || {};
    const imageModel = config.imageModel || null;
    const style = getStyle(config.style) || STYLES[0];
    const agora = new Date().toISOString();

    return {
      version: BUILDER_SCHEMA_VERSION,
      id: config.id || newProjectId(config.random),
      name: sanitizeText(config.name || "Novo carrossel", PROJECT_NAME_MAX),
      createdAt: agora,
      updatedAt: agora,

      clienteId: config.clienteId == null ? null : config.clienteId,
      clienteNome: sanitizeText(config.clienteNome || "Cliente personalizado", CLIENT_SCHEMA.clienteNome.maxLength),
      marcaNome: sanitizeText(config.marcaNome || "SUA MARCA", CLIENT_SCHEMA.marcaNome.maxLength),

      segment: SEGMENTS.includes(config.segment) ? config.segment : "Geral",
      style: style.id,
      palette: { ...style.palette },

      logo: emptyImage(imageModel),
      product: {
        ...defaultProduct(imageModel),
        name: "Produto em destaque",
        subtitle: "Descreva em uma frase o diferencial do produto.",
      },
      content: createDefaultContent(),

      // Todas as páginas entram marcadas: o construtor abre mostrando o
      // conjunto inteiro, e a designer remove o que não usar.
      pages: PAGE_TYPE_IDS.slice(),
      selectedPage: 0,
      zoom: 100,
      compareMode: "custom",
    };
  }

  /* ── sanitização de projeto ───────────────────────────────────────────── */

  // Ordena e desduplica a lista de páginas, mantendo só ids conhecidos e
  // garantindo a presença das obrigatórias. Nunca lança: é o caminho de
  // leitura de dado salvo, que pode vir de uma versão anterior.
  function normalizePages(pages) {
    const vistos = new Set();
    const saida = [];
    (Array.isArray(pages) ? pages : []).forEach((id) => {
      const texto = String(id);
      if (!isKnownPageId(texto) || vistos.has(texto)) return;
      vistos.add(texto);
      saida.push(texto);
    });
    REQUIRED_PAGE_IDS.forEach((id) => {
      if (!vistos.has(id)) saida.unshift(id);
    });
    return saida;
  }

  function normalizePalette(palette, fallback) {
    const source = palette && typeof palette === "object" ? palette : {};
    const base = fallback || STYLES[0].palette;
    return {
      primary: isHexColor(source.primary) ? source.primary : base.primary,
      secondary: isHexColor(source.secondary) ? source.secondary : base.secondary,
      background: isHexColor(source.background) ? source.background : base.background,
      text: isHexColor(source.text) ? source.text : base.text,
    };
  }

  function normalizeContent(content) {
    const source = content && typeof content === "object" ? content : {};
    const saida = {};
    Object.keys(CONTENT_SCHEMA).forEach((key) => {
      const rule = CONTENT_SCHEMA[key];
      saida[key] = rule.maxLines
        ? sanitizeLines(source[key], rule)
        : sanitizeText(source[key], rule.maxLength);
    });
    return saida;
  }

  function normalizeProduct(product, imageModel) {
    const source = product && typeof product === "object" ? product : {};
    const imagens = imageModel
      ? imageModel.normalizeProductImages(source)
      : defaultProduct(imageModel);
    return {
      ...imagens,
      name: sanitizeText(source.name, PRODUCT_SCHEMA.name.maxLength),
      subtitle: sanitizeText(source.subtitle, PRODUCT_SCHEMA.subtitle.maxLength),
    };
  }

  // Projeto salvo (ou parcial, ou corrompido) -> projeto utilizável.
  // Campos ausentes caem no padrão; campos inválidos são descartados.
  function sanitizeProject(stored, options) {
    const config = options || {};
    const imageModel = config.imageModel || null;
    const source = stored && typeof stored === "object" ? stored : {};
    const padrao = createDefaultProject({ imageModel, random: config.random });
    const style = getStyle(source.style) || getStyle(padrao.style);

    return {
      version: BUILDER_SCHEMA_VERSION,
      id: sanitizeText(source.id, 64) || padrao.id,
      name: sanitizeText(source.name, PROJECT_NAME_MAX),
      createdAt: sanitizeText(source.createdAt, 40) || padrao.createdAt,
      updatedAt: sanitizeText(source.updatedAt, 40) || padrao.updatedAt,

      clienteId: source.clienteId == null ? null : source.clienteId,
      clienteNome: sanitizeText(source.clienteNome, CLIENT_SCHEMA.clienteNome.maxLength),
      marcaNome: sanitizeText(source.marcaNome, CLIENT_SCHEMA.marcaNome.maxLength),

      segment: SEGMENTS.includes(source.segment) ? source.segment : "Geral",
      style: style.id,
      palette: normalizePalette(source.palette, style.palette),

      logo: imageModel ? imageModel.normalizeImageRef(source.logo) : fallbackEmptyImage(),
      product: normalizeProduct(source.product, imageModel),
      content: normalizeContent(source.content),

      pages: normalizePages(source.pages),
      selectedPage: 0,
      zoom: clampZoom(source.zoom),
      compareMode: source.compareMode === "original" ? "original" : "custom",
    };
  }

  /* ── operações sobre páginas ──────────────────────────────────────────── */

  // Todas devolvem uma NOVA lista; nenhuma altera a recebida. Um id fora do
  // catálogo é erro explícito — o construtor não inventa página.
  function addPage(pages, pageId) {
    const id = String(pageId);
    if (!isKnownPageId(id)) {
      throw builderError("PAGINA_DESCONHECIDA", `Não existe página modular com o id "${id}".`);
    }
    const atual = normalizePages(pages);
    if (atual.includes(id)) return atual;
    return atual.concat(id);
  }

  function removePage(pages, pageId) {
    const id = String(pageId);
    if (!isKnownPageId(id)) {
      throw builderError("PAGINA_DESCONHECIDA", `Não existe página modular com o id "${id}".`);
    }
    if (REQUIRED_PAGE_IDS.includes(id)) {
      throw builderError("PAGINA_OBRIGATORIA", "A capa é obrigatória e não pode ser removida do carrossel.");
    }
    return normalizePages(pages).filter((atual) => atual !== id);
  }

  function togglePage(pages, pageId, incluir) {
    return incluir ? addPage(pages, pageId) : removePage(pages, pageId);
  }

  // direction: -1 sobe, +1 desce. Nas pontas não faz nada (não circula: a
  // designer clicaria "subir" na primeira e a página iria para o fim).
  function movePage(pages, pageId, direction) {
    const id = String(pageId);
    const atual = normalizePages(pages);
    const indice = atual.indexOf(id);
    if (indice === -1) {
      throw builderError("PAGINA_AUSENTE", `A página "${id}" não está incluída no carrossel.`);
    }
    const destino = indice + (Number(direction) < 0 ? -1 : 1);
    if (destino < 0 || destino >= atual.length) return atual;
    const saida = atual.slice();
    saida[indice] = saida[destino];
    saida[destino] = id;
    return saida;
  }

  function canMovePage(pages, pageId, direction) {
    const atual = normalizePages(pages);
    const indice = atual.indexOf(String(pageId));
    if (indice === -1) return false;
    const destino = indice + (Number(direction) < 0 ? -1 : 1);
    return destino >= 0 && destino < atual.length;
  }

  /* ── estilo visual ────────────────────────────────────────────────────── */

  // Aplicar um estilo troca a paleta inteira. É uma ação explícita da
  // designer (mudar o select), por isso pode sobrescrever as cores atuais.
  function applyStyle(project, styleId) {
    const style = getStyle(styleId);
    if (!style) {
      throw builderError("ESTILO_DESCONHECIDO", `Não existe estilo visual com o id "${styleId}".`);
    }
    return { ...project, style: style.id, palette: { ...style.palette } };
  }

  /* ── validação ────────────────────────────────────────────────────────── */

  // Nunca lança. Devolve { ok, erros: [{ campo, codigo, mensagem }] } com
  // mensagens escritas para a designer, não para o log.
  function validateProject(project) {
    const erros = [];
    const source = project && typeof project === "object" ? project : {};

    if (!sanitizeText(source.name, PROJECT_NAME_MAX).trim()) {
      erros.push({ campo: "name", codigo: "NOME_PROJETO_AUSENTE", mensagem: "Dê um nome ao projeto antes de salvar." });
    }

    const produto = source.product && typeof source.product === "object" ? source.product : {};
    if (!sanitizeText(produto.name, PRODUCT_SCHEMA.name.maxLength).trim()) {
      erros.push({ campo: "product.name", codigo: "NOME_PRODUTO_AUSENTE", mensagem: "Informe o nome do produto." });
    }

    const pages = Array.isArray(source.pages) ? source.pages : [];
    if (pages.length === 0) {
      erros.push({ campo: "pages", codigo: "SEM_PAGINAS", mensagem: "Escolha ao menos uma página para o carrossel." });
    }

    const desconhecidas = pages.map(String).filter((id) => !isKnownPageId(id));
    if (desconhecidas.length) {
      erros.push({
        campo: "pages",
        codigo: "PAGINA_DESCONHECIDA",
        mensagem: `Página não reconhecida pelo estúdio: ${desconhecidas.join(", ")}.`,
      });
    }

    const duplicadas = pages.map(String).filter((id, indice, lista) => lista.indexOf(id) !== indice);
    if (duplicadas.length) {
      erros.push({
        campo: "pages",
        codigo: "PAGINA_DUPLICADA",
        mensagem: `A mesma página foi incluída duas vezes: ${[...new Set(duplicadas)].join(", ")}.`,
      });
    }

    REQUIRED_PAGE_IDS.forEach((id) => {
      if (!pages.map(String).includes(id)) {
        erros.push({
          campo: "pages",
          codigo: "CAPA_AUSENTE",
          mensagem: "A capa é obrigatória e precisa estar no carrossel.",
        });
      }
    });

    const palette = source.palette && typeof source.palette === "object" ? source.palette : {};
    ["primary", "secondary", "background", "text"].forEach((chave) => {
      if (!isHexColor(palette[chave])) {
        erros.push({
          campo: `palette.${chave}`,
          codigo: "COR_INVALIDA",
          mensagem: `A cor "${chave}" precisa estar no formato hexadecimal (#RRGGBB).`,
        });
      }
    });

    if (countLines(source.content && source.content.specs) > MAX_SPECS) {
      erros.push({
        campo: "content.specs",
        codigo: "LIMITE_ESPECIFICACOES",
        mensagem: `A grade comporta no máximo ${MAX_SPECS} especificações.`,
      });
    }
    if (countLines(source.content && source.content.packageItems) > MAX_PACKAGE_ITEMS) {
      erros.push({
        campo: "content.packageItems",
        codigo: "LIMITE_EMBALAGEM",
        mensagem: `A lista comporta no máximo ${MAX_PACKAGE_ITEMS} itens.`,
      });
    }

    return { ok: erros.length === 0, erros };
  }

  /* ── projeto -> definição de template ─────────────────────────────────── */

  // A definição devolvida é dado puro e serializável: cada página aponta um
  // rendererId conhecido, jamais uma função. É exatamente o formato que
  // design-template-engine.js normaliza e o renderizador consome.
  function buildTemplateDefinition(project) {
    const limpo = project && typeof project === "object" ? project : {};
    const pages = normalizePages(limpo.pages);
    if (!pages.length) {
      throw builderError("SEM_PAGINAS", "O carrossel precisa de ao menos uma página.");
    }

    // Os fallbacks usam trim(): um nome só com espaços é vazio para o motor
    // (isNonEmptyString), e a prévia não pode apagar porque a designer
    // limpou o campo. A validação é quem cobra o nome de verdade.
    return {
      id: `builder-${sanitizeText(limpo.id, 64).trim() || "sem-id"}`,
      name: sanitizeText(limpo.name, PROJECT_NAME_MAX).trim() || "Carrossel modular",
      segment: SEGMENTS.includes(limpo.segment) ? limpo.segment : "Geral",
      marketplace: "Carrossel modular",
      canvas: { ...CANVAS },
      pages: pages.map((id) => {
        const tipo = getPageType(id);
        return { id, name: tipo.name, rendererId: tipo.id };
      }),
      defaults: {
        clienteNome: sanitizeText(limpo.clienteNome, CLIENT_SCHEMA.clienteNome.maxLength).trim() || "Cliente personalizado",
        marcaNome: sanitizeText(limpo.marcaNome, CLIENT_SCHEMA.marcaNome.maxLength).trim() || "MARCA",
        palette: normalizePalette(limpo.palette),
        product: {
          name: sanitizeText(limpo.product && limpo.product.name, PRODUCT_SCHEMA.name.maxLength),
          subtitle: sanitizeText(limpo.product && limpo.product.subtitle, PRODUCT_SCHEMA.subtitle.maxLength),
        },
        content: normalizeContent(limpo.content),
        selectedPage: 0,
        compareMode: "custom",
        zoom: 100,
      },
      contentSchema: CONTENT_SCHEMA,
      productSchema: PRODUCT_SCHEMA,
      clientSchema: CLIENT_SCHEMA,
    };
  }

  // O projeto do construtor já tem a forma que os layouts esperam
  // (palette, marcaNome, logo, product, content). Esta função devolve a
  // fatia lida pelo renderizador, sem os metadados do construtor.
  function toRenderProject(project) {
    return {
      templateId: `builder-${sanitizeText(project.id, 64).trim() || "sem-id"}`,
      clienteId: project.clienteId ?? null,
      clienteNome: sanitizeText(project.clienteNome, CLIENT_SCHEMA.clienteNome.maxLength),
      marcaNome: sanitizeText(project.marcaNome, CLIENT_SCHEMA.marcaNome.maxLength),
      palette: normalizePalette(project.palette),
      logo: project.logo,
      product: {
        ...project.product,
        name: sanitizeText(project.product && project.product.name, PRODUCT_SCHEMA.name.maxLength),
        subtitle: sanitizeText(project.product && project.product.subtitle, PRODUCT_SCHEMA.subtitle.maxLength),
      },
      content: normalizeContent(project.content),
      selectedPage: 0,
      compareMode: "custom",
      zoom: clampZoom(project.zoom),
    };
  }

  /* ── resumo para a interface ──────────────────────────────────────────── */

  // Estado de cada página modular para a lista de seleção: incluída ou não,
  // posição, se pode subir/descer e se os dados que ela pede estão vazios.
  function describePages(project) {
    const pages = normalizePages(project && project.pages);
    const content = normalizeContent(project && project.content);
    const produto = (project && project.product) || {};
    const valorDe = (caminho) => {
      if (caminho === "product.name") return sanitizeText(produto.name, PRODUCT_SCHEMA.name.maxLength);
      const chave = caminho.replace(/^content\./, "");
      return content[chave] || "";
    };

    return PAGE_TYPES.map((tipo) => {
      const posicao = pages.indexOf(tipo.id);
      const incluida = posicao >= 0;
      return {
        id: tipo.id,
        name: tipo.name,
        description: tipo.description,
        dataHint: tipo.dataHint,
        required: tipo.required,
        incluida,
        posicao,
        podeSubir: incluida && canMovePage(pages, tipo.id, -1),
        podeDescer: incluida && canMovePage(pages, tipo.id, 1),
        semDados: tipo.fields.every((campo) => !String(valorDe(campo)).trim()),
      };
    });
  }

  return {
    BUILDER_SCHEMA_VERSION,
    CANVAS,
    ZOOM_LEVELS,
    MAX_BENEFITS,
    MAX_SPECS,
    MAX_PACKAGE_ITEMS,
    PROJECT_NAME_MAX,

    PAGE_TYPES,
    PAGE_TYPE_IDS,
    REQUIRED_PAGE_IDS,
    SEGMENTS,
    STYLES,
    STYLE_IDS,
    CONTENT_SCHEMA,
    PRODUCT_SCHEMA,
    CLIENT_SCHEMA,

    isHexColor,
    sanitizeText,
    sanitizeLines,
    countLines,
    newProjectId,
    getPageType,
    isKnownPageId,
    getStyle,

    createDefaultProject,
    createDefaultContent,
    sanitizeProject,
    normalizePages,
    normalizePalette,
    normalizeContent,

    addPage,
    removePage,
    togglePage,
    movePage,
    canMovePage,
    applyStyle,

    validateProject,
    buildTemplateDefinition,
    toRenderProject,
    describePages,
  };
});
