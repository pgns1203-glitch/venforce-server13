// server/tests/clienteContaService.test.js
//
// Fundação de Contas do Marketplace (Fase 1) — protege os invariantes
// centrais do novo modelo CLIENTE → CLIENTE_CONTA → MARKETPLACE:
//  1. duas contas ativas do mesmo marketplace nunca são escolhidas em
//     silêncio (MULTIPLE_MARKETPLACE_ACCOUNTS);
//  2. uma única conta ativa continua resolvendo automaticamente (compat);
//  3. criar a primeira conta de um marketplace a torna principal sem pedir;
//     a segunda NÃO vira principal sem pedido explícito;
//  4. base de marketplace errado nunca vincula a uma conta;
//  5. desconectar o grant de uma conta nunca apaga o grant de outra.
//
// Usa o mesmo padrão de mock das demais suítes deste diretório: o `pool`
// é um singleton (server/config/database.js), então os testes trocam
// temporariamente `pool.query`/`pool.connect` por um banco em memória e
// restauram no final.

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
  try {
    await promise;
  } catch (e) {
    erro = e;
  }
  assert.ok(erro, `FALHOU (não rejeitou): ${label}`);
  if (verificar) assert.ok(verificar(erro), `FALHOU (erro inesperado): ${label} — ${erro.message}`);
  checks += 1;
  console.log(`  ok  ${label}`);
}

const pool = require("../config/database");

class MockDb {
  constructor() {
    this.clientes = [{ id: 1, nome: "Loja Eletrônico", slug: "loja-eletronico", ativo: true }];
    this.contas = [];
    this.bases = [];
    this.vinculos = [];
    this.grants = [];
    this.nextContaId = 1;
    this.nextVinculoId = 1;
  }

  async connect() {
    return { query: (sql, params) => this.query(sql, params), release() {} };
  }

  async query(sql, params = []) {
    const q = String(sql).replace(/\s+/g, " ").trim();

    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(q) || q.includes("pg_advisory_xact_lock")) {
      return { rows: [] };
    }

    if (q.includes("FROM clientes WHERE id = $1")) {
      return { rows: this.clientes.filter((c) => c.id === Number(params[0])) };
    }
    if (q.includes("FROM clientes WHERE slug = $1")) {
      return { rows: this.clientes.filter((c) => c.slug === params[0]) };
    }

    if (q.startsWith("SELECT 1 FROM cliente_contas WHERE slug = $1")) {
      return { rows: this.contas.filter((c) => c.slug === params[0]) };
    }

    if (q.startsWith("SELECT id, cliente_id, marketplace, ativo FROM cliente_contas WHERE id = $1 FOR UPDATE")) {
      const conta = this.contas.find((c) => c.id === Number(params[0]));
      return { rows: conta ? [{ id: conta.id, cliente_id: conta.cliente_id, marketplace: conta.marketplace, ativo: conta.ativo }] : [] };
    }
    if (q.startsWith("SELECT * FROM cliente_contas WHERE id = $1")) {
      return { rows: this.contas.filter((c) => c.id === Number(params[0])) };
    }
    if (q.startsWith("SELECT id FROM cliente_contas WHERE cliente_id = $1 AND marketplace = $2 AND ativo = true AND is_primary = true")) {
      return { rows: this.contas.filter((c) => c.cliente_id === params[0] && c.marketplace === params[1] && c.ativo && c.is_primary) };
    }
    if (q.startsWith("SELECT * FROM cliente_contas WHERE cliente_id = $1 AND marketplace = $2 AND ativo = true")) {
      return { rows: this.contas.filter((c) => c.cliente_id === params[0] && c.marketplace === params[1] && c.ativo) };
    }
    if (q.startsWith("SELECT COUNT(*)::int AS total FROM cliente_contas WHERE cliente_id = $1 AND marketplace = $2 AND ativo = true")) {
      const total = this.contas.filter((c) => c.cliente_id === params[0] && c.marketplace === params[1] && c.ativo).length;
      return { rows: [{ total }] };
    }

    if (q.startsWith("UPDATE cliente_contas SET is_primary = false, updated_at = NOW() WHERE cliente_id = $1 AND marketplace = $2 AND is_primary = true AND id <> $3")) {
      this.contas.forEach((c) => {
        if (c.cliente_id === params[0] && c.marketplace === params[1] && c.is_primary && c.id !== Number(params[2])) c.is_primary = false;
      });
      return { rows: [] };
    }
    if (q.startsWith("UPDATE cliente_contas SET is_primary = false, updated_at = NOW() WHERE cliente_id = $1 AND marketplace = $2 AND is_primary = true")) {
      this.contas.forEach((c) => {
        if (c.cliente_id === params[0] && c.marketplace === params[1] && c.is_primary) c.is_primary = false;
      });
      return { rows: [] };
    }
    if (q.startsWith("UPDATE cliente_contas SET is_primary = true, updated_at = NOW() WHERE id = $1 RETURNING *")) {
      const conta = this.contas.find((c) => c.id === Number(params[0]));
      if (conta) conta.is_primary = true;
      return { rows: conta ? [{ ...conta }] : [] };
    }

    if (q.startsWith("INSERT INTO cliente_contas") && q.includes("VALUES ($1, $2, $3, $4, $5, $6, true, $7)")) {
      const conta = {
        id: this.nextContaId++,
        cliente_id: params[0],
        marketplace: params[1],
        nome: params[2],
        slug: params[3],
        external_account_id: params[4],
        is_primary: params[5] === true,
        ativo: true,
        metadata_json: params[6] || {},
      };
      this.contas.push(conta);
      return { rows: [{ ...conta }] };
    }

    // UPDATE genérico de atualizarConta: colunas parametrizadas ($N) + literais
    // conhecidos (is_primary = false ao desativar).
    if (q.startsWith("UPDATE cliente_contas SET") && q.includes("RETURNING *") && !q.includes("is_primary = true")) {
      const idParam = params[params.length - 1];
      const conta = this.contas.find((c) => c.id === Number(idParam));
      if (!conta) return { rows: [] };
      if (q.includes("nome = $1")) conta.nome = params[0];
      if (q.includes("ativo = $")) {
        const ativoIdx = q.includes("nome = $1") ? 1 : 0;
        conta.ativo = params[ativoIdx];
      }
      if (q.includes("is_primary = false")) conta.is_primary = false;
      return { rows: [{ ...conta }] };
    }

    if (q.startsWith("SELECT id, slug, nome, marketplace, ativo FROM bases WHERE id = $1")) {
      return { rows: this.bases.filter((b) => b.id === Number(params[0])) };
    }
    if (q.startsWith("UPDATE base_cliente_vinculos SET ativo = false, updated_at = NOW() WHERE base_id = $1 AND ativo = true")) {
      this.vinculos.forEach((v) => { if (v.base_id === Number(params[0]) && v.ativo) v.ativo = false; });
      return { rows: [] };
    }
    if (q.startsWith("UPDATE base_cliente_vinculos SET ativo = false, updated_at = NOW() WHERE cliente_conta_id = $1 AND ativo = true")) {
      this.vinculos.forEach((v) => { if (v.cliente_conta_id === Number(params[0]) && v.ativo) v.ativo = false; });
      return { rows: [] };
    }
    if (q.startsWith("INSERT INTO base_cliente_vinculos")) {
      const vinculo = {
        id: this.nextVinculoId++,
        base_id: params[0],
        cliente_id: params[1],
        cliente_conta_id: params[2],
        marketplace: params[3],
        origem: "conta",
        ativo: true,
      };
      this.vinculos.push(vinculo);
      return { rows: [{ ...vinculo }] };
    }

    if (q.includes("FROM base_cliente_vinculos v") && q.includes("WHERE v.cliente_conta_id = $1 AND v.ativo = true")) {
      const vinculo = this.vinculos.find((v) => v.cliente_conta_id === Number(params[0]) && v.ativo);
      if (!vinculo) return { rows: [] };
      const base = this.bases.find((b) => b.id === vinculo.base_id);
      return { rows: [{ vinculo_id: vinculo.id, base_id: vinculo.base_id, slug: base?.slug, nome: base?.nome }] };
    }
    if (q.includes("FROM base_cliente_vinculos v") && q.includes("WHERE v.cliente_id = $1 AND v.marketplace = $2 AND v.ativo = true")) {
      const candidatos = this.vinculos.filter((v) => v.cliente_id === params[0] && v.marketplace === params[1] && v.ativo);
      if (!candidatos.length) return { rows: [] };
      const vinculo = candidatos[candidatos.length - 1];
      const base = this.bases.find((b) => b.id === vinculo.base_id);
      return { rows: [{ vinculo_id: vinculo.id, base_id: vinculo.base_id, slug: base?.slug, nome: base?.nome }] };
    }

    if (q.startsWith("DELETE") && q.includes("ml_tokens") && q.includes("cliente_conta_id = $1") && q.includes("RETURNING id, ml_user_id")) {
      const removidos = this.grants.filter((g) => g.cliente_conta_id === Number(params[0]));
      this.grants = this.grants.filter((g) => g.cliente_conta_id !== Number(params[0]));
      return { rows: removidos.map((g) => ({ id: g.id, ml_user_id: g.ml_user_id })) };
    }

    throw new Error(`Query não mapeada no mock: ${q}`);
  }
}

async function run() {
  const svc = require("../services/clienteContas/clienteContaService");
  const originalQuery = pool.query;
  const originalConnect = pool.connect;

  const db = new MockDb();
  pool.query = (sql, params) => db.query(sql, params);
  pool.connect = () => db.connect();

  try {
    ok("normalizarMarketplaceConta aceita só meli/shopee",
      svc.normalizarMarketplaceConta("MELI") === "meli" &&
      svc.normalizarMarketplaceConta("Shopee") === "shopee" &&
      svc.normalizarMarketplaceConta("tiktok") === null &&
      svc.normalizarMarketplaceConta("") === null);

    // ── criarConta: primeira conta vira principal sem pedir; segunda não ──
    const ml1 = await svc.criarConta({ clienteId: 1, marketplace: "meli", nome: "Mercado Livre 1", externalAccountId: "111" });
    ok("primeira conta MELI nasce principal automaticamente", ml1.is_primary === true);

    const ml2 = await svc.criarConta({ clienteId: 1, marketplace: "meli", nome: "Mercado Livre 2", externalAccountId: "222" });
    ok("segunda conta MELI não vira principal sem pedir", ml2.is_primary === false);

    const ml2Principal = await svc.definirContaPrincipal(ml2.id);
    ok("definirContaPrincipal promove a conta pedida", ml2Principal.is_primary === true);

    const ml1Depois = await svc.obterConta(ml1.id);
    ok("definirContaPrincipal despromove a anterior (só do mesmo marketplace)", ml1Depois.is_primary === false);

    await rejeitaCom(
      "definirContaPrincipal rejeita conta inativa",
      (async () => {
        await svc.atualizarConta(ml1.id, { ativo: false });
        await svc.definirContaPrincipal(ml1.id);
      })(),
      (e) => e.statusCode === 409
    );

    const ml1Inativa = await svc.obterConta(ml1.id);
    ok("desativar conta também limpa is_primary", ml1Inativa.ativo === false && ml1Inativa.is_primary === false);

    // ── Shopee: ambiguidade nunca é resolvida em silêncio ──────────────
    const sp1 = await svc.criarConta({ clienteId: 1, marketplace: "shopee", nome: "Shopee 1" });
    ok("única conta Shopee resolve automaticamente (compat)", (await svc.resolveMarketplaceAccountContext({
      clienteId: 1, marketplace: "shopee",
    })).conta.id === sp1.id);

    const sp2 = await svc.criarConta({ clienteId: 1, marketplace: "shopee", nome: "Shopee 2" });
    await rejeitaCom(
      "2+ contas Shopee ativas sem clienteContaId → MULTIPLE_MARKETPLACE_ACCOUNTS",
      svc.resolveMarketplaceAccountContext({ clienteId: 1, marketplace: "shopee" }),
      (e) => e.code === "MULTIPLE_MARKETPLACE_ACCOUNTS" && Array.isArray(e.contas) && e.contas.length === 2
    );

    const ctxExplicito = await svc.resolveMarketplaceAccountContext({ clienteId: 1, marketplace: "shopee", clienteContaId: sp2.id });
    ok("clienteContaId explícito ignora a ambiguidade e usa exatamente aquela conta", ctxExplicito.conta.id === sp2.id);

    // ── Base: marketplace da base tem que bater com o da conta ─────────
    db.bases.push({ id: 501, slug: "base-meli", nome: "Base ML", marketplace: "meli", ativo: true });
    db.bases.push({ id: 502, slug: "base-shopee", nome: "Base Shopee", marketplace: "shopee", ativo: true });

    await rejeitaCom(
      "Base Shopee não pode ir para conta MELI",
      svc.vincularBaseNaConta(ml2.id, 502),
      (e) => e.code === "BASE_MARKETPLACE_MISMATCH"
    );
    await rejeitaCom(
      "Base MELI não pode ir para conta Shopee",
      svc.vincularBaseNaConta(sp1.id, 501),
      (e) => e.code === "BASE_MARKETPLACE_MISMATCH"
    );

    await svc.vincularBaseNaConta(ml2.id, 501);
    const baseMl2 = await svc.obterBaseDaConta(ml2.id);
    ok("vínculo correto (mesmo marketplace) é aceito e resolvido por conta", baseMl2.base_id === 501 && baseMl2.resolvido_por === "conta");

    // ── obterBaseDaConta: fallback legado só quando a conta é única ────
    db.vinculos.push({ id: 9001, base_id: 502, cliente_id: 1, cliente_conta_id: null, marketplace: "shopee", ativo: true });
    const baseSp2Ambigua = await svc.obterBaseDaConta(sp2.id);
    ok("2 contas Shopee ativas → vínculo legado não é escolhido (ambíguo)", baseSp2Ambigua.base_id === null && baseSp2Ambigua.resolvido_por === null);

    await svc.atualizarConta(sp1.id, { ativo: false });
    const baseSp2Unica = await svc.obterBaseDaConta(sp2.id);
    ok("com 1 conta Shopee ativa restante, vínculo legado é aceito (determinístico)", baseSp2Unica.base_id === 502 && baseSp2Unica.resolvido_por === "legado_unico");

    // ── Desconexão de grant é sempre escopada à conta ──────────────────
    db.grants.push({ id: 9101, cliente_conta_id: ml1.id, ml_user_id: "111" });
    db.grants.push({ id: 9102, cliente_conta_id: ml2.id, ml_user_id: "222" });

    const resultado = await svc.desconectarGrantMlDaConta(ml1.id);
    ok("desconectar remove só o grant daquela conta", resultado.grants_removidos.includes(9101));
    ok("grant da outra conta continua intacto", db.grants.some((g) => g.id === 9102));
    ok("grant removido realmente sumiu", !db.grants.some((g) => g.id === 9101));

    await rejeitaCom(
      "desconectar de novo (sem grant) retorna 404, não apaga nada por engano",
      svc.desconectarGrantMlDaConta(ml1.id),
      (e) => e.statusCode === 404
    );

    await rejeitaCom(
      "desconectar grant ML de uma conta Shopee é rejeitado",
      svc.desconectarGrantMlDaConta(sp2.id),
      (e) => e.statusCode === 422
    );

    console.log(`\n✓ clienteContaService: ${checks} verificações`);
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
