// server/tests/designImageContrato.test.js
// -----------------------------------------------------------------------------
// Contratos do editor de imagem legado (design-image-editor.js) que ainda
// valem a pena guardar mesmo depois da refatoração da Biblioteca de
// Templates.
//
// A refatoração removeu o modal "die-*" (editor avançado de imagem: girar,
// filtros, sombra, remoção de fundo por IA) do fluxo principal de
// design-templates.html — a atividade pedia explicitamente que esse editor
// deixasse de ser parte obrigatória do fluxo. O arquivo continua no
// repositório por compatibilidade (nada o importa mais), então os contratos
// de wiring de tela (ids referenciados existem no HTML, ordem dos scripts,
// aria do modal, accept dos inputs antigos) foram removidos daqui — não há
// mais tela para eles descreverem. Ver server/tests/designSimpleEditor.test.js
// para os contratos do Editor Reduzido atual.
//
// O que continua sendo verificado, porque não depende da tela removida:
//   • a dependência de Fabric.js por CDN continua fixada, com SRI e
//     crossorigin (o Editor Reduzido usa o mesmo <script>);
//   • a matemática dos filtros do editor legado (brilho/contraste/saturação/
//     nitidez) continua correta;
//   • o CSS do editor legado continua na Fundação V2, sem cor solta;
//   • nenhum segredo/chave de API vazou para o frontend.

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
const editorJs = ler("design-image-editor.js");
const cssEditor = ler(path.join("css", "pages", "design-image-editor-v2.css"));
const model = require(path.join(portalDir, "design-image-model"));

(() => {
  console.log("\n=== Editor de imagem legado — contratos que sobrevivem à refatoração ===\n");

  /* 1. Dependência de CDN (a tela nova usa o mesmo script) */

  const tagFabric = /<script\s+([^>]*?)src="(https:\/\/cdn\.jsdelivr\.net\/npm\/fabric@[^"]+)"([^>]*?)>/s.exec(html);
  ok("1. a tela carrega o Fabric.js por CDN", Boolean(tagFabric));

  const atributos = `${tagFabric[1]} ${tagFabric[3]}`;
  const url = tagFabric[2];
  ok("2. a versão do Fabric está fixada (nada de latest/tag móvel)",
    /fabric@\d+\.\d+\.\d+\//.test(url) && !/latest|@next|@beta/.test(url));
  ok("3. a tag traz integridade SRI sha384", /integrity="sha384-[A-Za-z0-9+/=]{60,}"/.test(atributos));
  ok("4. a tag traz crossorigin anonymous (SRI exige)", /crossorigin="anonymous"/.test(atributos));
  ok("5. a tag traz referrerpolicy no-referrer", /referrerpolicy="no-referrer"/.test(atributos));

  const outrasCdns = [...html.matchAll(/src="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  eq("6. nenhuma outra dependência externa foi adicionada", outrasCdns, [url]);

  /* 2. Matemática dos filtros (independente da tela) */

  const contexto = { console, window: {}, globalThis: undefined };
  contexto.globalThis = contexto;
  contexto.window.VF_DESIGN_IMAGE_MODEL = model;
  vm.createContext(contexto);
  vm.runInContext(editorJs, contexto, { filename: "design-image-editor.js" });

  const api = contexto.window.VFDesignImageEditor;
  ok("7. o módulo do editor se registra em window.VFDesignImageEditor", Boolean(api && api.createDesignImageEditor));
  eq("8. o módulo publica o tamanho do palco", api.STAGE_SIZE, 1200);

  const interno = api.createDesignImageEditor({})._interno;

  eq("9. brilho 0 é neutro para o Fabric", interno.toFabricBrightness(0), 0);
  ok("10. brilho ±100 fica dentro da faixa aceita pelo Fabric (-1..1)",
    Math.abs(interno.toFabricBrightness(100)) <= 1 && Math.abs(interno.toFabricBrightness(-100)) <= 1);
  eq("11. contraste 0 é neutro", interno.toFabricContrast(0), 0);
  ok("12. contraste ±100 fica dentro da faixa do Fabric",
    Math.abs(interno.toFabricContrast(100)) <= 1 && Math.abs(interno.toFabricContrast(-100)) <= 1);
  eq("13. saturação 0 é neutra", interno.toFabricSaturation(0), 0);
  eq("14. saturação -100 chega no cinza total (-1)", interno.toFabricSaturation(-100), -1);
  eq("15. nitidez 0 não gera matriz de convolução", interno.sharpenMatrix(0), null);

  const matriz = interno.sharpenMatrix(50);
  eq("16. a matriz de nitidez é 3x3", matriz.length, 9);
  ok("17. a matriz de nitidez soma 1 (não altera o brilho médio)",
    Math.abs(matriz.reduce((soma, v) => soma + v, 0) - 1) < 1e-9);
  ok("18. o centro da matriz é positivo e as bordas negativas",
    matriz[4] > 0 && matriz[1] < 0 && matriz[3] < 0 && matriz[5] < 0 && matriz[7] < 0);
  eq("19. nitidez negativa é grampeada em 0 pelo modelo", interno.sharpenMatrix(-50), null);

  const forte = interno.sharpenMatrix(100);
  ok("20. nitidez máxima é mais forte que a intermediária", forte[4] > matriz[4]);

  /* 3. Fundação V2 no CSS do editor legado */

  const coresSoltas = (cssEditor.match(/#[0-9a-f]{3,8}\b/gi) || [])
    .filter((cor) => !/^#5a2a8f$/i.test(cor));
  eq("21. o CSS do editor não usa cor solta fora do roxo da marca", coresSoltas, []);
  ok("22. o CSS do editor usa os tokens da Fundação V2", (cssEditor.match(/var\(--vf-/g) || []).length > 60);
  ok("23. o CSS do editor respeita prefers-reduced-motion", cssEditor.includes("prefers-reduced-motion"));

  /* 4. Nenhum segredo no frontend */

  const frontendTodo = [editorJs, ler("design-image-api.js"), ler("design-image-storage.js")].join("\n");
  ok("24. nenhuma chave de API aparece no frontend",
    !/api[_-]?key\s*[:=]\s*["'][A-Za-z0-9_-]{16,}/i.test(frontendTodo));
  ok("25. nenhum token de provedor externo aparece no frontend",
    !/(sk-[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{30,})/.test(frontendTodo));
  ok("26. a IA é chamada pelo servidor VenForce, nunca por provedor externo",
    !/photoroom\.com|remove\.bg|api\.cloudinary\.com/i.test(frontendTodo));

  console.log(`\n${checks} verificações passaram nos contratos do editor de imagem legado.`);
})();
