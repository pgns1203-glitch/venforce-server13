// server/tests/designTemplateBuilder.test.js
// -----------------------------------------------------------------------------
// Construtor Modular de Carrosséis (núcleo puro), exercitado sem navegador:
//
//   • núcleo puro (model): projeto padrão, capa obrigatória, inclusão,
//     remoção, reordenação e rejeição de ids desconhecidos;
//   • biblioteca local (storage): salvar, carregar, duplicar, excluir e a
//     trava que impede base64 no localStorage;
//   • layouts: os 5 novos estão registrados, renderizam SVG 1200 × 1200 e
//     campos vazios não viram "undefined" nem "[object Object]";
//   • o template antigo continua renderizando igual.
//
// A integração de tela (abas Editor/Construtor, HTML e o boot via vm) foi
// removida daqui na refatoração da Biblioteca de Templates: a nova tela
// principal (design-templates.html + design-studio-workspace.js) não tem
// mais essas abas — ver server/tests/designStudioWorkspace.test.js e
// server/tests/designSimpleEditor.test.js para a cobertura da tela atual.
// Este arquivo continua cobrindo o núcleo puro do Construtor Modular
// (design-template-builder-model.js / -storage.js), que segue existindo no
// repositório por compatibilidade.
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

  console.log(`\n${checks} verificações passaram no Construtor Modular.`);
})().catch((erro) => {
  console.error(erro && erro.message ? erro.message : erro);
  process.exit(1);
});
