// designBuilderHeadless.js
// -----------------------------------------------------------------------------
// Verificação MANUAL do Construtor Modular (não roda no `npm test`).
//
// Sobe a tela INTEIRA (design-templates.html + todos os scripts) num DOM jsdom
// com node-canvas e percorre, na ordem, o roteiro de aceite visual da Fase 3:
// a aba aparece, abre, a cor muda a prévia, o nome muda a arte, incluir/remover
// página muda as miniaturas, a ordem muda a sequência, salvar cria um card na
// Biblioteca, reabrir recupera os dados e baixar gera PNG 1200 × 1200.
//
// Depende de pacotes que NÃO são dependência do projeto — instale fora do repo:
//
//   mkdir -p /tmp/vf-headless && cd /tmp/vf-headless
//   npm init -y && npm install canvas@3.2.0 jsdom@26.1.0 fabric@6.9.1
//   cp <repo>/server/tests/manual/designBuilderHeadless.js .
//   node designBuilderHeadless.js
//
// As capturas saem em ./capturas-construtor/*.png.
// -----------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { Image: NodeImage } = require("canvas");
const sharp = require(process.env.VF_SHARP || "/home/user/Documentos/venforce_scanner_x1/server/node_modules/sharp");

const PORTAL = process.env.VF_PORTAL || "/home/user/Documentos/venforce_scanner_x1/Portal";
const FABRIC = path.join(__dirname, "node_modules", "fabric", "dist", "index.min.js");
const SAIDA = path.join(__dirname, "capturas-construtor");

const LIBRARY_KEY = "vf-design-template-library-v1";
const DRAFT_KEY = "vf-design-template-builder-draft-v1";

let checks = 0;
const falhas = [];
function ok(label, cond) {
  checks += 1;
  if (cond) console.log(`  ok  ${label}`);
  else { falhas.push(label); console.log(`  XX  ${label}`); }
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function paraBuffer(blob) {
  if (Buffer.isBuffer(blob)) return blob;
  if (typeof blob.arrayBuffer === "function") return Buffer.from(await blob.arrayBuffer());
  const chaves = Object.getOwnPropertySymbols(blob);
  for (const chave of chaves) {
    const alvo = blob[chave];
    if (alvo && alvo._buffer) return Buffer.from(alvo._buffer);
  }
  throw new Error("não sei converter esse blob");
}

(async () => {
  fs.mkdirSync(SAIDA, { recursive: true });

  const html = fs.readFileSync(path.join(PORTAL, "design-templates.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://portal.local/" });
  const { window } = dom;

  const createElementOriginal = window.document.createElement.bind(window.document);
  window.document.createElement = (tag, ...resto) => {
    if (String(tag).toLowerCase() === "img") return new NodeImage();
    return createElementOriginal(tag, ...resto);
  };
  window.Image = NodeImage;

  const blobsPorUrl = new Map();
  // Registro paralelo dos PNGs: downloadBlob revoga o Object URL depois de 1 s,
  // e sem isto o harness perderia o arquivo antes de conferi-lo.
  let pngsGerados = [];
  let contadorUrl = 0;
  window.URL.createObjectURL = (blob) => {
    contadorUrl += 1;
    const chave = `objurl-${contadorUrl}`;
    blobsPorUrl.set(chave, blob);
    if (String(blob.type || "").includes("png")) pngsGerados.push(blob);
    if (String(blob.type || "").includes("svg")) return blob._svgDataUrl || chave;
    return chave;
  };
  window.URL.revokeObjectURL = (url) => { blobsPorUrl.delete(url); };

  const svgsSerializados = [];
  const BlobOriginal = window.Blob;
  window.Blob = class extends BlobOriginal {
    constructor(partes, opcoes) {
      super(partes, opcoes);
      if (opcoes && String(opcoes.type || "").includes("svg")) {
        this._svgTexto = String(partes[0]);
        this._svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(String(partes[0]), "utf8").toString("base64")}`;
        svgsSerializados.push(this._svgTexto);
      }
    }
  };

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

  window.eval(fs.readFileSync(FABRIC, "utf8"));
  [
    "design-image-model.js", "design-image-storage.js", "design-image-api.js", "design-image-editor.js",
    "design-template-engine.js", "design-template-presets.js", "design-template-components.js",
    "design-template-layouts.js", "design-template-renderer.js",
    "design-template-builder-model.js", "design-template-builder-storage.js",
    "design-template-proposal-generator.js",
    "design-templates.js", "design-template-builder.js",
  ].forEach((f) => window.eval(fs.readFileSync(path.join(PORTAL, f), "utf8")));

  await esperar(400);

  const byId = (id) => window.document.getElementById(id);
  const disparar = (id, evento) => byId(id).dispatchEvent(new window.Event(evento, { bubbles: true }));
  const visivel = (id) => byId(id).hidden === false;
  const miniaturas = () => [...byId("dtb-thumbnails").querySelectorAll(".dtb-thumbnail")];
  const rotulos = () => miniaturas().map((b) => b.querySelector(".dt-thumbnail__label").textContent);
  const previa = () => byId("dtb-main-preview").innerHTML;

  // Rasteriza o SVG da prévia para conferir a arte de verdade, não só o texto.
  async function capturar(nome) {
    const svg = byId("dtb-main-preview").querySelector("svg");
    if (!svg) return null;
    const texto = new window.XMLSerializer().serializeToString(svg);
    const png = await sharp(Buffer.from(texto, "utf8"), { density: 96 }).resize(1200, 1200).png().toBuffer();
    fs.writeFileSync(path.join(SAIDA, `${nome}.png`), png);
    return sharp(png).stats();
  }

  console.log("\n=== Roteiro de aceite visual — Construtor Modular ===\n");

  /* 1. aparece a aba Construtor */
  const aba = byId("dt-builder-tab");
  ok("1. a aba Construtor existe na tela", Boolean(aba) && aba.textContent.trim() === "Construtor");
  ok("1b. as três áreas estão no mesmo tablist",
    byId("dt-library-tab").parentNode === aba.parentNode && byId("dt-editor-tab").parentNode === aba.parentNode);
  ok("1c. a aba começa não selecionada", aba.getAttribute("aria-selected") === "false");

  /* 2. clicar abre uma interface nova */
  ok("2pre. o construtor começa escondido", byId("dt-builder-view").hidden === true);
  disparar("dt-builder-tab", "click");
  await esperar(150);
  ok("2. clicar na aba deixa o Construtor VISÍVEL", visivel("dt-builder-view"));
  ok("2b. a biblioteca e o editor somem",
    byId("dt-library-view").hidden === true && byId("dt-editor-view").hidden === true);
  ok("2c. o título “Criar carrossel modular” está na tela",
    byId("dtb-title").textContent.length > 0);
  ok("2d. a descrição pedida aparece",
    window.document.querySelector(".dtb-intro").textContent.includes("Escolha a identidade"));

  // A partir da Fase 4 o Construtor abre no modo de GERAÇÃO. Este roteiro
  // exercita o editor manual, então troca de modo antes de continuar.
  ok("2d2. o modo padrão é “Gerar propostas”",
    byId("dtb-generate-view").hidden === false && byId("dtb-manual-view").hidden === true);
  disparar("dtb-mode-manual", "click");
  await esperar(200);
  ok("2d3. “Montar manualmente” abre o editor manual", byId("dtb-manual-view").hidden === false);

  // O projeto novo nasce vazio (nada de conteúdo comercial fictício), então
  // este roteiro preenche o produto antes de conferir a arte.
  byId("dtb-product-name").value = "Produto de teste";
  disparar("dtb-product-name", "input");
  await esperar(400);
  ok("2e. a prévia desenhou uma página", Boolean(byId("dtb-main-preview").querySelector("svg")));
  ok("2f. as cinco miniaturas apareceram", miniaturas().length === 5);
  ok("2g. a lista de seleção de páginas foi montada",
    byId("dtb-pages-list").querySelectorAll(".dtb-page").length === 5);
  ok("2h. as ações do construtor entraram no cabeçalho", visivel("dt-builder-header-actions"));

  const statsInicial = await capturar("01-abertura");
  ok("2i. a prévia rasteriza com conteúdo desenhado (desvio de cor)",
    Boolean(statsInicial) && (await statsInicial).channels[0].stdev > 5);

  /* 3. alterar cor muda a prévia */
  const antesDaCor = previa();
  byId("dtb-color-primary").value = "#7a1f5c";
  disparar("dtb-color-primary", "input");
  await esperar(80);
  ok("3. alterar a cor principal muda a prévia na hora", previa() !== antesDaCor);
  ok("3b. a cor escolhida chega na arte", previa().includes("#7a1f5c"));
  await capturar("02-cor-alterada");

  /* 4. editar o nome muda a arte */
  byId("dtb-product-name").value = "Lavadora de Alta Pressão";
  disparar("dtb-product-name", "input");
  await esperar(400);
  ok("4. editar o nome do produto muda a arte", previa().includes("Lavadora"));
  byId("dtb-project-name").value = "Carrossel Lavadora 2026";
  disparar("dtb-project-name", "input");
  await esperar(400);
  ok("4b. o nome do projeto aparece no cabeçalho do construtor",
    byId("dtb-title").textContent === "Carrossel Lavadora 2026");
  await capturar("03-nome-alterado");

  /* 5. incluir benefícios cria conteúdo na página de benefícios */
  const paginaDeBeneficios = miniaturas().findIndex((b) => /cards/i.test(b.textContent));
  ok("5pre. a página de benefícios está no carrossel", paginaDeBeneficios >= 0);
  miniaturas()[paginaDeBeneficios].dispatchEvent(new window.Event("click", { bubbles: true }));
  await esperar(80);
  byId("dtb-benefit-1").value = "Pressão de 2000 PSI para sujeira pesada";
  disparar("dtb-benefit-1", "input");
  byId("dtb-benefit-2").value = "Mangueira de 8 metros com engate rápido";
  disparar("dtb-benefit-2", "input");
  byId("dtb-benefit-3").value = "";
  disparar("dtb-benefit-3", "input");
  await esperar(400);
  ok("5. os benefícios preenchidos aparecem na página", previa().includes("2000 PSI"));
  ok("5b. o benefício vazio não vira card fantasma",
    (previa().match(/<rect[^>]*rx="10"/g) || []).length <= 3);
  await capturar("04-beneficios");

  /* 6. remover uma página remove a miniatura */
  const antesDeRemover = miniaturas().length;
  const caixa = byId("dtb-page-specifications");
  caixa.checked = false;
  caixa.dispatchEvent(new window.Event("change", { bubbles: true }));
  await esperar(150);
  ok("6. desmarcar a página remove a miniatura", miniaturas().length === antesDeRemover - 1);
  ok("6b. a página some da sequência", !rotulos().some((r) => /Especificações/.test(r)));

  caixa.checked = true;
  caixa.dispatchEvent(new window.Event("change", { bubbles: true }));
  await esperar(150);
  ok("6c. marcar de volta devolve a miniatura", miniaturas().length === antesDeRemover);
  ok("6c2. a página voltou na mesma composição", rotulos().some((r) => /Grade/.test(r)));

  ok("6d. a capa não pode ser desmarcada",
    byId("dtb-page-cover").disabled === true);

  /* 7. alterar a ordem muda a sequência */
  const ordemAntes = rotulos().join(" | ");
  // O rótulo mostra o nome da VARIAÇÃO ("Cotas técnicas"), então a busca é
  // pelo id da família na caixa de seleção.
  const itemDimensoes = [...byId("dtb-pages-list").querySelectorAll(".dtb-page")]
    .find((li) => li.querySelector("#dtb-page-dimensions"));
  itemDimensoes.querySelectorAll(".dtb-page__moves .vf-btn")[0]
    .dispatchEvent(new window.Event("click", { bubbles: true }));
  await esperar(150);
  const ordemDepois = rotulos().join(" | ");
  ok("7. subir uma página muda a sequência da prévia", ordemAntes !== ordemDepois);
  ok("7b. a capa continua sendo a página 01", /Capa dividida/.test(rotulos()[0]));
  console.log(`      antes:  ${ordemAntes}`);
  console.log(`      depois: ${ordemDepois}`);

  /* 8. salvar como template cria um card na Biblioteca */
  disparar("dtb-save-template", "click");
  await esperar(200);
  const cards = () => [...byId("dt-local-template-grid").querySelectorAll(".dtb-card")];
  ok("8. salvar como template cria um card na Biblioteca", cards().length === 1);
  ok("8b. o card mostra o nome do projeto", cards()[0].textContent.includes("Carrossel Lavadora 2026"));
  ok("8c. o card se identifica como criado manualmente",
    cards()[0].textContent.includes("Template criado manualmente"));
  ok("8d. o card traz segmento, estilo, páginas e data",
    /Segmento:/.test(cards()[0].textContent) && /Estilo:/.test(cards()[0].textContent)
    && /Páginas:/.test(cards()[0].textContent) && /Atualizado:/.test(cards()[0].textContent));
  ok("8e. o template do sistema continua na outra grade",
    byId("dt-template-grid").querySelectorAll(".dt-template-card").length === 1);
  ok("8f. a chave nova do localStorage recebeu o template",
    Boolean(armazenamento.get(LIBRARY_KEY)) && JSON.parse(armazenamento.get(LIBRARY_KEY)).templates.length === 1);
  ok("8g. a chave do editor antigo continua separada e intacta",
    armazenamento.get(LIBRARY_KEY) !== armazenamento.get("vf-design-template-studio-v1"));
  ok("8h. o localStorage não recebeu base64",
    !String(armazenamento.get(LIBRARY_KEY)).includes("data:image")
    && !String(armazenamento.get(DRAFT_KEY)).includes("data:image"));

  /* 9. reabrir o card recupera os dados */
  byId("dtb-project-name").value = "Rascunho para descartar";
  disparar("dtb-project-name", "input");
  await esperar(400);
  disparar("dt-library-tab", "click");
  await esperar(100);
  cards()[0].querySelectorAll(".dtb-card__actions .vf-btn")[0]
    .dispatchEvent(new window.Event("click", { bubbles: true }));
  await esperar(300);
  ok("9. reabrir o card volta para o Construtor", visivel("dt-builder-view"));
  ok("9b. o nome do projeto foi recuperado",
    byId("dtb-project-name").value === "Carrossel Lavadora 2026");
  ok("9c. o nome do produto foi recuperado",
    byId("dtb-product-name").value === "Lavadora de Alta Pressão");
  ok("9d. as cores foram recuperadas", byId("dtb-color-primary").value === "#7a1f5c");
  ok("9e. os benefícios foram recuperados",
    byId("dtb-benefit-1").value.includes("2000 PSI") && byId("dtb-benefit-2").value.includes("8 metros"));
  ok("9f. as páginas e a ordem foram recuperadas", rotulos().join(" | ") === ordemDepois);

  /* 9b. duplicar e excluir */
  disparar("dt-library-tab", "click");
  await esperar(100);
  cards()[0].querySelectorAll(".dtb-card__actions .vf-btn")[1]
    .dispatchEvent(new window.Event("click", { bubbles: true }));
  await esperar(150);
  ok("9g. duplicar cria um segundo card", cards().length === 2);
  const copia = cards().find((c) => /\(Cópia\)/.test(c.textContent));
  ok("9h. a cópia recebe “Cópia” no nome", Boolean(copia));
  copia.querySelectorAll(".dtb-card__actions .vf-btn")[2]
    .dispatchEvent(new window.Event("click", { bubbles: true }));
  await esperar(100);
  ok("9i. excluir pede confirmação", byId("dt-confirm-overlay").classList.contains("is-open"));
  disparar("dt-confirm-accept", "click");
  await esperar(200);
  ok("9j. confirmar remove a cópia", cards().length === 1);

  /* 10. baixar a página gera PNG */
  disparar("dt-builder-tab", "click");
  await esperar(200);
  pngsGerados = [];
  disparar("dtb-download-page", "click");
  await esperar(700);
  const pngBlob = pngsGerados[0];
  ok("10. baixar a página atual gera um PNG", Boolean(pngBlob));
  if (pngBlob) {
    const buffer = await paraBuffer(pngBlob);
    const meta = await sharp(buffer).metadata();
    ok(`10b. o PNG sai em 1200 × 1200 (${meta.width} × ${meta.height})`, meta.width === 1200 && meta.height === 1200);
    fs.writeFileSync(path.join(SAIDA, "05-exportada.png"), buffer);
  }

  pngsGerados = [];
  disparar("dtb-download-all", "click");
  await esperar(3000);
  ok(`10c. baixar todas gera um PNG por página (${pngsGerados.length}/5)`, pngsGerados.length === 5);
  for (let i = 0; i < pngsGerados.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const meta = await sharp(await paraBuffer(pngsGerados[i])).metadata();
    ok(`10c.${i + 1} a página ${i + 1} saiu em 1200 × 1200 (${meta.width} × ${meta.height})`,
      meta.width === 1200 && meta.height === 1200);
  }

  ok("10d. o PNG exportado NÃO carrega aviso de edição",
    !svgsSerializados.slice(-6).some((svg) => /um item por linha|Preencha as especificações/.test(svg)));
  ok("10e. todo SVG serializado tem um único xmlns (XML válido)",
    svgsSerializados.every((svg) => (svg.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g) || []).length === 1));

  /* 11. o Editor e o template antigos continuam inteiros */
  disparar("dt-editor-tab", "click");
  await esperar(200);
  ok("11. o Editor antigo continua abrindo", visivel("dt-editor-view"));
  ok("11b. o template do sistema continua com 7 peças",
    byId("dt-thumbnails").querySelectorAll(".dt-thumbnail").length === 7);
  ok("11c. a peça do editor antigo continua desenhando",
    byId("dt-main-preview").querySelector("svg") !== null);
  ok("11d. os campos do editor antigo seguem preenchidos",
    byId("dt-product-name").value === "Power Station One");

  console.log(`\n${checks - falhas.length}/${checks} verificações do roteiro visual passaram.`);
  console.log(`Capturas em: ${SAIDA}`);
  if (falhas.length) {
    console.log("FALHAS:\n - " + falhas.join("\n - "));
    process.exit(1);
  }
})().catch((e) => { console.error("ERRO:", e); process.exit(1); });
