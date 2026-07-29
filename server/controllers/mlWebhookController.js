// server/controllers/mlWebhookController.js
// Recebimento de notificações/webhooks do Mercado Livre (orders_v2, items, etc.).
//
// Propositalmente separado de mlController.js: aqui não existe OAuth, state,
// code ou token — é só uma notificação HTTP que o Mercado Livre reenvia com
// retry se não receber 200 rapidamente. Por isso a rota sempre confirma o
// recebimento primeiro e só depois processa, sem nunca deixar uma falha de
// processamento virar erro HTTP numa resposta que já foi enviada.

const MAX_RESOURCE_LENGTH = 200;
const MAX_TOPIC_LENGTH = 80;
const MAX_DATE_LENGTH = 60;

function sanitizeText(value, maxLength) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

// user_id/application_id vêm como número na doc do ML, mas notificações reais
// já foram vistas com string — aceitamos os dois sem executar coerção solta.
function sanitizeIdentifier(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return value.trim();
  return null;
}

function sanitizeAttempts(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extrai somente os campos conhecidos e seguros do corpo da notificação.
 * Nunca repassa o body inteiro adiante (nem para log, nem para persistência).
 * Retorna null se o corpo não for um objeto plano — nesse caso não há o que extrair.
 */
function extrairNotificacao(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;

  return {
    resource: sanitizeText(body.resource, MAX_RESOURCE_LENGTH),
    topic: sanitizeText(body.topic, MAX_TOPIC_LENGTH),
    userId: sanitizeIdentifier(body.user_id),
    applicationId: sanitizeIdentifier(body.application_id),
    attempts: sanitizeAttempts(body.attempts),
    sent: sanitizeText(body.sent, MAX_DATE_LENGTH),
    received: sanitizeText(body.received, MAX_DATE_LENGTH),
  };
}

/**
 * Processamento pós-confirmação. Nesta primeira etapa apenas registra
 * metadados sanitizados — não consulta a API do Mercado Livre.
 * Próximo passo (fora deste escopo): buscar `resource` via mlFetch usando o
 * token do cliente vinculado, aceitando somente os caminhos internos
 * esperados da API oficial (ex.: /orders/:id, /items/:id) — nunca uma URL
 * arbitrária vinda do corpo da notificação.
 */
async function processarNotificacao(notificacao) {
  console.log(
    "[ML webhook] notificação recebida:",
    JSON.stringify({
      topic: notificacao.topic,
      resource: notificacao.resource,
      userId: notificacao.userId,
      applicationId: notificacao.applicationId,
      attempts: notificacao.attempts,
    })
  );
}

function receberNotificacaoMlController(req, res) {
  // Confirma o recebimento antes de qualquer processamento — o Mercado Livre
  // reenvia a notificação (retry) se não receber 200 rapidamente.
  res.status(200).json({ ok: true, recebido: true });

  setImmediate(() => {
    try {
      const notificacao = extrairNotificacao(req.body);
      if (!notificacao) {
        console.error("[ML webhook] payload inválido: corpo da notificação não é um objeto.");
        return;
      }

      Promise.resolve(processarNotificacao(notificacao)).catch((err) => {
        console.error("[ML webhook] erro no processamento assíncrono:", err?.message || err);
      });
    } catch (err) {
      // Nunca deixa o processamento posterior derrubar o processo Node.
      console.error("[ML webhook] erro ao processar notificação:", err?.message || err);
    }
  });
}

module.exports = {
  receberNotificacaoMlController,
  extrairNotificacao,
  processarNotificacao,
};
