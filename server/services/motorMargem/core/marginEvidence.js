// server/services/motorMargem/core/marginEvidence.js
// Camada de EVIDÊNCIAS do Motor de Margem — módulo puro, sem I/O.
//
// O Motor nunca trabalha com `frete = 23.40`. Trabalha com uma VARIÁVEL que
// acumula observações:
//
//   freight
//     ├─ { source: MELI_API,   kind: PROJECTED, value: 23.40, observedAt: … }
//     └─ { source: MELI_ORDER, kind: REALIZED,  value: 18.70, observedAt: … }
//
// A partir daí é possível responder: qual valor foi usado, de onde veio, quando
// foi observado, e se as fontes concordam.
//
// ── UNIDADE CANÔNICA ────────────────────────────────────────────────────────
// TODA evidência monetária é POR UNIDADE VENDIDA. O adapter que traz um total
// (ex.: receita de 3 unidades) é quem divide. Sem isso, previsto e realizado
// não seriam comparáveis e a divergência seria ruído.
//
// Percentuais (`taxRate`, `commissionRate`) são DECIMAIS (0.12 = 12%), a mesma
// convenção já usada por `custos.imposto_percentual` no resto do backend.

const {
  EVIDENCE_KINDS,
  EVIDENCE_QUALITY,
  isSource,
  sourceStrength,
} = require("./marginSources");

// ── Variáveis conhecidas ─────────────────────────────────────────────────────
// `unit` só documenta a natureza do número (dinheiro por unidade × fração).
// `tolerance` define a partir de quando duas observações são "diferentes".

const FIELDS = {
  PRICE: "price",
  LIST_PRICE: "listPrice",
  PROMO_PRICE: "promoPrice",
  COST: "cost",
  TAX_RATE: "taxRate",
  FIXED_FEE: "fixedFee",
  COMMISSION: "commission",
  COMMISSION_RATE: "commissionRate",
  FREIGHT: "freight",
  NET_RECEIPT: "netReceipt",
  REFUNDS: "refunds",
};

const FIELD_LIST = Object.values(FIELDS);

const MONEY_TOLERANCE = { absolute: 0.05, relative: 0.02 };
const RATE_TOLERANCE = { absolute: 0.001, relative: 0.02 };

const FIELD_SPEC = {
  [FIELDS.PRICE]: { unit: "money_per_unit", tolerance: MONEY_TOLERANCE },
  [FIELDS.LIST_PRICE]: { unit: "money_per_unit", tolerance: MONEY_TOLERANCE },
  [FIELDS.PROMO_PRICE]: { unit: "money_per_unit", tolerance: MONEY_TOLERANCE },
  [FIELDS.COST]: { unit: "money_per_unit", tolerance: MONEY_TOLERANCE },
  [FIELDS.TAX_RATE]: { unit: "rate", tolerance: RATE_TOLERANCE },
  [FIELDS.FIXED_FEE]: { unit: "money_per_unit", tolerance: MONEY_TOLERANCE },
  [FIELDS.COMMISSION]: { unit: "money_per_unit", tolerance: MONEY_TOLERANCE },
  [FIELDS.COMMISSION_RATE]: { unit: "rate", tolerance: RATE_TOLERANCE },
  [FIELDS.FREIGHT]: { unit: "money_per_unit", tolerance: MONEY_TOLERANCE },
  [FIELDS.NET_RECEIPT]: { unit: "money_per_unit", tolerance: MONEY_TOLERANCE },
  [FIELDS.REFUNDS]: { unit: "money_per_unit", tolerance: MONEY_TOLERANCE },
};

function specOf(fieldKey) {
  return FIELD_SPEC[fieldKey] || { unit: "money_per_unit", tolerance: MONEY_TOLERANCE };
}

// ── Tipos de divergência ─────────────────────────────────────────────────────
// CONFLICT = duas fontes descrevem o MESMO momento e discordam. É defeito de
//            dado: alguma das duas está errada.
// DRIFT    = o previsto e o realizado discordam. Não é defeito: é a informação
//            mais valiosa do Motor ("projetamos 12.8%, realizou 11.9%").
const DIVERGENCE_TYPES = {
  CONFLICT: "CONFLICT",
  DRIFT: "DRIFT",
};

function numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Cria uma evidência. Valor não numérico vira `null` (ausente) em vez de 0.
 * Evidência sem fonte reconhecida é rejeitada — preferimos perder a observação
 * a registrar um número sem procedência.
 */
function createEvidence({ source, value, kind, quality, observedAt, note }) {
  if (!isSource(source)) return null;
  return {
    source,
    value: numOrNull(value),
    kind: kind === EVIDENCE_KINDS.REALIZED ? EVIDENCE_KINDS.REALIZED : EVIDENCE_KINDS.PROJECTED,
    quality: EVIDENCE_QUALITY[quality] ? quality : EVIDENCE_QUALITY.MEASURED,
    observedAt: toIso(observedAt),
    note: note || null,
  };
}

/**
 * Coletor de evidências de um item. Uso:
 *   const bag = createEvidenceBag();
 *   bag.add(FIELDS.FREIGHT, { source: SOURCES.MELI_API, value: 23.40, ... });
 */
function createEvidenceBag() {
  const byField = new Map();

  function add(fieldKey, evidenceInput) {
    const evidence = createEvidence(evidenceInput);
    // Evidência sem valor não é registrada: "não observei" e "observei ausente"
    // são a mesma coisa aqui, e um `null` na lista só polui a auditoria.
    if (!evidence || evidence.value === null) return null;
    if (!byField.has(fieldKey)) byField.set(fieldKey, []);
    byField.get(fieldKey).push(evidence);
    return evidence;
  }

  function list(fieldKey) {
    return byField.get(fieldKey) ? byField.get(fieldKey).slice() : [];
  }

  function fields() {
    return Array.from(byField.keys());
  }

  return { add, list, fields };
}

// Escolhe a observação mais forte de um conjunto: maior força de fonte; empate
// resolvido pela observação mais recente.
function pickStrongest(evidences) {
  let best = null;
  for (const evidence of evidences) {
    if (!best) {
      best = evidence;
      continue;
    }
    const delta = sourceStrength(evidence.source) - sourceStrength(best.source);
    if (delta > 0) {
      best = evidence;
    } else if (delta === 0) {
      const a = evidence.observedAt ? Date.parse(evidence.observedAt) : -Infinity;
      const b = best.observedAt ? Date.parse(best.observedAt) : -Infinity;
      if (a > b) best = evidence;
    }
  }
  return best;
}

// Duas observações "diferem" só quando passam das DUAS tolerâncias: absoluta
// (evita alarme por centavo) e relativa (evita alarme por item barato).
function isDifferent(a, b, tolerance) {
  const absolute = Math.abs(a - b);
  if (absolute <= tolerance.absolute) return false;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  const relative = scale > 0 ? absolute / scale : Infinity;
  return relative > tolerance.relative;
}

function buildDivergence(type, a, b) {
  const absolute = Math.abs(a.value - b.value);
  const scale = Math.max(Math.abs(a.value), Math.abs(b.value));
  return {
    type,
    absolute: Math.round(absolute * 10000) / 10000,
    relative: scale > 0 ? Math.round((absolute / scale) * 10000) / 10000 : null,
    a: { source: a.source, kind: a.kind, value: a.value, observedAt: a.observedAt },
    b: { source: b.source, kind: b.kind, value: b.value, observedAt: b.observedAt },
  };
}

/**
 * Consolida as evidências de UMA variável.
 *
 * Devolve o valor escolhido para cada momento (projetado/realizado), o valor
 * "de exibição" (realizado tem precedência: é o que de fato aconteceu) e a
 * lista de divergências encontradas.
 */
function resolveField(fieldKey, evidences) {
  const spec = specOf(fieldKey);
  const all = Array.isArray(evidences) ? evidences.filter((e) => e && e.value !== null) : [];

  const projectedAll = all.filter((e) => e.kind === EVIDENCE_KINDS.PROJECTED);
  const realizedAll = all.filter((e) => e.kind === EVIDENCE_KINDS.REALIZED);

  const projected = pickStrongest(projectedAll);
  const realized = pickStrongest(realizedAll);

  const divergences = [];

  // CONFLICT: dentro do mesmo momento, cada observação é comparada com a
  // escolhida. Se a fonte mais fraca discorda da mais forte, o dado é suspeito.
  for (const group of [
    { chosen: projected, rest: projectedAll },
    { chosen: realized, rest: realizedAll },
  ]) {
    if (!group.chosen) continue;
    for (const evidence of group.rest) {
      if (evidence === group.chosen) continue;
      if (isDifferent(group.chosen.value, evidence.value, spec.tolerance)) {
        divergences.push(buildDivergence(DIVERGENCE_TYPES.CONFLICT, group.chosen, evidence));
      }
    }
  }

  // DRIFT: previsto × realizado.
  if (projected && realized && isDifferent(projected.value, realized.value, spec.tolerance)) {
    divergences.push(buildDivergence(DIVERGENCE_TYPES.DRIFT, projected, realized));
  }

  const selected = realized || projected || null;

  return {
    key: fieldKey,
    unit: spec.unit,
    present: Boolean(selected),
    selectedValue: selected ? selected.value : null,
    selectedSource: selected ? selected.source : null,
    selectedKind: selected ? selected.kind : null,
    projected: projected
      ? {
          value: projected.value,
          source: projected.source,
          quality: projected.quality,
          observedAt: projected.observedAt,
        }
      : null,
    realized: realized
      ? {
          value: realized.value,
          source: realized.source,
          quality: realized.quality,
          observedAt: realized.observedAt,
        }
      : null,
    evidences: all,
    divergences,
    hasConflict: divergences.some((d) => d.type === DIVERGENCE_TYPES.CONFLICT),
    hasDrift: divergences.some((d) => d.type === DIVERGENCE_TYPES.DRIFT),
  };
}

/**
 * Resolve todas as variáveis de um bag de uma vez.
 * Variáveis sem nenhuma evidência aparecem como ausentes (`present: false`) —
 * ausência é informação, não motivo para omitir a chave.
 */
function resolveAllFields(bag, fieldKeys = FIELD_LIST) {
  const out = {};
  for (const key of fieldKeys) {
    out[key] = resolveField(key, bag.list(key));
  }
  return out;
}

module.exports = {
  FIELDS,
  FIELD_LIST,
  FIELD_SPEC,
  DIVERGENCE_TYPES,
  MONEY_TOLERANCE,
  RATE_TOLERANCE,
  createEvidence,
  createEvidenceBag,
  resolveField,
  resolveAllFields,
  isDifferent,
  pickStrongest,
  specOf,
};
