// Portal/design-template-proposal-generator.js
// -----------------------------------------------------------------------------
// Gerador CONTROLADO de propostas de carrossel.
//
// Recebe os dados de um produto e devolve TRÊS propostas completas e
// visualmente diferentes. Não há LLM, agente, rede nem aleatoriedade: a
// escolha é feita por regras explícitas sobre os dados disponíveis e por uma
// tabela de preferências de layout por direção visual. A mesma entrada
// devolve sempre a mesma saída — é isso que torna o gerador testável.
//
// O que este módulo NÃO faz, de propósito: tocar DOM, fetch, localStorage,
// IndexedDB, eval, new Function, ou INVENTAR conteúdo. Campo vazio na entrada
// continua vazio na proposta; a página que dependeria dele simplesmente não é
// criada, e o motivo vira um aviso legível.
//
// Depende só do núcleo puro do construtor (design-template-builder-model.js),
// de onde vêm o catálogo de famílias/variações e a sanitização.
// -----------------------------------------------------------------------------

(function (root, factory) {
  const model = (typeof module === "object" && module.exports)
    ? require("./design-template-builder-model")
    : root.VF_DESIGN_TEMPLATE_BUILDER_MODEL;
  const api = factory(model);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DESIGN_TEMPLATE_PROPOSAL_GENERATOR = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (model) {
  "use strict";

  const PROPOSAL_COUNT = 3;

  // Mínimos que justificam criar cada página. Duas linhas para a ficha
  // técnica porque uma linha só não é uma "grade de especificações" — é uma
  // frase solta ocupando uma arte inteira.
  const MIN_BENEFITS = 1;
  const MIN_SPEC_LINES = 2;
  const MIN_PACKAGE_ITEMS = 1;
  const MIN_MEASURES = 1;

  /* ── cor ──────────────────────────────────────────────────────────────── */

  function hexToRgb(hex) {
    const limpo = String(hex || "").replace("#", "");
    const valor = Number.parseInt(limpo.length === 3 ? limpo.split("").map((p) => p + p).join("") : limpo, 16);
    if (!Number.isFinite(valor)) return { r: 0, g: 0, b: 0 };
    return { r: (valor >> 16) & 255, g: (valor >> 8) & 255, b: valor & 255 };
  }

  function rgbToHex(rgb) {
    const parte = (v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, "0");
    return `#${parte(rgb.r)}${parte(rgb.g)}${parte(rgb.b)}`;
  }

  // amount < 0 escurece (mistura com preto), amount > 0 clareia (com branco).
  function shade(hex, amount) {
    const origem = hexToRgb(hex);
    const alvo = amount < 0 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
    const peso = Math.abs(amount);
    return rgbToHex({
      r: origem.r + (alvo.r - origem.r) * peso,
      g: origem.g + (alvo.g - origem.g) * peso,
      b: origem.b + (alvo.b - origem.b) * peso,
    });
  }

  /* ── direções visuais ─────────────────────────────────────────────────── */

  // Cada direção declara o layout PREFERIDO de cada família. É esta tabela
  // que faz as três propostas serem composições diferentes, não só paletas
  // diferentes: nenhum rendererId se repete entre as direções.
  const DIRECTIONS = [
    {
      id: "industrial-limpo",
      name: "Industrial limpo",
      description: "Visual organizado e técnico, com fundo claro, produto grande e pouca decoração.",
      styleId: "industrial-claro",
      tone: { primaryShift: 0, secondaryShift: 0, background: "#f2f0ec", text: "#1b2731" },
      layouts: {
        cover: "cover-split-v1",
        benefits: "benefits-three-cards-v1",
        specifications: "specifications-grid-v1",
        package: "package-list-v1",
        dimensions: "dimensions-technical-v1",
      },
    },
    {
      id: "tecnico-moderno",
      name: "Técnico moderno",
      description: "Contraste alto e painéis escuros, com leitura de ficha de produto.",
      styleId: "tecnico-escuro",
      tone: { primaryShift: -0.30, secondaryShift: 0.12, background: "#e9edf0", text: "#101a22" },
      layouts: {
        cover: "cover-centered-v1",
        benefits: "benefits-side-list-v1",
        specifications: "specifications-table-v1",
        package: "package-grid-v1",
        dimensions: "dimensions-panel-v1",
      },
    },
    {
      id: "comercial-impacto",
      name: "Comercial de impacto",
      description: "Título grande, produto em forte destaque e benefícios fáceis de ler.",
      styleId: "comercial",
      tone: { primaryShift: -0.08, secondaryShift: -0.10, background: "#faf6f0", text: "#1a1520" },
      layouts: {
        cover: "cover-impact-v1",
        benefits: "benefits-orbit-v1",
        specifications: "specifications-cards-v1",
        package: "package-focus-v1",
        dimensions: "dimensions-clean-v1",
      },
    },
  ];

  const DIRECTION_IDS = DIRECTIONS.map((direcao) => direcao.id);

  // Cor base por segmento. A direção só ajusta a intensidade — assim
  // "Ferramentas" e "Cosméticos" nunca saem com a mesma paleta.
  const SEGMENT_ACCENTS = {
    Ferramentas: { primary: "#2f4858", secondary: "#f08a24" },
    Moda: { primary: "#3c2f4a", secondary: "#c2668b" },
    "Móveis": { primary: "#4a3b2c", secondary: "#b98a4b" },
    "Cosméticos": { primary: "#5a3550", secondary: "#e08aa8" },
    "Eletrônicos": { primary: "#16283f", secondary: "#3f8ef7" },
    Geral: { primary: "#2b3a4a", secondary: "#e07a3f" },
  };

  // Ordem de leitura por segmento. Só reordena famílias que JÁ têm layout —
  // nenhuma página nova é inventada aqui.
  const SEGMENT_ORDER = {
    Moda: ["cover", "benefits", "dimensions", "specifications", "package"],
    "Móveis": ["cover", "benefits", "dimensions", "specifications", "package"],
    "Cosméticos": ["cover", "benefits", "package", "specifications", "dimensions"],
  };

  function getDirection(id) {
    return DIRECTIONS.find((direcao) => direcao.id === String(id)) || null;
  }

  function generatorError(codigo, mensagem) {
    const error = new Error(mensagem);
    error.codigo = codigo;
    return error;
  }

  function paletteFor(directionId, segment) {
    const direcao = getDirection(directionId);
    if (!direcao) throw generatorError("DIRECAO_DESCONHECIDA", `Não existe direção visual "${directionId}".`);
    const base = SEGMENT_ACCENTS[segment] || SEGMENT_ACCENTS.Geral;
    return {
      primary: shade(base.primary, direcao.tone.primaryShift),
      secondary: shade(base.secondary, direcao.tone.secondaryShift),
      background: direcao.tone.background,
      text: direcao.tone.text,
    };
  }

  /* ── entrada ──────────────────────────────────────────────────────────── */

  // Entrada crua da tela -> entrada normalizada. Nada é preenchido com
  // exemplo: o que veio vazio continua vazio.
  function normalizeGeneratorInput(input) {
    const source = input && typeof input === "object" ? input : {};
    const produto = source.product && typeof source.product === "object" ? source.product : {};

    return {
      name: model.sanitizeText(source.name, model.PROJECT_NAME_MAX),
      clienteId: source.clienteId == null ? null : source.clienteId,
      clienteNome: model.sanitizeText(source.clienteNome, model.CLIENT_SCHEMA.clienteNome.maxLength),
      marcaNome: model.sanitizeText(source.marcaNome, model.CLIENT_SCHEMA.marcaNome.maxLength),
      segment: model.SEGMENTS.includes(source.segment) ? source.segment : "Geral",
      product: {
        name: model.sanitizeText(produto.name, model.PRODUCT_SCHEMA.name.maxLength),
        subtitle: model.sanitizeText(produto.subtitle, model.PRODUCT_SCHEMA.subtitle.maxLength),
      },
      content: model.normalizeContent(source.content),
      // Referências de imagem passam INTACTAS: o gerador não mexe em blob.
      logo: source.logo || null,
      productImages: source.productImages || null,
    };
  }

  /* ── leitura dos dados disponíveis ────────────────────────────────────── */

  function linhas(valor) {
    return String(valor || "").split(/\r?\n/).map((linha) => linha.trim()).filter(Boolean);
  }

  // O que o usuário realmente informou. É esta leitura — e só ela — que decide
  // quais páginas existem.
  function detectAvailableContent(input) {
    const entrada = normalizeGeneratorInput(input);
    const conteudo = entrada.content;

    const beneficios = [conteudo.benefit1, conteudo.benefit2, conteudo.benefit3]
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    const especificacoes = linhas(conteudo.specs);
    const itensDaEmbalagem = linhas(conteudo.packageItems);
    const medidas = [
      { key: "width", label: "Largura", value: String(conteudo.width || "").trim() },
      { key: "height", label: "Altura", value: String(conteudo.height || "").trim() },
      { key: "depth", label: "Profundidade", value: String(conteudo.depth || "").trim() },
    ].filter((medida) => medida.value.length > 0);

    return {
      temNomeDoProduto: entrada.product.name.trim().length > 0,
      temBeneficioPrincipal: String(conteudo.mainBenefit || "").trim().length > 0,
      beneficios,
      especificacoes,
      itensDaEmbalagem,
      medidas,
      temBeneficios: beneficios.length >= MIN_BENEFITS,
      temEspecificacoes: especificacoes.length >= MIN_SPEC_LINES,
      temEmbalagem: itensDaEmbalagem.length >= MIN_PACKAGE_ITEMS,
      temDimensoes: medidas.length >= MIN_MEASURES,
    };
  }

  /* ── escolha das páginas ──────────────────────────────────────────────── */

  // Regras fixas, uma por família. A família que não passa no critério NÃO
  // entra — e o motivo sai como aviso, para o usuário saber o que preencher.
  const PAGE_RULES = [
    {
      family: "cover",
      sempre: true,
    },
    {
      family: "benefits",
      permite: (dados) => dados.temBeneficios,
      codigo: "SEM_BENEFICIOS",
      mensagem: "Página de benefícios não criada porque nenhum benefício foi informado.",
    },
    {
      family: "specifications",
      permite: (dados) => dados.temEspecificacoes,
      codigo: "SEM_ESPECIFICACOES",
      mensagem: "Página de especificações não criada porque menos de duas linhas foram informadas.",
    },
    {
      family: "package",
      permite: (dados) => dados.temEmbalagem,
      codigo: "SEM_EMBALAGEM",
      mensagem: "Página de embalagem não criada porque nenhum item foi informado.",
    },
    {
      family: "dimensions",
      permite: (dados) => dados.temDimensoes,
      codigo: "SEM_DIMENSOES",
      mensagem: "Página de dimensões não criada porque nenhuma medida foi informada.",
    },
  ];

  function ordemDoSegmento(segment) {
    return SEGMENT_ORDER[segment] || model.DEFAULT_FAMILY_ORDER;
  }

  // Devolve { familias, avisos }. `familias` já vem na ordem de leitura do
  // segmento; `avisos` explica cada ausência em português.
  function selectPages(input) {
    const entrada = normalizeGeneratorInput(input);
    const dados = detectAvailableContent(entrada);
    const avisos = [];
    const escolhidas = new Set();

    PAGE_RULES.forEach((regra) => {
      if (regra.sempre || regra.permite(dados)) {
        escolhidas.add(regra.family);
        return;
      }
      avisos.push({ codigo: regra.codigo, familia: regra.family, mensagem: regra.mensagem });
    });

    const familias = ordemDoSegmento(entrada.segment).filter((familia) => escolhidas.has(familia));
    return { familias, avisos };
  }

  /* ── escolha do layout ────────────────────────────────────────────────── */

  // `variationIndex` roda as variações dentro de cada família a partir da
  // preferida da direção. Como as três direções partem de variações
  // diferentes, elas continuam distintas em qualquer índice. Rotação
  // determinística: o mesmo índice devolve sempre a mesma combinação.
  function layoutFor(directionId, familyId, variationIndex) {
    const direcao = getDirection(directionId);
    if (!direcao) throw generatorError("DIRECAO_DESCONHECIDA", `Não existe direção visual "${directionId}".`);
    const familia = model.getFamily(familyId);
    if (!familia) throw generatorError("FAMILIA_DESCONHECIDA", `Não existe família de página "${familyId}".`);

    const preferido = direcao.layouts[familyId];
    const base = familia.variants.findIndex((variante) => variante.rendererId === preferido);
    const inicio = base >= 0 ? base : 0;
    const passo = Number.isFinite(Number(variationIndex)) ? Math.abs(Math.trunc(Number(variationIndex))) : 0;
    return familia.variants[(inicio + passo) % familia.variants.length].rendererId;
  }

  /* ── proposta ─────────────────────────────────────────────────────────── */

  // options: { variationIndex, imageModel, id, random }
  function buildProposal(input, directionId, options) {
    const config = options || {};
    const direcao = getDirection(directionId);
    if (!direcao) throw generatorError("DIRECAO_DESCONHECIDA", `Não existe direção visual "${directionId}".`);

    const entrada = normalizeGeneratorInput(input);
    const { familias, avisos } = selectPages(entrada);
    const variationIndex = Number.isFinite(Number(config.variationIndex))
      ? Math.abs(Math.trunc(Number(config.variationIndex))) : 0;

    const pages = familias.map((familia) =>
      model.makePage(familia, layoutFor(direcao.id, familia, variationIndex)));

    const palette = paletteFor(direcao.id, entrada.segment);

    // O projeto sai pronto para o Construtor: mesma forma do projeto manual.
    // Todo o conteúdo vem da ENTRADA — nada é preenchido com exemplo.
    const projeto = model.createDefaultProject({
      imageModel: config.imageModel || null,
      id: config.id,
      random: config.random,
      name: entrada.name,
      segment: entrada.segment,
      style: direcao.styleId,
      clienteId: entrada.clienteId,
      clienteNome: entrada.clienteNome,
      marcaNome: entrada.marcaNome,
      origin: "gerado",
      direction: direcao.id,
      pages,
    });

    projeto.palette = { ...palette };
    projeto.product = {
      ...projeto.product,
      ...(entrada.productImages || {}),
      name: entrada.product.name,
      subtitle: entrada.product.subtitle,
    };
    if (entrada.logo) projeto.logo = entrada.logo;
    projeto.content = { ...entrada.content };

    const nomeBase = entrada.name.trim() || entrada.product.name.trim() || "Carrossel";

    return {
      id: `${projeto.id}-${direcao.id}`,
      name: `${nomeBase} · ${direcao.name}`,
      direction: direcao.id,
      directionName: direcao.name,
      description: direcao.description,
      segment: entrada.segment,
      variationIndex,
      palette: { ...palette },
      pages: pages.map((pagina) => ({ id: pagina.id, rendererId: pagina.rendererId, name: pagina.name })),
      avisos: avisos.slice(),
      project: projeto,
    };
  }

  // Sempre TRÊS propostas, uma por direção, na mesma ordem.
  function generateProposals(input, options) {
    const config = options || {};
    return DIRECTIONS.map((direcao, indice) => buildProposal(input, direcao.id, {
      ...config,
      // Ids distintos entre as propostas de uma mesma rodada, sem sorteio.
      id: config.id ? `${config.id}-${indice + 1}` : undefined,
    }));
  }

  /* ── validação ────────────────────────────────────────────────────────── */

  // Nunca lança. Confere a estrutura da proposta e delega o resto ao modelo.
  function validateProposal(proposal) {
    const erros = [];
    const source = proposal && typeof proposal === "object" ? proposal : {};

    if (!getDirection(source.direction)) {
      erros.push({ campo: "direction", codigo: "DIRECAO_DESCONHECIDA", mensagem: "A proposta não declara uma direção visual conhecida." });
    }
    const pages = Array.isArray(source.pages) ? source.pages : [];
    if (!pages.length) {
      erros.push({ campo: "pages", codigo: "SEM_PAGINAS", mensagem: "A proposta não tem nenhuma página." });
    }
    const invalidas = pages.filter((pagina) => !pagina || !model.isKnownLayout(pagina.rendererId));
    if (invalidas.length) {
      erros.push({ campo: "pages", codigo: "LAYOUT_DESCONHECIDO", mensagem: "A proposta usa um layout que o estúdio não conhece." });
    }
    if (!pages.some((pagina) => pagina && model.resolveFamilyId(pagina.rendererId) === "cover")) {
      erros.push({ campo: "pages", codigo: "CAPA_AUSENTE", mensagem: "A proposta precisa de uma capa." });
    }

    const doProjeto = model.validateProject(source.project);
    return { ok: erros.length === 0 && doProjeto.ok, erros: erros.concat(doProjeto.erros) };
  }

  return {
    PROPOSAL_COUNT,
    MIN_BENEFITS,
    MIN_SPEC_LINES,
    MIN_PACKAGE_ITEMS,
    MIN_MEASURES,

    DIRECTIONS,
    DIRECTION_IDS,
    SEGMENT_ACCENTS,
    SEGMENT_ORDER,
    PAGE_RULES,

    getDirection,
    paletteFor,
    layoutFor,
    shade,

    normalizeGeneratorInput,
    detectAvailableContent,
    selectPages,
    buildProposal,
    generateProposals,
    validateProposal,
  };
});
