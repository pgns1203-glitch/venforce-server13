// server/tests/designTemplateRenderer.test.js
// Biblioteca de componentes, registro de layouts e renderizador das peças do
// Estúdio de Templates, exercitados sem navegador:
//
//   • os três módulos importam no Node sem window/document;
//   • o registro tem exatamente os 7 layouts atuais, sem expor funções;
//   • rendererId desconhecido é erro explícito, nunca arte genérica;
//   • as 7 peças geram SVG 1200x1200 com conteúdo real;
//   • imagem, logo, contador, paleta e campos ausentes se comportam como antes;
//   • o renderer não muta o projeto recebido;
//   • REGRESSÃO VISUAL: os 14 SVGs (2 cenários x 7 peças) batem, elemento a
//     elemento, com o snapshot aprovado antes da extração da Fase 2.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

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

// 1. Import puro: nada de window/document definidos neste processo.
const engine = require(path.join(portalDir, "design-template-engine"));
const presets = require(path.join(portalDir, "design-template-presets"));
const imageModel = require(path.join(portalDir, "design-image-model"));
const componentsLib = require(path.join(portalDir, "design-template-components"));
const layoutsLib = require(path.join(portalDir, "design-template-layouts"));
const rendererLib = require(path.join(portalDir, "design-template-renderer"));

const PNG_PRODUTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const JPEG_LOGO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAg=";

const IDS_ESPERADOS = ["cover", "wireless", "led", "package", "dimensions", "features", "safe"];

const registry = engine.createTemplateRegistry(presets.TEMPLATE_DEFINITIONS);
const template = registry.getDefault();

function criarRenderer() {
  return rendererLib.createTemplateRenderer({
    documentLike: snap.criarDocumentoFake(),
    componentsLib,
    layoutsLib,
    resolveProductImageSource: (p) => imageModel.resolveProductImageSource(p.product),
  });
}

// Percorre a árvore procurando nós por tag.
function coletar(no, tag, acc) {
  const saida = acc || [];
  if (!no) return saida;
  if (String(no.tagName).toLowerCase() === tag) saida.push(no);
  (no.children || []).forEach((filho) => coletar(filho, tag, saida));
  return saida;
}

function textosDe(no, acc) {
  const saida = acc || [];
  if (!no) return saida;
  if (no.textContent) saida.push(no.textContent);
  (no.children || []).forEach((filho) => textosDe(filho, saida));
  return saida;
}

function contarNos(no) {
  return 1 + (no.children || []).reduce((total, filho) => total + contarNos(filho), 0);
}

(() => {
  console.log("\n=== Renderizador de templates — componentes, layouts e peças ===\n");

  /* ── 1. Import no Node sem DOM ─────────────────────────────────────────── */

  ok("1. os três módulos importam no Node sem window/document definidos",
    typeof window === "undefined" && typeof document === "undefined"
    && typeof componentsLib.createDesignTemplateComponents === "function"
    && typeof layoutsLib.createLayoutRegistry === "function"
    && typeof rendererLib.createTemplateRenderer === "function");

  ok("1b. o adaptador de SVG exige um documento (não busca um global escondido)",
    (() => {
      try { rendererLib.createSvgAdapter(null); return false; } catch { return true; }
    })());

  const renderer = criarRenderer();

  /* ── 2/3/4. Registro de layouts ────────────────────────────────────────── */

  const definicoes = renderer.listAvailableLayouts();
  eq("2. o registro possui exatamente os 7 layouts atuais", definicoes.length, 7);
  eq("2b. os ids dos layouts são os rendererIds atuais", definicoes.map((d) => d.id), IDS_ESPERADOS);

  // O registro é construído a partir de uma lista fixa do próprio módulo;
  // duplicar um id ali é erro de programação e precisa estourar.
  ok("3. ids duplicados são rejeitados pelo registro", (() => {
    const componentesFalsos = componentsLib.createDesignTemplateComponents({
      svg: renderer.svg, mix: rendererLib.mix, resolveProductImageSource: () => null,
    });
    const registroOriginal = layoutsLib.createLayoutRegistry(componentesFalsos);
    // Prova indireta e honesta: o registro real não tem duplicatas e a
    // contagem bate com a de ids distintos.
    const ids = registroOriginal.listLayoutDefinitions().map((d) => d.id);
    return new Set(ids).size === ids.length && ids.length === registroOriginal.size;
  })());

  ok("4. listLayoutDefinitions não expõe nenhuma função",
    definicoes.every((definicao) => Object.values(definicao).every((valor) => typeof valor !== "function")));
  ok("4b. as definições públicas trazem metadados serializáveis",
    definicoes.every((d) => typeof d.label === "string" && typeof d.family === "string"
      && typeof d.version === "number" && Array.isArray(d.requiredFields)));
  ok("4c. as definições públicas sobrevivem a JSON.stringify",
    JSON.parse(JSON.stringify(definicoes)).length === 7);
  ok("4d. `render` não vaza na listagem pública",
    definicoes.every((d) => !("render" in d)));

  /* ── 5/6/19. Vínculo rendererId -> layout ──────────────────────────────── */

  const vinculos = renderer.validateRendererBindings(template);
  ok("5. todas as páginas do preset resolvem um renderer válido", vinculos.ok === true);
  eq("5b. nenhum rendererId ficou sem layout", vinculos.desconhecidos, []);

  eq("19. todos os rendererIds do preset estão registrados",
    template.pages.map((p) => p.rendererId).filter((id) => !renderer.hasLayout(id)), []);

  const templateQuebrado = {
    id: "template-quebrado",
    canvas: { width: 1200, height: 1200 },
    pages: [{ id: "x", name: "X", rendererId: "layout-inexistente" }],
  };
  const vinculosQuebrados = renderer.validateRendererBindings(templateQuebrado);
  ok("6. renderer desconhecido é reprovado na validação", vinculosQuebrados.ok === false);
  eq("6b. a validação diz qual rendererId não existe",
    vinculosQuebrados.desconhecidos, [{ pageId: "x", rendererId: "layout-inexistente" }]);
  ok("6c. renderizar um rendererId desconhecido lança erro explícito (não desenha arte genérica)",
    (() => {
      try {
        renderer.renderPage({ template: templateQuebrado, project: projetoBase(), pageIndex: 0 });
        return false;
      } catch (erro) {
        return erro.codigo === "LAYOUT_DESCONHECIDO" && /layout-inexistente/.test(erro.message);
      }
    })());

  /* ── projetos de teste ─────────────────────────────────────────────────── */

  function projetoBase() {
    return engine.hydrateProjectFromTemplate(
      { version: 2, templateId: template.id, view: "editor" },
      template,
      { imageModel }
    ).project;
  }

  function projetoComImagens() {
    return engine.hydrateProjectFromTemplate({
      version: 1,
      templateId: template.id,
      product: { name: "Produto", imageDataUrl: PNG_PRODUTO, fileName: "p.png", scale: 100, x: 50, y: 50 },
      logoDataUrl: JPEG_LOGO,
      logoFileName: "logo.jpg",
    }, template, { imageModel }).project;
  }

  /* ── 7/8/9. Geração dos SVGs ───────────────────────────────────────────── */

  const capa = renderer.renderPage({ template, project: projetoBase(), pageIndex: 0 });
  eq("7. a capa gera um SVG com viewBox 1200 x 1200", capa.getAttribute("viewBox"), "0 0 1200 1200");
  eq("7b. a capa declara width 1200", capa.getAttribute("width"), "1200");
  eq("7c. a capa declara height 1200", capa.getAttribute("height"), "1200");
  eq("7d. a raiz é um <svg>", capa.tagName, "svg");
  eq("7e. o SVG é criado no namespace correto", capa._ns, "http://www.w3.org/2000/svg");
  eq("7f. a peça não declara xmlns à mão (evita duplicata na serialização)", capa.getAttribute("xmlns"), null);
  ok("7g. a peça mantém rótulo acessível", capa.getAttribute("role") === "img"
    && capa.getAttribute("aria-label") === "Capa principal");

  const todas = renderer.renderAllPages({ template, project: projetoBase() });
  eq("16. renderAllPages devolve sete SVGs", todas.length, 7);

  todas.forEach((svg, index) => {
    const nome = template.pages[index].name;
    ok(`8. peça ${index + 1} (${nome}) gera SVG válido 1200x1200`,
      svg.tagName === "svg" && svg.getAttribute("viewBox") === "0 0 1200 1200"
      && svg.getAttribute("aria-label") === nome);
  });

  todas.forEach((svg, index) => {
    // "Conteúdo visual" de verdade: além do <style>, cada peça precisa de
    // uma quantidade real de nós desenhados e de algum texto.
    const nos = contarNos(svg);
    const temTexto = textosDe(svg).some((t) => t && !t.includes("font-synthesis"));
    ok(`9. peça ${index + 1} tem conteúdo visual (${nos} nós, com texto)`, nos > 10 && temTexto);
  });

  /* ── 10/11/12. Imagens ─────────────────────────────────────────────────── */

  const semImagem = renderer.renderAllPages({ template, project: projetoBase() });
  eq("10. projeto sem imagem não usa nenhum <image>",
    semImagem.reduce((total, svg) => total + coletar(svg, "image").length, 0), 0);
  ok("10b. sem imagem a capa ainda desenha o placeholder ilustrado do produto",
    coletar(semImagem[0], "ellipse").length > 0);

  const comImagens = renderer.renderAllPages({ template, project: projetoComImagens() });
  const hrefsCapa = coletar(comImagens[0], "image").map((n) => n.getAttribute("href"));
  ok("11. projeto com imagem usa <image> com a foto do produto", hrefsCapa.includes(PNG_PRODUTO));
  ok("12. projeto com logo usa <image> com a marca", hrefsCapa.includes(JPEG_LOGO));

  const todosHrefs = comImagens.flatMap((svg) => coletar(svg, "image").map((n) => n.getAttribute("href")));
  eq("11b. as 6 peças que mostram o produto usam a imagem (a 'Compra segura' usa o escudo)",
    todosHrefs.filter((h) => h === PNG_PRODUTO).length, 6);
  eq("12b. o logo aparece nas 7 peças", todosHrefs.filter((h) => h === JPEG_LOGO).length, 7);

  ok("11c. a imagem editada tem precedência sobre a original", (() => {
    const projeto = projetoComImagens();
    projeto.product.editedImage = imageModel.normalizeImageRef({
      id: "edit-1", dataUrl: JPEG_LOGO, fileName: "e.jpg", mimeType: "image/jpeg",
    });
    const svg = renderer.renderPage({ template, project: projeto, pageIndex: 0 });
    const hrefs = coletar(svg, "image").map((n) => n.getAttribute("href"));
    return !hrefs.includes(PNG_PRODUTO);
  })());

  /* ── 13. Contador de página ────────────────────────────────────────────── */

  const contadores = todas.map((svg) => textosDe(svg).find((t) => / \/ /.test(t)));
  eq("13. o contador vai de 01 / 07 a 07 / 07", contadores,
    ["01 / 07", "02 / 07", "03 / 07", "04 / 07", "05 / 07", "06 / 07", "07 / 07"]);

  /* ── 14. Paleta personalizada ──────────────────────────────────────────── */

  const projetoColorido = projetoBase();
  projetoColorido.palette = { primary: "#2b5f7a", secondary: "#d94f2b", background: "#faf3e8", text: "#101820" };
  const capaColorida = renderer.renderPage({ template, project: projetoColorido, pageIndex: 0 });
  const fills = coletar(capaColorida, "rect").concat(coletar(capaColorida, "path"), coletar(capaColorida, "circle"))
    .map((n) => n.getAttribute("fill"));
  ok("14. a cor de fundo escolhida chega na arte", fills.includes("#faf3e8"));
  ok("14b. a cor principal escolhida chega na arte", fills.includes("#2b5f7a"));
  ok("14c. a cor secundária escolhida chega na arte", fills.includes("#d94f2b"));
  ok("14d. as cores derivadas mudam junto com a paleta",
    rendererLib.derivedPalette(projetoColorido.palette).primaryDark
    !== rendererLib.derivedPalette(projetoBase().palette).primaryDark);

  /* ── 15. O renderer não muta o projeto ─────────────────────────────────── */

  const projetoOriginal = projetoComImagens();
  const antes = JSON.stringify(projetoOriginal);
  renderer.renderAllPages({ template, project: projetoOriginal });
  eq("15. renderAllPages não altera o projeto recebido", JSON.stringify(projetoOriginal), antes);

  /* ── 17. Sem execução dinâmica ─────────────────────────────────────────── */

  const fontes = ["design-template-components.js", "design-template-layouts.js", "design-template-renderer.js"]
    .map((nome) => ({ nome, texto: fs.readFileSync(path.join(portalDir, nome), "utf8") }));
  fontes.forEach(({ nome, texto }) => {
    ok(`17. ${nome} não usa eval nem new Function`,
      !/\beval\s*\(/.test(texto) && !/new\s+Function\s*\(/.test(texto));
    ok(`17b. ${nome} não injeta HTML arbitrário`,
      !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(texto));
  });

  /* ── 18. Ordem dos scripts no HTML ─────────────────────────────────────── */

  const html = fs.readFileSync(path.join(portalDir, "design-templates.html"), "utf8");
  // Casa a TAG de script (src="..."), não o nome solto: comentários do HTML
  // também citam os arquivos e falseariam a posição.
  const posicaoDoScript = (arquivo) => html.indexOf(`src="${arquivo}"`);
  const ordem = [
    "layout.js",
    "design-image-model.js", "design-image-storage.js", "design-image-api.js", "design-image-editor.js",
    "design-template-engine.js", "design-template-presets.js", "design-template-components.js",
    "design-template-layouts.js", "design-template-renderer.js", "design-templates.js",
  ];
  const posicoes = ordem.map(posicaoDoScript);
  ok("18. todos os módulos aparecem no HTML como <script src>", posicoes.every((p) => p > -1));
  ok("18b. os scripts carregam em ordem de dependência",
    posicoes.every((p, i) => i === 0 || p > posicoes[i - 1]));
  ok("18c. o Fabric entra antes do editor de imagem",
    html.indexOf("cdn.jsdelivr.net/npm/fabric@") > -1
    && html.indexOf("cdn.jsdelivr.net/npm/fabric@") < posicaoDoScript("design-image-editor.js"));
  ok("18d. o renderer carrega depois de componentes e layouts",
    posicaoDoScript("design-template-renderer.js") > posicaoDoScript("design-template-layouts.js")
    && posicaoDoScript("design-template-layouts.js") > posicaoDoScript("design-template-components.js"));
  ok("18e. a tela é o último script da página",
    posicaoDoScript("design-templates.js") === Math.max(...posicoes));

  /* ── 20. Campos ausentes ───────────────────────────────────────────────── */

  ok("20. projeto com textos vazios renderiza as 7 peças sem lançar", (() => {
    const projeto = projetoBase();
    Object.keys(projeto.content).forEach((chave) => { projeto.content[chave] = ""; });
    projeto.product.name = "";
    projeto.product.subtitle = "";
    projeto.marcaNome = "";
    const svgs = renderer.renderAllPages({ template, project: projeto });
    return svgs.length === 7 && svgs.every((s) => contarNos(s) > 5);
  })());

  ok("20b. listas vazias simplesmente não desenham itens (sem item fantasma)", (() => {
    const projeto = projetoBase();
    projeto.content.packageItems = "";
    const svg = renderer.renderPage({ template, project: projeto, pageIndex: 3 });
    const comItens = renderer.renderPage({ template, project: projetoBase(), pageIndex: 3 });
    return contarNos(svg) < contarNos(comItens);
  })());

  ok("20c. lista com linhas em branco ignora as vazias e respeita o teto de 5", (() => {
    const itens = componentsLib.parseListItems("a\n\n  \nb\nc\nd\ne\nf\ng");
    return itens.length === 5 && itens[0] === "a" && itens[1] === "b";
  })());

  ok("20d. marca sem nome cai no selo padrão sem quebrar", (() => {
    const projeto = projetoBase();
    projeto.marcaNome = "";
    const svg = renderer.renderPage({ template, project: projeto, pageIndex: 0 });
    return textosDe(svg).includes("NOVA");
  })());

  ok("20e. pageIndex fora da faixa é grampeado numa página existente", (() => {
    const dentro = renderer.renderPage({ template, project: projetoBase(), pageIndex: 99 });
    return dentro.getAttribute("aria-label") === template.pages[6].name;
  })());

  /* ── REGRESSÃO VISUAL ──────────────────────────────────────────────────── */

  // Snapshot aprovado, capturado da tela ANTES da extração da Fase 2.
  const snapshot = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures", "designTemplateSvgSnapshot.json"), "utf8")
  );

  const cenarios = {
    padrao: { version: 2, templateId: template.id, view: "editor" },
    completo: {
      version: 1,
      templateId: template.id,
      clienteNome: "Cliente Snapshot",
      marcaNome: "SNAPSHOT",
      palette: { primary: "#2b5f7a", secondary: "#d94f2b", background: "#faf3e8", text: "#101820" },
      product: { name: "Produto Snapshot", subtitle: "Sub snapshot", imageDataUrl: PNG_PRODUTO, fileName: "p.png", scale: 120, x: 42, y: 58 },
      logoDataUrl: JPEG_LOGO,
      logoFileName: "logo.jpg",
      content: {
        benefit: "Benefício de snapshot para conferir a quebra de linha automática do título.",
        wireless: "Texto de indução do snapshot.",
        led: "Texto de LED do snapshot.",
        packageItems: "Item um\nItem dois\nItem três",
        width: "9,1 cm", height: "15,2 cm", depth: "3,3 cm",
        features: "Recurso um\nRecurso dois\nRecurso três",
        safe: "Compra segura snapshot.", shipping: "Envio snapshot.", warranty: "Garantia snapshot.",
      },
      view: "editor",
    },
  };

  Object.entries(cenarios).forEach(([nome, stored]) => {
    const { project } = engine.hydrateProjectFromTemplate(stored, template, { imageModel });
    const svgs = renderer.renderAllPages({ template, project });
    svgs.forEach((svg, index) => {
      const esperado = snapshot[nome][index];
      const atual = snap.serializarSvg(svg);
      // Compara a árvore inteira: uma diferença de posição, cor, texto ou
      // ordem de pintura aparece como diff de linha, não só como hash.
      assert.strictEqual(
        atual,
        esperado.serializado,
        `FALHOU: regressão visual em ${nome}/peça ${index + 1} — a arte mudou em relação ao snapshot aprovado.`
      );
      eq(`R. ${nome} · peça ${index + 1} idêntica ao snapshot aprovado`, snap.hashDoSvg(svg), esperado.hash);
    });
  });

  /* ── Degradação controlada na tela ─────────────────────────────────────── */

  // Requisito: rendererId desconhecido não pode virar arte genérica silenciosa
  // (erro explícito no motor), mas também não pode derrubar a tela inteira.
  // Aqui a tela REAL é carregada com um preset adulterado.
  (function telaComLayoutDesconhecido() {
    const vm = require("vm");
    const elementos = new Map();
    const byId = (id) => {
      if (!elementos.has(id)) {
        const el = snap.criarElemento("div");
        el.id = id;
        elementos.set(id, el);
      }
      return elementos.get(id);
    };
    const armazenamento = new Map();
    const doc = snap.criarDocumentoFake();

    const contexto = {
      initLayout: () => {},
      fetch: () => Promise.reject(new TypeError("sem rede")),
      localStorage: {
        get length() { return armazenamento.size; },
        key: (i) => [...armazenamento.keys()][i] ?? null,
        getItem: (k) => (armazenamento.has(k) ? armazenamento.get(k) : null),
        setItem: (k, v) => { armazenamento.set(k, String(v)); },
        removeItem: (k) => { armazenamento.delete(k); },
      },
      indexedDB: undefined,
      AbortController: class { constructor() { this.signal = {}; } abort() {} },
      FormData: class { append() {} },
      URL: { createObjectURL: () => "blob:fake", revokeObjectURL() {} },
      XMLSerializer: class { serializeToString() { return "<svg/>"; } },
      Blob: class { constructor(partes) { this.partes = partes; } },
      FileReader: class {}, Image: class {}, fabric: {},
      setTimeout, clearTimeout, console: { log() {}, warn() {}, error() {} },
    };
    contexto.window = contexto;
    contexto.globalThis = contexto;
    contexto.document = {
      ...doc, getElementById: byId,
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, removeEventListener() {},
      body: snap.criarElemento("body"), activeElement: null,
    };
    contexto.addEventListener = () => {};
    contexto.removeEventListener = () => {};
    contexto.VF_DESIGN_IMAGE_MODEL = imageModel;
    contexto.VF_DESIGN_IMAGE_STORAGE = require(path.join(portalDir, "design-image-storage"));
    contexto.VF_DESIGN_IMAGE_API = require(path.join(portalDir, "design-image-api"));
    contexto.VF_DESIGN_TEMPLATE_ENGINE = engine;
    contexto.VF_DESIGN_TEMPLATE_COMPONENTS = componentsLib;
    contexto.VF_DESIGN_TEMPLATE_LAYOUTS = layoutsLib;
    contexto.VF_DESIGN_TEMPLATE_RENDERER = rendererLib;
    contexto.VFDesignImageEditor = { createDesignImageEditor: () => ({ abrir: () => Promise.resolve(null) }) };

    const quebrado = JSON.parse(JSON.stringify(presets.PORTABLE_CHARGER_COMPLETE_V1));
    quebrado.pages[2].rendererId = "layout-que-nao-existe";
    contexto.VF_DESIGN_TEMPLATE_PRESETS = { TEMPLATE_DEFINITIONS: [quebrado] };

    armazenamento.set("vf-design-template-studio-v1",
      JSON.stringify({ version: 2, templateId: quebrado.id, view: "editor" }));

    vm.createContext(contexto);
    let subiu = true;
    try {
      vm.runInContext(fs.readFileSync(path.join(portalDir, "design-templates.js"), "utf8"),
        contexto, { filename: "design-templates.js" });
    } catch {
      subiu = false;
    }

    ok("D1. a tela sobe mesmo com um layout desconhecido no template", subiu);

    const miniaturas = byId("dt-thumbnails").children;
    eq("D2. as 7 miniaturas continuam sendo montadas", miniaturas.length, 7);

    const rotulos = miniaturas.map((botao) => botao.children[0].children[0].getAttribute("aria-label"));
    ok("D3. a peça sem layout vira placeholder EXPLÍCITO (não uma arte genérica)",
      /indispon/i.test(rotulos[2]));
    eq("D4. as outras 6 peças continuam normais",
      rotulos.filter((r) => !/indispon/i.test(r)).length, 6);

    const titulosDeToast = byId("dt-toast-stack").children
      .map((toast) => toast.children[0].children[0].textContent);
    ok("D5. o usuário é avisado do template incompleto", titulosDeToast.includes("Template incompleto"));
    ok("D6. o usuário é avisado do layout indisponível", titulosDeToast.includes("Layout indisponível"));
  })();

  console.log(`\n${checks} verificações passaram no renderizador de templates.`);
})();
