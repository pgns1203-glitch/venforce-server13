// server/services/squads/rolloutGateBoot.js
// VenForce V3 — P2.2 HARDENING (arme do rollout gate no boot).
//
// O gate (config/squadsEnforcement) é burro de propósito: ele só recebe um
// veredito de prontidão e decide ligar/desligar. A POLÍTICA — o que conta como
// "dados prontos para enforcement" — mora AQUI, no boot.
//
// Essa separação é o que mantém aberta a porta do rollout parcial: uma
// estratégia futura (liberar por Squad, por lote, com exceções aceitas pela
// gestão) troca só esta política. O gate, o authorizationService e os ~13 call
// sites de autorização não mudam.
//
// Fail-safe em toda direção de dúvida: auditoria em voo, auditoria reprovada e
// auditoria que estourou levam todas a enforcement OFF (comportamento legado,
// ninguém perde carteira). O boot NUNCA quebra por causa do gate.

const {
  iniciarArme,
  armarGate,
  armarGateComFalha,
} = require("../../config/squadsEnforcement");

// Traduz os contadores da auditoria numa frase curta que diz O QUE falta.
// Um motivo genérico serve de rede: `pronto:false` sempre bloqueia, mesmo que
// a auditoria ganhe um critério novo que este resumo ainda não conheça.
function motivoDaAuditoria(a) {
  const partes = [];
  const c = a?.clientesAtivos || {};
  const u = a?.usuariosInternos || {};

  if (c.semSquad > 0) partes.push(`${c.semSquad} cliente(s) ativo(s) sem Squad`);
  if (c.emSquadInativo > 0) partes.push(`${c.emSquadInativo} cliente(s) em Squad inativo`);
  if (u.semMembership > 0) partes.push(`${u.semMembership} interno(s) sem membership`);
  if (u.apenasEmSquadInativo > 0) partes.push(`${u.apenasEmSquadInativo} interno(s) só em Squad inativo`);
  if (u.semPrincipal > 0) partes.push(`${u.semPrincipal} interno(s) sem Squad principal`);

  if (!partes.length) return "auditoria de migração reprovou (ver GET /squads/migracao/auditoria)";
  return partes.join("; ");
}

// Arma o gate para este processo.
//
// SÍNCRONO até `iniciarArme()`: a janela entre "o processo já aceita
// requisições" e "a auditoria respondeu" fica fechada (gate `armando` = OFF).
// Só depois a auditoria roda e emite o veredito.
//
// Nunca rejeita — um boot não pode cair por causa do diagnóstico de rollout.
// Devolve `{ gate, auditoria, erro }` para o log de boot usar.
async function armarRolloutGate({ auditoria, ensureSquadsTables } = {}) {
  iniciarArme();

  try {
    if (typeof ensureSquadsTables === "function") await ensureSquadsTables();
    const a = await auditoria();
    const gate = armarGate({
      pronto: a?.pronto === true,
      motivo: a?.pronto === true ? null : motivoDaAuditoria(a),
    });
    return { gate, auditoria: a, erro: null };
  } catch (erro) {
    const gate = armarGateComFalha(erro);
    return { gate, auditoria: null, erro };
  }
}

module.exports = { armarRolloutGate, motivoDaAuditoria };
