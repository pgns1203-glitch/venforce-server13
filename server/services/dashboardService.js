const defaultPool = require("../config/database");
const { ensureCliente360Tables } = require("./cliente360/cliente360Repository");

const PERIODS = Object.freeze({ "7d": 7, "30d": 30, "90d": 90 });
const READINESS_WEIGHTS = Object.freeze({
  client: 12,
  channel: 10,
  base: 18,
  grant: 18,
  diagnosis: 14,
  closing: 8,
  ads: 10,
  freight: 10,
});

function asFiniteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function normalizeMarketplace(value) {
  const text = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!text) return null;
  if (text === "meli" || text === "ml" || text.includes("mercado_livre") || text.includes("mercadolivre")) return "meli";
  if (text.includes("shopee")) return "shopee";
  if (text.includes("tiktok")) return "tiktok";
  return null;
}

function parseClientSlugs(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(values.map((slug) => String(slug || "").trim()).filter(Boolean))].slice(0, 200);
}

function selectAuthorizedClients(authorized, requested) {
  const clients = Array.isArray(authorized) ? authorized : [];
  const slugs = parseClientSlugs(requested);
  if (!slugs.length) return [...clients];
  const requestedSet = new Set(slugs);
  return clients.filter((client) => requestedSet.has(String(client.slug)));
}

function readinessItem(key, label, done, points, severityWhenPending) {
  return {
    key,
    label,
    done: Boolean(done),
    points,
    severity: done ? "success" : severityWhenPending,
  };
}

function buildReadinessSnapshot(row = {}) {
  if (row.readiness_available === false) {
    return {
      score: null,
      status: "unavailable",
      status_label: "Indisponível",
      marketplace: "unknown",
      pending: 0,
      earned_points: null,
      available_points: null,
      missing_points: null,
      note: "A fonte de prontidão não respondeu.",
      items: [],
      can_copy_ml_link: false,
    };
  }
  const marketplaces = [...new Set((Array.isArray(row.marketplaces) ? row.marketplaces : [row.marketplace])
    .map(normalizeMarketplace)
    .filter(Boolean))];
  const hasMl = marketplaces.includes("meli");
  const knownChannel = marketplaces.length > 0;
  const grantConnected = hasMl && typeof row.ml_grant_connected === "boolean"
    ? row.ml_grant_connected
    : null;

  const items = [
    readinessItem("client", "Cliente cadastrado", Boolean(row.id || row.slug), READINESS_WEIGHTS.client, "danger"),
    readinessItem("channel", "Canal principal definido", knownChannel, READINESS_WEIGHTS.channel, "danger"),
    readinessItem("base", "Base vinculada", row.has_base === true, READINESS_WEIGHTS.base, "danger"),
  ];
  if (hasMl) {
    items.push(readinessItem("grant", "Grant ML conectado", grantConnected === true, READINESS_WEIGHTS.grant, "danger"));
  }
  items.push(
    readinessItem("diagnosis", "Primeiro diagnóstico", row.has_diagnosis === true, READINESS_WEIGHTS.diagnosis, "danger"),
    readinessItem("closing", "Primeiro fechamento", row.has_closing === true, READINESS_WEIGHTS.closing, "warning"),
    readinessItem("ads", "Ads/acompanhamento", row.has_ads === true, READINESS_WEIGHTS.ads, "warning"),
    readinessItem("freight", "Frete histórico", row.has_freight === true, READINESS_WEIGHTS.freight, "warning"),
  );

  const availablePoints = items.reduce((sum, item) => sum + item.points, 0);
  const earnedPoints = items.reduce((sum, item) => sum + (item.done ? item.points : 0), 0);
  const score = availablePoints ? Math.round((earnedPoints / availablePoints) * 100) : null;
  const pending = items.filter((item) => !item.done).length;
  const status = score == null ? "unavailable" : score < 60 ? "critical" : score < 90 ? "attention" : "healthy";
  const statusLabel = ({ critical: "Setup incompleto", attention: "Quase pronto", healthy: "Pronto", unavailable: "Indisponível" })[status];
  const missingPoints = score == null ? null : Math.max(availablePoints - earnedPoints, 0);

  return {
    score,
    status,
    status_label: statusLabel,
    marketplace: marketplaces.length === 1 ? marketplaces[0] : marketplaces.length > 1 ? "multi" : "unknown",
    pending,
    earned_points: earnedPoints,
    available_points: availablePoints,
    missing_points: missingPoints,
    note: hasMl
      ? "Pesos da Prontidão Operacional do Cliente Operação."
      : knownChannel
        ? `Pesos renormalizados por canal — ${marketplaces[0] === "shopee" ? "Shopee" : "este canal"} não exige grant ML.`
        : "Canal sem evidência; o requisito de grant ML não foi presumido.",
    items,
    can_copy_ml_link: hasMl && grantConnected === false,
  };
}

function statusFromReadiness(readiness) {
  if (!readiness || readiness.score == null) return { key: "unknown", label: "Indisponível" };
  if (readiness.score < 60) return { key: "critical", label: "Crítico" };
  if (readiness.score < 90) return { key: "attention", label: "Atenção" };
  return { key: "healthy", label: "Saudável" };
}

function metric(value, { source, coverage = null, reason = null } = {}) {
  return { value, source, coverage, reason };
}

function aggregateRows(rows) {
  const clients = (Array.isArray(rows) ? rows : []).map((row) => {
    const readiness = buildReadinessSnapshot(row);
    const status = statusFromReadiness(readiness);
    return {
      slug: row.slug,
      nome: row.nome,
      marketplaces: [...new Set((row.marketplaces || []).map(normalizeMarketplace).filter(Boolean))],
      revenue: asFiniteOrNull(row.revenue),
      margin: asFiniteOrNull(row.margin),
      pending: readiness.pending,
      status,
      has_ml: readiness.marketplace === "meli" || readiness.marketplace === "multi" && readiness.items.some((item) => item.key === "grant"),
      ml_grant_connected: typeof row.ml_grant_connected === "boolean" ? row.ml_grant_connected : null,
      readiness,
    };
  });

  const revenueKnown = clients.filter((client) => client.revenue !== null);
  const revenue = revenueKnown.length ? round(revenueKnown.reduce((sum, client) => sum + client.revenue, 0), 2) : null;
  const weightedMarginRows = clients.filter((client) => client.margin !== null && client.revenue !== null && client.revenue > 0);
  const marginRevenue = weightedMarginRows.reduce((sum, client) => sum + client.revenue, 0);
  const margin = marginRevenue > 0
    ? round(weightedMarginRows.reduce((sum, client) => sum + client.margin * client.revenue, 0) / marginRevenue, 6)
    : null;
  const critical = clients.filter((client) => client.status.key === "critical").length;
  const attention = clients.filter((client) => client.status.key === "attention").length;
  const pending = clients.reduce((sum, client) => sum + client.pending, 0);

  const severityOrder = { danger: 0, warning: 1, info: 2 };
  const priorities = clients.flatMap((client) => {
    const item = client.readiness.items
      .filter((candidate) => !candidate.done)
      .sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) || b.points - a.points)[0];
    if (!item) return [];
    return [{
      slug: client.slug,
      client_name: client.nome,
      problem: item.label,
      severity: item.severity,
      pending: client.pending,
      href: `cliente-operacao.html?cliente=${encodeURIComponent(client.slug)}`,
    }];
  }).sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) || b.pending - a.pending).slice(0, 5);

  const portfolioClients = [...clients]
    .sort((a, b) => {
      const statusOrder = { critical: 0, attention: 1, healthy: 2, unknown: 3 };
      return (statusOrder[a.status.key] ?? 9) - (statusOrder[b.status.key] ?? 9)
        || (a.readiness.score ?? 101) - (b.readiness.score ?? 101)
        || String(a.nome).localeCompare(String(b.nome), "pt-BR");
    })
    .slice(0, 6);

  return {
    clients,
    metrics: {
      revenue: metric(revenue, { source: "cliente_360_resumos_mensais.payload_json.porDia", coverage: clients.length ? revenueKnown.length / clients.length : 0 }),
      margin: metric(margin, { source: "relatorios.mc_media ponderada por faturamento", coverage: clients.length ? weightedMarginRows.length / clients.length : 0, reason: margin === null ? "Evidência comparável insuficiente" : null }),
      attention_clients: { value: critical + attention, critical, attention, source: "readiness" },
      pending_actions: { value: pending, source: "readiness.items" },
    },
    priorities,
    operational_health: {
      selected_clients: clients.length,
      data_coverage: clients.length ? revenueKnown.length / clients.length : 0,
      bases_attention: rows.filter((row) => row.readiness_available !== false && row.has_base !== true).length,
      critical_margin: clients.filter((client) => client.margin !== null && client.margin < 0).length,
    },
    portfolio: { clients: portfolioClients },
  };
}

// Carteira autorizada. Delega para a fonte ÚNICA de autorização
// (services/squads/authorizationService). Mantém a assinatura histórica
// `(pool, user)` — o pool passado é honrado como `db`.
//
//   admin   → todos os clientes ativos
//   seller  → seller_clientes (inalterado)
//   interno → clientes dos Squads ativos do usuário
//   interno sem membership → [] (pendência de migração; nunca "todos")
async function resolveEffectivePortfolio(pool, user = {}) {
  const { resolvePortfolioClientes } = require("./squads/authorizationService");
  return resolvePortfolioClientes(user, pool) || [];
}

async function loadProductionData(pool, { clients, fromDate, toDate }) {
  if (!clients.length) return { rows: [], sources: [] };
  await ensureCliente360Tables().catch(() => null);
  const ids = clients.map((client) => client.id);
  const baseRows = clients.map((client) => ({ ...client, readiness_available: false }));

  const sources = [
    {
      key: "financial",
      run: () => pool.query(`/* dashboard:FINANCIAL */
        SELECT c.id,
               revenue.faturamento,
               margin.mc_media
          FROM clientes c
          LEFT JOIN LATERAL (
            SELECT SUM(NULLIF(day->>'vendasBrutas', '')::numeric) AS faturamento
              FROM cliente_360_resumos_mensais s
              CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(s.payload_json->'porDia') = 'array'
                     THEN s.payload_json->'porDia' ELSE '[]'::jsonb END
              ) day
             WHERE s.cliente_id = c.id
               AND (day->>'data') ~ '^\\d{4}-\\d{2}-\\d{2}$'
               AND (day->>'data')::date BETWEEN $2::date AND $3::date
          ) revenue ON true
          LEFT JOIN LATERAL (
            SELECT r.mc_media
              FROM relatorios r
             WHERE r.cliente_id = c.id OR r.cliente_slug = c.slug
             ORDER BY r.created_at DESC
             LIMIT 1
          ) margin ON true
         WHERE c.id = ANY($1::int[])`, [ids, fromDate, toDate]),
    },
    {
      key: "readiness",
      run: () => pool.query(`/* dashboard:READINESS */
        SELECT c.id,
               CASE
                 WHEN COALESCE(grant.has_any, false)
                      AND NOT ('meli' = ANY(COALESCE(ch.marketplaces, ARRAY[]::text[])))
                   THEN ARRAY_APPEND(COALESCE(ch.marketplaces, ARRAY[]::text[]), 'meli')
                 ELSE COALESCE(ch.marketplaces, ARRAY[]::text[])
               END AS marketplaces,
               COALESCE(ch.has_base, false) AS has_base,
               CASE
                 WHEN COALESCE(ch.has_ml, false) AND NOT COALESCE(grant.has_any, false) THEN false
                 WHEN COALESCE(grant.has_any, false) AND COALESCE(grant.connected, false) THEN true
                 ELSE NULL
               END AS ml_grant_connected,
               COALESCE(diag.has_diagnosis, false) AS has_diagnosis,
               COALESCE(closing.has_closing, false) AS has_closing,
               COALESCE(extra.has_ads, false) AS has_ads,
               COALESCE(extra.has_freight, false) AS has_freight
          FROM clientes c
          LEFT JOIN LATERAL (
            SELECT ARRAY_REMOVE(ARRAY_AGG(DISTINCT LOWER(COALESCE(NULLIF(v.marketplace, ''), NULLIF(to_jsonb(b)->>'marketplace', '')))), NULL) AS marketplaces,
                   COUNT(*) > 0 AS has_base,
                   BOOL_OR(LOWER(COALESCE(v.marketplace, to_jsonb(b)->>'marketplace', '')) IN ('meli','mercadolivre','mercado_livre','mercado livre')) AS has_ml
              FROM base_cliente_vinculos v
              JOIN bases b ON b.id = v.base_id AND b.ativo = true
             WHERE v.cliente_id = c.id AND v.ativo = true
          ) ch ON true
          LEFT JOIN LATERAL (
            SELECT COUNT(*) > 0 AS has_any,
                   BOOL_OR(
              LOWER(COALESCE(NULLIF(to_jsonb(t)->>'token_status', ''), 'valid')) NOT IN ('error','invalid','expired','revoked')
              AND (t.expires_at IS NULL OR t.expires_at > NOW())
            ) AS connected
              FROM ml_tokens t
             WHERE t.cliente_id = c.id
          ) grant ON true
          LEFT JOIN LATERAL (
            SELECT true AS has_diagnosis
              FROM relatorios r
             WHERE r.cliente_id = c.id OR r.cliente_slug = c.slug
             LIMIT 1
          ) diag ON true
          LEFT JOIN LATERAL (
            SELECT true AS has_closing
              FROM entregas_cliente e
             WHERE (e.cliente_id = c.id OR e.cliente_slug = c.slug)
               AND e.tipo = 'fechamento_mensal'
             LIMIT 1
          ) closing ON true
          LEFT JOIN LATERAL (
            SELECT BOOL_OR(COALESCE(s.ads_investido, 0) > 0) AS has_ads,
                   BOOL_OR(NULLIF(s.frete_confianca, '') IS NOT NULL AND s.frete_confianca <> 'sem_amostra') AS has_freight
              FROM cliente_360_resumos_mensais s
             WHERE s.cliente_id = c.id
          ) extra ON true
         WHERE c.id = ANY($1::int[])`, [ids]),
    },
  ];

  const settled = await Promise.all(sources.map(async (source) => {
    try {
      const result = await source.run();
      return { key: source.key, status: "available", rows: result.rows || [] };
    } catch (error) {
      return { key: source.key, status: "unavailable", rows: [], reason: error?.message || "query_failed" };
    }
  }));

  const byId = new Map(baseRows.map((row) => [Number(row.id), row]));
  for (const source of settled) {
    for (const row of source.rows) {
      const target = byId.get(Number(row.id));
      if (!target) continue;
      if (source.key === "financial") {
        target.revenue = asFiniteOrNull(row.faturamento);
        target.margin = asFiniteOrNull(row.mc_media);
      } else Object.assign(target, row, { readiness_available: true });
    }
  }
  return {
    rows: [...byId.values()],
    sources: settled.map(({ key, status, reason }) => ({ key, status, reason: reason || null })),
  };
}

function createDashboardService(pool = defaultPool, options = {}) {
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const resolvePortfolio = options.resolvePortfolio || ((user) => resolveEffectivePortfolio(pool, user));
  const loadData = options.loadData || ((context) => loadProductionData(pool, context));

  async function getSummary({ user = {}, role, period = "30d", clientes } = {}) {
    const effectiveUser = { ...user, role: user.role || role };
    const periodKey = PERIODS[period] ? period : "30d";
    const asOf = now();
    const fromDate = new Date(asOf.getTime() - (PERIODS[periodKey] - 1) * 86400000);
    const authorized = await resolvePortfolio(effectiveUser);
    const requested = parseClientSlugs(clientes);
    const selected = selectAuthorizedClients(authorized, requested);
    const raw = await loadData({ clients: selected, fromDate, toDate: asOf, period: periodKey, user: effectiveUser });
    const data = Array.isArray(raw) ? { rows: raw, sources: [] } : raw;
    const aggregated = aggregateRows(data.rows || []);
    const availableSources = (data.sources || []).filter((source) => source.status === "available").length;
    const dataStatus = selected.length === 0
      ? "empty"
      : !(data.sources || []).length || availableSources === (data.sources || []).length
        ? "complete"
        : availableSources === 0 ? "unavailable" : "partial";

    return {
      ok: true,
      version: "dashboard-summary-v2",
      scope: {
        type: "my_work",
        label: "Meu trabalho",
        squad: null,
        role: effectiveUser.role || null,
        total_authorized: authorized.length,
        selected_count: selected.length,
        clients: authorized.map(({ id, slug, nome }) => ({ id, slug, nome })),
        selected_slugs: selected.map((client) => client.slug),
      },
      period: { key: periodKey, from: fromDate.toISOString(), to: asOf.toISOString() },
      as_of: asOf.toISOString(),
      data_status: dataStatus,
      completeness: (data.sources || []).length ? availableSources / data.sources.length : (selected.length ? 1 : 0),
      metrics: aggregated.metrics,
      priorities: aggregated.priorities,
      operational_health: aggregated.operational_health,
      portfolio: aggregated.portfolio,
      sources: data.sources || [],
    };
  }

  return { getSummary };
}

module.exports = {
  PERIODS,
  READINESS_WEIGHTS,
  aggregateRows,
  buildReadinessSnapshot,
  createDashboardService,
  normalizeMarketplace,
  parseClientSlugs,
  resolveEffectivePortfolio,
  selectAuthorizedClients,
};
