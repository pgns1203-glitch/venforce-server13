'use strict';

/**
 * clickupService.js — Central executiva ClickUp (camada de serviço)
 * -----------------------------------------------------------------
 * Fonte de dados: GET /api/v2/list/{list_id}/task  (endpoint que funciona)
 *
 * Correções de performance vs. versão anterior:
 *   - page_limit default REAL baixo (12) — não faz mais 120 chamadas por abertura
 *   - para no last_page / página parcial, não só na vazia
 *   - timeout/abort por request (15s)
 *   - cache da lista bruta por (listId|pageLimit), TTL configurável
 *   - comentários sob demanda, com cache por task_id e teto de tasks
 *
 * Correção de dados:
 *   - cliente agora lê custom field "cliente" -> tag -> folder (antes só folder => "hidden")
 *
 * Contrato de saída mantido compatível com Portal/clickup-executivo.js.
 *
 * Variáveis Render: CLICKUP_TOKEN, CLICKUP_NOVA_GESTAO_LIST_ID,
 *   CLICKUP_DEFAULT_PAGE_LIMIT (default 12), CLICKUP_CACHE_TTL_SECONDS (default 300)
 */

const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2';
const DEFAULT_LIST_NAME = 'Nova Gestão Tarefas';

const PAGE_SIZE = 100;          // ClickUp devolve até 100 tasks/página
const HARD_PAGE_CAP = 120;      // teto absoluto de segurança
const FETCH_TIMEOUT_MS = 15000; // timeout por chamada ao ClickUp
const COMMENTS_MAX_TASKS = 80;  // teto de tasks enriquecidas com comentário de uma vez
const COMMENTS_CONCURRENCY = 5; // chamadas de comentário em paralelo

const listCache = new Map();    // key: listId|pageLimit -> { value:{tasks,pagesFetched}, expiresAt }
const commentCache = new Map(); // key: taskId           -> { value:{...}, expiresAt }

class ClickUpServiceError extends Error {
  constructor(publicMessage, statusCode = 500, code = 'CLICKUP_SERVICE_ERROR') {
    super(publicMessage);
    this.publicMessage = publicMessage;
    this.statusCode = statusCode;
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getConfig() {
  const token = process.env.CLICKUP_TOKEN;
  const defaultListId = process.env.CLICKUP_NOVA_GESTAO_LIST_ID || '';
  const defaultPageLimit = toSafeInteger(process.env.CLICKUP_DEFAULT_PAGE_LIMIT, 12, 1, HARD_PAGE_CAP);
  const cacheTtlSeconds = toSafeInteger(process.env.CLICKUP_CACHE_TTL_SECONDS, 300, 0, 3600);

  if (!token) {
    throw new ClickUpServiceError('CLICKUP_TOKEN não configurado no backend.', 500, 'CLICKUP_TOKEN_MISSING');
  }
  if (!defaultListId) {
    throw new ClickUpServiceError('CLICKUP_NOVA_GESTAO_LIST_ID não configurado.', 500, 'CLICKUP_NOVA_GESTAO_LIST_ID_MISSING');
  }

  return { token, defaultListId: String(defaultListId).trim(), defaultPageLimit, cacheTtlSeconds };
}

// ---------------------------------------------------------------------------
// Resumo executivo (Camada 1 — rápido)
// ---------------------------------------------------------------------------

async function getResumoExecutivo(options = {}) {
  const startedAt = Date.now();
  const config = getConfig();

  const range = normalizeDateRange(options.dateFrom, options.dateTo);
  const pageLimit = toSafeInteger(options.pageLimit, config.defaultPageLimit, 1, HARD_PAGE_CAP);
  const includeComments = Boolean(options.includeComments);
  const targetListId = String(options.listId || config.defaultListId).trim();
  const targetListName = String(options.listName || DEFAULT_LIST_NAME).trim();

  const { tasks: allTasks, pagesFetched, cacheHit } = await fetchListTasks({
    config,
    listId: targetListId,
    pageLimit,
  });

  const deliveries = allTasks
    .filter(isDeliveryTask)
    .filter((task) => isTaskDoneWithinRange(task, range.startMs, range.endMs));

  const mappedDeliveries = includeComments
    ? await enrichDeliveriesWithComments(deliveries, config)
    : deliveries.map((task) => mapDelivery(task, null));

  const payload = buildDashboardPayload({
    listTasks: allTasks,
    deliveries: mappedDeliveries,
    range,
    meta: {
      source_endpoint: 'list_tasks',
      target_list_id: targetListId,
      target_list_name: targetListName,
      fetched_tasks: allTasks.length,
      filtered_list_tasks: allTasks.length,
      deliveries_in_period: deliveries.length,
      page_limit: pageLimit,
      pages_fetched: pagesFetched,
      include_comments: includeComments,
      cache_hit: cacheHit,
      cache_ttl_seconds: config.cacheTtlSeconds,
      duration_ms: Date.now() - startedAt,
    },
  });

  return payload;
}

// ---------------------------------------------------------------------------
// Busca paginada (com cache + para cedo)
// ---------------------------------------------------------------------------

async function fetchListTasks({ config, listId, pageLimit }) {
  const cacheKey = `${listId}|${pageLimit}`;
  const cached = getCache(listCache, cacheKey, config.cacheTtlSeconds);
  if (cached) {
    return { tasks: cached.tasks, pagesFetched: cached.pagesFetched, cacheHit: true };
  }

  const maxPages = Math.min(Math.max(1, pageLimit), HARD_PAGE_CAP);
  const tasks = [];
  let pagesFetched = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`${CLICKUP_API_BASE}/list/${encodeURIComponent(listId)}/task`);
    url.searchParams.set('archived', 'false');
    url.searchParams.set('include_closed', 'true');
    url.searchParams.set('subtasks', 'true');
    url.searchParams.set('page', String(page));

    const data = await clickupFetchJson(url.toString(), config.token);
    pagesFetched += 1;

    const pageTasks = Array.isArray(data.tasks) ? data.tasks : [];
    tasks.push(...pageTasks);

    // PARA CEDO: fim de lista, página vazia ou parcial (menos de 100)
    if (data.last_page === true || pageTasks.length === 0 || pageTasks.length < PAGE_SIZE) {
      break;
    }
  }

  setCache(listCache, cacheKey, { tasks, pagesFetched }, config.cacheTtlSeconds);
  return { tasks, pagesFetched, cacheHit: false };
}

// ---------------------------------------------------------------------------
// HTTP ClickUp (com timeout/abort)
// ---------------------------------------------------------------------------

async function clickupFetchJson(url, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: token, Accept: 'application/json' },
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new ClickUpServiceError('Token ClickUp sem permissão ou inválido.', 502, 'CLICKUP_AUTH_ERROR');
    }
    if (response.status === 429) {
      throw new ClickUpServiceError('Rate limit da API ClickUp atingido. Tente novamente em alguns minutos.', 429, 'CLICKUP_RATE_LIMIT');
    }
    if (!response.ok) {
      throw new ClickUpServiceError(`Erro ao consultar API ClickUp. Status ${response.status}.`, 502, 'CLICKUP_API_ERROR');
    }

    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new ClickUpServiceError('O ClickUp demorou demais para responder (timeout).', 504, 'CLICKUP_TIMEOUT');
    }
    if (error instanceof ClickUpServiceError) throw error;
    throw new ClickUpServiceError('Não foi possível conectar ao ClickUp.', 502, 'CLICKUP_NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Comentários sob demanda
// ---------------------------------------------------------------------------

async function fetchTaskComments(taskId, config) {
  if (!taskId) return [];

  const cached = getCache(commentCache, String(taskId), config.cacheTtlSeconds);
  if (cached) return cached.comments;

  const url = `${CLICKUP_API_BASE}/task/${encodeURIComponent(taskId)}/comment`;
  const data = await clickupFetchJson(url, config.token);
  const comments = Array.isArray(data.comments) ? data.comments : [];

  setCache(commentCache, String(taskId), { comments }, config.cacheTtlSeconds);
  return comments;
}

async function enrichDeliveriesWithComments(tasks, config) {
  // só enriquece as N entregas mais recentes; o resto vai sem comentário
  const ordered = [...tasks].sort(
    (a, b) => (getCompletionTimestamp(b) || 0) - (getCompletionTimestamp(a) || 0)
  );
  const head = ordered.slice(0, COMMENTS_MAX_TASKS);
  const tail = ordered.slice(COMMENTS_MAX_TASKS);

  const enrichedHead = await mapLimit(head, COMMENTS_CONCURRENCY, async (task) => {
    try {
      const comments = await fetchTaskComments(task.id, config);
      return mapDelivery(task, pickLastComment(comments));
    } catch {
      return mapDelivery(task, null);
    }
  });

  return [...enrichedHead, ...tail.map((task) => mapDelivery(task, null))];
}

/**
 * Comentários de uma única task (endpoint sob demanda /tarefas/:id/comentarios)
 */
async function getTaskComments(taskId) {
  const config = getConfig();
  if (!taskId) {
    throw new ClickUpServiceError('task_id é obrigatório.', 400, 'TASK_ID_REQUIRED');
  }
  const comments = await fetchTaskComments(taskId, config);
  const last = pickLastComment(comments);
  return {
    task_id: String(taskId),
    comentarios_count: comments.length,
    tem_comentario: comments.length > 0,
    ultimo_comentario_resumo: last ? extractCommentText(last).slice(0, 200) : null,
  };
}

// ---------------------------------------------------------------------------
// Montagem do payload (contrato compatível com o frontend)
// ---------------------------------------------------------------------------

function buildDashboardPayload({ listTasks, deliveries, range, meta }) {
  const now = Date.now();

  const openTasks = listTasks.filter((task) => !isDeliveryTask(task));
  const lateOpenTasks = openTasks.filter((task) => {
    const due = toNumberOrNull(task.due_date);
    return due !== null && due < now;
  });
  const noDueTasks = listTasks.filter((task) => task.due_date === null || task.due_date === undefined);
  const clientsWithDelivery = new Set(deliveries.map((d) => d.cliente).filter(Boolean));
  const commentedDeliveries = deliveries.filter((d) => hasRealComment(d.comentario));

  const withResponsible = listTasks.filter((t) => getAssigneeNames(t)[0] !== 'sem_responsavel').length;
  const withDue = listTasks.filter((t) => toNumberOrNull(t.due_date) !== null).length;

  return {
    periodo: { date_from: range.dateFrom, date_to: range.dateTo },
    resumo: {
      total: listTasks.length,
      concluidas: deliveries.length,
      abertas: openTasks.length,
      atrasadas_abertas: lateOpenTasks.length,
      sem_prazo: noDueTasks.length,
      clientes_atendidos: clientsWithDelivery.size,
      percentual_com_comentario: deliveries.length
        ? Math.round((commentedDeliveries.length / deliveries.length) * 100)
        : 0,
      percentual_com_responsavel: listTasks.length ? Math.round((withResponsible / listTasks.length) * 100) : 0,
      percentual_com_prazo: listTasks.length ? Math.round((withDue / listTasks.length) * 100) : 0,
    },
    por_pessoa: buildPeopleSummary({ listTasks, deliveries, now }),
    por_cliente: buildGroupedSummary({
      listTasks,
      deliveries,
      keyGetter: (item) => item.cliente || resolveClient(item) || 'sem_cliente',
      outputKey: 'cliente',
      now,
    }),
    por_canal: buildGroupedSummary({
      listTasks,
      deliveries,
      keyGetter: (item) => item.canal || resolveChannel(item) || 'sem_canal',
      outputKey: 'canal',
      now,
    }),
    alertas: buildAlerts({ listTasks, deliveries, now }),
    entregas: deliveries
      .slice()
      .sort((a, b) => new Date(b.data_conclusao).getTime() - new Date(a.data_conclusao).getTime()),
    meta,
  };
}

function buildPeopleSummary({ listTasks, deliveries, now }) {
  const map = new Map();

  for (const task of listTasks) {
    for (const person of getAssigneeNames(task)) {
      const item = getOrCreatePerson(map, person);
      item.total_tarefas += 1;
      if (!isDeliveryTask(task)) {
        item.abertas += 1;
        const due = toNumberOrNull(task.due_date);
        if (due !== null && due < now) item.atrasadas_abertas += 1;
      }
      if (task.due_date === null || task.due_date === undefined) item.sem_prazo += 1;
    }
  }

  for (const delivery of deliveries) {
    const people = delivery.responsaveis?.length ? delivery.responsaveis : ['sem_responsavel'];
    for (const person of people) {
      const item = getOrCreatePerson(map, person);
      item.concluidas += 1;
      if (hasRealComment(delivery.comentario)) item.com_comentario += 1;
      if (delivery.cliente) item._clientes.add(delivery.cliente);
    }
  }

  return Array.from(map.values())
    .map((item) => {
      const { _clientes, ...rest } = item;
      return {
        ...rest,
        clientes_atendidos: _clientes.size,
        sem_comentario: Math.max(0, rest.concluidas - rest.com_comentario),
        score_uso: calculateUsageScore(rest),
      };
    })
    .sort((a, b) => b.concluidas - a.concluidas || b.total_tarefas - a.total_tarefas);
}

function buildGroupedSummary({ listTasks, deliveries, keyGetter, outputKey, now }) {
  const map = new Map();
  const ensure = (key) => {
    if (!map.has(key)) {
      map.set(key, { [outputKey]: key, concluidas: 0, abertas: 0, atrasadas_abertas: 0, com_comentario: 0 });
    }
    return map.get(key);
  };

  for (const task of listTasks) {
    const item = ensure(keyGetter(task));
    if (!isDeliveryTask(task)) {
      item.abertas += 1;
      const due = toNumberOrNull(task.due_date);
      if (due !== null && due < now) item.atrasadas_abertas += 1;
    }
  }

  for (const delivery of deliveries) {
    const item = ensure(keyGetter(delivery));
    item.concluidas += 1;
    if (hasRealComment(delivery.comentario)) item.com_comentario += 1;
  }

  return Array.from(map.values())
    .map((r) => ({
      ...r,
      percentual_com_comentario: r.concluidas ? Math.round((r.com_comentario / r.concluidas) * 100) : 0,
    }))
    .sort((a, b) => b.concluidas - a.concluidas);
}

function buildAlerts({ listTasks, deliveries, now }) {
  const alertas = [];

  // por pessoa: atrasos
  const peopleLate = new Map();
  for (const task of listTasks) {
    if (isDeliveryTask(task)) continue;
    const due = toNumberOrNull(task.due_date);
    if (due === null || due >= now) continue;
    for (const p of getAssigneeNames(task)) {
      peopleLate.set(p, (peopleLate.get(p) || 0) + 1);
    }
  }
  Array.from(peopleLate.entries())
    .filter(([, n]) => n >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([nome, n]) => alertas.push({ tipo: 'atraso', nivel: 'warning', texto: `${nome} tem ${n} tarefas atrasadas abertas.` }));

  const semResp = listTasks.filter((t) => getAssigneeNames(t)[0] === 'sem_responsavel' && !isDeliveryTask(t)).length;
  if (semResp > 0) alertas.push({ tipo: 'sem_responsavel', nivel: 'warning', texto: `${semResp} tarefas abertas sem responsável.` });

  const semPrazo = listTasks.filter((t) => (t.due_date === null || t.due_date === undefined) && !isDeliveryTask(t)).length;
  if (semPrazo > 0) alertas.push({ tipo: 'sem_prazo', nivel: 'info', texto: `${semPrazo} tarefas abertas sem prazo.` });

  return alertas;
}

function getOrCreatePerson(map, person) {
  const key = person || 'sem_responsavel';
  if (!map.has(key)) {
    map.set(key, {
      responsavel: key,
      total_tarefas: 0,
      concluidas: 0,
      abertas: 0,
      atrasadas_abertas: 0,
      sem_prazo: 0,
      com_comentario: 0,
      score_uso: 0,
      _clientes: new Set(),
    });
  }
  return map.get(key);
}

/**
 * Score de uso correto do ClickUp (0–100), conforme fórmula do briefing:
 *   25% com responsável + 25% com prazo + 25% concluídas c/ comentário + 25% não atrasadas
 */
function calculateUsageScore(item) {
  const total = item.total_tarefas || 0;
  const comResp = total ? (total - 0) : 0; // responsável já implícito (a chave é a pessoa)
  const comRespRate = item.responsavel === 'sem_responsavel' ? 0 : 1;
  const comPrazoRate = total ? (total - item.sem_prazo) / total : 0;
  const comComentarioRate = item.concluidas ? item.com_comentario / item.concluidas : 0;
  const naoAtrasadaRate = total ? Math.max(0, total - item.atrasadas_abertas) / total : 0;

  return Math.round(comRespRate * 25 + comPrazoRate * 25 + comComentarioRate * 25 + naoAtrasadaRate * 25);
}

// ---------------------------------------------------------------------------
// Mapeamento de uma entrega (contrato consumido pelo frontend)
// ---------------------------------------------------------------------------

function mapDelivery(task, comment) {
  return {
    id: String(task.id || ''),
    data_conclusao: timestampToIso(getCompletionTimestamp(task) || task.date_updated),
    tarefa: task.name || '-',
    comentario: comment ? extractCommentText(comment) : 'Sem comentário',
    responsaveis: getAssigneeNames(task),
    criador: safeNested(task, ['creator', 'username']) || safeNested(task, ['creator', 'name']) || null,
    canal: resolveChannel(task),
    cliente: resolveClient(task),
    status_final: safeNested(task, ['status', 'status']) || 'sem_status',
    link: task.url || null,
  };
}

// ---------------------------------------------------------------------------
// Resolução de cliente e canal (corrige o "hidden")
// ---------------------------------------------------------------------------

const CLIENT_FIELD_NAMES = ['cliente', 'client', 'conta', 'account', 'loja', 'seller'];
const CHANNEL_FIELD_NAMES = ['canal', 'channel', 'midia', 'midia', 'plataforma'];

function readCustomField(task, candidateNames) {
  const fields = Array.isArray(task.custom_fields) ? task.custom_fields : [];
  for (const field of fields) {
    const name = normalizeText(field.name);
    if (!candidateNames.includes(name)) continue;

    const value = field.value;
    if (value === null || value === undefined || value === '') continue;

    const options = safeNested(field, ['type_config', 'options']);
    if (Array.isArray(options)) {
      const ids = Array.isArray(value) ? value : [value];
      const labels = ids
        .map((id) => {
          const opt = options.find((o) => o.id === id || o.orderindex === id);
          return opt ? (opt.name || opt.label) : null;
        })
        .filter(Boolean);
      if (labels.length) return labels.join(', ');
    }

    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return null;
}

function resolveClient(task) {
  // se já é uma delivery mapeada, respeita
  if (task && typeof task.cliente === 'string' && task.cliente && task.cliente !== 'sem_cliente') {
    return task.cliente;
  }
  const fromField = readCustomField(task, CLIENT_FIELD_NAMES);
  if (fromField) return fromField;

  const tags = Array.isArray(task.tags) ? task.tags : [];
  const tagNames = tags.map((t) => t.name).filter(Boolean);
  if (tagNames.length) return tagNames.join(', ');

  const folderName = safeNested(task, ['folder', 'name']);
  const folderHidden = safeNested(task, ['folder', 'hidden']);
  if (folderName && !folderHidden) return folderName;

  return 'sem_cliente';
}

function resolveChannel(task) {
  if (task && typeof task.canal === 'string' && task.canal && task.canal !== 'sem_canal') {
    return task.canal;
  }
  const fromField = readCustomField(task, CHANNEL_FIELD_NAMES);
  if (fromField) return fromField;
  return safeNested(task, ['list', 'name']) || DEFAULT_LIST_NAME;
}

// ---------------------------------------------------------------------------
// Regras de conclusão / datas
// ---------------------------------------------------------------------------

function isDeliveryTask(task) {
  return getCompletionTimestamp(task) !== null;
}

function isTaskDoneWithinRange(task, startMs, endMs) {
  const dateDone = getCompletionTimestamp(task);
  if (dateDone === null) return false;
  return dateDone >= startMs && dateDone <= endMs;
}

function getCompletionTimestamp(task) {
  return toNumberOrNull(task.date_done) || toNumberOrNull(task.date_closed);
}

function getAssigneeNames(task) {
  const assignees = Array.isArray(task.assignees) ? task.assignees : [];
  const names = assignees.map((a) => a.username || a.name).filter(Boolean);
  return names.length ? names : ['sem_responsavel'];
}

function pickLastComment(comments) {
  if (!Array.isArray(comments) || comments.length === 0) return null;
  return [...comments].sort((a, b) => (toNumberOrNull(b.date) || 0) - (toNumberOrNull(a.date) || 0))[0];
}

function extractCommentText(comment) {
  if (!comment) return 'Sem comentário';
  if (typeof comment.comment_text === 'string' && comment.comment_text.trim()) return comment.comment_text.trim();
  if (typeof comment.comment === 'string' && comment.comment.trim()) return comment.comment.trim();
  if (typeof comment.text_content === 'string' && comment.text_content.trim()) return comment.text_content.trim();
  if (Array.isArray(comment.comment)) {
    return comment.comment.map((p) => p.text || p.plain_text || '').filter(Boolean).join(' ').trim() || 'Sem comentário';
  }
  return 'Sem comentário';
}

function hasRealComment(value) {
  const text = String(value || '').trim();
  return text.length > 0 && text !== 'Sem comentário';
}

function normalizeDateRange(dateFrom, dateTo) {
  const now = new Date();
  // default: últimos 30 dias (briefing pede evitar default amplo demais)
  const defaultTo = now;
  const defaultFrom = new Date(now.getTime() - 30 * 86400000);

  const fromStr = dateFrom || formatDateYYYYMMDD(defaultFrom);
  const toStr = dateTo || formatDateYYYYMMDD(defaultTo);

  const start = new Date(`${fromStr}T00:00:00.000Z`);
  const end = new Date(`${toStr}T23:59:59.999Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ClickUpServiceError('Período inválido.', 400, 'INVALID_DATE_RANGE');
  }
  if (start.getTime() > end.getTime()) {
    throw new ClickUpServiceError('date_from não pode ser maior que date_to.', 400, 'INVALID_DATE_RANGE');
  }

  return { dateFrom: fromStr, dateTo: toStr, startMs: start.getTime(), endMs: end.getTime() };
}

// ---------------------------------------------------------------------------
// utils
// ---------------------------------------------------------------------------

function timestampToIso(value) {
  const n = toNumberOrNull(value);
  return n === null ? null : new Date(n).toISOString();
}

function formatDateYYYYMMDD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function safeNested(obj, path) {
  return path.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toSafeInteger(value, defaultValue, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.max(min, Math.min(max, n));
}

function normalizeText(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

async function mapLimit(items, limit, mapper) {
  const results = [];
  const executing = [];
  for (const item of items) {
    const p = Promise.resolve().then(() => mapper(item));
    results.push(p);
    const clean = () => {
      const i = executing.indexOf(p);
      if (i >= 0) executing.splice(i, 1);
    };
    p.then(clean, clean);
    executing.push(p);
    if (executing.length >= limit) await Promise.race(executing);
  }
  return Promise.all(results);
}

function getCache(map, key, ttlSeconds) {
  if (!ttlSeconds) return null;
  const item = map.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    map.delete(key);
    return null;
  }
  return item.value;
}

function setCache(map, key, value, ttlSeconds) {
  if (!ttlSeconds) return;
  map.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

function clearCache() {
  listCache.clear();
  commentCache.clear();
}

module.exports = {
  getResumoExecutivo,
  getTaskComments,
  clearCache,
  ClickUpServiceError,
};
