// server/tests/designImageFrontend.test.js
// Carrega Portal/design-templates.js DE VERDADE num DOM mínimo e verifica o
// comportamento de ponta a ponta da tela com o editor de imagem:
//
//   • projeto V1 salvo no localStorage continua abrindo e é migrado;
//   • o localStorage deixa de guardar base64 (vai para a camada de blobs);
//   • upload cai para o modo local quando o servidor não responde;
//   • aplicar edição troca a imagem das 7 peças, preservando a original;
//   • cancelar o editor não altera nada;
//   • restaurar volta para a original;
//   • trocar de cliente não apaga a edição;
//   • recarregar a página recupera o projeto e as imagens.

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

const PNG_ORIGINAL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const PNG_EDITADO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAD0lEQVR42mP8z8BQz0BFAAAaHwHzO2WkYgAAAABJRU5ErkJggg==";
const JPEG_LOGO = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAg=";

/* ── DOM mínimo ─────────────────────────────────────────────────────────── */

function criarElemento(tag, ns) {
  const classes = new Set();
  const atributos = new Map();
  const listeners = new Map();
  const el = {
    tagName: String(tag || "div").toUpperCase(),
    _ns: ns || null,
    _atributos: atributos,
    _listeners: listeners,
    children: [],
    parentNode: null,
    hidden: false,
    disabled: false,
    textContent: "",
    title: "",
    type: "",
    files: null,
    style: { setProperty() {}, width: "" },
    dataset: {},
    options: [],
    classList: {
      add: (...n) => n.forEach((c) => classes.add(c)),
      remove: (...n) => n.forEach((c) => classes.delete(c)),
      toggle: (c, force) => {
        const ativo = force === undefined ? !classes.has(c) : Boolean(force);
        if (ativo) classes.add(c); else classes.delete(c);
        return ativo;
      },
      contains: (c) => classes.has(c),
    },
    setAttribute: (nome, valor) => atributos.set(nome, String(valor)),
    getAttribute: (nome) => (atributos.has(nome) ? atributos.get(nome) : null),
    removeAttribute: (nome) => atributos.delete(nome),
    addEventListener(evento, handler) {
      if (!listeners.has(evento)) listeners.set(evento, []);
      listeners.get(evento).push(handler);
    },
    removeEventListener(evento, handler) {
      const lista = listeners.get(evento) || [];
      const indice = lista.indexOf(handler);
      if (indice >= 0) lista.splice(indice, 1);
    },
    dispatch(evento, payload) {
      (listeners.get(evento) || []).forEach((h) => h({ target: el, ...(payload || {}) }));
    },
    appendChild(filho) { el.children.push(filho); if (filho) filho.parentNode = el; return filho; },
    append(...filhos) { filhos.forEach((f) => el.appendChild(f)); },
    replaceChildren(...filhos) { el.children = []; filhos.forEach((f) => el.appendChild(f)); },
    remove() {
      if (!el.parentNode) return;
      const indice = el.parentNode.children.indexOf(el);
      if (indice >= 0) el.parentNode.children.splice(indice, 1);
    },
    focus() {},
    click() { el.dispatch("click"); },
    querySelector: () => null,
    querySelectorAll: () => [],
    get offsetParent() { return el.hidden ? null : {}; },
  };
  // Inputs reais coagem value para string; o fake precisa fazer o mesmo,
  // senão o teste valida um comportamento que o navegador não tem.
  let valor = "";
  Object.defineProperty(el, "value", {
    get: () => valor,
    set: (v) => { valor = v == null ? "" : String(v); },
  });
  return el;
}

// Percorre a árvore procurando elementos SVG <image> e devolve os hrefs.
function coletarHrefs(no, acc) {
  const saida = acc || [];
  if (!no) return saida;
  if (String(no.tagName).toLowerCase() === "image") {
    const href = no.getAttribute("href");
    if (href) saida.push(href);
  }
  (no.children || []).forEach((filho) => coletarHrefs(filho, saida));
  return saida;
}

const elementos = new Map();
function byId(id) {
  if (!elementos.has(id)) {
    const el = criarElemento("div");
    el.id = id;
    elementos.set(id, el);
  }
  return elementos.get(id);
}

/* ── ambiente global ────────────────────────────────────────────────────── */

const armazenamento = new Map();
const localStorageFake = {
  get length() { return armazenamento.size; },
  key: (i) => [...armazenamento.keys()][i] ?? null,
  getItem: (k) => (armazenamento.has(k) ? armazenamento.get(k) : null),
  setItem: (k, v) => { armazenamento.set(k, String(v)); },
  removeItem: (k) => { armazenamento.delete(k); },
};

globalThis.window = globalThis;
globalThis.initLayout = () => {};
// Servidor fora do ar: exercita o caminho degradado de ponta a ponta.
globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
globalThis.localStorage = localStorageFake;
globalThis.indexedDB = undefined;
globalThis.AbortController = class { constructor() { this.signal = {}; } abort() {} };
globalThis.FormData = class { constructor() { this.campos = []; } append(k, v) { this.campos.push([k, v]); } };
globalThis.URL = { createObjectURL: () => "blob:fake", revokeObjectURL() {} };
globalThis.XMLSerializer = class { serializeToString() { return "<svg/>"; } };
globalThis.Blob = class { constructor(partes) { this.partes = partes; } };

// FileReader e Image mínimos para o caminho de leitura local.
globalThis.FileReader = class {
  constructor() { this._listeners = {}; }
  addEventListener(evento, handler) { this._listeners[evento] = handler; }
  readAsDataURL(file) {
    this.result = file._dataUrl;
    setTimeout(() => { if (this._listeners.load) this._listeners.load(); }, 0);
  }
};
globalThis.Image = class {
  set src(valor) {
    this.naturalWidth = 1200;
    this.naturalHeight = 900;
    setTimeout(() => { if (this.onload) this.onload(); }, 0);
  }
};

globalThis.document = {
  getElementById: byId,
  createElement: (tag) => criarElemento(tag),
  createElementNS: (ns, tag) => criarElemento(tag, ns),
  createTextNode: (texto) => {
    const no = criarElemento("#text");
    no.textContent = texto;
    return no;
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  removeEventListener() {},
  body: criarElemento("body"),
  activeElement: null,
};
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const portalDir = path.join(__dirname, "..", "..", "Portal");
globalThis.VF_DESIGN_IMAGE_MODEL = require(path.join(portalDir, "design-image-model"));
globalThis.VF_DESIGN_IMAGE_STORAGE = require(path.join(portalDir, "design-image-storage"));
globalThis.VF_DESIGN_IMAGE_API = require(path.join(portalDir, "design-image-api"));
globalThis.VF_DESIGN_TEMPLATE_ENGINE = require(path.join(portalDir, "design-template-engine"));
globalThis.VF_DESIGN_TEMPLATE_PRESETS = require(path.join(portalDir, "design-template-presets"));
globalThis.VF_DESIGN_TEMPLATE_COMPONENTS = require(path.join(portalDir, "design-template-components"));
globalThis.VF_DESIGN_TEMPLATE_LAYOUTS = require(path.join(portalDir, "design-template-layouts"));
globalThis.VF_DESIGN_TEMPLATE_RENDERER = require(path.join(portalDir, "design-template-renderer"));
const model = globalThis.VF_DESIGN_IMAGE_MODEL;
const storageLib = globalThis.VF_DESIGN_IMAGE_STORAGE;

// Editor falso: devolve o que o teste mandar, sem Fabric e sem canvas.
let respostaDoEditor = null;
let aberturasDoEditor = 0;
let ultimaAbertura = null;
globalThis.VFDesignImageEditor = {
  createDesignImageEditor: () => ({
    abrir: (entrada) => {
      aberturasDoEditor += 1;
      ultimaAbertura = entrada;
      return Promise.resolve(respostaDoEditor);
    },
  }),
};
globalThis.fabric = {};

const STORAGE_KEY = "vf-design-template-studio-v1";
const arquivoTela = path.join(portalDir, "design-templates.js");
const fonteTela = fs.readFileSync(arquivoTela, "utf8");

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms || 20));
}

function carregarTela() {
  vm.runInThisContext(fonteTela, { filename: arquivoTela });
}

function projetoSalvo() {
  return JSON.parse(localStorageFake.getItem(STORAGE_KEY) || "null");
}

function hrefsDaPecaPrincipal() {
  return coletarHrefs(byId("dt-main-preview"));
}

function chavesDeBlob() {
  return [...armazenamento.keys()].filter((k) => k.startsWith(storageLib.FALLBACK_PREFIX));
}

/* ── suíte ──────────────────────────────────────────────────────────────── */

(async () => {
  console.log("\n=== Editor de imagem — tela do Estúdio ===\n");

  /* 1. Projeto V1 antigo continua abrindo e é migrado */

  armazenamento.set(STORAGE_KEY, JSON.stringify({
    version: 1,
    templateId: "portable-charger-complete-v1",
    clienteNome: "Cliente Legado",
    marcaNome: "LEGADO",
    palette: { primary: "#123047", secondary: "#ef6f55", background: "#f4efe5", text: "#12202b" },
    product: { name: "Produto Antigo", imageDataUrl: PNG_ORIGINAL, fileName: "antiga.png", scale: 130, x: 40, y: 60 },
    logoDataUrl: JPEG_LOGO,
    logoFileName: "logo.jpg",
    content: { benefit: "Benefício antigo" },
    view: "editor",
  }));

  carregarTela();
  await esperar(60);

  eq("1. projeto V1 abre sem quebrar (nome do produto preservado)", byId("dt-product-name").value, "Produto Antigo");
  eq("2. textos do V1 sobrevivem à migração", byId("dt-benefit").value, "Benefício antigo");
  eq("3. o enquadramento do V1 vira placement", byId("dt-product-scale").value, "130");
  eq("4. o projeto salvo passa a declarar schema 2", projetoSalvo().version, 2);
  ok("5. o localStorage do projeto não guarda mais base64",
    !localStorageFake.getItem(STORAGE_KEY).includes("data:image"));
  ok("6. o projeto salvo guarda ids de imagem para reidratar",
    typeof projetoSalvo().product.originalImage.id === "string" && projetoSalvo().product.originalImage.id.length > 0);
  ok("7. os blobs foram para a camada de imagens, não para a chave do projeto", chavesDeBlob().length === 2);

  const hrefsV1 = hrefsDaPecaPrincipal();
  ok("8. a peça renderizada usa a imagem migrada do produto", hrefsV1.includes(PNG_ORIGINAL));
  ok("9. a peça renderizada usa o logo migrado", hrefsV1.includes(JPEG_LOGO));

  /* 2. Aplicar edição */

  respostaDoEditor = {
    editing: { ...model.createDefaultEditing(), brightness: 35, rotation: 90 },
    rendered: { dataUrl: PNG_EDITADO, width: 1200, height: 1200 },
  };
  byId("dt-edit-product").dispatch("click");
  await esperar(40);

  eq("10. o editor foi aberto uma vez", aberturasDoEditor, 1);
  eq("11. o editor recebeu a imagem ORIGINAL, não a exibida", ultimaAbertura.dataUrl, PNG_ORIGINAL);

  const hrefsEditados = hrefsDaPecaPrincipal();
  ok("12. as peças passam a usar a imagem editada", hrefsEditados.includes(PNG_EDITADO));
  ok("13. as peças deixam de usar a imagem original", !hrefsEditados.includes(PNG_ORIGINAL));
  ok("14. o logo continua intacto após a edição", hrefsEditados.includes(JPEG_LOGO));

  const salvoComEdicao = projetoSalvo();
  eq("15. os parâmetros da edição são persistidos", salvoComEdicao.product.editing.brightness, 35);
  ok("16. original e editada têm ids distintos no projeto salvo",
    salvoComEdicao.product.originalImage.id !== salvoComEdicao.product.editedImage.id
    && Boolean(salvoComEdicao.product.editedImage.id));
  ok("17. o localStorage do projeto continua sem base64", !localStorageFake.getItem(STORAGE_KEY).includes("data:image"));
  eq("18. o enquadramento na peça não é afetado pela edição", salvoComEdicao.product.placement.scale, 130);

  // Regressão: o <svg> raiz não pode declarar xmlns à mão. createElementNS já
  // coloca o elemento no namespace e o XMLSerializer emite a declaração; o
  // atributo extra gerava xmlns duplicado — XML inválido na hora de virar PNG.
  const svgRaiz = byId("dt-main-preview").children[0];
  eq("19. a peça é criada no namespace SVG", svgRaiz._ns, "http://www.w3.org/2000/svg");
  eq("20. a peça não declara xmlns à mão (evita duplicata na serialização)", svgRaiz.getAttribute("xmlns"), null);
  eq("21. a peça mantém o viewBox de 1200x1200", svgRaiz.getAttribute("viewBox"), "0 0 1200 1200");

  eq("22. o conjunto continua com 7 miniaturas", byId("dt-thumbnails").children.length, 7);
  const todasAsPecas = coletarHrefs(byId("dt-thumbnails"));
  // "Compra segura" é a única peça que não desenha o produto (usa o escudo).
  eq("23. as 6 peças que mostram o produto usam a imagem editada",
    todasAsPecas.filter((href) => href === PNG_EDITADO).length, 6);
  eq("24. nenhuma miniatura ficou com a imagem original", todasAsPecas.filter((href) => href === PNG_ORIGINAL).length, 0);
  eq("25. o logo aparece nas 7 peças", todasAsPecas.filter((href) => href === JPEG_LOGO).length, 7);

  /* 3. Cancelar não altera nada */

  const antesDoCancelamento = localStorageFake.getItem(STORAGE_KEY);
  respostaDoEditor = null;
  byId("dt-edit-product").dispatch("click");
  await esperar(40);

  eq("26. cancelar o editor não muda o projeto salvo", localStorageFake.getItem(STORAGE_KEY), antesDoCancelamento);
  ok("27. cancelar mantém a imagem editada em uso", hrefsDaPecaPrincipal().includes(PNG_EDITADO));

  /* 4. Trocar de cliente preserva a edição */

  byId("dt-client-select").value = "";
  byId("dt-client-select").dispatch("change");
  await esperar(20);
  ok("28. trocar de cliente não apaga a imagem editada", hrefsDaPecaPrincipal().includes(PNG_EDITADO));
  eq("29. trocar de cliente preserva os parâmetros da edição", projetoSalvo().product.editing.brightness, 35);

  /* 5. Comparação Original x Personalizado */

  byId("dt-view-original").dispatch("click");
  await esperar(20);
  const hrefsOriginalMode = hrefsDaPecaPrincipal();
  eq("30. o modo Original mostra o template puro, sem imagens do usuário", hrefsOriginalMode.length, 0);

  byId("dt-view-custom").dispatch("click");
  await esperar(20);
  ok("31. voltar para Personalizado traz a imagem editada de volta", hrefsDaPecaPrincipal().includes(PNG_EDITADO));

  /* 6. Restaurar imagem original */

  byId("dt-restore-product").dispatch("click");
  await esperar(40);
  const hrefsRestaurados = hrefsDaPecaPrincipal();
  ok("32. restaurar volta a usar a imagem original", hrefsRestaurados.includes(PNG_ORIGINAL));
  ok("33. restaurar tira a imagem editada de circulação", !hrefsRestaurados.includes(PNG_EDITADO));
  eq("34. restaurar zera os parâmetros salvos", projetoSalvo().product.editing.brightness, 0);
  eq("35. restaurar apaga a referência da imagem editada", projetoSalvo().product.editedImage.id, null);
  eq("36. o blob órfão da edição é removido do armazenamento", chavesDeBlob().length, 2);

  /* 7. Upload com o servidor fora do ar */

  const arquivoNovo = { name: "nova-foto.png", type: "image/png", size: 1024, _dataUrl: PNG_EDITADO };
  byId("dt-product-file").files = [arquivoNovo];
  byId("dt-product-file").dispatch("change", { target: { files: [arquivoNovo] } });
  await esperar(80);

  ok("37. sem servidor o upload cai para leitura local e funciona", hrefsDaPecaPrincipal().includes(PNG_EDITADO));
  eq("38. a imagem nova entra como ORIGINAL", projetoSalvo().product.originalImage.fileName, "nova-foto.png");
  eq("39. imagem nova zera qualquer edição anterior", projetoSalvo().product.editedImage.id, null);
  eq("40. as dimensões lidas localmente são registradas", projetoSalvo().product.originalImage.width, 1200);
  ok("41. o localStorage do projeto segue sem base64 depois do upload",
    !localStorageFake.getItem(STORAGE_KEY).includes("data:image"));

  /* 8. Arquivo inválido é recusado sem sujar o projeto */

  const antesDoInvalido = localStorageFake.getItem(STORAGE_KEY);
  const arquivoSvg = { name: "malicioso.svg", type: "image/svg+xml", size: 500, _dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" };
  byId("dt-product-file").dispatch("change", { target: { files: [arquivoSvg] } });
  await esperar(60);
  eq("42. SVG é recusado na tela e o projeto não muda", localStorageFake.getItem(STORAGE_KEY), antesDoInvalido);

  const arquivoEnorme = { name: "enorme.png", type: "image/png", size: 20 * 1024 * 1024, _dataUrl: PNG_ORIGINAL };
  byId("dt-product-file").dispatch("change", { target: { files: [arquivoEnorme] } });
  await esperar(60);
  eq("43. arquivo acima do limite é recusado e o projeto não muda", localStorageFake.getItem(STORAGE_KEY), antesDoInvalido);

  /* 9. Recarregar a página */

  const idAntesDoReload = projetoSalvo().product.originalImage.id;
  elementos.clear();
  aberturasDoEditor = 0;
  carregarTela();
  await esperar(80);

  eq("44. recarregar recupera o projeto salvo", byId("dt-product-name").value, "Produto Antigo");
  eq("45. recarregar reidrata a imagem pelo id guardado", projetoSalvo().product.originalImage.id, idAntesDoReload);
  ok("46. recarregar traz a imagem de volta para as peças", hrefsDaPecaPrincipal().includes(PNG_EDITADO));
  ok("47. recarregar não reintroduz base64 no localStorage",
    !localStorageFake.getItem(STORAGE_KEY).includes("data:image"));

  /* 10. Restaurar o template inteiro */

  byId("dt-reset").dispatch("click");
  byId("dt-confirm-accept").dispatch("click");
  await esperar(60);

  eq("48. restaurar o template limpa a imagem do produto", projetoSalvo().product.originalImage.id, null);
  eq("49. restaurar o template limpa o logo", projetoSalvo().logo.id, null);
  eq("50. restaurar o template devolve os textos padrão", byId("dt-product-name").value, "Power Station One");
  eq("51. restaurar o template recolhe todos os blobs órfãos", chavesDeBlob().length, 0);
  eq("52. a peça volta a ser desenhada sem imagens do usuário", hrefsDaPecaPrincipal().length, 0);

  console.log(`\n${checks} verificações passaram na tela do Estúdio com editor de imagem.`);
})().catch((error) => { console.error(error); process.exit(1); });
