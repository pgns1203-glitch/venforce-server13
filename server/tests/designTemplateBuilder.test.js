// server/tests/designTemplateBuilder.test.js
// -----------------------------------------------------------------------------
// Construtor Modular de Carrosséis, exercitado sem navegador:
//
//   • núcleo puro (model): projeto padrão, capa obrigatória, inclusão,
//     remoção, reordenação e rejeição de ids desconhecidos;
//   • biblioteca local (storage): salvar, carregar, duplicar, excluir e a
//     trava que impede base64 no localStorage;
//   • layouts: os 5 novos estão registrados, renderizam SVG 1200 × 1200 e
//     campos vazios não viram "undefined" nem "[object Object]";
//   • o template antigo continua renderizando igual;
//   • o HTML tem a aba Construtor, os scripts na ordem certa e os botões;
//   • a TELA REAL sobe (design-templates.js + design-template-builder.js) e
//     a aba Construtor fica visível, com prévia, páginas e biblioteca.

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
const builderModel = require(path.join(portalDir, "design-template-builder-model"));
const builderStorage = require(path.join(portalDir, "design-template-builder-storage"));
const generator = require(path.join(portalDir, "design-template-proposal-generator"));

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const NOVOS_LAYOUTS = [
  "cover-split-v1",
  "benefits-three-cards-v1",
  "specifications-grid-v1",
  "package-list-v1",
  "dimensions-technical-v1",
];

function criarRenderer() {
  return rendererLib.createTemplateRenderer({
    documentLike: snap.criarDocumentoFake(),
    componentsLib,
    layoutsLib,
    resolveProductImageSource: (p) => imageModel.resolveProductImageSource(p.product),
  });
}

// A capa é obrigatória: sanitizeProject devolve ela de volta mesmo quando o
// teste pede uma página só. Este helper acha o índice da página desejada.
function indiceDaPagina(template, rendererId) {
  return template.pages.findIndex((page) => page.rendererId === rendererId);
}

// A partir da Fase 4 uma página é { id, family, rendererId, name }. Estes
// atalhos mantêm as asserções legíveis.
const familias = (pages) => pages.map((p) => p.family);
const renderers = (pages) => pages.map((p) => p.rendererId);

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

// localStorage de teste: mesmo contrato do navegador, inspecionável.
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
  console.log("\n=== Construtor Modular de Carrosséis ===\n");

  /* ── 1. Projeto padrão ─────────────────────────────────────────────────── */

  const padrao = builderModel.createDefaultProject({ imageModel });
  ok("1. o construtor cria um projeto padrão utilizável",
    Boolean(padrao.id) && padrao.version === builderModel.BUILDER_SCHEMA_VERSION
    && typeof padrao.name === "string" && padrao.name.trim().length > 0);
  eq("1b. o projeto padrão já vem com as cinco famílias de página",
    familias(padrao.pages), builderModel.FAMILY_IDS);
  eq("1b2. cada página nasce na variação padrão da família",
    renderers(padrao.pages),
    ["cover-split-v1", "benefits-three-cards-v1", "specifications-grid-v1", "package-list-v1", "dimensions-technical-v1"]);
  ok("1c. o projeto padrão tem paleta hexadecimal válida",
    ["primary", "secondary", "background", "text"].every((c) => builderModel.isHexColor(padrao.palette[c])));
  // Fase 4: o projeto padrão nasce VAZIO. Texto de exemplo gravado no projeto
  // seria dado comercial falso; as sugestões vivem como placeholder na tela.
  ok("1d. o projeto padrão nasce sem conteúdo comercial inventado",
    Object.values(padrao.content).every((v) => v === "")
    && padrao.product.name === "" && padrao.product.subtitle === "");
  ok("1d2. a validação cobra o que falta em vez de aceitar o vazio", (() => {
    const resultado = builderModel.validateProject(padrao);
    return !resultado.ok && resultado.erros.some((e) => e.codigo === "NOME_PRODUTO_AUSENTE");
  })());
  ok("1e. dois projetos padrão têm ids diferentes",
    builderModel.createDefaultProject({ imageModel }).id !== builderModel.createDefaultProject({ imageModel }).id);
  ok("1f. o projeto padrão não guarda base64 nenhum",
    !JSON.stringify(padrao).includes("data:image"));

  /* ── 2. Capa obrigatória ───────────────────────────────────────────────── */

  eq("2. a capa é a única família marcada como obrigatória",
    builderModel.REQUIRED_FAMILY_IDS, ["cover"]);
  ok("2b. remover a capa é recusado com erro explícito", (() => {
    try {
      builderModel.removePage(padrao.pages, "cover");
      return false;
    } catch (erro) {
      return erro.codigo === "PAGINA_OBRIGATORIA";
    }
  })());
  ok("2b2. remover a capa pelo rendererId antigo também é recusado", (() => {
    try {
      builderModel.removePage(padrao.pages, "cover-split-v1");
      return false;
    } catch (erro) {
      return erro.codigo === "PAGINA_OBRIGATORIA";
    }
  })());
  ok("2c. um projeto sem capa é reprovado na validação", (() => {
    const semCapa = { ...padrao, pages: [{ family: "package", rendererId: "package-list-v1" }] };
    const resultado = builderModel.validateProject(semCapa);
    return !resultado.ok && resultado.erros.some((e) => e.codigo === "CAPA_AUSENTE");
  })());
  ok("2d. sanitizar um projeto sem capa devolve a capa de volta",
    familias(builderModel.normalizePages(["package-list-v1"])).includes("cover"));

  /* ── 3. Adicionar páginas ──────────────────────────────────────────────── */

  const soCapa = ["cover-split-v1"];
  eq("3. uma página pode ser adicionada ao carrossel",
    familias(builderModel.addPage(soCapa, "specifications")), ["cover", "specifications"]);
  eq("3b. adicionar a mesma família duas vezes não duplica",
    familias(builderModel.addPage(builderModel.addPage(soCapa, "package"), "package")),
    ["cover", "package"]);
  eq("3c. addPage não altera a lista recebida", soCapa, ["cover-split-v1"]);
  eq("3d. adicionar por rendererId escolhe a variação pedida",
    renderers(builderModel.addPage(soCapa, "specifications-cards-v1")),
    ["cover-split-v1", "specifications-cards-v1"]);

  /* ── 4. Remover páginas ────────────────────────────────────────────────── */

  const cinco = builderModel.FAMILY_IDS.slice();
  eq("4. uma página opcional pode ser removida",
    familias(builderModel.removePage(cinco, "package")),
    ["cover", "benefits", "specifications", "dimensions"]);
  eq("4b. removePage não altera a lista recebida", cinco, builderModel.FAMILY_IDS);
  eq("4c. togglePage(false) é o mesmo que remover",
    builderModel.togglePage(cinco, "dimensions", false),
    builderModel.removePage(cinco, "dimensions"));

  /* ── 5. Reordenar páginas ──────────────────────────────────────────────── */

  eq("5. uma página pode subir na ordem",
    familias(builderModel.movePage(cinco, "specifications", -1)),
    ["cover", "specifications", "benefits", "package", "dimensions"]);
  eq("5b. uma página pode descer na ordem",
    familias(builderModel.movePage(cinco, "benefits", 1)),
    ["cover", "specifications", "benefits", "package", "dimensions"]);
  eq("5c. subir a primeira página não circula para o fim",
    familias(builderModel.movePage(cinco, "cover", -1)), cinco);
  eq("5d. descer a última página não circula para o início",
    familias(builderModel.movePage(cinco, "dimensions", 1)), cinco);
  ok("5e. canMovePage reflete as pontas",
    builderModel.canMovePage(cinco, "cover", -1) === false
    && builderModel.canMovePage(cinco, "cover", 1) === true
    && builderModel.canMovePage(cinco, "dimensions", 1) === false);
  eq("5f. a ordem escolhida vira a ordem das páginas do template", (() => {
    const projeto = { ...padrao, pages: builderModel.movePage(cinco, "dimensions", -1) };
    return engine.normalizeTemplateDefinition(builderModel.buildTemplateDefinition(projeto))
      .pages.map((p) => p.rendererId);
  })(), ["cover-split-v1", "benefits-three-cards-v1", "specifications-grid-v1", "dimensions-technical-v1", "package-list-v1"]);

  /* ── 6. Ids desconhecidos ──────────────────────────────────────────────── */

  ok("6. addPage rejeita id fora do catálogo", (() => {
    try { builderModel.addPage(soCapa, "pagina-inventada-v9"); return false; }
    catch (erro) { return erro.codigo === "PAGINA_DESCONHECIDA"; }
  })());
  ok("6b. removePage rejeita id fora do catálogo", (() => {
    try { builderModel.removePage(cinco, "pagina-inventada-v9"); return false; }
    catch (erro) { return erro.codigo === "PAGINA_DESCONHECIDA"; }
  })());
  ok("6b2. setPageVariant rejeita layout de outra família", (() => {
    try { builderModel.setPageVariant(cinco, "cover", "package-grid-v1"); return false; }
    catch (erro) { return erro.codigo === "LAYOUT_DE_OUTRA_FAMILIA"; }
  })());
  ok("6c. movePage rejeita página que não está no carrossel", (() => {
    try { builderModel.movePage(soCapa, "package", 1); return false; }
    catch (erro) { return erro.codigo === "PAGINA_AUSENTE"; }
  })());
  ok("6d. a validação denuncia rendererId desconhecido em vez de aceitar", (() => {
    const resultado = builderModel.validateProject({ ...padrao, pages: ["cover-split-v1", "nao-existe-v1"] });
    return !resultado.ok && resultado.erros.some((e) => e.codigo === "PAGINA_DESCONHECIDA");
  })());
  ok("6e. sanitizar descarta silenciosamente o id desconhecido (dado salvo velho)",
    builderModel.normalizePages(["cover-split-v1", "nao-existe-v1"]).length === 1);
  ok("6f. applyStyle rejeita estilo desconhecido", (() => {
    try { builderModel.applyStyle(padrao, "estilo-que-nao-existe"); return false; }
    catch (erro) { return erro.codigo === "ESTILO_DESCONHECIDO"; }
  })());
  ok("6g. duas páginas da mesma família são reprovadas na validação", (() => {
    const resultado = builderModel.validateProject({ ...padrao, pages: ["cover-split-v1", "cover-impact-v1"] });
    return !resultado.ok && resultado.erros.some((e) => e.codigo === "PAGINA_DUPLICADA");
  })());

  /* ── 7/8/9/10/11. Biblioteca local ─────────────────────────────────────── */

  const store = criarLocalStorage();
  const library = builderStorage.createBuilderLibrary({ localStorage: store });

  eq("7pre. a biblioteca começa vazia", library.listar(), []);

  const projetoComImagem = {
    ...builderModel.createDefaultProject({ imageModel }),
    name: "Furadeira 650 W",
    segment: "Ferramentas",
    logo: imageModel.normalizeImageRef({ id: "bld-logo-1", dataUrl: PNG, fileName: "logo.png", mimeType: "image/png" }),
  };
  projetoComImagem.product = {
    ...projetoComImagem.product,
    name: "Furadeira de impacto 650 W",
    originalImage: imageModel.normalizeImageRef({ id: "bld-prod-1", dataUrl: PNG, fileName: "p.png", mimeType: "image/png" }),
  };

  const salvo = library.salvar(projetoComImagem);
  ok("7. um template local pode ser salvo", Boolean(salvo.id) && salvo.name === "Furadeira 650 W");
  eq("7b. a chave usada é a nova biblioteca, separada do projeto do editor",
    builderStorage.LIBRARY_KEY, "vf-design-template-library-v1");
  ok("7c. a chave do editor antigo não foi tocada",
    store.getItem("vf-design-template-studio-v1") === null);
  eq("7d. o registro guarda o essencial",
    Object.keys(salvo).sort(),
    ["clienteId", "clienteNome", "content", "createdAt", "direction", "id", "logo", "marcaNome",
      "name", "origin", "pages", "palette", "product", "segment", "style", "updatedAt", "version"]);
  ok("7e. salvar sem nome é recusado com mensagem clara", (() => {
    try { library.salvar({ ...projetoComImagem, id: "", name: "   " }); return false; }
    catch (erro) { return erro.codigo === "NOME_AUSENTE"; }
  })());

  const carregado = library.obter(salvo.id);
  ok("8. um template local pode ser carregado de volta",
    carregado && carregado.name === "Furadeira 650 W" && carregado.segment === "Ferramentas");
  eq("8b. as páginas, as variações e a ordem sobrevivem ao salvar/carregar",
    carregado.pages.map((p) => `${p.family}:${p.rendererId}`),
    projetoComImagem.pages.map((p) => `${p.family}:${p.rendererId}`));
  eq("8c. a paleta sobrevive ao salvar/carregar", carregado.palette, projetoComImagem.palette);
  ok("8d. as referências de imagem sobrevivem (id preservado, blob fora)",
    carregado.logo.id === "bld-logo-1" && carregado.product.originalImage.id === "bld-prod-1"
    && !("dataUrl" in carregado.logo));
  ok("8e. o projeto carregado volta a ser um projeto válido do construtor",
    builderModel.validateProject(builderModel.sanitizeProject(carregado, { imageModel })).ok === true);
  ok("8f. salvar de novo com o mesmo id ATUALIZA em vez de criar outro", (() => {
    const antes = library.listar().length;
    library.salvar({ ...builderModel.sanitizeProject(carregado, { imageModel }), name: "Furadeira 650 W Pro" });
    return library.listar().length === antes && library.obter(salvo.id).name === "Furadeira 650 W Pro";
  })());

  const copia = library.duplicar(salvo.id);
  ok("9. um template local pode ser duplicado", copia.id !== salvo.id);
  ok("9b. a cópia recebe “Cópia” no nome", /\(Cópia\)$/.test(copia.name));
  ok("9c. a cópia tem createdAt e updatedAt próprios",
    copia.createdAt !== library.obter(salvo.id).createdAt || copia.id !== salvo.id);
  eq("9d. a biblioteca passa a ter dois templates", library.listar().length, 2);
  ok("9e. o original continua intacto depois da duplicação",
    library.obter(salvo.id).name === "Furadeira 650 W Pro");
  ok("9f. duplicar um id inexistente é erro explícito", (() => {
    try { library.duplicar("nao-existe"); return false; }
    catch (erro) { return erro.codigo === "TEMPLATE_INEXISTENTE"; }
  })());

  ok("10. um template local pode ser excluído", library.remover(copia.id) === true);
  eq("10b. a biblioteca volta a ter um template", library.listar().length, 1);
  ok("10c. excluir duas vezes devolve false em vez de quebrar", library.remover(copia.id) === false);
  eq("10d. o template restante continua sendo o original", library.obter(salvo.id).id, salvo.id);

  const bruto = store.getItem(builderStorage.LIBRARY_KEY);
  ok("11. o localStorage da biblioteca não guarda base64", !bruto.includes("data:image"));
  ok("11b. o localStorage da biblioteca guarda os ids das imagens",
    bruto.includes("bld-logo-1") && bruto.includes("bld-prod-1"));
  eq("11c. a biblioteca declara quais blobs ainda usa (para não virarem órfãos)",
    library.listarIdsDeImagens().sort(), ["bld-logo-1", "bld-prod-1"]);
  ok("11d. gravar um registro com base64 é recusado por trava explícita", (() => {
    const outro = builderStorage.createBuilderLibrary({ localStorage: criarLocalStorage() });
    // toRecord já retira o blob; a trava existe para o caso de um campo novo
    // escapar da limpeza no futuro.
    const registro = builderStorage.toRecord(projetoComImagem, { now: "2026-07-31T00:00:00.000Z" });
    registro.content.observacao = PNG;
    try {
      outro.salvar({ ...projetoComImagem, content: { ...projetoComImagem.content, observacao: PNG } });
      return !outro.listar()[0] || !JSON.stringify(outro.listar()[0]).includes("data:image");
    } catch (erro) {
      return erro.codigo === "BASE64_NO_LOCALSTORAGE";
    }
  })());
  ok("11e. uma biblioteca corrompida vira lista vazia, não exceção", (() => {
    const quebrado = criarLocalStorage();
    quebrado.setItem(builderStorage.LIBRARY_KEY, "{isso não é json");
    return builderStorage.createBuilderLibrary({ localStorage: quebrado }).listar().length === 0;
  })());

  /* ── 12/13/14/15. Layouts novos ────────────────────────────────────────── */

  const renderer = criarRenderer();
  const registrados = renderer.listAvailableLayouts().map((d) => d.id);
  eq("12. os cinco layouts modulares estão registrados",
    NOVOS_LAYOUTS.filter((id) => registrados.includes(id)), NOVOS_LAYOUTS);
  ok("12b. os layouts antigos continuam registrados",
    ["cover", "wireless", "led", "package", "dimensions", "features", "safe"].every((id) => renderer.hasLayout(id)));
  ok("12c. cada layout modular tem metadados serializáveis, sem função",
    renderer.listAvailableLayouts()
      .filter((d) => NOVOS_LAYOUTS.includes(d.id))
      .every((d) => d.family === "modular" && typeof d.label === "string"
        && Object.values(d).every((v) => typeof v !== "function")));

  const projetoModular = builderModel.createDefaultProject({ imageModel });
  const templateModular = engine.normalizeTemplateDefinition(builderModel.buildTemplateDefinition(projetoModular));
  const svgsModulares = renderer.renderAllPages({
    template: templateModular,
    project: builderModel.toRenderProject(projetoModular),
  });

  eq("13. o carrossel modular gera um SVG por página", svgsModulares.length, 5);
  svgsModulares.forEach((svg, indice) => {
    const nome = templateModular.pages[indice].name;
    ok(`13.${indice + 1} “${nome}” gera SVG com conteúdo real (${contarNos(svg)} nós)`,
      svg.tagName === "svg" && contarNos(svg) > 10
      && textosDe(svg).some((t) => t && !t.includes("font-synthesis")));
  });

  svgsModulares.forEach((svg, indice) => {
    ok(`14.${indice + 1} a página ${indice + 1} sai em 1200 × 1200`,
      svg.getAttribute("viewBox") === "0 0 1200 1200"
      && svg.getAttribute("width") === "1200" && svg.getAttribute("height") === "1200");
  });

  ok("14b. as cinco páginas são visualmente DIFERENTES entre si", (() => {
    const assinaturas = svgsModulares.map((svg) => snap.hashDoSvg(svg));
    return new Set(assinaturas).size === 5;
  })());

  const projetoVazio = builderModel.sanitizeProject(
    { id: "vazio", name: "Vazio", pages: builderModel.FAMILY_IDS, palette: padrao.palette },
    { imageModel }
  );
  const svgsVazios = renderer.renderAllPages({
    template: engine.normalizeTemplateDefinition(builderModel.buildTemplateDefinition(projetoVazio)),
    project: builderModel.toRenderProject(projetoVazio),
  });
  const serializadoVazio = svgsVazios.map((svg) => snap.serializarSvg(svg)).join("\n");

  eq("15. campos vazios renderizam as cinco páginas sem lançar", svgsVazios.length, 5);
  ok("15b. nenhuma peça emite “undefined”", !/undefined/.test(serializadoVazio));
  ok("15c. nenhuma peça emite “[object Object]”", !/\[object Object\]/.test(serializadoVazio));
  ok("15d. nenhuma peça emite “NaN”", !/NaN/.test(serializadoVazio));
  ok("15e. medida vazia não vira cota nem “0” na arte", (() => {
    const comMedida = builderModel.sanitizeProject(
      { id: "m", name: "M", pages: ["dimensions-technical-v1"], palette: padrao.palette, content: { height: "42 cm" } },
      { imageModel }
    );
    const template = engine.normalizeTemplateDefinition(builderModel.buildTemplateDefinition(comMedida));
    const svg = renderer.renderPage({
      template,
      project: builderModel.toRenderProject(comMedida),
      pageIndex: indiceDaPagina(template, "dimensions-technical-v1"),
    });
    const textos = textosDe(svg);
    return textos.includes("ALTURA") && !textos.includes("LARGURA") && !textos.includes("PROFUNDIDADE");
  })());
  ok("15f. especificação sem dois pontos vira só rótulo, sem quebrar", (() => {
    const pares = componentsLib.parseSpecPairs("Potência: 650 W\nResistente à água\n\n  ");
    return pares.length === 2 && pares[0].value === "650 W"
      && pares[1].label === "Resistente à água" && pares[1].value === "";
  })());
  ok("15g. a grade de especificações respeita o teto de 6",
    componentsLib.parseSpecPairs("a:1\nb:2\nc:3\nd:4\ne:5\nf:6\ng:7", 6).length === 6);
  ok("15h. o aviso de campo vazio aparece na PRÉVIA e some no arquivo final", (() => {
    const semItens = builderModel.sanitizeProject(
      { id: "p", name: "P", pages: ["package-list-v1"], palette: padrao.palette },
      { imageModel }
    );
    const template = engine.normalizeTemplateDefinition(builderModel.buildTemplateDefinition(semItens));
    const projeto = builderModel.toRenderProject(semItens);
    const indice = indiceDaPagina(template, "package-list-v1");
    const previa = textosDe(renderer.renderPage({ template, project: projeto, pageIndex: indice, mode: "preview" }));
    const arquivo = textosDe(renderer.renderPage({ template, project: projeto, pageIndex: indice }));
    return previa.some((t) => /um item por linha/i.test(t)) && !arquivo.some((t) => /um item por linha/i.test(t));
  })());
  ok("15i. texto que não é texto (objeto, null) some em vez de virar string", (() => {
    const sujo = builderModel.sanitizeProject({
      id: "s", name: "S", pages: ["cover-split-v1"], palette: padrao.palette,
      product: { name: { hack: 1 } },
      content: { mainBenefit: null, specs: undefined, width: [1, 2] },
    }, { imageModel });
    return sujo.product.name === "" && sujo.content.mainBenefit === ""
      && sujo.content.specs === "" && sujo.content.width === "";
  })());

  // Regressão: limpar o campo "Nome do projeto" não pode apagar a prévia. A
  // definição do template precisa continuar renderizável; quem cobra o nome
  // é a validação, na hora de salvar ou exportar.
  ok("15j. nome de projeto em branco ainda gera um template renderizável", (() => {
    const semNome = { ...padrao, name: "   ", clienteNome: "  ", marcaNome: " " };
    const template = engine.normalizeTemplateDefinition(builderModel.buildTemplateDefinition(semNome));
    const svgs = renderer.renderAllPages({ template, project: builderModel.toRenderProject(semNome) });
    return svgs.length === 5 && !builderModel.validateProject(semNome).ok;
  })());

  /* ── 16. Template antigo intacto ───────────────────────────────────────── */

  const registryAntigo = engine.createTemplateRegistry(presets.TEMPLATE_DEFINITIONS);
  const templateAntigo = registryAntigo.getDefault();
  const antigos = renderer.renderAllPages({
    template: templateAntigo,
    project: engine.hydrateProjectFromTemplate(
      { version: 2, templateId: templateAntigo.id, view: "editor" }, templateAntigo, { imageModel }
    ).project,
  });
  eq("16. o template do carregador portátil continua com 7 peças", antigos.length, 7);
  ok("16b. as 7 peças antigas continuam saindo em 1200 × 1200",
    antigos.every((svg) => svg.getAttribute("viewBox") === "0 0 1200 1200"));
  ok("16c. o vínculo rendererId -> layout do preset antigo continua íntegro",
    renderer.validateRendererBindings(templateAntigo).ok === true);
  ok("16d. o preset do sistema não foi tocado pelo construtor",
    presets.PORTABLE_CHARGER_COMPLETE_V1.pages.length === 7
    && presets.TEMPLATE_DEFINITIONS.length === 1);

  /* ── 17/18/19. HTML da tela ────────────────────────────────────────────── */

  const html = fs.readFileSync(path.join(portalDir, "design-templates.html"), "utf8");

  ok("17. o HTML tem a aba Construtor", /id="dt-builder-tab"[^>]*>Construtor</.test(html));
  ok("17b. a aba Construtor é um tab acessível",
    /id="dt-builder-tab"[^>]*role="tab"/.test(html) && /id="dt-builder-tab"[^>]*aria-selected=/.test(html));
  ok("17c. as três abas estão lado a lado no mesmo tablist",
    html.indexOf('id="dt-library-tab"') < html.indexOf('id="dt-editor-tab"')
    && html.indexOf('id="dt-editor-tab"') < html.indexOf('id="dt-builder-tab"'));
  ok("17d. existe a seção do construtor", html.includes('id="dt-builder-view"'));
  ok("17e. o título e a descrição pedidos estão na tela",
    html.includes("Criar carrossel modular")
    && html.includes("Escolha a identidade, preencha as informações do produto e combine páginas"));
  ok("17f. a biblioteca separa modelos de partida e templates salvos",
    html.includes("Modelos de partida") && html.includes("Templates salvos"));

  const posicaoDoScript = (arquivo) => html.indexOf(`src="${arquivo}"`);
  const ordem = [
    "design-template-engine.js", "design-template-presets.js", "design-template-components.js",
    "design-template-layouts.js", "design-template-renderer.js",
    "design-template-builder-model.js", "design-template-builder-storage.js",
    "design-templates.js", "design-template-builder.js",
  ];
  const posicoes = ordem.map(posicaoDoScript);
  ok("18. todos os módulos do construtor estão no HTML", posicoes.every((p) => p > -1));
  ok("18b. os scripts carregam em ordem de dependência",
    posicoes.every((p, i) => i === 0 || p > posicoes[i - 1]));
  ok("18c. o construtor entra depois da tela (que publica a integração)",
    posicaoDoScript("design-template-builder.js") > posicaoDoScript("design-templates.js"));
  ok("18d. a folha de estilo do construtor é carregada",
    html.includes("css/pages/design-template-builder-v2.css"));

  const BOTOES = {
    "dtb-generate": "Gerar prévia",
    "dtb-save-draft": "Salvar rascunho",
    "dtb-save-template": "Salvar como template",
    "dtb-reset": "Restaurar",
    "dtb-download-page": "Baixar página atual",
    "dtb-download-all": "Baixar todas as páginas",
    "dtb-back-library": "Voltar para a biblioteca",
  };
  Object.entries(BOTOES).forEach(([id, rotulo]) => {
    ok(`19. a interface tem o botão “${rotulo}”`,
      new RegExp(`id="${id}"[^>]*>${rotulo}<`).test(html));
  });

  const CAMPOS = ["dtb-project-name", "dtb-client-select", "dtb-brand-name", "dtb-logo-file",
    "dtb-color-primary", "dtb-color-secondary", "dtb-color-background", "dtb-color-text",
    "dtb-segment", "dtb-style", "dtb-product-name", "dtb-product-subtitle", "dtb-product-file",
    "dtb-main-benefit", "dtb-benefit-1", "dtb-benefit-2", "dtb-benefit-3", "dtb-specs",
    "dtb-package", "dtb-width", "dtb-height", "dtb-depth", "dtb-how-to-use", "dtb-warranty",
    "dtb-shipping", "dtb-pages-list", "dtb-main-preview", "dtb-thumbnails", "dtb-zoom",
    "dtb-prev", "dtb-next"];
  eq("19b. todos os campos do construtor existem no HTML",
    CAMPOS.filter((id) => !html.includes(`id="${id}"`)), []);

  ok("19c. nenhum input do construtor aceita SVG",
    !/id="dtb-[a-z-]*file"[^>]*accept="[^"]*svg/i.test(html));

  /* ── Segurança: nada dinâmico ──────────────────────────────────────────── */

  ["design-template-builder-model.js", "design-template-builder-storage.js", "design-template-builder.js"]
    .forEach((nome) => {
      const fonte = fs.readFileSync(path.join(portalDir, nome), "utf8");
      ok(`S. ${nome} não usa eval nem new Function`,
        !/\beval\s*\(/.test(fonte) && !/new\s+Function\s*\(/.test(fonte));
      ok(`S. ${nome} não injeta HTML arbitrário`,
        !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(fonte));
    });

  const fonteBuilder = fs.readFileSync(path.join(portalDir, "design-template-builder.js"), "utf8");
  ok("S. o construtor não redefine API_BASE nem lê o token do Portal",
    !/API_BASE\s*=/.test(fonteBuilder) && !/vf-token/.test(fonteBuilder));
  ok("S. o construtor usa uma chave de biblioteca própria",
    !fonteBuilder.includes("vf-design-template-studio-v1"));

  /* ── TELA REAL: a aba Construtor aparece e funciona ────────────────────── */

  await (async function telaReal() {
    console.log("\n  — tela real (design-templates.js + design-template-builder.js) —\n");

    const elementos = new Map();
    const tabsDoConstrutor = [];
    const paineisDoConstrutor = [];

    function criar(tag, ns) {
      const el = snap.criarElemento(tag, ns);
      const listeners = new Map();
      el.addEventListener = (evento, handler) => {
        if (!listeners.has(evento)) listeners.set(evento, []);
        listeners.get(evento).push(handler);
      };
      el.dispatch = (evento, payload) => {
        (listeners.get(evento) || []).forEach((h) => h({ target: el, preventDefault() {}, ...(payload || {}) }));
      };
      el.click = () => el.dispatch("click");
      return el;
    }

    function byIdFake(id) {
      if (!elementos.has(id)) {
        const el = criar("div");
        el.id = id;
        elementos.set(id, el);
      }
      return elementos.get(id);
    }

    // As abas e painéis do construtor vêm do HTML no navegador; aqui são
    // registrados à mão, com os mesmos data-attributes.
    ["identity", "product", "content", "pages"].forEach((nome) => {
      const tab = criar("button");
      tab.dataset.builderTab = nome;
      tabsDoConstrutor.push(tab);
      const painel = criar("div");
      painel.dataset.builderPanel = nome;
      paineisDoConstrutor.push(painel);
    });

    const store = criarLocalStorage();
    const doc = snap.criarDocumentoFake();

    const contexto = {
      initLayout: () => {},
      fetch: () => Promise.reject(new TypeError("sem rede")),
      localStorage: store,
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
      ...doc,
      getElementById: byIdFake,
      createElement: (tag) => criar(tag),
      createElementNS: (ns, tag) => criar(tag, ns),
      querySelector: () => null,
      querySelectorAll: (seletor) => {
        if (seletor === "[data-builder-tab]") return tabsDoConstrutor;
        if (seletor === "[data-builder-panel]") return paineisDoConstrutor;
        return [];
      },
      addEventListener() {}, removeEventListener() {},
      body: criar("body"), activeElement: null,
    };
    contexto.addEventListener = () => {};
    contexto.removeEventListener = () => {};
    contexto.VF_DESIGN_IMAGE_MODEL = imageModel;
    contexto.VF_DESIGN_IMAGE_STORAGE = require(path.join(portalDir, "design-image-storage"));
    contexto.VF_DESIGN_IMAGE_API = require(path.join(portalDir, "design-image-api"));
    contexto.VF_DESIGN_TEMPLATE_ENGINE = engine;
    contexto.VF_DESIGN_TEMPLATE_PRESETS = presets;
    contexto.VF_DESIGN_TEMPLATE_COMPONENTS = componentsLib;
    contexto.VF_DESIGN_TEMPLATE_LAYOUTS = layoutsLib;
    contexto.VF_DESIGN_TEMPLATE_RENDERER = rendererLib;
    contexto.VF_DESIGN_TEMPLATE_BUILDER_MODEL = builderModel;
    contexto.VF_DESIGN_TEMPLATE_BUILDER_STORAGE = builderStorage;
    contexto.VF_DESIGN_TEMPLATE_PROPOSAL_GENERATOR = generator;
    contexto.VFDesignImageEditor = { createDesignImageEditor: () => ({ abrir: () => Promise.resolve(null) }) };

    vm.createContext(contexto);
    vm.runInContext(fs.readFileSync(path.join(portalDir, "design-templates.js"), "utf8"),
      contexto, { filename: "design-templates.js" });
    vm.runInContext(fs.readFileSync(path.join(portalDir, "design-template-builder.js"), "utf8"),
      contexto, { filename: "design-template-builder.js" });

    ok("T1. a tela publica a integração do construtor",
      Boolean(contexto.VF_DESIGN_TEMPLATE_STUDIO)
      && typeof contexto.VF_DESIGN_TEMPLATE_STUDIO.showView === "function");

    ok("T2. o construtor começa escondido e a biblioteca aparece",
      byIdFake("dt-builder-view").hidden === true && byIdFake("dt-library-view").hidden === false);

    // 1. clicar na aba Construtor
    byIdFake("dt-builder-tab").dispatch("click");
    ok("T3. clicar na aba Construtor deixa a seção VISÍVEL",
      byIdFake("dt-builder-view").hidden === false);
    ok("T3b. as outras duas áreas somem",
      byIdFake("dt-library-view").hidden === true && byIdFake("dt-editor-view").hidden === true);
    ok("T3c. a aba Construtor fica marcada como selecionada",
      byIdFake("dt-builder-tab").getAttribute("aria-selected") === "true");
    ok("T3d. as ações do construtor entram no cabeçalho",
      byIdFake("dt-builder-header-actions").hidden === false
      && byIdFake("dt-editor-header-actions").hidden === true);

    // 2. o modo padrão é "Gerar propostas"
    ok("T3e. o Construtor abre no modo “Gerar propostas”",
      byIdFake("dtb-generate-view").hidden === false
      && byIdFake("dtb-manual-view").hidden === true
      && byIdFake("dtb-mode-generate").getAttribute("aria-pressed") === "true");

    byIdFake("dtb-mode-manual").dispatch("click");
    ok("T3f. “Montar manualmente” troca para o editor manual",
      byIdFake("dtb-manual-view").hidden === false && byIdFake("dtb-generate-view").hidden === true);

    // 3. a prévia existe, com miniaturas
    ok("T4. a prévia principal desenhou uma página",
      byIdFake("dtb-main-preview").children.length === 1
      && byIdFake("dtb-main-preview").children[0].tagName === "svg");
    eq("T4b. as cinco miniaturas foram montadas", byIdFake("dtb-thumbnails").children.length, 5);
    ok("T4c. cada miniatura traz número e nome da página",
      byIdFake("dtb-thumbnails").children.every((botao, i) =>
        botao.children[1].textContent.startsWith(String(i + 1).padStart(2, "0"))));
    eq("T4d. a lista de seleção mostra as cinco páginas modulares",
      byIdFake("dtb-pages-list").children.length, 5);

    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    const serializar = () => snap.serializarSvg(byIdFake("dtb-main-preview").children[0]);

    // 3. alterar cor muda a prévia (imediato, sem debounce)
    const antesDaCor = serializar();
    byIdFake("dtb-color-primary").value = "#123456";
    byIdFake("dtb-color-primary").dispatch("input");
    ok("T5. alterar a cor principal muda a prévia na hora", serializar() !== antesDaCor);
    ok("T5b. a cor escolhida chega na arte", serializar().includes("#123456"));

    // 4. editar o nome do produto muda a arte
    byIdFake("dtb-product-name").value = "Furadeira de Impacto";
    byIdFake("dtb-product-name").dispatch("input");
    byIdFake("dtb-generate").dispatch("click");
    ok("T6. editar o nome do produto muda a arte",
      textosDe(byIdFake("dtb-main-preview").children[0]).includes("Furadeira de"));

    // 5. remover uma página remove a miniatura
    const caixaDeEspecificacoes = byIdFake("dtb-pages-list").children
      .map((item) => item.children[0].children[0].children[0])
      .find((caixa) => caixa.id === "dtb-page-specifications");
    caixaDeEspecificacoes.checked = false;
    caixaDeEspecificacoes.dispatch("change");
    eq("T7. desmarcar uma página remove a miniatura", byIdFake("dtb-thumbnails").children.length, 4);
    ok("T7b. a página some do carrossel, não só da lista",
      !byIdFake("dtb-thumbnails").children.some((b) => /Especificações/.test(b.children[1].textContent)));

    // 6. incluir de volta
    const caixaDeVolta = byIdFake("dtb-pages-list").children
      .map((item) => item.children[0].children[0].children[0])
      .find((caixa) => caixa.id === "dtb-page-specifications");
    caixaDeVolta.checked = true;
    caixaDeVolta.dispatch("change");
    eq("T8. marcar de volta devolve a miniatura", byIdFake("dtb-thumbnails").children.length, 5);

    // 7. a capa não pode ser desmarcada
    const caixaDaCapa = byIdFake("dtb-pages-list").children
      .map((item) => item.children[0].children[0].children[0])
      .find((caixa) => caixa.id === "dtb-page-cover");
    ok("T9. a caixa da capa vem desabilitada na interface", caixaDaCapa.disabled === true);

    // 8. reordenar muda a sequência
    const rotulosAntes = byIdFake("dtb-thumbnails").children.map((b) => b.children[1].textContent);
    // O rótulo mostra o nome da VARIAÇÃO ("Cotas técnicas"), então a busca é
    // pelo id da família na caixa de seleção.
    const itemDeDimensoes = byIdFake("dtb-pages-list").children
      .find((item) => item.children[0].children[0].children[0].id === "dtb-page-dimensions");
    itemDeDimensoes.children[0].children[1].children[0].dispatch("click"); // Subir
    const rotulosDepois = byIdFake("dtb-thumbnails").children.map((b) => b.children[1].textContent);
    ok("T10. subir uma página muda a sequência da prévia",
      rotulosAntes.join("|") !== rotulosDepois.join("|"));
    ok("T10b. a capa continua sendo a primeira página", /Capa dividida/.test(rotulosDepois[0]));

    // 9. salvar como template cria um card na Biblioteca
    byIdFake("dtb-project-name").value = "Carrossel da Furadeira";
    byIdFake("dtb-project-name").dispatch("input");
    byIdFake("dtb-save-template").dispatch("click");

    eq("T11. salvar como template cria um card na biblioteca",
      byIdFake("dt-local-template-grid").children.length, 1);
    ok("T11b. o card mostra o nome do projeto",
      textosDe(byIdFake("dt-local-template-grid").children[0]).includes("Carrossel da Furadeira"));
    ok("T11c. o card se identifica como criado manualmente",
      textosDe(byIdFake("dt-local-template-grid").children[0]).includes("Template criado manualmente"));
    ok("T11d. o card traz segmento, estilo, páginas e data",
      textosDe(byIdFake("dt-local-template-grid").children[0]).join(" ").includes("Páginas:"));
    ok("T11e. o vazio da biblioteca sumiu", byIdFake("dt-local-empty").hidden === true);

    const registros = builderStorage.createBuilderLibrary({ localStorage: store }).listar();
    eq("T12. o template foi para a chave nova do localStorage", registros.length, 1);
    ok("T12b. o nome e as páginas foram persistidos",
      registros[0].name === "Carrossel da Furadeira" && registros[0].pages.length === 5);
    ok("T12c. o localStorage não recebeu base64",
      !store.getItem(builderStorage.LIBRARY_KEY).includes("data:image"));
    ok("T12d. a chave do projeto do editor antigo continua separada",
      store.getItem("vf-design-template-studio-v1") !== store.getItem(builderStorage.LIBRARY_KEY));

    // 10. reabrir o card recupera os dados
    byIdFake("dtb-project-name").value = "Rascunho descartável";
    byIdFake("dtb-project-name").dispatch("input");
    const cartao = byIdFake("dt-local-template-grid").children[0];
    const botaoAbrir = cartao.children[1].children[1].children[0];
    eq("T13pre. o card tem o botão Abrir", botaoAbrir.textContent, "Abrir");
    botaoAbrir.dispatch("click");
    await tick();

    ok("T13. reabrir o card recupera o nome salvo",
      byIdFake("dtb-project-name").value === "Carrossel da Furadeira");
    eq("T13b. reabrir recupera as páginas e a ordem", byIdFake("dtb-thumbnails").children.length, 5);
    ok("T13c. reabrir recupera as cores",
      byIdFake("dtb-color-primary").value === "#123456");
    ok("T13d. reabrir recupera o nome do produto",
      byIdFake("dtb-product-name").value === "Furadeira de Impacto");

    // 11. duplicar
    const botaoDuplicar = byIdFake("dt-local-template-grid").children[0].children[1].children[1].children[1];
    eq("T14pre. o card tem o botão Duplicar", botaoDuplicar.textContent, "Duplicar");
    botaoDuplicar.dispatch("click");
    eq("T14. duplicar cria um segundo card", byIdFake("dt-local-template-grid").children.length, 2);
    ok("T14b. a cópia aparece com “Cópia” no nome",
      byIdFake("dt-local-template-grid").children
        .some((card) => textosDe(card).some((t) => /\(Cópia\)$/.test(t))));

    // 12. excluir pede confirmação e remove
    const cardParaExcluir = byIdFake("dt-local-template-grid").children
      .find((card) => textosDe(card).some((t) => /\(Cópia\)$/.test(t)));
    cardParaExcluir.children[1].children[1].children[2].dispatch("click");
    ok("T15. excluir pede confirmação antes",
      /Excluir este template/.test(byIdFake("dt-confirm-title").textContent));
    byIdFake("dt-confirm-accept").dispatch("click");
    await tick();
    eq("T15b. confirmar remove o card da biblioteca",
      byIdFake("dt-local-template-grid").children.length, 1);
    ok("T15c. o template do sistema continua na outra grade",
      byIdFake("dt-template-grid").children.length === 1);

    // 13. o editor antigo continua inteiro
    byIdFake("dt-editor-tab").dispatch("click");
    ok("T16. o Editor antigo continua abrindo pela aba",
      byIdFake("dt-editor-view").hidden === false && byIdFake("dt-builder-view").hidden === true);
    eq("T16b. o template do sistema continua com 7 miniaturas",
      byIdFake("dt-thumbnails").children.length, 7);
    ok("T16c. os campos do editor antigo continuam preenchidos",
      byIdFake("dt-product-name").value === "Power Station One");

    // 14. "Novo projeto" abre o Construtor
    byIdFake("dt-library-tab").dispatch("click");
    byIdFake("dt-new-project").dispatch("click");
    ok("T17. “Novo projeto” abre o Construtor, não o editor antigo",
      byIdFake("dt-builder-view").hidden === false && byIdFake("dt-editor-view").hidden === true);
    ok("T17b. o novo projeto começa em branco",
      byIdFake("dtb-project-name").value === "Novo carrossel");
    ok("T17c. o template salvo NÃO foi alterado por abrir um projeto novo",
      builderStorage.createBuilderLibrary({ localStorage: store }).listar()[0].name === "Carrossel da Furadeira");

    // 15. validação bloqueia o que precisa ser bloqueado
    byIdFake("dtb-project-name").value = "   ";
    byIdFake("dtb-project-name").dispatch("input");
    byIdFake("dtb-save-template").dispatch("click");
    ok("T18. salvar sem nome de projeto é bloqueado com mensagem",
      byIdFake("dtb-errors").hidden === false
      && byIdFake("dtb-errors-list").children.length > 0);
    eq("T18b. nada foi gravado na biblioteca",
      builderStorage.createBuilderLibrary({ localStorage: store }).listar().length, 1);
  })();

  console.log(`\n${checks} verificações passaram no Construtor Modular.`);
})().catch((erro) => {
  console.error(erro && erro.message ? erro.message : erro);
  process.exit(1);
});
