(function (root, factory) {
  const schema = root.VF_DIAGNOSTIC_SCHEMA || (typeof require === "function" ? require("./diagnostico-inicial-schema") : null);
  const api = factory(schema);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DIAGNOSTIC_REPORT = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (schema) {
  "use strict";

  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]));

  function missing(value) {
    return schema ? schema.isMissing(value) : value === null || value === undefined || value === "";
  }

  function formatDate(value, withTime) {
    if (missing(value)) return "Não informado";
    const text = String(value);
    const date = new Date(text.length === 10 ? `${text}T00:00:00` : text);
    if (Number.isNaN(date.getTime())) return text;
    return withTime
      ? date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
      : date.toLocaleDateString("pt-BR");
  }

  function formatNumber(value, options) {
    if (missing(value)) return "Não informado";
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return new Intl.NumberFormat("pt-BR", options || { maximumFractionDigits: 2 }).format(number);
  }

  function formatValue(value, field) {
    if (missing(value)) return "Não informado";
    if (field.tipo === "tristate") return value === "sim" ? "Sim" : value === "nao" ? "Não" : "Não avaliado";
    if (field.tipo === "boolean") return value === true ? "Sim" : "Não";
    if (field.tipo === "date") return formatDate(value, false);
    if (field.tipo === "currency") return formatNumber(value, { style: "currency", currency: "BRL" });
    if (field.tipo === "percent") return `${formatNumber(value)}%`;
    if (field.tipo === "number") return formatNumber(value);
    if (field.tipo === "select" && field.opcoes && Object.prototype.hasOwnProperty.call(field.opcoes, value)) return field.opcoes[value];
    if (Array.isArray(value)) return value.map(String).join(", ");
    if (typeof value === "object") return Object.entries(value).map(([key, item]) => `${key}: ${item}`).join("; ");
    return String(value);
  }

  function normalizeAnalysis(value) {
    const source = value && typeof value === "object" ? value : {};
    const list = (key) => Array.isArray(source[key]) ? source[key].map(String) : [];
    return {
      resumoExecutivo: String(source.resumoExecutivo || ""), situacaoAtual: String(source.situacaoAtual || ""),
      pontosPositivos: list("pontosPositivos"), pontosNegativos: list("pontosNegativos"),
      riscosUrgencias: list("riscosUrgencias"), prioridadesPrimeiraSemana: list("prioridadesPrimeiraSemana"),
      plano30Dias: list("plano30Dias"), acoesMedioPrazo: list("acoesMedioPrazo"),
      conclusaoAnalista: String(source.conclusaoAnalista || ""),
    };
  }

  function buildDraftSnapshot(diagnostico, meta) {
    const diag = diagnostico || {};
    const respostas = diag.respostas_json || {};
    const marketplace = diag.marketplace === "shopee" ? "shopee" : "meli";
    const completude = schema.evaluateCompleteness(marketplace, respostas);
    const analysis = normalizeAnalysis(diag.diagnostico_revisado_json || diag.diagnostico_gerado_json);
    const secoes = schema.getSections(marketplace).map((section) => ({
      id: section.id,
      titulo: section.title,
      campos: section.fields.filter((field) => schema.isApplicable(field, respostas)).map((field) => ({
        label: field.label,
        tipo: field.type,
        valor: schema.getPath(respostas, field.path) ?? null,
        opcoes: field.options,
        colunas: field.columns,
      })),
    }));
    const informacoesAusentes = completude.secoes.filter((section) => section.camposPendentes.length).map((section) => ({
      secao: section.title,
      itens: section.camposPendentes.map((field) => field.label),
    }));
    return {
      version: 1, generatedAt: new Date().toISOString(), titulo: "Relatório de Diagnóstico Inicial Venforce",
      cliente: { id: diag.cliente_id || null, nome: String(diag.cliente_nome || meta?.clienteNome || ""), slug: String(diag.cliente_slug || "") },
      marketplace, marketplaceLabel: marketplace === "shopee" ? "Shopee" : "Mercado Livre",
      responsavel: { nome: String(diag.responsavel_nome || meta?.responsavelNome || "") },
      dataDiagnostico: diag.data_diagnostico || null, status: diag.status || "rascunho", completedAt: diag.completed_at || null,
      completude,
      resumo: {
        resumoExecutivo: analysis.resumoExecutivo, situacaoAtual: analysis.situacaoAtual,
        pontosPositivos: analysis.pontosPositivos.length, riscos: analysis.riscosUrgencias.length,
        prioridades: analysis.prioridadesPrimeiraSemana.length, informacoesAusentes: completude.camposPendentes.length,
      },
      analise: analysis, secoes, informacoesAusentes,
    };
  }

  function textBlock(title, value) {
    return `<section class="vf-report-section vf-report-keep"><h2>${esc(title)}</h2><p class="vf-report-long-text">${esc(value || "Não informado")}</p></section>`;
  }

  function listBlock(title, items) {
    const list = Array.isArray(items) ? items : [];
    return `<section class="vf-report-section"><h2>${esc(title)}</h2>${list.length
      ? `<ul class="vf-report-list">${list.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`
      : '<p class="vf-report-muted">Não informado</p>'}</section>`;
  }

  function renderTable(field) {
    const rows = Array.isArray(field.valor) ? field.valor : [];
    const columns = Array.isArray(field.colunas) ? field.colunas : [];
    if (!rows.length) return '<p class="vf-report-muted">Não informado</p>';
    return `<div class="vf-report-table-wrap"><table class="vf-report-table"><thead><tr>${columns.map((column) => `<th>${esc(column.label)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${esc(formatValue(row?.[column.key], { tipo: column.type }))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  function renderAnswerField(field) {
    if (field.tipo === "table") {
      return `<div class="vf-report-answer vf-report-answer--table"><h3>${esc(field.label)}</h3>${renderTable(field)}</div>`;
    }
    return `<div class="vf-report-answer"><dt>${esc(field.label)}</dt><dd>${esc(formatValue(field.valor, field))}</dd></div>`;
  }

  function renderReportHtml(snapshot) {
    const data = snapshot || {};
    const analysis = normalizeAnalysis(data.analise);
    const completeness = data.completude || {};
    const summary = data.resumo || {};
    const sections = Array.isArray(data.secoes) ? data.secoes : [];
    const missingGroups = Array.isArray(data.informacoesAusentes) ? data.informacoesAusentes : [];
    const status = data.status === "concluido" ? "Concluído" : "Rascunho";
    const percent = Number(completeness.percentual || 0);

    return `<article class="vf-diagnostic-report" aria-label="Relatório de Diagnóstico Inicial Venforce">
      <section class="vf-report-cover">
        <div class="vf-report-brand"><span class="vf-report-brand-mark">V</span><span>VENFORCE</span></div>
        <div class="vf-report-cover-main"><p class="vf-report-eyebrow">Relatório oficial</p><h1>Diagnóstico<br>Inicial</h1><p class="vf-report-client">${esc(data.cliente?.nome || "Cliente não informado")}</p><span class="vf-report-marketplace">${esc(data.marketplaceLabel || data.marketplace || "")}</span></div>
        <dl class="vf-report-cover-meta">
          <div><dt>Responsável</dt><dd>${esc(data.responsavel?.nome || "Não informado")}</dd></div>
          <div><dt>Data do diagnóstico</dt><dd>${esc(formatDate(data.dataDiagnostico, false))}</dd></div>
          <div><dt>Status</dt><dd>${esc(status)}</dd></div>
          <div><dt>Conclusão</dt><dd>${esc(formatDate(data.completedAt, true))}</dd></div>
          <div><dt>Completude</dt><dd>${esc(formatNumber(percent))}%</dd></div>
        </dl>
      </section>

      <div class="vf-report-pages">
        <section class="vf-report-section"><p class="vf-report-eyebrow">Visão geral</p><h1 class="vf-report-page-title">Resumo executivo</h1>
          <p class="vf-report-lead">${esc(summary.resumoExecutivo || analysis.resumoExecutivo || "Não informado")}</p>
          <div class="vf-report-summary-grid">
            <div><strong>${esc(formatNumber(summary.pontosPositivos || 0))}</strong><span>Pontos positivos</span></div>
            <div><strong>${esc(formatNumber(summary.riscos || 0))}</strong><span>Riscos</span></div>
            <div><strong>${esc(formatNumber(summary.prioridades || 0))}</strong><span>Prioridades</span></div>
            <div><strong>${esc(formatNumber(summary.informacoesAusentes || 0))}</strong><span>Informações ausentes</span></div>
          </div>
        </section>
        ${textBlock("Situação atual", summary.situacaoAtual || analysis.situacaoAtual)}

        <section class="vf-report-section vf-report-chapter"><p class="vf-report-eyebrow">Análise</p><h1 class="vf-report-page-title">Leitura estratégica</h1></section>
        ${listBlock("Pontos positivos", analysis.pontosPositivos)}
        ${listBlock("Pontos negativos", analysis.pontosNegativos)}
        ${listBlock("Riscos e urgências", analysis.riscosUrgencias)}
        ${listBlock("Prioridades da primeira semana", analysis.prioridadesPrimeiraSemana)}
        ${listBlock("Plano de 30 dias", analysis.plano30Dias)}
        ${listBlock("Ações de médio prazo", analysis.acoesMedioPrazo)}
        ${textBlock("Conclusão do analista", analysis.conclusaoAnalista)}

        <section class="vf-report-section vf-report-chapter"><p class="vf-report-eyebrow">Check-up</p><h1 class="vf-report-page-title">Respostas registradas</h1></section>
        ${sections.map((section) => `<section class="vf-report-section vf-report-answer-section"><h2>${esc(section.titulo)}</h2><dl>${(section.campos || []).map(renderAnswerField).join("")}</dl></section>`).join("")}

        <section class="vf-report-section vf-report-chapter"><p class="vf-report-eyebrow">Pendências</p><h1 class="vf-report-page-title">Informações ausentes</h1></section>
        ${missingGroups.length ? missingGroups.map((group) => `<section class="vf-report-section vf-report-missing"><h2>${esc(group.secao)}</h2><ul class="vf-report-list">${(group.itens || []).map((item) => `<li>${esc(item)}</li>`).join("")}</ul></section>`).join("") : '<section class="vf-report-section vf-report-keep"><p>Nenhuma informação obrigatória pendente.</p></section>'}
        <footer class="vf-report-footer">Venforce · Relatório de Diagnóstico Inicial</footer>
      </div>
    </article>`;
  }

  function filename(snapshot) {
    const slug = String(snapshot?.cliente?.nome || "cliente").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cliente";
    return `diagnostico-inicial-${slug}-${snapshot?.marketplace || "marketplace"}`;
  }

  return { esc, formatValue, buildDraftSnapshot, renderReportHtml, filename };
});
