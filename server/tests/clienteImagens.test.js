// server/tests/clienteImagens.test.js
//
// Imagem (avatar) do Cliente — tela Clientes e Contas.
//   1. validarImagem: só PNG/JPG/WebP de verdade (assinatura dos bytes), com
//      teto de tamanho.
//   2. listarImagens: admin vê todas; interno só as da própria carteira.
//   3. Rotas: auth por rota, gate de role ANTES do seam de carteira em
//      PUT/DELETE, e 401 sem token.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "venforce_secret_local";

const assert = require("assert");
const express = require("express");

let checks = 0;
function ok(label, cond) {
  assert.ok(cond, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
async function rejeita(fn, status) {
  try { await fn(); } catch (err) { return err.statusCode === status; }
  return false;
}

const service = require("../services/clienteImagens/clienteImagemService");

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const JPEG_HDR = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString("base64");
const WEBP_HDR = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]).toString("base64");

class FakeDb {
  constructor() { this.linhas = new Map(); this.sqls = []; }
  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();
    this.sqls.push(q);
    if (q.startsWith("CREATE TABLE IF NOT EXISTS cliente_imagens")) return { rows: [] };
    if (q.includes("authz:PORTFOLIO_ADMIN_ALL")) return { rows: [] };
    if (q.startsWith("SELECT cliente_id, imagem, atualizado_em FROM cliente_imagens WHERE cliente_id = ANY")) {
      const ids = params[0];
      return { rows: [...this.linhas.values()].filter((r) => ids.includes(r.cliente_id)) };
    }
    if (q.startsWith("SELECT cliente_id, imagem, atualizado_em FROM cliente_imagens")) return { rows: [...this.linhas.values()] };
    if (q.startsWith("INSERT INTO cliente_imagens")) {
      const row = { cliente_id: params[0], imagem: params[1], atualizado_em: new Date() };
      this.linhas.set(params[0], row);
      return { rows: [row] };
    }
    if (q.startsWith("DELETE FROM cliente_imagens")) {
      const tinha = this.linhas.delete(params[0]);
      return { rowCount: tinha ? 1 : 0, rows: [] };
    }
    throw new Error(`Query não mapeada: ${q}`);
  }
}

async function run() {
  // ── 1. validação ─────────────────────────────────────────────────────
  ok("PNG válido passa", service.validarImagem(`data:image/png;base64,${PNG_1PX}`).mime === "image/png");
  ok("JPEG válido passa", service.validarImagem(`data:image/jpeg;base64,${JPEG_HDR}`).mime === "image/jpeg");
  ok("WebP válido passa", service.validarImagem(`data:image/webp;base64,${WEBP_HDR}`).mime === "image/webp");
  ok("SVG recusado (pode carregar script)", await rejeita(() => service.validarImagem("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), 400));
  ok("mime declarado ≠ bytes reais recusado", await rejeita(() => service.validarImagem(`data:image/jpeg;base64,${PNG_1PX}`), 400));
  ok("texto qualquer recusado", await rejeita(() => service.validarImagem("https://exemplo.com/logo.png"), 400));
  ok("vazio recusado", await rejeita(() => service.validarImagem(""), 400));
  const grande = Buffer.concat([Buffer.from(PNG_1PX, "base64"), Buffer.alloc(service.MAX_BYTES)]).toString("base64");
  ok("acima de 300 KB → 413", await rejeita(() => service.validarImagem(`data:image/png;base64,${grande}`), 413));

  // ── 2. persistência + carteira ───────────────────────────────────────
  const db = new FakeDb();
  await service.salvarImagem(1, `data:image/png;base64,${PNG_1PX}`, 7, db);
  await service.salvarImagem(2, `data:image/png;base64,${PNG_1PX}`, 7, db);
  ok("salvar cria a tabela sob demanda (aditivo)", db.sqls.some((q) => q.startsWith("CREATE TABLE IF NOT EXISTS cliente_imagens")));
  ok("DDL apaga a imagem junto com o cliente", db.sqls.find((q) => q.startsWith("CREATE TABLE")).includes("ON DELETE CASCADE"));
  ok("salvar é upsert (trocar não duplica)", db.sqls.some((q) => q.includes("ON CONFLICT (cliente_id) DO UPDATE")));
  ok("cliente inválido → 400", await rejeita(() => service.salvarImagem("abc", `data:image/png;base64,${PNG_1PX}`, 7, db), 400));
  ok("imagem inválida não chega ao banco", await rejeita(() => service.salvarImagem(3, "data:image/gif;base64,R0lGOD", 7, db), 400) && !db.linhas.has(3));

  const admin = await service.listarImagens({ id: 1, role: "admin" }, db);
  ok("admin lista todas as imagens", admin.length === 2);

  // Interno: a carteira vem de resolvePortfolioClientes. Com enforcement OFF
  // ele enxerga os clientes ativos — o mock devolve só o cliente 2.
  const auth = require("../services/squads/authorizationService");
  const original = auth.resolvePortfolioClientes;
  auth.resolvePortfolioClientes = async () => [{ id: 2, slug: "b", nome: "B" }];
  const interno = await service.listarImagens({ id: 9, role: "user" }, db);
  ok("interno só recebe imagens da própria carteira", interno.length === 1 && interno[0].cliente_id === 2);
  auth.resolvePortfolioClientes = async () => [];
  ok("carteira vazia → nenhuma imagem", (await service.listarImagens({ id: 9, role: "user" }, db)).length === 0);
  auth.resolvePortfolioClientes = original;

  ok("remover apaga", (await service.removerImagem(1, db)).removida === true && !db.linhas.has(1));
  ok("remover o que não existe não quebra", (await service.removerImagem(1, db)).removida === false);

  // ── 3. rotas ─────────────────────────────────────────────────────────
  const router = require("../routes/clienteImagemRoutes");
  const handlers = (method, path) => {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
    return layer ? layer.route.stack.map((s) => s.handle.name || "(anon)") : null;
  };
  const get = handlers("get", "/");
  const put = handlers("put", "/:cliente");
  const del = handlers("delete", "/:cliente");
  ok("router NÃO usa authMiddleware global (router.use)", !router.stack.some((l) => !l.route && l.handle.name === "authMiddleware"));
  ok("GET exige login + role interna", get && get[0] === "authMiddleware" && get.includes("requireAutomacoesAccess"));
  for (const [nome, h] of [["PUT", put], ["DELETE", del]]) {
    ok(`${nome} exige login`, h && h[0] === "authMiddleware");
    ok(`${nome} passa pelo seam de carteira DEPOIS do gate de role`,
      h.indexOf("requireAutomacoesAccess") > -1 && h.indexOf("requireAutomacoesAccess") < h.indexOf("carteiraClienteGuard"));
  }

  const app = express();
  app.use(express.json({ limit: "20mb" }));
  app.use("/cliente-imagens", router);
  const servidor = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try {
    const base = `http://127.0.0.1:${servidor.address().port}/cliente-imagens`;
    ok("GET sem token → 401", (await fetch(base)).status === 401);
    ok("PUT sem token → 401", (await fetch(`${base}/x`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" })).status === 401);
    ok("DELETE sem token → 401", (await fetch(`${base}/x`, { method: "DELETE" })).status === 401);
  } finally {
    servidor.closeAllConnections?.();
    await new Promise((r) => servidor.close(r));
  }

  const index = require("fs").readFileSync(require("path").join(__dirname, "..", "index.js"), "utf8");
  ok("index.js monta /cliente-imagens", /app\.use\("\/cliente-imagens", clienteImagemRoutes\)/.test(index));

  console.log(`\nclienteImagens.test.js: ${checks} verificações passaram.`);
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
