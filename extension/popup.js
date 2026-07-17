const API_URL = "https://venforce-server.onrender.com";
const API_BASE = "https://venforce-server.onrender.com";

document.addEventListener("click", (e) => {
  e.stopPropagation();
});

document.addEventListener("DOMContentLoaded", async () => {
  // ==========================
  // ELEMENTOS
  // ==========================
  const loginView = document.getElementById("loginView");
  const appView = document.getElementById("appView");
  const scannerToggle = document.getElementById("scannerToggle");

  const emailInput = document.getElementById("email");
  const senhaInput = document.getElementById("senha");
  const btnLogin = document.getElementById("btnLogin");

  const statusLoginBox = document.getElementById("status");
  const statusAppBox = document.getElementById("statusApp");

  const usuarioNomeBox = document.getElementById("usuarioNome");
  const btnLogout = document.getElementById("btnLogout");

  const filtroBaseInput = document.getElementById("filtroBase");
  const basesSelect = document.getElementById("basesSelect");
  const btnAtualizarBases = document.getElementById("btnAtualizarBases");
  const btnUsarBase = document.getElementById("btnUsarBase");
  const btnDesabilitarBase = document.getElementById("btnDesabilitarBase");
  const btnExcluirBase = document.getElementById("btnExcluirBase");

  const novaBaseNomeInput = document.getElementById("novaBaseNome");
  const novaBaseArquivoInput = document.getElementById("novaBaseArquivo");
  const btnCriarBaseImportar = document.getElementById("btnCriarBaseImportar");
  const fileUploadText = document.getElementById("fileUploadText");

  const baseAtivaCard = document.getElementById("baseAtivaCard");
  const baseAtivaNome = document.getElementById("baseAtivaNome");

  // Stats live
  const liveStatsBox = document.getElementById("liveStats");
  const liveTotal = document.getElementById("liveTotal");
  const liveSau = document.getElementById("liveSau");
  const liveAte = document.getElementById("liveAte");
  const liveCri = document.getElementById("liveCri");
  const liveMcMedio = document.getElementById("liveMcMedio");

  // Preferências
  const prefsToggle = document.getElementById("prefsToggle");
  const prefsBody = document.getElementById("prefsBody");
  const prefsArrow = document.getElementById("prefsArrow");
  const prefThSau = document.getElementById("prefThSau");
  const prefThAte = document.getElementById("prefThAte");
  const prefMcAlvo = document.getElementById("prefMcAlvo");

  const DEFAULT_PREFS = {
    thresholdSaudavel: 10,
    thresholdAtencao: 6,
    margemAlvo: 15
  };

  // File input
  if (novaBaseArquivoInput) {
    novaBaseArquivoInput.addEventListener("change", () => {
      const arquivo = novaBaseArquivoInput.files?.[0];
      if (fileUploadText) {
        fileUploadText.textContent = arquivo ? arquivo.name : "Escolher planilha (.xlsx, .csv)";
      }
    });
  }
  document.querySelectorAll('input[type="file"]').forEach(el => {
    el.addEventListener("click", (e) => e.stopPropagation());
  });
  document.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", (e) => e.stopPropagation());
  });

  let todasAsBases = [];

  // ==========================
  // STATUS
  // ==========================
  function setLoginStatus(message, color = "var(--vf-red)") {
    if (!statusLoginBox) return;
    statusLoginBox.textContent = message || "";
    statusLoginBox.style.color = color;
  }
  function setAppStatus(message, color = "var(--vf-green)") {
    if (!statusAppBox) return;
    statusAppBox.textContent = message || "";
    statusAppBox.style.color = color;
  }
  function clearLoginStatus() { setLoginStatus(""); }
  function clearAppStatus() { setAppStatus(""); }

  // ==========================
  // STORAGE
  // ==========================
  function getStorage(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => resolve(result));
    });
  }
  function setStorage(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set(data, () => resolve());
    });
  }
  function removeStorage(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(keys, () => resolve());
    });
  }

  // ==========================
  // SCANNER TOGGLE
  // ==========================
  function setScannerToggle(ativo) {
    if (scannerToggle) scannerToggle.checked = ativo;
  }
  async function carregarEstadoAtivo() {
    const { venforce_ativo } = await getStorage(["venforce_ativo"]);
    const ativo = venforce_ativo !== false;
    setScannerToggle(ativo);
    return ativo;
  }
  if (scannerToggle) {
    scannerToggle.addEventListener("change", async () => {
      const novo = scannerToggle.checked;
      await setStorage({ venforce_ativo: novo });
      setAppStatus(novo ? "Scanner ativado." : "Scanner desativado.", novo ? "var(--vf-green)" : "var(--vf-text-l)");
    });
  }

  // ==========================
  // VIEW SWITCHING
  // ==========================
  function showLoginView() {
    if (loginView) loginView.style.display = "block";
    if (appView) appView.style.display = "none";
    clearAppStatus();
  }
  function showAppView() {
    if (loginView) loginView.style.display = "none";
    if (appView) appView.style.display = "block";
    clearLoginStatus();
  }

  // ==========================
  // API
  // ==========================
  async function apiFetch(path, options = {}) {
    const { token } = await getStorage(["token"]);
    const headers = { ...(options.headers || {}) };
    if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const response = await fetch(`${API_URL}${path}`, { ...options, headers });
    let data = {};
    try { data = await response.json(); } catch { data = {}; }

    if (response.status === 401) {
      await removeStorage(["token","usuario","user","venforce_user","venforce_email","email","baseSelecionada"]);
      showLoginView();
      throw new Error(data.erro || "Sessão expirada. Faça login novamente.");
    }
    if (!response.ok) {
      throw new Error(data.erro || data.message || `Erro HTTP ${response.status}`);
    }
    return data;
  }

  // ==========================
  // LOGIN / LOGOUT
  // ==========================
  async function login(email, password) {
    clearLoginStatus();
    const response = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    let data = {};
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) throw new Error(data.erro || data.message || "Falha no login");
    if (!data.token) throw new Error("Token não recebido no login");

    const usuario = data.usuario || data.user || { email };
    await setStorage({
      token: data.token,
      usuario, user: usuario,
      venforce_user: usuario,
      venforce_email: usuario?.email || email,
      email: usuario?.email || email
    });
    return data;
  }

  async function logout() {
    await removeStorage(["token","usuario","user","venforce_user","venforce_email","email","baseSelecionada"]);
    if (emailInput) emailInput.value = "";
    if (senhaInput) senhaInput.value = "";
    if (basesSelect) basesSelect.innerHTML = `<option value="">Selecionar base</option>`;
    if (filtroBaseInput) filtroBaseInput.value = "";
    if (novaBaseNomeInput) novaBaseNomeInput.value = "";
    if (novaBaseArquivoInput) novaBaseArquivoInput.value = "";
    if (fileUploadText) fileUploadText.textContent = "Escolher planilha (.xlsx, .csv)";
    todasAsBases = [];
    showLoginView();
    setLoginStatus("Você saiu da conta.", "var(--vf-text-l)");
  }

  // ==========================
  // USUÁRIO
  // ==========================
  async function preencherUsuario() {
    const storage = await getStorage(["usuario", "user", "venforce_user"]);
    const usuario = storage.usuario || storage.user || storage.venforce_user || null;
    if (!usuarioNomeBox) return;

    if (usuario?.nome) usuarioNomeBox.textContent = usuario.nome;
    else if (usuario?.email) usuarioNomeBox.textContent = usuario.email;
    else usuarioNomeBox.textContent = "Usuário logado";

    const avatar = document.getElementById("userAvatar");
    if (avatar) {
      const nome = usuario?.nome || usuario?.email || "V";
      avatar.textContent = nome.charAt(0).toUpperCase();
    }
  }

  // ==========================
  // BASES
  // ==========================
  function normalizarListaBases(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.bases)) return payload.bases;
    if (Array.isArray(payload?.dados)) return payload.dados;
    if (Array.isArray(payload?.resultado)) return payload.resultado;
    return [];
  }
  function getBaseValue(base) {
    return base?.slug || base?.id || base?.nome || base?.baseId || base?.value || "";
  }
  function getBaseLabel(base) {
    return base?.nomeExibicao || base?.nome || base?.titulo || base?.label || getBaseValue(base) || "Base sem nome";
  }

  function renderBases(lista) {
    if (!basesSelect) return;
    basesSelect.innerHTML = `<option value="">Selecionar base</option>`;
    if (!lista.length) {
      basesSelect.innerHTML = `<option value="">Nenhuma base encontrada</option>`;
      return;
    }
    lista.forEach((base) => {
      const option = document.createElement("option");
      option.value = getBaseValue(base);
      option.textContent = getBaseLabel(base);
      basesSelect.appendChild(option);
    });
  }

  async function aplicarBaseSalva() {
    const { baseSelecionada } = await getStorage(["baseSelecionada"]);
    if (!basesSelect) return;

    if (!baseSelecionada) {
      setAppStatus("Selecione uma base para continuar.", "var(--vf-text-l)");
      if (baseAtivaCard) baseAtivaCard.classList.remove("visible");
      return;
    }

    const existe = [...basesSelect.options].some((option) => option.value === baseSelecionada);
    if (existe) {
      basesSelect.value = baseSelecionada;
      const texto = basesSelect.options[basesSelect.selectedIndex]?.textContent || baseSelecionada;
      setAppStatus(`Base ativa: ${texto}`, "var(--vf-green)");
      if (baseAtivaCard && baseAtivaNome) {
        baseAtivaNome.textContent = texto;
        baseAtivaCard.classList.add("visible");
      }
    } else {
      setAppStatus("Selecione uma base para continuar.", "var(--vf-text-l)");
      if (baseAtivaCard) baseAtivaCard.classList.remove("visible");
    }
  }

  async function carregarBases() {
    if (!basesSelect) return;
    setAppStatus("Carregando bases...", "var(--vf-text-l)");
    basesSelect.disabled = true;
    basesSelect.innerHTML = `<option value="">Carregando...</option>`;

    try {
      const response = await apiFetch("/bases");
      todasAsBases = normalizarListaBases(response);
      renderBases(todasAsBases);

      if (!todasAsBases.length) {
        basesSelect.disabled = false;
        setAppStatus("Nenhuma base encontrada para este usuário.", "var(--vf-red)");
        return;
      }
      await aplicarBaseSalva();
      basesSelect.disabled = false;
    } catch (error) {
      console.error("[VenForce] erro ao carregar bases:", error);
      basesSelect.innerHTML = `<option value="">Erro ao carregar bases</option>`;
      basesSelect.disabled = false;
      setAppStatus(error.message || "Erro ao carregar bases.", "var(--vf-red)");
    }
  }

  async function salvarBaseSelecionada() {
    const base = basesSelect?.value || "";
    if (!base) {
      setAppStatus("Selecione uma base antes de continuar.", "var(--vf-red)");
      return false;
    }
    await setStorage({ baseSelecionada: base });
    const texto = basesSelect.options[basesSelect.selectedIndex]?.textContent || base;
    setAppStatus(`Base selecionada: ${texto}`, "var(--vf-green)");
    if (baseAtivaCard && baseAtivaNome) {
      baseAtivaNome.textContent = texto;
      baseAtivaCard.classList.add("visible");
    }
    return true;
  }

  function filtrarBases() {
    const termo = String(filtroBaseInput?.value || "").trim().toLowerCase();
    if (!termo) {
      renderBases(todasAsBases);
      aplicarBaseSalva();
      return;
    }
    const filtradas = todasAsBases.filter((base) => getBaseLabel(base).toLowerCase().includes(termo));
    renderBases(filtradas);
  }

  // ==========================
  // IMPORTAR PLANILHA
  // ==========================
  async function criarBaseEImportar() {
    const nomeBase = String(novaBaseNomeInput?.value || "").trim();
    const arquivo = novaBaseArquivoInput?.files?.[0];

    if (!nomeBase) {
      setAppStatus("Informe o nome da base.", "var(--vf-red)");
      return;
    }
    if (!arquivo) {
      setAppStatus("Selecione uma planilha para criar a base.", "var(--vf-red)");
      return;
    }

    if (btnCriarBaseImportar) {
      btnCriarBaseImportar.disabled = true;
      btnCriarBaseImportar.textContent = "Importando...";
    }

    setAppStatus("Criando base e importando planilha...", "var(--vf-text-l)");

    try {
      const { token } = await chrome.storage.local.get("token");

      async function enviarImportacao(confirmar) {
        const fd = new FormData();
        fd.append("arquivo", arquivo);
        fd.append("nomeBase", nomeBase);
        if (confirmar) fd.append("confirmar", "true");

        const res = await fetch(`${API_BASE}/importar-base`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd
        });
        const text = await res.text();
        let response = {};
        try { response = text ? JSON.parse(text) : {}; }
        catch { throw new Error("Resposta do servidor inválida (verifique /importar-base)."); }
        if (!res.ok) throw new Error(response?.erro || response?.message || response?.detalhe || `Erro HTTP ${res.status}`);
        return response;
      }

      function mostrarPreviewModal(payload) {
        return new Promise((resolve) => {
          const overlay = document.createElement("div");
          overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);";
          overlay.addEventListener("click", (e) => e.stopPropagation());

          const card = document.createElement("div");
          card.style.cssText = "width:92%;max-width:360px;background:#fff;border-radius:14px;padding:16px;box-shadow:0 16px 40px rgba(0,0,0,0.25);font-family:inherit;";

          const titulo = document.createElement("div");
          titulo.textContent = "Pré-visualização da importação";
          titulo.style.cssText = "font-weight:700;font-size:14px;margin-bottom:8px;color:var(--vf-text);";

          const meta = document.createElement("div");
          meta.style.cssText = "font-size:11.5px;color:var(--vf-text-l);margin-bottom:10px;";
          meta.textContent = `Total linhas: ${payload.total || 0} · IDs: ${payload.idsDetectados || 0} · Coluna: ${payload.colunaId || "—"}`;

          const tableWrap = document.createElement("div");
          tableWrap.style.cssText = "max-height:220px;overflow:auto;border:1px solid var(--vf-line);border-radius:8px;";

          const table = document.createElement("table");
          table.style.cssText = "width:100%;border-collapse:collapse;font-size:11.5px;";

          const thead = document.createElement("thead");
          const headRow = document.createElement("tr");
          ["ID", "Custo", "Imposto", "Taxa"].forEach((h) => {
            const th = document.createElement("th");
            th.textContent = h;
            th.style.cssText = "text-align:left;padding:7px;border-bottom:1px solid var(--vf-line);background:var(--vf-bg-soft);font-size:10.5px;text-transform:uppercase;letter-spacing:0.04em;color:var(--vf-text-l);";
            headRow.appendChild(th);
          });
          thead.appendChild(headRow);

          const tbody = document.createElement("tbody");
          (payload.preview || []).forEach((r) => {
            const tr = document.createElement("tr");
            const cols = [r?.id ?? "", r?.custo_produto ?? "", r?.imposto_percentual ?? "", r?.taxa_fixa ?? ""];
            cols.forEach((v) => {
              const td = document.createElement("td");
              td.textContent = String(v);
              td.style.cssText = "padding:6px 7px;border-bottom:1px solid #f2f2f2;color:var(--vf-text);";
              tr.appendChild(td);
            });
            tbody.appendChild(tr);
          });

          table.appendChild(thead);
          table.appendChild(tbody);
          tableWrap.appendChild(table);

          const actions = document.createElement("div");
          actions.style.cssText = "display:flex;gap:8px;margin-top:12px;";

          const cancelar = document.createElement("button");
          cancelar.type = "button";
          cancelar.textContent = "Cancelar";
          cancelar.className = "btn-secondary";
          cancelar.style.cssText = "flex:1;padding:9px;border-radius:10px;font-weight:600;font-size:12px;font-family:inherit;cursor:pointer;background:var(--vf-purple-soft);color:var(--vf-purple-deep);border:1px solid var(--vf-purple-line);";
          cancelar.addEventListener("click", (e) => { e.stopPropagation(); overlay.remove(); resolve(false); });

          const confirmar = document.createElement("button");
          confirmar.type = "button";
          confirmar.textContent = "Confirmar";
          confirmar.style.cssText = "flex:1;padding:9px;border-radius:10px;font-weight:600;font-size:12px;font-family:inherit;cursor:pointer;background:linear-gradient(135deg,#7d4dff,#5b2be0);color:white;border:none;";
          confirmar.addEventListener("click", (e) => { e.stopPropagation(); overlay.remove(); resolve(true); });

          actions.appendChild(cancelar);
          actions.appendChild(confirmar);
          card.appendChild(titulo);
          card.appendChild(meta);
          card.appendChild(tableWrap);
          card.appendChild(actions);
          overlay.appendChild(card);
          document.body.appendChild(overlay);
        });
      }

      const previewResponse = await enviarImportacao(false);
      if (previewResponse?.preview) {
        const ok = await mostrarPreviewModal(previewResponse);
        if (!ok) {
          setAppStatus("Importação cancelada.", "var(--vf-text-l)");
          return;
        }
      }

      const response = await enviarImportacao(true);
      await setStorage({ baseSelecionada: nomeBase });
      await carregarBases();
      await aplicarBaseSalva();

      setAppStatus(
        response?.mensagem
          ? `${response.mensagem} (${response.total || 0} IDs)`
          : "Base criada e planilha importada com sucesso.",
        "var(--vf-green)"
      );

      if (novaBaseNomeInput) novaBaseNomeInput.value = "";
      if (novaBaseArquivoInput) novaBaseArquivoInput.value = "";
      if (fileUploadText) fileUploadText.textContent = "Escolher planilha (.xlsx, .csv)";
    } catch (error) {
      console.error("[VenForce] erro ao criar base/importar planilha:", error);
      setAppStatus(error.message || "Erro ao criar base/importar planilha.", "var(--vf-red)");
    } finally {
      if (btnCriarBaseImportar) {
        btnCriarBaseImportar.disabled = false;
        btnCriarBaseImportar.textContent = "Criar base e importar";
      }
    }
  }

  // ==========================
  // STATS AO VIVO da aba atual
  // ==========================
  async function atualizarStatsLive() {
    if (!liveStatsBox) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/mercadolivre\.com\.br/i.test(tab.url || "")) {
        liveStatsBox.classList.remove("visible");
        return;
      }

      // Lê o estado direto do Shadow DOM usando data attributes estáveis.
      // Não depende de propriedades JS internas do content script.
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const overlay = document.getElementById("venforce-overlay-root");
          const root = overlay?.shadowRoot;
          if (!root) return null;

          const boxes = root.querySelectorAll("[data-vf-key]");
          let total = 0, sau = 0, ate = 0, cri = 0, semCusto = 0;
          const mcs = [];

          boxes.forEach(box => {
            const display = window.getComputedStyle(box).display;
            if (display === "none") return;
            total++;
            const status = box.getAttribute("data-vf-status");
            if (status === "saudavel") sau++;
            else if (status === "atencao") ate++;
            else if (status === "critico") cri++;
            else if (status === "sem_custo") semCusto++;

            const mc = Number(box.getAttribute("data-vf-mc"));
            if (Number.isFinite(mc)) mcs.push(mc);
          });

          const mcMedio = mcs.length ? mcs.reduce((s,v)=>s+v,0)/mcs.length : 0;
          return { total, sau, ate, cri, semCusto, mcMedio, comDados: mcs.length };
        }
      }).catch(() => [{ result: null }]);

      if (!result || !result.total) {
        liveStatsBox.classList.remove("visible");
        return;
      }

      liveTotal.textContent = result.total;
      liveSau.textContent = result.sau;
      liveAte.textContent = result.ate;
      liveCri.textContent = result.cri;

      if (result.comDados > 0) {
        liveMcMedio.innerHTML = `MC médio: <b>${result.mcMedio.toFixed(2)}%</b>`;
      } else {
        liveMcMedio.textContent = "";
      }

      liveStatsBox.classList.add("visible");
    } catch (e) {
      liveStatsBox.classList.remove("visible");
    }
  }

  // ==========================
  // PREFERÊNCIAS
  // ==========================
  async function carregarPrefs() {
    const { vf_prefs } = await getStorage(["vf_prefs"]);
    const prefs = { ...DEFAULT_PREFS, ...(vf_prefs || {}) };
    if (prefThSau) prefThSau.value = prefs.thresholdSaudavel;
    if (prefThAte) prefThAte.value = prefs.thresholdAtencao;
    if (prefMcAlvo) prefMcAlvo.value = prefs.margemAlvo;
  }

  async function salvarPrefField(field, valor) {
    const { vf_prefs } = await getStorage(["vf_prefs"]);
    const prefs = { ...DEFAULT_PREFS, ...(vf_prefs || {}) };
    prefs[field] = valor;
    await setStorage({ vf_prefs: prefs });
  }

  if (prefThSau) {
    prefThSau.addEventListener("change", async () => {
      const v = Number(prefThSau.value);
      if (Number.isFinite(v) && v >= 0 && v <= 100) {
        await salvarPrefField("thresholdSaudavel", v);
        setAppStatus("Threshold de saudável atualizado.", "var(--vf-green)");
      }
    });
  }
  if (prefThAte) {
    prefThAte.addEventListener("change", async () => {
      const v = Number(prefThAte.value);
      if (Number.isFinite(v) && v >= 0 && v <= 100) {
        await salvarPrefField("thresholdAtencao", v);
        setAppStatus("Threshold de atenção atualizado.", "var(--vf-green)");
      }
    });
  }
  if (prefMcAlvo) {
    prefMcAlvo.addEventListener("change", async () => {
      const v = Number(prefMcAlvo.value);
      if (Number.isFinite(v) && v >= 0 && v <= 100) {
        await salvarPrefField("margemAlvo", v);
        setAppStatus("Margem alvo atualizada.", "var(--vf-green)");
      }
    });
  }

  // Accordion
  if (prefsToggle && prefsBody && prefsArrow) {
    prefsToggle.addEventListener("click", () => {
      const open = prefsBody.classList.toggle("open");
      prefsArrow.classList.toggle("open", open);
    });
  }

  // ==========================
  // RESTAURAR SESSÃO
  // ==========================
  async function restaurarSessao() {
    const { token } = await getStorage(["token"]);
    if (!token) {
      showLoginView();
      return;
    }
    try {
      await apiFetch("/auth/me");
      showAppView();
      await preencherUsuario();
      await carregarBases();
      await carregarPrefs();
      atualizarStatsLive();
    } catch (error) {
      console.error("[VenForce] erro ao restaurar sessão:", error);
      await removeStorage(["token","usuario","user","venforce_user","venforce_email","email","baseSelecionada"]);
      showLoginView();
      setLoginStatus("Faça login para continuar.", "var(--vf-text-l)");
    }
  }

  // ==========================
  // EVENTOS
  // ==========================
  if (btnLogin) {
    btnLogin.addEventListener("click", async () => {
      const email = emailInput?.value?.trim() || "";
      const password = senhaInput?.value || "";
      if (!email || !password) {
        setLoginStatus("Preencha email e senha.", "var(--vf-red)");
        return;
      }
      setLoginStatus("Entrando...", "var(--vf-text-l)");
      try {
        await login(email, password);
        showAppView();
        await preencherUsuario();
        await carregarBases();
        await carregarPrefs();
        atualizarStatsLive();
      } catch (error) {
        console.error("[VenForce] erro no login:", error);
        setLoginStatus(error.message || "Erro ao fazer login.", "var(--vf-red)");
      }
    });
  }

  if (senhaInput) {
    senhaInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        btnLogin?.click();
      }
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      try { await logout(); }
      catch (error) {
        console.error("[VenForce] erro no logout:", error);
        setAppStatus("Erro ao sair da conta.", "var(--vf-red)");
      }
    });
  }

  if (btnAtualizarBases) {
    btnAtualizarBases.addEventListener("click", () => carregarBases());
  }

  if (btnUsarBase) {
    btnUsarBase.addEventListener("click", async () => {
      btnUsarBase.disabled = true;
      try { await salvarBaseSelecionada(); }
      finally { btnUsarBase.disabled = false; }
    });
  }

  if (btnDesabilitarBase) {
    btnDesabilitarBase.addEventListener("click", async () => {
      const baseSelecionadaUI = basesSelect?.value || "";
      if (!baseSelecionadaUI) {
        setAppStatus("Selecione uma base antes de desabilitar.", "var(--vf-red)");
        return;
      }
      const baseAtualStorage = (await getStorage(["baseSelecionada"]))?.baseSelecionada;

      try {
        setAppStatus("Desabilitando base...", "var(--vf-text-l)");
        await apiFetch(`/bases/${encodeURIComponent(baseSelecionadaUI)}/desabilitar`, { method: "POST" });
        await carregarBases();

        if (String(baseAtualStorage || "") === String(baseSelecionadaUI || "")) {
          const novoBase = [...(basesSelect?.options || [])].find((opt) => opt.value)?.value || "";
          await setStorage({ baseSelecionada: novoBase });
          if (basesSelect) basesSelect.value = novoBase;
          if (novoBase) {
            const texto = basesSelect.options[basesSelect.selectedIndex]?.textContent || novoBase;
            setAppStatus(`Base desabilitada. Nova base: ${texto}`, "var(--vf-green)");
          } else {
            setAppStatus("Base desabilitada. Nenhuma base restante.", "var(--vf-text-l)");
          }
        } else {
          setAppStatus("Base desabilitada com sucesso.", "var(--vf-green)");
        }
      } catch (error) {
        console.error("[VenForce] erro ao desabilitar base:", error);
        setAppStatus(error.message || "Erro ao desabilitar base.", "var(--vf-red)");
      }
    });
  }

  if (btnExcluirBase) {
    btnExcluirBase.addEventListener("click", async () => {
      const baseSelecionadaUI = basesSelect?.value || "";
      if (!baseSelecionadaUI) {
        setAppStatus("Selecione uma base antes de excluir.", "var(--vf-red)");
        return;
      }
      const nomeBase = basesSelect.options[basesSelect.selectedIndex]?.textContent || baseSelecionadaUI;
      if (!confirm(`Tem certeza que deseja EXCLUIR permanentemente a base "${nomeBase}"?\nEsta ação não pode ser desfeita.`)) return;

      try {
        setAppStatus("Excluindo base...", "var(--vf-text-l)");
        btnExcluirBase.disabled = true;
        await apiFetch(`/bases/${encodeURIComponent(baseSelecionadaUI)}`, { method: "DELETE" });

        const { baseSelecionada } = await getStorage(["baseSelecionada"]);
        if (String(baseSelecionada || "") === String(baseSelecionadaUI || "")) {
          await setStorage({ baseSelecionada: "" });
        }
        await carregarBases();
        setAppStatus(`Base "${nomeBase}" excluída com sucesso.`, "var(--vf-green)");
      } catch (error) {
        console.error("[VenForce] erro ao excluir base:", error);
        setAppStatus(error.message || "Erro ao excluir base.", "var(--vf-red)");
      } finally {
        btnExcluirBase.disabled = false;
      }
    });
  }

  if (basesSelect) {
    basesSelect.addEventListener("change", () => salvarBaseSelecionada());
  }
  if (filtroBaseInput) {
    filtroBaseInput.addEventListener("input", () => filtrarBases());
  }
  if (btnCriarBaseImportar) {
    btnCriarBaseImportar.addEventListener("click", () => criarBaseEImportar());
  }

  // Atualiza stats da aba periodicamente enquanto popup está aberto
  let liveStatsInterval = null;
  function startLiveStatsPolling() {
    if (liveStatsInterval) return;
    liveStatsInterval = setInterval(atualizarStatsLive, 1500);
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && liveStatsInterval) {
      clearInterval(liveStatsInterval);
      liveStatsInterval = null;
    } else if (document.visibilityState === "visible") {
      atualizarStatsLive();
      startLiveStatsPolling();
    }
  });

  // ==========================
  // INÍCIO
  // ==========================
  await carregarEstadoAtivo();
  await restaurarSessao();
  startLiveStatsPolling();
});
