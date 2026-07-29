// designImageEditorHeadless.js
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
//   node designImageEditorHeadless.js
//
// Ajuste as constantes PORTAL/FABRIC abaixo para os caminhos da sua máquina.
// -----------------------------------------------------------------------------

// Executa o editor de imagem de verdade (Fabric 6.9.1) num DOM jsdom com
// node-canvas, usando o HTML real da tela. Valida o que só aparece em runtime.

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const sharp = require(process.env.VF_SHARP || "/home/user/Documentos/venforce_scanner_x1/server/node_modules/sharp");

const PORTAL = process.env.VF_PORTAL || "/home/user/Documentos/venforce_scanner_x1/Portal";
const FABRIC = path.join(__dirname, "node_modules", "fabric", "dist", "index.min.js");

let checks = 0;
const falhas = [];
function ok(label, cond) {
  checks += 1;
  if (cond) console.log(`  ok  ${label}`);
  else { falhas.push(label); console.log(`  XX  ${label}`); }
}

(async () => {
  const html = fs.readFileSync(path.join(PORTAL, "design-templates.html"), "utf8");
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    url: "https://portal.local/",
  });
  const { window } = dom;

  // jsdom não decodifica <img src="data:...">. O Fabric cria a imagem via
  // document.createElement("img"), então trocamos por uma Image do node-canvas,
  // que decodifica data URL de verdade.
  const { Image: NodeImage } = require("canvas");
  const createElementOriginal = window.document.createElement.bind(window.document);
  window.document.createElement = (tag, ...resto) => {
    if (String(tag).toLowerCase() === "img") return new NodeImage();
    return createElementOriginal(tag, ...resto);
  };

  global.window = window;
  global.document = window.document;
  global.navigator = window.navigator;

  // Fabric UMD
  window.eval(fs.readFileSync(FABRIC, "utf8"));
  ok("fabric carregou e expôs a global", typeof window.fabric === "object" && !!window.fabric.Canvas);
  ok("fabric expõe FabricImage, filters, Shadow, Rect", !!(window.fabric.FabricImage && window.fabric.filters.Brightness && window.fabric.Shadow && window.fabric.Rect));

  // Módulos do editor
  ["design-image-model.js", "design-image-storage.js", "design-image-api.js", "design-image-editor.js"]
    .forEach((f) => window.eval(fs.readFileSync(path.join(PORTAL, f), "utf8")));
  ok("o editor se registrou em window.VFDesignImageEditor", typeof window.VFDesignImageEditor?.createDesignImageEditor === "function");

  // Imagem real: 800x400 com metade vermelha e metade azul (dá pra conferir flip).
  const esquerda = await sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 220, g: 30, b: 30, alpha: 1 } } }).png().toBuffer();
  const direita = await sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 30, g: 60, b: 220, alpha: 1 } } }).png().toBuffer();
  const composta = await sharp({ create: { width: 800, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: esquerda, left: 0, top: 0 }, { input: direita, left: 400, top: 0 }])
    .png().toBuffer();
  const dataUrl = `data:image/png;base64,${composta.toString("base64")}`;

  const toasts = [];
  const editor = window.VFDesignImageEditor.createDesignImageEditor({
    showToast: (kind, title, desc) => toasts.push(`${kind}:${title}`),
    confirmar: () => Promise.resolve(true),
  });

  const promessa = editor.abrir({ dataUrl, fileName: "produto.png", width: 800, height: 400 });

  // Espera o carregamento assíncrono da imagem no canvas.
  await new Promise((r) => setTimeout(r, 800));

  const byId = (id) => window.document.getElementById(id);
  ok("o overlay do editor abriu", byId("die-overlay").classList.contains("is-open"));
  ok("o loading sumiu depois de carregar a imagem", byId("die-loading").hidden === true);
  ok("o nome do arquivo aparece no cabeçalho", byId("die-file-name").textContent === "produto.png");
  ok("as dimensões aparecem no cabeçalho", byId("die-file-meta").textContent === "800 × 400 px");
  ok("nenhum toast de erro na abertura", toasts.length === 0);

  const canvasEl = byId("die-canvas");
  ok("o backstore do canvas ficou em 1200x1200", canvasEl.width === 1200 && canvasEl.height === 1200);

  function disparar(id, evento) {
    const el = byId(id);
    el.dispatchEvent(new window.Event(evento, { bubbles: true }));
  }

  // Girar 90° à direita
  disparar("die-rotate-right", "click");
  ok("girar 90° atualiza o slider de rotação", byId("die-rotation").value === "90");
  ok("desfazer ficou disponível depois da primeira ação", byId("die-undo").disabled === false);

  // Espelhar
  disparar("die-flip-x", "click");
  ok("espelhar H marca aria-pressed", byId("die-flip-x").getAttribute("aria-pressed") === "true");
  disparar("die-flip-y", "click");
  ok("espelhar V marca aria-pressed", byId("die-flip-y").getAttribute("aria-pressed") === "true");

  // Ajustes de cor
  byId("die-brightness").value = "40";
  disparar("die-brightness", "change");
  byId("die-saturation").value = "-100";
  disparar("die-saturation", "change");
  byId("die-sharpen").value = "60";
  disparar("die-sharpen", "change");
  await new Promise((r) => setTimeout(r, 300));
  ok("os sliders de cor refletem o estado", byId("die-brightness-value").textContent === "40" && byId("die-saturation-value").textContent === "-100");

  // Desfazer / refazer
  disparar("die-undo", "click");
  ok("desfazer reverte a nitidez", byId("die-sharpen").value === "0");
  disparar("die-redo", "click");
  ok("refazer devolve a nitidez", byId("die-sharpen").value === "60");

  // Fundo sólido
  disparar("die-bg-color", "click");
  ok("fundo sólido habilita o seletor de cor", byId("die-bg-color-input").disabled === false);
  disparar("die-bg-transparent", "click");
  ok("voltar para transparente desabilita o seletor", byId("die-bg-color-input").disabled === true);

  // Sombra
  byId("die-shadow-enabled").checked = true;
  disparar("die-shadow-enabled", "change");
  ok("ligar a sombra libera os controles", byId("die-shadow-blur").disabled === false);
  ok("ligar a sombra aplica um preset visível", Number(byId("die-shadow-blur").value) > 0);

  // Recorte 1:1
  disparar("die-crop", "click");
  ok("o modo recorte mostra a faixa de ações", byId("die-crop-actions").hidden === false);
  disparar("die-crop-square", "click");
  disparar("die-crop-confirm", "click");
  await new Promise((r) => setTimeout(r, 300));
  ok("aplicar o recorte fecha o modo recorte", byId("die-crop-actions").hidden === true);
  ok("limpar recorte fica habilitado depois de recortar", byId("die-crop-clear").disabled === false);

  // Comparar
  disparar("die-compare", "click");
  ok("comparar avisa que está mostrando a original", byId("die-compare-hint").hidden === false);
  disparar("die-compare", "click");
  ok("sair da comparação esconde o aviso", byId("die-compare-hint").hidden === true);

  ok("o indicador de alterações não aplicadas está visível", byId("die-dirty").hidden === false);

  // Aplicar
  disparar("die-apply", "click");
  const resultado = await promessa;

  ok("aplicar resolve com editing + rendered", !!(resultado && resultado.editing && resultado.rendered));
  ok("o overlay fechou depois de aplicar", byId("die-overlay").classList.contains("is-open") === false);
  ok("o data URL exportado é PNG (fundo transparente)", /^data:image\/png;base64,/.test(resultado.rendered.dataUrl));
  ok("as dimensões declaradas são 1200x1200", resultado.rendered.width === 1200 && resultado.rendered.height === 1200);

  const png = Buffer.from(resultado.rendered.dataUrl.split(",")[1], "base64");
  const meta = await sharp(png).metadata();
  ok(`o PNG exportado realmente tem 1200x1200 (${meta.width}x${meta.height})`, meta.width === 1200 && meta.height === 1200);
  ok("o PNG exportado preserva o canal alfa (fundo transparente)", meta.hasAlpha === true);

  const stats = await sharp(png).stats();
  ok("o PNG exportado não está vazio (tem pixels opacos)", stats.channels[3].max > 0);
  const [r, g, b] = stats.channels;
  ok(`saturação -100 deixou a imagem cinza (R≈G≈B: ${r.mean.toFixed(1)}/${g.mean.toFixed(1)}/${b.mean.toFixed(1)})`,
    Math.abs(r.mean - g.mean) < 6 && Math.abs(g.mean - b.mean) < 6);

  ok("os parâmetros devolvidos incluem o recorte aplicado", !!resultado.editing.crop);
  ok("os parâmetros devolvidos incluem rotação e espelhos", resultado.editing.rotation === 90 && resultado.editing.flipX === true && resultado.editing.flipY === true);
  ok("os parâmetros devolvidos incluem a sombra ligada", resultado.editing.shadow.enabled === true);

  // Segunda abertura: reabrir com os parâmetros aplicados e CANCELAR.
  const promessa2 = editor.abrir({ dataUrl, fileName: "produto.png", width: 800, height: 400, editing: resultado.editing });
  await new Promise((r) => setTimeout(r, 800));
  ok("reabrir restaura os controles a partir dos parâmetros", byId("die-rotation").value === "90" && byId("die-brightness").value === "40");
  ok("reabrir não marca alterações pendentes", byId("die-dirty").hidden === true);
  disparar("die-cancel", "click");
  const resultado2 = await promessa2;
  ok("cancelar sem alterações resolve null", resultado2 === null);
  ok("cancelar fecha o overlay", byId("die-overlay").classList.contains("is-open") === false);

  // Terceira: fundo sólido -> exporta JPEG.
  const promessa3 = editor.abrir({ dataUrl, fileName: "produto.png", width: 800, height: 400 });
  await new Promise((r) => setTimeout(r, 800));
  byId("die-bg-color-input").value = "#ff0000";
  disparar("die-bg-color", "click");
  disparar("die-apply", "click");
  const resultado3 = await promessa3;
  ok("fundo sólido exporta JPEG", /^data:image\/jpeg;base64,/.test(resultado3.rendered.dataUrl));
  const jpeg = Buffer.from(resultado3.rendered.dataUrl.split(",")[1], "base64");
  const metaJpeg = await sharp(jpeg).metadata();
  ok(`o JPEG exportado tem 1200x1200 (${metaJpeg.width}x${metaJpeg.height})`, metaJpeg.width === 1200 && metaJpeg.height === 1200);
  const statsJpeg = await sharp(jpeg).stats();
  ok(`o fundo vermelho chegou no JPEG (R=${statsJpeg.channels[0].mean.toFixed(0)} > B=${statsJpeg.channels[2].mean.toFixed(0)})`,
    statsJpeg.channels[0].mean > statsJpeg.channels[2].mean);

  console.log(`\n${checks - falhas.length}/${checks} verificações headless passaram.`);
  if (falhas.length) {
    console.log("FALHAS:\n - " + falhas.join("\n - "));
    process.exit(1);
  }
})().catch((e) => { console.error("ERRO:", e); process.exit(1); });
