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

  // Cinco FAMÍLIAS, três VARIAÇÕES visuais cada — quinze layouts ao todo.
  //
  // Uma página do projeto guarda `family` (o assunto) e `rendererId` (o
  // desenho). Os dois são necessários: a família decide se a página entra no
  // carrossel; o rendererId decide como ela é desenhada. Representar só pela
  // família apagaria a variação escolhida.
  //
  // A primeira variação de cada família é a que existia antes desta fase e
  // continua sendo o padrão — projeto salvo com o id antigo reabre igual.
  const PAGE_FAMILIES = [
    {
      id: "cover",
      name: "Capa",
      required: true,
      dataHint: "Nome do produto, benefício principal e imagem",
      fields: ["product.name", "content.mainBenefit"],
      variants: [
        { rendererId: "cover-split-v1", name: "Capa dividida", description: "Texto à esquerda, produto grande à direita." },
        { rendererId: "cover-centered-v1", name: "Capa centralizada", description: "Eixo vertical centralizado sobre painel escuro." },
        { rendererId: "cover-impact-v1", name: "Capa de impacto", description: "Título muito grande com faixa diagonal e produto ampliado." },
      ],
    },
    {
      id: "benefits",
      name: "Benefícios",
      required: false,
      dataHint: "Benefício 1, 2 e 3",
      fields: ["content.benefit1", "content.benefit2", "content.benefit3"],
      variants: [
        { rendererId: "benefits-three-cards-v1", name: "Três cards", description: "Produto no topo e até três cards numerados." },
        { rendererId: "benefits-side-list-v1", name: "Lista lateral", description: "Painel escuro com o produto à esquerda e a lista à direita." },
        { rendererId: "benefits-orbit-v1", name: "Órbita", description: "Produto ao centro com os benefícios em torno de um anel." },
      ],
    },
    {
      id: "specifications",
      name: "Especificações",
      required: false,
      dataHint: "Especificações técnicas, uma por linha",
      fields: ["content.specs"],
      variants: [
        { rendererId: "specifications-grid-v1", name: "Grade", description: "Chave e valor em duas colunas." },
        { rendererId: "specifications-table-v1", name: "Tabela", description: "Cabeçalho escuro e linhas alternadas." },
        { rendererId: "specifications-cards-v1", name: "Cartões", description: "Cada especificação em um cartão de destaque." },
      ],
    },
    {
      id: "package",
      name: "Conteúdo da embalagem",
      required: false,
      dataHint: "Conteúdo da embalagem, um item por linha",
      fields: ["content.packageItems"],
      variants: [
        { rendererId: "package-list-v1", name: "Lista numerada", description: "Lista à esquerda e produto à direita." },
        { rendererId: "package-grid-v1", name: "Grade de itens", description: "Cabeçalho escuro e itens em células." },
        { rendererId: "package-focus-v1", name: "Item principal", description: "Primeiro item em faixa de destaque." },
      ],
    },
    {
      id: "dimensions",
      name: "Dimensões",
      required: false,
      dataHint: "Largura, altura ou profundidade",
      fields: ["content.width", "content.height", "content.depth"],
      variants: [
        { rendererId: "dimensions-technical-v1", name: "Cotas técnicas", description: "Malha técnica com cotas e fichas de medida." },
        { rendererId: "dimensions-panel-v1", name: "Painel de medidas", description: "Produto à esquerda e painel escuro à direita." },
        { rendererId: "dimensions-clean-v1", name: "Medidas limpas", description: "Produto grande ao centro e pílulas no rodapé." },
      ],
    },
  ];

  const FAMILY_IDS = PAGE_FAMILIES.map((familia) => familia.id);
  const REQUIRED_FAMILY_IDS = PAGE_FAMILIES.filter((familia) => familia.required).map((familia) => familia.id);

  // rendererId -> { family, variant }. É por aqui que um projeto salvo com o
  // id antigo (que era o próprio rendererId) reencontra a família.
  const LAYOUT_INDEX = new Map();
  PAGE_FAMILIES.forEach((familia) => {
    familia.variants.forEach((variante) => {
      LAYOUT_INDEX.set(variante.rendererId, { family: familia.id, variant: variante });
    });
  });

  const LAYOUT_IDS = [...LAYOUT_INDEX.keys()];

  // Ordem natural de leitura do carrossel.
  const DEFAULT_FAMILY_ORDER = ["cover", "benefits", "specifications", "package", "dimensions"];

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

  function getFamily(id) {
    return PAGE_FAMILIES.find((familia) => familia.id === String(id)) || null;
  }

  function isKnownFamily(id) {
    return PAGE_FAMILIES.some((familia) => familia.id === String(id));
  }

  function getLayout(rendererId) {
    return LAYOUT_INDEX.get(String(rendererId)) || null;
  }

  function isKnownLayout(rendererId) {
    return LAYOUT_INDEX.has(String(rendererId));
  }

  // Aceita tanto o id da família ("cover") quanto um rendererId
  // ("cover-split-v1", o formato salvo antes desta fase).
  function resolveFamilyId(valor) {
    const texto = String(valor);
    if (LAYOUT_INDEX.has(texto)) return LAYOUT_INDEX.get(texto).family;
    return getFamily(texto) ? texto : null;
  }

  function defaultVariantOf(familyId) {
    const familia = getFamily(familyId);
    return familia ? familia.variants[0] : null;
  }

  // Página normalizada do projeto: sempre com família, rendererId e nome.
  function makePage(familyId, rendererId) {
    const familia = getFamily(familyId);
    if (!familia) return null;
    const escolhida = rendererId && LAYOUT_INDEX.has(String(rendererId))
      && LAYOUT_INDEX.get(String(rendererId)).family === familia.id
      ? LAYOUT_INDEX.get(String(rendererId)).variant
      : familia.variants[0];
    return {
      id: familia.id,
      family: familia.id,
      rendererId: escolhida.rendererId,
      name: escolhida.name,
    };
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

  // Um projeto novo nasce VAZIO. Texto de exemplo gravado no projeto seria
  // dado comercial falso: o usuário publicaria "Potência: 650 W" num produto
  // que não tem 650 W. As sugestões vivem como `placeholder` nos campos da
  // interface, onde não podem virar arte.
  function createEmptyContent() {
    const saida = {};
    Object.keys(CONTENT_SCHEMA).forEach((key) => { saida[key] = ""; });
    return saida;
  }

  // options: { id, name, segment, style, clienteId, clienteNome, marcaNome,
  //            imageModel, random, pages }
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
      origin: config.origin === "gerado" ? "gerado" : "manual",
      direction: sanitizeText(config.direction, 40),

      clienteId: config.clienteId == null ? null : config.clienteId,
      clienteNome: sanitizeText(config.clienteNome, CLIENT_SCHEMA.clienteNome.maxLength),
      marcaNome: sanitizeText(config.marcaNome, CLIENT_SCHEMA.marcaNome.maxLength),

      segment: SEGMENTS.includes(config.segment) ? config.segment : "Geral",
      style: style.id,
      palette: { ...style.palette },

      logo: emptyImage(imageModel),
      product: { ...defaultProduct(imageModel), name: "", subtitle: "" },
      content: createEmptyContent(),

      // Todas as famílias entram marcadas na versão padrão de cada uma: o
      // construtor manual abre com o conjunto inteiro e a designer remove o
      // que não usar. O gerador monta a própria lista, por dados disponíveis.
      pages: normalizePages(config.pages || FAMILY_IDS),
      selectedPage: 0,
      zoom: 100,
      compareMode: "custom",
    };
  }

  /* ── sanitização de projeto ───────────────────────────────────────────── */

  // Lista de páginas -> lista normalizada de objetos { id, family,
  // rendererId, name }. Nunca lança: é o caminho de leitura de dado salvo.
  //
  // Aceita três formatos, porque projetos gravados antes desta fase existem
  // no navegador do usuário:
  //   • "cover-split-v1"                 (rendererId solto — formato antigo)
  //   • "cover"                          (id de família)
  //   • { family, rendererId }           (formato atual)
  //
  // Uma família só entra uma vez: duas capas no mesmo carrossel não é uma
  // escolha, é dado corrompido.
  function normalizePages(pages) {
    const vistos = new Set();
    const saida = [];

    (Array.isArray(pages) ? pages : []).forEach((entrada) => {
      const bruto = entrada && typeof entrada === "object" ? entrada : { family: entrada, rendererId: entrada };
      const familyId = resolveFamilyId(bruto.family != null ? bruto.family : bruto.id);
      if (!familyId || vistos.has(familyId)) return;
      const pagina = makePage(familyId, bruto.rendererId);
      if (!pagina) return;
      vistos.add(familyId);
      saida.push(pagina);
    });

    REQUIRED_FAMILY_IDS.forEach((familyId) => {
      if (!vistos.has(familyId)) saida.unshift(makePage(familyId));
    });
    return saida;
  }

  function pageIndexOf(pages, familyId) {
    return pages.findIndex((pagina) => pagina.family === String(familyId));
  }

  function familyIdsOf(pages) {
    return normalizePages(pages).map((pagina) => pagina.family);
  }

  function rendererIdsOf(pages) {
    return normalizePages(pages).map((pagina) => pagina.rendererId);
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
      // `origin` distingue o que a Biblioteca precisa rotular; `direction`
      // guarda a direção visual quando o carrossel veio do gerador.
      origin: source.origin === "gerado" ? "gerado" : "manual",
      direction: sanitizeText(source.direction, 40),

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

  // Todas devolvem uma NOVA lista; nenhuma altera a recebida. `pageId` aceita
  // família ou rendererId. Um id fora do catálogo é erro explícito — o
  // construtor não inventa página.
  function requireFamily(pageId) {
    const familyId = resolveFamilyId(pageId);
    if (!familyId) {
      throw builderError("PAGINA_DESCONHECIDA", `Não existe página modular com o id "${pageId}".`);
    }
    return familyId;
  }

  function addPage(pages, pageId, rendererId) {
    const familyId = requireFamily(pageId);
    const atual = normalizePages(pages);
    if (pageIndexOf(atual, familyId) >= 0) return atual;
    // Quando `pageId` já é um rendererId, ele manda na variação escolhida.
    const variacao = rendererId || (isKnownLayout(pageId) ? pageId : null);
    return atual.concat(makePage(familyId, variacao));
  }

  function removePage(pages, pageId) {
    const familyId = requireFamily(pageId);
    if (REQUIRED_FAMILY_IDS.includes(familyId)) {
      throw builderError("PAGINA_OBRIGATORIA", "A capa é obrigatória e não pode ser removida do carrossel.");
    }
    return normalizePages(pages).filter((pagina) => pagina.family !== familyId);
  }

  function togglePage(pages, pageId, incluir, rendererId) {
    return incluir ? addPage(pages, pageId, rendererId) : removePage(pages, pageId);
  }

  // Troca a VARIAÇÃO visual de uma página já incluída, preservando a posição.
  function setPageVariant(pages, pageId, rendererId) {
    const familyId = requireFamily(pageId);
    const layout = getLayout(rendererId);
    if (!layout) {
      throw builderError("LAYOUT_DESCONHECIDO", `Não existe layout com o rendererId "${rendererId}".`);
    }
    if (layout.family !== familyId) {
      throw builderError(
        "LAYOUT_DE_OUTRA_FAMILIA",
        `O layout "${rendererId}" pertence à família "${layout.family}", não a "${familyId}".`
      );
    }
    const atual = normalizePages(pages);
    const indice = pageIndexOf(atual, familyId);
    if (indice === -1) {
      throw builderError("PAGINA_AUSENTE", `A página "${familyId}" não está incluída no carrossel.`);
    }
    const saida = atual.slice();
    saida[indice] = makePage(familyId, rendererId);
    return saida;
  }

  // direction: -1 sobe, +1 desce. Nas pontas não faz nada (não circula: a
  // designer clicaria "subir" na primeira e a página iria para o fim).
  function movePage(pages, pageId, direction) {
    const familyId = requireFamily(pageId);
    const atual = normalizePages(pages);
    const indice = pageIndexOf(atual, familyId);
    if (indice === -1) {
      throw builderError("PAGINA_AUSENTE", `A página "${familyId}" não está incluída no carrossel.`);
    }
    const destino = indice + (Number(direction) < 0 ? -1 : 1);
    if (destino < 0 || destino >= atual.length) return atual;
    const saida = atual.slice();
    saida[indice] = atual[destino];
    saida[destino] = atual[indice];
    return saida;
  }

  function canMovePage(pages, pageId, direction) {
    const familyId = resolveFamilyId(pageId);
    if (!familyId) return false;
    const atual = normalizePages(pages);
    const indice = pageIndexOf(atual, familyId);
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

    // Cada entrada é medida por família E por rendererId: um rendererId fora
    // do catálogo não pode virar página silenciosa nem herdar o layout padrão
    // sem que o usuário saiba.
    const descritas = pages.map((entrada) => {
      const bruto = entrada && typeof entrada === "object" ? entrada : { family: entrada, rendererId: entrada };
      const rotulo = bruto.rendererId != null ? bruto.rendererId : bruto.family;
      return { familyId: resolveFamilyId(bruto.family != null ? bruto.family : bruto.id), rotulo: String(rotulo) };
    });

    const desconhecidas = descritas.filter((item) => !item.familyId).map((item) => item.rotulo);
    if (desconhecidas.length) {
      erros.push({
        campo: "pages",
        codigo: "PAGINA_DESCONHECIDA",
        mensagem: `Página não reconhecida pelo estúdio: ${[...new Set(desconhecidas)].join(", ")}.`,
      });
    }

    const layoutsInvalidos = pages
      .filter((entrada) => entrada && typeof entrada === "object" && entrada.rendererId != null)
      .filter((entrada) => !isKnownLayout(entrada.rendererId))
      .map((entrada) => String(entrada.rendererId));
    if (layoutsInvalidos.length) {
      erros.push({
        campo: "pages",
        codigo: "LAYOUT_DESCONHECIDO",
        mensagem: `Layout não reconhecido pelo estúdio: ${[...new Set(layoutsInvalidos)].join(", ")}.`,
      });
    }

    const familias = descritas.map((item) => item.familyId).filter(Boolean);
    const duplicadas = familias.filter((id, indice, lista) => lista.indexOf(id) !== indice);
    if (duplicadas.length) {
      erros.push({
        campo: "pages",
        codigo: "PAGINA_DUPLICADA",
        mensagem: `A mesma página foi incluída duas vezes: ${[...new Set(duplicadas)].join(", ")}.`,
      });
    }

    REQUIRED_FAMILY_IDS.forEach((familyId) => {
      if (!familias.includes(familyId)) {
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
      // O id da página é a família; o desenho vem do rendererId da variação
      // escolhida. É o par que o renderizador precisa.
      pages: pages.map((pagina) => ({
        id: pagina.family,
        name: pagina.name,
        rendererId: pagina.rendererId,
      })),
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

    return PAGE_FAMILIES.map((familia) => {
      const posicao = pageIndexOf(pages, familia.id);
      const incluida = posicao >= 0;
      const atual = incluida ? pages[posicao] : makePage(familia.id);
      return {
        id: familia.id,
        family: familia.id,
        rendererId: atual.rendererId,
        // O nome mostrado é o da VARIAÇÃO escolhida ("Capa de impacto"), não
        // o da família: é ele que distingue um carrossel do outro.
        name: atual.name,
        familyName: familia.name,
        description: (getLayout(atual.rendererId) || { variant: {} }).variant.description || "",
        dataHint: familia.dataHint,
        required: familia.required,
        variants: familia.variants.map((variante) => ({ ...variante })),
        incluida,
        posicao,
        podeSubir: incluida && canMovePage(pages, familia.id, -1),
        podeDescer: incluida && canMovePage(pages, familia.id, 1),
        semDados: familia.fields.every((campo) => !String(valorDe(campo)).trim()),
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

    PAGE_FAMILIES,
    FAMILY_IDS,
    REQUIRED_FAMILY_IDS,
    LAYOUT_IDS,
    DEFAULT_FAMILY_ORDER,
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
    getFamily,
    isKnownFamily,
    getLayout,
    isKnownLayout,
    resolveFamilyId,
    defaultVariantOf,
    makePage,
    getStyle,

    createDefaultProject,
    createEmptyContent,
    sanitizeProject,
    normalizePages,
    normalizePalette,
    normalizeContent,
    familyIdsOf,
    rendererIdsOf,

    addPage,
    removePage,
    togglePage,
    setPageVariant,
    movePage,
    canMovePage,
    applyStyle,

    validateProject,
    buildTemplateDefinition,
    toRenderProject,
    describePages,
  };
});
