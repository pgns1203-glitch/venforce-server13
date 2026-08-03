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

const root = path.join(__dirname, "..", "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const service = require("../services/designStudio/designStudioService");
const apiLib = require("../../Portal/design-studio-api");

(async () => {
  console.log("\n=== Estúdio por cliente — contratos ===\n");

  const schema = read("server/sql/design_studio_schema.sql");
  ["design_client_profiles", "design_templates", "design_artworks", "design_template_versions", "design_artwork_versions"]
    .forEach((table) => ok(`schema cria ${table}`, schema.includes(`CREATE TABLE IF NOT EXISTS ${table}`)));
  ok("templates referenciam o cliente existente", /design_templates[\s\S]+cliente_id INTEGER NOT NULL REFERENCES clientes\(id\)/.test(schema));
  ok("artes mantêm vínculo opcional com template", /template_id BIGINT REFERENCES design_templates\(id\) ON DELETE SET NULL/.test(schema));
  ok("documentos e versões são persistidos em JSONB", (schema.match(/document_json JSONB/g) || []).length >= 4);

  const routes = read("server/routes/designStudioRoutes.js");
  ok("todas as rotas exigem JWT e acesso de design", routes.includes("router.use(authMiddleware, requireDesignAccess)"));
  ["gerar-templates", "arquivar", "duplicar", "versoes", "identidade"]
    .forEach((action) => ok(`rota expõe ${action}`, routes.includes(action)));

  const generated = service._private.generatedDocument(7, { id: 9, nome: "Cliente Real" }, {
    brand_name: "Marca Real",
    identity: { primary: "#112233", logo: { dataUrl: "data:image/png;base64,AA==" }, notes: "não entra na paleta" },
  });
  eq("geração referencia cliente existente", generated.clienteId, 9);
  eq("geração usa a marca cadastrada", generated.marcaNome, "Marca Real");
  eq("geração aplica a cor da identidade", generated.palette.primary, "#112233");
  ok("geração não inventa produto", generated.product.name === "" && generated.product.subtitle === "");
  ok("geração oferece composição completa e editável", generated.pages.length === 5 && generated.pages.every((page) => page.family && page.rendererId));
  ok("metadados da identidade não vazam para a paleta", !Object.hasOwn(generated.palette, "notes"));

  const calls = [];
  const api = apiLib.createDesignStudioApi({
    baseUrl: "https://api.example.test/",
    getToken: () => "jwt-test",
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ ok: true, item: { id: 1 } }) };
    },
  });
  await api.createItem(3, "templates", { name: "Base", document: {} });
  eq("cliente e tipo fazem parte da URL de criação", calls[0].url, "https://api.example.test/design/studio/clientes/3/templates");
  eq("JWT acompanha chamadas persistentes", calls[0].options.headers.Authorization, "Bearer jwt-test");
  eq("criação usa POST", calls[0].options.method, "POST");
  await api.restoreVersion(3, "artworks", 8, 4);
  ok("restauração identifica item e versão", calls[1].url.endsWith("/clientes/3/artworks/8/versoes/4/restaurar"));

  const html = read("Portal/design-templates.html");
  const workspace = read("Portal/design-studio-workspace.js");
  // A refatoração da Biblioteca de Templates removeu o gerador de opções
  // ("Gerar opções"/quantidade) e o seletor global de conta para novas
  // artes da interface principal — a conta agora vem do filtro da
  // biblioteca (dtl-account-filter) quando o usuário cria uma arte.
  ["ds-client-select", "ds-account-list", "ds-grid", "ds-save-identity", "dtl-import", "dtl-new-blank", "dtl-origin-filter"]
    .forEach((id) => ok(`interface contém ${id}`, html.includes(`id="${id}"`)));
  ["ds-generate", "ds-art-account", "ds-create-empty", "ds-generate-count"]
    .forEach((id) => ok(`interface NÃO contém mais ${id} (fluxo antigo removido)`, !html.includes(`id="${id}"`)));
  ok("interface separa Templates, Artes e Arquivados", ["templates", "artworks", "archived"].every((tab) => html.includes(`data-ds-tab="${tab}"`)));
  ok("arte nasce de cópia do template pelo backend", workspace.includes("templateId: item.id") && workspace.includes("document: {}"));
  ok("salvar passa pelo acervo compartilhado", workspace.includes("saveDocument") && workspace.includes("api.updateItem"));

  const productFiles = [
    "Portal/design-templates.html", "Portal/design-templates.js", "Portal/design-template-builder.js",
    "Portal/design-template-builder-model.js", "Portal/design-studio-workspace.js",
  ].map(read).join("\n");
  const forbiddenTerm = ["e", "quipe"].join("");
  ok("nova experiência usa linguagem organizacional neutra", !new RegExp(forbiddenTerm, "i").test(productFiles));

  console.log(`\n${checks} verificações concluídas.\n`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
