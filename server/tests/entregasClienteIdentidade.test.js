// server/tests/entregasClienteIdentidade.test.js
//
// Auditoria de clientes/contas, seção "Financeiro": processar um fechamento
// para o Cliente A, trocar o seletor para B e salvar não podia mais gravar
// o payload de A como entrega de B. `payload_json.cliente.slug` é a
// identidade congelada em Portal/financeiro.js no momento do cálculo
// (json._vf_meta → payload.cliente); o backend precisa recusar quando ela
// diverge do cliente_id/slug que está sendo persistido — mesmo que a UI
// tenha sido contornada.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}
async function rejeitaCom(label, promise, verificar) {
  let erro = null;
  try { await promise; } catch (e) { erro = e; }
  assert.ok(erro, `FALHOU (não rejeitou): ${label}`);
  if (verificar) assert.ok(verificar(erro), `FALHOU (erro inesperado): ${JSON.stringify(erro.payload || erro.message)}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const pool = require("../config/database");

class MockDb {
  constructor() {
    this.clientes = [
      { id: 1, slug: "cliente-a", nome: "Cliente A" },
      { id: 2, slug: "cliente-b", nome: "Cliente B" },
    ];
    this.entregas = [];
    this.nextId = 1;
  }
  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();

    if (q.startsWith("SELECT id, slug, nome FROM clientes WHERE id = $1")) {
      return { rows: this.clientes.filter((c) => c.id === Number(params[0])) };
    }
    if (q.startsWith("SELECT id, slug, nome FROM clientes WHERE slug = $1")) {
      return { rows: this.clientes.filter((c) => c.slug === params[0]) };
    }
    if (q.startsWith("INSERT INTO entregas_cliente")) {
      const entrega = {
        id: this.nextId++,
        tipo: params[0], cliente_id: params[1], cliente_slug: params[2], cliente_nome: params[3],
        titulo: params[4], periodo: params[5], status: params[6], token_publico: null,
        publicado: false, payload_json: params[7], origem_tipo: params[8], origem_id: params[9],
        created_by: params[10], expires_at: params[11],
      };
      this.entregas.push(entrega);
      return { rows: [{ ...entrega }] };
    }
    if (q.startsWith("SELECT * FROM entregas_cliente WHERE id = $1")) {
      return { rows: this.entregas.filter((e) => e.id === Number(params[0])) };
    }
    if (q.startsWith("UPDATE entregas_cliente SET")) {
      const idParam = Number(params[params.length - 1]);
      const entrega = this.entregas.find((e) => e.id === idParam);
      if (!entrega) return { rows: [] };
      // Parser genérico "coluna = $N" → aplica o bind correspondente,
      // independente da posição (payload_json e cliente_* podem vir juntos
      // ou isolados, deslocando os índices dos binds).
      for (const [, coluna, indice] of q.matchAll(/(\w+)\s*=\s*\$(\d+)/g)) {
        entrega[coluna] = params[Number(indice) - 1];
      }
      return { rows: [{ ...entrega }] };
    }
    throw new Error(`Query não mapeada no mock: ${q}`);
  }
}

function payloadDe(clienteSlug) {
  return {
    versao: 1, tipo: "fechamento_mensal", titulo: "Relatório de Fechamento Financeiro",
    periodo: "2026-08", marketplace: "meli",
    cliente: { slug: clienteSlug, nome: clienteSlug },
    summary: {},
  };
}

async function run() {
  const originalQuery = pool.query;
  const db = new MockDb();
  pool.query = (sql, params) => db.query(sql, params);

  try {
    delete require.cache[require.resolve("../services/entregasClienteService")];
    const { criarEntrega, atualizarEntrega } = require("../services/entregasClienteService");

    await rejeitaCom(
      "processar para A e salvar como B é rejeitado (IDENTIDADE_DIVERGENTE)",
      criarEntrega({
        userId: 1,
        body: { tipo: "fechamento_mensal", titulo: "Fechamento", cliente_slug: "cliente-b", payload_json: payloadDe("cliente-a") },
      }),
      (e) => e.statusCode === 409 && e.payload?.code === "IDENTIDADE_DIVERGENTE"
    );

    const salvo = await criarEntrega({
      userId: 1,
      body: { tipo: "fechamento_mensal", titulo: "Fechamento", cliente_slug: "cliente-a", payload_json: payloadDe("cliente-a") },
    });
    ok("salvar para o mesmo cliente do payload é aceito", salvo.entrega.cliente_slug === "cliente-a");

    await rejeitaCom(
      "PATCH trocando payload_json para outro cliente sem trocar cliente_slug é rejeitado",
      atualizarEntrega({ idRaw: salvo.entrega.id, body: { payload_json: payloadDe("cliente-b") } }),
      (e) => e.statusCode === 409 && e.payload?.code === "IDENTIDADE_DIVERGENTE"
    );

    const patchOk = await atualizarEntrega({
      idRaw: salvo.entrega.id,
      body: { cliente_slug: "cliente-b", payload_json: payloadDe("cliente-b") },
    });
    ok("PATCH trocando cliente_slug E payload_json juntos (reprocessado) é aceito", patchOk.entrega.cliente_slug === "cliente-b");

    console.log(`\n✓ entregasClienteService (identidade do Financeiro): ${checks} verificações`);
  } finally {
    pool.query = originalQuery;
    delete require.cache[require.resolve("../services/entregasClienteService")];
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
