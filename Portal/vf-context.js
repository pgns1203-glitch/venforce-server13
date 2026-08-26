// Portal/vf-context.js
//
// A máquina de estados do contexto operacional do Shell V3 (F0.3) —
// MASTER_SPEC §6/§7. É o único dono frontend de
//
//   { clienteId, clienteSlug, clienteContaId }
//
// Marketplace, Squad e período NÃO entram nessa identidade (D6, D10, D11).
// Metadados de exibição (marketplace, nome, externalAccountLabel,
// grantStatus, baseVinculada, ultimaSync) vivem em getAccountMeta(), que é
// cache de EXIBIÇÃO e nunca decide nada.
//
// Portado do rascunho executável, já testado (33 casos):
//   Squads_migration/preview_v3/js/vf-context.js
//   Squads_migration/preview_v3/test/vf-context.test.js
// Divergências deliberadas em relação ao rascunho estão anotadas inline com
// "DIVERGÊNCIA" e resumidas no relatório de entrega da unidade F0.3.
//
// Não toca DOM (nenhuma referência a sidebar/elementos), não decide acesso
// (I10 — 403 é estado, não filtro) e não conhece Cliente/ClienteConta/Grant/
// Base do backend: `api` é injetado em init(), com o único contrato mínimo
// { carteira(), contasDoCliente(ref, opts) } — os endpoints reais
// (/me/portfolio, GET /clientes/:cliente/contas) ainda são "CONTRATO
// NECESSÁRIO"/"PRECISA AJUSTE" (MASTER_SPEC §18); a fiação com vf-api.js
// pertence a F1/F2, não a esta unidade.
//
// createVfContext(deps) é a fábrica testável (mesmo padrão de
// createVfApi(options) em vf-api.js): tudo que toca o mundo externo
// (sessionStorage, URL/history, document) é injetável.
//
// ES Module. Também espelhado em window.VF.context — window.VF é PONTE,
// nunca fonte; ninguém escreve em window.VF.context.<campo>, só pelos
// métodos publicados aqui (MASTER_SPEC §15.3).

export const STATES = Object.freeze({
  BOOT: "BOOT",
  PORTFOLIO_ERROR: "PORTFOLIO_ERROR",
  NO_PORTFOLIO: "NO_PORTFOLIO",
  NO_CLIENT: "NO_CLIENT",
  RESOLVING_CLIENT: "RESOLVING_CLIENT",
  INVALID_CLIENT: "INVALID_CLIENT",
  FORBIDDEN: "FORBIDDEN",
  RESOLVING_ACCOUNTS: "RESOLVING_ACCOUNTS",
  NO_ACTIVE_ACCOUNT: "NO_ACTIVE_ACCOUNT",
  ACCOUNT_CHOICE_REQUIRED: "ACCOUNT_CHOICE_REQUIRED",
  INVALID_ACCOUNT: "INVALID_ACCOUNT",
  ACCOUNT_INACTIVE: "ACCOUNT_INACTIVE",
  READY: "READY",
});

const SESSION_KEY = "vf-ctx";
const SESSION_VERSION = 1;

// Aliases de leitura — MASTER_SPEC §8.2, tabela literal (5 linhas além do
// canônico ?cliente=). DIVERGÊNCIA do rascunho: o protótipo tolerava mais
// três nomes (cliente_id, cliente_conta_id, contaId) sem base no spec; esta
// versão lê só o que a tabela do §8.2 documenta, porque "é removida em F6"
// e uma tabela menor é uma dívida menor.
const ALIAS_CLIENTE = ["cliente", "clienteSlug", "cliente_slug", "slug"];
const ALIAS_CLIENTE_ID = ["clienteId"];
const ALIAS_CONTA = ["conta", "clienteContaId"];
const ALL_ALIASES = ALIAS_CLIENTE.concat(ALIAS_CLIENTE_ID, ALIAS_CONTA);

const PERIODO_PATTERN = /^\d{4}-\d{2}$/;

/* Status da operação é MARKETPLACE-AWARE (§14, melhoria M7):
   clientes-contas-resumo.js já define isto — no Mercado Livre "operacional"
   é grant válido; na Shopee/TikTok é base vinculada. Um grantStatus
   genérico marcaria toda conta Shopee como "sem grant". Cache de EXIBIÇÃO
   só — nunca decide nada (§6.1). */
export function statusOperacao(conta) {
  if (!conta) return { code: "desconhecido", label: "—", symbol: "○", tone: "neutral" };
  if (conta.marketplace === "meli") {
    if (!conta.grant) return { code: "sem_grant", label: "Aguardando grant", symbol: "○", tone: "empty" };
    const st = String(conta.grant.token_status || "valid").toLowerCase();
    if (st === "valid") return { code: "conectado", label: "Conectado", symbol: "●", tone: "success" };
    return { code: "atencao", label: "Grant com problema", symbol: "⚠", tone: "warning" };
  }
  if (conta.base && conta.base.base_id) {
    return { code: "conectado", label: "Configurada", symbol: "●", tone: "success" };
  }
  return { code: "sem_base", label: "Sem base vinculada", symbol: "○", tone: "empty" };
}

/* Rótulo humano da operação (§14.3). externalAccountLabel é contrato
   necessário; external_account_id já existe hoje (clienteContaService.js:51,
   bases.js:672 já o exibe). Feio e correto vence bonito e ambíguo.
   is_primary NUNCA desambigua (D17). */
export function rotuloExterno(conta) {
  if (!conta) return "";
  return conta.externalAccountLabel || conta.external_account_id || `#${conta.id}`;
}

function emptyContext() {
  return { clienteId: null, clienteSlug: null, clienteContaId: null };
}

// I6 — o LEFT JOIN de listarContasDoCliente faz fan-out quando a conta tem
// 2+ vínculos de base ativos (duplicidade confirmada em produção).
// Duplicata vira "2 contas" na UI: exatamente a ambiguidade que o modelo
// inteiro existe para evitar.
function dedupeById(lista) {
  const vistos = new Set();
  const out = [];
  for (const c of lista || []) {
    if (!c || vistos.has(c.id)) continue;
    vistos.add(c.id);
    out.push(c);
  }
  return out;
}

function activeOnly(lista) {
  return (lista || []).filter((c) => c.ativo !== false);
}

// createVfContext(deps) — fábrica testável. deps.storage/url/history/document
// são injetáveis (mesmo padrão de createVfApi). Sem deps, cada leitura já é
// protegida por `typeof window !== "undefined"` no singleton exportado no
// fim do arquivo.
export function createVfContext(deps = {}) {
  const storage = deps.storage || null;
  const loc = deps.url || null;
  const hist = deps.history || null;
  const docRef = deps.document || null;
  const CustomEventImpl = deps.CustomEvent || (typeof CustomEvent !== "undefined" ? CustomEvent : null);

  let api = null; // injetado em init()
  let user = null;
  let scope = null; // aceito e preservado; ver nota de divergência no relatório

  let state = STATES.BOOT;
  let portfolio = []; // clientes autorizados — o servidor já filtrou (I10)
  let accounts = []; // contas do cliente atual, deduplicadas
  let ctx = emptyContext();
  let integration = { grant: null, base: null };
  let lastError = null;

  let listeners = [];
  let clientSeq = 0; // I9
  let accountsSeq = 0; // I9
  let accountsAbort = null;

  /* ── emissão ──────────────────────────────────────────────────────── */

  function snapshot(reason) {
    return {
      state,
      context: ctx.clienteId
        ? { clienteId: ctx.clienteId, clienteSlug: ctx.clienteSlug, clienteContaId: ctx.clienteContaId }
        : null,
      meta: getAccountMeta(),
      integration: { grant: integration.grant, base: integration.base },
      error: lastError,
      reason: reason || "update",
    };
  }

  function emit(reason) {
    const snap = snapshot(reason);
    for (const fn of listeners.slice()) {
      try {
        fn(snap);
      } catch {
        /* um assinante quebrado não derruba os outros */
      }
    }
    // Ponte de LEITURA para scripts clássicos (§15.3). A assinatura
    // autoritativa continua sendo subscribe(); isto nunca vira um segundo
    // store — só entrega o mesmo snapshot em formato de evento DOM.
    if (docRef && typeof docRef.dispatchEvent === "function" && CustomEventImpl) {
      try {
        docRef.dispatchEvent(new CustomEventImpl("vf:context", { detail: snap }));
      } catch {
        /* ambiente sem suporte real de eventos — a ponte de leitura é best-effort */
      }
    }
  }

  function setState(next, reason) {
    state = next;
    emit(reason);
  }

  function subscribe(fn) {
    listeners.push(fn);
    try {
      fn(snapshot("subscribe"));
    } catch {
      /* idem */
    }
    return function unsubscribe() {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  /* ── URL ──────────────────────────────────────────────────────────── */

  function currentParams() {
    if (!loc) return new URLSearchParams("");
    return new URLSearchParams(loc.search || "");
  }

  function readContextFromUrl() {
    const q = currentParams();
    let slug = null;
    let id = null;
    let conta = null;
    for (const n of ALIAS_CLIENTE) {
      if (slug) break;
      slug = q.get(n);
    }
    for (const n of ALIAS_CLIENTE_ID) {
      if (id) break;
      id = q.get(n);
    }
    for (const n of ALIAS_CONTA) {
      if (conta) break;
      conta = q.get(n);
    }
    if (!slug && !id) return null;
    return {
      clienteRef: slug || id,
      refKind: slug ? "slug" : "id",
      clienteContaId: conta ? Number(conta) : null,
    };
  }

  function replaceUrl(q) {
    if (!loc || !hist) return;
    const qs = q.toString();
    const alvo = loc.pathname + (qs ? `?${qs}` : "") + (loc.hash || "");
    try {
      // replaceState, NUNCA pushState: contexto não é passo de navegação e um
      // "voltar" que desfaz o contexto seria uma armadilha (§8.2).
      hist.replaceState(null, "", alvo);
    } catch {
      /* origem opaca (file://) recusa replaceState em alguns navegadores —
         o contexto continua funcional em memória/sessão; só a URL não reflete */
    }
  }

  function writeUrl() {
    if (!loc || !hist) return;
    const q = currentParams();
    ALL_ALIASES.forEach((n) => q.delete(n)); // a URL sai sempre na forma canônica
    if (ctx.clienteSlug) q.set("cliente", ctx.clienteSlug);
    if (ctx.clienteContaId) q.set("conta", String(ctx.clienteContaId));
    replaceUrl(q);
  }

  function stripContextParamsFromUrl() {
    if (!loc || !hist) return;
    const q = currentParams();
    ALL_ALIASES.forEach((n) => q.delete(n));
    replaceUrl(q);
  }

  // Período — MASTER_SPEC §8.5. NÃO é contexto (D11): passageiro na URL,
  // nunca em getContext(). Preservado ao trocar módulo/conta, resetado ao
  // trocar cliente.
  function getPeriodoParam() {
    const v = currentParams().get("periodo");
    return PERIODO_PATTERN.test(String(v || "")) ? v : null;
  }

  function setPeriodoParam(valor) {
    if (!loc || !hist) return;
    const q = currentParams();
    if (valor) q.set("periodo", valor);
    else q.delete("periodo");
    replaceUrl(q);
  }

  /* ── sessionStorage ───────────────────────────────────────────────── */
  /* Armazenamento de aba (§6.2) — nunca o de longo prazo (proibido pela
     D3/D12 de §6.2): "novo login começa sem cliente" vira propriedade do
     mecanismo. O carimbo userId (D13) cobre a aba viva que troca de usuário. */

  function readSession() {
    if (!storage) return null;
    try {
      const raw = storage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== SESSION_VERSION) return null; // versão desconhecida: descartada
      return parsed;
    } catch {
      return null; // JSON corrompido: descartado, silencioso
    }
  }

  function writeSession() {
    if (!storage) return;
    try {
      if (!ctx.clienteId) {
        storage.removeItem(SESSION_KEY);
        return;
      }
      storage.setItem(
        SESSION_KEY,
        JSON.stringify({
          v: SESSION_VERSION,
          userId: user ? user.id : null,
          clienteId: ctx.clienteId,
          clienteSlug: ctx.clienteSlug,
          clienteContaId: ctx.clienteContaId,
        })
      );
    } catch {
      /* modo privado, cota — o contexto continua em memória */
    }
  }

  function removeSession() {
    try {
      storage && storage.removeItem(SESSION_KEY);
    } catch {
      /* ignora */
    }
  }

  function persist() {
    writeSession();
    writeUrl();
  }

  /* ── cardinalidade — a regra que hoje existe em três cópias ──────────
     fechamentos-api.js, bases.js, useFullAccountPicker.js. Aqui ela é
     escrita UMA vez (R8). */

  function applyCardinality(lista, contaPedida) {
    accounts = dedupeById(lista); // I6
    const disponiveis = activeOnly(accounts);

    // contaPedida !== null/undefined (não "truthy"): um `?conta=` com valor
    // não numérico vira NaN, que é falsy em JS — um `if (contaPedida)` aqui
    // trataria "pedido inválido" como "nenhum pedido" e cairia na
    // auto-resolução normal, escondendo o valor ruim em vez de rejeitá-lo.
    if (contaPedida !== null && contaPedida !== undefined) {
      const pedida = accounts.find((c) => String(c.id) === String(contaPedida)) || null;
      if (!pedida) {
        // I2 — não pertence a este cliente (ou id inexistente/não numérico)
        ctx.clienteContaId = null;
        persist();
        setState(STATES.INVALID_ACCOUNT, "invalid");
        return;
      }
      if (pedida.ativo === false) {
        // I3 — inativa nunca é escolhida
        ctx.clienteContaId = null;
        persist();
        setState(STATES.ACCOUNT_INACTIVE, "invalid");
        return;
      }
      commitAccount(pedida, "conta");
      return;
    }

    if (disponiveis.length === 0) {
      ctx.clienteContaId = null;
      persist();
      setState(STATES.NO_ACTIVE_ACCOUNT, "conta");
      return;
    }
    if (disponiveis.length === 1) {
      // I5 — uma conta ativa: única auto-seleção permitida em todo o sistema (D9)
      commitAccount(disponiveis[0], "conta");
      return;
    }
    // I5 — 2+ contas: NUNCA escolhe. É a regra que impede "ler a loja errada".
    ctx.clienteContaId = null;
    persist();
    setState(STATES.ACCOUNT_CHOICE_REQUIRED, "conta");
  }

  function commitAccount(conta, reason) {
    ctx.clienteContaId = conta.id;
    const st = statusOperacao(conta);
    integration.grant = conta.marketplace === "meli" ? st.code : null;
    integration.base = conta.base && conta.base.base_id ? "ok" : "ausente";
    lastError = null;
    persist();
    setState(STATES.READY, reason || "conta");
  }

  /* ── resolução ────────────────────────────────────────────────────── */

  function findInPortfolio(ref, kind) {
    // I4 — sem NENHUM fallback para portfolio[0]. Nenhum caminho deste
    // arquivo lê o índice zero de uma lista de clientes.
    return portfolio.find((c) => (kind === "id" ? String(c.id) === String(ref) : String(c.slug) === String(ref))) || null;
  }

  function resolveClient(ref, kind, contaPedida, reason) {
    const seq = ++clientSeq;
    setState(STATES.RESOLVING_CLIENT, reason || "cliente");

    const cliente = findInPortfolio(ref, kind || "slug");
    if (seq !== clientSeq) return; // I9

    if (!cliente) {
      ctx = emptyContext();
      accounts = [];
      lastError = { code: "CLIENTE_NAO_ENCONTRADO", ref: String(ref) };
      stripContextParamsFromUrl();
      removeSession();
      setState(STATES.INVALID_CLIENT, "invalid");
      return;
    }

    ctx.clienteId = cliente.id;
    ctx.clienteSlug = cliente.slug;
    ctx.clienteContaId = null; // I1 — trocar cliente SEMPRE zera conta
    integration = { grant: null, base: null };
    lastError = null;

    loadAccounts(contaPedida, seq);
  }

  function loadAccounts(contaPedida, clientSeqAtInvocation) {
    const seq = ++accountsSeq;
    if (accountsAbort && typeof accountsAbort.abort === "function") {
      try {
        accountsAbort.abort();
      } catch {
        /* ignora */
      }
    }
    const AbortImpl = typeof AbortController !== "undefined" ? AbortController : null;
    accountsAbort = AbortImpl ? new AbortImpl() : null;

    setState(STATES.RESOLVING_ACCOUNTS, "cliente");

    return api
      .contasDoCliente(ctx.clienteSlug, { signal: accountsAbort ? accountsAbort.signal : null })
      .then((resp) => {
        // I9 — dois guardas: sequência das contas E do cliente. Trocar de
        // cliente com a requisição de contas do anterior em voo não pode
        // reverter o contexto (§6.6, cenário a).
        if (seq !== accountsSeq) return;
        if (clientSeqAtInvocation !== undefined && clientSeqAtInvocation !== clientSeq) return;

        // DIVERGÊNCIA do rascunho: vf-api.js `scoped()` devolve `null`
        // (não lança) quando a resposta chega para um contexto que já
        // mudou (§6.6). Um `null` aqui é "descartado", não "falhou" — sem
        // este guard, uma resposta stale de scoped() acionaria
        // NO_ACTIVE_ACCOUNT/erro por engano.
        if (resp === null) return;

        if (!resp || resp.ok === false) {
          if (resp && resp.code === "CLIENTE_FORA_DA_CARTEIRA") {
            applyForbidden();
            return;
          }
          accounts = [];
          ctx.clienteContaId = null;
          lastError = { code: (resp && resp.code) || "ERRO", mensagem: resp && resp.erro };
          persist();
          setState(STATES.NO_ACTIVE_ACCOUNT, "conta");
          return;
        }
        applyCardinality(resp.contas || [], contaPedida);
      })
      .catch((err) => {
        if (err && err.name === "AbortError") return; // troca de contexto: silencioso
        if (seq !== accountsSeq) return;
        accounts = [];
        lastError = { code: "ERRO", mensagem: err && err.message };
        setState(STATES.NO_ACTIVE_ACCOUNT, "conta");
      });
  }

  function applyForbidden() {
    // §17: falha de AUTORIZAÇÃO descarta o contexto.
    ctx = emptyContext();
    accounts = [];
    integration = { grant: null, base: null };
    lastError = { code: "CLIENTE_FORA_DA_CARTEIRA" };
    removeSession();
    stripContextParamsFromUrl();
    setState(STATES.FORBIDDEN, "forbidden");
  }

  /* ── API pública ──────────────────────────────────────────────────── */

  function init(options = {}) {
    api = options.api;
    user = options.user || null;
    scope = options.scope || null;
    if (options.keepListeners === false) listeners = [];

    state = STATES.BOOT;
    ctx = emptyContext();
    accounts = [];
    portfolio = [];
    integration = { grant: null, base: null };
    lastError = null;
    emit("boot");

    // I8 — higiene de sessão ANTES de qualquer resolução. sessionStorage já
    // morre com a aba; o carimbo cobre a aba viva que troca de usuário (D13).
    let stored = readSession();
    if (stored && user && stored.userId !== user.id) {
      removeSession();
      stored = null;
    }

    return api
      .carteira()
      .then((resp) => {
        if (!resp || resp.ok === false) {
          // M12 — PORTFOLIO_ERROR != NO_PORTFOLIO: "não deu para carregar" e
          // "você não tem clientes" não compartilham tela.
          lastError = { code: (resp && resp.code) || "ERRO", mensagem: resp && resp.erro };
          setState(STATES.PORTFOLIO_ERROR, "boot");
          return;
        }
        portfolio = resp.clientes || [];

        if (!portfolio.length) {
          removeSession();
          setState(STATES.NO_PORTFOLIO, "boot");
          return;
        }

        // Precedência: URL > sessionStorage > vazio (§7.4). A URL vence de
        // propósito: um link colado numa conversa precisa abrir o que ele
        // diz que abre.
        const daUrl = readContextFromUrl();
        if (daUrl) {
          resolveClient(daUrl.clienteRef, daUrl.refKind, daUrl.clienteContaId, "boot");
          return;
        }
        if (stored && stored.clienteSlug) {
          resolveClient(stored.clienteSlug, "slug", stored.clienteContaId, "boot");
          return;
        }
        setState(STATES.NO_CLIENT, "boot");
      })
      .catch((err) => {
        lastError = { code: "ERRO", mensagem: err && err.message };
        setState(STATES.PORTFOLIO_ERROR, "boot");
      });
  }

  function setCliente(ref) {
    if (!ref) return;
    // Trocar de cliente reseta o período (§8.5): o mês de trabalho de outro
    // cliente não é o mesmo.
    setPeriodoParam(null);
    resolveClient(ref, "slug", null, "cliente");
  }

  function setConta(contaId) {
    const alvo = accounts.find((c) => String(c.id) === String(contaId)) || null;
    if (!alvo) {
      // I2
      setState(STATES.INVALID_ACCOUNT, "invalid");
      return false;
    }
    if (alvo.ativo === false) {
      // I3
      setState(STATES.ACCOUNT_INACTIVE, "invalid");
      return false;
    }
    // O sinal "conta" sai ANTES de READY para o módulo abortar o que era da
    // conta anterior e parar o polling (§6.6, cenário b).
    emit("conta");
    commitAccount(alvo, "conta");
    return true;
  }

  function clearConta() {
    ctx.clienteContaId = null;
    integration = { grant: null, base: null };
    persist();
    setState(activeOnly(accounts).length ? STATES.ACCOUNT_CHOICE_REQUIRED : STATES.NO_ACTIVE_ACCOUNT, "conta");
  }

  function clearOperationalContext() {
    const eraErroDeCarteira = state === STATES.PORTFOLIO_ERROR;
    ctx = emptyContext();
    accounts = [];
    integration = { grant: null, base: null };
    removeSession();
    stripContextParamsFromUrl();
    setPeriodoParam(null);

    // M12 — limpar o contexto NÃO conserta uma carteira que não carregou.
    // Sem este guard, um clearOperationalContext() no login sobrescreveria
    // PORTFOLIO_ERROR com NO_PORTFOLIO, e o usuário veria "você não tem
    // clientes" quando o certo é "não deu para carregar · tentar de novo".
    if (eraErroDeCarteira) {
      emit("clear");
      return;
    }

    lastError = null;
    setState(portfolio.length ? STATES.NO_CLIENT : STATES.NO_PORTFOLIO, "clear");
  }

  // A página entrega o erro TIPADO; o store decide o que fazer com o
  // contexto (§17): autorização descarta, integração preserva.
  function signalContextError(err) {
    const code = err && err.code;
    lastError = err || null;

    if (code === "CLIENTE_FORA_DA_CARTEIRA") {
      applyForbidden();
      return;
    }

    if (code === "CONTA_NAO_PERTENCE_AO_CLIENTE" || code === "MARKETPLACE_INCOMPATIVEL") {
      ctx.clienteContaId = null;
      persist();
      setState(STATES.INVALID_ACCOUNT, "invalid");
      return;
    }

    if (code === "CONTA_INATIVA") {
      ctx.clienteContaId = null;
      persist();
      setState(STATES.ACCOUNT_INACTIVE, "invalid");
      return;
    }

    if (code === "CONTA_AMBIGUA") {
      ctx.clienteContaId = null;
      persist();
      setState(STATES.ACCOUNT_CHOICE_REQUIRED, "conta");
      return;
    }

    // 424 — falha de INTEGRAÇÃO. O pedido era legítimo; a conta é que está
    // quebrada. O contexto PERMANECE: um grant caído não pode expulsar o
    // usuário de um Financeiro que lê dados já importados.
    if (code === "GRANT_DESCONECTADO") {
      integration.grant = "atencao";
      emit("integration");
      return;
    }
    if (code === "BASE_AUSENTE") {
      integration.base = "ausente";
      emit("integration");
      return;
    }
    if (code === "BASE_AMBIGUA") {
      integration.base = "ambigua";
      emit("integration");
      return;
    }

    emit("update");
  }

  function getAccountMeta() {
    if (!ctx.clienteContaId) return null;
    const conta = accounts.find((c) => c.id === ctx.clienteContaId) || null;
    if (!conta) return null;
    const st = statusOperacao(conta);
    // CACHE DE EXIBIÇÃO. Nunca decide nada (§6.1).
    return {
      id: conta.id,
      nome: conta.nome,
      marketplace: conta.marketplace,
      externalAccountLabel: rotuloExterno(conta),
      status: st,
      base: conta.base || null,
      ultimaSync: conta.ultimaSync || null,
    };
  }

  function getClienteAtual() {
    if (!ctx.clienteId) return null;
    return portfolio.find((c) => c.id === ctx.clienteId) || null;
  }

  function getAccounts() {
    // "deduplicadas, ativas primeiro" (§6.5) — partição estável: dentro de
    // cada grupo a ordem original (a da resposta do backend) é preservada.
    return accounts.slice().sort((a, b) => (b.ativo !== false ? 1 : 0) - (a.ativo !== false ? 1 : 0));
  }

  return {
    STATES,

    init,
    getState: () => state,
    getContext: () =>
      ctx.clienteId ? { clienteId: ctx.clienteId, clienteSlug: ctx.clienteSlug, clienteContaId: ctx.clienteContaId } : null,
    getAccountMeta,
    getIntegration: () => ({ grant: integration.grant, base: integration.base }),
    getError: () => lastError,
    isComplete: () => state === STATES.READY,
    getPortfolio: () => portfolio.slice(),
    getClienteAtual,
    getAccounts,
    getSnapshot: () => snapshot("read"),

    setCliente,
    setConta,
    clearConta,
    clearOperationalContext,
    signalContextError,

    getPeriodoParam,
    setPeriodoParam,

    subscribe,
  };
}

function safeSessionStorage() {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null;
  } catch {
    return null;
  }
}

export const vfContext =
  typeof window !== "undefined"
    ? createVfContext({
        storage: safeSessionStorage(),
        url: window.location,
        history: window.history,
        document: typeof document !== "undefined" ? document : null,
      })
    : createVfContext({});

if (typeof window !== "undefined") {
  window.VF = window.VF || {};
  window.VF.context = vfContext;
}
