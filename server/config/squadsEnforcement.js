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

// ─────────────────────── HARDENING: o ROLLOUT GATE ──────────────────────────
//
// A flag sozinha não bastava: `SQUADS_ENFORCEMENT=on` com a migração ainda
// incompleta ligava o enforcement de verdade e derrubava todo usuário interno
// em 403 cascata — a única proteção era um console.warn no boot, que é
// conselho, não trava. O gate cruza a INTENÇÃO do operador (a flag) com o
// ESTADO REAL DOS DADOS (a auditoria de migração), armado no boot.
//
//   nao_armado  ninguém armou           → a flag governa sozinha
//               (testes e scripts que só setam a env var — sem regressão)
//   armando     boot começou, auditoria ainda em voo   → OFF
//   liberado    auditoria aprovou                      → a flag governa
//   bloqueado   auditoria reprovou OU falhou           → OFF
//
// Duas invariantes que o gate NUNCA quebra:
//
//   1. O gate só sabe DESLIGAR. Ele jamais liga enforcement que a flag não
//      pediu — `SQUADS_ENFORCEMENT` off/ausente faz curto-circuito antes de
//      qualquer consulta ao gate, e por isso o ROLLBACK continua instantâneo.
//   2. Fail-safe permanece OFF em toda direção de dúvida (auditoria em voo,
//      auditoria que estourou, banco sem as tabelas).
//
// O veredito de prontidão é decidido por QUEM ARMA (server/index.js), não aqui.
// `armarGate({ pronto, motivo })` recebe a decisão pronta — assim uma
// estratégia futura de rollout parcial (por Squad, por lote, por exceções
// aceitas) troca só a política do call site, sem tocar neste módulo.
//
// Escape hatch: `SQUADS_ENFORCEMENT_ALLOW_INCOMPLETE` destrava um gate
// bloqueado quando as pendências são exceções conhecidas e aceitas (a
// auditoria é estrita e não as acomoda). Exige token próprio e explícito —
// nunca herda o de `SQUADS_ENFORCEMENT` — e grita no log.

const TRUE_TOKENS = new Set(["on", "true", "1", "yes", "enabled", "enforce"]);
const FALSE_TOKENS = new Set(["", "off", "false", "0", "no", "disabled"]);

const GATE_NAO_ARMADO = "nao_armado";
const GATE_ARMANDO = "armando";
const GATE_LIBERADO = "liberado";
const GATE_BLOQUEADO = "bloqueado";

let _avisouTokenInvalido = false;
let _gate = GATE_NAO_ARMADO;
let _motivo = null;
let _avisouBloqueio = false;
let _avisouOverride = false;

// Intenção do operador: o que a env var pede, ignorando o estado dos dados.
function flagLigada() {
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

// Só um token explícito e próprio destrava. Valor inválido → NÃO destrava.
function overrideAtivo() {
  const norm = String(process.env.SQUADS_ENFORCEMENT_ALLOW_INCOMPLETE ?? "").trim().toLowerCase();
  return TRUE_TOKENS.has(norm);
}

// Marca que o boot assumiu o controle do gate. SÍNCRONO e chamado ANTES da
// auditoria (que é async): fecha a janela em que o processo já atende
// requisições mas ainda não sabe se os dados estão migrados.
function iniciarArme() {
  _gate = GATE_ARMANDO;
  _motivo = "auditoria de migração em andamento";
  _avisouBloqueio = false;
  return _gate;
}

// Veredito da auditoria. `pronto` decidido pelo call site (ver nota acima).
function armarGate({ pronto, motivo = null } = {}) {
  _gate = pronto ? GATE_LIBERADO : GATE_BLOQUEADO;
  _motivo = pronto ? null : (motivo || "auditoria de migração não está pronta");
  _avisouBloqueio = false;
  return _gate;
}

// A auditoria não respondeu (banco sem as tabelas de Squad, conexão caída…).
// Não dá para afirmar que os dados estão prontos ⇒ bloqueia. Fail-safe OFF.
function armarGateComFalha(err) {
  _gate = GATE_BLOQUEADO;
  _motivo = `auditoria de migração falhou: ${err?.message || err || "erro desconhecido"}`;
  _avisouBloqueio = false;
  return _gate;
}

// true  → enforcement de carteira por Squad ativo
// false → comportamento legado (interno vê todos os clientes ativos)
function isEnforcementEnabled() {
  // Curto-circuito: sem intenção do operador não há o que gatear. É isto que
  // mantém o rollback (`=off` + restart) instantâneo e independente do gate.
  if (!flagLigada()) return false;

  // Gate nunca armado: ninguém consultou a auditoria (testes, scripts, CLIs).
  // A flag governa sozinha — comportamento idêntico ao P2.2 original.
  if (_gate === GATE_NAO_ARMADO || _gate === GATE_LIBERADO) return true;

  if (_gate === GATE_BLOQUEADO && overrideAtivo()) {
    if (!_avisouOverride) {
      console.warn(
        `[squads] ⚠ enforcement ATIVO por override explícito ` +
        `(SQUADS_ENFORCEMENT_ALLOW_INCOMPLETE) com a auditoria NÃO pronta — ` +
        `motivo do bloqueio: ${_motivo}. Usuários internos sem membership ficarão ` +
        `sem carteira (403). Remova o override assim que a migração fechar.`
      );
      _avisouOverride = true;
    }
    return true;
  }

  if (!_avisouBloqueio) {
    console.warn(
      `[squads] SQUADS_ENFORCEMENT pede ON, mas o rollout gate está "${_gate}" — ` +
      `enforcement mantido OFF (fail-safe). Motivo: ${_motivo}. ` +
      `Complete a migração (GET /squads/migracao/auditoria) ou, para exceções ` +
      `aceitas, set SQUADS_ENFORCEMENT_ALLOW_INCOMPLETE=on.`
    );
    _avisouBloqueio = true;
  }
  return false;
}

// Para logs de boot / observabilidade.
function describeEnforcement() {
  return {
    envRaw: process.env.SQUADS_ENFORCEMENT ?? null,
    flagLigada: flagLigada(),
    gate: _gate,
    motivo: _motivo,
    overrideAtivo: overrideAtivo(),
    enabled: isEnforcementEnabled(),
  };
}

// Só para testes: zera o gate e os latches de warn.
function _resetParaTeste() {
  _avisouTokenInvalido = false;
  _avisouBloqueio = false;
  _avisouOverride = false;
  _gate = GATE_NAO_ARMADO;
  _motivo = null;
}

module.exports = {
  isEnforcementEnabled,
  describeEnforcement,
  iniciarArme,
  armarGate,
  armarGateComFalha,
  _resetParaTeste,
};
