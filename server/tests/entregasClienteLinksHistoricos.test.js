// server/tests/entregasClienteLinksHistoricos.test.js
//
// Regressão: o link público de um fechamento HISTÓRICO não pode mudar de
// significado quando um fechamento novo é criado para o mesmo cliente/operação.
//
// Causa raiz (entregasClienteService.criarEntrega): o link público é o
// `token_publico` de UMA linha de `entregas_cliente`. Reprocessar a mesma
// competência com `substituir: true` fazia UPDATE do `payload_json` dessa
// mesma linha preservando o token — então o link A passava a abrir os números
// do fechamento B. Aqui o banco é simulado com estado real (INSERT/UPDATE/
// SELECT executam de verdade), para o cenário rodar de ponta a ponta pelas
// funções reais do service: criar A → publicar A → guardar link A → criar B →
// publicar B → reabrir A.

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/vf-test";

const assert = require("assert");
const pool = require("../config/database");
const servico = require("../services/entregasClienteService");

let checks = 0;
function ok(label, condition) {
  assert.ok(condition, `FALHOU: ${label}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const CLIENTES = [{ id: 1, slug: "n97", nome: "N97" }];
const CONTAS = [
  { id: 10, cliente_id: 1, nome: "ML Principal", ativo: true },
  { id: 11, cliente_id: 1, nome: "ML Secundaria", ativo: true },
];

function criarBanco() {
  const linhas = [];
  let proximoId = 1;
  let relogio = 0;
  const copia = (e) => ({ ...e });

  return {
    linhas,
    async query(sql, params = []) {
      const q = String(sql).replace(/\s+/g, " ").trim();

      if (q.startsWith("SELECT id, cliente_id, nome, ativo FROM cliente_contas WHERE id = $1")) {
        const c = CONTAS.find((x) => x.id === Number(params[0]));
        return { rows: c ? [c] : [] };
      }
      if (q.startsWith("SELECT id, slug, nome FROM clientes WHERE")) {
        const c = CLIENTES.find((x) => x.id === Number(params[0]) || x.slug === String(params[0]));
        return { rows: c ? [c] : [] };
      }

      // Busca de duplicata da competência (D4): aplica de verdade o WHERE e
      // o ORDER BY created_at DESC, id DESC LIMIT 1.
      if (q.startsWith("SELECT id, status, publicado, token_publico, created_at FROM entregas_cliente")) {
        const [tipo, clienteId, periodo] = params;
        const semConta = /cliente_conta_id IS NULL/.test(q);
        const conta = semConta ? null : params[3];
        const achadas = linhas
          .filter((e) => e.tipo === tipo && e.cliente_id === clienteId && e.periodo === periodo
            && (semConta ? e.cliente_conta_id == null : e.cliente_conta_id === conta))
          .sort((a, b) => b.created_at - a.created_at || b.id - a.id);
        return { rows: achadas.slice(0, 1).map(copia) };
      }

      if (q.startsWith("INSERT INTO entregas_cliente")) {
        const entrega = {
          id: proximoId++,
          tipo: params[0], cliente_id: params[1], cliente_slug: params[2], cliente_nome: params[3],
          titulo: params[4], periodo: params[5], status: params[6], publicado: false,
          payload_json: params[7], origem_tipo: params[8], origem_id: params[9],
          created_by: params[10], expires_at: params[11], cliente_conta_id: params[12] ?? null,
          token_publico: null, published_at: null, created_at: ++relogio, updated_at: relogio,
        };
        linhas.push(entrega);
        return { rows: [copia(entrega)] };
      }

      if (q.startsWith("SELECT * FROM entregas_cliente WHERE id = $1")) {
        return { rows: linhas.filter((e) => e.id === Number(params[0])).map(copia) };
      }
      if (q.startsWith("SELECT id, token_publico FROM entregas_cliente WHERE id = $1")) {
        return { rows: linhas.filter((e) => e.id === Number(params[0])).map(copia) };
      }

      // despublicarEntrega
      if (q.startsWith("SELECT id FROM entregas_cliente WHERE id = $1")) {
        return { rows: linhas.filter((e) => e.id === Number(params[0])).map(copia) };
      }
      if (q.startsWith("UPDATE entregas_cliente SET publicado = false")) {
        const entrega = linhas.find((e) => e.id === Number(params[0]));
        entrega.publicado = false;
        entrega.status = "rascunho";
        return { rows: [copia(entrega)] };
      }

      // publicarEntrega
      if (q.startsWith("UPDATE entregas_cliente SET publicado = true")) {
        const entrega = linhas.find((e) => e.id === Number(params[1]));
        entrega.publicado = true;
        entrega.status = "publicado";
        entrega.token_publico = params[0];
        entrega.published_at = entrega.published_at || relogio;
        return { rows: [copia(entrega)] };
      }

      // atualizarEntrega: "UPDATE ... SET col = $N, ... WHERE id = $último"
      if (q.startsWith("UPDATE entregas_cliente SET")) {
        const entrega = linhas.find((e) => e.id === Number(params[params.length - 1]));
        if (!entrega) return { rows: [] };
        for (const m of q.matchAll(/(\w+) = \$(\d+)/g)) {
          if (m[1] === "id") continue;
          entrega[m[1]] = params[Number(m[2]) - 1];
        }
        return { rows: [copia(entrega)] };
      }

      // buscarEntregaPublicaPorToken
      if (q.includes("FROM entregas_cliente") && q.includes("WHERE token_publico = $1")) {
        const achadas = linhas.filter((e) => e.token_publico === params[0] && e.publicado === true);
        return { rows: achadas.slice(0, 1).map(copia) };
      }

      throw new Error(`mock sem tratamento para: ${q.slice(0, 120)}`);
    },
  };
}

async function comBanco(fn) {
  const original = pool.query;
  const db = criarBanco();
  pool.query = (sql, params) => db.query(sql, params);
  try {
    await fn(db);
  } finally {
    pool.query = original;
  }
}

function corpo({ periodo, marca, conta = 10, extra = {} }) {
  return {
    tipo: "fechamento_mensal",
    titulo: `Fechamento ${periodo}`,
    periodo,
    cliente_slug: "n97",
    cliente_conta_id: conta,
    status: "rascunho",
    payload_json: { versao: 1, cliente: { slug: "n97" }, marca },
    origem_tipo: "fechamento_financeiro",
    ...extra,
  };
}

async function criarEPublicar(body) {
  const { entrega } = await servico.criarEntrega({ userId: 7, body });
  const pub = await servico.publicarEntrega({ idRaw: entrega.id });
  return { id: entrega.id, token: pub.entrega.token_publico };
}

async function abrirLink(token) {
  return (await servico.buscarEntregaPublicaPorToken({ tokenRaw: token })).entrega;
}

async function run() {
  // O cenário do bug: mesma competência reprocessada depois de publicada.
  await comBanco(async (db) => {
    const A = await criarEPublicar(corpo({ periodo: "2026-09", marca: "FECHAMENTO_A" }));
    ok("A foi publicado e ganhou link próprio", typeof A.token === "string" && A.token.length >= 32);

    // Fechamento B da MESMA competência/operação, depois de A publicado.
    const sem = servico.criarEntrega({ userId: 7, body: corpo({ periodo: "2026-09", marca: "FECHAMENTO_B" }) });
    let recusa = null;
    try { await sem; } catch (e) { recusa = e; }
    ok("sem 'substituir' continua 409 ENTREGA_JA_EXISTE (nada é gravado em silêncio)",
      recusa && recusa.statusCode === 409 && recusa.code === "ENTREGA_JA_EXISTE");

    const B = await criarEPublicar(corpo({ periodo: "2026-09", marca: "FECHAMENTO_B", extra: { substituir: true } }));

    ok("link A != link B", A.token !== B.token);
    ok("B é um registro independente de A", B.id !== A.id);
    ok("os dois fechamentos continuam salvos", db.linhas.length === 2);

    const abertoA = await abrirLink(A.token);
    ok("link A continua retornando o payload de A", abertoA.payload_json.marca === "FECHAMENTO_A");
    const abertoB = await abrirLink(B.token);
    ok("link B retorna o payload de B", abertoB.payload_json.marca === "FECHAMENTO_B");
  });

  // Controle: competência diferente nunca teve o problema e não pode regredir.
  await comBanco(async (db) => {
    const A = await criarEPublicar(corpo({ periodo: "2026-09", marca: "SET" }));
    const B = await criarEPublicar(corpo({ periodo: "2026-10", marca: "OUT" }));
    ok("competências diferentes: links diferentes", A.token !== B.token);
    ok("competências diferentes: A segue sendo A", (await abrirLink(A.token)).payload_json.marca === "SET");
    ok("competências diferentes: B segue sendo B", (await abrirLink(B.token)).payload_json.marca === "OUT");
    ok("competências diferentes: duas linhas", db.linhas.length === 2);
  });

  // Rascunho que nunca teve link: substituir continua atualizando no lugar
  // (não há link histórico a proteger e não se acumulam rascunhos).
  await comBanco(async (db) => {
    const { entrega } = await servico.criarEntrega({ userId: 7, body: corpo({ periodo: "2026-09", marca: "RASCUNHO_1" }) });
    const r = await servico.criarEntrega({
      userId: 7,
      body: corpo({ periodo: "2026-09", marca: "RASCUNHO_2", extra: { substituir: true } }),
    });
    ok("rascunho sem link: substituir atualiza a mesma linha", r.entrega.id === entrega.id && db.linhas.length === 1);
    ok("rascunho sem link: o payload novo vale", db.linhas[0].payload_json.marca === "RASCUNHO_2");
  });

  // Reprocessar de novo depois de B (ainda rascunho): atualiza B, não cria C,
  // e A segue intacto.
  await comBanco(async (db) => {
    const A = await criarEPublicar(corpo({ periodo: "2026-09", marca: "A" }));
    const { entrega: B } = await servico.criarEntrega({
      userId: 7, body: corpo({ periodo: "2026-09", marca: "B1", extra: { substituir: true } }),
    });
    const r = await servico.criarEntrega({
      userId: 7, body: corpo({ periodo: "2026-09", marca: "B2", extra: { substituir: true } }),
    });
    ok("reprocessar B (rascunho) atualiza B, sem criar C", r.entrega.id === B.id && db.linhas.length === 2);
    ok("B tem o payload mais recente", db.linhas.find((e) => e.id === B.id).payload_json.marca === "B2");
    ok("A continua intacto", (await abrirLink(A.token)).payload_json.marca === "A");
  });

  // Fechamento despublicado já teve link divulgado: também não é reescrito.
  await comBanco(async (db) => {
    const A = await criarEPublicar(corpo({ periodo: "2026-09", marca: "A" }));
    await servico.despublicarEntrega({ idRaw: A.id });
    const B = await criarEPublicar(corpo({ periodo: "2026-09", marca: "B", extra: { substituir: true } }));
    ok("A despublicado não foi reescrito", db.linhas.find((e) => e.id === A.id).payload_json.marca === "A");
    ok("A despublicado mantém o mesmo token", db.linhas.find((e) => e.id === A.id).token_publico === A.token);
    ok("B ganhou link próprio", B.token !== A.token && (await abrirLink(B.token)).payload_json.marca === "B");
  });

  // Operação diferente na mesma competência segue independente (D1/D4).
  await comBanco(async (db) => {
    const A = await criarEPublicar(corpo({ periodo: "2026-09", marca: "CONTA_10", conta: 10 }));
    const B = await criarEPublicar(corpo({ periodo: "2026-09", marca: "CONTA_11", conta: 11 }));
    ok("outra operação na mesma competência: independente", A.token !== B.token && db.linhas.length === 2);
  });

  console.log(`\nentregasClienteLinksHistoricos.test.js: ${checks} verificacoes passaram.`);
}

run().catch((err) => { console.error(err); process.exitCode = 1; });
