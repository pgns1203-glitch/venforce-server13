(function () {
  "use strict";

  const studio = window.VF_DESIGN_TEMPLATE_STUDIO;
  const apiLib = window.VF_DESIGN_STUDIO_API;
  if (!studio || !apiLib) return;

  const api = apiLib.createDesignStudioApi({
    baseUrl: studio.API_BASE,
    getToken: () => localStorage.getItem("vf-token"),
  });
  const state = { clients: [], clientId: null, workspace: null, tab: "templates", archived: false, search: "" };
  const byId = (id) => document.getElementById(id);
  const typePath = (type) => type === "artwork" ? "artworks" : "templates";
  const typeLabel = (type) => type === "artwork" ? "arte" : "template";

  function escapeColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
  }

  function setLoading(active) {
    byId("ds-loading").hidden = !active;
    byId("ds-content").hidden = active;
  }

  function toast(mode, title, message) {
    studio.showToast(mode, title, message);
  }

  function selectedClient() {
    const client = state.clients.find((item) => Number(item.id) === Number(state.clientId));
    if (!client) return null;
    return {
      ...client,
      brand_name: state.workspace?.profile?.brand_name || client.brand_name,
      identity: state.workspace?.profile?.identity || client.identity,
    };
  }

  function renderClientSelect() {
    const select = byId("ds-client-select");
    select.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Selecione um cliente";
    select.appendChild(placeholder);
    state.clients.forEach((client) => {
      const option = document.createElement("option");
      option.value = String(client.id);
      option.textContent = client.nome;
      select.appendChild(option);
    });
    select.value = state.clientId ? String(state.clientId) : "";
  }

  function renderIdentity() {
    const profile = state.workspace?.profile || {};
    const identity = profile.identity || {};
    byId("ds-brand-name").value = profile.brand_name || state.workspace?.client?.nome || "";
    byId("ds-primary").value = escapeColor(identity.primary, "#5A2A8F");
    byId("ds-secondary").value = escapeColor(identity.secondary, "#F2B84B");
    byId("ds-background").value = escapeColor(identity.background, "#F7F4FA");
    byId("ds-text").value = escapeColor(identity.text, "#21162C");
    byId("ds-font").value = identity.fontFamily || "Manrope";
    byId("ds-identity-notes").value = identity.notes || "";
    const logo = identity.logo?.dataUrl;
    const preview = byId("ds-logo-preview");
    preview.hidden = !logo;
    if (logo) preview.src = logo;
    else preview.removeAttribute("src");
  }

  function renderAccounts() {
    const list = byId("ds-account-list");
    const accounts = state.workspace?.accounts || [];
    const accountSelect = byId("ds-art-account");
    accountSelect.replaceChildren();
    const allAccounts = document.createElement("option");
    allAccounts.value = "";
    allAccounts.textContent = "Todas / não definida";
    accountSelect.appendChild(allAccounts);
    accounts.forEach((account) => {
      const option = document.createElement("option");
      option.value = account.account_ref;
      option.textContent = account.display_name;
      accountSelect.appendChild(option);
    });
    if (!accounts.length) {
      const empty = document.createElement("p");
      empty.className = "ds-muted";
      empty.textContent = "Nenhuma conta ou base vinculada disponível.";
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...accounts.map((account) => {
      const item = document.createElement("div");
      item.className = "ds-account";
      const mark = document.createElement("span");
      mark.className = `ds-market ds-market--${account.marketplace}`;
      mark.textContent = account.marketplace === "meli" ? "ML" : account.marketplace === "shopee" ? "SH" : "MP";
      const text = document.createElement("span");
      const strong = document.createElement("strong");
      strong.textContent = account.display_name;
      const small = document.createElement("small");
      small.textContent = account.status === "connected" ? "Conectada" : account.status === "linked" ? "Vinculada" : "Requer atenção";
      text.append(strong, small);
      item.append(mark, text);
      return item;
    }));
  }

  function previewFor(item) {
    const preview = item.preview_json || {};
    const designDocument = item.document_json || {};
    const palette = preview.palette || designDocument.palette || {};
    const visual = document.createElement("div");
    visual.className = "ds-card__visual";
    visual.style.setProperty("--ds-p", escapeColor(palette.primary, "#5A2A8F"));
    visual.style.setProperty("--ds-s", escapeColor(palette.secondary, "#F2B84B"));
    visual.style.setProperty("--ds-b", escapeColor(palette.background, "#F7F4FA"));
    const pages = Array.isArray(designDocument.pages) ? designDocument.pages.length : 0;
    for (let i = 0; i < Math.min(Math.max(pages, 3), 5); i += 1) {
      const page = document.createElement("span");
      page.style.transform = `translate(${i * 11}px, ${i * -3}px) rotate(${i * 1.3}deg)`;
      visual.appendChild(page);
    }
    return visual;
  }

  function button(label, className, handler) {
    const result = document.createElement("button");
    result.type = "button";
    result.className = className || "vf-btn vf-btn--ghost vf-btn--sm";
    result.textContent = label;
    result.addEventListener("click", handler);
    return result;
  }

  async function openItem(item) {
    const type = item.item_type || (state.tab === "artworks" ? "artwork" : "template");
    if (!window.VF_DESIGN_BUILDER_API) {
      toast("danger", "Editor indisponível", "Recarregue a página e tente novamente.");
      return;
    }
    const designDocument = JSON.parse(JSON.stringify(item.document_json || {}));
    if (designDocument.usesClientIdentity && !designDocument.logo?.dataUrl) {
      designDocument.logo = state.workspace?.profile?.identity?.logo || {};
    }
    window.VF_DESIGN_BUILDER_API.openProject(designDocument, {
      type,
      id: item.id,
      clienteId: item.cliente_id,
      name: item.name,
    });
  }

  async function mutate(action, success) {
    try {
      await action();
      toast("success", success, "O acervo compartilhado foi atualizado.");
      await loadWorkspace();
    } catch (error) {
      toast("danger", "Não foi possível concluir", error.message);
    }
  }

  async function createArtwork(item) {
    await mutate(async () => {
      const response = await api.createItem(state.clientId, "artworks", {
        name: `${item.name} — nova arte`,
        templateId: item.id,
        accountRef: byId("ds-art-account").value || null,
        document: {},
        preview: {},
      });
      await openItem({ ...response.item, item_type: "artwork" });
    }, "Arte criada");
  }

  async function showVersions(item) {
    const type = item.item_type || (state.tab === "artworks" ? "artwork" : "template");
    try {
      const response = await api.listVersions(state.clientId, typePath(type), item.id);
      const overlay = byId("ds-versions-overlay");
      byId("ds-versions-title").textContent = `Versões de ${item.name}`;
      const list = byId("ds-versions-list");
      list.replaceChildren(...response.versions.map((version) => {
        const row = document.createElement("div");
        row.className = "ds-version-row";
        const text = document.createElement("span");
        text.textContent = `V${version.version_number} · ${new Date(version.created_at).toLocaleString("pt-BR")}`;
        const restore = button("Restaurar", "vf-btn vf-btn--secondary vf-btn--sm", async () => {
          await mutate(
            () => api.restoreVersion(state.clientId, typePath(type), item.id, version.version_number),
            `Versão ${version.version_number} restaurada`
          );
          overlay.classList.remove("is-open");
        });
        row.append(text, restore);
        return row;
      }));
      overlay.classList.add("is-open");
      overlay.setAttribute("aria-hidden", "false");
    } catch (error) {
      toast("danger", "Versões indisponíveis", error.message);
    }
  }

  function itemCard(item) {
    const type = item.item_type || (state.tab === "artworks" ? "artwork" : "template");
    const card = document.createElement("article");
    card.className = "vf-card ds-card";
    card.appendChild(previewFor(item));
    const body = document.createElement("div");
    body.className = "ds-card__body";
    const eyebrow = document.createElement("span");
    eyebrow.className = "ds-card__eyebrow";
    eyebrow.textContent = type === "artwork" ? "Arte" : item.origin === "generated" ? "Gerado" : "Criado manualmente";
    const title = document.createElement("h3");
    title.textContent = item.name;
    const meta = document.createElement("p");
    const pages = Array.isArray(item.document_json?.pages) ? item.document_json.pages.length : 0;
    meta.textContent = `${pages} ${pages === 1 ? "página" : "páginas"} · Atualizado ${new Date(item.updated_at).toLocaleDateString("pt-BR")}`;
    const actions = document.createElement("div");
    actions.className = "ds-card__actions";
    if (!state.archived) {
      actions.appendChild(button("Editar", "vf-btn vf-btn--primary vf-btn--sm", () => openItem(item)));
      if (type === "template") actions.appendChild(button("Criar arte", "vf-btn vf-btn--secondary vf-btn--sm", () => createArtwork(item)));
      actions.appendChild(button("Duplicar", "vf-btn vf-btn--ghost vf-btn--sm", () => mutate(
        () => api.duplicateItem(state.clientId, typePath(type), item.id), `${typeLabel(type)} duplicado`
      )));
      actions.appendChild(button("Versões", "vf-btn vf-btn--ghost vf-btn--sm", () => showVersions(item)));
      actions.appendChild(button("Arquivar", "vf-btn vf-btn--ghost vf-btn--sm", () => mutate(
        () => api.archiveItem(state.clientId, typePath(type), item.id, true), `${typeLabel(type)} arquivado`
      )));
    } else {
      actions.appendChild(button("Restaurar", "vf-btn vf-btn--secondary vf-btn--sm", () => mutate(
        () => api.archiveItem(state.clientId, typePath(type), item.id, false), `${typeLabel(type)} restaurado`
      )));
    }
    body.append(eyebrow, title, meta, actions);
    card.appendChild(body);
    return card;
  }

  function renderItems() {
    const items = state.archived
      ? [...(state.workspace?.templates || []), ...(state.workspace?.artworks || [])]
      : state.tab === "artworks" ? state.workspace?.artworks || [] : state.workspace?.templates || [];
    byId("ds-items-title").textContent = state.archived ? "Itens arquivados" : state.tab === "artworks" ? "Artes" : "Templates";
    byId("ds-items-count").textContent = String(items.length);
    byId("ds-grid").replaceChildren(...items.map(itemCard));
    byId("ds-empty").hidden = items.length > 0;
  }

  function renderWorkspace() {
    const client = state.workspace?.client;
    byId("ds-workspace-name").textContent = client?.nome || "Cliente";
    byId("ds-workspace-slug").textContent = client?.slug || "";
    renderIdentity();
    renderAccounts();
    renderItems();
  }

  async function loadWorkspace() {
    if (!state.clientId) return;
    setLoading(true);
    try {
      const response = await api.getWorkspace(state.clientId, { archived: state.archived, search: state.search });
      state.workspace = response;
      renderWorkspace();
    } catch (error) {
      toast("danger", "Estúdio indisponível", error.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveIdentity() {
    const logo = byId("ds-logo-preview").src && !byId("ds-logo-preview").hidden
      ? { dataUrl: byId("ds-logo-preview").src, fileName: byId("ds-logo-file").files?.[0]?.name || "logo" }
      : {};
    await mutate(() => api.saveIdentity(state.clientId, {
      brandName: byId("ds-brand-name").value,
      identity: {
        primary: byId("ds-primary").value,
        secondary: byId("ds-secondary").value,
        background: byId("ds-background").value,
        text: byId("ds-text").value,
        fontFamily: byId("ds-font").value,
        notes: byId("ds-identity-notes").value,
        logo,
      },
    }), "Identidade salva");
  }

  async function saveDocument(project, context) {
    if (!state.clientId) throw new Error("Selecione um cliente antes de salvar.");
    const type = context?.type === "artwork" ? "artworks" : "templates";
    const body = {
      name: project.name || context?.name || (type === "artworks" ? "Nova arte" : "Novo template"),
      document: project,
      preview: { palette: project.palette, pages: project.pages },
      origin: project.origin === "gerado" ? "generated" : "manual",
    };
    const response = context?.id
      ? await api.updateItem(state.clientId, type, context.id, body)
      : await api.createItem(state.clientId, type, body);
    await loadWorkspace();
    return { type: type === "artworks" ? "artwork" : "template", id: response.item.id, clienteId: state.clientId, name: response.item.name };
  }

  function bind() {
    byId("ds-client-select").addEventListener("change", (event) => {
      state.clientId = Number(event.target.value) || null;
      if (state.clientId) sessionStorage.setItem("vf-design-client-id", String(state.clientId));
      loadWorkspace();
    });
    byId("ds-save-identity").addEventListener("click", saveIdentity);
    byId("ds-logo-file").addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 8 * 1024 * 1024) {
        toast("warning", "Logo inválido", "Use PNG, JPG ou WebP com até 8 MB.");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => { byId("ds-logo-preview").src = reader.result; byId("ds-logo-preview").hidden = false; };
      reader.readAsDataURL(file);
    });
    byId("ds-generate").addEventListener("click", () => mutate(
      () => api.generateTemplates(state.clientId, Number(byId("ds-generate-count").value) || 12),
      "Novas opções geradas"
    ));
    byId("ds-create-empty").addEventListener("click", () => {
      if (!state.clientId) return toast("warning", "Selecione um cliente", "Escolha o cliente antes de criar.");
      window.VF_DESIGN_BUILDER_API?.newProject(selectedClient());
    });
    byId("ds-search").addEventListener("input", (event) => {
      state.search = event.target.value;
      clearTimeout(bind.searchTimer);
      bind.searchTimer = setTimeout(loadWorkspace, 250);
    });
    document.querySelectorAll("[data-ds-tab]").forEach((tab) => tab.addEventListener("click", () => {
      state.tab = tab.dataset.dsTab === "artworks" ? "artworks" : "templates";
      state.archived = tab.dataset.dsTab === "archived";
      document.querySelectorAll("[data-ds-tab]").forEach((item) => item.classList.toggle("is-active", item === tab));
      loadWorkspace();
    }));
    byId("ds-versions-close").addEventListener("click", () => byId("ds-versions-overlay").classList.remove("is-open"));
  }

  async function init() {
    bind();
    try {
      const response = await api.listClients();
      state.clients = response.clientes || [];
      const remembered = Number(sessionStorage.getItem("vf-design-client-id"));
      state.clientId = state.clients.some((item) => Number(item.id) === remembered) ? remembered : state.clients[0]?.id || null;
      renderClientSelect();
      if (state.clientId) await loadWorkspace();
      else setLoading(false);
    } catch (error) {
      setLoading(false);
      toast("danger", "Clientes indisponíveis", error.message);
    }
  }

  window.VF_DESIGN_STUDIO_WORKSPACE = { saveDocument, reload: loadWorkspace, getClientId: () => state.clientId };
  init();
})();
