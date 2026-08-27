// server/config/squadsEnforcement.js
// VenForce V3 — P2.2 (Rollout Safety).
//
// Interruptor ÚNICO do enforcement de autorização por carteira (Squads).
// Separa três coisas que hoje entram juntas num deploy:
//
//   1. CÓDIGO DISPONÍVEL   — o seam de carteira existe (P2.1), já deployado
//   2. DADOS MIGRADOS      — squads / squad_members / cliente_squad_history populados
//   3. ENFORCEMENT ATIVO   — este flag
//
// Lido em TEMPO DE CHAMADA (nunca cacheado num módulo). Ativar/desativar =
// setar a env var no serviço (Render) e reiniciar. Sem migração de schema,
// sem tocar em dados. Mesmo padrão de FULL_CENTRAL_ENABLED / OBSERVABILITY_*.
//
// ─────────────────────────── ESTADOS (fail-safe = OFF) ───────────────────────
//
//   SQUADS_ENFORCEMENT ausente / vazio          -> OFF   (padrão de deploy)
//   SQUADS_ENFORCEMENT = on|true|1|yes|enabled   -> ON
//   SQUADS_ENFORCEMENT = off|false|0|no|disabled -> OFF
//   SQUADS_ENFORCEMENT = qualquer outra coisa    -> OFF   + console.warn (1x)
//
// Nunca há ativação acidental: só um token explícito de verdade liga.
//
// ─────────────────────────── SIGNIFICADO ────────────────────────────────────
//
//   OFF  → comportamento legado (pré-Squads): papéis internos (user/membro/
//          interno) enxergam TODOS os clientes ativos. Ninguém fica sem
//          carteira por falta de migração. É o estado seguro para: deploy do
//          código, migração de dados e validação.
//
//   ON   → autorização por Squad vale de verdade: interno só acessa clientes
//          do(s) seu(s) Squad(s) ativo(s); interno sem membership → carteira
//          vazia (403). Só ligar depois da migração + auditoria pronta.
//
//   admin e seller são IDÊNTICOS nos dois estados — o flag não os toca:
//   admin = bypass global; seller = seller_clientes (isolamento legado
//   preservado). O flag só muda o caminho dos papéis INTERNOS.

const TRUE_TOKENS = new Set(["on", "true", "1", "yes", "enabled", "enforce"]);
const FALSE_TOKENS = new Set(["", "off", "false", "0", "no", "disabled"]);

let _avisouTokenInvalido = false;

// true  → enforcement de carteira por Squad ativo
// false → comportamento legado (interno vê todos os clientes ativos)
function isEnforcementEnabled() {
  const bruto = process.env.SQUADS_ENFORCEMENT;
  const norm = String(bruto ?? "").trim().toLowerCase();

  if (TRUE_TOKENS.has(norm)) return true;
  if (FALSE_TOKENS.has(norm)) return false;

  // Token não reconhecido: fail-safe OFF + aviso único (não spammar o log).
  if (!_avisouTokenInvalido) {
    console.warn(
      `[squads] SQUADS_ENFORCEMENT="${bruto}" não é um valor reconhecido — ` +
      `enforcement tratado como OFF (fail-safe). Use on|off (ou true|false).`
    );
    _avisouTokenInvalido = true;
  }
  return false;
}

// Para logs de boot / observabilidade.
function describeEnforcement() {
  return {
    envRaw: process.env.SQUADS_ENFORCEMENT ?? null,
    enabled: isEnforcementEnabled(),
  };
}

// Só para testes: reseta o latch do warn de token inválido.
function _resetParaTeste() {
  _avisouTokenInvalido = false;
}

module.exports = { isEnforcementEnabled, describeEnforcement, _resetParaTeste };
