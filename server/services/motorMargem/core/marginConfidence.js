// server/services/motorMargem/core/marginConfidence.js
// CONFIABILIDADE do Motor de Margem — módulo puro, sem I/O.
//
// Regra de produto: NÃO existe percentual inventado ("API = 98%"). Nesta fase a
// confiança é uma CLASSE (HIGH/MEDIUM/LOW/UNKNOWN) e cada classe carrega os
// MOTIVOS que a produziram. Percentual só depois, quando houver histórico real
// de acerto previsto × realizado para calibrar — ver MOTOR_MARGEM_CONFIABILIDADE.
//
// Exemplo de saída (o mesmo do briefing):
//   freight:
//     confidence: LOW
//     reasons:
//       - API informou 23.40
//       - pedido realizado informou 18.70
//       - divergência de 4.70

const { SOURCES, EVIDENCE_QUALITY } = require("./marginSources");
const { FIELDS } = require("./marginEvidence");

const LEVELS = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
  UNKNOWN: "UNKNOWN",
};

// Ordem para agregação. UNKNOWN é o pior: não é "pouca confiança", é ausência.
const LEVEL_ORDER = [LEVELS.UNKNOWN, LEVELS.LOW, LEVELS.MEDIUM, LEVELS.HIGH];

function levelIndex(level) {
  const idx = LEVEL_ORDER.indexOf(level);
  return idx === -1 ? 0 : idx;
}

function worstLevel(levels) {
  if (!levels.length) return LEVELS.UNKNOWN;
  return levels.reduce((worst, level) => (levelIndex(level) < levelIndex(worst) ? level : worst));
}

// Rebaixa um nível, mas nunca até UNKNOWN: existe dado, ele é que é fraco.
function downgrade(level) {
  const idx = levelIndex(level);
  if (idx <= 1) return LEVELS.LOW;
  return LEVEL_ORDER[idx - 1];
}

// ── Motivos ──────────────────────────────────────────────────────────────────
// Códigos estáveis (a Central pode traduzir/filtrar por código) + mensagem
// pronta em pt-BR para o drawer.

const REASONS = {
  DADO_AUSENTE: "DADO_AUSENTE",
  FONTES_EM_CONFLITO: "FONTES_EM_CONFLITO",
  DIVERGENCIA_PREVISTO_REALIZADO: "DIVERGENCIA_PREVISTO_REALIZADO",
  SEM_EVIDENCIA_REALIZADA: "SEM_EVIDENCIA_REALIZADA",
  FONTE_APENAS_DOM: "FONTE_APENAS_DOM",
  VALOR_DERIVADO: "VALOR_DERIVADO",
  VALOR_ESTIMADO: "VALOR_ESTIMADO",
  DADO_ANTIGO: "DADO_ANTIGO",
  CUSTO_ZERO: "CUSTO_ZERO",
  ASSUMIDO_ZERO: "ASSUMIDO_ZERO",
  CONFIRMADO_POR_DUAS_FONTES: "CONFIRMADO_POR_DUAS_FONTES",
  SEM_CONCILIACAO_FINANCEIRA: "SEM_CONCILIACAO_FINANCEIRA",
};

function reason(code, message, detail = null) {
  return { code, message, detail };
}

function fmt(value) {
  return typeof value === "number" ? value.toFixed(2) : String(value);
}

// Idade a partir da qual uma observação de API deixa de ser "o estado atual".
const STALE_DAYS_DEFAULT = 7;

// Variáveis que, havendo venda no período, deveriam ter contrapartida realizada.
// Custo/imposto/taxa fixa não entram: são declarados na Base, não observados na
// venda — a ausência de "realizado" ali não é um defeito.
const FIELDS_EXPECTING_REALIZED = new Set([
  FIELDS.PRICE,
  FIELDS.COMMISSION,
  FIELDS.FREIGHT,
]);

function ageInDays(observedAt, now) {
  if (!observedAt) return null;
  const ms = Date.parse(observedAt);
  if (!Number.isFinite(ms)) return null;
  return (now.getTime() - ms) / (1000 * 60 * 60 * 24);
}

/**
 * Classifica UMA variável já resolvida (saída de `resolveField`).
 *
 * @param {object} field   resultado de resolveField()
 * @param {object} ctx     { now, staleDays, hasOrders, assumedZero, settlementAvailable }
 * @returns {{ level: string, reasons: Array<{code,message,detail}> }}
 */
function classifyField(field, ctx = {}) {
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const staleDays = Number.isFinite(ctx.staleDays) ? ctx.staleDays : STALE_DAYS_DEFAULT;
  const reasons = [];

  if (!field || !field.present) {
    // Variável opcional que o motor assumiu como zero: a ausência é dupla —
    // não temos o dado E ele entrou no cálculo como 0.
    if (ctx.assumedZero) {
      reasons.push(
        reason(REASONS.ASSUMIDO_ZERO, "Sem dado; o cálculo assumiu 0 para esta variável.")
      );
    }
    reasons.push(reason(REASONS.DADO_AUSENTE, "Nenhuma fonte informou esta variável."));
    return { level: LEVELS.UNKNOWN, reasons };
  }

  let level;

  // 1) Conflito dentro do mesmo momento é o pior sinal: alguém está errado.
  if (field.hasConflict) {
    level = LEVELS.LOW;
    for (const divergence of field.divergences.filter((d) => d.type === "CONFLICT")) {
      reasons.push(
        reason(
          REASONS.FONTES_EM_CONFLITO,
          `${divergence.a.source} informou ${fmt(divergence.a.value)} e ${divergence.b.source} informou ${fmt(divergence.b.value)} para o mesmo momento (diferença de ${fmt(divergence.absolute)}).`,
          divergence
        )
      );
    }
  } else {
    // 2) Sem conflito: a força da fonte escolhida define o teto.
    switch (field.selectedSource) {
      case SOURCES.MERCADO_PAGO:
      case SOURCES.MELI_ORDER:
        level = LEVELS.HIGH;
        break;
      case SOURCES.VENFORCE_BASE:
        level = LEVELS.HIGH;
        break;
      case SOURCES.MELI_API:
        level = LEVELS.HIGH;
        break;
      case SOURCES.DERIVED:
        level = LEVELS.MEDIUM;
        reasons.push(
          reason(REASONS.VALOR_DERIVADO, "Valor calculado pelo Motor a partir de outras variáveis.")
        );
        break;
      case SOURCES.EXTENSION_DOM:
        level = LEVELS.LOW;
        reasons.push(
          reason(
            REASONS.FONTE_APENAS_DOM,
            "Única evidência veio da leitura de tela da extensão (não confirmada por API)."
          )
        );
        break;
      default:
        level = LEVELS.MEDIUM;
    }

    // 3) Previsto × realizado discordando: a margem é calculável, mas o número
    //    que a Central mostrar vai depender de qual momento o operador olhar.
    if (field.hasDrift) {
      level = LEVELS.LOW;
      for (const divergence of field.divergences.filter((d) => d.type === "DRIFT")) {
        reasons.push(
          reason(
            REASONS.DIVERGENCIA_PREVISTO_REALIZADO,
            `Previsto (${divergence.a.source}) informou ${fmt(divergence.a.value)}; realizado (${divergence.b.source}) informou ${fmt(divergence.b.value)}; divergência de ${fmt(divergence.absolute)}.`,
            divergence
          )
        );
      }
    } else if (field.projected && field.realized) {
      // Duas fontes de momentos diferentes concordando é o melhor sinal que o
      // Motor consegue produzir hoje.
      reasons.push(
        reason(
          REASONS.CONFIRMADO_POR_DUAS_FONTES,
          `Previsto (${field.projected.source}) e realizado (${field.realized.source}) concordam.`
        )
      );
    } else if (ctx.hasOrders && FIELDS_EXPECTING_REALIZED.has(field.key) && !field.realized) {
      level = downgrade(level);
      reasons.push(
        reason(
          REASONS.SEM_EVIDENCIA_REALIZADA,
          "Houve venda no período, mas nenhuma evidência realizada confirmou esta variável."
        )
      );
    }
  }

  // 4) Qualidade da observação escolhida.
  const chosen = field.realized || field.projected;
  if (chosen && chosen.quality === EVIDENCE_QUALITY.ESTIMATED) {
    level = downgrade(level);
    reasons.push(reason(REASONS.VALOR_ESTIMADO, "Valor estimado/rateado, não observado diretamente."));
  }

  // 5) Idade do dado — só faz sentido para o estado ATUAL vindo de API.
  if (field.projected && field.projected.source === SOURCES.MELI_API) {
    const age = ageInDays(field.projected.observedAt, now);
    if (age !== null && age > staleDays) {
      level = downgrade(level);
      reasons.push(
        reason(
          REASONS.DADO_ANTIGO,
          `Leitura da API do Mercado Livre tem ${Math.floor(age)} dias (limite: ${staleDays}).`
        )
      );
    }
  }

  // 6) Custo zero: a importação de base descarta linhas sem custo, então um
  //    custo 0 gravado é raro e quase sempre é erro de planilha. Não bloqueia o
  //    cálculo — sinaliza.
  if (field.key === FIELDS.COST && field.selectedValue === 0) {
    level = LEVELS.LOW;
    reasons.push(
      reason(REASONS.CUSTO_ZERO, "Custo cadastrado como 0,00 na Base — confirmar se é real.")
    );
  }

  return { level, reasons };
}

/**
 * Consolida a confiança de todas as variáveis + a confiança geral do item.
 *
 * A confiança geral é o PIOR nível entre as variáveis críticas (as que entram
 * na fórmula). Variáveis de conciliação (recebimento líquido, reembolso) não
 * rebaixam a margem: elas alimentam o estado RECONCILING, não a confiança.
 */
function buildConfidenceReport(fields, ctx = {}) {
  const criticalFields = ctx.criticalFields || [
    FIELDS.PRICE,
    FIELDS.COST,
    FIELDS.TAX_RATE,
    FIELDS.FIXED_FEE,
    FIELDS.COMMISSION,
    FIELDS.FREIGHT,
  ];
  const assumed = new Set(ctx.assumed || []);

  const byField = {};
  for (const [key, field] of Object.entries(fields)) {
    byField[key] = classifyField(field, { ...ctx, assumedZero: assumed.has(key) });
  }

  const criticalLevels = criticalFields
    .filter((key) => byField[key])
    .map((key) => byField[key].level);

  let overallLevel = worstLevel(criticalLevels);
  const overallReasons = [];

  for (const key of criticalFields) {
    const entry = byField[key];
    if (!entry) continue;
    if (levelIndex(entry.level) < levelIndex(LEVELS.HIGH)) {
      for (const r of entry.reasons) {
        // Confirmação positiva não é motivo de rebaixamento; fica na variável.
        if (r.code === REASONS.CONFIRMADO_POR_DUAS_FONTES) continue;
        overallReasons.push({ ...r, field: key });
      }
    }
  }

  // Venda ocorrida sem conciliação financeira não derruba a margem projetada,
  // mas precisa aparecer nos motivos: é o que sustenta o estado RECONCILING.
  if (ctx.hasOrders && ctx.settlementAvailable === false) {
    overallReasons.push({
      ...reason(
        REASONS.SEM_CONCILIACAO_FINANCEIRA,
        "Houve venda no período e nenhuma fonte de recebimento (Mercado Pago) confirmou o valor líquido."
      ),
      field: FIELDS.NET_RECEIPT,
    });
  }

  return {
    overall: { level: overallLevel, reasons: overallReasons },
    byField,
  };
}

module.exports = {
  LEVELS,
  LEVEL_ORDER,
  REASONS,
  STALE_DAYS_DEFAULT,
  FIELDS_EXPECTING_REALIZED,
  classifyField,
  buildConfidenceReport,
  worstLevel,
  downgrade,
  levelIndex,
};
