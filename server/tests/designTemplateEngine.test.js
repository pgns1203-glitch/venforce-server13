// server/tests/designTemplateEngine.test.js
// Motor puro de templates do Estúdio de Templates (design-template-engine.js
// + design-template-presets.js), exercitado sem DOM: validação/normalização
// de definição, registro de templates, criação de projeto padrão, hidratação
// de projeto salvo (com fallback de template e sanitização por schema) e
// compatibilidade com o schema V2 de imagens do design-image-model.

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
const engine = require(path.join(portalDir, "design-template-engine"));
const presets = require(path.join(portalDir, "design-template-presets"));
const imageModel = require(path.join(portalDir, "design-image-model"));

const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

console.log("\n=== Motor de templates — testes puros ===\n");

/* ── 13. os módulos não dependem de document/window ───────────────────── */

// A prova real de pureza: este arquivo inteiro usa engine e presets (via
// require, como o Node faria) sem jamais definir document/window. Se algum
// dos dois módulos tocasse o DOM em tempo de carregamento ou de execução,
// as chamadas abaixo teriam lançado antes de chegar aqui.
ok("13. este arquivo carrega e usa engine+presets sem document/window definidos",
  typeof document === "undefined" && typeof window === "undefined");

// Só o corpo executável do código (fora de comentários) não deve tocar em
// document/window — os comentários do cabeçalho descrevem o uso no
// navegador de propósito e não contam como dependência real.
function corpoSemComentarios(fonte) {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((linha) => linha.replace(/\/\/.*$/, ""))
    .join("\n");
}
const engineSource = corpoSemComentarios(fs.readFileSync(path.join(portalDir, "design-template-engine.js"), "utf8"));
const presetsSource = corpoSemComentarios(fs.readFileSync(path.join(portalDir, "design-template-presets.js"), "utf8"));
ok("13b. o corpo executável do motor não referencia document/window",
  !/\bdocument\.|\bwindow\./.test(engineSource));
ok("13c. o corpo executável dos presets não referencia document/window",
  !/\bdocument\.|\bwindow\./.test(presetsSource));

/* ── 1/2. Validação e normalização de definição ───────────────────────── */

const validDefinition = {
  id: "teste-valido-v1",
  name: "Template de teste",
  segment: "Teste",
  marketplace: "Teste",
  canvas: { width: 800, height: 800 },
  pages: [{ id: "unica", name: "Página única", rendererId: "unica" }],
  defaults: {
    clienteNome: "Cliente X",
    marcaNome: "MARCA",
    palette: { primary: "#111111", secondary: "#222222", background: "#333333", text: "#444444" },
    product: { name: "Produto", subtitle: "Sub" },
    content: {},
    selectedPage: 0,
    compareMode: "custom",
    zoom: 100,
  },
};

const validacaoOk = engine.validateTemplateDefinition(validDefinition);
eq("1. definição válida passa na validação", validacaoOk.ok, true);

const normalizado = engine.normalizeTemplateDefinition(validDefinition);
eq("1b. a definição normalizada preserva o id", normalizado.id, "teste-valido-v1");
eq("1c. a página normalizada preserva o rendererId", normalizado.pages[0].rendererId, "unica");
ok("1d. a definição normalizada vem congelada (Object.freeze)", Object.isFrozen(normalizado));

const semId = { ...validDefinition, id: undefined };
const validacaoSemId = engine.validateTemplateDefinition(semId);
eq("2. definição sem id é rejeitada", validacaoSemId.ok, false);
eq("2b. o código de erro identifica o id ausente", validacaoSemId.codigo, "ID_AUSENTE");
assert.throws(() => engine.normalizeTemplateDefinition(semId), /./, "normalizar definição sem id deveria lançar");
checks += 1; console.log("  ok  2c. normalizar definição sem id lança erro");

/* ── 3. Ids duplicados no registry são rejeitados ─────────────────────── */

assert.throws(
  () => engine.createTemplateRegistry([validDefinition, { ...validDefinition }]),
  /duplicado/i,
  "registro com ids duplicados deveria lançar"
);
checks += 1; console.log("  ok  3. ids duplicados no registry são rejeitados");

/* ── 4/5. Preset atual: sete páginas, ids conhecidos ──────────────────── */

const registry = engine.createTemplateRegistry(presets.TEMPLATE_DEFINITIONS);
const carregador = registry.getById("portable-charger-complete-v1");
ok("4. o preset do carregador portátil existe no registro", Boolean(carregador));
eq("4b. o preset possui exatamente 7 páginas", carregador.pages.length, 7);
eq("5. os ids das 7 páginas permanecem os mesmos",
  carregador.pages.map((p) => p.id),
  ["cover", "wireless", "led", "package", "dimensions", "features", "safe"]);

/* ── 6/7/8. Projeto padrão ─────────────────────────────────────────────── */

const projetoPadrao = engine.createProjectFromTemplate(registry.getDefault(), { imageModel });
eq("6. projeto padrão usa portable-charger-complete-v1", projetoPadrao.templateId, "portable-charger-complete-v1");
eq("7. projeto padrão mantém schema version 2", projetoPadrao.version, 2);
eq("8. paleta padrão é preservada", projetoPadrao.palette, {
  primary: "#123047",
  secondary: "#ef6f55",
  background: "#f4efe5",
  text: "#12202b",
});

/* ── 9. Projeto salvo válido é hidratado (com sanitização por schema) ── */

const beneficioLongo = "B".repeat(200);
const salvoValido = {
  version: 2,
  templateId: "portable-charger-complete-v1",
  clienteId: 42,
  clienteNome: "Cliente Salvo",
  marcaNome: "MARCA SALVA",
  palette: { primary: "#000000", secondary: "#ffffff", background: "#ababab", text: "#010101" },
  product: {
    name: "Produto Salvo",
    subtitle: "Subtítulo salvo",
    originalImage: imageModel.normalizeImageRef({
      id: "prod-1", dataUrl: PNG_1X1, fileName: "a.png", mimeType: "image/png", width: 10, height: 10,
    }),
    editedImage: imageModel.createEmptyImageRef(),
    editing: imageModel.createDefaultEditing(),
    placement: { scale: 120, x: 60, y: 40 },
  },
  logo: imageModel.createEmptyImageRef(),
  content: { benefit: beneficioLongo },
  selectedPage: 3,
  view: "editor",
  compareMode: "original",
  zoom: 125,
};

const hidratado = engine.hydrateProjectFromTemplate(salvoValido, carregador, { imageModel });
eq("9. cliente salvo é preservado", hidratado.project.clienteNome, "Cliente Salvo");
eq("9b. imagem do produto salva é reidratada", hidratado.project.product.originalImage.id, "prod-1");
eq("9c. página selecionada salva é preservada", hidratado.project.selectedPage, 3);
eq("9d. migration é null para projeto já no schema V2", hidratado.migration, null);
eq("9e. contentSchema corta o texto no tamanho máximo do template (110)", hidratado.project.content.benefit.length, 110);

/* ── 10. templateId inexistente usa fallback ──────────────────────────── */

const salvoComTemplateInexistente = { ...salvoValido, templateId: "template-que-nao-existe" };
const templateResolvido = registry.getById(salvoComTemplateInexistente.templateId) || registry.getDefault();
eq("10. template inexistente resolve para o primeiro preset válido", templateResolvido.id, registry.getDefault().id);

const hidratadoFallback = engine.hydrateProjectFromTemplate(salvoComTemplateInexistente, templateResolvido, { imageModel });
eq("10b. o projeto hidratado usa os defaults do template de fallback (projeto salvo é descartado)",
  hidratadoFallback.project.clienteNome, "Cliente personalizado");
eq("10c. o templateId do projeto de fallback é o do preset resolvido",
  hidratadoFallback.project.templateId, registry.getDefault().id);

/* ── 11. Conteúdo inválido não derruba o carregamento ─────────────────── */

const salvoComLixo = {
  version: 2,
  templateId: "portable-charger-complete-v1",
  clienteNome: null,
  palette: { primary: "não é uma cor", secondary: null },
  product: { name: {}, subtitle: [] },
  content: { benefit: null, wireless: 0, led: false, packageItems: undefined },
  selectedPage: "abacate",
  zoom: "999",
};

let hidratadoLixo;
assert.doesNotThrow(() => {
  hidratadoLixo = engine.hydrateProjectFromTemplate(salvoComLixo, carregador, { imageModel });
}, "hidratar conteúdo inválido não deveria lançar");
checks += 1; console.log("  ok  11. hidratar conteúdo malformado não lança");

eq("11b. cor inválida cai no default da paleta", hidratadoLixo.project.palette.primary, "#123047");
eq("11c. conteúdo vazio/nulo cai no texto padrão do template",
  hidratadoLixo.project.content.benefit, carregador.defaults.content.benefit);
eq("11d. conteúdo com 0/false também cai no padrão (falsy)", hidratadoLixo.project.content.wireless, carregador.defaults.content.wireless);
eq("11e. selectedPage inválido é grampeado em um índice válido", hidratadoLixo.project.selectedPage, 0);
eq("11f. zoom fora da lista permitida cai no padrão de 100%", hidratadoLixo.project.zoom, 100);
ok("11g. nome de produto não-string não derruba o carregamento (vira texto)",
  typeof hidratadoLixo.project.product.name === "string");

/* ── 12. Dados de imagem permanecem compatíveis com o model V2 ───────── */

ok("12. o projeto padrão usa o shape do design-image-model (createDefaultProduct)",
  "originalImage" in projetoPadrao.product
  && "editedImage" in projetoPadrao.product
  && "editing" in projetoPadrao.product
  && "placement" in projetoPadrao.product);
eq("12b. imagem reidratada passa pela mesma normalização do model (normalizeImageRef)",
  hidratado.project.product.originalImage,
  imageModel.normalizeImageRef(salvoValido.product.originalImage));

/* ── 14. HTML carrega os módulos na ordem correta ─────────────────────── */

const html = fs.readFileSync(path.join(portalDir, "design-templates.html"), "utf8");
const ordemEsperada = [
  "design-image-model.js", "design-image-storage.js", "design-image-api.js", "design-image-editor.js",
  "design-template-engine.js", "design-template-presets.js", "design-templates.js",
];
const posicoes = ordemEsperada.map((nome) => html.indexOf(`src="${nome}"`));
ok("14. todos os módulos do estúdio aparecem no HTML", posicoes.every((p) => p > -1));
ok("14b. engine e presets carregam antes de design-templates.js",
  posicoes[4] < posicoes[6] && posicoes[5] < posicoes[6]);
ok("14c. a ordem de carregamento respeita a dependência declarada",
  posicoes.every((p, i) => i === 0 || p > posicoes[i - 1]));

console.log(`\n${checks} verificações passaram no motor de templates.`);
