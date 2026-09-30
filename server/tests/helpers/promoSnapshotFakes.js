// server/tests/helpers/promoSnapshotFakes.js
// Fakes do Promo Snapshot: repositório em memória que ESPELHA a semântica do
// SQL de promoSnapshotRepository (guardas de status, índice único de run
// ativo, fencing por run `running`, promoção do ponteiro na conclusão, poda),
// e um Mercado Livre falso que registra CADA chamada (método, caminho, token
// da conta) e responde por seller — token de outra conta recebe 403, como no
// ML real. O SQL real é validado à parte em scripts/promoSnapshotSqlCheck.js.

const real = require("../../services/promoSnapshot/promoSnapshotRepository");
const { MlTimeoutError } = require("../../utils/mlClient");

class Relogio {
  constructor(inicio = Date.parse("2026-10-01T12:00:00Z")) { this.t = inicio; }
  agora() { return this.t; }
  iso() { return new Date(this.t).toISOString(); }
  avancar(minutos) { this.t += minutos * 60000; }
}

function criarRepoFake({ relogio = new Relogio(), marginSnaps = new Map(), contasCliente = [], grants = [] } = {}) {
  const st = { runs: [], itens: [], lotes: [], contas: new Map(), seq: 0, itemSeq: 0 };
  const chamadas = [];
  const iso = () => relogio.iso();
  const ms = (v) => (v ? Date.parse(v) : NaN);
  const reg = (nome) => chamadas.push(nome);

  function run(id) { return st.runs.find((r) => r.id === Number(id)) || null; }
  function running(id) { const r = run(id); return r && r.status === "running" ? r : null; }
  function tentativa(r, status, code) {
    const c = st.contas.get(r.cliente_conta_id) || { cliente_conta_id: r.cliente_conta_id, cliente_id: r.cliente_id, marketplace: r.marketplace, seller_id: r.seller_id };
    Object.assign(c, { last_attempt_run_id: r.id, last_attempt_status: status, last_attempt_at: iso(), last_error_code: code || null, updated_at: iso() });
    st.contas.set(r.cliente_conta_id, c);
  }

  const repo = {
    ...real,
    _st: st,
    _chamadas: chamadas,
    async ensureTables() {},

    async createRun({ clienteId, clienteSlug = null, clienteContaId, marketplace = "meli", sellerId, reason, requestedBy = null, resumedFromRunId = null }) {
      reg("createRun");
      if (!clienteContaId || !sellerId) throw new Error("createRun: conta e seller obrigatórios");
      if (repo._forcarCorrida) {
        // Simula a outra instância criando o run ativo entre o SELECT e o INSERT.
        const f = repo._forcarCorrida; repo._forcarCorrida = null; await f();
      }
      if (st.runs.some((r) => r.cliente_conta_id === clienteContaId && r.marketplace === marketplace && r.tipo === real.TIPO && ["queued", "running"].includes(r.status))) {
        const e = new Error("duplicate key uq_promo_snapshot_runs_ativo"); e.code = "23505"; throw e;
      }
      const r = {
        id: ++st.seq, cliente_id: clienteId, cliente_slug: clienteSlug, cliente_conta_id: clienteContaId, marketplace,
        seller_id: String(sellerId), tipo: real.TIPO, reason, status: "queued", requested_by: requestedBy,
        resumed_from_run_id: resumedFromRunId, created_at: iso(), started_at: null, heartbeat_at: null, finished_at: null,
        itens_total: null, itens_processados: 0, itens_com_promocao: 0, promocoes_encontradas: 0, erros: 0, rate_limits: 0,
        retries: 0, promovido: false, snapshot_at: null, fresh_until: null, error_code: null, error_message: null,
        metadata_json: {}, updated_at: iso(),
      };
      st.runs.push(r);
      return real.sanitizeRun(r);
    },

    async findActiveRun({ clienteContaId, marketplace = "meli" }) {
      reg("findActiveRun");
      if (repo._esconderAtivoUmaVez) { repo._esconderAtivoUmaVez = false; return null; }
      const r = [...st.runs].reverse().find((x) => x.cliente_conta_id === clienteContaId && x.marketplace === marketplace && ["queued", "running"].includes(x.status));
      return real.sanitizeRun(r);
    },

    async getRunById({ runId, clienteContaId }) {
      const r = run(runId);
      return r && r.cliente_conta_id === clienteContaId ? real.sanitizeRun(r) : null;
    },

    async findLatestFinishedRun({ clienteContaId }) {
      const r = st.runs.filter((x) => x.cliente_conta_id === clienteContaId && ["completed", "partial", "failed"].includes(x.status))
        .sort((a, b) => ms(b.finished_at) - ms(a.finished_at) || b.id - a.id)[0];
      return real.sanitizeRun(r);
    },

    async findResumableRun({ clienteContaId, sellerId, resumeMaxMinutes }) {
      if (!(resumeMaxMinutes > 0)) return null;
      const c = st.contas.get(clienteContaId);
      const r = st.runs.filter((x) => x.cliente_conta_id === clienteContaId && x.seller_id === String(sellerId) && x.status === "failed" &&
        real.ERROS_RETOMAVEIS.includes(x.error_code) && x.started_at && ms(x.finished_at) > relogio.agora() - resumeMaxMinutes * 60000 &&
        st.lotes.some((l) => l.run_id === x.id) && !(c && c.snapshot_at && ms(c.snapshot_at) >= ms(x.started_at)))
        .sort((a, b) => ms(b.finished_at) - ms(a.finished_at) || b.id - a.id)[0];
      return real.sanitizeRun(r);
    },

    async claimNextQueuedRun({ excludeContaIds = [] } = {}) {
      reg("claimNextQueuedRun");
      const r = st.runs.filter((x) => x.status === "queued" && !excludeContaIds.map(Number).includes(x.cliente_conta_id))
        .sort((a, b) => ms(a.created_at) - ms(b.created_at) || a.id - b.id)[0];
      if (!r) return null;
      Object.assign(r, { status: "running", started_at: iso(), heartbeat_at: iso(), updated_at: iso() });
      return real.sanitizeRun(r);
    },

    async touchHeartbeat(runId) {
      const r = running(runId);
      if (!r) return null;
      r.heartbeat_at = iso();
      return real.sanitizeRun(r);
    },

    async registrarTotal({ runId, itensTotal }) {
      const r = running(runId);
      if (!r) return null;
      Object.assign(r, { itens_total: itensTotal, heartbeat_at: iso() });
      return real.sanitizeRun(r);
    },

    async registrarLote({ run: rr, seq, itemIds, itensFalhos = [], linhas = [], contadores = {} }) {
      reg("registrarLote");
      real.assertNoSecrets(contadores, "contadores");
      const r = running(rr.id);
      if (!r) return null;
      for (const l of linhas) {
        if (st.itens.some((i) => i.run_id === r.id && i.item_id === l.itemId && i.promocao_chave === l.promocaoChave)) continue;
        st.itens.push(linhaParaRow(r, l, ++st.itemSeq));
      }
      if (!st.lotes.some((l) => l.run_id === r.id && l.seq === seq)) {
        st.lotes.push({ run_id: r.id, seq, item_ids: [...itemIds], itens_falhos: [...itensFalhos], promocoes: linhas.length });
      }
      r.itens_processados += itemIds.length;
      r.itens_com_promocao += new Set(linhas.map((l) => l.itemId)).size;
      r.promocoes_encontradas += linhas.length;
      r.erros += itensFalhos.length;
      r.rate_limits += Number(contadores.rateLimits || 0);
      r.retries += Number(contadores.retries || 0);
      r.heartbeat_at = iso();
      return real.sanitizeRun(r);
    },

    async copiarLotesRetomados({ run: rr, fromRunId, catalogItemIds }) {
      const r = running(rr.id);
      if (!r) return null;
      const o = run(fromRunId);
      if (!o || o.cliente_conta_id !== r.cliente_conta_id || o.seller_id !== r.seller_id) return { itens: [], promocoes: 0, startedAt: null };
      const cat = new Set(catalogItemIds);
      const feitos = new Set();
      for (const l of st.lotes.filter((x) => x.run_id === o.id)) {
        const falhos = new Set(l.itens_falhos);
        for (const id of l.item_ids) if (!falhos.has(id) && cat.has(id)) feitos.add(id);
      }
      const itens = [...feitos];
      if (!itens.length) return { itens: [], promocoes: 0, startedAt: null };
      const copiadas = st.itens.filter((i) => i.run_id === o.id && feitos.has(i.item_id))
        .map((i) => ({ ...i, id: ++st.itemSeq, run_id: r.id, origem_run_id: i.origem_run_id ?? i.run_id }));
      st.itens.push(...copiadas);
      st.lotes.push({ run_id: r.id, seq: 0, item_ids: itens, itens_falhos: [], promocoes: copiadas.length });
      r.itens_processados += itens.length;
      r.itens_com_promocao += new Set(copiadas.map((x) => x.item_id)).size;
      r.promocoes_encontradas += copiadas.length;
      r.heartbeat_at = iso();
      return { itens, promocoes: copiadas.length, startedAt: o.started_at };
    },

    async finalizarRun({ runId, status, promover, snapshotAt = null, freshMinutes, metadata = {}, errorCode = null, errorMessage = null }) {
      reg("finalizarRun");
      real.assertNoSecrets(metadata);
      const r = running(runId);
      if (!r) return null;
      const snap = snapshotAt || r.started_at;
      Object.assign(r, {
        status, finished_at: iso(), promovido: promover === true, snapshot_at: snap,
        fresh_until: new Date(ms(snap) + freshMinutes * 60000).toISOString(),
        metadata_json: { ...r.metadata_json, ...metadata }, error_code: errorCode, error_message: errorMessage, updated_at: iso(),
      });
      if (promover) {
        const c = st.contas.get(r.cliente_conta_id);
        if (!c || !c.snapshot_at || ms(c.snapshot_at) <= ms(r.snapshot_at)) {
          const anterior = c ? c.current_run_id : null;
          st.contas.set(r.cliente_conta_id, {
            ...(c || {}), cliente_conta_id: r.cliente_conta_id, cliente_id: r.cliente_id, marketplace: r.marketplace, seller_id: r.seller_id,
            current_run_id: r.id, previous_run_id: anterior !== r.id ? anterior : c.previous_run_id,
            snapshot_at: r.snapshot_at, fresh_until: r.fresh_until, parcial: status === "partial", itens_total: r.itens_total,
            itens_com_promocao: r.itens_com_promocao, promocoes_total: r.promocoes_encontradas, itens_sem_leitura: r.erros,
            last_attempt_run_id: r.id, last_attempt_status: status, last_attempt_at: iso(), last_success_at: iso(),
            last_error_code: null, updated_at: iso(),
          });
          const atual = st.contas.get(r.cliente_conta_id);
          const ativos = new Set(st.runs.filter((x) => x.cliente_conta_id === r.cliente_conta_id && ["queued", "running"].includes(x.status)).map((x) => x.id));
          st.itens = st.itens.filter((i) => i.cliente_conta_id !== r.cliente_conta_id ||
            i.run_id === atual.current_run_id || i.run_id === atual.previous_run_id || ativos.has(i.run_id));
        }
      } else {
        tentativa(r, status, errorCode || "PROMO_SNAPSHOT_PARCIAL_NAO_PROMOVIDO");
      }
      return real.sanitizeRun(r);
    },

    async marcarFalhou({ runId, code = null, message = null }) {
      reg("marcarFalhou");
      const r = running(runId);
      if (!r) return null;
      Object.assign(r, { status: "failed", finished_at: iso(), promovido: false, error_code: code, error_message: message, updated_at: iso() });
      tentativa(r, "failed", code);
      return real.sanitizeRun(r);
    },

    async mergeRunMetadata({ runId, patch }) {
      real.assertNoSecrets(patch);
      const r = running(runId);
      if (!r) return null;
      r.metadata_json = { ...r.metadata_json, ...patch };
      return real.sanitizeRun(r);
    },

    async reconcileStaleRunningRuns({ staleMinutes, clienteContaId = null }) {
      reg("reconcileStaleRunningRuns");
      const limite = relogio.agora() - staleMinutes * 60000;
      const mortos = st.runs.filter((r) => r.status === "running" && ms(r.heartbeat_at || r.started_at || r.created_at) < limite &&
        (clienteContaId == null || r.cliente_conta_id === Number(clienteContaId)));
      for (const r of mortos) {
        Object.assign(r, { status: "failed", finished_at: iso(), promovido: false, error_code: real.ERRO_STALE, error_message: "stale", updated_at: iso() });
        tentativa(r, "failed", real.ERRO_STALE);
      }
      return mortos.map(real.sanitizeRun);
    },

    async obterConta({ clienteContaId }) {
      reg("obterConta");
      return real.sanitizeConta(st.contas.get(Number(clienteContaId)));
    },

    async listarLinhasSnapshot({ clienteContaId, runId, page, limit, itemId = null, status = null, tipo = null }) {
      reg("listarLinhasSnapshot");
      const todas = st.itens.filter((i) => i.run_id === runId && i.cliente_conta_id === clienteContaId &&
        (itemId == null || i.item_id === itemId) && (status == null || i.status === status) && (tipo == null || i.promotion_type === tipo))
        .sort((a, b) => (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : a.promocao_chave < b.promocao_chave ? -1 : 1));
      return { total: todas.length, linhas: todas.slice((page - 1) * limit, page * limit).map(real.linhaPublica) };
    },

    async listarBaseOportunidades({ clienteContaId, runId }) {
      reg("listarBaseOportunidades");
      return st.itens.filter((i) => i.run_id === runId && i.cliente_conta_id === clienteContaId && Number(i.preco_final) > 0 &&
        ["candidate", "started", "active", "pending"].includes(i.status))
        .map((i) => {
          const s = marginSnaps.get(`${clienteContaId}:${i.item_id}`);
          return s ? { ...i, ...s } : null;
        }).filter(Boolean);
    },

    async listarContasElegiveis({ limit, failedRetryMinutes }) {
      reg("listarContasElegiveis");
      const agora = relogio.agora();
      return contasCliente.filter((c) => c.marketplace === "meli" && c.ativo !== false && c.cliente_ativo !== false && c.external_account_id)
        .filter((c) => grants.some((g) => g.cliente_id === c.cliente_id && String(g.ml_user_id) === String(c.external_account_id) &&
          g.access_token && g.refresh_token && !["revoked", "blocked", "invalid"].includes(String(g.token_status || "valid").toLowerCase())))
        .filter((c) => !st.runs.some((r) => r.cliente_conta_id === c.id && ["queued", "running"].includes(r.status)))
        .filter((c) => { const s = st.contas.get(c.id); return !s || !s.fresh_until || ms(s.fresh_until) < agora; })
        .filter((c) => { const s = st.contas.get(c.id); return !(s && ["failed", "partial"].includes(s.last_attempt_status) && ms(s.last_attempt_at) > agora - failedRetryMinutes * 60000); })
        .slice(0, limit)
        .map((c) => ({ clienteContaId: c.id, clienteId: c.cliente_id, clienteSlug: c.cliente_slug, sellerId: String(c.external_account_id) }));
    },
  };
  return repo;
}

function linhaParaRow(r, l, id) {
  return {
    id, run_id: r.id, cliente_id: r.cliente_id, cliente_conta_id: r.cliente_conta_id, marketplace: r.marketplace, seller_id: r.seller_id,
    item_id: l.itemId, promocao_chave: l.promocaoChave, promotion_id: l.promotionId ?? null, ref_id: l.refId ?? null,
    promotion_type: l.promotionType ?? null, tipo_conhecido: l.tipoConhecido === true, nome: l.nome ?? null, status: l.status ?? null,
    status_exibicao: l.statusExibicao ?? null, data_inicio: l.dataInicio ?? null, data_fim: l.dataFim ?? null,
    preco_original: l.precoOriginal ?? null, preco_final: l.precoFinal ?? null, preco_final_fonte: l.precoFinalFonte ?? null,
    desconto_valor: l.descontoValor ?? null, desconto_percentual: l.descontoPercentual ?? null,
    seller_percentage: l.sellerPercentage ?? null, meli_percentage: l.meliPercentage ?? null, subsidio_ml: l.subsidioMl ?? null,
    elegivel: l.elegivel === true, ativa: typeof l.ativa === "boolean" ? l.ativa : null, programada: l.programada === true,
    nao_aplicada: typeof l.naoAplicada === "boolean" ? l.naoAplicada : null, observed_at: l.observedAt, origem_run_id: l.origemRunId ?? null,
  };
}

// ─── Mercado Livre falso ─────────────────────────────────────────────────────
// sellers: { [sellerId]: { itens: { [MLB]: [promo cruas] }, saleInfo: { [MLB]: {promotionId, amount} } } }
// roteiro: (path, opcoes, n) => resposta | undefined  — injeta 429/500/timeout.
function criarMlFake({ sellers = {}, roteiro = null, pagina = 100 } = {}) {
  const chamadas = [];
  const contagem = new Map();
  const donoDoItem = (itemId) => Object.keys(sellers).find((s) => sellers[s].itens && itemId in sellers[s].itens) || null;

  async function mlFetch(clienteId, path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    chamadas.push({ clienteId, path, method, mlUserId: options.mlUserId ?? null, body: options.body ?? null, timeoutMs: options.timeoutMs ?? null });
    const n = (contagem.get(path) || 0) + 1;
    contagem.set(path, n);
    if (roteiro) {
      const r = await roteiro(path, options, n);
      if (r instanceof Error) throw r;
      if (r) return r;
    }
    if (method !== "GET") return { ok: false, status: 405, data: null };

    let m = path.match(/^\/users\/([^/]+)\/items\/search\?(.*)$/);
    if (m) {
      const seller = decodeURIComponent(m[1]);
      if (String(options.mlUserId) !== seller) return { ok: false, status: 403, data: { message: "Searching another user items is restricted." } };
      const q = new URLSearchParams(m[2]);
      const ids = Object.keys((sellers[seller] || {}).itens || {});
      const inicio = q.get("scroll_id") ? Number(q.get("scroll_id").replace("scroll-", "")) : 0;
      const results = ids.slice(inicio, inicio + pagina);
      const prox = inicio + pagina;
      return { ok: true, status: 200, data: { results, paging: { total: ids.length }, scroll_id: results.length ? `scroll-${prox}` : null } };
    }
    m = path.match(/^\/seller-promotions\/items\/([^/?]+)\?app_version=v2$/);
    if (m) {
      const item = decodeURIComponent(m[1]);
      const dono = donoDoItem(item);
      if (!dono) return { ok: false, status: 404, data: null };
      if (String(options.mlUserId) !== dono) return { ok: false, status: 403, data: { message: "forbidden" } };
      return { ok: true, status: 200, data: sellers[dono].itens[item] };
    }
    m = path.match(/^\/items\/([^/?]+)\/sale_price\?/);
    if (m) {
      const item = decodeURIComponent(m[1]);
      const dono = donoDoItem(item);
      if (!dono || String(options.mlUserId) !== dono) return { ok: false, status: 403, data: null };
      const s = (sellers[dono].saleInfo || {})[item];
      return s ? { ok: true, status: 200, data: { amount: s.amount, metadata: { promotion_id: s.promotionId } } } : { ok: false, status: 404, data: null };
    }
    m = path.match(/^\/seller-promotions\/promotions\/([^/?]+)\?/);
    if (m) return { ok: true, status: 200, data: { start_date: "2026-10-01T00:00:00Z", finish_date: "2026-10-31T23:59:59Z" } };
    return { ok: false, status: 404, data: null };
  }

  return {
    mlFetch,
    chamadas,
    escritas: () => chamadas.filter((c) => c.method !== "GET" || c.body != null),
    contar: (re) => chamadas.filter((c) => re.test(c.path)).length,
  };
}

function erro429(retryAfter = 2) { return { ok: false, status: 429, data: { message: "too many" }, retryAfter }; }
function erro500() { return { ok: false, status: 500, data: { message: "boom" } }; }
function erroTimeout(path) { return new MlTimeoutError("ML_TIMEOUT", "timeout", { enviado: true, path }); }

function promo(o = {}) {
  return {
    id: o.id || "P-MLB1", type: o.type || "DEAL", status: o.status || "candidate", name: o.name || "Campanha",
    original_price: o.original_price ?? 100, price: o.price, suggested_discounted_price: o.suggested,
    meli_percentage: o.meli, seller_percentage: o.seller, start_date: o.start, finish_date: o.finish, ref_id: o.ref_id,
  };
}

function loggerMemoria() {
  const eventos = [];
  const registrar = (nivel) => (msg) => {
    try { const j = JSON.parse(msg); eventos.push({ nivel, ...j }); } catch (_) { eventos.push({ nivel, texto: String(msg) }); }
  };
  return { eventos, log: registrar("log"), warn: registrar("warn"), error: registrar("error") };
}

module.exports = { Relogio, criarRepoFake, criarMlFake, erro429, erro500, erroTimeout, promo, loggerMemoria };
