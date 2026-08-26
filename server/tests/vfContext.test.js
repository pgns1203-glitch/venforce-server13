// server/tests/vfContext.test.js
//
// F0.3 — cobre Portal/vf-context.js: a máquina de estados do contexto
// operacional (MASTER_SPEC §6/§7). Os 33 casos canônicos (C01–C33, §21.1)
// mais os extras de robustez pedidos pela unidade.
//
// ES Module carregado via import() dinâmico a partir de um runner CommonJS
// — mesmo padrão de vfApi.test.js/vfFormat.test.js (F0.1/F0.2).
//
// O store não toca DOM — por isso ele foi desenhado sem conhecer a sidebar
// (regra de dependência do MASTER_SPEC §4.2). Tudo que toca o mundo externo
// (sessionStorage, URL/history, document, a API) é injetado via
// createVfContext(deps) / init({ api, user }).
//
// Portado de Squads_migration/preview_v3/test/vf-context.test.js (33 casos,
// já verdes ali) — os rótulos X01–X06 do rascunho viraram C28–C33, a
// numeração definitiva do MASTER_SPEC §21.1.

const assert = require("assert");
const path = require("path");

let checks = 0;
function ok(label, condition) {
  checks += 1;
  assert.ok(condition, `FALHOU: ${label}`);
  console.log(`  ok  ${label}`);
}
function eq(label, actual, expected) {
  checks += 1;
  assert.deepStrictEqual(actual, expected, `${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  console.log(`  ok  ${label}`);
}

/* ── Dublês ───────────────────────────────────────────────────────────── */

function storageFake(inicial) {
  const dados = Object.assign({}, inicial || {});
  return {
    getItem: (k) => (k in dados ? dados[k] : null),
    setItem: (k, v) => {
      dados[k] = String(v);
    },
    removeItem: (k) => {
      delete dados[k];
    },
    _dados: dados,
  };
}

// location + history mínimos, com a mesma semântica de replaceState do browser.
function urlFake(search) {
  const loc = { pathname: "/portal/pagina.html", search: search || "", hash: "" };
  const hist = {
    replaceState(_s, _t, alvo) {
      const i = String(alvo).indexOf("?");
      const j = String(alvo).indexOf("#");
      loc.search = i >= 0 ? String(alvo).slice(i, j >= 0 ? j : undefined) : "";
      loc.hash = j >= 0 ? String(alvo).slice(j) : "";
    },
  };
  return { loc, hist };
}

function documentFake() {
  const eventos = [];
  return {
    eventos,
    dispatchEvent(evt) {
      eventos.push(evt);
      return true;
    },
  };
}

class FakeCustomEvent {
  constructor(type, opts) {
    this.type = type;
    this.detail = opts && opts.detail;
  }
}

function apiFake(config) {
  const cfg = Object.assign(
    { clientes: [], contas: {}, erroCarteira: null, erroContas: null, atrasoContas: 0, contasNulo: false },
    config
  );
  const chamadas = [];
  return {
    chamadas,
    carteira() {
      chamadas.push("carteira");
      if (cfg.erroCarteira) return Promise.resolve(cfg.erroCarteira);
      return Promise.resolve({ ok: true, clientes: cfg.clientes });
    },
    contasDoCliente(ref, opts) {
      chamadas.push(`contas:${ref}`);
      if (cfg.contasNulo) return Promise.resolve(null); // vf-api.scoped() descartou
      if (cfg.erroContas) return Promise.resolve(cfg.erroContas);
      const lista = cfg.contas[ref] || [];
      if (!cfg.atrasoContas) return Promise.resolve({ ok: true, contas: lista });
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ ok: true, contas: lista }), cfg.atrasoContas);
        if (opts && opts.signal) {
          opts.signal.addEventListener("abort", () => {
            clearTimeout(t);
            const e = new Error("abort");
            e.name = "AbortError";
            reject(e);
          });
        }
      });
    },
  };
}

const C = (id, slug, contasAtivas) => ({ id, slug, nome: `Cliente ${slug}`, ativo: true, contasAtivas: contasAtivas ?? 1 });
const conta = (id, extra) =>
  Object.assign(
    {
      id,
      cliente_id: 1,
      marketplace: "meli",
      nome: `ML ${id}`,
      slug: `ml-${id}`,
      external_account_id: `ext-${id}`,
      is_primary: false,
      ativo: true,
      grant: { id: 900 + id, ml_user_id: `u${id}`, token_status: "valid", is_primary: false },
      base: { vinculo_id: 1, base_id: 9, slug: "b", nome: "Base", resolvido_por: "conta" },
    },
    extra || {}
  );

let novo;
let USER;
let createVfContext;

function tick(n) {
  let p = Promise.resolve();
  for (let i = 0; i < (n || 1); i++) p = p.then(() => {});
  return p;
}
function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const casos = [];
function caso(id, nome, fn) {
  casos.push({ id, nome, fn });
}

/* ── Casos canônicos C01–C33 (MASTER_SPEC §21.1) ─────────────────────── */

caso("C01", "0 clientes → NO_PORTFOLIO, nenhum setCliente", async () => {
  const t = novo({ clientes: [] });
  await t.store.init({ api: t.api, user: USER });
  eq("estado", t.store.getState(), "NO_PORTFOLIO");
  ok("nenhum contexto fixado", t.store.getContext() === null);
});

caso("C02", "1 cliente → NO_CLIENT (não auto-seleciona)", async () => {
  const t = novo({ clientes: [C(1, "a")] });
  await t.store.init({ api: t.api, user: USER });
  eq("estado", t.store.getState(), "NO_CLIENT");
  ok("nenhum cliente escolhido", t.store.getContext() === null);
  ok("nenhuma chamada de contas", t.api.chamadas.filter((c) => c.startsWith("contas")).length === 0);
});

caso("C03", "vários clientes → NO_CLIENT, nunca lista[0]", async () => {
  const t = novo({ clientes: [C(1, "a"), C(2, "b"), C(3, "c")] });
  await t.store.init({ api: t.api, user: USER });
  eq("estado", t.store.getState(), "NO_CLIENT");
  ok("nenhum cliente escolhido", t.store.getContext() === null);
});

caso("C04", "cliente com 0 contas → NO_ACTIVE_ACCOUNT", async () => {
  const t = novo({ clientes: [C(1, "a", 0)], contas: { a: [] } });
  await t.store.init({ api: t.api, user: USER });
  t.store.setCliente("a");
  await tick(3);
  eq("estado", t.store.getState(), "NO_ACTIVE_ACCOUNT");
  eq("cliente preservado", t.store.getContext().clienteSlug, "a");
  eq("conta nula", t.store.getContext().clienteContaId, null);
});

caso("C05", "cliente com 1 conta ativa → READY, conta auto", async () => {
  const t = novo({ clientes: [C(1, "a")], contas: { a: [conta(42)] } });
  await t.store.init({ api: t.api, user: USER });
  t.store.setCliente("a");
  await tick(3);
  eq("estado", t.store.getState(), "READY");
  eq("conta auto", t.store.getContext().clienteContaId, 42);
});

caso("C06", "cliente com 2 contas → ACCOUNT_CHOICE_REQUIRED, nenhuma marcada", async () => {
  const t = novo({ clientes: [C(1, "a", 2)], contas: { a: [conta(42), conta(43)] } });
  await t.store.init({ api: t.api, user: USER });
  t.store.setCliente("a");
  await tick(3);
  eq("estado", t.store.getState(), "ACCOUNT_CHOICE_REQUIRED");
  eq("nenhuma conta escolhida", t.store.getContext().clienteContaId, null);
});

caso("C07", "1 ativa + 1 inativa → READY na ativa; inativa nunca escolhida", async () => {
  const t = novo({ clientes: [C(1, "a", 1)], contas: { a: [conta(42), conta(43, { ativo: false })] } });
  await t.store.init({ api: t.api, user: USER });
  t.store.setCliente("a");
  await tick(3);
  eq("estado", t.store.getState(), "READY");
  eq("conta ativa escolhida", t.store.getContext().clienteContaId, 42);
  eq("inativa continua listada", t.store.getAccounts().length, 2);
});

caso("C08", "duplicata (fan-out, mesmo id 2×) conta como 1 → READY", async () => {
  const dup = conta(81);
  const t = novo({
    clientes: [C(1, "a", 1)],
    contas: { a: [dup, Object.assign({}, dup, { base: { base_id: 22, nome: "B" } })] },
  });
  await t.store.init({ api: t.api, user: USER });
  t.store.setCliente("a");
  await tick(3);
  eq("estado", t.store.getState(), "READY");
  eq("uma conta só", t.store.getAccounts().length, 1);
  eq("conta escolhida", t.store.getContext().clienteContaId, 81);
});

caso("C09", "conta de outro cliente via ?conta= → INVALID_ACCOUNT, cliente preservado", async () => {
  const t = novo({ clientes: [C(1, "a", 2)], contas: { a: [conta(42), conta(43)] } }, { search: "?cliente=a&conta=999" });
  await t.store.init({ api: t.api, user: USER });
  await tick(3);
  eq("estado", t.store.getState(), "INVALID_ACCOUNT");
  eq("cliente preservado", t.store.getContext().clienteSlug, "a");
  eq("conta limpa", t.store.getContext().clienteContaId, null);
});

caso("C10", "conta desativada em voo (409 CONTA_INATIVA) → ACCOUNT_INACTIVE, rota preservada", async () => {
  const t = novo({ clientes: [C(1, "a")], contas: { a: [conta(42)] } });
  await t.store.init({ api: t.api, user: USER });
  t.store.setCliente("a");
  await tick(3);
  eq("READY antes", t.store.getState(), "READY");
  t.store.signalContextError({ code: "CONTA_INATIVA" });
  eq("estado", t.store.getState(), "ACCOUNT_INACTIVE");
  eq("cliente preservado", t.store.getContext().clienteSlug, "a");
  eq("conta limpa", t.store.getContext().clienteContaId, null);
});

caso("C11", "setCliente SEMPRE zera clienteContaId (I1)", async () => {
  const t = novo({ clientes: [C(1, "a"), C(2, "b", 2)], contas: { a: [conta(42)], b: [conta(51), conta(52)] } });
  await t.store.init({ api: t.api, user: USER });
  t.store.setCliente("a");
  await tick(3);
  eq("conta de a", t.store.getContext().clienteContaId, 42);
  t.store.setCliente("b");
  await tick(3);
  eq("conta zerada ao trocar", t.store.getContext().clienteContaId, null);
  eq("estado", t.store.getState(), "ACCOUNT_CHOICE_REQUIRED");
});

caso("C12", "usuário trocado na mesma aba → contexto descartado no boot (I8)", async () => {
  const sessao = { "vf-ctx": JSON.stringify({ v: 1, userId: 999, clienteId: 1, clienteSlug: "a", clienteContaId: 42 }) };
  const t = novo({ clientes: [C(1, "a")], contas: { a: [conta(42)] } }, { sessao });
  await t.store.init({ api: t.api, user: USER }); // user.id = 12 ≠ 999
  await tick(3);
  eq("estado", t.store.getState(), "NO_CLIENT");
  ok("sessão apagada", t.storage.getItem("vf-ctx") === null);
});

caso("C13", "novo login → clearOperationalContext() → NO_CLIENT", async () => {
  const t = novo({ clientes: [C(1, "a")], contas: { a: [conta(42)] } });
  await t.store.init({ api: t.api, user: USER });
  t.store.setCliente("a");
  await tick(3);
  eq("READY", t.store.getState(), "READY");
  t.store.clearOperationalContext();
  eq("estado", t.store.getState(), "NO_CLIENT");
  ok("contexto vazio", t.store.getContext() === null);
});

caso("C14", "logout limpa sessão e parâmetros da URL (inclusive período)", async () => {
  const t = novo({ clientes: [C(1, "a")], contas: { a: [conta(42)] } }, { search: "?cliente=a&conta=42&periodo=2026-08" });
  await t.store.init({ api: t.api, user: USER });
  await tick(3);
  ok("sessão gravada", t.storage.getItem("vf-ctx") !== null);
  t.store.clearOperationalContext();
  ok("sessão limpa", t.storage.getItem("vf-ctx") === null);
  ok("sem ?cliente= na URL", t.loc.search.indexOf("cliente") < 0);
  ok("sem ?conta= na URL", t.loc.search.indexOf("conta") < 0);
  ok("periodo resetado", t.loc.search.indexOf("periodo") < 0);
});

caso("C15", "refresh com sessão válida → revalida e volta a READY, sem flash", async () => {
  const sessao = { "vf-ctx": JSON.stringify({ v: 1, userId: 12, clienteId: 1, clienteSlug: "a", clienteContaId: 42 }) };
  const t = novo({ clientes: [C(1, "a")], contas: { a: [conta(42)] } }, { sessao });
  await t.store.init({ api: t.api, user: USER });
  await tick(3);
  eq("estado", t.store.getState(), "READY");
  eq("conta restaurada", t.store.getContext().clienteContaId, 42);
});

caso("C16", "deep link válido → READY direto", async () => {
  const t = novo({ clientes: [C(1, "a", 2)], contas: { a: [conta(42), conta(43)] } }, { search: "?cliente=a&conta=43" });
  await t.store.init({ api: t.api, user: USER });
  await tick(3);
  eq("estado", t.store.getState(), "READY");
  eq("conta do deep link", t.store.getContext().clienteContaId, 43);
});

caso("C17", "deep link com cliente inválido → INVALID_CLIENT, params removidos", async () => {
  const t = novo({ clientes: [C(1, "a")], contas: { a: [conta(42)] } }, { search: "?cliente=zzz&conta=42" });
  await t.store.init({ api: t.api, user: USER });
  await tick(3);
  eq("estado", t.store.getState(), "INVALID_CLIENT");
  ok("params removidos", t.loc.search.indexOf("cliente") < 0 && t.loc.search.indexOf("conta") < 0);
});

caso("C18", "alias ?clienteSlug= lido e reescrito para ?cliente=", async () => {
  const t = novo({ clientes: [C(1, "a")], contas: { a: [conta(42)] } }, { search: "?clienteSlug=a" });
  await t.store.init({ api: t.api, user: USER });
  await tick(3);
  eq("estado", t.store.getState(), "READY");
  ok("URL canônica", t.loc.search.indexOf("cliente=a") >= 0);
  ok("alias removido", t.loc.search.indexOf("clienteSlug") < 0);
});

caso("C19", "aliases ?slug= e ?clienteContaId= lidos e reescritos", async () => {
  const t = novo({ clientes: [C(1, "a", 2)], contas: { a: [conta(42), conta(43)] } }, { search: "?slug=a&clienteContaId=43" });
  await t.store.init({ api: t.api, user: USER });
  await tick(3);
  eq("estado", t.store.getState(), "READY");
  eq("conta do alias", t.store.getContext().clienteContaId, 43);
  ok("forma canônica", t.loc.search.indexOf("cliente=a") >= 0 && t.loc.search.indexOf("conta=43") >= 0);
  ok("aliases removidos", t.loc.search.indexOf("slug=") < 0 && t.loc.search.indexOf("clienteContaId") < 0);
});

caso("C20", "corrida: troca de cliente com contas antigas em voo (I9)", async () => {
  const t = novo({
    clientes: [C(1, "a"), C(2, "b")],
    contas: { a: [conta(42)], b: [conta(51)] },
    atrasoContas: 40,
  });
  await t.store.init({ api: t.api, user: USER });
  t.store.setCliente("a");
  await tick(1);
  t.store.setCliente("b"); // troca ANTES de "a" responder
  await esperar(120);
  eq("estado", t.store.getState(), "READY");
  eq("cliente final", t.store.getContext().clienteSlug, "b");
  eq("conta final", t.store.getContext().clienteContaId, 51);
});

caso("C21", "corrida: ML1 → ML2 — nenhum sinal de ML1 depois", async () => {
  const t = novo({ clientes: [C(1, "a", 2)], contas: { a: [conta(42), conta(43)] } });
  await t.store.init({ api: t.api, user: USER });
  t.store.setCliente("a");
  await tick(3);
  t.store.setConta(42);
  await tick(1);
  const sinais = [];
  t.store.subscribe((s) => sinais.push({ reason: s.reason, conta: s.context && s.context.clienteContaId }));
  t.store.setConta(43);
  const finais = sinais.filter((s) => s.reason === "conta");
  ok("sinal 'conta' emitido antes do READY", finais.length >= 2);
  eq("contexto final é ML2", t.store.getContext().clienteContaId, 43);
  ok("nenhum sinal posterior aponta para ML1", sinais[sinais.length - 1].conta === 43);
});

caso("C22", "403 CLIENTE_FORA_DA_CARTEIRA → FORBIDDEN + descarta", async () => {
  const t = novo({ clientes: [C(1, "a")], contas: { a: [conta(42)] } });
  await t.store.init({ api: t.api, user: USER });
  t.store.setCliente("a");
  await tick(3);
  t.store.signalContextError({ code: "CLIENTE_FORA_DA_CARTEIRA" });
  eq("estado", t.store.getState(), "FORBIDDEN");
  ok("contexto DESCARTADO", t.store.getContext() === null);
  ok("sessão limpa", t.storage.getItem("vf-ctx") === null);
});

caso("C23", "424 GRANT_DESCONECTADO → permanece READY (flag de integração)", async () => {
  const t = novo({ clientes: [C(1, "a")], contas: { a: [conta(42)] } });
  await t.store.init({ api: t.api, user: USER });
  t.store.setCliente("a");
  await tick(3);
  t.store.signalContextError({ code: "GRANT_DESCONECTADO" });
  eq("estado PERMANECE READY", t.store.getState(), "READY");
  eq("flag de integração", t.store.getIntegration().grant, "atencao");
  eq("contexto preservado", t.store.getContext().clienteContaId, 42);
});

caso("C24", "424 BASE_AUSENTE → permanece READY", async () => {
  const t = novo({ clientes: [C(1, "a")], contas: { a: [conta(42)] } });
  await t.store.init({ api: t.api, user: USER });
  t.store.setCliente("a");
  await tick(3);
  t.store.signalContextError({ code: "BASE_AUSENTE" });
  eq("estado PERMANECE READY", t.store.getState(), "READY");
  eq("flag de base", t.store.getIntegration().base, "ausente");
});

caso("C25", "URL vence a sessão quando discordam", async () => {
  const sessao = { "vf-ctx": JSON.stringify({ v: 1, userId: 12, clienteId: 2, clienteSlug: "b", clienteContaId: 51 }) };
  const t = novo(
    { clientes: [C(1, "a"), C(2, "b")], contas: { a: [conta(42)], b: [conta(51)] } },
    { sessao, search: "?cliente=a" }
  );
  await t.store.init({ api: t.api, user: USER });
  await tick(3);
  eq("cliente da URL venceu", t.store.getContext().clienteSlug, "a");
});

caso("C26", "falha de rede na carteira → PORTFOLIO_ERROR (≠ NO_PORTFOLIO)", async () => {
  const t = novo({ erroCarteira: { ok: false, code: "SERVIDOR", erro: "500" } });
  await t.store.init({ api: t.api, user: USER });
  eq("estado", t.store.getState(), "PORTFOLIO_ERROR");
  ok("não é NO_PORTFOLIO", t.store.getState() !== "NO_PORTFOLIO");
});

caso("C27", "período: preservado ao trocar CONTA, resetado ao trocar CLIENTE", async () => {
  const t = novo(
    { clientes: [C(1, "a", 2), C(2, "b")], contas: { a: [conta(42), conta(43)], b: [conta(51)] } },
    { search: "?cliente=a&conta=42&periodo=2026-07" }
  );
  await t.store.init({ api: t.api, user: USER });
  await tick(3);
  eq("periodo lido", t.store.getPeriodoParam(), "2026-07");
  t.store.setConta(43);
  eq("periodo preservado ao trocar CONTA", t.store.getPeriodoParam(), "2026-07");
  t.store.setCliente("b");
  await tick(3);
  eq("periodo resetado ao trocar CLIENTE", t.store.getPeriodoParam(), null);
});

caso("C28", "403 vindo da carga de contas (carteira desatualizada) → FORBIDDEN + descarta", async () => {
  const t = novo({ clientes: [C(1, "a")], erroContas: { ok: false, code: "CLIENTE_FORA_DA_CARTEIRA", erro: "403" } });
  await t.store.init({ api: t.api, user: USER });
  t.store.setCliente("a");
  await tick(3);
  eq("estado", t.store.getState(), "FORBIDDEN");
  ok("contexto descartado", t.store.getContext() === null);
});

caso("C29", "setConta() numa conta inativa é rejeitado → ACCOUNT_INACTIVE (I3)", async () => {
  const t = novo({ clientes: [C(1, "a", 2)], contas: { a: [conta(42), conta(43), conta(44, { ativo: false })] } });
  await t.store.init({ api: t.api, user: USER });
  t.store.setCliente("a");
  await tick(3);
  const aceitou = t.store.setConta(44);
  eq("rejeitado", aceitou, false);
  eq("estado", t.store.getState(), "ACCOUNT_INACTIVE");
});

caso("C30", "conta Shopee sem grant, mas com base → READY, status conectado (M7)", async () => {
  const shopee = conta(61, { marketplace: "shopee", grant: null });
  const t = novo({ clientes: [C(1, "a")], contas: { a: [shopee] } });
  await t.store.init({ api: t.api, user: USER });
  t.store.setCliente("a");
  await tick(3);
  eq("estado", t.store.getState(), "READY");
  eq("status da operação", t.store.getAccountMeta().status.code, "conectado");
  ok("integração de grant não se aplica a Shopee", t.store.getIntegration().grant === null);
});

caso("C31", "conta sem externalAccountLabel → rótulo cai para external_account_id (§14.3)", async () => {
  const semLabel = conta(42, { externalAccountLabel: undefined });
  const t = novo({ clientes: [C(1, "a")], contas: { a: [semLabel] } });
  await t.store.init({ api: t.api, user: USER });
  t.store.setCliente("a");
  await tick(3);
  eq("fallback", t.store.getAccountMeta().externalAccountLabel, "ext-42");
});

caso("C32", "forma do contexto canônico: exatamente três chaves; marketplace não está nele (§6.1)", async () => {
  const t = novo({ clientes: [C(1, "a")], contas: { a: [conta(42)] } });
  await t.store.init({ api: t.api, user: USER });
  t.store.setCliente("a");
  await tick(3);
  const ctx = t.store.getContext();
  eq("três campos e só três", Object.keys(ctx).sort().join(","), "clienteContaId,clienteId,clienteSlug");
  ok("marketplace NÃO está no contexto", !("marketplace" in ctx));
  eq("marketplace está no meta", t.store.getAccountMeta().marketplace, "meli");
});

caso("C33", "clearOperationalContext() sobre PORTFOLIO_ERROR não conserta a carteira (M12)", async () => {
  // Regressão real, encontrada rodando o protótipo: limpar o contexto no
  // login sobrescrevia PORTFOLIO_ERROR com NO_PORTFOLIO, e o operador via
  // "você não tem clientes" quando o certo era "não deu para carregar".
  const t = novo({ erroCarteira: { ok: false, code: "SERVIDOR", erro: "500" } });
  await t.store.init({ api: t.api, user: USER });
  eq("estado após falha", t.store.getState(), "PORTFOLIO_ERROR");
  t.store.clearOperationalContext();
  eq("continua PORTFOLIO_ERROR", t.store.getState(), "PORTFOLIO_ERROR");
  ok("não virou NO_PORTFOLIO", t.store.getState() !== "NO_PORTFOLIO");
  ok("erro preservado para o banner", !!t.store.getError());
});

/* ── Testes extras — robustez pedida além dos 33 canônicos ───────────── */

caso("E01", "subscribe() entrega snapshot imediato e unsubscribe() para de receber", async () => {
  const t = novo({ clientes: [C(1, "a")], contas: { a: [conta(42)] } });
  await t.store.init({ api: t.api, user: USER });
  const recebidos = [];
  const unsubscribe = t.store.subscribe((s) => recebidos.push(s.state));
  eq("snapshot imediato no subscribe", recebidos[0], "NO_CLIENT");
  unsubscribe();
  t.store.setCliente("a");
  await tick(3);
  eq("nada mais chegou após unsubscribe", recebidos.length, 1);
});

caso("E02", "window.VF preserva config/format/api já publicados; publica window.VF.context", async () => {
  global.window = global;
  window.VF = { config: { apiBase: "preexistente" }, format: { moeda: () => "x" }, api: { get: () => {} } };
  const modUrl = `file://${path.join(__dirname, "..", "..", "Portal", "vf-context.js")}?bridge-check`;
  const mod = await import(modUrl);
  ok("window.VF.config não foi apagado", window.VF.config && window.VF.config.apiBase === "preexistente");
  ok("window.VF.format não foi apagado", window.VF.format && typeof window.VF.format.moeda === "function");
  ok("window.VF.api não foi apagado", window.VF.api && typeof window.VF.api.get === "function");
  ok("window.VF.context foi publicado", window.VF.context === mod.vfContext);
  delete global.window;
});

caso("E03", "ordem dos reasons: cliente → conta (RESOLVING_ACCOUNTS) → conta (READY)", async () => {
  const t = novo({ clientes: [C(1, "a")], contas: { a: [conta(42)] } });
  await t.store.init({ api: t.api, user: USER });
  const reasons = [];
  t.store.subscribe((s) => reasons.push(s.reason));
  t.store.setCliente("a");
  await tick(3);
  // primeiro reason após o subscribe (que já emitiu "subscribe") é "cliente"
  // (RESOLVING_CLIENT), seguido por "cliente" de novo (RESOLVING_ACCOUNTS) e
  // "conta" (READY, auto-seleção de conta única).
  eq("sequência de reasons", reasons, ["subscribe", "cliente", "cliente", "conta"]);
});

caso("E04", "dupla chamada rápida de setCliente(mesmo ref) é estável, sem estado inconsistente", async () => {
  const t = novo({ clientes: [C(1, "a", 2)], contas: { a: [conta(42), conta(43)] } });
  await t.store.init({ api: t.api, user: USER });
  t.store.setCliente("a");
  t.store.setCliente("a"); // segunda chamada imediata, mesmo cliente
  await tick(3);
  eq("estado final consistente", t.store.getState(), "ACCOUNT_CHOICE_REQUIRED");
  eq("cliente correto", t.store.getContext().clienteSlug, "a");
});

caso("E05", "segunda init() reseta o estado completamente (sem resíduo do boot anterior)", async () => {
  const t = novo({ clientes: [C(1, "a")], contas: { a: [conta(42)] } });
  await t.store.init({ api: t.api, user: USER });
  t.store.setCliente("a");
  await tick(3);
  eq("READY na primeira sessão", t.store.getState(), "READY");

  const api2 = apiFake({ clientes: [] });
  await t.store.init({ api: api2, user: USER });
  eq("segunda init() reflete a nova carteira", t.store.getState(), "NO_PORTFOLIO");
  ok("contexto da sessão anterior não sobrevive", t.store.getContext() === null);
});

caso("E06", "sessionStorage corrompido (JSON inválido) é descartado, boot cai para NO_CLIENT", async () => {
  const t = novo({ clientes: [C(1, "a")], contas: { a: [conta(42)] } }, { sessao: { "vf-ctx": "{não é json" } });
  await t.store.init({ api: t.api, user: USER });
  await tick(3);
  eq("estado", t.store.getState(), "NO_CLIENT");
});

caso("E07", "versão desconhecida em vf-ctx (v != 1) é descartada", async () => {
  const sessao = { "vf-ctx": JSON.stringify({ v: 2, userId: 12, clienteId: 1, clienteSlug: "a", clienteContaId: 42 }) };
  const t = novo({ clientes: [C(1, "a")], contas: { a: [conta(42)] } }, { sessao });
  await t.store.init({ api: t.api, user: USER });
  await tick(3);
  eq("estado", t.store.getState(), "NO_CLIENT");
});

caso("E08", "?conta= como string numérica funciona igual a number (comparação por String())", async () => {
  const t = novo({ clientes: [C(1, "a", 2)], contas: { a: [conta(42), conta(43)] } }, { search: "?cliente=a&conta=43" });
  await t.store.init({ api: t.api, user: USER });
  await tick(3);
  eq("estado", t.store.getState(), "READY");
  eq("conta resolvida", t.store.getContext().clienteContaId, 43);
});

caso("E09", "?conta= com valor não numérico → INVALID_ACCOUNT, cliente preservado", async () => {
  const t = novo({ clientes: [C(1, "a", 2)], contas: { a: [conta(42), conta(43)] } }, { search: "?cliente=a&conta=abc" });
  await t.store.init({ api: t.api, user: USER });
  await tick(3);
  eq("estado", t.store.getState(), "INVALID_ACCOUNT");
  eq("cliente preservado", t.store.getContext().clienteSlug, "a");
});

caso("E10", "resposta com 'contas' ausente no corpo (não só vazio) → NO_ACTIVE_ACCOUNT, sem lançar", async () => {
  const api = {
    carteira: () => Promise.resolve({ ok: true, clientes: [C(1, "a")] }),
    contasDoCliente: () => Promise.resolve({ ok: true }), // sem campo "contas"
  };
  const { loc, hist } = urlFake("");
  const storage = storageFake({});
  const t = { store: createVfContext({ storage, url: loc, history: hist }) };
  await t.store.init({ api, user: USER });
  t.store.setCliente("a");
  await tick(3);
  eq("estado", t.store.getState(), "NO_ACTIVE_ACCOUNT");
});

caso("E11", "AbortError direto em contasDoCliente não produz erro nem muda lastError", async () => {
  const api = {
    carteira: () => Promise.resolve({ ok: true, clientes: [C(1, "a")] }),
    contasDoCliente: () => {
      const e = new Error("abort");
      e.name = "AbortError";
      return Promise.reject(e);
    },
  };
  const { loc, hist } = urlFake("");
  const storage = storageFake({});
  const t = { store: createVfContext({ storage, url: loc, history: hist }) };
  await t.store.init({ api, user: USER });
  t.store.setCliente("a");
  await tick(3);
  eq("estado permanece RESOLVING_ACCOUNTS (nenhuma resposta chegou)", t.store.getState(), "RESOLVING_ACCOUNTS");
  ok("nenhum erro registrado", t.store.getError() === null);
});

caso("E12", "vf-api.scoped() retornando null (contexto obsoleto) é descartado silenciosamente", async () => {
  const t = novo({ clientes: [C(1, "a")], contasNulo: true });
  await t.store.init({ api: t.api, user: USER });
  t.store.setCliente("a");
  await tick(3);
  eq("estado permanece RESOLVING_ACCOUNTS (resposta null descartada)", t.store.getState(), "RESOLVING_ACCOUNTS");
  ok("nenhum erro registrado", t.store.getError() === null);
});

caso("E13", "conta duplicada com metadados diferentes: dedupe mantém a PRIMEIRA ocorrência", async () => {
  const t = novo({
    clientes: [C(1, "a", 1)],
    contas: { a: [conta(90, { nome: "Primeira" }), conta(90, { nome: "Segunda" })] },
  });
  await t.store.init({ api: t.api, user: USER });
  t.store.setCliente("a");
  await tick(3);
  eq("uma conta só", t.store.getAccounts().length, 1);
  eq("mantém a primeira ocorrência", t.store.getAccountMeta().nome, "Primeira");
});

caso("E14", "getAccounts() lista ativas primeiro, preservando ordem original dentro do grupo", async () => {
  const t = novo({
    clientes: [C(1, "a", 3)],
    contas: { a: [conta(1, { ativo: false }), conta(2), conta(3, { ativo: false }), conta(4)] },
  });
  await t.store.init({ api: t.api, user: USER });
  t.store.setCliente("a");
  await tick(3);
  eq("ativas primeiro, ordem preservada", t.store.getAccounts().map((c) => c.id), [2, 4, 1, 3]);
});

caso("E15", "ponte DOM: evento vf:context é disparado com o mesmo snapshot do subscribe", async () => {
  const { loc, hist } = urlFake("");
  const storage = storageFake({});
  const doc = documentFake();
  const store = createVfContext({ storage, url: loc, history: hist, document: doc, CustomEvent: FakeCustomEvent });
  const api = apiFake({ clientes: [C(1, "a")], contas: { a: [conta(42)] } });
  await store.init({ api, user: USER });
  const antes = doc.eventos.length;
  store.setCliente("a");
  await tick(3);
  ok("pelo menos um evento vf:context disparado", doc.eventos.length > antes);
  ok("todos os eventos são do tipo vf:context", doc.eventos.every((e) => e.type === "vf:context"));
  const ultimo = doc.eventos[doc.eventos.length - 1];
  eq("detail carrega o mesmo snapshot (state)", ultimo.detail.state, store.getState());
});

caso("E16", "clienteId numérico via alias ?clienteId= resolve e reescreve para ?cliente=<slug>", async () => {
  const t = novo({ clientes: [C(7, "n97")], contas: { n97: [conta(42)] } }, { search: "?clienteId=7" });
  await t.store.init({ api: t.api, user: USER });
  await tick(3);
  eq("estado", t.store.getState(), "READY");
  eq("resolvido pelo slug", t.store.getContext().clienteSlug, "n97");
  ok("URL reescrita para forma canônica com slug", t.loc.search.indexOf("cliente=n97") >= 0);
  ok("alias removido", t.loc.search.indexOf("clienteId") < 0);
});

/* ── Runner ───────────────────────────────────────────────────────────── */

(async () => {
  const modPath = path.join(__dirname, "..", "..", "Portal", "vf-context.js");
  ({ createVfContext } = await import(`file://${modPath}`));

  novo = (cfgApi, cfgStore) => {
    const { loc, hist } = urlFake((cfgStore && cfgStore.search) || "");
    const storage = storageFake((cfgStore && cfgStore.sessao) || {});
    const store = createVfContext({ storage, url: loc, history: hist });
    const api = apiFake(cfgApi);
    return { store, api, loc, storage };
  };
  USER = { id: 12, nome: "Pedro" };

  console.log("\nvf-context — máquina de estados do contexto operacional\n");
  let falhou = 0;
  for (const c of casos) {
    console.log(`  ${c.id} · ${c.nome}`);
    try {
      await c.fn();
    } catch (err) {
      falhou += 1;
      console.log(`    ✗ ${err.message}`);
    }
  }
  console.log(`\n${falhou ? "✗" : "✓"} ${casos.length} casos · ${checks} asserções · ${falhou} falha(s)\n`);
  process.exit(falhou ? 1 : 0);
})();
