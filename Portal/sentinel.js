/* Sentinel V0-b — fila de incidentes sobre a API /sentinel.
   Camada de dados única: createApi() (HTTP real) ou SENTINEL_MOCK.api (somente
   com ?demo=1, com selo). Com backend não existe mock nenhum no caminho. */
(function (root) {
  "use strict";

  const TIPOS = { margem_negativa: "Margem negativa", custo_pendente: "Custo pendente", leitura_atrasada: "Leitura atrasada" };
  const STATUS = { aberto: "Aberto", reconhecido: "Reconhecido", resolvido: "Resolvido", reaberto: "Reaberto" };
  const SEV = { critica: "Crítica", alta: "Alta", media: "Média", baixa: "Baixa" };
  const SEV_CLASSE = { critica: "is-danger", alta: "is-warning", media: "is-info", baixa: "is-empty" };
  // Regra de produto: "calculado" = claims NÃO verificadas — nunca "confirmada".
  const CONF = {
    calculado: ["Calculado", "margem calculada; devoluções/claims não verificadas"],
    pendente: ["Pendente", "falta custo confiável; margem não calculável"],
    confirmado: ["Confirmado", "margem verificada"],
    inconclusivo: ["Inconclusivo", "dados insuficientes para concluir"],
    operacional: ["Operacional", "falha de leitura, não de margem"],
  };
  const IMPACTO = {
    perda_contribuicao: ["Perda de contribuição observada", "prejuízo na margem de contribuição dos pedidos"],
    receita_sem_custo: ["Receita sem custo", "NÃO é prejuízo: só não dá para calcular a margem"],
  };
  const SITUACAO = { ok: ["is-success", "Em dia"], atrasada: ["is-warning", "Atrasada"], erro: ["is-danger", "Com erro"], nunca_lida: ["is-empty", "Nunca lida"], ok_com_erro: ["is-warning", "Em dia, com erro"], nao_monitorada: ["is-empty", "Não monitorada"] };
  const PERIODOS = { "24h": 24, "7d": 168, "30d": 720, todos: 0 };
  const OFF_TXT = "conta desativada — não monitorada";
  const STALE_MS = 30 * 60 * 1000;

  /* ── Lógica pura (testável em node) ─────────────────────────────────── */
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const brl = (n) => (n == null ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
  const pct = (n) => (n == null ? "—" : Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%");
  function duracao(ms) {
    const m = Math.max(0, ms) / 60000;
    if (m < 60) return Math.max(1, Math.round(m)) + " min";
    const h = m / 60;
    if (h < 48) return Math.round(h) + " h";
    return Math.round(h / 24) + " d";
  }
  const desde = (iso, agora) => (iso ? duracao((agora == null ? Date.now() : agora) - new Date(iso).getTime()) : "—");

  // MLB só vai na URL quando o incidente é de UM anúncio (chave no formato de identificador;
// "conta" e chaves compostas "MLB1+MLB2" ficam de fora). A Central de Margem usa o valor
// apenas para pré-preencher a busca; cliente/conta continuam validados pelo Shell e pela API.
const MLB_URL = /^[A-Za-z0-9_-]{3,40}$/;
const linkCentral = (i) => "central-margem.html?cliente=" + encodeURIComponent(i.clienteSlug) + "&conta=" + encodeURIComponent(i.contaId) + (i.chave && i.chave !== "conta" && MLB_URL.test(i.chave) ? "&mlb=" + encodeURIComponent(i.chave) : "");
  const linkBases = (i) => "bases.html?cliente=" + encodeURIComponent(i.clienteSlug);

  function periodoParaDesde(periodo, agora) {
    const h = PERIODOS[periodo];
    return h ? new Date((agora == null ? Date.now() : agora) - h * 3600000).toISOString() : null;
  }

  // Por que o incidente está nesta posição (a ordem vem do backend: severidade → impacto).
  function prioridadeExplicada(i) {
    const p = ["Severidade " + SEV[i.severidade].toLowerCase()];
    if (i.impacto && i.impacto.valor != null) p.push((IMPACTO[i.impacto.tipo] || ["Impacto"])[0].toLowerCase() + " de " + brl(i.impacto.valor));
    if (i.pedidosAfetados) p.push(i.pedidosAfetados + " pedido(s) afetado(s)");
    if (i.vezesReaberto) p.push("reaberto " + i.vezesReaberto + "×");
    if (i.status === "reconhecido") p.push("já reconhecido por " + (i.reconhecido ? i.reconhecido.por : "alguém"));
    return p.join(" · ");
  }

  // Estado da tela (precedência): erro → carregando → sem contas → monitoramento
  // desativado → dados desatualizados (banner) / sem incidentes / ok.
  function estadoDaTela(s, agora) {
    if (s.erro) return { tela: "erro" };
    if (s.carregando) return { tela: "carregando" };
    if (!s.contas || s.contas.length === 0) return { tela: "sem_dados" };
    if (s.resumo && s.resumo.monitoramentoAtivo === false) return { tela: "desativado" };
    const t = s.resumo && s.resumo.ultimaAtualizacao ? new Date(s.resumo.ultimaAtualizacao).getTime() : null;
    const desatualizado = t == null || (agora == null ? Date.now() : agora) - t > STALE_MS;
    const prob = s.contas.filter((c) => c.ativo !== false && (c.situacao === "atrasada" || c.situacao === "erro" || c.situacao === "nunca_lida" || c.situacao === "ok_com_erro")).length; // conta desativada não conta como "atrasada"
    return { tela: s.incidentes && s.incidentes.total === 0 ? "sem_incidentes" : "ok", desatualizado, contasComProblema: prob };
  }

  // Saúde do monitoramento (F4). "Sem pedidos recentes" é informativo, nunca falha.
  const WORKER = { ativo: ["is-success", "Ativo", "O worker do Sentinel está lendo dentro do intervalo esperado."], atrasado: ["is-warning", "Atrasado", "A última execução passou do intervalo esperado, mas ainda dentro do limite de leitura."], parado: ["is-danger", "Parado", "Nenhuma execução dentro do limite de leitura: as margens podem estar desatualizadas."], sem_dados: ["is-empty", "Sem dados", "Ainda não há execução registrada para as contas do seu recorte."] };
  const NIVEL = { critico: ["is-danger", "Crítico"], aviso: ["is-warning", "Aviso"], info: ["is-info", "Info"] };
  function idadeTxt(seg) { return seg == null ? "—" : duracao(seg * 1000); }
  // Alertas ordenados por gravidade, agrupados por nível.
  function agruparAlertas(alertas) {
    const g = { critico: [], aviso: [], info: [] };
    (alertas || []).forEach((a) => (g[a.nivel] || g.info).push(a));
    return g;
  }

  function criarApi({ base, getToken, fetchImpl }) {
    const f = fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    async function req(method, path, { params, body } = {}) {
      const qs = new URLSearchParams();
      Object.entries(params || {}).forEach(([k, v]) => { if (v !== "" && v != null) qs.set(k, v); });
      const url = base + "/sentinel" + path + (qs.toString() ? "?" + qs : "");
      const headers = { Authorization: "Bearer " + getToken() };
      if (body) headers["Content-Type"] = "application/json";
      const r = await f(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
      let j = null;
      try { j = await r.json(); } catch (e) { /* corpo vazio */ }
      if (!r.ok) throw Object.assign(new Error((j && j.erro) || "Erro " + r.status), { status: r.status, code: j && j.code });
      return j;
    }
    return {
      resumo: (q) => req("GET", "/resumo", { params: q }).then((j) => j.resumo),
      contas: (q) => req("GET", "/contas", { params: q }).then((j) => j.contas),
      saude: (q) => req("GET", "/saude", { params: q }).then((j) => j.saude),
      incidentes: (q) => req("GET", "/incidentes", { params: q }),
      incidente: (id) => req("GET", "/incidentes/" + encodeURIComponent(id)).then((j) => j.incidente),
      reconhecer: (id) => req("POST", "/incidentes/" + encodeURIComponent(id) + "/reconhecer", { body: {} }).then((j) => j.incidente),
      resolver: (id, body) => req("POST", "/incidentes/" + encodeURIComponent(id) + "/resolver", { body }).then((j) => j.incidente),
    };
  }

  const api0 = { OFF_TXT, agruparAlertas, idadeTxt, WORKER, NIVEL, esc, brl, pct, duracao, desde, linkCentral, linkBases, periodoParaDesde, prioridadeExplicada, estadoDaTela, criarApi, TIPOS, STATUS, SEV, CONF, IMPACTO };
  if (typeof module !== "undefined" && module.exports) module.exports = api0;
  root.Sentinel = api0;
  if (typeof document === "undefined") return;

  /* ── UI ─────────────────────────────────────────────────────────────── */
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const DEMO = params.get("demo") === "1";
  const TOKEN_KEY = "vf-token", USER_KEY = "vf-user";
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sem storage */ } };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) { /* sem storage */ } };

  function apiBase() {
    const m = document.querySelector('meta[name="vf-api-base"]');
    if (m && m.content.trim()) return m.content.trim().replace(/\/+$/, "");
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return location.origin;
    return "https://venforce-server.onrender.com";
  }

  let api = null;
  const S = { carregando: true, erro: null, saude: null, saudeErro: false, resumo: null, contas: [], incidentes: null, aba: "fila", detalhe: null, detalheErro: null, resolvendo: false, acaoErro: null };
  const F = { squad: "", conta: "", tipo: "", status: "", severidade: "", periodo: "7d", busca: "" };
  let lastFocus = null, reqSeq = 0;

  // Conta ML desativada: só leitura/ações humanas; não é monitorada nem conta como atrasada.
  const offBadge = (ativa) => (ativa === false ? '<span class="sn-off" title="O Sentinel não lê pedidos desta conta; o incidente fica para consulta e decisão humana.">' + OFF_TXT + "</span>" : "");
  const sevBadge = (s) => '<span class="vf-status ' + SEV_CLASSE[s] + '">' + SEV[s] + "</span>";
  const confBadge = (c) => '<span class="sn-conf sn-conf--' + esc(c) + '" title="' + esc((CONF[c] || ["", ""])[1]) + '">' + esc((CONF[c] || [c])[0]) + "</span>";
  const impactoTxt = (i) => (i.impacto && i.impacto.valor != null
    ? '<strong>' + brl(i.impacto.valor) + '</strong><div class="sn-sub">' + esc((IMPACTO[i.impacto.tipo] || [""])[0]) + "</div>"
    : '<span class="sn-sub">sem impacto em R$</span>');
  const produto = (i) => (i.chave === "conta" ? '<span class="sn-sub">conta inteira</span>' : '<code>' + esc(i.chave) + "</code>");
  const ctxLinks = (i) => '<a class="vf-btn vf-btn--sm vf-btn--secondary" href="' + esc(linkCentral(i)) + '">Central de Margem</a> <a class="vf-btn vf-btn--sm vf-btn--ghost" href="' + esc(linkBases(i)) + '">Bases</a>';

  function filtroParams() {
    return { squad: F.squad, conta: F.conta, tipo: F.tipo, status: F.status, severidade: F.severidade, busca: F.busca.trim(), desde: periodoParaDesde(F.periodo), limit: 50 };
  }

  async function carregar() {
    const seq = ++reqSeq;
    S.carregando = true; S.erro = null; render();
    try {
      const escopo = { squad: F.squad, conta: F.conta };
      // A saúde é complementar: se ela falhar, a fila continua (e a aba avisa).
      const saudeP = api.saude(escopo).then((x) => ({ x }), (e) => (e.status === 401 ? Promise.reject(e) : { erro: true }));
      const [resumo, contas, incidentes, sd] = await Promise.all([api.resumo(escopo), api.contas({}), api.incidentes(filtroParams()), saudeP]);
      if (seq !== reqSeq) return; // resposta de um filtro antigo
      Object.assign(S, { resumo, contas, incidentes, saude: sd.x || null, saudeErro: !!sd.erro, carregando: false });
    } catch (e) {
      if (seq !== reqSeq) return;
      if (e.status === 401) { lsDel(TOKEN_KEY); lsDel(USER_KEY); location.replace("index.html"); return; }
      S.carregando = false;
      S.erro = e.status === 403 ? "Seu perfil não tem acesso ao Sentinel." : e.message || "Falha ao carregar.";
    }
    render();
  }

  /* ── Render ─────────────────────────────────────────────────────────── */
  function renderFiltros() {
    const squads = [...new Map(S.contas.filter((c) => c.squad).map((c) => [c.squad.id, c.squad])).values()];
    const contas = S.contas.filter((c) => !F.squad || (c.squad && String(c.squad.id) === F.squad));
    const op = (v, l, sel) => '<option value="' + esc(v) + '"' + (sel ? " selected" : "") + ">" + esc(l) + "</option>";
    $("#sn-f-squad").innerHTML = op("", "Todos os squads / carteiras", !F.squad) + squads.map((s) => op(s.id, s.nome, String(s.id) === F.squad)).join("");
    $("#sn-f-conta").innerHTML = op("", "Todas as contas", !F.conta) + contas.map((c) => op(c.contaId, c.clienteNome + " · " + c.contaNome + (c.ativo === false ? " (desativada)" : ""), String(c.contaId) === F.conta)).join("");
    $("#sn-f-tipo").innerHTML = op("", "Todos os tipos", !F.tipo) + Object.keys(TIPOS).map((k) => op(k, TIPOS[k], k === F.tipo)).join("");
    $("#sn-f-status").innerHTML = op("", "Todos os status", !F.status) + Object.keys(STATUS).map((k) => op(k, STATUS[k], k === F.status)).join("");
    $("#sn-f-sev").innerHTML = op("", "Toda prioridade", !F.severidade) + Object.keys(SEV).map((k) => op(k, SEV[k], k === F.severidade)).join("");
    $("#sn-f-periodo").value = F.periodo;
    if (document.activeElement !== $("#sn-f-busca")) $("#sn-f-busca").value = F.busca;
  }

  function renderKpis() {
    const r = S.resumo;
    if (!r) { $("#sn-kpis").innerHTML = ""; return; }
    const k = (cls, label, val, foot) => '<div class="vf-kpi ' + cls + '"><span class="vf-kpi__label">' + label + '</span><span class="vf-kpi__value">' + val + '</span><span class="vf-kpi__foot">' + foot + "</span></div>";
    const cob = r.cobertura || { pedidos: 0, porConfiabilidade: {}, excluidos: {} };
    const pc = cob.porConfiabilidade || {};
    const exc = Object.values(cob.excluidos || {}).reduce((a, b) => a + b, 0);
    $("#sn-kpis").innerHTML =
      k("vf-kpi--danger", "Perda de contribuição observada", brl(r.perdaContribuicaoObservada), "margem negativa · calculada, claims não verificadas") +
      k("vf-kpi--warning", "Receita com custo pendente", brl(r.receitaCustoPendente), "não é prejuízo: falta custo para calcular margem") +
      k("vf-kpi--danger", "Incidentes abertos", r.incidentesAbertos, r.incidentesCriticos + " crítico(s)") +
      k("vf-kpi--warning", "Contas monitoradas", r.contasMonitoradas, r.contasAtrasadas + " com leitura atrasada/erro") +
      k("", "Cobertura (pedidos)", cob.pedidos, (pc.calculado || 0) + " calculados · " + (pc.pendente || 0) + " pendentes · " + (pc.confirmado || 0) + " confirmados · " + (pc.inconclusivo || 0) + " inconclusivos · " + exc + " cancelados fora");
  }

  const banner = (titulo, desc, role) => '<div class="vf-banner vf-banner--compact ' + (role === "alert" ? "is-danger" : "is-warning") + '" role="' + role + '"><div class="vf-banner__content"><div class="vf-banner__title">' + titulo + "</div>" + (desc ? '<div class="vf-banner__description">' + desc + "</div>" : "") + "</div></div>";

  // Alertas internos (nada externo): críticos viram banner; avisos, uma linha com atalho p/ a aba.
  function renderBanner(est) {
    const b = [];
    if (est.desatualizado && S.resumo) b.push(banner("Dados desatualizados", "Última atualização " + (S.resumo.ultimaAtualizacao ? desde(S.resumo.ultimaAtualizacao) + " atrás" : "desconhecida") + ". Os números podem não refletir os pedidos mais recentes.", "status"));
    if (S.saude) {
      const g = agruparAlertas(S.saude.alertas);
      g.critico.slice(0, 3).forEach((a) => b.push(banner(esc(a.mensagem), "", "alert")));
      if (g.critico.length > 3) b.push(banner("+ " + (g.critico.length - 3) + " alerta(s) crítico(s)", "", "alert"));
      if (g.aviso.length) b.push(banner(g.aviso.length + " aviso(s) de monitoramento", '<button type="button" class="vf-btn vf-btn--sm vf-btn--ghost" data-tab="saude">Ver saúde do monitoramento</button>', "status"));
    } else if (est.contasComProblema) {
      b.push(banner(est.contasComProblema + " conta(s) com leitura atrasada, com erro ou nunca lida", "Margens dessas contas podem estar incompletas. Veja a aba “Contas”.", "status"));
    }
    $("#sn-banners").innerHTML = b.join("");
  }

  function painelSaude() {
    if (S.saudeErro || !S.saude) return '<div class="vf-empty"><div class="vf-empty__title">Saúde do monitoramento indisponível</div><div class="vf-empty__description">Não foi possível ler o estado do worker agora. A fila de incidentes continua válida.</div><div class="vf-empty__actions"><button class="vf-btn vf-btn--primary" id="sn-retry">Tentar de novo</button></div></div>';
    const h = S.saude, w = WORKER[h.worker.estado] || WORKER.sem_dados, c = h.contas, sv = h.incidentesAbertosPorSeveridade || {};
    const card = (l, v, f) => '<div class="vf-kpi"><span class="vf-kpi__label">' + l + '</span><span class="vf-kpi__value">' + v + '</span><span class="vf-kpi__foot">' + (f || "") + "</span></div>";
    const g = agruparAlertas(h.alertas);
    const lista = ["critico", "aviso", "info"].map((n) => g[n].map((a) => {
      const conta = a.contaId ? S.contas.find((x) => x.contaId === a.contaId) : null;
      return '<li class="sn-alerta"><span class="vf-status ' + NIVEL[n][0] + '">' + NIVEL[n][1] + "</span> <span>" + esc(a.mensagem) + "</span>" + (conta ? ' <span class="sn-alerta__acoes"><button type="button" class="vf-btn vf-btn--sm vf-btn--ghost" data-alerta-conta="' + esc(conta.contaId) + '">Ver incidentes</button> ' + ctxLinks({ clienteSlug: conta.clienteSlug, contaId: conta.contaId }) + "</span>" : "") + "</li>";
    }).join("")).join("");
    const cob = h.cobertura;
    return '<div class="sn-saude"><div class="sn-worker"><span class="vf-status ' + w[0] + '">Worker ' + w[1] + "</span><div>" + esc(w[2]) + '</div><div class="sn-sub">Última execução: ' + (h.worker.ultimaExecucaoEm ? idadeTxt(h.worker.idadeSegundos) + " atrás" : "—") + " · idade máxima do checkpoint: " + idadeTxt(h.checkpointIdadeMaxSegundos) + " · última coleta OK: " + (h.ultimaColetaOkEm ? desde(h.ultimaColetaOkEm) + " atrás" : "—") + "</div></div>" +
      '<div class="vf-kpi-grid">' + card("Contas monitoradas", c.monitoradas, c.ok + " em dia") + card("Leitura atrasada", c.atrasadas, "acima do limite de leitura") + card("Erro de token", c.erroToken, "renovar pelo Portal") + card("Erro de API", c.erroApi, "coleta falhando") + card("Nunca lidas", c.nuncaLidas, "sem primeira leitura") + card("Sem pedidos 24 h", c.semPedidosRecentes, "informativo — não é falha") + "</div>" +
      '<h3 class="sn-h">Incidentes abertos por severidade</h3><p>' + ["critica", "alta", "media", "baixa"].map((k) => sevBadge(k) + " <strong>" + (sv[k] || 0) + "</strong>").join(" &nbsp; ") + "</p>" +
      (cob ? '<h3 class="sn-h">Cobertura financeira</h3><p class="sn-sub">' + esc(cob.pedidos) + " pedidos · " + esc((cob.porConfiabilidade || {}).calculado || 0) + " calculados · " + esc((cob.porConfiabilidade || {}).pendente || 0) + " pendentes · " + esc((cob.porConfiabilidade || {}).inconclusivo || 0) + " inconclusivos · cancelados fora</p>" : "") +
      '<h3 class="sn-h">Alertas</h3>' + (lista ? '<ul class="sn-alertas">' + lista + "</ul>" : '<p class="sn-sub">Nenhum alerta. Monitoramento sem pendências.</p>') + "</div>";
  }

  function tabelaFila() {
    const l = S.incidentes.itens;
    return '<div class="vf-table-wrap"><div class="vf-table-scroll"><table class="vf-table vf-table--compact sn-fila"><thead><tr><th>Urgência</th><th>Tipo / produto</th><th>Conta</th><th class="sn-num">Impacto</th><th>Confiança</th><th>Motivo e próxima ação</th><th>Em aberto</th></tr></thead><tbody>' +
      l.map((i) => '<tr class="sn-row" tabindex="0" data-inc="' + esc(i.id) + '"><td>' + sevBadge(i.severidade) + '<div class="sn-sub">' + esc(STATUS[i.status]) + '</div></td><td><strong>' + esc(TIPOS[i.tipo]) + "</strong><div>" + produto(i) + '</div></td><td>' + esc(i.clienteNome) + '<div class="sn-sub">' + esc(i.contaNome) + (i.squad ? " · " + esc(i.squad.nome) : "") + '</div>' + offBadge(i.contaAtiva) + '</td><td class="sn-num">' + impactoTxt(i) + "</td><td>" + confBadge(i.confiabilidade) + '</td><td class="sn-motivo"><div>' + esc(i.motivo) + '</div><div class="sn-acao">→ ' + esc(i.proximaAcao) + '</div><div class="sn-why">' + esc(prioridadeExplicada(i)) + '</div></td><td>' + desde(i.abertoEm) + "</td></tr>").join("") +
      "</tbody></table></div></div>" + (S.incidentes.total > l.length ? '<p class="sn-sub sn-more">Mostrando ' + l.length + " de " + S.incidentes.total + ". Refine os filtros para ver os demais.</p>" : "");
  }

  function tabelaContas() {
    const cs = S.contas.filter((c) => (!F.squad || (c.squad && String(c.squad.id) === F.squad)) && (!F.conta || String(c.contaId) === F.conta));
    return '<div class="vf-table-wrap"><div class="vf-table-scroll"><table class="vf-table vf-table--compact"><thead><tr><th>Cliente</th><th>Conta</th><th>Squad / carteira</th><th>Última leitura</th><th>Situação</th><th>Último erro</th><th></th></tr></thead><tbody>' +
      cs.map((c) => { const s = SITUACAO[c.situacao] || ["is-empty", c.situacao]; return "<tr><td><strong>" + esc(c.clienteNome) + "</strong></td><td>" + esc(c.contaNome) + "</td><td>" + esc(c.squad ? c.squad.nome : "—") + "</td><td>" + (c.ultimaExecucaoEm ? desde(c.ultimaExecucaoEm) + " atrás" : "—") + '</td><td>' + (c.ativo === false ? offBadge(false) : '<span class="vf-status ' + s[0] + '">' + s[1] + "</span>" + (c.monitorada ? "" : ' <span class="sn-sub">(não monitorada)</span>')) + '</td><td class="sn-sub">' + esc(c.ultimoErro || "—") + '</td><td class="sn-actions">' + ctxLinks({ clienteSlug: c.clienteSlug, contaId: c.contaId }) + "</td></tr>"; }).join("") +
      "</tbody></table></div></div>";
  }

  const vazio = (t, d) => '<div class="vf-empty"><div class="vf-empty__title">' + t + "</div>" + (d ? '<div class="vf-empty__description">' + d + "</div>" : "") + "</div>";

  function render() {
    const est = estadoDaTela(S);
    $("#sn-demo-seal").hidden = !DEMO;
    renderBanner(est.tela === "ok" || est.tela === "sem_incidentes" ? est : {});
    const mostraFiltros = !["carregando", "erro", "sem_dados", "desativado"].includes(est.tela) || S.contas.length > 0;
    $("#sn-filtros").hidden = !mostraFiltros;
    if (S.contas.length) renderFiltros();
    renderKpis();
    document.querySelectorAll("[data-tab]").forEach((b) => { const on = b.dataset.tab === S.aba; b.classList.toggle("is-active", on); b.setAttribute("aria-selected", on); });
    const painel = $("#sn-painel");
    painel.setAttribute("aria-busy", est.tela === "carregando");
    if (est.tela === "carregando") painel.innerHTML = '<div class="vf-loading-state"><span class="vf-spinner"></span> Carregando incidentes…</div>';
    else if (est.tela === "erro") painel.innerHTML = '<div class="vf-empty"><div class="vf-empty__title">Não foi possível carregar o Sentinel</div><div class="vf-empty__description">' + esc(S.erro) + '</div><div class="vf-empty__actions"><button class="vf-btn vf-btn--primary" id="sn-retry">Tentar de novo</button></div></div>';
    else if (est.tela === "sem_dados") painel.innerHTML = vazio("Nenhuma conta monitorável na sua carteira", "O Sentinel acompanha contas do Mercado Livre dos clientes do(s) seu(s) Squad(s). Peça a um admin para conferir seu vínculo a um Squad.");
    else if (est.tela === "desativado") painel.innerHTML = vazio("Monitoramento desativado", "O monitoramento por polling não está ligado neste ambiente, então não há leituras novas. Os incidentes abaixo, se houver, são da última avaliação.");
    else if (S.aba === "contas") painel.innerHTML = tabelaContas();
    else if (S.aba === "saude") painel.innerHTML = painelSaude();
    else if (est.tela === "sem_incidentes") painel.innerHTML = vazio("Nenhum incidente com esses filtros", "Se não há filtros ativos, está tudo em ordem nas contas monitoradas.");
    else painel.innerHTML = tabelaFila();
    $("#sn-count").textContent = S.incidentes ? S.incidentes.total + " incidente(s)" : "";
    if (S.detalhe) renderDrawer();
  }

  /* ── Drawer ─────────────────────────────────────────────────────────── */
  function numerosExplicados(i) {
    const rows = [];
    if (i.impacto && i.impacto.valor != null) rows.push([(IMPACTO[i.impacto.tipo] || ["Impacto"])[0], brl(i.impacto.valor) + " — " + (IMPACTO[i.impacto.tipo] || ["", ""])[1]]);
    rows.push(["Confiança", (CONF[i.confiabilidade] || [i.confiabilidade, ""])[0] + " — " + (CONF[i.confiabilidade] || ["", ""])[1]]);
    rows.push(["Pedidos afetados", i.pedidosAfetados]);
    rows.push(["Primeira ocorrência", i.primeiraOcorrencia ? new Date(i.primeiraOcorrencia).toLocaleString("pt-BR") : "—"]);
    rows.push(["Última ocorrência", i.ultimaOcorrencia ? new Date(i.ultimaOcorrencia).toLocaleString("pt-BR") : "—"]);
    if (i.vezesReaberto) rows.push(["Reaberto", i.vezesReaberto + "×"]);
    const det = i.detalhes && typeof i.detalhes === "object" ? Object.entries(i.detalhes).filter(([, v]) => v == null || typeof v !== "object") : [];
    det.forEach(([k, v]) => rows.push([k, v == null ? "—" : v]));
    return rows;
  }

  function renderDrawer() {
    const i = S.detalhe;
    $("#sn-drawer-title").textContent = i.titulo;
    $("#sn-drawer-sub").innerHTML = "#" + esc(i.id) + " · " + sevBadge(i.severidade) + " · " + esc(STATUS[i.status]);
    const ped = i.pedidos || [], ev = i.eventos || [];
    const encerrado = i.status === "resolvido";
    $("#sn-drawer-body").innerHTML =
      (S.acaoErro ? '<div class="vf-banner vf-banner--compact" role="alert"><div class="vf-banner__content"><div class="vf-banner__title">' + esc(S.acaoErro) + "</div></div></div>" : "") +
      (i.contaAtiva === false ? '<div class="vf-banner vf-banner--compact is-warning" role="status"><div class="vf-banner__content"><div class="vf-banner__title">' + OFF_TXT + '</div><div class="vf-banner__description">Você pode consultar, reconhecer e resolver; o Sentinel não coleta pedidos novos desta conta.</div></div></div>' : "") + '<h3 class="sn-h">Diagnóstico</h3><p>' + esc(i.motivo) + '</p><p class="sn-acao">→ Próxima ação: ' + esc(i.proximaAcao) + '</p><p class="sn-why">Por que está na fila: ' + esc(prioridadeExplicada(i)) + "</p>" + (i.tipo === "custo_pendente" && i.chave !== "conta" ? '<p class="sn-sub">Em Bases, o link abre o cliente; procure o anúncio <code>' + esc(i.chave) + "</code> na lista de custos da base dele.</p>" : "") +
      '<dl class="sn-dl"><dt>Cliente</dt><dd>' + esc(i.clienteNome) + "</dd><dt>Conta</dt><dd>" + esc(i.contaNome) + "</dd><dt>Squad</dt><dd>" + esc(i.squad ? i.squad.nome : "—") + "</dd><dt>Tipo</dt><dd>" + esc(TIPOS[i.tipo]) + "</dd>" + (i.chave !== "conta" ? "<dt>Anúncio</dt><dd><code>" + esc(i.chave) + "</code></dd>" : "") + "</dl>" +
      '<h3 class="sn-h">Números explicados</h3><dl class="sn-dl">' + numerosExplicados(i).map((r) => "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>").join("") + "</dl>" +
      (ped.length ? '<h3 class="sn-h">Pedidos (' + ped.length + ')</h3><div class="vf-table-scroll"><table class="vf-table vf-table--compact"><thead><tr><th>Pedido</th><th>Data</th><th class="sn-num">Fatur.</th><th class="sn-num">Margem</th><th>Confiança</th></tr></thead><tbody>' + ped.map((p) => "<tr><td><code>" + esc(p.pedidoId) + "</code></td><td>" + (p.dataPedido ? new Date(p.dataPedido).toLocaleDateString("pt-BR") : "—") + '</td><td class="sn-num">' + brl(p.faturamento) + '</td><td class="sn-num">' + (p.margemValor == null ? "—" : brl(p.margemValor) + " (" + pct(p.margemPct) + ")") + "</td><td>" + confBadge(p.confiabilidade) + "</td></tr>").join("") + "</tbody></table></div>" : "") +
      '<h3 class="sn-h">Histórico</h3><ol class="sn-hist">' + (ev.length ? ev.map((e) => "<li><strong>" + esc(e.evento) + "</strong> · " + esc(e.ator) + ' <span class="sn-sub">' + (e.criadoEm ? new Date(e.criadoEm).toLocaleString("pt-BR") : "") + "</span>" + (e.dados && e.dados.motivo ? '<div class="sn-sub">Motivo: ' + esc(e.dados.motivo) + "</div>" : "") + "</li>").join("") : '<li class="sn-sub">Sem eventos.</li>') + "</ol>" +
      (i.resolvido ? '<p class="sn-sub">Resolvido por ' + esc(i.resolvido.por) + " — motivo: " + esc(i.resolvido.motivo) + "</p>" : "") +
      (S.resolvendo ? '<form id="sn-resolver-form" class="sn-resolver"><label class="vf-field__label" for="sn-motivo">Motivo da resolução <span class="vf-field__required">*</span></label><textarea class="vf-textarea" id="sn-motivo" required maxlength="500" rows="3" placeholder="Ex.: custo cadastrado em Bases; preço ajustado"></textarea><div class="sn-form-actions"><button type="submit" class="vf-btn vf-btn--primary">Confirmar resolução</button> <button type="button" class="vf-btn vf-btn--ghost" id="sn-resolver-cancel">Cancelar</button></div></form>' : "");
    $("#sn-drawer-foot").innerHTML = ctxLinks(i) + '<span class="sn-spacer"></span>' +
      (encerrado ? "" : (i.status === "reconhecido" ? "" : '<button type="button" class="vf-btn vf-btn--sm vf-btn--secondary" id="sn-reconhecer">Reconhecer</button>') + (S.resolvendo ? "" : '<button type="button" class="vf-btn vf-btn--sm vf-btn--primary" id="sn-resolver">Resolver…</button>'));
  }

  async function abrirDrawer(id) {
    lastFocus = document.activeElement;
    S.detalhe = null; S.resolvendo = false; S.acaoErro = null;
    $("#sn-drawer").classList.add("is-open"); $("#sn-backdrop").classList.add("is-open"); $("#sn-drawer").setAttribute("aria-hidden", "false");
    $("#sn-drawer-title").textContent = "Carregando…"; $("#sn-drawer-sub").textContent = ""; $("#sn-drawer-body").innerHTML = '<div class="vf-loading-state"><span class="vf-spinner"></span></div>'; $("#sn-drawer-foot").innerHTML = "";
    $("#sn-drawer-close").focus();
    try { S.detalhe = await api.incidente(id); renderDrawer(); }
    catch (e) { $("#sn-drawer-title").textContent = "Incidente indisponível"; $("#sn-drawer-body").innerHTML = "<p>" + esc(e.status === 404 ? "Incidente não encontrado." : e.message) + "</p>"; }
  }
  function fecharDrawer() {
    S.detalhe = null;
    $("#sn-drawer").classList.remove("is-open"); $("#sn-backdrop").classList.remove("is-open"); $("#sn-drawer").setAttribute("aria-hidden", "true");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  async function acao(fn) {
    S.acaoErro = null;
    const id = S.detalhe.id;
    try { await fn(); S.resolvendo = false; S.detalhe = await api.incidente(id); }
    catch (e) { S.acaoErro = e.message; }
    if (S.detalhe) renderDrawer();
    carregar();
  }

  function bind() {
    const map = { "sn-f-squad": "squad", "sn-f-conta": "conta", "sn-f-tipo": "tipo", "sn-f-status": "status", "sn-f-sev": "severidade", "sn-f-periodo": "periodo" };
    Object.keys(map).forEach((id) => $("#" + id).addEventListener("change", (e) => {
      F[map[id]] = e.target.value;
      if (map[id] === "squad") F.conta = ""; // filtro pai invalida conta incompatível
      carregar();
    }));
    let t = null;
    $("#sn-f-busca").addEventListener("input", (e) => { F.busca = e.target.value; clearTimeout(t); t = setTimeout(carregar, 300); });
    $("#sn-clear").addEventListener("click", () => { Object.assign(F, { squad: "", conta: "", tipo: "", status: "", severidade: "", periodo: "7d", busca: "" }); carregar(); });
    document.addEventListener("click", (e) => {
      const tab = e.target.closest("[data-tab]");
      if (tab) { S.aba = tab.dataset.tab; render(); return; }
      if (e.target.closest("#sn-retry")) return carregar();
      const ac = e.target.closest("[data-alerta-conta]");
      if (ac) { F.conta = ac.dataset.alertaConta; S.aba = "fila"; return carregar(); }
      if (e.target.closest("#sn-reconhecer")) return acao(() => api.reconhecer(S.detalhe.id));
      if (e.target.closest("#sn-resolver")) { S.resolvendo = true; renderDrawer(); const m = $("#sn-motivo"); if (m) m.focus(); return; }
      if (e.target.closest("#sn-resolver-cancel")) { S.resolvendo = false; renderDrawer(); return; }
      const row = e.target.closest("[data-inc]");
      if (row && !e.target.closest("a")) abrirDrawer(row.dataset.inc);
    });
    document.addEventListener("submit", (e) => {
      if (e.target.id !== "sn-resolver-form") return;
      e.preventDefault();
      const motivo = $("#sn-motivo").value.trim();
      if (!motivo) { S.acaoErro = "Informe o motivo da resolução."; renderDrawer(); return; }
      acao(() => api.resolver(S.detalhe.id, { motivo }));
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") fecharDrawer();
      else if (e.key === "Enter" && e.target.matches && e.target.matches("tr[data-inc]")) abrirDrawer(e.target.dataset.inc);
    });
    $("#sn-drawer-close").addEventListener("click", fecharDrawer);
    $("#sn-backdrop").addEventListener("click", fecharDrawer);
  }

  function iniciar() {
    api = DEMO ? root.SENTINEL_MOCK.api : criarApi({ base: apiBase(), getToken: () => lsGet(TOKEN_KEY) });
    carregar();
  }

  function boot() {
    document.body.classList.toggle("sn-demo", DEMO);
    bind();
    if (DEMO) return iniciar();
    if (!lsGet(TOKEN_KEY)) return; // sem token o Shell já está redirecionando p/ o login do Portal
    iniciar();
  }

  if (DEMO) {
    const s = document.createElement("script");
    s.src = "sentinel-mock.js"; s.onload = boot; s.onerror = () => { S.carregando = false; S.erro = "Dados de exemplo indisponíveis."; render(); };
    document.head.appendChild(s);
  } else boot();
})(typeof window !== "undefined" ? window : globalThis);
