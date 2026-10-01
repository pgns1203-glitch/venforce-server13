// server/services/ai/aiTasks.js
// -----------------------------------------------------------------------------
// Identificadores das tarefas de IA de texto e o provedor/modelo de cada uma.
//
// Quem chama o aiProvider informa a TASK (o que está sendo gerado), nunca o
// provedor nem o modelo. O aiProvider resolve:
//
//   PROVEDOR: env da task (ENV_PROVIDER_POR_TASK) → AI_PROVIDER → "anthropic".
//             legacy_optimizer é FIXO em "anthropic" (não migra nesta fase).
//   MODELO:   env da task (ENV_MODELO_POR_TASK) → padrão do provedor
//             (Anthropic: ANTHROPIC_MODEL → Haiku; MiMo: MIMO_MODEL →
//             mimo-v2.6-pro). A env de modelo da task vale para o provedor
//             que a task resolveu — precisa ser um ID desse provedor.
//
// Sem nenhuma env nova o comportamento é exatamente o de antes da task existir.
// Task desconhecida (ou ausente) nunca lê env de task: usa AI_PROVIDER e o
// padrão do provedor.
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

// Só tasks com provedor próprio configurável.
const ENV_PROVIDER_POR_TASK = Object.freeze({
  [AI_TASKS.SEO_TITLE]: "AI_SEO_TITLE_PROVIDER",
  [AI_TASKS.SEO_DESCRIPTION]: "AI_SEO_DESCRIPTION_PROVIDER",
});

// Tasks presas a um provedor, independentemente de AI_PROVIDER.
const PROVIDER_FIXO_POR_TASK = Object.freeze({
  [AI_TASKS.LEGACY_OPTIMIZER]: "anthropic",
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
  ENV_PROVIDER_POR_TASK,
  PROVIDER_FIXO_POR_TASK,
  taskConhecida,
  modeloDaTask,
};
