// Portal/shopee-admin.js — operação dos grants Shopee LIVE (admin).
// Nunca exibe/loga tokens ou segredos. Todo dado da API entra via textContent.
(function () {
  "use strict";
  var STORAGE_KEY = "vf-token";
  var API_BASE = "https://venforce-server.onrender.com";

  var token = localStorage.getItem(STORAGE_KEY);
  if (!token) { window.location.replace("index.html"); return; }

  var state = { contas: [], statusPorConta: {}, selecionados: {}, refreshing: {}, linksPorConta: {}, resultados: {} };
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = String(text);
    if (cls) e.className = cls;
    return e;
  }
  function fmtData(v) {
    if (!v) return "—";
    var d = new Date(v);
    return isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
  }
  function msg(texto, tipo) { var m = el("div", texto, "msg " + (tipo || "")); return m; }

  async function api(path, opts) {
    opts = opts || {};
    var res;
    try {
      res = await fetch(API_BASE + path, {
        method: opts.method || "GET",
        headers: Object.assign({ Authorization: "Bearer " + token }, opts.body ? { "Content-Type": "application/json" } : {}),
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      return { ok: false, httpStatus: 0, erro: "Falha de rede ao falar com o servidor." };
    }
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (res.status === 401) {
      return { ok: false, httpStatus: 401, erro: "Sessão expirada. Entre novamente no Portal." };
    }
    if (res.status === 403) {
      return { ok: false, httpStatus: 403, erro: "Acesso negado: esta tela exige perfil ADMIN." };
    }
    if (!data) return { ok: false, httpStatus: res.status, erro: "Resposta inválida do servidor (HTTP " + res.status + ")." };
    data.httpStatus = res.status;
    if (!res.ok && data.ok !== false) data.ok = false;
    return data;
  }

  function erroTexto(r) {
    var t = (r.code ? "[" + r.code + "] " : "") + (r.erro || "Erro desconhecido.");
    if (r.causa) t += " Causa: " + r.causa + ".";
    if (r.shopeeError) t += " Shopee: " + (typeof r.shopeeError === "string" ? r.shopeeError : JSON.stringify(r.shopeeError)) + ".";
    if (r.shopeeRequestId) t += " request_id: " + r.shopeeRequestId + ".";
    if (r.dica) t += " Dica: " + r.dica;
    return t;
  }

  // ---------- Topo ----------
  function renderTopo(st) {
    var box = $("topoInfo");
    box.textContent = "";
    if (!st || !st.ok) {
      box.appendChild(msg("Não foi possível obter o status do LIVE: " + (st ? st.erro : ""), "err"));
      return;
    }
    var m = st.marketing || {};
    var w = st.refreshWorker || {};
    var l1 = el("div");
    l1.appendChild(el("strong", "LIVE configurado: "));
    l1.appendChild(document.createTextNode(m.configured ? "✅ sim" : "❌ não"));
    if (!m.configured && m.faltando && m.faltando.length) l1.appendChild(document.createTextNode(" — faltando: " + m.faltando.join(", ")));
    box.appendChild(l1);
    var l2 = el("div");
    l2.appendChild(el("strong", "Worker de refresh: "));
    var t = w.ligado ? "✅ ligado" : "⚠ desligado";
    if (w.ligado) t += " (a cada " + w.intervaloMinutos + " min, margem de " + w.margemMinutos + " min)";
    l2.appendChild(document.createTextNode(t));
    box.appendChild(l2);
    if (m.apiOrigin || m.redirectUrl) {
      var l3 = el("div", "API: " + (m.apiOrigin || "—") + " · Redirect: " + (m.redirectUrl || "—") + (m.transport ? " · Transporte: " + m.transport : ""), "muted");
      box.appendChild(l3);
    }
  }

  // ---------- Status da linha ----------
  function statusLinha(c) {
    var g = c.grant;
    if (state.refreshing[c.clienteContaId]) return "🔄 Refresh";
    if (!g) return "❌ Sem grant";
    var s = state.statusPorConta[c.clienteContaId] || {};
    var erro = g.ultimoErroRefresh || s.ultimoErroRefresh;
    if (erro) return "❌ Erro: " + erro;
    if (g.status !== "active") return g.status;
    if (s.expirado === true) return "⚠ Token expirado";
    if (s.pertoDeExpirar === true) return "⚠ Token expirando";
    if (s.ativo === false) return "inativo";
    return "✅ Conectado";
  }
  function simNao(v) { return v === true ? "sim" : v === false ? "não" : "—"; }

  // ---------- Tabela ----------
  function render() {
    var corpo = $("corpo");
    corpo.textContent = "";
    if (!state.contas.length) {
      var tr0 = el("tr"); var td0 = el("td", "Nenhuma conta Shopee encontrada."); td0.colSpan = 10; tr0.appendChild(td0); corpo.appendChild(tr0);
    }
    state.contas.forEach(function (c) {
      var id = c.clienteContaId;
      var s = state.statusPorConta[id] || {};
      var g = c.grant;
      var tr = el("tr");
      var tdc = el("td"); var cb = document.createElement("input"); cb.type = "checkbox";
      cb.checked = !!state.selecionados[id]; cb.disabled = !c.podeGerarLink;
      cb.setAttribute("aria-label", "Selecionar conta " + id);
      cb.addEventListener("change", function () { if (cb.checked) state.selecionados[id] = true; else delete state.selecionados[id]; atualizaBotaoLinks(); });
      tdc.appendChild(cb); tr.appendChild(tdc);
      tr.appendChild(el("td", c.cliente));
      var tdConta = el("td", "#" + id + " " + (c.conta || "")); tr.appendChild(tdConta);
      tr.appendChild(el("td", g ? g.shopId : (c.lojaVinculada ? c.lojaVinculada + " (vinc.)" : "—"), "mono"));
      tr.appendChild(el("td", statusLinha(c)));
      tr.appendChild(el("td", g ? simNao(s.tokenPresente) : "—"));
      tr.appendChild(el("td", g ? simNao(s.refreshTokenPresente) : "—"));
      tr.appendChild(el("td", g ? fmtData(g.accessTokenExpiraEm) : "—"));
      tr.appendChild(el("td", g ? fmtData(g.ultimoRefreshEm) : "—"));
      var tda = el("td"); var box = el("div", null, "actions");
      var bl = el("button", "Gerar link"); bl.type = "button";
      if (!c.podeGerarLink) {
        bl.disabled = true;
        var motivo = !c.contaAtiva ? "Conta inativa" : !c.clienteAtivo ? "Cliente inativo" : "Não pode gerar link";
        bl.title = motivo; box.appendChild(bl); box.appendChild(el("span", motivo, "muted"));
      } else {
        bl.addEventListener("click", function () { gerarLink(c, bl); });
        box.appendChild(bl);
      }
      if (g) {
        var br = el("button", "Forçar refresh"); br.type = "button";
        br.disabled = !!state.refreshing[id];
        br.addEventListener("click", function () { forcarRefresh(c); });
        box.appendChild(br);
      }
      tda.appendChild(box); tr.appendChild(tda);
      corpo.appendChild(tr);

      var extra = state.linksPorConta[id], res = state.resultados[id];
      if (extra || res) {
        var trd = el("tr", null, "detail"); var tdd = el("td"); tdd.colSpan = 10;
        if (res) tdd.appendChild(res);
        if (extra) tdd.appendChild(renderLink(extra));
        trd.appendChild(tdd); corpo.appendChild(trd);
      }
    });
    atualizaBotaoLinks();
  }

  function atualizaBotaoLinks() {
    var n = Object.keys(state.selecionados).length;
    var b = $("btnLinksSel");
    b.disabled = n === 0 || n > 10;
    b.textContent = "Gerar links dos selecionados" + (n ? " (" + n + ")" : "");
    b.title = n > 10 ? "Máximo de 10 por vez" : "";
  }

  // ---------- Links ----------
  function renderLink(l) {
    var wrap = el("div", null, "linkbox");
    if (!l.ok) { wrap.appendChild(msg(erroTexto(l), "err")); return wrap; }
    wrap.appendChild(el("div", l.url, "mono"));
    var cd = el("div", null, "muted");
    wrap.appendChild(cd);
    l._cd = cd;
    atualizaContagem(l);
    var row = el("div", null, "row");
    var bc = el("button", "Copiar link"); bc.type = "button";
    bc.addEventListener("click", function () { copiar(l.url, bc); });
    var ba = el("a", "Abrir link"); ba.href = l.url; ba.target = "_blank"; ba.rel = "noopener noreferrer";
    ba.className = ""; ba.style.cssText = "padding:7px 12px;border:1px solid #98a1b0;border-radius:6px;background:#fff;color:inherit;text-decoration:none";
    row.appendChild(bc); row.appendChild(ba);
    wrap.appendChild(row);
    return wrap;
  }
  function atualizaContagem(l) {
    if (!l._cd) return;
    var exp = new Date(l.expiraEm).getTime();
    var hora = isNaN(exp) ? "—" : new Date(exp).toLocaleTimeString("pt-BR");
    var min = Math.ceil((exp - Date.now()) / 60000);
    l._cd.textContent = isNaN(exp) ? "Expiração desconhecida." :
      (min > 0 ? "Expira às " + hora + " (faltam ~" + min + " min). Vale uma vez." : "Expirado às " + hora + ". Gere outro link.");
  }
  setInterval(function () {
    Object.keys(state.linksPorConta).forEach(function (k) { var l = state.linksPorConta[k]; if (l && l.ok) atualizaContagem(l); });
  }, 15000);

  async function copiar(texto, btn) {
    var ok = false;
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(texto); ok = true; } } catch (e) { ok = false; }
    if (!ok) {
      var ta = document.createElement("textarea");
      ta.value = texto; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
    }
    var old = btn.textContent;
    btn.textContent = ok ? "Copiado!" : "Falhou ao copiar";
    setTimeout(function () { btn.textContent = old; }, 2000);
  }

  async function gerarLink(c, btn) {
    btn.disabled = true;
    var r = await api("/shopee/live/autorizar", { method: "POST", body: { clienteContaId: c.clienteContaId } });
    btn.disabled = false;
    if (r.ok) {
      state.linksPorConta[c.clienteContaId] = { ok: true, url: r.url, expiraEm: r.stateExpiraEm };
    } else {
      state.linksPorConta[c.clienteContaId] = { ok: false, code: r.code, erro: r.erro };
    }
    render();
  }

  async function gerarLinksSelecionados() {
    var ids = Object.keys(state.selecionados).map(Number);
    if (!ids.length) return;
    var b = $("btnLinksSel"); b.disabled = true;
    var r = await api("/shopee/live/links", { method: "POST", body: { clienteContaIds: ids } });
    var painel = $("painelLinks"), lista = $("listaLinks");
    lista.textContent = "";
    painel.hidden = false;
    if (!r.ok || !Array.isArray(r.links)) {
      lista.appendChild(msg(erroTexto(r), "err"));
      atualizaBotaoLinks();
      return;
    }
    if (r.aviso) lista.appendChild(msg(r.aviso, "warn"));
    lista.appendChild(el("p", "Cada link vale uma vez, por " + (r.validadeMinutos || 10) + " min. Não ficam salvos: copie agora.", "muted"));
    r.links.forEach(function (l) {
      var item = el("div", null, "card");
      item.appendChild(el("strong", "#" + l.clienteContaId + (l.cliente ? " " + l.cliente : "") + (l.conta ? " / " + l.conta : "")));
      var obj = l.ok ? { ok: true, url: l.url, expiraEm: l.expiraEm } : { ok: false, code: l.code, erro: l.erro };
      item.appendChild(renderLink(obj));
      lista.appendChild(item);
    });
    atualizaBotaoLinks();
  }

  // ---------- Refresh ----------
  async function forcarRefresh(c) {
    var id = c.clienteContaId;
    state.refreshing[id] = true; delete state.resultados[id]; render();
    var r = await api("/shopee/live/refresh", { method: "POST", body: { clienteContaId: id } });
    delete state.refreshing[id];
    if (r.ok) {
      state.resultados[id] = msg("Refresh ok. Novo vencimento: " + fmtData(r.accessTokenExpiraEm) + (r.shopeeRequestId ? " · request_id: " + r.shopeeRequestId : ""), "ok");
    } else {
      state.resultados[id] = msg(erroTexto(r), "err");
    }
    render();
    carregar(true);
  }

  // ---------- Carga ----------
  async function carregar(silencioso) {
    var busca = $("busca").value.trim();
    if (!silencioso) $("corpo").textContent = "";
    var res = await Promise.all([
      api("/shopee/live/contas" + (busca ? "?busca=" + encodeURIComponent(busca) : "")),
      api("/shopee/live/status"),
    ]);
    var contas = res[0], st = res[1];
    $("aviso").textContent = "";
    if (!contas.ok) {
      $("aviso").appendChild(msg(erroTexto(contas), "err"));
      if (contas.httpStatus === 401) setTimeout(function () { window.location.replace("index.html"); }, 2500);
      state.contas = [];
    } else {
      state.contas = contas.contas || [];
    }
    state.statusPorConta = {};
    if (st.ok && Array.isArray(st.grants)) st.grants.forEach(function (g) { state.statusPorConta[g.clienteContaId] = g; });
    renderTopo(st);
    render();
  }

  $("btnAtualizar").addEventListener("click", function () { carregar(false); });
  $("btnLinksSel").addEventListener("click", gerarLinksSelecionados);
  $("chkTodos").addEventListener("change", function (e) {
    state.selecionados = {};
    if (e.target.checked) state.contas.filter(function (c) { return c.podeGerarLink; }).slice(0, 10).forEach(function (c) { state.selecionados[c.clienteContaId] = true; });
    render();
  });
  var t = null;
  $("busca").addEventListener("input", function () { clearTimeout(t); t = setTimeout(function () { carregar(false); }, 400); });

  carregar(false);
})();
