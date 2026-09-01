process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const XLSX = require("xlsx");
const {
  filtrarIdsMlbUnicos,
  buscarTodosMlbsAtivos,
  construirWorkbookModeloBaseCustos,
} = require("../services/automacoes/modeloBaseCustosService");

async function main() {
  const ids = filtrarIdsMlbUnicos([
    "MLB1234567890",
    "mlb1234567890",
    " MLB9876543210 ",
    "MLBU111",
    "MLA222",
    "123456",
    null,
  ]);
  assert.deepStrictEqual(ids, ["MLB1234567890", "MLB9876543210"]);

  const buffer = construirWorkbookModeloBaseCustos(ids);
  const workbook = XLSX.read(buffer, { type: "buffer", cellNF: true });
  assert.deepStrictEqual(workbook.SheetNames, ["Base de Custos"]);

  const sheet = workbook.Sheets["Base de Custos"];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
  assert.deepStrictEqual(rows, [
    ["MLB", "Custo", "Imposto", "Taxa Fixa"],
    ["MLB1234567890", "", "", ""],
    ["MLB9876543210", "", "", ""],
  ]);
  assert.strictEqual(sheet.A2.t, "s");
  assert.strictEqual(sheet.A2.z, "@");
  assert.strictEqual(sheet.A3.t, "s");

  const chamadas = [];
  const paginas = [
    { ok: true, status: 200, data: { results: ["MLB1", "MLB2", "MLBU3"], scroll_id: "scroll-1" } },
    { ok: true, status: 200, data: { results: ["mlb2", "MLB4", "MLA5"], scroll_id: "scroll-1" } },
    { ok: true, status: 200, data: { results: [], scroll_id: "scroll-1" } },
  ];
  const mlFetchFn = async (clienteId, path, options) => {
    chamadas.push({ clienteId, path, options });
    return paginas.shift();
  };
  const ativos = await buscarTodosMlbsAtivos({ clienteId: 7, mlUserId: "99", mlFetchFn });
  assert.deepStrictEqual(ativos, ["MLB1", "MLB2", "MLB4"]);
  assert.strictEqual(chamadas.length, 3);
  assert.ok(chamadas.every((c) => c.path.startsWith("/users/99/items/search?")));
  assert.ok(chamadas.every((c) => c.path.includes("status=active")));
  assert.ok(chamadas.every((c) => c.options.noRefresh === true));
  assert.ok(chamadas.every((c) => c.options.mlUserId === "99"));

  // Regressão conceitual: o seller usado no path e o mlUserId usado para
  // escolher o token (via options.mlUserId) devem ser sempre o mesmo valor.
  // Se divergirem, o ML responde 403 "Searching another user items is
  // restricted" porque o token pertence a outra conta.
  assert.ok(
    chamadas.every((c) => {
      const sellerNoPath = c.path.match(/^\/users\/([^/]+)\/items\/search/)?.[1];
      return sellerNoPath != null && String(c.options.mlUserId) === sellerNoPath;
    }),
    "seller no path e mlUserId usado para o token devem ser o mesmo"
  );

  console.log("modeloBaseCustos: ok");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
