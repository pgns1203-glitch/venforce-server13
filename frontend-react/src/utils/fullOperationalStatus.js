// Vocabulário único de status operacional de um inventory Full — rótulo,
// tom semântico e a lista de opções de filtro derivam TODOS daqui, para que
// tabela, filtro e drawer nunca fiquem fora de sincronia entre si.
//
// Ruptura/crítico pedem ação imediata (danger); repor/alto/excesso/sem giro
// pedem atenção, sem serem urgentes (warning); saudável confirma que está
// tudo bem (success). Sem entrada = sem-dado, tom neutro (default do
// .vf-status, sem modificador is-*).
export const STATUS_LABEL = {
  RUPTURA: "Ruptura",
  CRITICO: "Crítico",
  REPOR: "Repor",
  SAUDAVEL: "Saudável",
  ALTO: "Alto",
  EXCESSO: "Excesso",
  SEM_GIRO: "Sem giro",
  SEM_DADO: "Sem dado",
};

export const STATUS_TONE = {
  RUPTURA: "is-danger",
  CRITICO: "is-danger",
  REPOR: "is-warning",
  SAUDAVEL: "is-success",
  ALTO: "is-warning",
  EXCESSO: "is-warning",
  SEM_GIRO: "is-warning",
};

export const STATUS_OPTIONS = Object.entries(STATUS_LABEL);
