// server/tests/designTemplateProposals.test.js
// -----------------------------------------------------------------------------
// Gerador de propostas de carrossel (design-template-proposal-generator.js),
// exercitado sem navegador:
//
//   • generateProposals devolve TRÊS propostas, com direções e layouts
//     diferentes — não é a mesma composição com outra paleta;
//   • a escolha das páginas segue os dados informados, e a ausência vira
//     aviso legível em vez de página vazia;
//   • nada é inventado: campo vazio na entrada continua vazio na proposta;
//   • os quinze layouts modulares estão registrados, renderizam SVG e saem
//     em 1200 × 1200 em todos os cenários-limite;
//   • projetos salvos com os cinco ids antigos continuam abrindo.
//
// A refatoração da Biblioteca de Templates removeu o gerador de propostas
// (aba Construtor > "Gerar propostas") da interface principal — a atividade
// pedia explicitamente a remoção do botão "Gerar opções", do seletor de
// quantidade de propostas e do modo de geração automática. Os testes de
// interface e a simulação de "tela real" que existiam aqui foram retirados
// por descreverem uma tela que não existe mais; o núcleo puro do gerador
// (abaixo) continua coberto porque o arquivo segue no repositório por
// compatibilidade.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
function eq(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const portalDir = path.join(__dirname, "..", "..", "Portal");
const snap = require("./helpers/svgSnapshot");

const engine = require(path.join(portalDir, "design-template-engine"));
const presets = require(path.join(portalDir, "design-template-presets"));
const imageModel = require(path.join(portalDir, "design-image-model"));
const componentsLib = require(path.join(portalDir, "design-template-components"));
const layoutsLib = require(path.join(portalDir, "design-template-layouts"));
const rendererLib = require(path.join(portalDir, "design-template-renderer"));
const model = require(path.join(portalDir, "design-template-builder-model"));
const storageLib = require(path.join(portalDir, "design-template-builder-storage"));
const generator = require(path.join(portalDir, "design-template-proposal-generator"));

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const ENTRADA_COMPLETA = {
  name: "Lavadora 2000",
  segment: "Ferramentas",
  marcaNome: "AQUAFORCE",
  product: { name: "Lavadora de Alta Pressão", subtitle: "Limpeza profunda para calçada e carro." },
  content: {
    mainBenefit: "2000 PSI de pressão para a sujeira mais difícil.",
    benefit1: "Motor de indução silencioso",
    benefit2: "Mangueira de 8 metros",
    benefit3: "Bico regulável de 0° a 40°",
    specs: "Potência: 1800 W\nPressão: 2000 PSI\nVazão: 420 L/h\nTensão: 220 V",
    packageItems: "1 lavadora\n1 pistola\n1 mangueira de 8 m",
    width: "32 cm", height: "78 cm", depth: "29 cm",
    warranty: "12 meses contra defeitos", shipping: "Envio com rastreio",
  },
};

function criarRenderer() {
  return rendererLib.createTemplateRenderer({
    documentLike: snap.criarDocumentoFake(),
    componentsLib,
    layoutsLib,
    resolveProductImageSource: (p) => imageModel.resolveProductImageSource(p.product),
  });
}

function contarNos(no) {
  return 1 + (no.children || []).reduce((total, filho) => total + contarNos(filho), 0);
}

function textosDe(no, acc) {
  const saida = acc || [];
  if (!no) return saida;
  if (no.textContent) saida.push(no.textContent);
  (no.children || []).forEach((filho) => textosDe(filho, saida));
  return saida;
}

function criarLocalStorage() {
  const dados = new Map();
  return {
    _dados: dados,
    get length() { return dados.size; },
    key: (i) => [...dados.keys()][i] ?? null,
    getItem: (k) => (dados.has(k) ? dados.get(k) : null),
    setItem: (k, v) => { dados.set(k, String(v)); },
    removeItem: (k) => { dados.delete(k); },
  };
}

(async () => {
  console.log("\n=== Gerador de propostas de carrossel ===\n");

  const renderer = criarRenderer();

  /* ── 0. Pureza do módulo ───────────────────────────────────────────────── */

  ok("0. o gerador importa no Node sem window/document definidos",
    typeof window === "undefined" && typeof document === "undefined"
    && typeof generator.generateProposals === "function");
  ok("0b. o gerador expõe a API mínima pedida",
    ["normalizeGeneratorInput", "detectAvailableContent", "selectPages",
      "buildProposal", "generateProposals", "validateProposal"]
      .every((nome) => typeof generator[nome] === "function"));

  const fonteDoGerador = fs.readFileSync(path.join(portalDir, "design-template-proposal-generator.js"), "utf8");
  // Os comentários do módulo citam justamente o que ele NÃO usa; a
  // verificação precisa olhar o código, não a prosa.
  const codigoDoGerador = fonteDoGerador
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((linha) => !/^\s*\/\//.test(linha)).join("\n");
  ok("0c. o gerador não usa eval nem new Function",
    !/\beval\s*\(/.test(codigoDoGerador) && !/new\s+Function\s*\(/.test(codigoDoGerador));
  ok("0d. o gerador não toca DOM, fetch, localStorage nem IndexedDB",
    !/\bdocument\b|\bfetch\s*\(|localStorage|indexedDB|innerHTML/.test(codigoDoGerador));

  /* ── 1/2/3/4. Três propostas realmente diferentes ──────────────────────── */

  const propostas = generator.generateProposals(ENTRADA_COMPLETA, { imageModel });

  eq("1. generateProposals devolve exatamente três propostas", propostas.length, 3);
  eq("1b. a contagem declarada bate com a entrega", propostas.length, generator.PROPOSAL_COUNT);

  eq("2. as três propostas têm direções diferentes",
    propostas.map((p) => p.direction),
    ["industrial-limpo", "tecnico-moderno", "comercial-impacto"]);
  ok("2b. cada proposta traz nome, descrição e direção legíveis",
    propostas.every((p) => p.directionName && p.description && p.name));
  eq("2c. as direções implementadas são as três pedidas",
    generator.DIRECTIONS.map((d) => d.name),
    ["Industrial limpo", "Técnico moderno", "Comercial de impacto"]);

  const rendererIdsPorProposta = propostas.map((p) => p.pages.map((pg) => pg.rendererId));
  ok("3. nenhuma página usa o mesmo rendererId em duas propostas", (() => {
    const todos = rendererIdsPorProposta.flat();
    return new Set(todos).size === todos.length;
  })());
  ok("3b. em cada família as três propostas usam variações distintas",
    model.FAMILY_IDS.every((familia) => {
      const usados = propostas.map((p) => {
        const pagina = p.pages.find((pg) => model.resolveFamilyId(pg.rendererId) === familia);
        return pagina ? pagina.rendererId : null;
      }).filter(Boolean);
      return new Set(usados).size === usados.length;
    }));

  ok("4. as propostas não são só troca de paleta: as composições diferem",
    new Set(rendererIdsPorProposta.map((ids) => ids.join("|"))).size === 3);
  ok("4b. as paletas também diferem entre as três",
    new Set(propostas.map((p) => JSON.stringify(p.palette))).size === 3);
  ok("4c. cada direção tem paleta própria adaptada ao segmento", (() => {
    const ferramentas = generator.paletteFor("industrial-limpo", "Ferramentas");
    const cosmeticos = generator.paletteFor("industrial-limpo", "Cosméticos");
    return ferramentas.primary !== cosmeticos.primary && ferramentas.secondary !== cosmeticos.secondary;
  })());
  ok("4d. os SVGs gerados são de fato diferentes entre as propostas", (() => {
    const assinaturas = propostas.map((proposta) => {
      const template = engine.normalizeTemplateDefinition(model.buildTemplateDefinition(proposta.project));
      const svg = renderer.renderPage({ template, project: model.toRenderProject(proposta.project), pageIndex: 0 });
      return snap.hashDoSvg(svg);
    });
    return new Set(assinaturas).size === 3;
  })());

  /* ── 5/6/7/8. Escolha das páginas ──────────────────────────────────────── */

  eq("5. a capa está presente em todas as propostas",
    propostas.filter((p) => p.pages.some((pg) => model.resolveFamilyId(pg.rendererId) === "cover")).length, 3);
  eq("5b. com todos os dados, as cinco páginas são criadas", propostas[0].pages.length, 5);
  eq("5c. a ordem padrão é capa, benefícios, especificações, embalagem, dimensões",
    propostas[0].pages.map((pg) => model.resolveFamilyId(pg.rendererId)),
    ["cover", "benefits", "specifications", "package", "dimensions"]);

  const soCapa = generator.generateProposals({ name: "X", product: { name: "Produto" } }, { imageModel });
  eq("6. sem dados nenhum, só a capa é criada", soCapa[0].pages.length, 1);
  eq("6b. nenhuma página vazia entra só para completar quantidade",
    soCapa[0].pages.map((pg) => model.resolveFamilyId(pg.rendererId)), ["cover"]);
  eq("6c. cada ausência vira um aviso legível",
    soCapa[0].avisos.map((a) => a.codigo),
    ["SEM_BENEFICIOS", "SEM_ESPECIFICACOES", "SEM_EMBALAGEM", "SEM_DIMENSOES"]);
  ok("6d. o aviso de dimensões usa a mensagem pedida",
    soCapa[0].avisos.some((a) => a.mensagem === "Página de dimensões não criada porque nenhuma medida foi informada."));
  ok("6e. o aviso de embalagem usa a mensagem pedida",
    soCapa[0].avisos.some((a) => a.mensagem === "Página de embalagem não criada porque nenhum item foi informado."));

  const umBeneficio = generator.selectPages({ product: { name: "P" }, content: { benefit2: "Só um benefício" } });
  ok("6f. um único benefício já cria a página de benefícios", umBeneficio.familias.includes("benefits"));

  const umaLinha = generator.selectPages({ product: { name: "P" }, content: { specs: "Potência: 650 W" } });
  ok("7. uma única linha NÃO cria a página de especificações", !umaLinha.familias.includes("specifications"));
  ok("7b. o motivo é explicado ao usuário",
    umaLinha.avisos.some((a) => a.codigo === "SEM_ESPECIFICACOES" && /duas linhas/.test(a.mensagem)));
  const duasLinhas = generator.selectPages({ product: { name: "P" }, content: { specs: "A: 1\nB: 2" } });
  ok("7c. duas linhas criam a página de especificações", duasLinhas.familias.includes("specifications"));
  eq("7d. o mínimo declarado é 2", generator.MIN_SPEC_LINES, 2);

  const umaMedida = generator.selectPages({ product: { name: "P" }, content: { height: "78 cm" } });
  ok("8. uma medida válida já cria a página de dimensões", umaMedida.familias.includes("dimensions"));
  ok("8b. medida em branco não conta",
    !generator.selectPages({ product: { name: "P" }, content: { height: "   " } }).familias.includes("dimensions"));
  ok("8c. a peça de dimensões mostra só a medida informada", (() => {
    const proposta = generator.buildProposal(
      { name: "N", product: { name: "P" }, content: { height: "78 cm" } }, "industrial-limpo", { imageModel });
    const template = engine.normalizeTemplateDefinition(model.buildTemplateDefinition(proposta.project));
    const indice = template.pages.findIndex((pg) => pg.rendererId.startsWith("dimensions"));
    const textos = textosDe(renderer.renderPage({
      template, project: model.toRenderProject(proposta.project), pageIndex: indice,
    }));
    return textos.includes("ALTURA") && !textos.includes("LARGURA") && !textos.includes("PROFUNDIDADE");
  })());

  ok("8d. regra por segmento reordena sem inventar página", (() => {
    const moda = generator.selectPages({ ...ENTRADA_COMPLETA, segment: "Moda" });
    return moda.familias.join(",") === "cover,benefits,dimensions,specifications,package"
      && moda.familias.every((f) => model.FAMILY_IDS.includes(f));
  })());

  /* ── 9. Nada é inventado ───────────────────────────────────────────────── */

  const minimo = generator.buildProposal(
    { name: "Projeto", product: { name: "Produto" } }, "industrial-limpo", { imageModel });
  ok("9. campo não informado continua vazio na proposta",
    Object.entries(minimo.project.content).every(([, valor]) => valor === ""));
  ok("9b. o subtítulo não informado continua vazio", minimo.project.product.subtitle === "");
  ok("9c. o conteúdo da proposta vem só da entrada", (() => {
    const proposta = generator.buildProposal(ENTRADA_COMPLETA, "tecnico-moderno", { imageModel });
    return proposta.project.content.specs === ENTRADA_COMPLETA.content.specs
      && proposta.project.product.name === ENTRADA_COMPLETA.product.name
      && proposta.project.marcaNome === "AQUAFORCE";
  })());
  ok("9d. texto que não é texto some em vez de virar string", (() => {
    const proposta = generator.buildProposal(
      { name: "N", product: { name: "P", subtitle: { hack: 1 } }, content: { mainBenefit: null, specs: [1, 2] } },
      "industrial-limpo", { imageModel });
    return proposta.project.product.subtitle === "" && proposta.project.content.mainBenefit === ""
      && proposta.project.content.specs === "";
  })());
  ok("9e. a geração é determinística: mesma entrada, mesma saída", (() => {
    const a = generator.generateProposals(ENTRADA_COMPLETA, { imageModel, id: "fixo" });
    const b = generator.generateProposals(ENTRADA_COMPLETA, { imageModel, id: "fixo" });
    const limpar = (props) => props.map((p) => ({ ...p, project: { ...p.project, createdAt: "", updatedAt: "" } }));
    return JSON.stringify(limpar(a)) === JSON.stringify(limpar(b));
  })());
  ok("9f. validateProposal aprova uma proposta completa",
    generator.validateProposal(propostas[0]).ok === true);
  ok("9g. validateProposal reprova uma proposta adulterada", (() => {
    const quebrada = { ...propostas[0], pages: [{ id: "x", rendererId: "nao-existe", name: "X" }] };
    const resultado = generator.validateProposal(quebrada);
    return !resultado.ok && resultado.erros.some((e) => e.codigo === "LAYOUT_DESCONHECIDO");
  })());

  /* ── "Gerar outras opções" ─────────────────────────────────────────────── */

  const rodada1 = generator.generateProposals(ENTRADA_COMPLETA, { imageModel, variationIndex: 0 });
  const rodada2 = generator.generateProposals(ENTRADA_COMPLETA, { imageModel, variationIndex: 1 });
  const rodada3 = generator.generateProposals(ENTRADA_COMPLETA, { imageModel, variationIndex: 2 });
  ok("V. o variationIndex troca as combinações de layout",
    rodada1[0].pages.map((p) => p.rendererId).join() !== rodada2[0].pages.map((p) => p.rendererId).join());
  ok("V2. as três propostas continuam distintas em qualquer variação",
    [rodada1, rodada2, rodada3].every((rodada) => {
      const todos = rodada.flatMap((p) => p.pages.map((pg) => pg.rendererId));
      return new Set(todos).size === todos.length;
    }));
  ok("V3. a rotação é previsível e volta ao início na terceira volta",
    rodada1[0].pages.map((p) => p.rendererId).join()
    === generator.generateProposals(ENTRADA_COMPLETA, { imageModel, variationIndex: 3 })[0]
      .pages.map((p) => p.rendererId).join());

  /* ── 10/11/12. Os quinze layouts ───────────────────────────────────────── */

  const registrados = renderer.listAvailableLayouts().map((d) => d.id);
  eq("10. o catálogo do construtor declara quinze layouts", model.LAYOUT_IDS.length, 15);
  eq("10b. os quinze estão registrados no renderizador",
    model.LAYOUT_IDS.filter((id) => !registrados.includes(id)), []);
  eq("10c. são cinco famílias com três variações cada",
    model.PAGE_FAMILIES.map((f) => f.variants.length), [3, 3, 3, 3, 3]);
  ok("10d. cada rendererId pertence a exatamente uma família",
    model.LAYOUT_IDS.every((id) => model.getLayout(id) && model.getLayout(id).family));

  const CENARIOS = {
    completo: ENTRADA_COMPLETA.content,
    vazio: {},
    "uma-spec": { specs: "Potência: 650 W" },
    "seis-specs": { specs: [1, 2, 3, 4, 5, 6].map((i) => `Campo ${i}: valor ${i}`).join("\n") },
    "uma-dimensao": { height: "78 cm" },
    longo: {
      mainBenefit: "Benefício absurdamente longo ".repeat(4),
      benefit1: "Texto muito comprido para um card estreito ".repeat(2),
      benefit2: "Outro texto longo demais para caber numa linha só ".repeat(2),
      benefit3: "Terceiro benefício com nome comprido ".repeat(2),
      specs: [1, 2, 3, 4, 5, 6].map((i) => `Especificação bem longa ${i}: valor comprido demais ${i}`).join("\n"),
      packageItems: [1, 2, 3, 4, 5, 6].map((i) => `Item de embalagem com nome muito comprido ${i}`).join("\n"),
      width: "32,5 centímetros", height: "78,25 centímetros", depth: "29,75 centímetros",
    },
  };

  let renderizacoes = 0;
  const problemas = [];
  model.LAYOUT_IDS.forEach((rendererId) => {
    Object.entries(CENARIOS).forEach(([nomeCenario, conteudo]) => {
      [null, [1600, 900], [900, 1600]].forEach((medidasDaImagem) => {
        const projeto = model.sanitizeProject({
          id: "auditoria", name: "Auditoria", segment: "Ferramentas",
          marcaNome: "MARCA COM NOME LONGO",
          palette: { primary: "#2f4858", secondary: "#f08a24", background: "#f2f0ec", text: "#1b2731" },
          pages: [{ family: model.resolveFamilyId(rendererId), rendererId }],
          product: { name: nomeCenario === "longo" ? "Nome de produto extremamente longo para a capa 2026" : "Produto" },
          content: conteudo,
        }, { imageModel });
        if (medidasDaImagem) {
          projeto.product.originalImage = imageModel.normalizeImageRef({
            id: "img-1", dataUrl: PNG, fileName: "p.png", mimeType: "image/png",
            width: medidasDaImagem[0], height: medidasDaImagem[1],
          });
        }
        const template = engine.normalizeTemplateDefinition(model.buildTemplateDefinition(projeto));
        const indice = template.pages.findIndex((pg) => pg.rendererId === rendererId);
        ["preview", "export"].forEach((modo) => {
          renderizacoes += 1;
          let svg;
          try {
            svg = renderer.renderPage({
              template, project: model.toRenderProject(projeto), pageIndex: indice, mode: modo,
            });
          } catch (erro) {
            problemas.push(`${rendererId}/${nomeCenario}/${modo}: lançou ${erro.message}`);
            return;
          }
          if (svg.getAttribute("viewBox") !== "0 0 1200 1200"
            || svg.getAttribute("width") !== "1200" || svg.getAttribute("height") !== "1200") {
            problemas.push(`${rendererId}/${nomeCenario}: não saiu em 1200 × 1200`);
          }
          if (contarNos(svg) <= 6) problemas.push(`${rendererId}/${nomeCenario}: peça sem conteúdo`);
          const serializado = snap.serializarSvg(svg);
          const proibido = serializado.match(/undefined|\[object Object\]|NaN|>null</);
          if (proibido) problemas.push(`${rendererId}/${nomeCenario}/${modo}: emitiu "${proibido[0]}"`);
          // Nada de conteúdo fora do canvas (com folga para o sangramento
          // proposital das formas de fundo).
          (function percorrer(no) {
            ["x", "y", "cx", "cy", "x1", "y1", "x2", "y2"].forEach((atributo) => {
              const valor = Number(no.getAttribute && no.getAttribute(atributo));
              if (Number.isFinite(valor) && (valor < -320 || valor > 1520)) {
                problemas.push(`${rendererId}/${nomeCenario}: ${no.tagName}.${atributo}=${valor} fora do canvas`);
              }
            });
            (no.children || []).forEach(percorrer);
          })(svg);
        });
      });
    });
  });

  eq("11. os quinze layouts renderizam em todos os cenários-limite", problemas.slice(0, 6), []);
  ok(`11b. ${renderizacoes} renderizações auditadas (15 layouts × 6 cenários × 3 imagens × 2 modos)`,
    renderizacoes === 15 * 6 * 3 * 2);
  ok("12. todas saíram em 1200 × 1200 sem undefined, [object Object] ou NaN", problemas.length === 0);

  /* ── 13. Projetos antigos continuam carregando ─────────────────────────── */

  const projetoAntigo = {
    version: 1, id: "antigo", name: "Projeto de antes",
    segment: "Eletrônicos", style: "minimalista",
    palette: { primary: "#2b2b2b", secondary: "#8a8f98", background: "#fafafa", text: "#1a1a1a" },
    product: { name: "Produto antigo", subtitle: "Sub" },
    content: { mainBenefit: "B", specs: "A: 1\nB: 2", packageItems: "x", width: "10 cm" },
    // Formato antigo: rendererIds soltos, sem família.
    pages: ["cover-split-v1", "package-list-v1", "dimensions-technical-v1"],
  };
  const reaberto = model.sanitizeProject(projetoAntigo, { imageModel });
  eq("13. projeto salvo com os ids antigos continua abrindo",
    reaberto.pages.map((p) => p.family), ["cover", "package", "dimensions"]);
  eq("13b. cada id antigo reencontra a variação correta",
    reaberto.pages.map((p) => p.rendererId),
    ["cover-split-v1", "package-list-v1", "dimensions-technical-v1"]);
  ok("13c. o projeto antigo continua renderizando", (() => {
    const template = engine.normalizeTemplateDefinition(model.buildTemplateDefinition(reaberto));
    return renderer.renderAllPages({ template, project: model.toRenderProject(reaberto) }).length === 3;
  })());
  ok("13d. o template do sistema (carregador portátil) segue intacto", (() => {
    const registry = engine.createTemplateRegistry(presets.TEMPLATE_DEFINITIONS);
    const antigo = registry.getDefault();
    return antigo.pages.length === 7 && renderer.validateRendererBindings(antigo).ok === true;
  })());
  ok("13e. um registro da biblioteca salvo no formato antigo também reabre", (() => {
    const store = criarLocalStorage();
    store.setItem(storageLib.LIBRARY_KEY, JSON.stringify({
      version: 1,
      templates: [{
        id: "t1", name: "Antigo", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
        segment: "Geral", style: "minimalista",
        palette: { primary: "#2b2b2b", secondary: "#8a8f98", background: "#fafafa", text: "#1a1a1a" },
        pages: ["cover-split-v1", "benefits-three-cards-v1"],
        product: { name: "P" }, content: {},
      }],
    }));
    const lib = storageLib.createBuilderLibrary({ localStorage: store });
    const registro = lib.listar()[0];
    return model.sanitizeProject(registro, { imageModel }).pages.map((p) => p.family).join() === "cover,benefits";
  })());

  /* ── 15/16. Proposta na biblioteca ─────────────────────────────────────── */

  const store = criarLocalStorage();
  const library = storageLib.createBuilderLibrary({ localStorage: store });
  const propostaComImagem = generator.buildProposal({
    ...ENTRADA_COMPLETA,
    logo: imageModel.normalizeImageRef({ id: "bld-logo-9", dataUrl: PNG, fileName: "l.png", mimeType: "image/png" }),
    productImages: {
      ...imageModel.createDefaultProduct(),
      originalImage: imageModel.normalizeImageRef({ id: "bld-prod-9", dataUrl: PNG, fileName: "p.png", mimeType: "image/png" }),
    },
  }, "comercial-impacto", { imageModel });

  const salvo = library.salvar(propostaComImagem.project);
  ok("15. uma proposta pode ser salva na biblioteca", Boolean(salvo.id));
  eq("15b. o registro é marcado como template gerado", salvo.origin, "gerado");
  eq("15c. a direção visual é preservada", salvo.direction, "comercial-impacto");
  eq("15d. o layout de cada página é preservado",
    salvo.pages.map((p) => p.rendererId), propostaComImagem.pages.map((p) => p.rendererId));
  eq("15e. a ordem é preservada",
    salvo.pages.map((p) => p.family),
    ["cover", "benefits", "specifications", "package", "dimensions"]);
  eq("15f. a paleta é preservada", salvo.palette, propostaComImagem.palette);
  eq("15g. o segmento é preservado", salvo.segment, "Ferramentas");
  eq("15h. os campos de conteúdo são preservados", salvo.content.specs, ENTRADA_COMPLETA.content.specs);
  ok("15i. as referências leves de imagem são preservadas",
    salvo.logo.id === "bld-logo-9" && salvo.product.originalImage.id === "bld-prod-9");

  const bruto = store.getItem(storageLib.LIBRARY_KEY);
  ok("16. base64 não vai para o localStorage", !bruto.includes("data:image"));
  ok("16b. os ids das imagens vão", bruto.includes("bld-logo-9") && bruto.includes("bld-prod-9"));

  ok("15j. reabrir o template gerado devolve os mesmos layouts", (() => {
    const reaberta = model.sanitizeProject(library.obter(salvo.id), { imageModel });
    return reaberta.pages.map((p) => p.rendererId).join()
      === propostaComImagem.pages.map((p) => p.rendererId).join()
      && reaberta.origin === "gerado" && reaberta.direction === "comercial-impacto";
  })());

  console.log(`\n${checks} verificações passaram no gerador de propostas.`);
})().catch((erro) => {
  console.error(erro && erro.message ? erro.message : erro);
  process.exit(1);
});
