/* ================================================================
   diagnostico-inicial.js — VenForce · Diagnóstico Inicial (Fundação V2)
   ----------------------------------------------------------------
   Check-up de entrada do cliente em Mercado Livre e Shopee. V1:
   100% preenchimento manual (não há API Shopee; ML não é automatizado
   nesta tela). Diagnóstico é gerado por um motor determinístico no
   backend (sem IA externa) e pode ser editado antes de concluir.

   Fonte da verdade: backend. Autosave é debounced (~1.1s) e também
   disparado ao trocar de seção/marketplace e antes de fechar a página.
   ================================================================ */

(function () {
  "use strict";

  const STORAGE_KEY = "vf-token";
  const API_BASE = "https://venforce-server.onrender.com";
  const DIAG_API = "/operacao/diagnosticos-iniciais";
  const LAST_CLIENTE_KEY = "vf-diag-last-cliente";
  const reportApi = window.VF_DIAGNOSTIC_REPORT;
  const diagnosticSchema = window.VF_DIAGNOSTIC_SCHEMA;

  function getToken() {
    const t = localStorage.getItem(STORAGE_KEY);
    if (!t) { window.location.replace("index.html"); return null; }
    return t;
  }

  function getUserSafe() {
    try { return JSON.parse(localStorage.getItem("vf-user") || "{}") || {}; }
    catch { return {}; }
  }

  /* ── HTTP ─────────────────────────────────────────────────────── */

  async function apiRequest(method, path, body) {
    const token = getToken();
    if (!token) return { ok: false, status: 0, error: "Sessão expirada." };
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        return { ok: false, status: res.status, data, error: data?.erro || `HTTP ${res.status}` };
      }
      return { ok: true, status: res.status, data };
    } catch (err) {
      return { ok: false, status: 0, error: err?.message || "Falha de rede" };
    }
  }
  const apiGet = (path) => apiRequest("GET", path);
  const apiPost = (path, body) => apiRequest("POST", path, body ?? {});
  const apiPatch = (path, body) => apiRequest("PATCH", path, body ?? {});

  /* ── Helpers de formato / caminho ─────────────────────────────── */

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function getPath(obj, path) {
    return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
  }

  function setPath(obj, path, value) {
    const keys = path.split(".");
    let node = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (typeof node[k] !== "object" || node[k] === null || Array.isArray(node[k])) node[k] = {};
      node = node[k];
    }
    node[keys[keys.length - 1]] = value;
  }

  function textToArr(text) {
    return String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  }
  function arrToText(arr) {
    return Array.isArray(arr) ? arr.join("\n") : "";
  }

  function isoToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function formatData(s) {
    if (!s) return "—";
    const d = new Date(String(s).length === 10 ? s + "T00:00:00" : s);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
  }
  function formatDataHora(s) {
    if (!s) return "—";
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function formatHora(d) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  /* ── Estado ───────────────────────────────────────────────────── */

  const state = {
    clientes: [],
    clienteId: null,
    clienteNome: "",
    marketplaceAtivo: "meli",
    secaoAtivaId: null,
    diagnosticos: { meli: null, shopee: null },
    rascunhos: { meli: null, shopee: null },
    dirty: { meli: false, shopee: false },
    versions: { meli: 0, shopee: 0 },
    historico: { meli: [], shopee: [] },
    saving: false,
  };

  let autosaveTimer = null;
  const saveInFlight = { meli: null, shopee: null };

  function getDiag() { return state.diagnosticos[state.marketplaceAtivo]; }
  function getRespostas() {
    const diag = getDiag();
    if (!diag) return {};
    if (!diag.respostas_json) diag.respostas_json = {};
    return diag.respostas_json;
  }
  function currentSecoes() {
    return state.marketplaceAtivo === "shopee" ? SECOES_SHOPEE : SECOES_ML;
  }

  /* ── Feedback / status ────────────────────────────────────────── */

  function showFeedback(msg, tone) {
    const el = document.getElementById("diag-feedback");
    if (!el) return;
    if (!msg) { el.hidden = true; el.innerHTML = ""; return; }
    el.className = `vf-banner${tone ? " is-" + tone : ""}`;
    el.innerHTML = `<div class="vf-banner__content"><p class="vf-banner__description">${esc(msg)}</p></div>`;
    el.hidden = false;
  }

  function updateLastSavedLabel(text) {
    const a = document.getElementById("diag-last-saved");
    const b = document.getElementById("diag-kpi-salvamento");
    if (a) a.textContent = text;
    if (b) b.textContent = text;
  }

  function markDirty() {
    state.dirty[state.marketplaceAtivo] = true;
    state.versions[state.marketplaceAtivo] += 1;
    updateLastSavedLabel("Alterações não salvas…");
  }

  function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => { flushAutosave(); }, 1100);
  }

  async function flushAutosave({ force = false } = {}) {
    if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
    const mkt = state.marketplaceAtivo;
    if (saveInFlight[mkt]) await saveInFlight[mkt];
    const diag = state.diagnosticos[mkt];
    if (!diag || diag.status === "concluido") return true;
    if (!force && !state.dirty[mkt]) return true;

    updateLastSavedLabel("Salvando…");
    state.saving = true;
    const saveVersion = state.versions[mkt];
    const body = { respostasJson: diag.respostas_json || {} };
    // Data vazia não é enviada: evita rejeitar o autosave inteiro (respostas
    // inclusas) por causa de uma data momentaneamente em branco no input.
    if (diag.data_diagnostico) body.dataDiagnostico = diag.data_diagnostico;
    if (diag.diagnostico_revisado_json) body.diagnosticoRevisadoJson = diag.diagnostico_revisado_json;

    saveInFlight[mkt] = apiPatch(`${DIAG_API}/${diag.id}`, body);
    const result = await saveInFlight[mkt];
    saveInFlight[mkt] = null;
    state.saving = false;

    if (result.ok) {
      const updated = result.data.diagnostico;
      diag.completude = updated.completude;
      diag.completude_detalhes = updated.completude_detalhes;
      diag.updated_at = updated.updated_at;
      diag.status = updated.status;
      state.rascunhos[mkt] = diag;
      const changedWhileSaving = state.versions[mkt] !== saveVersion;
      state.dirty[mkt] = changedWhileSaving;
      updateLastSavedLabel(changedWhileSaving ? "Salvando alterações mais recentes…" : `Salvo às ${formatHora(new Date())}`);
      if (changedWhileSaving && mkt === state.marketplaceAtivo) scheduleAutosave();
      if (mkt === state.marketplaceAtivo) renderResumo();
      return true;
    } else {
      updateLastSavedLabel("Erro ao salvar — verifique a conexão.");
      showFeedback(`Não foi possível salvar: ${result.error || "erro desconhecido"}`, "danger");
      return false;
    }
  }

  /* ── Construtores de campo (HTML) ────────────────────────────── */

  function fieldWrap(label, inputHtml, hint) {
    return `<label class="vf-field">
      <span class="vf-field__label">${esc(label)}</span>
      ${inputHtml}
      ${hint ? `<span class="vf-field__hint">${esc(hint)}</span>` : ""}
    </label>`;
  }

  function inputText(path, value, { placeholder = "", type = "text" } = {}) {
    return `<input class="vf-input" type="${type}" data-field="${path}" data-kind="text" value="${esc(value ?? "")}" placeholder="${esc(placeholder)}" autocomplete="off">`;
  }

  function inputNumber(path, value, { suffix, prefix } = {}) {
    const inp = `<input class="vf-input" type="number" data-field="${path}" data-kind="number" value="${value === null || value === undefined ? "" : esc(value)}" min="0" step="any">`;
    if (suffix || prefix) {
      return `<div class="vf-input-group">${prefix ? `<span class="vf-input-prefix">${esc(prefix)}</span>` : ""}${inp}${suffix ? `<span class="vf-input-suffix">${esc(suffix)}</span>` : ""}</div>`;
    }
    return inp;
  }

  function inputTextarea(path, value, { rows = 3, placeholder = "" } = {}) {
    return `<textarea class="vf-textarea" data-field="${path}" data-kind="text" rows="${rows}" placeholder="${esc(placeholder)}">${esc(value ?? "")}</textarea>`;
  }

  function selectField(path, value, options) {
    const opts = ['<option value="">Selecione…</option>']
      .concat(options.map(([v, l]) => `<option value="${v}" ${value === v ? "selected" : ""}>${esc(l)}</option>`))
      .join("");
    return `<select class="vf-select" data-field="${path}" data-kind="text">${opts}</select>`;
  }

  function tristateControl(path, value) {
    const opts = [["sim", "Sim"], ["nao", "Não"], ["nao_avaliado", "N/A"]];
    return `<div class="vf-segmented vf-diag-tristate" data-field="${path}" data-kind="tristate">
      ${opts.map(([v, l]) => `<button type="button" class="vf-segmented__item${value === v ? " is-active" : ""}" data-value="${v}">${l}</button>`).join("")}
    </div>`;
  }

  function tristateRow(label, path, value) {
    return `<div class="vf-diag-tristate-row">
      <span class="vf-diag-tristate-label">${esc(label)}</span>
      ${tristateControl(path, value)}
    </div>`;
  }

  function checkboxField(label, path, checked) {
    return `<label class="vf-check"><input type="checkbox" data-field="${path}" data-kind="checkbox" ${checked ? "checked" : ""}><span>${esc(label)}</span></label>`;
  }

  function sectionCard(title, caminho, hint, body) {
    return `<div class="vf-diag-section">
      <div class="vf-diag-section__header">
        <h2 class="vf-diag-section__title">${esc(title)}</h2>
        ${hint ? `<p class="vf-diag-section__hint">${esc(hint)}</p>` : ""}
        ${caminho ? `<span class="vf-diag-section__caminho">${esc(caminho)}</span>` : ""}
      </div>
      ${body}
    </div>`;
  }

  function gateBlock(active, title, body, hintWhenOff) {
    if (!active) {
      return `<div class="vf-diag-subgroup"><div class="vf-diag-subgroup__title">${esc(title)}</div><p class="vf-field__hint">${esc(hintWhenOff)}</p></div>`;
    }
    return `<div class="vf-diag-subgroup"><div class="vf-diag-subgroup__title">${esc(title)}</div>${body}</div>`;
  }

  function tableEditor(path, rows, columns, { maxRows = 12, addLabel = "Adicionar linha" } = {}) {
    const list = Array.isArray(rows) ? rows : [];
    const head = columns.map((c) => `<th${c.num ? ' class="num"' : ""}>${esc(c.label)}</th>`).join("") + "<th></th>";
    const body = list.map((row, idx) => {
      const cells = columns.map((c) => {
        const val = row ? row[c.key] : "";
        const isNum = !!c.num;
        return `<td${isNum ? ' class="num"' : ""}><input type="${isNum ? "number" : "text"}" data-table="${path}" data-row="${idx}" data-col="${c.key}" value="${esc(val ?? "")}"${isNum ? ' step="any" min="0"' : ""}></td>`;
      }).join("");
      return `<tr>${cells}<td><button type="button" class="vf-diag-table__remove" data-table-remove="${path}" data-row="${idx}" aria-label="Remover linha">✕</button></td></tr>`;
    }).join("");

    return `
      <div class="vf-diag-table-toolbar">
        <span class="vf-field__hint">${list.length}/${maxRows} linhas</span>
        <button type="button" class="vf-btn vf-btn--secondary vf-btn--sm" data-table-add="${path}" data-max="${maxRows}">${esc(addLabel)}</button>
      </div>
      <div class="vf-table-wrap">
        <table class="vf-table vf-diag-table">
          <thead><tr>${head}</tr></thead>
          <tbody>${body || `<tr><td colspan="${columns.length + 1}" class="vf-table__empty">Nenhuma linha adicionada ainda.</td></tr>`}</tbody>
        </table>
      </div>`;
  }

  /* ── Seções: Identificação / Curva ABC (compartilhadas) ─────── */

  function secIdentificacao(ctx) {
    const body = `<div class="vf-diag-field-grid">
      ${fieldWrap("Nome da loja/conta (opcional)", inputText("identificacao.nomeLoja", getPath(ctx.respostas, "identificacao.nomeLoja"), { placeholder: "Preencha se o nome de exibição na loja for diferente do cliente cadastrado" }))}
    </div>`;
    return sectionCard("Identificação", "", "Consultoria: Assessoria Venforce. Cliente, responsável e data são definidos na barra superior.", body);
  }

  function secCurvaAbc(ctx) {
    const v = (p) => getPath(ctx.respostas, p);
    const body = `
      <div class="vf-diag-field-grid">
        ${fieldWrap("Status", selectField("curvaAbc.status", v("curvaAbc.status"), [["nao_realizada", "Não realizada"], ["em_andamento", "Em andamento"], ["concluida", "Concluída"]]))}
        ${fieldWrap("Origem", selectField("curvaAbc.origem", v("curvaAbc.origem"), [["relatorio_existente", "Relatório existente"], ["planilha_externa", "Planilha externa"], ["analise_manual", "Análise manual"]]))}
        ${fieldWrap("Referência / ID do relatório", inputText("curvaAbc.referencia", v("curvaAbc.referencia")))}
        ${fieldWrap("Data da análise", inputText("curvaAbc.dataAnalise", v("curvaAbc.dataAnalise"), { type: "date" }))}
      </div>
      <div class="vf-diag-field-grid">
        ${fieldWrap("Observações", inputTextarea("curvaAbc.observacoes", v("curvaAbc.observacoes"), { rows: 3 }))}
        ${fieldWrap("Principais produtos da Curva A", inputTextarea("curvaAbc.produtosCurvaA", v("curvaAbc.produtosCurvaA"), { rows: 3 }))}
        ${fieldWrap("Produtos que exigem atenção", inputTextarea("curvaAbc.produtosAtencao", v("curvaAbc.produtosAtencao"), { rows: 3 }))}
      </div>`;
    return sectionCard("Curva ABC", "", "Sem vínculo automático nesta versão — preencha a referência manualmente.", body);
  }

  /* ── Seções: Diagnóstico e plano de ação (compartilhada) ─────── */

  function revField(label, key, value, { rows = 3 } = {}) {
    return fieldWrap(label, `<textarea class="vf-textarea" data-revfield="${key}" data-revkind="text" rows="${rows}">${esc(value ?? "")}</textarea>`);
  }
  function revListField(label, key, arr) {
    return fieldWrap(label, `<textarea class="vf-textarea" data-revfield="${key}" data-revkind="list" rows="4">${esc(arrToText(arr))}</textarea>`, "Um item por linha.");
  }

  function missingItemLabel(item) {
    if (item && typeof item === "object") {
      return `${item.secao || item.sectionTitle ? `${item.secao || item.sectionTitle}: ` : ""}${item.label || item.mensagem || "Informação pendente"}`;
    }
    return String(item || "Informação pendente");
  }

  function renderDiagnosticoGeradoEditor(gerado, detalhes) {
    const ausentes = Array.isArray(detalhes?.camposPendentes)
      ? detalhes.camposPendentes
      : (Array.isArray(gerado.informacoesAusentes) ? gerado.informacoesAusentes : []);
    return `<div class="vf-diag-gerado-lista">
      <div class="vf-cluster vf-cluster--between">
        <span class="vf-tag">Completude: ${esc(String(gerado.completude ?? 0))}%</span>
        <span class="vf-field__hint">Gerado em ${gerado.geradoEm ? formatDataHora(gerado.geradoEm) : "—"} por ${esc(gerado.geradoPor || "—")}</span>
      </div>
      ${revField("Resumo executivo", "resumoExecutivo", gerado.resumoExecutivo, { rows: 2 })}
      ${revField("Situação atual", "situacaoAtual", gerado.situacaoAtual, { rows: 2 })}
      ${revListField("Pontos positivos", "pontosPositivos", gerado.pontosPositivos)}
      ${revListField("Pontos negativos", "pontosNegativos", gerado.pontosNegativos)}
      ${revListField("Riscos e urgências", "riscosUrgencias", gerado.riscosUrgencias)}
      ${revListField("Prioridades da primeira semana", "prioridadesPrimeiraSemana", gerado.prioridadesPrimeiraSemana)}
      ${revListField("Plano de 30 dias", "plano30Dias", gerado.plano30Dias)}
      ${revListField("Ações de médio prazo", "acoesMedioPrazo", gerado.acoesMedioPrazo)}
      ${revField("Conclusão do analista", "conclusaoAnalista", gerado.conclusaoAnalista, { rows: 3 })}
      <div class="vf-diag-subgroup">
        <div class="vf-diag-subgroup__title">Informações ainda não avaliadas ou não informadas (${ausentes.length})</div>
        ${ausentes.length ? `<ul class="vf-diag-ausentes">${ausentes.map((a) => `<li>${esc(missingItemLabel(a))}</li>`).join("")}</ul>` : '<p class="vf-field__hint">Nenhuma pendência identificada.</p>'}
      </div>
    </div>`;
  }

  function renderHistoricoBlock(mkt) {
    const lista = state.historico[mkt] || [];
    if (!lista.length) return "";
    return `<div class="vf-diag-section">
      <div class="vf-diag-section__header">
        <h2 class="vf-diag-section__title">Histórico de diagnósticos concluídos</h2>
      </div>
      <div class="vf-table-wrap">
        <table class="vf-table">
          <thead><tr><th>Data do diagnóstico</th><th>Responsável</th><th>Concluído em</th><th class="num">Completude</th><th></th></tr></thead>
          <tbody>
            ${lista.map((d) => `<tr><td>${esc(formatData(d.data_diagnostico))}</td><td>${esc(d.responsavel_nome || "—")}</td><td>${esc(formatDataHora(d.completed_at))}</td><td class="num">${esc(String(d.completude ?? 0))}%</td><td><button type="button" class="vf-btn vf-btn--ghost vf-btn--sm" data-open-diagnostic="${d.id}">Abrir</button></td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  }

  function secDiagnosticoPanel(ctx) {
    const { respostas, diagnostico } = ctx;
    const v = (p) => getPath(respostas, p);
    const manualBody = `<div class="vf-diag-field-grid">
      ${fieldWrap("Quais estratégias você utilizaria para essa conta?", inputTextarea("diagnosticoManual.estrategias", v("diagnosticoManual.estrategias"), { rows: 3 }))}
      ${fieldWrap("Pontos positivos da conta (um por linha)", inputTextarea("diagnosticoManual.pontosPositivos", v("diagnosticoManual.pontosPositivos"), { rows: 3 }))}
      ${fieldWrap("Pontos negativos da conta (um por linha)", inputTextarea("diagnosticoManual.pontosNegativos", v("diagnosticoManual.pontosNegativos"), { rows: 3 }))}
      ${fieldWrap("Prioridades / urgências (um por linha)", inputTextarea("diagnosticoManual.prioridadesUrgencias", v("diagnosticoManual.prioridadesUrgencias"), { rows: 3 }))}
      ${fieldWrap("Plano de ação — tópicos e justificativa (um por linha)", inputTextarea("diagnosticoManual.planoAcao", v("diagnosticoManual.planoAcao"), { rows: 4 }))}
    </div>`;

    const gerado = diagnostico.diagnostico_revisado_json || diagnostico.diagnostico_gerado_json;
    const geradoBody = gerado
      ? renderDiagnosticoGeradoEditor(gerado, diagnostico.completude_detalhes)
      : `<p class="vf-field__hint">Clique em "Gerar diagnóstico" no topo da página para criar a primeira versão automática a partir das respostas preenchidas.</p>`;

    return `
      <div class="vf-diag-section">
        <div class="vf-diag-section__header">
          <h2 class="vf-diag-section__title">Diagnóstico e plano de ação</h2>
          <p class="vf-diag-section__hint">Redija os pontos observados durante o check-up. Este texto alimenta a geração automática do diagnóstico abaixo.</p>
        </div>
        ${manualBody}
      </div>
      <div class="vf-diag-section">
        <div class="vf-diag-section__header">
          <h2 class="vf-diag-section__title">Diagnóstico gerado</h2>
          <p class="vf-diag-section__hint">Gerado automaticamente a partir das respostas. Edite livremente antes de concluir.</p>
        </div>
        ${geradoBody}
      </div>
      ${renderHistoricoBlock(ctx.marketplace)}`;
  }

  /* ── Seções — Mercado Livre ───────────────────────────────────── */

  function secMetricasML(ctx) {
    const cols = [
      { key: "mes", label: "Mês" },
      { key: "faturamento", label: "Faturamento (R$)", num: true },
      { key: "unidades", label: "Unidades", num: true },
      { key: "precoMedio", label: "Preço médio (R$)", num: true },
      { key: "visitas", label: "Visitas", num: true },
      { key: "vendas", label: "Vendas", num: true },
      { key: "conversao", label: "Conversão (%)", num: true },
      { key: "cancelamentosDevolucoes", label: "Canc./Devol. (R$)", num: true },
    ];
    const body = tableEditor("metricasNegocio.meses", getPath(ctx.respostas, "metricasNegocio.meses"), cols, { maxRows: 12, addLabel: "Adicionar mês" });
    return sectionCard("Métricas de negócio", "Vendas > Métricas > Negócio", "Registre até 12 meses.", body);
  }

  function secReputacaoML(ctx) {
    const v = (p) => getPath(ctx.respostas, p);
    const body = `
      <div class="vf-diag-field-grid">
        ${fieldWrap("Reputação atual", selectField("reputacao.reputacaoAtual", v("reputacao.reputacaoAtual"), [["verde", "Verde"], ["amarelo", "Amarelo"], ["laranja", "Laranja"], ["vermelho", "Vermelho"]]))}
        ${fieldWrap("Medalha", selectField("reputacao.medalha", v("reputacao.medalha"), [["sem_medalha", "Sem medalha"], ["lider", "Líder"], ["gold", "Gold"], ["platinum", "Platinum"]]))}
        ${fieldWrap("Reclamações (%)", inputNumber("reputacao.reclamacoesPercentual", v("reputacao.reclamacoesPercentual"), { suffix: "%" }))}
        ${fieldWrap("Mediações (%)", inputNumber("reputacao.mediacoesPercentual", v("reputacao.mediacoesPercentual"), { suffix: "%" }))}
        ${fieldWrap("Cancelados por você (%)", inputNumber("reputacao.canceladosPorVocePercentual", v("reputacao.canceladosPorVocePercentual"), { suffix: "%" }))}
        ${fieldWrap("Atraso no despacho (%)", inputNumber("reputacao.atrasoDespachoPercentual", v("reputacao.atrasoDespachoPercentual"), { suffix: "%" }))}
      </div>
      <div class="vf-diag-subgroup">
        <div class="vf-diag-subgroup__title">Análise</div>
        <div class="vf-diag-field-grid">
          ${fieldWrap("Análise de crescimento", inputTextarea("reputacao.analiseCrescimento", v("reputacao.analiseCrescimento")))}
          ${fieldWrap("Requisitos para o próximo nível", inputTextarea("reputacao.requisitosProximoNivel", v("reputacao.requisitosProximoNivel")))}
        </div>
      </div>
      <div class="vf-diag-subgroup">
        <div class="vf-diag-subgroup__title">Logística disponível</div>
        ${checkboxField("Agências ML", "reputacao.logisticaDisponivel.agenciasMl", v("reputacao.logisticaDisponivel.agenciasMl"))}
        ${checkboxField("Envios Flex", "reputacao.logisticaDisponivel.enviosFlex", v("reputacao.logisticaDisponivel.enviosFlex"))}
      </div>
      <div class="vf-diag-subgroup">
        <div class="vf-diag-subgroup__title">Programas</div>
        ${checkboxField("Programa Decola", "reputacao.programas.decola", v("reputacao.programas.decola"))}
        ${checkboxField("Programa Reputação", "reputacao.programas.reputacao", v("reputacao.programas.reputacao"))}
      </div>`;
    return sectionCard("Reputação e performance", "Menu > Reputação", "", body);
  }

  function secAuditoriaML(ctx) {
    const v = (p) => getPath(ctx.respostas, p);
    const body = `
      <div class="vf-diag-field-grid">
        ${fieldWrap("Anúncios ativos", inputNumber("auditoriaAnuncios.anunciosAtivos", v("auditoriaAnuncios.anunciosAtivos")))}
        ${fieldWrap("Anúncios inativos", inputNumber("auditoriaAnuncios.anunciosInativos", v("auditoriaAnuncios.anunciosInativos")))}
        ${fieldWrap("Anúncios em catálogo", inputNumber("auditoriaAnuncios.anunciosCatalogo", v("auditoriaAnuncios.anunciosCatalogo")))}
      </div>
      <div class="vf-diag-subgroup">
        <div class="vf-diag-subgroup__title">Logística</div>
        ${checkboxField("Full", "auditoriaAnuncios.logistica.full", v("auditoriaAnuncios.logistica.full"))}
        ${checkboxField("Flex", "auditoriaAnuncios.logistica.flex", v("auditoriaAnuncios.logistica.flex"))}
        ${checkboxField("Coleta", "auditoriaAnuncios.logistica.coleta", v("auditoriaAnuncios.logistica.coleta"))}
      </div>
      <div class="vf-diag-subgroup">
        <div class="vf-diag-subgroup__title">Checklist de qualidade (amostragem de 20 anúncios)</div>
        ${tristateRow("Títulos otimizados?", "auditoriaAnuncios.checklist.titulosOtimizados", v("auditoriaAnuncios.checklist.titulosOtimizados"))}
        ${tristateRow("Descrições otimizadas?", "auditoriaAnuncios.checklist.descricoesOtimizadas", v("auditoriaAnuncios.checklist.descricoesOtimizadas"))}
        ${tristateRow("Características preenchidas?", "auditoriaAnuncios.checklist.caracteristicasPreenchidas", v("auditoriaAnuncios.checklist.caracteristicasPreenchidas"))}
        ${tristateRow("Central de Promoção ativa?", "auditoriaAnuncios.checklist.centralPromocaoAtiva", v("auditoriaAnuncios.checklist.centralPromocaoAtiva"))}
        ${tristateRow("Opção de venda (variações)?", "auditoriaAnuncios.checklist.opcaoVendaVariacoes", v("auditoriaAnuncios.checklist.opcaoVendaVariacoes"))}
        ${tristateRow("Preço de atacado?", "auditoriaAnuncios.checklist.precoAtacado", v("auditoriaAnuncios.checklist.precoAtacado"))}
        ${tristateRow("Dados fiscais preenchidos?", "auditoriaAnuncios.checklist.dadosFiscaisPreenchidos", v("auditoriaAnuncios.checklist.dadosFiscaisPreenchidos"))}
        ${tristateRow("Imagens otimizadas?", "auditoriaAnuncios.checklist.imagensOtimizadas", v("auditoriaAnuncios.checklist.imagensOtimizadas"))}
        ${tristateRow("Utiliza clips (vídeos)?", "auditoriaAnuncios.checklist.utilizaClips", v("auditoriaAnuncios.checklist.utilizaClips"))}
      </div>`;
    return sectionCard("Auditoria de anúncios", "Anúncios > Filtragem", "Top 20 produtos.", body);
  }

  function secFullML(ctx) {
    const v = (p) => getPath(ctx.respostas, p);
    const utiliza = v("full.utilizaFull") === "sim";
    const gated = `
      <div class="vf-diag-field-grid">
        ${fieldWrap("Impulsionar (qtd.)", inputNumber("full.statusEstoque.impulsionar", v("full.statusEstoque.impulsionar")))}
        ${fieldWrap("Boa qualidade (qtd.)", inputNumber("full.statusEstoque.boaQualidade", v("full.statusEstoque.boaQualidade")))}
        ${fieldWrap("Entrada pendente (qtd.)", inputNumber("full.statusEstoque.entradaPendente", v("full.statusEstoque.entradaPendente")))}
        ${fieldWrap("Espaço utilizado", inputText("full.espacoUtilizado", v("full.espacoUtilizado")))}
        ${fieldWrap("Produtos com risco de cobrança/descarte", inputNumber("full.produtosRiscoCobranca", v("full.produtosRiscoCobranca")))}
        ${fieldWrap("Simulação de custo para retirada (R$)", inputNumber("full.simulacaoCustoRetirada", v("full.simulacaoCustoRetirada"), { prefix: "R$" }))}
        ${fieldWrap("Pontuação de qualidade (saúde do Full)", inputNumber("full.saudeFull.pontuacaoQualidade", v("full.saudeFull.pontuacaoQualidade")))}
      </div>
      <div class="vf-diag-field-grid">
        ${fieldWrap("Alerta de estoque antigo", inputTextarea("full.alertaEstoqueAntigo", v("full.alertaEstoqueAntigo"), { rows: 2 }))}
        ${fieldWrap("Fatores de impacto (saúde do Full)", inputTextarea("full.saudeFull.fatoresImpacto", v("full.saudeFull.fatoresImpacto"), { rows: 2 }))}
      </div>`;
    const body = `
      ${tristateRow("Utiliza Mercado Envios Full?", "full.utilizaFull", v("full.utilizaFull"))}
      ${gateBlock(utiliza, "Detalhamento do Full", gated, "Disponível quando 'Utiliza Mercado Envios Full' = Sim.")}`;
    return sectionCard("Operação Mercado Envios Full", "Anúncios > Gestão de Full", "", body);
  }

  function secPosVendaML(ctx) {
    const body = `
      ${tristateRow("Reclamações em andamento não visualizadas?", "posVenda.reclamacoesNaoVisualizadas", getPath(ctx.respostas, "posVenda.reclamacoesNaoVisualizadas"))}
      <p class="vf-diag-section__hint">Reforçar ao cliente que a Venforce atua com notificações, mas o operacional de resposta não está no escopo.</p>`;
    return sectionCard("Pós-venda", "", "", body);
  }

  function secMarketingML(ctx) {
    const v = (p) => getPath(ctx.respostas, p);
    const body = `
      ${tristateRow("Afiliados (confirmar com Seller)", "centralMarketing.afiliados", v("centralMarketing.afiliados"))}
      ${tristateRow("Ofertas relâmpago", "centralMarketing.ofertasRelampago", v("centralMarketing.ofertasRelampago"))}
      ${tristateRow("Central de Promoção", "centralMarketing.centralPromocao", v("centralMarketing.centralPromocao"))}
      ${tristateRow("Desconto por quantidade", "centralMarketing.descontoQtd", v("centralMarketing.descontoQtd"))}
      ${tristateRow("Minha Página / Display Ads", "centralMarketing.minhaPaginaDisplayAds", v("centralMarketing.minhaPaginaDisplayAds"))}
      ${tristateRow("Canal de transmissão", "centralMarketing.canalTransmissao", v("centralMarketing.canalTransmissao"))}`;
    return sectionCard("Central de marketing", "", "", body);
  }

  function secProductAdsML(ctx) {
    const v = (p) => getPath(ctx.respostas, p);
    const cols = [
      { key: "mes", label: "Mês" },
      { key: "investimento", label: "Investimento (R$)", num: true },
      { key: "vendasAds", label: "Vendas Ads", num: true },
      { key: "vendasOrganicas", label: "Vendas orgânicas", num: true },
      { key: "roas", label: "ROAS (%)", num: true },
      { key: "acos", label: "ACOS (%)", num: true },
      { key: "tacos", label: "TACOS (%)", num: true },
      { key: "cliques", label: "Cliques", num: true },
    ];
    const body = `
      ${tableEditor("productAds.meses", v("productAds.meses"), cols, { maxRows: 12, addLabel: "Adicionar mês" })}
      <div class="vf-diag-subgroup">
        <div class="vf-diag-field-grid">
          ${fieldWrap("Nº de campanhas", inputText("productAds.numCampanhas", v("productAds.numCampanhas")))}
          ${fieldWrap("Anúncios por campanha", inputText("productAds.anunciosPorCampanha", v("productAds.anunciosPorCampanha"), { placeholder: "Ex.: entre 8, 5 e 1" }))}
          ${fieldWrap("Campanhas sem vendas", inputNumber("productAds.campanhasSemVendas", v("productAds.campanhasSemVendas")))}
          ${fieldWrap("Campanhas com gasto elevado", inputNumber("productAds.campanhasComGastoElevado", v("productAds.campanhasComGastoElevado")))}
        </div>
      </div>`;
    return sectionCard("Publicidade (Product Ads)", "Publicidade > Product ADS", "ROAS/ACOS/TACOS são preenchidos manualmente — não são calculados pelo sistema.", body);
  }

  function secMarcasCatalogoML(ctx) {
    const body = `
      ${tristateRow("Registro de marca ativo?", "marcasCatalogo.registroMarcaAtivo", getPath(ctx.respostas, "marcasCatalogo.registroMarcaAtivo"))}
      ${tristateRow("Elegibilidade para catálogo?", "marcasCatalogo.elegibilidadeCatalogo", getPath(ctx.respostas, "marcasCatalogo.elegibilidadeCatalogo"))}`;
    return sectionCard("Marcas e catálogo", "", "", body);
  }

  const SECOES_ML = [
    { id: "identificacao", label: "Identificação", render: secIdentificacao },
    { id: "metricas", label: "Métricas de negócio", render: secMetricasML },
    { id: "reputacao", label: "Reputação e performance", render: secReputacaoML },
    { id: "auditoria", label: "Auditoria de anúncios", render: secAuditoriaML },
    { id: "full", label: "Operação Full", render: secFullML },
    { id: "posvenda", label: "Pós-venda", render: secPosVendaML },
    { id: "marketing", label: "Central de marketing", render: secMarketingML },
    { id: "ads", label: "Product Ads", render: secProductAdsML },
    { id: "marcas", label: "Marcas e catálogo", render: secMarcasCatalogoML },
    { id: "abc", label: "Curva ABC", render: secCurvaAbc },
    { id: "diagnostico", label: "Diagnóstico e plano de ação", render: secDiagnosticoPanel },
  ];

  /* ── Seções — Shopee ──────────────────────────────────────────── */

  function secMetricasShopee(ctx) {
    const cols = [
      { key: "mes", label: "Mês" },
      { key: "faturamento", label: "Faturamento (R$)", num: true },
      { key: "pedidos", label: "Pedidos", num: true },
      { key: "conversao", label: "Conversão (%)", num: true },
      { key: "visitantes", label: "Visitantes", num: true },
      { key: "vendasPorPedido", label: "Vendas por pedido", num: true },
      { key: "afiliadoShopee", label: "Vendas de afiliados (R$)", num: true },
      { key: "shopeeAds", label: "Vendas via Shopee Ads (R$)", num: true },
    ];
    const body = tableEditor("metricasNegocio.meses", getPath(ctx.respostas, "metricasNegocio.meses"), cols, { maxRows: 12, addLabel: "Adicionar mês" });
    return sectionCard("Métricas de negócio", "Central do Vendedor → Informações Gerenciais → Visão Geral", "Registre até 12 meses.", body);
  }

  function secProdutosShopee(ctx) {
    const cols = [
      { key: "id", label: "ID" },
      { key: "nome", label: "Nome" },
      { key: "vendas", label: "Vendas", num: true },
      { key: "impressoes", label: "Impressões", num: true },
      { key: "cliques", label: "Cliques", num: true },
      { key: "ctr", label: "CTR (%)", num: true },
      { key: "unidades", label: "Unidades", num: true },
      { key: "visitantes", label: "Visitantes", num: true },
      { key: "conversao", label: "Conversão (%)", num: true },
    ];
    const body = tableEditor("produtos.itens", getPath(ctx.respostas, "produtos.itens"), cols, { maxRows: 10, addLabel: "Adicionar produto" });
    return sectionCard("Produtos", "Central do Vendedor → Informações Gerenciais → Produto → Performance do produto", "Registre os 10 principais produtos.", body);
  }

  function secAuditoriaShopee(ctx) {
    const v = (p) => getPath(ctx.respostas, p);
    const possuiMarca = v("auditoriaAnuncios.checklist.possuiRegistroMarca") === "sim";
    const body = `
      <div class="vf-diag-field-grid">
        ${fieldWrap("Anúncios ativos", inputNumber("auditoriaAnuncios.anunciosAtivos", v("auditoriaAnuncios.anunciosAtivos")))}
        ${fieldWrap("Anúncios inativos", inputNumber("auditoriaAnuncios.anunciosInativos", v("auditoriaAnuncios.anunciosInativos")))}
        ${fieldWrap("Anúncios padronizados", inputNumber("auditoriaAnuncios.anunciosPadronizados", v("auditoriaAnuncios.anunciosPadronizados")), 'Aba "Produto Padronizado Shopee".')}
      </div>
      <div class="vf-diag-subgroup">
        <div class="vf-diag-subgroup__title">Logística</div>
        ${checkboxField("Full", "auditoriaAnuncios.logistica.full", v("auditoriaAnuncios.logistica.full"))}
        ${checkboxField("Flex", "auditoriaAnuncios.logistica.flex", v("auditoriaAnuncios.logistica.flex"))}
        ${checkboxField("Coleta", "auditoriaAnuncios.logistica.coleta", v("auditoriaAnuncios.logistica.coleta"))}
      </div>
      <div class="vf-diag-subgroup">
        <div class="vf-diag-subgroup__title">Checklist de qualidade (amostragem de 20 anúncios)</div>
        ${tristateRow("Títulos otimizados?", "auditoriaAnuncios.checklist.titulosOtimizados", v("auditoriaAnuncios.checklist.titulosOtimizados"))}
        ${tristateRow("Descrições otimizadas?", "auditoriaAnuncios.checklist.descricoesOtimizadas", v("auditoriaAnuncios.checklist.descricoesOtimizadas"))}
        ${tristateRow("Características preenchidas?", "auditoriaAnuncios.checklist.caracteristicasPreenchidas", v("auditoriaAnuncios.checklist.caracteristicasPreenchidas"))}
        ${tristateRow("Central de Promoção ativa?", "auditoriaAnuncios.checklist.centralPromocaoAtiva", v("auditoriaAnuncios.checklist.centralPromocaoAtiva"))}
        ${tristateRow("Opção de venda (variações)?", "auditoriaAnuncios.checklist.opcaoVendaVariacoes", v("auditoriaAnuncios.checklist.opcaoVendaVariacoes"))}
        ${tristateRow("Dados fiscais preenchidos?", "auditoriaAnuncios.checklist.dadosFiscaisPreenchidos", v("auditoriaAnuncios.checklist.dadosFiscaisPreenchidos"))}
        ${tristateRow("Imagens otimizadas?", "auditoriaAnuncios.checklist.imagensOtimizadas", v("auditoriaAnuncios.checklist.imagensOtimizadas"))}
        ${tristateRow("Utiliza clips (vídeos)?", "auditoriaAnuncios.checklist.utilizaClips", v("auditoriaAnuncios.checklist.utilizaClips"))}
        ${tristateRow("Possui registro de marca (Brand Management)?", "auditoriaAnuncios.checklist.possuiRegistroMarca", v("auditoriaAnuncios.checklist.possuiRegistroMarca"))}
        ${gateBlock(possuiMarca, "Registro de marca", tristateRow("Foi aceito? Se não, registre.", "auditoriaAnuncios.checklist.registroMarcaAceito", v("auditoriaAnuncios.checklist.registroMarcaAceito")), "Disponível quando 'Possui registro de marca' = Sim.")}
      </div>`;
    return sectionCard("Auditoria de anúncios", "Central do Vendedor → Produtos", "Top 20 anúncios.", body);
  }

  function secFulfillmentShopee(ctx) {
    const v = (p) => getPath(ctx.respostas, p);
    const utiliza = v("fulfillment.utilizaFull") === "sim";
    const gated = `
      <div class="vf-diag-field-grid">
        ${fieldWrap("Produtos no Fulfillment", inputNumber("fulfillment.produtosNoFull", v("fulfillment.produtosNoFull")))}
        ${fieldWrap("Variações no Fulfillment", inputNumber("fulfillment.variacoesNoFull", v("fulfillment.variacoesNoFull")))}
      </div>
      <div class="vf-diag-field-grid">
        ${fieldWrap("Taxa de estoque de item ativo (%)", inputNumber("fulfillment.statusEstoque.taxaItemAtivo", v("fulfillment.statusEstoque.taxaItemAtivo")))}
        ${fieldWrap("Unidades excedentes", inputNumber("fulfillment.statusEstoque.unidadesExcedentes", v("fulfillment.statusEstoque.unidadesExcedentes")))}
        ${fieldWrap("Variações sem movimento", inputNumber("fulfillment.statusEstoque.variacoesSemMovimento", v("fulfillment.statusEstoque.variacoesSemMovimento")))}
      </div>
      ${fieldWrap("Observações sobre o estoque", inputTextarea("fulfillment.statusEstoque.observacao", v("fulfillment.statusEstoque.observacao"), { rows: 2 }))}`;
    const body = `
      ${tristateRow("Utiliza Fulfillment?", "fulfillment.utilizaFull", v("fulfillment.utilizaFull"))}
      ${gateBlock(utiliza, "Detalhamento do Fulfillment", gated, "Disponível quando 'Utiliza Fulfillment' = Sim.")}`;
    return sectionCard("Operação Fulfillment", "Central do Vendedor → Fulfillment", "", body);
  }

  function secMarketingShopee(ctx) {
    const v = (p) => getPath(ctx.respostas, p);
    const body = `
      ${tristateRow("Central de Desconto", "centralMarketing.centralDesconto", v("centralMarketing.centralDesconto"))}
      ${tristateRow("Ofertas relâmpago", "centralMarketing.ofertasRelampago", v("centralMarketing.ofertasRelampago"))}
      ${tristateRow("Cupons de vendedores", "centralMarketing.cuponsVendedores", v("centralMarketing.cuponsVendedores"))}
      ${tristateRow("Campanha", "centralMarketing.campanha", v("centralMarketing.campanha"))}
      ${tristateRow("Live & Vídeo", "centralMarketing.liveVideo", v("centralMarketing.liveVideo"))}`;
    return sectionCard("Central de marketing", "Central do Vendedor → Central de Marketing", "", body);
  }

  function secDesempenhoContaShopee(ctx) {
    const v = (p) => getPath(ctx.respostas, p);
    const body = `
      <div class="vf-diag-field-grid">
        ${fieldWrap("Desempenho da conta", inputText("desempenhoConta.desempenhoConta", v("desempenhoConta.desempenhoConta")))}
        ${fieldWrap("Métrica de desempenho", inputText("desempenhoConta.metricaDesempenho", v("desempenhoConta.metricaDesempenho")))}
        ${fieldWrap("Minhas penalidades", inputNumber("desempenhoConta.minhasPenalidades", v("desempenhoConta.minhasPenalidades")))}
        ${fieldWrap("Taxa de não cumprimento (%)", inputNumber("desempenhoConta.taxaNaoCumprimento", v("desempenhoConta.taxaNaoCumprimento")))}
        ${fieldWrap("Taxa de envio atrasado (%)", inputNumber("desempenhoConta.taxaEnvioAtrasado", v("desempenhoConta.taxaEnvioAtrasado")))}
        ${fieldWrap("Tempo de preparação", inputText("desempenhoConta.tempoPreparacao", v("desempenhoConta.tempoPreparacao")))}
        ${fieldWrap("Envios aos sábados (%)", inputNumber("desempenhoConta.enviosSabados", v("desempenhoConta.enviosSabados")))}
        ${fieldWrap("Violações graves de anúncios", inputNumber("desempenhoConta.violacoesGravesAnuncios", v("desempenhoConta.violacoesGravesAnuncios")))}
        ${fieldWrap("Produtos pré-encomenda", inputNumber("desempenhoConta.produtosPreEncomenda", v("desempenhoConta.produtosPreEncomenda")))}
        ${fieldWrap("Outras violações de anúncios", inputNumber("desempenhoConta.outrasViolacoesAnuncios", v("desempenhoConta.outrasViolacoesAnuncios")))}
        ${fieldWrap("Taxa de resposta (%)", inputNumber("desempenhoConta.taxaResposta", v("desempenhoConta.taxaResposta")))}
      </div>
      ${fieldWrap("Resumo dos pontos de penalidade", inputTextarea("desempenhoConta.resumoPontosPenalidade", v("desempenhoConta.resumoPontosPenalidade"), { rows: 2 }))}
      ${tristateRow("Apelação em andamento?", "desempenhoConta.apelacaoAndamento", v("desempenhoConta.apelacaoAndamento"))}
      ${tristateRow("É vendedor indicado?", "desempenhoConta.vendedorIndicado", v("desempenhoConta.vendedorIndicado"))}`;
    return sectionCard("Desempenho da conta", "Central do Vendedor → Dados → Desempenho da conta", "", body);
  }

  function secShopeeAdsShopee(ctx) {
    const v = (p) => getPath(ctx.respostas, p);
    const cols = [
      { key: "mes", label: "Mês" },
      { key: "impressoes", label: "Impressões", num: true },
      { key: "cliques", label: "Cliques", num: true },
      { key: "ctr", label: "CTR (%)", num: true },
      { key: "pedidos", label: "Pedidos", num: true },
      { key: "itensVendidos", label: "Itens vendidos", num: true },
      { key: "vendas", label: "Vendas (R$)", num: true },
      { key: "investimento", label: "Investimento (R$)", num: true },
      { key: "roas", label: "ROAS (%)", num: true },
      { key: "tacos", label: "TACOS (%)", num: true },
    ];
    const body = `
      ${tableEditor("shopeeAds.meses", v("shopeeAds.meses"), cols, { maxRows: 12, addLabel: "Adicionar mês" })}
      <div class="vf-diag-subgroup">
        <div class="vf-diag-field-grid">
          ${fieldWrap("Nº de campanhas", inputNumber("shopeeAds.numCampanhas", v("shopeeAds.numCampanhas")))}
          ${fieldWrap("Nº de anúncios total em campanhas", inputNumber("shopeeAds.numAnunciosTotalCampanhas", v("shopeeAds.numAnunciosTotalCampanhas")))}
          ${fieldWrap("Campanhas sem vendas", inputNumber("shopeeAds.campanhasSemVendas", v("shopeeAds.campanhasSemVendas")))}
          ${fieldWrap("Campanhas com gasto elevado", inputNumber("shopeeAds.campanhasComGastoElevado", v("shopeeAds.campanhasComGastoElevado")))}
        </div>
      </div>`;
    return sectionCard("Publicidade (Shopee Ads)", "Central do Vendedor → Central de Marketing → Shopee Ads", "ROAS/TACOS são preenchidos manualmente — não são calculados pelo sistema.", body);
  }

  function secAfiliadosShopee(ctx) {
    const v = (p) => getPath(ctx.respostas, p);
    const aberta = v("afiliados.campanhaAbertaAtiva") === "sim";
    const exclusiva = v("afiliados.campanhaExclusivaAtiva") === "sim";
    const cols = [
      { key: "mes", label: "Mês" },
      { key: "vendas", label: "Vendas (R$)", num: true },
      { key: "pedidos", label: "Pedidos", num: true },
      { key: "clicks", label: "Clicks", num: true },
      { key: "comissaoEstimada", label: "Comissão estimada (R$)", num: true },
      { key: "roi", label: "ROI (%)", num: true },
      { key: "compradoresTotais", label: "Compradores totais", num: true },
      { key: "novosCompradores", label: "Novos compradores", num: true },
    ];
    const body = `
      ${tristateRow("Possui campanha aberta ativa?", "afiliados.campanhaAbertaAtiva", v("afiliados.campanhaAbertaAtiva"))}
      ${gateBlock(aberta, "Campanha aberta", fieldWrap("Nº de produtos em campanha aberta", inputNumber("afiliados.produtosCampanhaAberta", v("afiliados.produtosCampanhaAberta"))), "Disponível quando 'Possui campanha aberta ativa' = Sim.")}
      ${tristateRow("Possui campanha exclusiva ativa?", "afiliados.campanhaExclusivaAtiva", v("afiliados.campanhaExclusivaAtiva"))}
      ${gateBlock(exclusiva, "Campanha exclusiva", fieldWrap("Nº de produtos em campanha exclusiva", inputNumber("afiliados.produtosCampanhaExclusiva", v("afiliados.produtosCampanhaExclusiva"))), "Disponível quando 'Possui campanha exclusiva ativa' = Sim.")}
      <div class="vf-diag-subgroup">
        <div class="vf-diag-subgroup__title">Vendas mensais por afiliados</div>
        ${tableEditor("afiliados.meses", v("afiliados.meses"), cols, { maxRows: 12, addLabel: "Adicionar mês" })}
      </div>`;
    return sectionCard("Afiliados do vendedor", "Central do Vendedor → Central de Marketing → Afiliados do Vendedor", "", body);
  }

  function secDecoracaoLojaShopee(ctx) {
    const v = (p) => getPath(ctx.respostas, p);
    const possui = v("decoracaoLoja.possuiDecoracao") === "sim";
    const body = `
      ${tristateRow("Possui decoração?", "decoracaoLoja.possuiDecoracao", v("decoracaoLoja.possuiDecoracao"))}
      ${gateBlock(possui, "Última atualização", fieldWrap("Data da última atualização", inputText("decoracaoLoja.dataUltimaAtualizacao", v("decoracaoLoja.dataUltimaAtualizacao"), { type: "date" })), "Disponível quando 'Possui decoração' = Sim.")}`;
    return sectionCard("Decoração da loja", "Central do Vendedor → Loja → Decoração da Loja", "", body);
  }

  const SECOES_SHOPEE = [
    { id: "identificacao", label: "Identificação", render: secIdentificacao },
    { id: "metricas", label: "Métricas de negócio", render: secMetricasShopee },
    { id: "produtos", label: "Produtos", render: secProdutosShopee },
    { id: "auditoria", label: "Auditoria de anúncios", render: secAuditoriaShopee },
    { id: "fulfillment", label: "Operação Fulfillment", render: secFulfillmentShopee },
    { id: "marketing", label: "Central de marketing", render: secMarketingShopee },
    { id: "desempenho", label: "Desempenho da conta", render: secDesempenhoContaShopee },
    { id: "ads", label: "Shopee Ads", render: secShopeeAdsShopee },
    { id: "afiliados", label: "Afiliados do vendedor", render: secAfiliadosShopee },
    { id: "decoracao", label: "Decoração da loja", render: secDecoracaoLojaShopee },
    { id: "abc", label: "Curva ABC", render: secCurvaAbc },
    { id: "diagnostico", label: "Diagnóstico e plano de ação", render: secDiagnosticoPanel },
  ];

  /* ── Renderização ─────────────────────────────────────────────── */

  function renderEmptyState(isEmpty) {
    document.getElementById("diag-empty-state").hidden = !isEmpty;
    document.getElementById("diag-resumo").hidden = isEmpty;
    document.getElementById("diag-marketplace-switch").hidden = isEmpty;
    document.getElementById("diag-records").hidden = isEmpty;
    document.getElementById("diag-layout").hidden = isEmpty;
    document.getElementById("diag-btn-salvar").disabled = isEmpty;
    document.getElementById("diag-btn-gerar").disabled = isEmpty;
    document.getElementById("diag-btn-concluir").disabled = isEmpty;
    if (isEmpty) document.getElementById("diag-btn-imprimir").disabled = true;
  }

  function updateMarketplaceSwitchUI() {
    document.querySelectorAll("#diag-marketplace-switch .vf-segmented__item").forEach((btn) => {
      const active = btn.dataset.marketplace === state.marketplaceAtivo;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", String(active));
    });
  }

  function renderToolbarFromDiag() {
    const diag = getDiag();
    if (!diag) return;
    document.getElementById("diag-data").value = (diag.data_diagnostico || "").slice(0, 10);
    document.getElementById("diag-data").disabled = diag.status === "concluido";
    const statusEl = document.getElementById("diag-status");
    statusEl.textContent = diag.status === "concluido" ? "Concluído" : "Rascunho";
    statusEl.className = "vf-status " + (diag.status === "concluido" ? "is-success" : "is-warning");
    document.getElementById("diag-last-saved").textContent = diag.updated_at ? formatDataHora(diag.updated_at) : "—";

    const user = getUserSafe();
    document.getElementById("diag-responsavel").value = diag.responsavel_nome || user.nome || user.email || "Usuário";
  }

  function renderNav() {
    const nav = document.getElementById("diag-nav");
    const secoes = currentSecoes();
    const detalhes = getDiag()?.completude_detalhes || diagnosticSchema.evaluateCompleteness(state.marketplaceAtivo, getRespostas());
    const byId = new Map((detalhes.secoes || []).map((section) => [section.id, section]));
    nav.innerHTML = secoes.map((s) => `
      <button type="button" class="vf-diag-nav__item${s.id === state.secaoAtivaId ? " is-active" : ""}${byId.get(s.id)?.concluida ? " is-complete" : ""}" data-section="${s.id}">
        <span>${esc(s.label)}</span>
        <span class="vf-diag-nav__badge">${byId.get(s.id)?.concluida ? "✓" : (byId.get(s.id)?.camposPendentes?.length || 0)}</span>
      </button>`).join("");
  }

  function renderSectionSelect() {
    const select = document.getElementById("diag-section-select");
    const secoes = currentSecoes();
    select.innerHTML = secoes.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join("");
    select.value = state.secaoAtivaId;
  }

  function renderActiveSection() {
    const host = document.getElementById("diag-section-host");
    const diag = getDiag();
    if (!diag) { host.innerHTML = ""; return; }
    if (!diag.respostas_json) diag.respostas_json = {};
    const secoes = currentSecoes();
    const secao = secoes.find((s) => s.id === state.secaoAtivaId) || secoes[0];
    const ctx = { respostas: diag.respostas_json, diagnostico: diag, marketplace: state.marketplaceAtivo };
    host.innerHTML = secao.render(ctx);
    if (diag.status === "concluido") {
      host.querySelectorAll("input, select, textarea, button").forEach((el) => { el.disabled = true; });
    }
  }

  function renderResumo() {
    const el = document.getElementById("diag-resumo");
    const diag = getDiag();
    if (!diag) { el.hidden = true; return; }
    el.hidden = false;
    const detalhes = diag.completude_detalhes || diagnosticSchema.evaluateCompleteness(state.marketplaceAtivo, diag.respostas_json || {});
    const completude = Number(detalhes.percentual || 0);
    document.getElementById("diag-kpi-progresso").textContent = `${completude}%`;
    document.getElementById("diag-kpi-progresso-bar").style.width = `${Math.min(100, Math.max(0, completude))}%`;

    document.getElementById("diag-kpi-pendentes").textContent = String(detalhes.camposPendentes?.length || 0);
    document.getElementById("diag-kpi-secoes").textContent = `${detalhes.secoesConcluidas}/${detalhes.totalSecoes}`;

    document.getElementById("diag-kpi-salvamento").textContent = diag.updated_at ? formatDataHora(diag.updated_at) : "—";
  }

  function renderRecordSelector() {
    const wrap = document.getElementById("diag-records");
    const select = document.getElementById("diag-record-select");
    const button = document.getElementById("diag-btn-novo");
    const current = getDiag();
    if (!current) { wrap.hidden = true; return; }
    wrap.hidden = false;
    const draft = state.rascunhos[state.marketplaceAtivo];
    const completed = state.historico[state.marketplaceAtivo] || [];
    const records = [draft, ...completed].filter(Boolean).filter((item, index, list) => list.findIndex((other) => String(other.id) === String(item.id)) === index);
    if (!records.some((item) => String(item.id) === String(current.id))) records.unshift(current);
    select.innerHTML = records.map((item) => {
      const label = item.status === "concluido"
        ? `Concluído · ${formatData(item.data_diagnostico)} · ${item.responsavel_nome || "Responsável não informado"}`
        : `Rascunho atual · atualizado ${formatDataHora(item.updated_at)}`;
      return `<option value="${item.id}">${esc(label)}</option>`;
    }).join("");
    select.value = String(current.id);
    if (current.status !== "concluido") {
      button.textContent = "Rascunho atual";
      button.disabled = true;
    } else if (draft) {
      button.textContent = "Voltar ao rascunho";
      button.disabled = false;
    } else {
      button.textContent = "Iniciar novo diagnóstico";
      button.disabled = false;
    }
  }

  function renderAll() {
    const secoes = currentSecoes();
    if (!secoes.some((s) => s.id === state.secaoAtivaId)) state.secaoAtivaId = secoes[0].id;
    renderToolbarFromDiag();
    renderNav();
    renderSectionSelect();
    renderActiveSection();
    renderResumo();
    renderRecordSelector();
    updateMarketplaceSwitchUI();

    const diag = getDiag();
    const concluido = !!diag && diag.status === "concluido";
    document.getElementById("diag-btn-imprimir").disabled = !diag || (!diag.diagnostico_gerado_json && !diag.relatorio_snapshot_json);
    document.getElementById("diag-btn-salvar").disabled = concluido;
    document.getElementById("diag-btn-gerar").disabled = concluido;
    document.getElementById("diag-btn-concluir").disabled = concluido;
  }

  /* ── Orquestração: cliente / marketplace / seção ────────────── */

  async function loadClientes() {
    const result = await apiGet("/clientes");
    const select = document.getElementById("diag-cliente");
    const lista = Array.isArray(result.data?.clientes) ? result.data.clientes : [];
    state.clientes = lista;
    select.innerHTML = '<option value="">Selecione um cliente…</option>' +
      lista.map((c) => `<option value="${c.id}">${esc(c.nome)}${c.ativo === false ? " (inativo)" : ""}</option>`).join("");
    if (!result.ok) {
      showFeedback(result.error || "Não foi possível carregar a lista de clientes.", "warning");
    }
  }

  function restoreLastCliente() {
    const last = localStorage.getItem(LAST_CLIENTE_KEY);
    if (!last) return;
    const exists = state.clientes.some((c) => String(c.id) === String(last));
    if (!exists) return;
    document.getElementById("diag-cliente").value = last;
    onClienteChange();
  }

  async function loadHistorico(mkt) {
    const result = await apiGet(`${DIAG_API}?clienteId=${state.clienteId}&marketplace=${mkt}`);
    if (!result.ok) {
      showFeedback(result.error || "Não foi possível carregar os diagnósticos do cliente.", "danger");
      return false;
    }
    const lista = Array.isArray(result.data?.diagnosticos) ? result.data.diagnosticos : [];
    state.rascunhos[mkt] = lista.find((d) => d.status === "rascunho") || state.rascunhos[mkt] || null;
    state.historico[mkt] = lista.filter((d) => d.status === "concluido");
    if (state.marketplaceAtivo === mkt && state.secaoAtivaId === "diagnostico") renderActiveSection();
    return true;
  }

  async function ensureDraftForMarketplace(mkt) {
    if (!state.clienteId) return;
    if (state.diagnosticos[mkt]) { renderAll(); return; }

    const result = await apiPost(DIAG_API, {
      clienteId: state.clienteId,
      marketplace: mkt,
      dataDiagnostico: isoToday(),
    });

    if (!result.ok) {
      showFeedback(result.error || "Não foi possível abrir o diagnóstico.", "danger");
      return;
    }

    const diag = result.data.diagnostico;
    if (!diag.respostas_json) diag.respostas_json = {};
    state.diagnosticos[mkt] = diag;
    state.rascunhos[mkt] = diag;
    state.secaoAtivaId = state.secaoAtivaId || (mkt === "shopee" ? SECOES_SHOPEE[0].id : SECOES_ML[0].id);

    await loadHistorico(mkt);
    renderAll();
  }

  async function onClienteChange() {
    const select = document.getElementById("diag-cliente");
    const id = select.value;

    const saved = await flushAutosave({ force: false });
    if (!saved) {
      select.value = state.clienteId || "";
      return;
    }

    state.clienteId = id || null;
    state.clienteNome = id ? (state.clientes.find((cliente) => String(cliente.id) === String(id))?.nome || "") : "";
    state.diagnosticos = { meli: null, shopee: null };
    state.rascunhos = { meli: null, shopee: null };
    state.dirty = { meli: false, shopee: false };
    state.versions = { meli: 0, shopee: 0 };
    state.historico = { meli: [], shopee: [] };
    state.secaoAtivaId = null;
    showFeedback("", null);

    if (!id) {
      localStorage.removeItem(LAST_CLIENTE_KEY);
      renderEmptyState(true);
      return;
    }

    localStorage.setItem(LAST_CLIENTE_KEY, id);
    renderEmptyState(false);

    state.marketplaceAtivo = "meli";
    updateMarketplaceSwitchUI();
    await ensureDraftForMarketplace("meli");
  }

  async function switchMarketplace(mkt) {
    if (mkt === state.marketplaceAtivo) return;
    const saved = await flushAutosave({ force: false });
    if (!saved) return;
    state.marketplaceAtivo = mkt;
    state.secaoAtivaId = mkt === "shopee" ? SECOES_SHOPEE[0].id : SECOES_ML[0].id;
    updateMarketplaceSwitchUI();
    await ensureDraftForMarketplace(mkt);
  }

  async function selectSection(id) {
    if (state.secaoAtivaId === id) return;
    const saved = await flushAutosave({ force: false });
    if (!saved) return;
    state.secaoAtivaId = id;
    renderNav();
    renderSectionSelect();
    renderActiveSection();
  }

  async function selectDiagnostic(id) {
    const mkt = state.marketplaceAtivo;
    if (String(getDiag()?.id) === String(id)) return;
    const saved = await flushAutosave({ force: false });
    if (!saved) return;
    const known = [state.rascunhos[mkt], ...(state.historico[mkt] || [])].find((item) => item && String(item.id) === String(id));
    if (!known) return;
    const result = await apiGet(`${DIAG_API}/${known.id}`);
    if (!result.ok) {
      showFeedback(result.error || "Não foi possível abrir o diagnóstico selecionado.", "danger");
      renderRecordSelector();
      return;
    }
    state.diagnosticos[mkt] = result.data.diagnostico;
    state.secaoAtivaId = "diagnostico";
    showFeedback(result.data.diagnostico.status === "concluido" ? "Diagnóstico concluído aberto em modo somente leitura." : "Rascunho recuperado.", "success");
    renderAll();
  }

  async function startOrReturnToDraft() {
    const mkt = state.marketplaceAtivo;
    const existing = state.rascunhos[mkt];
    if (existing) {
      state.diagnosticos[mkt] = existing;
      state.secaoAtivaId = currentSecoes()[0].id;
      showFeedback("Rascunho atual aberto.", "success");
      renderAll();
      return;
    }
    const result = await apiPost(DIAG_API, { clienteId: state.clienteId, marketplace: mkt, dataDiagnostico: isoToday() });
    if (!result.ok) {
      showFeedback(result.error || "Não foi possível iniciar um novo diagnóstico.", "danger");
      return;
    }
    state.rascunhos[mkt] = result.data.diagnostico;
    state.diagnosticos[mkt] = result.data.diagnostico;
    state.secaoAtivaId = currentSecoes()[0].id;
    showFeedback("Novo diagnóstico iniciado sem alterar o histórico concluído.", "success");
    await loadHistorico(mkt);
    renderAll();
  }

  /* ── Gerar / Concluir / Imprimir ──────────────────────────────── */

  async function onGerarClick() {
    const diag = getDiag();
    if (!diag) return;
    const saved = await flushAutosave({ force: true });
    if (!saved) return;
    document.getElementById("diag-btn-gerar").disabled = true;
    const result = await apiPost(`${DIAG_API}/${diag.id}/gerar`, {});
    document.getElementById("diag-btn-gerar").disabled = diag.status === "concluido";
    if (!result.ok) {
      showFeedback(result.error || "Erro ao gerar diagnóstico.", "danger");
      return;
    }
    state.diagnosticos[state.marketplaceAtivo] = result.data.diagnostico;
    showFeedback("Diagnóstico gerado. Revise o conteúdo antes de concluir.", "success");
    await selectSection("diagnostico");
    renderAll();
  }

  async function onConcluirClick() {
    const diag = getDiag();
    if (!diag) return;
    if (!diag.diagnostico_gerado_json) {
      showFeedback("Gere o diagnóstico antes de concluir.", "warning");
      return;
    }
    const saved = await flushAutosave({ force: true });
    if (!saved) return;
    openPendenciasModal(getDiag());
  }

  function openPendenciasModal(diag) {
    const detalhes = diag.completude_detalhes || diagnosticSchema.evaluateCompleteness(diag.marketplace, diag.respostas_json || {});
    const ausentes = detalhes.camposPendentes || [];
    const body = document.getElementById("diag-modal-body");
    body.innerHTML = ausentes.length
      ? `<p>Existem ${ausentes.length} item(ns) ainda não avaliados ou não informados:</p>
         <ul class="vf-diag-ausentes">${ausentes.slice(0, 20).map((a) => `<li>${esc(missingItemLabel(a))}</li>`).join("")}</ul>
         ${ausentes.length > 20 ? `<p class="vf-field__hint">+ ${ausentes.length - 20} item(ns).</p>` : ""}`
      : `<p>Todas as seções aplicáveis foram avaliadas. Deseja concluir o diagnóstico?</p>`;
    document.getElementById("diag-modal-overlay").classList.add("is-open");
  }

  async function confirmarConclusao() {
    const diag = getDiag();
    document.getElementById("diag-modal-overlay").classList.remove("is-open");
    if (!diag) return;
    const result = await apiPost(`${DIAG_API}/${diag.id}/concluir`, {});
    if (!result.ok) {
      showFeedback(result.error || "Erro ao concluir diagnóstico.", "danger");
      return;
    }
    const concluido = result.data.diagnostico;
    state.diagnosticos[state.marketplaceAtivo] = concluido;
    state.rascunhos[state.marketplaceAtivo] = null;
    state.historico[state.marketplaceAtivo] = [concluido, ...(state.historico[state.marketplaceAtivo] || []).filter((item) => String(item.id) !== String(concluido.id))];
    state.dirty[state.marketplaceAtivo] = false;
    showFeedback("Diagnóstico concluído.", "success");
    renderAll();
  }

  function waitForReportImages(root) {
    return Promise.all(Array.from(root.querySelectorAll("img")).map((img) => img.complete
      ? Promise.resolve()
      : new Promise((resolve) => { img.addEventListener("load", resolve, { once: true }); img.addEventListener("error", resolve, { once: true }); })));
  }

  async function onImprimirClick() {
    const diag = getDiag();
    if (!diag || (!diag.diagnostico_gerado_json && !diag.relatorio_snapshot_json)) return;
    const snapshot = diag.status === "concluido" && diag.relatorio_snapshot_json
      ? diag.relatorio_snapshot_json
      : reportApi.buildDraftSnapshot(diag, {
        clienteNome: state.clienteNome,
        responsavelNome: document.getElementById("diag-responsavel").value,
      });
    const root = document.getElementById("diag-print-block");
    root.innerHTML = reportApi.renderReportHtml(snapshot);
    const originalTitle = document.title;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      document.body.classList.remove("vf-printing-diagnostic-report");
      root.innerHTML = "";
      document.title = originalTitle;
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    document.title = reportApi.filename(snapshot);
    document.body.classList.add("vf-printing-diagnostic-report");
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
    await waitForReportImages(root);
    window.print();
  }

  /* ── Eventos ──────────────────────────────────────────────────── */

  function onTableAddRow(path, max) {
    const respostas = getRespostas();
    let arr = getPath(respostas, path);
    if (!Array.isArray(arr)) { arr = []; setPath(respostas, path, arr); }
    if (arr.length >= max) { showFeedback(`Limite de ${max} linhas atingido.`, "warning"); return; }
    arr.push({});
    markDirty();
    scheduleAutosave();
    renderActiveSection();
  }

  function onTableRemoveRow(path, rowIdx) {
    const respostas = getRespostas();
    const arr = getPath(respostas, path);
    if (!Array.isArray(arr)) return;
    arr.splice(rowIdx, 1);
    markDirty();
    scheduleAutosave();
    renderActiveSection();
  }

  function bindSectionEvents(host) {
    host.addEventListener("input", (e) => {
      const el = e.target;

      if (el.matches("[data-revfield]")) {
        const diag = getDiag();
        if (!diag) return;
        if (!diag.diagnostico_revisado_json) {
          diag.diagnostico_revisado_json = JSON.parse(JSON.stringify(diag.diagnostico_gerado_json || {}));
        }
        const kind = el.dataset.revkind;
        diag.diagnostico_revisado_json[el.dataset.revfield] = kind === "list" ? textToArr(el.value) : el.value;
        markDirty();
        scheduleAutosave();
        return;
      }

      if (el.matches("input[data-table]")) {
        const path = el.dataset.table;
        const rowIdx = Number(el.dataset.row);
        const col = el.dataset.col;
        const respostas = getRespostas();
        let arr = getPath(respostas, path);
        if (!Array.isArray(arr)) { arr = []; setPath(respostas, path, arr); }
        if (!arr[rowIdx]) arr[rowIdx] = {};
        let val = el.value;
        if (el.type === "number") {
          val = val === "" ? null : Number(val);
          if (val !== null && !Number.isFinite(val)) return;
        } else if (val === "") {
          val = null;
        }
        arr[rowIdx][col] = val;
        markDirty();
        scheduleAutosave();
        return;
      }

      if (el.matches("[data-field]")) {
        const kind = el.dataset.kind;
        if (kind === "tristate" || kind === "checkbox") return;
        let val = el.value;
        if (el.type === "number") {
          val = val === "" ? null : Number(val);
          if (val !== null && !Number.isFinite(val)) return;
        } else if (val === "") {
          val = null;
        }
        setPath(getRespostas(), el.dataset.field, val);
        markDirty();
        scheduleAutosave();
      }
    });

    host.addEventListener("change", (e) => {
      const el = e.target;
      if (el.matches("[data-field][data-kind=\"checkbox\"]")) {
        setPath(getRespostas(), el.dataset.field, el.checked);
        markDirty();
        scheduleAutosave();
        renderActiveSection();
      }
    });

    host.addEventListener("click", (e) => {
      const tri = e.target.closest(".vf-diag-tristate [data-value]");
      if (tri) {
        const wrap = tri.closest('[data-field][data-kind="tristate"]');
        if (wrap) {
          setPath(getRespostas(), wrap.dataset.field, tri.dataset.value);
          markDirty();
          scheduleAutosave();
          renderActiveSection();
        }
        return;
      }
      const addBtn = e.target.closest("[data-table-add]");
      if (addBtn) { onTableAddRow(addBtn.dataset.tableAdd, Number(addBtn.dataset.max) || 12); return; }
      const rmBtn = e.target.closest("[data-table-remove]");
      if (rmBtn) { onTableRemoveRow(rmBtn.dataset.tableRemove, Number(rmBtn.dataset.row)); return; }
      const openBtn = e.target.closest("[data-open-diagnostic]");
      if (openBtn) { selectDiagnostic(openBtn.dataset.openDiagnostic); }
    });
  }

  function bindStaticEvents() {
    document.getElementById("diag-cliente").addEventListener("change", onClienteChange);

    document.getElementById("diag-data").addEventListener("change", (e) => {
      const diag = getDiag();
      if (!diag) return;
      diag.data_diagnostico = e.target.value;
      markDirty();
      scheduleAutosave();
    });

    document.getElementById("diag-marketplace-switch").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-marketplace]");
      if (!btn) return;
      switchMarketplace(btn.dataset.marketplace);
    });

    document.getElementById("diag-nav").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-section]");
      if (!btn) return;
      selectSection(btn.dataset.section);
    });

    document.getElementById("diag-section-select").addEventListener("change", (e) => {
      selectSection(e.target.value);
    });

    document.getElementById("diag-record-select").addEventListener("change", (e) => {
      selectDiagnostic(e.target.value);
    });
    document.getElementById("diag-btn-novo").addEventListener("click", startOrReturnToDraft);

    document.getElementById("diag-btn-salvar").addEventListener("click", () => flushAutosave({ force: true }));
    document.getElementById("diag-btn-gerar").addEventListener("click", onGerarClick);
    document.getElementById("diag-btn-concluir").addEventListener("click", onConcluirClick);
    document.getElementById("diag-btn-imprimir").addEventListener("click", onImprimirClick);

    document.getElementById("diag-modal-cancelar").addEventListener("click", () => {
      document.getElementById("diag-modal-overlay").classList.remove("is-open");
    });
    document.getElementById("diag-modal-confirmar").addEventListener("click", confirmarConclusao);

    window.addEventListener("beforeunload", (e) => {
      if (state.dirty.meli || state.dirty.shopee) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  /* ── Init ─────────────────────────────────────────────────────── */

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    if (typeof window.initLayout === "function") window.initLayout();
    bindStaticEvents();
    bindSectionEvents(document.getElementById("diag-section-host"));
    renderEmptyState(true);
    if (!reportApi || !diagnosticSchema) {
      showFeedback("Não foi possível carregar o modelo oficial do diagnóstico.", "danger");
      return;
    }
    await loadClientes();
    restoreLastCliente();
  }
})();
