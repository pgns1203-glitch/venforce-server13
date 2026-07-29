// designTemplatesHeadless.js
// -----------------------------------------------------------------------------
// Verificação MANUAL (não roda no `npm test`).
//
// Executa o editor de imagem com o Fabric.js DE VERDADE, num DOM jsdom com
// node-canvas, para provar em runtime o que um teste sem navegador não alcança.
// Depende de pacotes que NÃO são dependência do projeto — instale fora do repo:
//
//   mkdir -p /tmp/vf-headless && cd /tmp/vf-headless
//   npm init -y && npm install canvas@3.2.0 jsdom@26.1.0 fabric@6.9.1
//   cp <repo>/server/tests/manual/*.js .
//   node designTemplatesHeadless.js
//
// Ajuste as constantes PORTAL/FABRIC abaixo para os caminhos da sua máquina.
// -----------------------------------------------------------------------------

// Tela completa do Estúdio + editor real (Fabric) num DOM jsdom com node-canvas.
// Prova o critério de aceite principal: editar a imagem, ver a edição nas 7
// peças e exportar cada peça em PNG 1200x1200.

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { Image: NodeImage } = require("canvas");
const sharp = require(process.env.VF_SHARP || "/home/user/Documentos/venforce_scanner_x1/server/node_modules/sharp");

const PORTAL = process.env.VF_PORTAL || "/home/user/Documentos/venforce_scanner_x1/Portal";
const FABRIC = path.join(__dirname, "node_modules", "fabric", "dist", "index.min.js");
const STORAGE_KEY = "vf-design-template-studio-v1";

let checks = 0;
const falhas = [];
function ok(label, cond) {
  checks += 1;
  if (cond) console.log(`  ok  ${label}`);
  else { falhas.push(label); console.log(`  XX  ${label}`); }
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// jsdom/node-canvas devolvem Blob de sabores diferentes conforme a versão.
async function paraBuffer(blob) {
  if (Buffer.isBuffer(blob)) return blob;
  if (typeof blob.arrayBuffer === "function") return Buffer.from(await blob.arrayBuffer());
  if (typeof blob.stream === "function") {
    const partes = [];
    for await (const chunk of blob.stream()) partes.push(Buffer.from(chunk));
    return Buffer.concat(partes);
  }
  if (blob[Symbol.for("impl")] && blob[Symbol.for("impl")]._buffer) return Buffer.from(blob[Symbol.for("impl")]._buffer);
  const chaves = Object.getOwnPropertySymbols(blob);
  for (const chave of chaves) {
    const alvo = blob[chave];
    if (alvo && alvo._buffer) return Buffer.from(alvo._buffer);
  }
  throw new Error("nao sei converter esse blob: " + Object.prototype.toString.call(blob));
}

(async () => {
  const html = fs.readFileSync(path.join(PORTAL, "design-templates.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://portal.local/" });
  const { window } = dom;

  const createElementOriginal = window.document.createElement.bind(window.document);
  window.document.createElement = (tag, ...resto) => {
    if (String(tag).toLowerCase() === "img") return new NodeImage();
    return createElementOriginal(tag, ...resto);
  };
  // exportCurrentPage usa new Image(): jsdom não decodifica, node-canvas sim.
  window.Image = NodeImage;

  // node-canvas Image não carrega blob:. Trocamos o Object URL por data URL,
  // guardando o blob para inspecionar o PNG exportado.
  let svgMaisRecente = "";
  const svgsSerializados = [];
  const ultimoSvg = () => svgMaisRecente;
  const blobsPorUrl = new Map();
  let contadorUrl = 0;
  window.URL.createObjectURL = (blob) => {
    contadorUrl += 1;
    const chave = `objurl-${contadorUrl}`;
    blobsPorUrl.set(chave, blob);
    if (String(blob.type || "").includes("svg")) {
      // devolvido direto para o <img>: data URL com o SVG serializado
      return blob._svgDataUrl || chave;
    }
    return chave;
  };
  window.URL.revokeObjectURL = (url) => { blobsPorUrl.delete(url); };

  // Blob do jsdom não expõe as partes; embrulhamos para guardar o texto do SVG.
  const BlobOriginal = window.Blob;
  window.Blob = class extends BlobOriginal {
    constructor(partes, opcoes) {
      super(partes, opcoes);
      if (opcoes && String(opcoes.type || "").includes("svg")) {
        this._svgTexto = String(partes[0]);
        this._svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(String(partes[0]), "utf8").toString("base64")}`;
        svgMaisRecente = this._svgTexto;
        svgsSerializados.push(this._svgTexto);
      }
    }
  };

  // localStorage utilizável (o jsdom já tem um, mas queremos inspecioná-lo)
  const armazenamento = new Map();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() { return armazenamento.size; },
      key: (i) => [...armazenamento.keys()][i] ?? null,
      getItem: (k) => (armazenamento.has(k) ? armazenamento.get(k) : null),
      setItem: (k, v) => { armazenamento.set(k, String(v)); },
      removeItem: (k) => { armazenamento.delete(k); },
    },
  });
  window.indexedDB = undefined;
  window.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
  window.initLayout = () => {};

  global.window = window;
  global.document = window.document;
  global.navigator = window.navigator;

  // Imagem de produto: quadrado vermelho com faixa branca (dá pra ver a edição).
  const produtoPng = await sharp({ create: { width: 900, height: 900, channels: 4, background: { r: 210, g: 40, b: 40, alpha: 1 } } })
    .composite([{
      input: await sharp({ create: { width: 900, height: 120, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer(),
      left: 0, top: 390,
    }])
    .png().toBuffer();
  const produtoDataUrl = `data:image/png;base64,${produtoPng.toString("base64")}`;

  // Projeto V1 legado no localStorage
  armazenamento.set(STORAGE_KEY, JSON.stringify({
    version: 1,
    templateId: "portable-charger-complete-v1",
    clienteNome: "Cliente Headless",
    marcaNome: "HEADLESS",
    palette: { primary: "#123047", secondary: "#ef6f55", background: "#f4efe5", text: "#12202b" },
    product: { name: "Produto Headless", imageDataUrl: produtoDataUrl, fileName: "produto.png", scale: 100, x: 50, y: 50 },
    content: {},
    view: "editor",
  }));

  window.eval(fs.readFileSync(FABRIC, "utf8"));
  ["design-image-model.js", "design-image-storage.js", "design-image-api.js", "design-image-editor.js", "design-templates.js"]
    .forEach((f) => window.eval(fs.readFileSync(path.join(PORTAL, f), "utf8")));

  await esperar(400);

  const byId = (id) => window.document.getElementById(id);
  const disparar = (id, evento) => byId(id).dispatchEvent(new window.Event(evento, { bubbles: true }));

  ok("a tela abriu o projeto V1 migrado", byId("dt-product-name").value === "Produto Headless");
  ok("o localStorage do projeto não guarda base64", !armazenamento.get(STORAGE_KEY).includes("data:image"));
  ok("o botão Editar imagem está habilitado", byId("dt-edit-product").disabled === false);

  const svgAntes = byId("dt-main-preview").innerHTML;
  ok("a peça principal já usa a imagem do produto", svgAntes.includes(produtoDataUrl.slice(0, 60)));

  /* ── abre o editor real, edita e aplica ─────────────────────────────── */

  disparar("dt-edit-product", "click");
  await esperar(900);
  ok("o editor de imagem abriu a partir da tela", byId("die-overlay").classList.contains("is-open"));

  disparar("die-rotate-right", "click");
  byId("die-saturation").value = "-100";
  disparar("die-saturation", "change");
  byId("die-bg-color-input").value = "#00ff00";
  disparar("die-bg-color", "click");
  await esperar(400);
  disparar("die-apply", "click");
  await esperar(600);

  ok("o editor fechou depois de aplicar", byId("die-overlay").classList.contains("is-open") === false);
  ok("a tela avisa que existe edição aplicada", byId("dt-product-edit-note").hidden === false);

  const svgDepois = byId("dt-main-preview").innerHTML;
  ok("a peça deixou de usar a imagem original", !svgDepois.includes(produtoDataUrl.slice(0, 60)));
  ok("a peça passou a usar uma imagem editada (JPEG, fundo sólido)", svgDepois.includes("data:image/jpeg;base64,"));

  const salvo = JSON.parse(armazenamento.get(STORAGE_KEY));
  ok("o projeto salvo guarda a original e a editada com ids distintos",
    salvo.product.originalImage.id && salvo.product.editedImage.id && salvo.product.originalImage.id !== salvo.product.editedImage.id);
  ok("os parâmetros da edição foram persistidos", salvo.product.editing.rotation === 90 && salvo.product.editing.saturation === -100);
  ok("o localStorage segue sem base64 depois da edição", !armazenamento.get(STORAGE_KEY).includes("data:image"));

  const miniaturas = byId("dt-thumbnails").querySelectorAll(".dt-thumbnail");
  ok("as 7 miniaturas continuam sendo renderizadas", miniaturas.length === 7);


  /* ── exporta as 7 peças em PNG ──────────────────────────────────────── */

  // captura o que a tela reclama durante a exportação
  const pilha = byId("dt-toast-stack");
  const lerToasts = () => [...pilha.children].map((t) => t.textContent).join(" | ");
  const exportadas = [];
  for (let indice = 0; indice < 7; indice += 1) {
    miniaturas[indice].dispatchEvent(new window.Event("click", { bubbles: true }));
    await esperar(60);
    disparar("dt-download-page", "click");
    await esperar(500);

    const pngBlob = [...blobsPorUrl.values()].find((b) => String(b.type || "").includes("png"));
    if (!pngBlob) { exportadas.push(null); continue; }
    const buffer = await paraBuffer(pngBlob);
    blobsPorUrl.clear();
    exportadas.push(buffer);
  }

  const validas = exportadas.filter(Boolean);
  ok(`as 7 peças geraram PNG (${validas.length}/7)`, validas.length === 7);

  for (let indice = 0; indice < validas.length; indice += 1) {
    const meta = await sharp(validas[indice]).metadata();
    ok(`peça ${indice + 1} exportou 1200x1200 (${meta.width}x${meta.height})`, meta.width === 1200 && meta.height === 1200);
  }

  if (validas.length) {
    const stats = await sharp(validas[0]).stats();
    ok(`a peça 1 tem conteúdo desenhado (desvio de cor ${stats.channels[0].stdev.toFixed(1)})`, stats.channels[0].stdev > 5);
    // O librsvg do node-canvas não embute <image href="data:..."> (browsers
    // embutem). Então a checagem da imagem editada é feita no SVG serializado,
    // que é o que o navegador recebe.
    // O librsvg do node-canvas não embute <image href="data:..."> (browsers
    // embutem). Então a checagem da imagem editada é feita no SVG serializado,
    // que é exatamente o que o navegador recebe para rasterizar.
    const comProduto = svgsSerializados.filter((svg) => svg.includes("data:image/jpeg;base64,"));
    ok(`6 das 7 peças serializadas carregam a imagem editada (${comProduto.length}/7; "Compra segura" não usa o produto)`,
      comProduto.length === 6);
    ok("todo SVG serializado tem um único xmlns (XML válido)",
      svgsSerializados.every((svg) => (svg.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g) || []).length === 1));
    fs.writeFileSync(path.join(__dirname, "peca-01.png"), validas[0]);
  }

  /* ── restaurar original e reexportar ────────────────────────────────── */

  byId("dt-thumbnails").querySelectorAll(".dt-thumbnail")[0].dispatchEvent(new window.Event("click", { bubbles: true }));
  await esperar(80);
  disparar("dt-restore-product", "click");
  await esperar(300);
  {
    const dump = JSON.parse(armazenamento.get(STORAGE_KEY));
  }
  ok("restaurar volta a usar a imagem original nas peças",
    byId("dt-main-preview").innerHTML.includes(produtoDataUrl.slice(0, 60)));
  ok("restaurar esconde o aviso de edição aplicada", byId("dt-product-edit-note").hidden === true);

  blobsPorUrl.clear();
  disparar("dt-download-page", "click");
  await esperar(500);
  const pngRestaurado = [...blobsPorUrl.values()].find((b) => String(b.type || "").includes("png"));
  ok("a exportação continua funcionando depois de restaurar", Boolean(pngRestaurado));
  if (pngRestaurado) {
    const meta = await sharp(await paraBuffer(pngRestaurado)).metadata();
    ok(`a peça restaurada também sai 1200x1200 (${meta.width}x${meta.height})`, meta.width === 1200 && meta.height === 1200);
  }

  console.log(`\n${checks - falhas.length}/${checks} verificações headless da tela passaram.`);
  if (falhas.length) {
    console.log("FALHAS:\n - " + falhas.join("\n - "));
    process.exit(1);
  }
})().catch((e) => { console.error("ERRO:", e); process.exit(1); });
