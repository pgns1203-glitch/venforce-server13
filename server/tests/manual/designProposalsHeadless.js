// designProposalsHeadless.js
// -----------------------------------------------------------------------------
// Verificação MANUAL do gerador de propostas (não roda no `npm test`).
//
// Sobe a tela INTEIRA (design-templates.html + todos os scripts) num DOM jsdom
// com node-canvas e percorre o roteiro de aceite visual da Fase 4:
// novo projeto abre em "Gerar propostas", o formulário começa sem dado
// fictício, preencher gera três opções visualmente diferentes, Visualizar não
// altera o projeto, "Usar esta proposta" abre o editor manual, salvar coloca o
// template na Biblioteca, reabrir recupera os layouts e exportar gera PNG.
//
// Depende de pacotes que NÃO são dependência do projeto — instale fora do repo:
//
//   mkdir -p /tmp/vf-headless && cd /tmp/vf-headless
//   npm init -y && npm install canvas@3.2.0 jsdom@26.1.0 fabric@6.9.1
//   cp <repo>/server/tests/manual/designProposalsHeadless.js .
//   node designProposalsHeadless.js
//
// As capturas saem em ./capturas-propostas/<direcao>/*.png.
// -----------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const { Image: NodeImage } = require("canvas");
const sharp = require(process.env.VF_SHARP || "/home/user/Documentos/venforce_scanner_x1/server/node_modules/sharp");

const PORTAL = process.env.VF_PORTAL || "/home/user/Documentos/venforce_scanner_x1/Portal";
const FABRIC = path.join(__dirname, "node_modules", "fabric", "dist", "index.min.js");
const SAIDA = path.join(__dirname, "capturas-propostas");

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
  for (const chave of Object.getOwnPropertySymbols(blob)) {
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

  let pngsGerados = [];
  const blobsPorUrl = new Map();
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

  const BlobOriginal = window.Blob;
  window.Blob = class extends BlobOriginal {
    constructor(partes, opcoes) {
      super(partes, opcoes);
      if (opcoes && String(opcoes.type || "").includes("svg")) {
        this._svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(String(partes[0]), "utf8").toString("base64")}`;
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
  const cards = () => [...byId("dtg-proposals").querySelectorAll(".dtg-card")];
  const preencher = (id, valor) => {
    byId(id).value = valor;
    disparar(id, "input");
  };

  async function capturar(pasta, nome, svg) {
    if (!svg) return null;
    const texto = new window.XMLSerializer().serializeToString(svg);
    const destino = path.join(SAIDA, pasta);
    fs.mkdirSync(destino, { recursive: true });
    const png = await sharp(Buffer.from(texto, "utf8"), { density: 96 }).resize(1200, 1200).png().toBuffer();
    fs.writeFileSync(path.join(destino, `${nome}.png`), png);
    return sharp(png).stats();
  }

  console.log("\n=== Roteiro de aceite visual — Gerador de propostas ===\n");

  /* 1. Novo projeto abre em "Gerar propostas" */
  disparar("dt-library-tab", "click");
  disparar("dt-new-project", "click");
  await esperar(200);
  ok("1. “Novo projeto” abre o Construtor", visivel("dt-builder-view"));
  ok("1b. o modo padrão é “Gerar propostas”",
    visivel("dtb-generate-view") && byId("dtb-manual-view").hidden === true);
  ok("1c. o seletor de modo mostra as duas opções",
    byId("dtb-mode-generate").textContent.trim() === "Gerar propostas"
    && byId("dtb-mode-manual").textContent.trim() === "Montar manualmente");
  ok("1d. “Gerar propostas” vem marcado", byId("dtb-mode-generate").getAttribute("aria-pressed") === "true");

  /* 2. Formulário inicia sem dados comerciais fictícios */
  const CAMPOS = ["dtg-project-name", "dtg-brand-name", "dtg-product-name", "dtg-product-subtitle",
    "dtg-main-benefit", "dtg-benefit-1", "dtg-benefit-2", "dtg-benefit-3",
    "dtg-specs", "dtg-package", "dtg-width", "dtg-height", "dtg-depth", "dtg-warranty", "dtg-shipping"];
  ok("2. o formulário inicia inteiramente vazio", CAMPOS.every((id) => byId(id).value === ""));
  ok("2b. as sugestões vivem como placeholder, não como valor",
    byId("dtg-specs").getAttribute("placeholder").includes("Potência")
    && byId("dtg-specs").value === "");
  ok("2c. nenhuma proposta antes de gerar", cards().length === 0 && visivel("dtg-empty"));

  /* 3. Preencher um produto gera três opções */
  preencher("dtg-project-name", "Carrossel da Lavadora");
  preencher("dtg-brand-name", "AQUAFORCE");
  preencher("dtg-product-name", "Lavadora de Alta Pressão");
  preencher("dtg-product-subtitle", "Limpeza profunda para calçada, carro e fachada.");
  preencher("dtg-main-benefit", "2000 PSI de pressão para a sujeira mais difícil.");
  preencher("dtg-benefit-1", "Motor de indução silencioso");
  preencher("dtg-benefit-2", "Mangueira de 8 metros com engate");
  preencher("dtg-benefit-3", "Bico regulável de 0° a 40°");
  preencher("dtg-specs", "Potência: 1800 W\nPressão: 2000 PSI\nVazão: 420 L/h\nTensão: 220 V");
  preencher("dtg-package", "1 lavadora de alta pressão\n1 pistola com gatilho\n1 mangueira de 8 m");
  preencher("dtg-width", "32 cm");
  preencher("dtg-height", "78 cm");
  preencher("dtg-depth", "29 cm");
  byId("dtg-segment").value = "Ferramentas";
  disparar("dtg-segment", "change");
  await esperar(200);

  disparar("dtg-generate", "click");
  await esperar(500);

  ok("3. clicar em “Gerar 3 propostas” produz três cards", cards().length === 3);
  ok("3b. o estado vazio some", byId("dtg-empty").hidden === true);
  const titulos = cards().map((c) => c.querySelector(".dtg-card__title").textContent);
  ok(`3c. as três direções aparecem (${titulos.join(" · ")})`,
    titulos.join("|") === "Industrial limpo|Técnico moderno|Comercial de impacto");
  ok("3d. cada card informa a quantidade de páginas",
    cards().every((c) => /5 páginas/.test(c.querySelector(".dtg-card__count").textContent)));
  ok("3e. cada card traz descrição, paleta e lista de layouts",
    cards().every((c) => c.querySelector(".dtg-card__description")
      && c.querySelectorAll(".dtg-card__swatch").length === 4
      && c.querySelectorAll(".dtg-card__layouts li").length === 5));

  /* 4. As três opções são visualmente diferentes */
  const layoutsPorCard = cards().map((c) =>
    [...c.querySelectorAll(".dtg-card__layouts code")].map((n) => n.textContent).join(","));
  ok("4. os rendererIds diferem entre as três propostas",
    new Set(layoutsPorCard).size === 3
    && new Set(layoutsPorCard.join(",").split(",")).size === 15);
  layoutsPorCard.forEach((l, i) => console.log(`      ${titulos[i]}: ${l}`));

  const paletas = cards().map((c) =>
    [...c.querySelectorAll(".dtg-card__swatch")].map((s) => s.style.background).join("|"));
  ok("4b. as paletas também diferem", new Set(paletas).size === 3);

  /* 5. Cada opção possui várias páginas quando há dados */
  ok("5. cada card mostra cinco miniaturas renderizadas",
    cards().every((c) => c.querySelectorAll(".dtg-thumb svg").length === 5));

  // captura as 15 artes das três propostas
  const nomesDeDirecao = ["industrial-limpo", "tecnico-moderno", "comercial-impacto"];
  for (let indice = 0; indice < cards().length; indice += 1) {
    const miniaturas = [...cards()[indice].querySelectorAll(".dtg-thumb svg")];
    for (let pagina = 0; pagina < miniaturas.length; pagina += 1) {
      // eslint-disable-next-line no-await-in-loop
      await capturar(nomesDeDirecao[indice], `${pagina + 1}`, miniaturas[pagina]);
    }
  }
  ok("5b. as 15 artes foram rasterizadas para conferência",
    nomesDeDirecao.every((d) => fs.readdirSync(path.join(SAIDA, d)).length === 5));

  /* 6. Visualizar não altera o projeto */
  const rascunhoAntes = armazenamento.get(DRAFT_KEY);
  cards()[1].querySelectorAll(".dtg-card__actions .vf-btn")[0]
    .dispatchEvent(new window.Event("click", { bubbles: true }));
  await esperar(300);
  ok("6. “Visualizar” abre a prévia maior",
    byId("dtg-preview-overlay").classList.contains("is-open"));
  ok("6b. a prévia mostra a arte renderizada", Boolean(byId("dtg-preview-canvas").querySelector("svg")));
  ok("6c. a prévia permite navegar por todas as páginas",
    byId("dtg-preview-thumbs").querySelectorAll(".dtg-thumb").length === 5);
  disparar("dtg-preview-next", "click");
  await esperar(120);
  ok("6d. “Próxima” avança a página", /PÁGINA 02 DE 05/.test(byId("dtg-preview-page").textContent));
  ok("6e. visualizar NÃO alterou o projeto atual", armazenamento.get(DRAFT_KEY) === rascunhoAntes);
  ok("6f. o construtor continua no modo de geração", visivel("dtb-generate-view"));

  /* 7. Usar esta proposta abre o editor manual */
  disparar("dtg-preview-use", "click");
  await esperar(500);
  ok("7. “Usar esta proposta” fecha a prévia",
    byId("dtg-preview-overlay").classList.contains("is-open") === false);
  ok("7b. o editor manual abre", visivel("dtb-manual-view") && byId("dtb-generate-view").hidden === true);
  ok("7c. as cinco páginas foram transferidas",
    byId("dtb-thumbnails").querySelectorAll(".dtb-thumbnail").length === 5);
  ok("7d. os textos vieram junto, sem redigitar",
    byId("dtb-product-name").value === "Lavadora de Alta Pressão"
    && byId("dtb-project-name").value === "Carrossel da Lavadora"
    && byId("dtb-specs").value.includes("2000 PSI"));
  const rotulosManuais = [...byId("dtb-thumbnails").querySelectorAll(".dt-thumbnail__label")].map((n) => n.textContent);
  ok(`7e. os layouts são os da direção escolhida (${rotulosManuais[0]})`,
    /Capa centralizada/.test(rotulosManuais[0]));
  ok("7f. o carrossel continua editável", Boolean(byId("dtb-main-preview").querySelector("svg")));

  // Trocar a variação de uma página à mão. A lista é remontada a cada troca,
  // então o <select> precisa ser buscado de novo — a referência antiga sai
  // do DOM e o listener dela não é mais o que a tela usa.
  ok("7g. cada página oferece as três composições da família",
    byId("dtb-variant-cover") && byId("dtb-variant-cover").querySelectorAll("option").length === 3);

  async function trocarComposicao(familia, rendererId) {
    const select = byId(`dtb-variant-${familia}`);
    select.value = rendererId;
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
    await esperar(250);
  }

  await trocarComposicao("cover", "cover-impact-v1");
  ok("7h. trocar a composição muda a arte na hora",
    /Capa de impacto/.test(byId("dtb-thumbnails").querySelector(".dt-thumbnail__label").textContent));
  await trocarComposicao("cover", "cover-centered-v1");
  ok("7i. voltar para a composição anterior também funciona",
    /Capa centralizada/.test(byId("dtb-thumbnails").querySelector(".dt-thumbnail__label").textContent));

  /* 8. Salvar coloca o template na Biblioteca */
  disparar("dtb-save-template", "click");
  await esperar(300);
  const locais = () => [...byId("dt-local-template-grid").querySelectorAll(".dtb-card")];
  ok("8. salvar coloca o template na Biblioteca", locais().length === 1);
  ok("8b. o card é rotulado como “Template gerado”",
    locais()[0].textContent.includes("Template gerado"));
  ok("8c. o card mostra a direção visual", locais()[0].textContent.includes("Técnico moderno"));
  ok("8d. o template do sistema continua na outra grade",
    byId("dt-template-grid").querySelectorAll(".dt-template-card").length === 1);
  ok("8e. o localStorage não recebeu base64",
    !String(armazenamento.get(LIBRARY_KEY)).includes("data:image"));
  ok("8f. a chave do editor antigo continua separada",
    armazenamento.get(LIBRARY_KEY) !== armazenamento.get("vf-design-template-studio-v1"));

  const registro = JSON.parse(armazenamento.get(LIBRARY_KEY)).templates[0];
  ok("8g. o registro guarda direção, layout e ordem de cada página",
    registro.direction === "tecnico-moderno"
    && registro.pages.map((p) => p.rendererId).join() === "cover-centered-v1,benefits-side-list-v1,specifications-table-v1,package-grid-v1,dimensions-panel-v1");

  /* 9. Reabrir recupera os layouts corretos */
  disparar("dt-library-tab", "click");
  await esperar(150);
  preencher("dtb-project-name", "Rascunho descartável");
  await esperar(300);
  locais()[0].querySelectorAll(".dtb-card__actions .vf-btn")[0]
    .dispatchEvent(new window.Event("click", { bubbles: true }));
  await esperar(400);
  ok("9. reabrir volta para o Construtor", visivel("dt-builder-view") && visivel("dtb-manual-view"));
  ok("9b. o nome do projeto foi recuperado", byId("dtb-project-name").value === "Carrossel da Lavadora");
  const rotulosReabertos = [...byId("dtb-thumbnails").querySelectorAll(".dt-thumbnail__label")].map((n) => n.textContent);
  ok(`9c. os layouts corretos foram recuperados (${rotulosReabertos.length} páginas)`,
    /Capa centralizada/.test(rotulosReabertos[0]) && /Painel de medidas/.test(rotulosReabertos[4]));
  ok("9d. os benefícios foram recuperados", byId("dtb-benefit-1").value.includes("indução"));

  /* 10. Exportação gera PNG */
  pngsGerados = [];
  disparar("dtb-download-page", "click");
  await esperar(800);
  ok("10. baixar a página atual gera um PNG", pngsGerados.length >= 1);
  if (pngsGerados.length) {
    const meta = await sharp(await paraBuffer(pngsGerados[0])).metadata();
    ok(`10b. o PNG sai em 1200 × 1200 (${meta.width} × ${meta.height})`,
      meta.width === 1200 && meta.height === 1200);
    fs.writeFileSync(path.join(SAIDA, "exportada.png"), await paraBuffer(pngsGerados[0]));
  }

  pngsGerados = [];
  disparar("dtb-download-all", "click");
  await esperar(3200);
  ok(`10c. baixar todas gera um PNG por página (${pngsGerados.length}/5)`, pngsGerados.length === 5);

  /* 11. "Gerar outras opções" e o editor antigo */
  disparar("dtb-mode-generate", "click");
  await esperar(200);
  const antesDaRotacao = [...cards()[0].querySelectorAll(".dtg-card__layouts code")].map((n) => n.textContent).join();
  disparar("dtg-regenerate", "click");
  await esperar(500);
  ok("11. “Gerar outras opções” mantém três propostas", cards().length === 3);
  const depoisDaRotacao = [...cards()[0].querySelectorAll(".dtg-card__layouts code")].map((n) => n.textContent).join();
  ok("11b. as combinações de layout mudaram", antesDaRotacao !== depoisDaRotacao);
  console.log(`      antes:  ${antesDaRotacao}`);
  console.log(`      depois: ${depoisDaRotacao}`);
  ok("11c. as três continuam sem repetir rendererId", (() => {
    const todos = cards().flatMap((c) =>
      [...c.querySelectorAll(".dtg-card__layouts code")].map((n) => n.textContent));
    return new Set(todos).size === todos.length;
  })());

  disparar("dt-editor-tab", "click");
  await esperar(200);
  ok("12. o Editor antigo continua inteiro", visivel("dt-editor-view")
    && byId("dt-thumbnails").querySelectorAll(".dt-thumbnail").length === 7);
  ok("12b. os campos do editor antigo seguem preenchidos",
    byId("dt-product-name").value === "Power Station One");

  console.log(`\n${checks - falhas.length}/${checks} verificações do roteiro visual passaram.`);
  console.log(`Capturas em: ${SAIDA}`);
  if (falhas.length) {
    console.log("FALHAS:\n - " + falhas.join("\n - "));
    process.exit(1);
  }
})().catch((e) => { console.error("ERRO:", e); process.exit(1); });
