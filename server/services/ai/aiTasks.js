// server/services/ai/aiTasks.js
// -----------------------------------------------------------------------------
// Identificadores das tarefas de IA de texto e o modelo específico de cada uma.
//
// Quem chama o aiProvider informa a TASK (o que está sendo gerado), nunca o
// modelo. O aiProvider resolve o modelo assim:
//
//   1. env específica da task (tabela ENV_MODELO_POR_TASK), se preenchida;
//   2. modelo padrão do provedor — no Anthropic: ANTHROPIC_MODEL e, sem ela,
//      o DEFAULT_MODEL do claudeClient (Haiku).
//
// Sem nenhuma env nova o comportamento é exatamente o de antes da task existir.
// Task desconhecida (ou ausente) nunca lê env: cai direto no padrão do provedor.
// Ver docs/AI_PROVIDER.md.
// -----------------------------------------------------------------------------

const AI_TASKS = Object.freeze({
  SEO_TITLE: "seo_title",
  SEO_DESCRIPTION: "seo_description",
  LEGACY_OPTIMIZER: "legacy_optimizer",
});

// Só tasks com modelo próprio configurável. O otimizador legado fica de fora
// de propósito: segue o padrão do provedor, como sempre.
const ENV_MODELO_POR_TASK = Object.freeze({
  [AI_TASKS.SEO_TITLE]: "AI_SEO_TITLE_MODEL",
  [AI_TASKS.SEO_DESCRIPTION]: "AI_SEO_DESCRIPTION_MODEL",
});

const TASKS_VALIDAS = new Set(Object.values(AI_TASKS));

function taskConhecida(task) {
  return typeof task === "string" && TASKS_VALIDAS.has(task);
}

// Modelo específico da task, ou null quando não há (task sem env própria,
// env vazia/só espaços, task desconhecida). Devolve também a env de origem.
function modeloDaTask(task, env = process.env) {
  if (!taskConhecida(task)) return null;
  const nomeEnv = ENV_MODELO_POR_TASK[task];
  if (!nomeEnv) return null;
  const valor = String(env[nomeEnv] || "").trim();
  return valor ? { model: valor, origem: nomeEnv } : null;
}

module.exports = {
  AI_TASKS,
  ENV_MODELO_POR_TASK,
  taskConhecida,
  modeloDaTask,
};
