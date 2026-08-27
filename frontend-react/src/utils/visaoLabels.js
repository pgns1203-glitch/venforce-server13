// frontend-react/src/utils/visaoLabels.js
// Rótulos/tons dos vocabulários fechados que os blocos da Visão devolvem
// (cliente360Service.getCliente360, centralVendasSyncRunService). Nenhum
// desses valores é inventado aqui — só a tradução pt-BR + tom visual.

export const SAUDE_STATUS = {
  ok: { label: "Operação saudável", tom: "success" },
  atencao: { label: "Precisa de atenção", tom: "warning" },
  critico: { label: "Crítico", tom: "danger" },
};

export function saudeStatusInfo(status) {
  return SAUDE_STATUS[status] || { label: status || "—", tom: "neutral" };
}

export const SYNC_STATUS = {
  sincronizado: { label: "Sincronizado", tom: "success" },
  stale: { label: "Desatualizado", tom: "warning" },
  ausente: { label: "Nunca sincronizado", tom: "danger" },
};

export function syncStatusInfo(status) {
  return SYNC_STATUS[status] || { label: status || "—", tom: "neutral" };
}

export const RUN_STATUS = {
  completed: { label: "Concluída", tom: "success" },
  running: { label: "Em andamento", tom: "info" },
  queued: { label: "Na fila", tom: "neutral" },
  failed: { label: "Falhou", tom: "danger" },
};

export function runStatusInfo(status) {
  return RUN_STATUS[status] || { label: status || "—", tom: "neutral" };
}

export const COMPLETENESS_STATUS = {
  complete: "Completa",
  partial: "Parcial",
  failed: "Falhou",
  unknown: "Desconhecida",
};

export const CONFIANCA_FECHAMENTO = {
  confiavel: { label: "Confiável", tom: "success" },
  parcial: { label: "Parcial", tom: "warning" },
  insuficiente: { label: "Insuficiente", tom: "danger" },
};

export const ADS_SEM_DADOS_MOTIVO = {
  NO_TOKEN: "Sem token de Ads conectado.",
  NO_ADS_PERMISSION: "A conta não tem permissão de Ads no Mercado Livre.",
  ML_ADS_API_ERROR: "A API de Ads do Mercado Livre não respondeu.",
  NO_ADVERTISER_FOUND: "Nenhum anunciante encontrado para esta conta.",
};
