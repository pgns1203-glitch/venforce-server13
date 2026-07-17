const STORAGE_KEY = "vf-token";
const API_BASE = "https://venforce-server.onrender.com";

if (typeof window.initLayout === "function") {
  window.initLayout();
}

const ClickUpExecutivo = (() => {
  const state = {
    data: null,
    filteredDeliveries: [],
    commentsLoaded: false,
    slowTimer: null,
  };

  const els = {};

  function getToken() {
    return localStorage.getItem(STORAGE_KEY);
  }

  function init() {
    bindElements();
    setDefaultDates();
    bindEvents();
    loadData();
  }

  function bindElements() {
    els.dateFrom = document.getElementById('clickup-date-from');
    els.dateTo = document.getElementById('clickup-date-to');
    els.personFilter = document.getElementById('clickup-person-filter');
    els.clientFilter = document.getElementById('clickup-client-filter');
    els.channelFilter = document.getElementById('clickup-channel-filter');
    els.search = document.getElementById('clickup-search');

    els.refresh = document.getElementById('btn-clickup-refresh');
    els.export = document.getElementById('btn-clickup-export');
    els.comments = document.getElementById('btn-clickup-comments');
    els.alert = document.getElementById('clickup-alert');

    els.kpiConcluidas = document.getElementById('kpi-concluidas');
    els.kpiAbertas = document.getElementById('kpi-abertas');
    els.kpiAtrasadas = document.getElementById('kpi-atrasadas');
    els.kpiSemPrazo = document.getElementById('kpi-sem-prazo');
    els.kpiClientes = document.getElementById('kpi-clientes');
    els.kpiComentario = document.getElementById('kpi-comentario');
    els.kpiScore = document.getElementById('kpi-score');

    els.peopleBody = document.querySelector('#clickup-people-table tbody');
    els.deliveriesBody = document.querySelector('#clickup-deliveries-table tbody');
    els.clientRanking = document.getElementById('clickup-client-ranking');
    els.channelRanking = document.getElementById('clickup-channel-ranking');
    els.alertsBox = document.getElementById('clickup-alerts');
    els.tableCount = document.getElementById('clickup-table-count');
    els.meta = document.getElementById('clickup-meta');
  }

  function bindEvents() {
    els.refresh?.addEventListener('click', () => loadData());
    els.export?.addEventListener('click', exportCsv);
    els.comments?.addEventListener('click', () => loadData({ includeComments: true }));

    [els.personFilter, els.clientFilter, els.channelFilter, els.search]
      .forEach((input) => input?.addEventListener('input', applyFiltersAndRender));

    [els.dateFrom, els.dateTo].forEach((input) => {
      input?.addEventListener('change', () => loadData());
    });
  }

  // Default: últimos 30 dias (evita período amplo demais e carregamento pesado)
  function setDefaultDates() {
    const today = new Date();
    const from = new Date(today.getTime() - 30 * 86400000);
    els.dateFrom.value = toInputDate(from);
    els.dateTo.value = toInputDate(today);
  }

  async function loadData({ includeComments = false } = {}) {
    setLoading(true, includeComments);
    hideAlert();
    startSlowWarning();

    try {
      const token = getToken();
      if (!token) {
        window.location.href = 'index.html';
        return;
      }

      const params = new URLSearchParams({
        date_from: els.dateFrom.value,
        date_to: els.dateTo.value,
        include_comments: includeComments ? 'true' : 'false',
        page_limit: '15',
      });

      const response = await fetch(`${API_BASE}/api/clickup/executivo/resumo?${params.toString()}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });

      if (response.status === 401) {
        localStorage.removeItem(STORAGE_KEY);
        window.location.href = 'index.html';
        return;
      }
      if (response.status === 403) {
        showAlert('Você não tem permissão para acessar esta tela (apenas admin).');
        renderEmpty();
        return;
      }

      const payload = await response.json();
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `Erro HTTP ${response.status}`);
      }

      state.data = payload;
      state.commentsLoaded = Boolean(payload.meta && payload.meta.include_comments);
      hydrateFilters(payload);
      applyFiltersAndRender();
      showMetaWarning(payload.meta);
      renderMeta(payload.meta);
      updateCommentsButton();
    } catch (error) {
      showAlert(`Erro ao carregar ClickUp: ${error.message || 'Erro desconhecido.'}`);
      renderEmpty();
    } finally {
      stopSlowWarning();
      setLoading(false, includeComments);
    }
  }

  function hydrateFilters(payload) {
    const entregas = Array.isArray(payload.entregas) ? payload.entregas : [];
    const people = Array.isArray(payload.por_pessoa) ? payload.por_pessoa : [];
    const clients = Array.isArray(payload.por_cliente) ? payload.por_cliente : [];
    const channels = Array.isArray(payload.por_canal) ? payload.por_canal : [];

    fillSelect(els.personFilter,
      unique([...entregas.flatMap((i) => i.responsaveis || []), ...people.map((i) => i.responsavel)]), 'Todos');
    fillSelect(els.clientFilter,
      unique([...entregas.map((i) => i.cliente || 'sem_cliente'), ...clients.map((i) => i.cliente)]), 'Todos');
    fillSelect(els.channelFilter,
      unique([...entregas.map((i) => i.canal || 'sem_canal'), ...channels.map((i) => i.canal)]), 'Todos');
  }

  function showMetaWarning(meta = {}) {
    const fetched = Number(meta.fetched_tasks || 0);
    const deliveries = Number(meta.deliveries_in_period || 0);

    if (fetched === 0) {
      showAlert('Nenhuma tarefa encontrada para a lista configurada. Verifique CLICKUP_NOVA_GESTAO_LIST_ID.');
      return;
    }
    if (deliveries === 0) {
      showAlert('Existem tarefas na lista, mas nenhuma entrega concluída no período filtrado.');
      return;
    }
    hideAlert();
  }

  function applyFiltersAndRender() {
    if (!state.data) return;

    const search = normalize(els.search.value);
    const person = els.personFilter.value;
    const client = els.clientFilter.value;
    const channel = els.channelFilter.value;

    const entregas = Array.isArray(state.data.entregas) ? state.data.entregas : [];

    state.filteredDeliveries = entregas.filter((item) => {
      const text = normalize([
        item.tarefa, item.comentario, item.cliente, item.canal, item.status_final,
        ...(item.responsaveis || []),
      ].join(' '));

      const matchesSearch = !search || text.includes(search);
      const matchesPerson = !person || (item.responsaveis || []).includes(person);
      const matchesClient = !client || item.cliente === client;
      const matchesChannel = !channel || item.canal === channel;
      return matchesSearch && matchesPerson && matchesClient && matchesChannel;
    });

    const summary = buildFilteredSummary(state.data, state.filteredDeliveries);

    renderKpis(summary);
    renderPeople(summary.por_pessoa);
    renderRanking(els.clientRanking, countBy(state.filteredDeliveries, 'cliente'), 'entregas');
    renderRanking(els.channelRanking, countBy(state.filteredDeliveries, 'canal'), 'entregas');
    renderAlerts(state.data.alertas);
    renderDeliveries(state.filteredDeliveries);
  }

  function buildFilteredSummary(payload, deliveries) {
    const resumo = payload.resumo || {};
    const clients = new Set(deliveries.map((i) => i.cliente).filter(Boolean));
    const withComments = deliveries.filter((i) => hasComment(i.comentario)).length;

    return {
      resumo: {
        concluidas: deliveries.length,
        abertas: resumo.abertas || 0,
        atrasadas_abertas: resumo.atrasadas_abertas || 0,
        sem_prazo: resumo.sem_prazo || 0,
        clientes_atendidos: clients.size,
        percentual_com_comentario: deliveries.length ? Math.round((withComments / deliveries.length) * 100) : 0,
        score_uso: resumo.score_uso != null ? resumo.score_uso : avgScore(payload.por_pessoa),
      },
      por_pessoa: buildPeopleFromDeliveries(deliveries, payload.por_pessoa || []),
    };
  }

  function avgScore(people) {
    if (!people || !people.length) return 0;
    return Math.round(people.reduce((a, p) => a + (p.score_uso || 0), 0) / people.length);
  }

  function buildPeopleFromDeliveries(deliveries, backendPeople) {
    const map = new Map();
    const backendMap = new Map(backendPeople.map((i) => [i.responsavel, i]));

    backendPeople.forEach((i) => {
      if (!i.responsavel) return;
      map.set(i.responsavel, {
        responsavel: i.responsavel,
        total_tarefas: i.total_tarefas || 0,
        concluidas: 0,
        abertas: i.abertas || 0,
        atrasadas_abertas: i.atrasadas_abertas || 0,
        sem_prazo: i.sem_prazo || 0,
        com_comentario: 0,
        score_uso: i.score_uso || 0,
      });
    });

    for (const delivery of deliveries) {
      const people = delivery.responsaveis?.length ? delivery.responsaveis : ['sem_responsavel'];
      for (const person of people) {
        if (!map.has(person)) {
          const fb = backendMap.get(person) || {};
          map.set(person, {
            responsavel: person,
            total_tarefas: fb.total_tarefas || 0,
            concluidas: 0,
            abertas: fb.abertas || 0,
            atrasadas_abertas: fb.atrasadas_abertas || 0,
            sem_prazo: fb.sem_prazo || 0,
            com_comentario: 0,
            score_uso: fb.score_uso || 0,
          });
        }
        const item = map.get(person);
        item.concluidas += 1;
        if (hasComment(delivery.comentario)) item.com_comentario += 1;
      }
    }

    return [...map.values()].sort((a, b) => b.concluidas - a.concluidas || b.total_tarefas - a.total_tarefas);
  }

  function renderKpis(summary) {
    const r = summary.resumo || {};
    els.kpiConcluidas.textContent = formatNumber(r.concluidas);
    els.kpiAbertas.textContent = formatNumber(r.abertas);
    els.kpiAtrasadas.textContent = formatNumber(r.atrasadas_abertas);
    els.kpiSemPrazo.textContent = formatNumber(r.sem_prazo);
    els.kpiClientes.textContent = formatNumber(r.clientes_atendidos);
    els.kpiComentario.textContent = `${r.percentual_com_comentario || 0}%`;
    if (els.kpiScore) els.kpiScore.textContent = formatNumber(r.score_uso);
  }

  function renderPeople(items) {
    if (!items.length) {
      els.peopleBody.innerHTML = `<tr><td class="vf-clickup-empty" colspan="8">Nenhum responsável encontrado.</td></tr>`;
      return;
    }
    els.peopleBody.innerHTML = items.map((item) => `
      <tr>
        <td><strong>${escapeHtml(item.responsavel)}</strong></td>
        <td>${formatNumber(item.total_tarefas)}</td>
        <td>${formatNumber(item.concluidas)}</td>
        <td>${formatNumber(item.abertas)}</td>
        <td>${formatNumber(item.atrasadas_abertas)}</td>
        <td>${formatNumber(item.sem_prazo)}</td>
        <td>${formatNumber(item.com_comentario)}</td>
        <td>${scorePill(item.score_uso)}</td>
      </tr>`).join('');
  }

  function renderDeliveries(items) {
    els.tableCount.textContent = `${formatNumber(items.length)} registros`;
    if (!items.length) {
      els.deliveriesBody.innerHTML = `<tr><td class="vf-clickup-empty" colspan="8">Nenhuma entrega encontrada.</td></tr>`;
      return;
    }
    els.deliveriesBody.innerHTML = items.map((item) => `
      <tr>
        <td>${formatDate(item.data_conclusao)}</td>
        <td>${escapeHtml(item.tarefa || '-')}</td>
        <td>${escapeHtml(item.comentario || 'Sem comentário')}</td>
        <td>${escapeHtml((item.responsaveis || []).join(', ') || 'sem_responsavel')}</td>
        <td>${escapeHtml(item.canal || '-')}</td>
        <td>${escapeHtml(item.cliente || '-')}</td>
        <td><span class="vf-clickup-pill">${escapeHtml(item.status_final || '-')}</span></td>
        <td>${item.link ? `<a class="vf-clickup-link" href="${escapeAttribute(item.link)}" target="_blank" rel="noopener">Abrir</a>` : '-'}</td>
      </tr>`).join('');
  }

  function renderRanking(container, data, label) {
    const rows = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 8);
    if (!rows.length) {
      container.innerHTML = `<div class="vf-clickup-empty">Sem dados.</div>`;
      return;
    }
    container.innerHTML = rows.map(([name, value], index) => `
      <div class="vf-clickup-ranking-row">
        <div>
          <strong>${index + 1}. ${escapeHtml(name)}</strong>
          <span>${escapeHtml(label)}</span>
        </div>
        <div class="vf-clickup-ranking-value">${formatNumber(value)}</div>
      </div>`).join('');
  }

  function renderAlerts(alertas) {
    if (!els.alertsBox) return;
    const list = Array.isArray(alertas) ? alertas : [];
    if (!list.length) {
      els.alertsBox.innerHTML = `<div class="vf-clickup-empty">Nenhum alerta no período. 👌</div>`;
      return;
    }
    els.alertsBox.innerHTML = list.map((a) => `
      <div class="vf-clickup-alert-item is-${escapeAttribute(a.nivel || 'info')}">
        ${escapeHtml(a.texto || '')}
      </div>`).join('');
  }

  function renderMeta(meta = {}) {
    if (!els.meta) return;
    const parts = [];
    if (meta.fetched_tasks != null) parts.push(`${formatNumber(meta.fetched_tasks)} tarefas`);
    if (meta.pages_fetched != null) parts.push(`${meta.pages_fetched} página(s)`);
    if (meta.duration_ms != null) parts.push(`${meta.duration_ms} ms`);
    if (meta.cache_hit) parts.push('cache');
    els.meta.textContent = parts.join(' · ');
  }

  function renderEmpty() {
    state.filteredDeliveries = [];
    renderKpis({ resumo: {} });
    if (els.tableCount) els.tableCount.textContent = '0 registros';
    els.peopleBody.innerHTML = `<tr><td class="vf-clickup-empty" colspan="8">Sem dados carregados.</td></tr>`;
    els.deliveriesBody.innerHTML = `<tr><td class="vf-clickup-empty" colspan="8">Sem dados carregados.</td></tr>`;
    els.clientRanking.innerHTML = `<div class="vf-clickup-empty">Sem dados.</div>`;
    els.channelRanking.innerHTML = `<div class="vf-clickup-empty">Sem dados.</div>`;
    if (els.alertsBox) els.alertsBox.innerHTML = `<div class="vf-clickup-empty">Sem dados.</div>`;
  }

  function exportCsv() {
    const headers = ['data_conclusao', 'tarefa', 'comentario', 'responsaveis', 'canal', 'cliente', 'status', 'link'];
    const rows = state.filteredDeliveries.map((item) => [
      formatDate(item.data_conclusao),
      item.tarefa || '',
      item.comentario || '',
      (item.responsaveis || []).join(', '),
      item.canal || '',
      item.cliente || '',
      item.status_final || '',
      item.link || '',
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';'))
      .join('\n');

    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gestao_clickup_${els.dateFrom.value}_${els.dateTo.value}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function fillSelect(select, values, label) {
    const current = select.value;
    select.innerHTML = `<option value="">${label}</option>`;
    values.forEach((value) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
    if ([...select.options].some((o) => o.value === current)) select.value = current;
  }

  function updateCommentsButton() {
    if (!els.comments) return;
    els.comments.textContent = state.commentsLoaded ? 'Atualizar comentários' : 'Carregar comentários';
  }

  // --- loading + aviso de demora ---
  function setLoading(isLoading, isComments) {
    const btn = isComments ? els.comments : els.refresh;
    if (btn) {
      btn.disabled = isLoading;
      btn.dataset.label = btn.dataset.label || btn.textContent;
      btn.textContent = isLoading ? 'Carregando...' : btn.dataset.label;
    }
    if (els.refresh && els.refresh !== btn) els.refresh.disabled = isLoading;
  }

  function startSlowWarning() {
    stopSlowWarning();
    state.slowTimer = setTimeout(() => {
      showAlert('Ainda carregando dados do ClickUp... isso pode levar alguns segundos na primeira vez.');
    }, 6000);
  }

  function stopSlowWarning() {
    if (state.slowTimer) {
      clearTimeout(state.slowTimer);
      state.slowTimer = null;
    }
  }

  function showAlert(message) {
    els.alert.hidden = false;
    els.alert.textContent = message;
  }
  function hideAlert() {
    els.alert.hidden = true;
    els.alert.textContent = '';
  }

  // --- utils ---
  function hasComment(value) {
    const text = String(value || '').trim();
    return text && text !== 'Sem comentário';
  }
  function unique(values) {
    return [...new Set(values.filter(Boolean).map(String))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }
  function countBy(items, key) {
    return items.reduce((acc, item) => {
      const value = item[key] || `sem_${key}`;
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});
  }
  function scorePill(value) {
    const n = Number(value || 0);
    const klass = n >= 80 ? '' : n >= 60 ? 'mid' : 'low';
    return `<span class="vf-clickup-score ${klass}">${n}</span>`;
  }
  function normalize(value) {
    return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function formatNumber(value) {
    return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
  }
  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
  }
  function toInputDate(date) {
    return date.toISOString().slice(0, 10);
  }
  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
  function escapeAttribute(value) {
    return escapeHtml(value).replaceAll('`', '&#096;');
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', ClickUpExecutivo.init);
