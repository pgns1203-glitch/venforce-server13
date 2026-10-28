// server/tests/sentinelIncidentes.postgres.cjs
//
// Motor de incidentes do Sentinel V0-b contra PostgreSQL LOCAL descartável:
//   SENTINEL_TEST_DATABASE_URL=postgres://vf@127.0.0.1:57651/postgres node tests/sentinelIncidentes.postgres.cjs
// Cria vf_sentinel_inc_<ts>, roda e apaga. Recusa host não-local; nunca lê server/.env.

const assert = require("assert");
const { Pool, Client } = require("pg");

const baseUrl = process.env.SENTINEL_TEST_DATABASE_URL;
if (!baseUrl) throw new Error("Defina SENTINEL_TEST_DATABASE_URL (PostgreSQL local).");
const parsed = new URL(baseUrl);
if (!["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) throw new Error("LOCAL_DATABASE_REQUIRED");
const dbName = `vf_sentinel_inc_${Date.now()}`;
const testUrl = new URL(baseUrl);
testUrl.pathname = `/${dbName}`;
process.env.DATABASE_URL = testUrl.toString();

const { ensureSentinelSchema, ensureSentinelIncidentesSchema, incidentesDisponiveis, verificarSentinelSchema } = require("../services/sentinel/sentinelSchema");
const S = require("../services/sentinel/sentinelIncidentes");
// schemaEnsure carrega o pool global (config/database) com DATABASE_URL = banco de teste:
// encerrado no teardown, senão o DROP ... FORCE derruba uma conexão ociosa dele.
const poolGlobal = require("../config/database");
poolGlobal.on("error", () => {});

let checks = 0;
function ok(label, cond) { assert.ok(cond, `FALHOU: ${label}`); checks += 1; console.log(`  ok  ${label}`); }
function eq(label, a, b) { assert.deepStrictEqual(a, b, `FALHOU: ${label}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); checks += 1; console.log(`  ok  ${label}`); }

const FIXTURE_SQL = `
CREATE TABLE clientes (id integer PRIMARY KEY, nome text, slug text UNIQUE, ativo boolean DEFAULT true);
CREATE TABLE cliente_contas (id integer PRIMARY KEY, cliente_id integer REFERENCES clientes(id), marketplace text,
  nome text, slug text, external_account_id text, is_primary boolean, ativo boolean);
CREATE TABLE squads (id integer PRIMARY KEY, nome text, ativo boolean DEFAULT true);
CREATE TABLE cliente_squad_history (id serial PRIMARY KEY, cliente_id integer, squad_id integer, fim_em timestamptz);
INSERT INTO clientes VALUES (1, 'Loja Fictícia', 'loja-ficticia', true);
INSERT INTO cliente_contas VALUES (10, 1, 'meli', 'Conta A', 'conta-a', '5551', true, true);
INSERT INTO cliente_contas VALUES (20, 1, 'meli', 'Conta B', 'conta-b', '5552', false, true);
INSERT INTO squads VALUES (7, 'Squad Azul', true);
INSERT INTO cliente_squad_history (cliente_id, squad_id) VALUES (1, 7);
`;

const H = 3600 * 1000;
const T0 = Date.parse("2026-10-20T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

async function pedido(db, conta, id, { mlb = "MLB1", margem = -10, fat = 100, status = "paid", estado = "confirmada", pend = [], quando = T0 - 24 * H, itens } = {}) {
  const its = itens || [{ item_id: mlb, sku: `SKU-${mlb}`, quantidade: 1, preco: fat, custo_unitario: estado === "confirmada" || estado === "provisoria" ? 50 : null, estado_custo: estado === "sem_custo" ? "sem_custo" : estado === "custo_ambiguo" ? "custo_ambiguo" : "ok" }];
  await db.query(
    `INSERT INTO sentinel_pedidos (cliente_id, cliente_conta_id, pedido_id, competencia, data_pedido, ml_date_last_updated, status_ml,
       itens, faturamento, comissao, frete, custo, imposto, margem_valor, margem_pct, estado_margem, pendencias, claims_verificado, payload_hash)
     VALUES (1, $1, $2, '2026-10', $3, $3, $4, $5, $6, 10, 10, 50, 5, $7, $8, $9, $10, false, 'h')
     ON CONFLICT (cliente_conta_id, pedido_id) DO UPDATE SET margem_valor = EXCLUDED.margem_valor, status_ml = EXCLUDED.status_ml,
       estado_margem = EXCLUDED.estado_margem, data_pedido = EXCLUDED.data_pedido, itens = EXCLUDED.itens, pendencias = EXCLUDED.pendencias`,
    [conta, String(id), iso(quando), status, JSON.stringify(its), fat,
      ["sem_custo", "custo_ambiguo", "erro"].includes(estado) ? null : margem,
      ["sem_custo", "custo_ambiguo", "erro"].includes(estado) ? null : (margem / fat) * 100, estado, JSON.stringify(pend)]
  );
}

async function checkpoint(db, conta, { cp, exec, erro = null }) {
  await db.query(
    `INSERT INTO sentinel_checkpoints (cliente_conta_id, ultimo_date_last_updated, ultima_execucao_em, ultimo_erro, pedidos_processados_ultima)
     VALUES ($1, $2, $3, $4, 0) ON CONFLICT (cliente_conta_id) DO UPDATE SET ultimo_date_last_updated = EXCLUDED.ultimo_date_last_updated,
       ultima_execucao_em = EXCLUDED.ultima_execucao_em, ultimo_erro = EXCLUDED.ultimo_erro`,
    [conta, cp === null ? null : iso(cp), exec === null ? null : iso(exec), erro]
  );
}

(async () => {
  const admin = new Client({ connectionString: baseUrl, ssl: false });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  const pool = new Pool({ connectionString: testUrl.toString(), ssl: false, max: 6 });
  const q = async (sql, p) => (await pool.query(sql, p)).rows;
  try {
    await pool.query(FIXTURE_SQL);
    await ensureSentinelSchema(pool);

    console.log("\n▸ schema de incidentes é separado e idempotente");
    ok("sem tabelas de incidentes: indisponível", (await incidentesDisponiveis(pool)) === false);
    ok("worker não exige incidentes (verificarSentinelSchema passa)", (await verificarSentinelSchema(pool)).ok === true);
    await ensureSentinelIncidentesSchema(pool);
    await ensureSentinelIncidentesSchema(pool);
    ok("migration aplicada 2x sem erro", (await incidentesDisponiveis(pool)) === true);
    const fks = await q(`SELECT conrelid::regclass::text AS t, confrelid::regclass::text AS r FROM pg_constraint WHERE contype='f' AND conrelid::regclass::text LIKE 'sentinel_incid%' ORDER BY 1`);
    eq("FKs: eventos→incidentes, incidentes→cliente_contas", fks.map((f) => `${f.t}->${f.r}`), ["sentinel_incidente_eventos->sentinel_incidentes", "sentinel_incidentes->cliente_contas"]);

    console.log("\n▸ detector 1: margem negativa agrupada por MLB, cancelado fora");
    await checkpoint(pool, 10, { cp: T0 - 5 * 60 * 1000, exec: T0 - 60 * 1000 });
    await pedido(pool, 10, 1, { mlb: "MLB1", margem: -30, quando: T0 - 48 * H });
    await pedido(pool, 10, 2, { mlb: "MLB1", margem: -20, quando: T0 - 24 * H });
    await pedido(pool, 10, 3, { mlb: "MLB1", margem: -500, status: "cancelled" });
    await pedido(pool, 10, 4, { mlb: "MLB1", margem: -15, estado: "provisoria", pend: ["sem_frete"] });
    await pedido(pool, 10, 5, { mlb: "MLB2", margem: 25 });
    await pedido(pool, 10, 6, { mlb: "MLB3", margem: -5, status: "payment_required" });
    await pedido(pool, 10, 7, { mlb: "MLB9", margem: -40, quando: T0 - 60 * 24 * H }); // fora da janela de 30 dias
    const r1 = await S.avaliarIncidentesConta(pool, 10, { agora: T0 });
    eq("1ª avaliação abre 1 incidente", [r1.abertos, r1.atualizados], [1, 0]);
    let inc = (await q("SELECT * FROM sentinel_incidentes WHERE cliente_conta_id = 10"));
    eq("só MLB1 (MLB2 positivo, MLB3 não pago, MLB9 fora da janela)", inc.map((i) => `${i.tipo}:${i.chave}`), ["margem_negativa:MLB1"]);
    const m1 = inc[0];
    eq("perda observada = só calculados (30+20), cancelado e pendente fora", Number(m1.impacto_valor), 50);
    eq("pedidos afetados = 2 calculados + 1 pendente", m1.pedidos_afetados, 3);
    eq("confiabilidade 'calculado' (claims não verificadas)", m1.confiabilidade, "calculado");
    eq("severidade alta (perda 50 < 100, 2 pedidos < 3) ⇒ media", m1.severidade, "media");
    eq("pendente à parte", [m1.detalhes.pedidosPendentes, m1.detalhes.perdaPendente], [1, 15]);
    ok("cancelado não aparece nos pedidos do incidente", !m1.detalhes.pedidos.includes("3"));
    eq("primeira/última ocorrência", [iso(m1.primeira_ocorrencia), iso(m1.ultima_ocorrencia)], [iso(T0 - 48 * H), iso(T0 - 24 * H)]);
    ok("motivo explica claims não verificadas", /Claims\/devoluções não verificadas/.test(m1.motivo));

    console.log("\n▸ idempotência: reavaliar sem mudança não duplica nem gera histórico");
    const r2 = await S.avaliarIncidentesConta(pool, 10, { agora: T0 + 60 * 1000 });
    eq("2ª avaliação: tudo inalterado", [r2.abertos, r2.atualizados, r2.inalterados], [0, 0, 1]);
    eq("1 linha, 1 evento", [(await q("SELECT COUNT(*)::int n FROM sentinel_incidentes")).at(0).n, (await q("SELECT COUNT(*)::int n FROM sentinel_incidente_eventos")).at(0).n], [1, 1]);
    // reprocessar o MESMO pedido (upsert igual) não muda impacto
    await pedido(pool, 10, 2, { mlb: "MLB1", margem: -20, quando: T0 - 24 * H });
    await S.avaliarIncidentesConta(pool, 10, { agora: T0 + 2 * 60 * 1000 });
    eq("mesmo pedido reprocessado: impacto continua 50", Number((await q("SELECT impacto_valor FROM sentinel_incidentes WHERE chave='MLB1'"))[0].impacto_valor), 50);

    console.log("\n▸ mudança financeira relevante ⇒ 'atualizado'");
    await pedido(pool, 10, 2, { mlb: "MLB1", margem: -120, quando: T0 - 24 * H });
    const r3 = await S.avaliarIncidentesConta(pool, 10, { agora: T0 + 3 * 60 * 1000 });
    eq("atualizado", r3.atualizados, 1);
    const m3 = (await q("SELECT * FROM sentinel_incidentes WHERE chave='MLB1'"))[0];
    eq("impacto recalculado (30+120), não somado", Number(m3.impacto_valor), 150);
    eq("severidade sobe p/ alta (≥100)", m3.severidade, "alta");
    const evAt = (await q("SELECT dados FROM sentinel_incidente_eventos WHERE evento='atualizado'"))[0];
    eq("evento guarda antes/depois", [evAt.dados.impactoAntes, evAt.dados.impactoDepois], [50, 150]);

    console.log("\n▸ pedido que vira cancelado sai do impacto");
    await pedido(pool, 10, 1, { mlb: "MLB1", margem: -30, status: "cancelled", quando: T0 - 48 * H });
    await S.avaliarIncidentesConta(pool, 10, { agora: T0 + 4 * 60 * 1000 });
    eq("impacto = 120 (pedido 1 cancelado)", Number((await q("SELECT impacto_valor FROM sentinel_incidentes WHERE chave='MLB1'"))[0].impacto_valor), 120);

    console.log("\n▸ pedido multiproduto conta uma vez");
    await pedido(pool, 20, 50, { margem: -80, itens: [
      { item_id: "MLB7", sku: "A", quantidade: 1, preco: 60, custo_unitario: 40, estado_custo: "ok" },
      { item_id: "MLB8", sku: "B", quantidade: 1, preco: 40, custo_unitario: 40, estado_custo: "ok" }] });
    await checkpoint(pool, 20, { cp: T0 - 60 * 1000, exec: T0 - 60 * 1000 });
    await S.avaliarIncidentesConta(pool, 20, { agora: T0 });
    eq("chave combinada, perda 80 uma vez", (await q("SELECT chave, impacto_valor::float AS v FROM sentinel_incidentes WHERE cliente_conta_id=20")), [{ chave: "MLB7+MLB8", v: 80 }]);

    console.log("\n▸ detector 2: custo ausente / ambíguo (receita, não prejuízo)");
    await pedido(pool, 10, 20, { mlb: "MLB5", estado: "sem_custo", fat: 300 });
    await pedido(pool, 10, 21, { mlb: "MLB5", estado: "sem_custo", fat: 250 });
    await pedido(pool, 10, 22, { mlb: "MLB6", estado: "custo_ambiguo", fat: 90 });
    await pedido(pool, 10, 23, { mlb: "MLB5", estado: "sem_custo", fat: 999, status: "cancelled" });
    await S.avaliarIncidentesConta(pool, 10, { agora: T0 + 5 * 60 * 1000 });
    const cp5 = (await q("SELECT * FROM sentinel_incidentes WHERE tipo='custo_pendente' ORDER BY chave"));
    eq("um por MLB", cp5.map((i) => i.chave), ["MLB5", "MLB6"]);
    eq("receita exposta MLB5 = 550 (cancelado fora)", Number(cp5[0].impacto_valor), 550);
    eq("impacto_tipo receita_sem_custo e severidade media", [cp5[0].impacto_tipo, cp5[0].severidade], ["receita_sem_custo", "media"]);
    ok("título ambíguo + motivo diz que não é prejuízo", /ambíguo/.test(cp5[1].titulo) && /não é prejuízo comprovado/.test(cp5[0].motivo));
    eq("confiabilidade inconclusivo", cp5[0].confiabilidade, "inconclusivo");

    console.log("\n▸ fluxo humano: reconhecer → resolver; transições inválidas");
    const id = Number(m3.id);
    await assert.rejects(S.resolverIncidente(pool, id, { ator: "ana@x" }), (e) => e.code === "MOTIVO_OBRIGATORIO"); checks += 1;
    await assert.rejects(S.reconhecerIncidente(pool, 999999, { ator: "ana@x" }), (e) => e.code === "INCIDENTE_NAO_ENCONTRADO"); checks += 1;
    const rec = await S.reconhecerIncidente(pool, id, { ator: "ana@x", observacao: "vendo com o cliente" });
    eq("reconhecido por ana", [rec.status, rec.reconhecido.por], ["reconhecido", "ana@x"]);
    await assert.rejects(S.reconhecerIncidente(pool, id, { ator: "ana@x" }), (e) => e.code === "TRANSICAO_INVALIDA"); checks += 1;
    // resoluções concorrentes: exatamente uma vence
    const corrida = await Promise.allSettled([1, 2, 3].map((n) => S.resolverIncidente(pool, id, { ator: `u${n}`, motivo: "preço ajustado" })));
    eq("corrida de resolução: 1 vence, 2 TRANSICAO_INVALIDA", [corrida.filter((r) => r.status === "fulfilled").length,
      corrida.filter((r) => r.status === "rejected" && r.reason.code === "TRANSICAO_INVALIDA").length], [1, 2]);
    const res = await S.obterIncidente(pool, id);
    eq("resolvido com motivo", [res.status, res.resolvido.motivo], ["resolvido", "preço ajustado"]);
    eq("histórico completo", res.eventos.map((e) => e.evento), ["aberto", "atualizado", "atualizado", "reconhecido", "resolvido"]);

    console.log("\n▸ resolvido: mesmo cenário não reabre; ocorrência NOVA reabre");
    const resolvidoEm = Date.parse(res.resolvido.em);
    await S.avaliarIncidentesConta(pool, 10, { agora: resolvidoEm + 60 * 1000, config: { leituraLimiteMin: 1e9 } });
    eq("sem ocorrência nova: continua resolvido", (await S.obterIncidente(pool, id)).status, "resolvido");
    await pedido(pool, 10, 30, { mlb: "MLB1", margem: -9, quando: resolvidoEm + 5 * 60 * 1000 });
    const r6 = await S.avaliarIncidentesConta(pool, 10, { agora: resolvidoEm + 10 * 60 * 1000, config: { leituraLimiteMin: 1e9 } });
    eq("reaberto 1", r6.reabertos, 1);
    const re = await S.obterIncidente(pool, id);
    eq("status reaberto, vezes 1, resolução anterior limpa", [re.status, re.vezesReaberto, re.resolvido], ["reaberto", 1, null]);
    eq("evento reaberto c/ data da resolução", re.eventos.at(-1).evento, "reaberto");
    eq("mesma linha (sem duplicar)", (await q("SELECT COUNT(*)::int n FROM sentinel_incidentes WHERE chave='MLB1' AND cliente_conta_id=10"))[0].n, 1);

    console.log("\n▸ condição some da janela ⇒ condicao_encerrada (status intacto)");
    const rFut = await S.avaliarIncidentesConta(pool, 20, { agora: T0 + 40 * 24 * H, config: { leituraLimiteMin: 1e9 } });
    const i20 = (await q("SELECT status, condicao_ativa FROM sentinel_incidentes WHERE cliente_conta_id=20"))[0];
    eq("encerrada sem resolver", [rFut.encerrados, i20.status, i20.condicao_ativa], [1, "aberto", false]);

    console.log("\n▸ detector 3: leitura atrasada (por conta, sem duplicar por ciclo)");
    const lim = { config: { leituraLimiteMin: 60 } };
    await checkpoint(pool, 10, { cp: T0 - 30 * 60 * 1000, exec: T0 - 60 * 1000 });
    await S.avaliarIncidentesConta(pool, 10, { agora: T0, ...lim });
    eq("30 min < limite: sem incidente", (await q("SELECT COUNT(*)::int n FROM sentinel_incidentes WHERE tipo='leitura_atrasada'"))[0].n, 0);
    // conta sem pedidos novos mas worker rodando ⇒ checkpoint avança ⇒ sem incidente
    const vazio = await S.saudeContas(pool, { contaIds: [10], agora: T0, env: { SENTINEL_LEITURA_LIMITE_MIN: "60" } });
    eq("saúde ok", vazio[0].situacao, "ok");
    await checkpoint(pool, 10, { cp: T0 - 3 * H, exec: T0 - 60 * 1000, erro: "SENTINEL_TOKEN_INDISPONIVEL: token expirado" });
    for (let k = 0; k < 3; k += 1) await S.avaliarIncidentesConta(pool, 10, { agora: T0 + k * 5 * 60 * 1000, ...lim });
    const la = await q("SELECT * FROM sentinel_incidentes WHERE tipo='leitura_atrasada'");
    eq("1 incidente em 3 ciclos, crítico por token", [la.length, la[0].severidade, la[0].chave], [1, "critica", "conta"]);
    ok("próxima ação: renovar pelo Portal", /Portal/.test(la[0].proxima_acao));
    eq("só 1 evento (atraso crescente não gera 'atualizado')", (await q("SELECT COUNT(*)::int n FROM sentinel_incidente_eventos WHERE incidente_id=$1", [la[0].id]))[0].n, 1);
    await checkpoint(pool, 10, { cp: T0 + 20 * 60 * 1000, exec: T0 + 20 * 60 * 1000 });
    await S.avaliarIncidentesConta(pool, 10, { agora: T0 + 21 * 60 * 1000, ...lim });
    eq("leitura voltou: condição encerrada", (await q("SELECT condicao_ativa FROM sentinel_incidentes WHERE tipo='leitura_atrasada'"))[0].condicao_ativa, false);

    console.log("\n▸ concorrência: dois avaliadores simultâneos da mesma conta");
    await pedido(pool, 10, 40, { mlb: "MLBX", margem: -77 });
    await Promise.all([S.avaliarIncidentesConta(pool, 10, { agora: T0 + 30 * 60 * 1000 }), S.avaliarIncidentesConta(pool, 10, { agora: T0 + 30 * 60 * 1000 })]);
    eq("MLBX: 1 incidente e 1 evento 'aberto'", [(await q("SELECT COUNT(*)::int n FROM sentinel_incidentes WHERE chave='MLBX'"))[0].n,
      (await q("SELECT COUNT(*)::int n FROM sentinel_incidente_eventos e JOIN sentinel_incidentes i ON i.id=e.incidente_id WHERE i.chave='MLBX' AND e.evento='aberto'"))[0].n], [1, 1]);

    console.log("\n▸ falha de transação não deixa meia escrita");
    const antesN = (await q("SELECT COUNT(*)::int n FROM sentinel_incidente_eventos"))[0].n;
    const quebrado = { totalCount: 0, query: (...a) => pool.query(...a), connect: async () => {
      const c = await pool.connect();
      const origQuery = c.query;
      const origRelease = c.release;
      c.query = (...a) => (typeof a[0] === "string" && /INSERT INTO sentinel_incidente_eventos/.test(a[0]) ? Promise.reject(new Error("boom")) : origQuery.apply(c, a));
      c.release = (...a) => { c.query = origQuery; c.release = origRelease; return origRelease.apply(c, a); };
      return c;
    } };
    await pedido(pool, 10, 41, { mlb: "MLBY", margem: -12 });
    await assert.rejects(S.avaliarIncidentesConta(quebrado, 10, { agora: T0 + 31 * 60 * 1000 }), /boom/); checks += 1;
    eq("rollback: MLBY não criado, eventos iguais", [(await q("SELECT COUNT(*)::int n FROM sentinel_incidentes WHERE chave='MLBY'"))[0].n,
      (await q("SELECT COUNT(*)::int n FROM sentinel_incidente_eventos"))[0].n], [0, antesN]);

    console.log("\n▸ persistência após 'restart' (pool novo)");
    const pool2 = new Pool({ connectionString: testUrl.toString(), ssl: false, max: 2 });
    const viaNovo = await S.obterIncidente(pool2, id);
    eq("incidente e histórico sobrevivem", [viaNovo.status, viaNovo.eventos.length], ["reaberto", 6]);
    await pool2.end();

    console.log("\n▸ leitura: listar/filtrar/paginar só nas contas passadas");
    const l1 = await S.listarIncidentes(pool, { contaIds: [10] });
    ok("lista conta 10 sem conta 20", l1.itens.length === l1.total && l1.itens.every((i) => i.contaId === 10));
    ok("ordem: reaberto/aberto antes de reconhecido/resolvido", l1.itens.findIndex((i) => i.status === "reaberto") < l1.itens.length);
    eq("filtro tipo", (await S.listarIncidentes(pool, { contaIds: [10], tipo: "custo_pendente" })).total, 2);
    eq("filtro status múltiplo", (await S.listarIncidentes(pool, { contaIds: [10], status: "reaberto,resolvido" })).itens.map((i) => i.status), ["reaberto"]);
    const pg1 = await S.listarIncidentes(pool, { contaIds: [10], limit: 2, offset: 0 });
    const pg2 = await S.listarIncidentes(pool, { contaIds: [10], limit: 2, offset: 2 });
    ok("paginação sem repetição", pg1.itens.length === 2 && !pg2.itens.some((x) => pg1.itens.some((y) => y.id === x.id)));
    eq("busca por MLB", (await S.listarIncidentes(pool, { contaIds: [10], busca: "mlb5" })).itens.map((i) => i.chave), ["MLB5"]);
    eq("contaIds vazio ⇒ nada", (await S.listarIncidentes(pool, { contaIds: [] })).total, 0);
    await assert.rejects(S.listarIncidentes(pool, {}), (e) => e.code === "CONTAS_OBRIGATORIAS"); checks += 1;
    const dto = l1.itens[0];
    ok("DTO com cliente/conta/squad", dto.clienteNome === "Loja Fictícia" && dto.contaNome === "Conta A" && dto.squad?.nome === "Squad Azul");
    const det = await S.obterIncidente(pool, id);
    ok("detalhe traz pedidos classificados", det.pedidos.length >= 2 && det.pedidos.every((p) => p.confiabilidade && p.elegibilidade));
    eq("contaDoIncidente", await S.contaDoIncidente(pool, id), 10);
    eq("contaDoIncidente inexistente / inválido", [await S.contaDoIncidente(pool, 999999), await S.contaDoIncidente(pool, "abc")], [null, null]);

    console.log("\n▸ resumo de monitoramento");
    const rs = await S.resumoMonitoramento(pool, { contaIds: [10, 20], agora: T0 + 30 * 60 * 1000 });
    eq("2 contas monitoradas", rs.contasMonitoradas, 2);
    ok("perda e receita separadas", rs.perdaContribuicaoObservada > 0 && rs.receitaCustoPendente === 640);
    ok("cobertura: cancelados contados como excluídos", rs.cobertura.excluidos.cancelado >= 2 && rs.cobertura.excluidos.aguardando_pagamento === 1);
    eq("nada 'confirmado' sem claims", rs.cobertura.porConfiabilidade.confirmado, 0);
    eq("resumo de contas vazias", (await S.resumoMonitoramento(pool, { contaIds: [] })).monitoramentoAtivo, false);

    console.log("\n▸ Codex #2: pedido ANTIGO que vira negativo após a resolução reabre; mesmo pedido piorando não");
    await checkpoint(pool, 20, { cp: T0 + 60 * 24 * H, exec: T0 + 60 * 24 * H });
    const TR = T0 + 60 * 24 * H; // relógio p/ esta seção (janela de 30 dias a partir daqui)
    await pedido(pool, 20, 60, { mlb: "MLBR", margem: -10, quando: TR - 10 * 24 * H });
    await pedido(pool, 20, 61, { mlb: "MLBR", margem: 15, quando: TR - 9 * 24 * H });
    await S.avaliarIncidentesConta(pool, 20, { agora: TR });
    const idR = Number((await q("SELECT id FROM sentinel_incidentes WHERE chave='MLBR'"))[0].id);
    await S.resolverIncidente(pool, idR, { ator: "ana@x", motivo: "custo corrigido" });
    await pedido(pool, 20, 60, { mlb: "MLBR", margem: -40, quando: TR - 10 * 24 * H });
    await S.avaliarIncidentesConta(pool, 20, { agora: TR + 60 * 1000 });
    eq("mesmo pedido piorou: continua resolvido", (await S.obterIncidente(pool, idR)).status, "resolvido");
    await pedido(pool, 20, 61, { mlb: "MLBR", margem: -5, quando: TR - 9 * 24 * H }); // data ANTERIOR à resolução
    await S.avaliarIncidentesConta(pool, 20, { agora: TR + 2 * 60 * 1000 });
    const rR = await S.obterIncidente(pool, idR);
    eq("pedido antigo passou a negativo: reaberto", rR.status, "reaberto");
    eq("evento cita o pedido novo", rR.eventos.at(-1).dados.novaOcorrencia.pedidosNovos, ["61"]);

    console.log("\n▸ Codex #4: mudança só de faturamento ⇒ 'atualizado'");
    const evAntes = (await q("SELECT COUNT(*)::int n FROM sentinel_incidente_eventos WHERE incidente_id=$1", [idR]))[0].n;
    await pool.query("UPDATE sentinel_pedidos SET faturamento = 130 WHERE cliente_conta_id = 20 AND pedido_id = '61'");
    await S.avaliarIncidentesConta(pool, 20, { agora: TR + 3 * 60 * 1000 });
    eq("1 evento 'atualizado' a mais", (await q("SELECT COUNT(*)::int n FROM sentinel_incidente_eventos WHERE incidente_id=$1", [idR]))[0].n, evAntes + 1);

    console.log("\n▸ Codex #3: vigia fora do worker detecta conta parada");
    await checkpoint(pool, 20, { cp: TR - 10 * H, exec: TR - 10 * H });
    const vg = await S.avaliarContasMonitoradas(pool, { agora: TR + 4 * 60 * 1000, config: { leituraLimiteMin: 60 } });
    ok("vigia avaliou as 2 contas monitoradas", vg.pulado === null && vg.contas.length === 2 && vg.contas.every((c) => !c.erro));
    const la20 = (await q("SELECT severidade, proxima_acao FROM sentinel_incidentes WHERE cliente_conta_id=20 AND tipo='leitura_atrasada'"))[0];
    ok("worker parado ⇒ leitura_atrasada crítica (10h > 4×limite) com ação 'worker'", la20 && la20.severidade === "critica" && /worker/.test(la20.proxima_acao));

    console.log("\n▸ Codex 2ª rodada: reabertura usa o conjunto COMPLETO, não a amostra de exibição");
    const amostra = { config: { maxPedidosDetalhe: 2, leituraLimiteMin: 1e9 } };
    for (let k = 0; k < 4; k += 1) await pedido(pool, 20, 70 + k, { mlb: "MLBC", margem: -5, quando: TR - (5 + k) * 24 * H });
    await pedido(pool, 20, 79, { mlb: "MLBC", margem: 20, quando: TR - 20 * 24 * H }); // mais antigo, positivo
    await S.avaliarIncidentesConta(pool, 20, { agora: TR, ...amostra });
    const iC = (await q("SELECT id, pedidos_ids, detalhes FROM sentinel_incidentes WHERE chave='MLBC'"))[0];
    eq("amostra 2, conjunto completo 4", [iC.detalhes.pedidos.length, iC.pedidos_ids.length], [2, 4]);
    await S.resolverIncidente(pool, Number(iC.id), { ator: "ana@x", motivo: "ok" });
    await pool.query("UPDATE sentinel_pedidos SET status_ml = 'cancelled' WHERE cliente_conta_id = 20 AND pedido_id = '70'"); // sai da amostra
    await S.avaliarIncidentesConta(pool, 20, { agora: TR + 60 * 1000, ...amostra });
    eq("pedido sai e outro antigo entra na amostra: NÃO reabre", (await S.obterIncidente(pool, Number(iC.id))).status, "resolvido");
    await pedido(pool, 20, 79, { mlb: "MLBC", margem: -3, quando: TR - 20 * 24 * H }); // fora da amostra, vira negativo
    await S.avaliarIncidentesConta(pool, 20, { agora: TR + 2 * 60 * 1000, ...amostra });
    const rC = await S.obterIncidente(pool, Number(iC.id));
    eq("pedido antigo fora da amostra ficou negativo: reabre", [rC.status, rC.eventos.at(-1).dados.novaOcorrencia.pedidosNovos], ["reaberto", ["79"]]);

    console.log("\n▸ linha legada sem pedidos_ids: linha de base silenciosa, sem reabrir");
    const evL = (await q("SELECT COUNT(*)::int n FROM sentinel_incidente_eventos WHERE incidente_id=$1", [iC.id]))[0].n;
    await pool.query("UPDATE sentinel_incidentes SET status='resolvido', resolvido_em=NOW(), pedidos_ids='{}' WHERE id=$1", [iC.id]);
    await S.avaliarIncidentesConta(pool, 20, { agora: Date.now() - 1000, ...amostra });
    const iL = (await q("SELECT status, cardinality(pedidos_ids) n FROM sentinel_incidentes WHERE id=$1", [iC.id]))[0];
    eq("continua resolvido, conjunto preenchido, sem evento", [iL.status, iL.n > 0, (await q("SELECT COUNT(*)::int n FROM sentinel_incidente_eventos WHERE incidente_id=$1", [iC.id]))[0].n], ["resolvido", true, evL]);

    console.log("\n▸ F3.5: resolvido não reaparece sem ocorrência válida");
    const T5 = TR + 10 * 24 * H;
    await pool.query("INSERT INTO cliente_contas VALUES (30, 1, 'meli', 'Conta C', 'conta-c', '5553', false, true)");
    await checkpoint(pool, 30, { cp: T5, exec: T5 });
    await pedido(pool, 30, 300, { mlb: "MLBZ", margem: -50, quando: T5 - 24 * H });
    await S.avaliarIncidentesConta(pool, 30, { agora: T5 });
    const idZ = Number((await q("SELECT id FROM sentinel_incidentes WHERE chave='MLBZ'"))[0].id);
    await S.resolverIncidente(pool, idZ, { ator: "ana@x", motivo: "preço corrigido" });
    for (let k = 1; k <= 5; k += 1) await S.avaliarIncidentesConta(pool, 30, { agora: T5 + k * 60 * 1000 });
    eq("5 reavaliações sem pedido novo: continua resolvido", (await S.obterIncidente(pool, idZ)).status, "resolvido");
    await pedido(pool, 30, 301, { mlb: "MLBZ", margem: -30, status: "cancelled", quando: T5 });
    await pedido(pool, 30, 302, { mlb: "MLBZ", margem: -30, status: "payment_required", quando: T5 });
    await pedido(pool, 30, 303, { mlb: "MLBZ", estado: "sem_custo", fat: 80, quando: T5 });
    await pedido(pool, 30, 304, { mlb: "MLBZ", margem: 12, quando: T5 });
    await S.avaliarIncidentesConta(pool, 30, { agora: T5 + 10 * 60 * 1000 });
    eq("pedido novo cancelado / não pago / sem custo / positivo: não reabre margem", (await S.obterIncidente(pool, idZ)).status, "resolvido");

    console.log("\n▸ F3.4: conta desativada e conta removida");
    await pedido(pool, 30, 305, { mlb: "MLBW", margem: -20, quando: T5 });
    await S.avaliarIncidentesConta(pool, 30, { agora: T5 + 11 * 60 * 1000 });
    const idW = Number((await q("SELECT id FROM sentinel_incidentes WHERE chave='MLBW'"))[0].id);
    await pool.query("UPDATE cliente_contas SET ativo = false WHERE id = 30");
    const rDes = await S.avaliarIncidentesConta(pool, 30, { agora: T5 + 600 * 60 * 1000, config: { leituraLimiteMin: 60 } });
    ok("desativada: nada aberto (nem leitura atrasada)", rDes.contaDesativada === true && rDes.abertos === 0);
    eq("desativada: sem incidente de leitura p/ conta 30", (await q("SELECT COUNT(*)::int n FROM sentinel_incidentes WHERE cliente_conta_id=30 AND tipo='leitura_atrasada'"))[0].n, 0);
    const iW = await S.obterIncidente(pool, idW);
    eq("desativada: incidente financeiro intacto (status, condição e impacto)", [iW.status, iW.condicaoAtiva, iW.impacto.valor], ["aberto", true, 20]);
    const saudeDes = (await S.saudeContas(pool, { contaIds: [30], agora: T5 + 600 * 60 * 1000 }))[0];
    eq("saúde: conta desativada não é monitorada nem atrasada", [saudeDes.situacao, saudeDes.monitorada, saudeDes.ativo], ["desativada", false, false]);
    const opDes = await S.resumoOperacional(pool, { contaIds: [30], agora: T5 + 600 * 60 * 1000 });
    ok("resumo operacional: sem alerta de leitura p/ conta desativada", !opDes.alertas.some((a) => a.codigo === "LEITURA_ATRASADA") && opDes.contas.monitoradas === 0);
    await pool.query("UPDATE cliente_contas SET ativo = true WHERE id = 30");
    await S.avaliarIncidentesConta(pool, 30, { agora: T5 + 601 * 60 * 1000, config: { leituraLimiteMin: 1e9 } });
    eq("reativada: condição volta a ser observada", (await S.obterIncidente(pool, idW)).condicaoAtiva, true);
    await pool.query("DELETE FROM cliente_contas WHERE id = 30");
    eq("removida: incidentes e eventos cascateiam", [(await q("SELECT COUNT(*)::int n FROM sentinel_incidentes WHERE cliente_conta_id=30"))[0].n,
      (await q("SELECT COUNT(*)::int n FROM sentinel_incidente_eventos WHERE incidente_id = ANY($1::bigint[])", [[idZ, idW]]))[0].n], [0, 0]);
    const rDel = await S.avaliarIncidentesConta(pool, 30, { agora: T5 + 602 * 60 * 1000 });
    ok("checkpoint órfão (sem FK): avaliação ignora sem escrever", rDel.ignorada === "conta_inexistente");
    const vgDel = await S.avaliarContasMonitoradas(pool, { agora: T5 + 603 * 60 * 1000 });
    ok("vigia não quebra com conta removida", vgDel.contas.every((c) => !c.erro));

    console.log("\n▸ F4: saúde operacional e alertas internos");
    const T6 = T5 + 700 * 60 * 1000;
    await checkpoint(pool, 10, { cp: T6 - 2 * 60 * 1000, exec: T6 - 2 * 60 * 1000 });
    await checkpoint(pool, 20, { cp: T6 - 5 * H, exec: T6 - 60 * 1000, erro: "SENTINEL_TOKEN_INDISPONIVEL: expirado" });
    const op1 = await S.resumoOperacional(pool, { contaIds: [10, 20], agora: T6, env: { SENTINEL_LEITURA_LIMITE_MIN: "60" } });
    eq("worker ativo (última execução há 1 min)", op1.worker.estado, "ativo");
    eq("contas: 2 monitoradas, 1 ok, 1 atrasada, 1 erro de token", [op1.contas.monitoradas, op1.contas.ok, op1.contas.atrasadas, op1.contas.erroToken], [2, 1, 1, 1]);
    ok("alerta crítico TOKEN_INDISPONIVEL p/ conta 20 vem primeiro", op1.alertas[0].nivel === "critico" && op1.alertas.some((a) => a.codigo === "TOKEN_INDISPONIVEL" && a.contaId === 20));
    ok("conta 10 sem pedidos recentes = info, não falha", op1.alertas.some((a) => a.codigo === "SEM_PEDIDOS_RECENTES" && a.contaId === 10 && a.nivel === "info")
      && !op1.alertas.some((a) => a.codigo === "LEITURA_ATRASADA" && a.contaId === 10));
    ok("idade máx. do checkpoint = 5 h", op1.checkpointIdadeMaxSegundos === 5 * 3600);
    ok("incidentes abertos por severidade", Object.values(op1.incidentesAbertosPorSeveridade).reduce((s, n) => s + n, 0) > 0);
    ok("claims não verificadas sinalizadas", op1.alertas.some((a) => a.codigo === "CLAIMS_NAO_VERIFICADAS"));
    const op2 = await S.resumoOperacional(pool, { contaIds: [10, 20], agora: T6 + 5 * H, env: { SENTINEL_LEITURA_LIMITE_MIN: "60" } });
    ok("5 h sem execução ⇒ WORKER_PARADO crítico", op2.worker.estado === "parado" && op2.alertas.some((a) => a.codigo === "WORKER_PARADO" && a.nivel === "critico"));
    eq("sem contas ⇒ sem_dados, sem alertas", [(await S.resumoOperacional(pool, { contaIds: [] })).worker.estado, (await S.resumoOperacional(pool, { contaIds: [] })).alertas.length], ["sem_dados", 0]);

    console.log(`\n${checks} verificações passaram (PostgreSQL local ${parsed.hostname}).`);
  } finally {
    await pool.end().catch(() => {});
    await poolGlobal.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await admin.end();
  }
})().catch((err) => { console.error(err); process.exit(1); });
