// server/tests/designImageContrato.test.js
// Contratos que um navegador pegaria só em runtime, verificados aqui:
//
//   • todo id usado por byId(...) no JS existe no HTML da tela;
//   • a dependência de CDN está com versão fixa, SRI e crossorigin;
//   • os scripts do editor entram na ordem certa;
//   • a matemática dos filtros do editor respeita as faixas do modelo;
//   • a exportação não usa imagem de outra origem (canvas não é contaminado).

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
const ler = (relativo) => fs.readFileSync(path.join(portalDir, relativo), "utf8");

const html = ler("design-templates.html");
const telaJs = ler("design-templates.js");
const editorJs = ler("design-image-editor.js");
const cssEditor = ler(path.join("css", "pages", "design-image-editor-v2.css"));
const model = require(path.join(portalDir, "design-image-model"));

function idsDoHtml(fonte) {
  const encontrados = new Set();
  const regex = /\sid="([^"]+)"/g;
  let match;
  while ((match = regex.exec(fonte)) !== null) encontrados.add(match[1]);
  return encontrados;
}

function idsReferenciados(fonte) {
  const encontrados = new Set();
  const regex = /byId\("([^"]+)"\)/g;
  let match;
  while ((match = regex.exec(fonte)) !== null) encontrados.add(match[1]);
  // O editor também monta ids por template literal em listas explícitas.
  const listas = /\["(die-[^"]+)",\s*"(die-[^"]+)",\s*"(die-[^"]+)",\s*"(die-[^"]+)"\]/g;
  while ((match = listas.exec(fonte)) !== null) {
    for (let i = 1; i <= 4; i += 1) encontrados.add(match[i]);
  }
  return encontrados;
}

(() => {
  console.log("\n=== Editor de imagem — contratos da tela ===\n");

  const idsDisponiveis = idsDoHtml(html);

  /* 1. Ids referenciados pelo JS existem no HTML */

  const idsEditor = [...idsReferenciados(editorJs)];
  const faltandoEditor = idsEditor.filter((id) => !idsDisponiveis.has(id));
  eq("1. todo id usado pelo editor existe no HTML", faltandoEditor, []);
  ok("2. o editor referencia um conjunto relevante de controles", idsEditor.length > 30);

  // Ids construídos dinamicamente na tela (dt-{kind}-state etc.) não entram
  // no regex; conferidos explicitamente logo abaixo.
  const idsTela = [...idsReferenciados(telaJs)];
  const faltandoTela = idsTela.filter((id) => !idsDisponiveis.has(id));
  eq("3. todo id usado pela tela existe no HTML", faltandoTela, []);

  ["dt-logo-state", "dt-logo-preview", "dt-logo-filename", "dt-product-state",
    "dt-product-preview", "dt-product-filename", "dt-logo-file", "dt-product-file"]
    .forEach((id) => {
      ok(`4. id dinâmico "${id}" existe no HTML`, idsDisponiveis.has(id));
    });

  ["dt-edit-product", "dt-restore-product", "dt-product-edit-note", "dt-product-lowres"]
    .forEach((id) => {
      ok(`5. controle novo "${id}" existe no HTML`, idsDisponiveis.has(id));
    });

  /* 2. Dependência de CDN */

  const tagFabric = /<script\s+([^>]*?)src="(https:\/\/cdn\.jsdelivr\.net\/npm\/fabric@[^"]+)"([^>]*?)>/s.exec(html);
  ok("6. a tela carrega o Fabric.js por CDN", Boolean(tagFabric));

  const atributos = `${tagFabric[1]} ${tagFabric[3]}`;
  const url = tagFabric[2];
  ok("7. a versão do Fabric está fixada (nada de latest/tag móvel)",
    /fabric@\d+\.\d+\.\d+\//.test(url) && !/latest|@next|@beta/.test(url));
  ok("8. a tag traz integridade SRI sha384", /integrity="sha384-[A-Za-z0-9+/=]{60,}"/.test(atributos));
  ok("9. a tag traz crossorigin anonymous (SRI exige)", /crossorigin="anonymous"/.test(atributos));
  ok("10. a tag traz referrerpolicy no-referrer", /referrerpolicy="no-referrer"/.test(atributos));

  const outrasCdns = [...html.matchAll(/src="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  eq("11. nenhuma outra dependência externa foi adicionada", outrasCdns, [url]);

  /* 3. Ordem de carregamento dos scripts */

  const ordem = ["fabric@", "design-image-model.js", "design-image-storage.js",
    "design-image-api.js", "design-image-editor.js", "design-templates.js"];
  const posicoes = ordem.map((trecho) => html.indexOf(trecho));
  ok("12. todos os scripts do editor estão na página", posicoes.every((p) => p > 0));
  ok("13. os scripts carregam na ordem de dependência",
    posicoes.every((p, i) => i === 0 || p > posicoes[i - 1]));

  ok("14. a folha de estilo do editor é carregada", html.includes("css/pages/design-image-editor-v2.css"));

  /* 4. Segurança do upload na tela */

  ok("15. o input de produto não aceita mais qualquer image/*",
    /id="dt-product-file"[^>]*accept="image\/png,image\/jpeg,image\/webp"/.test(html));
  ok("16. o input de logo também restringe os formatos",
    /id="dt-logo-file"[^>]*accept="image\/png,image\/jpeg,image\/webp"/.test(html));
  ok("17. nenhum input de imagem aceita SVG", !/accept="[^"]*svg/i.test(html));

  /* 5. Acessibilidade do modal */

  ok("18. o modal do editor declara role dialog e aria-modal",
    /id="die-modal"[^>]*role="dialog"/.test(html) && /id="die-modal"[^>]*aria-modal="true"/.test(html));
  ok("19. o modal do editor tem rótulo acessível", /id="die-modal"[^>]*aria-labelledby="die-title"/.test(html));
  ok("20. a barra de ferramentas é anunciada como toolbar", /class="die-toolbar" role="toolbar"/.test(html));
  ok("21. os botões de alternância declaram aria-pressed",
    (html.match(/id="die-(flip-x|flip-y|compare|crop|bg-transparent|bg-color)"[^>]*aria-pressed=/g) || []).length >= 6);
  ok("22. o editor prende o foco com Tab", editorJs.includes("prenderFoco") && editorJs.includes('evento.key !== "Tab"'));
  ok("23. o editor fecha com Escape", editorJs.includes('evento.key === "Escape"'));
  ok("24. o editor confirma antes de descartar alterações", editorJs.includes("tentarCancelar") && editorJs.includes("confirmar("));

  /* 6. Higiene de runtime */

  ok("25. o editor descarta a instância do Fabric ao fechar", editorJs.includes("canvas.dispose()"));
  ok("26. o editor remove todos os listeners que registrou", editorJs.includes("removerListeners"));
  ok("27. o editor cancela o rAF pendente ao fechar", editorJs.includes("cancelAnimationFrame"));
  ok("28. o editor faz debounce dos filtros caros", editorJs.includes("FILTER_DEBOUNCE_MS"));
  ok("29. o editor usa requestAnimationFrame nos controles contínuos", editorJs.includes("requestAnimationFrame"));
  ok("30. a tela libera os Object URLs que cria", telaJs.includes("URL.revokeObjectURL"));

  /* 7. Exportação sem contaminar o canvas */

  ok("31. a imagem entra no Fabric com crossOrigin anonymous", editorJs.includes('crossOrigin: "anonymous"'));
  ok("32. o editor só aceita data URL validada pelo modelo",
    editorJs.includes("model.isDataImageUrl(entrada.dataUrl)"));
  ok("33. o resultado exportado é validado antes de sair do editor",
    editorJs.includes("model.isDataImageUrl(dataUrl)"));
  ok("34. a peça continua sendo exportada em 1200 x 1200",
    telaJs.includes("canvas.width = 1200") && telaJs.includes("canvas.height = 1200"));
  ok("35. o palco do editor tem a mesma resolução da peça", /STAGE_SIZE\s*=\s*1200/.test(editorJs));
  ok("36. a exportação do editor não usa multiplicador (1 px = 1 px)", /multiplier:\s*1\b/.test(editorJs));
  ok("37. o retina scaling é desligado para o backstore ficar exato",
    /enableRetinaScaling:\s*false/.test(editorJs));
  ok("38. fundo transparente exporta PNG; fundo sólido exporta JPEG",
    editorJs.includes('format: transparente ? "png" : "jpeg"'));

  /* 8. Matemática dos filtros */

  const contexto = { console, window: {}, globalThis: undefined };
  contexto.globalThis = contexto;
  contexto.window.VF_DESIGN_IMAGE_MODEL = model;
  vm.createContext(contexto);
  vm.runInContext(editorJs, contexto, { filename: "design-image-editor.js" });

  const api = contexto.window.VFDesignImageEditor;
  ok("39. o módulo do editor se registra em window.VFDesignImageEditor", Boolean(api && api.createDesignImageEditor));
  eq("40. o módulo publica o tamanho do palco", api.STAGE_SIZE, 1200);

  const interno = api.createDesignImageEditor({})._interno;

  eq("41. brilho 0 é neutro para o Fabric", interno.toFabricBrightness(0), 0);
  ok("42. brilho ±100 fica dentro da faixa aceita pelo Fabric (-1..1)",
    Math.abs(interno.toFabricBrightness(100)) <= 1 && Math.abs(interno.toFabricBrightness(-100)) <= 1);
  eq("43. contraste 0 é neutro", interno.toFabricContrast(0), 0);
  ok("44. contraste ±100 fica dentro da faixa do Fabric",
    Math.abs(interno.toFabricContrast(100)) <= 1 && Math.abs(interno.toFabricContrast(-100)) <= 1);
  eq("45. saturação 0 é neutra", interno.toFabricSaturation(0), 0);
  eq("46. saturação -100 chega no cinza total (-1)", interno.toFabricSaturation(-100), -1);
  eq("47. nitidez 0 não gera matriz de convolução", interno.sharpenMatrix(0), null);

  const matriz = interno.sharpenMatrix(50);
  eq("48. a matriz de nitidez é 3x3", matriz.length, 9);
  ok("49. a matriz de nitidez soma 1 (não altera o brilho médio)",
    Math.abs(matriz.reduce((soma, v) => soma + v, 0) - 1) < 1e-9);
  ok("50. o centro da matriz é positivo e as bordas negativas",
    matriz[4] > 0 && matriz[1] < 0 && matriz[3] < 0 && matriz[5] < 0 && matriz[7] < 0);
  eq("51. nitidez negativa é grampeada em 0 pelo modelo", interno.sharpenMatrix(-50), null);

  const forte = interno.sharpenMatrix(100);
  ok("52. nitidez máxima é mais forte que a intermediária", forte[4] > matriz[4]);

  /* 9. Fundação V2 no CSS */

  const coresSoltas = (cssEditor.match(/#[0-9a-f]{3,8}\b/gi) || [])
    .filter((cor) => !/^#5a2a8f$/i.test(cor));
  eq("53. o CSS do editor não usa cor solta fora do roxo da marca", coresSoltas, []);
  ok("54. o CSS do editor usa os tokens da Fundação V2", (cssEditor.match(/var\(--vf-/g) || []).length > 60);
  ok("55. o CSS do editor respeita prefers-reduced-motion", cssEditor.includes("prefers-reduced-motion"));
  ok("56. o CSS do editor tem quebras responsivas", (cssEditor.match(/@media \(max-width/g) || []).length >= 2);

  // O #dt-confirm-overlay vem ANTES do #die-overlay no DOM. Com z-index igual,
  // o editor cobriria a confirmação de "descartar alterações".
  ok("57. o overlay do editor fica abaixo do modal de confirmação da tela",
    /\.die-overlay\s*\{[^}]*z-index:\s*calc\(var\(--vf-z-modal\)\s*-\s*1\)/s.test(cssEditor));
  ok("58. a confirmação da tela realmente vem antes do editor no DOM",
    html.indexOf('id="dt-confirm-overlay"') < html.indexOf('id="die-overlay"'));

  /* 10. Nenhum segredo no frontend */

  const frontendTodo = [telaJs, editorJs, ler("design-image-api.js"), ler("design-image-storage.js"), html].join("\n");
  ok("59. nenhuma chave de API aparece no frontend",
    !/api[_-]?key\s*[:=]\s*["'][A-Za-z0-9_-]{16,}/i.test(frontendTodo));
  ok("60. nenhum token de provedor externo aparece no frontend",
    !/(sk-[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{30,})/.test(frontendTodo));
  ok("61. a IA é chamada pelo servidor VenForce, nunca por provedor externo",
    !/photoroom\.com|remove\.bg|api\.cloudinary\.com/i.test(frontendTodo));
  ok("62. o token do Portal continua vindo do localStorage, não do código",
    telaJs.includes('localStorage.getItem(TOKEN_KEY)'));

  console.log(`\n${checks} verificações passaram nos contratos da tela.`);
})();
