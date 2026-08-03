(function () {
  "use strict";

  const apiLib = window.VF_DESIGN_STUDIO_API;
  const documentModel = window.VF_DESIGN_DOCUMENT_MODEL;
  const legacyMigrationLib = window.VF_DESIGN_LEGACY_MIGRATION;
  const layersLib = window.VF_DESIGN_SIMPLE_LAYERS;
  const exportModuleLib = window.VF_DESIGN_EXPORT;
  const simpleEditorLib = window.VF_DESIGN_SIMPLE_EDITOR;
  const importRegistryLib = window.VF_DESIGN_IMPORT_REGISTRY;
  const importJsonLib = window.VF_DESIGN_IMPORT_JSON;
  const importSvgLib = window.VF_DESIGN_IMPORT_SVG;
  const importImageLib = window.VF_DESIGN_IMPORT_IMAGE;
  const importModalLib = window.VF_DESIGN_IMPORT_MODAL;
  if (!apiLib || !documentModel) return;

  const API_BASE = "https://venforce-server.onrender.com";
  const api = apiLib.createDesignStudioApi({
    baseUrl: API_BASE,
    getToken: () => localStorage.getItem("vf-token"),
  });

  const state = {
    clients: [], clientId: null, workspace: null,
    tab: "templates", archived: false, search: "",
    origin: "", accountRef: "",
  };
  const byId = (id) => document.getElementById(id);
  const typePath = (type) => (type === "artwork" ? "artworks" : "templates");
  const typeLabel = (type) => (type === "artwork" ? "arte" : "template");

  /* ── toast ────────────────────────────────────────────────────────────── */

  function toast(kind, title, description) {
    const stack = byId("dt-toast-stack");
    if (!stack) return;
    const el = document.createElement("div");
    el.className = `vf-toast is-${kind}`;
    el.setAttribute("role", kind === "danger" ? "alert" : "status");
    const content = document.createElement("div");
    content.className = "vf-toast__content";
    const heading = document.createElement("p");
    heading.className = "vf-toast__title";
    heading.textContent = title;
    const detail = document.createElement("p");
    detail.className = "vf-toast__description";
    detail.textContent = description || "";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "vf-toast__close";
    close.setAttribute("aria-label", "Fechar notificação");
    close.textContent = "×";
    content.append(heading, detail);
    el.append(content, close);
    close.addEventListener("click", () => el.remove());
    stack.appendChild(el);
    window.setTimeout(() => el.remove(), 4800);
  }

  function escapeColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? value : fallback;
  }

  function setLoading(active) {
    byId("ds-loading").hidden = !active;
    byId("ds-content").hidden = active;
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

  /* ── cliente / identidade / contas ────────────────────────────────────── */

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
    const badge = byId("dtl-client-badge");
    if (badge) {
      const client = selectedClient();
      badge.textContent = client ? `Cliente: ${client.nome}` : "Nenhum cliente selecionado";
    }
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
    const filterField = byId("dtl-account-filter-field");
    const filterSelect = byId("dtl-account-filter");
    const showFilter = accounts.length > 0 && state.tab === "artworks";
    if (filterField) filterField.hidden = !showFilter;
    if (filterSelect) {
      const current = filterSelect.value;
      filterSelect.replaceChildren();
      const all = document.createElement("option");
      all.value = "";
      all.textContent = "Todas";
      filterSelect.appendChild(all);
      accounts.forEach((account) => {
        const option = document.createElement("option");
        option.value = account.account_ref;
        option.textContent = account.display_name;
        filterSelect.appendChild(option);
      });
      filterSelect.value = accounts.some((a) => a.account_ref === current) ? current : "";
      state.accountRef = filterSelect.value;
    }
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

  function getClientLogo() {
    return state.workspace?.profile?.identity?.logo || null;
  }

  /* ── origem / miniatura ───────────────────────────────────────────────── */

  const ORIGIN_LABELS = {
    blank: "Criado manualmente", json: "Importado (JSON)", svg: "Importado (SVG)",
    image: "Importado (imagem)", legacy: "Migrado", generated: "Gerado", duplicated: "Duplicado",
  };

  // Bucket estável para o filtro (mesmos valores das <option> de dtl-origin-filter).
  function originBucket(item) {
    const doc = item.document_json || {};
    if (documentModel.isVfDesignDocument(doc) && doc.source?.type && doc.source.type !== "blank") {
      return doc.source.type;
    }
    if (item.origin === "generated") return "generated";
    return "manual";
  }

  function describeOrigin(item) {
    const doc = item.document_json || {};
    if (documentModel.isVfDesignDocument(doc) && doc.source?.type) {
      return ORIGIN_LABELS[doc.source.type] || "Criado manualmente";
    }
    return ORIGIN_LABELS[item.origin] || "Criado manualmente";
  }

  function thumbnailFor(item) {
    return item.preview_json?.thumbnail || null;
  }

  /* ── ações sobre item ─────────────────────────────────────────────────── */

  async function mutate(action, success) {
    try {
      await action();
      toast("success", success, "O acervo compartilhado foi atualizado.");
      await loadWorkspace();
    } catch (error) {
      toast("danger", "Não foi possível concluir", error.message);
    }
  }

  async function openItem(item) {
    const type = item.item_type || (state.tab === "artworks" ? "artwork" : "template");
    if (!simpleEditor) {
      toast("danger", "Editor indisponível", "Recarregue a página e tente novamente.");
      return;
    }
    await simpleEditor.openProject(item.document_json || {}, {
      type, id: item.id, clienteId: item.cliente_id, name: item.name,
    });
  }

  async function createArtwork(item) {
    await mutate(async () => {
      const response = await api.createItem(state.clientId, "artworks", {
        name: `${item.name} — nova arte`,
        templateId: item.id,
        accountRef: state.accountRef || null,
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

  function exportItem(item) {
    if (!documentModel.isVfDesignDocument(item.document_json)) {
      toast("warning", "Abra o item antes de exportar", "Templates ainda não convertidos precisam ser abertos uma vez no editor.");
      return;
    }
    try {
      designExport.exportDocumentAsJson(item.document_json);
    } catch (error) {
      toast("danger", "Não foi possível exportar", error.message);
    }
  }

  /* ── biblioteca ───────────────────────────────────────────────────────── */

  function button(label, className, handler) {
    const result = document.createElement("button");
    result.type = "button";
    result.className = className || "vf-btn vf-btn--ghost vf-btn--sm";
    result.textContent = label;
    result.addEventListener("click", handler);
    return result;
  }

  function closeAllCardMenus() {
    document.querySelectorAll(".dtl-card__menu-wrap .vf-menu").forEach((menu) => { menu.hidden = true; });
  }

  function cardMenu(item, type) {
    const wrap = document.createElement("div");
    wrap.className = "dtl-card__menu-wrap";
    const trigger = button("⋯", "vf-btn vf-btn--ghost vf-btn--sm vf-btn--icon", (event) => {
      event.stopPropagation();
      const menu = wrap.querySelector(".vf-menu");
      const wasHidden = menu.hidden;
      closeAllCardMenus();
      menu.hidden = !wasHidden;
    });
    trigger.setAttribute("aria-label", "Mais ações");
    const menu = document.createElement("div");
    menu.className = "vf-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;

    const items = [];
    items.push(["Exportar", () => exportItem(item)]);
    items.push(["Ver versões", () => showVersions(item)]);
    if (!state.archived) {
      items.push(["Arquivar", () => mutate(
        () => api.archiveItem(state.clientId, typePath(type), item.id, true), `${typeLabel(type)} arquivado`
      )]);
    } else {
      items.push(["Restaurar", () => mutate(
        () => api.archiveItem(state.clientId, typePath(type), item.id, false), `${typeLabel(type)} restaurado`
      )]);
    }
    menu.replaceChildren(...items.map(([label, handler]) => {
      const entry = document.createElement("button");
      entry.type = "button";
      entry.className = "vf-menu__item";
      entry.setAttribute("role", "menuitem");
      entry.textContent = label;
      entry.addEventListener("click", (event) => { event.stopPropagation(); menu.hidden = true; handler(); });
      return entry;
    }));

    wrap.append(trigger, menu);
    return wrap;
  }

  function itemCard(item) {
    const type = item.item_type || (state.tab === "artworks" ? "artwork" : "template");
    const card = document.createElement("article");
    card.className = "vf-card dtl-card";

    const thumb = document.createElement("div");
    thumb.className = "dtl-card__thumb";
    const dataUrl = thumbnailFor(item);
    if (dataUrl) {
      const img = document.createElement("img");
      img.src = dataUrl;
      img.alt = `Miniatura de ${item.name}`;
      thumb.appendChild(img);
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "dtl-card__thumb-placeholder";
      placeholder.textContent = "Sem miniatura";
      thumb.appendChild(placeholder);
    }
    const badge = document.createElement("span");
    badge.className = "dtl-card__badge";
    badge.textContent = type === "artwork" ? "Arte" : "Template";
    thumb.appendChild(badge);

    const body = document.createElement("div");
    body.className = "dtl-card__body";
    const title = document.createElement("h3");
    title.className = "dtl-card__title";
    title.textContent = item.name;

    const pages = Array.isArray(item.document_json?.pages) ? item.document_json.pages.length : 0;
    const version = item.current_version || item.version_number || 1;
    const account = (state.workspace?.accounts || []).find((a) => a.account_ref === item.account_ref);
    const meta = document.createElement("p");
    meta.className = "dtl-card__meta";
    const metaParts = [
      describeOrigin(item),
      `${pages} ${pages === 1 ? "página" : "páginas"}`,
      `Atualizado ${new Date(item.updated_at).toLocaleDateString("pt-BR")}`,
      `V${version}`,
    ];
    if (account) metaParts.push(account.display_name);
    metaParts.forEach((text) => {
      const span = document.createElement("span");
      span.textContent = text;
      meta.appendChild(span);
    });

    const actions = document.createElement("div");
    actions.className = "dtl-card__actions";
    if (!state.archived) {
      actions.appendChild(button("Abrir", "vf-btn vf-btn--primary vf-btn--sm", () => openItem(item)));
      if (type === "template") actions.appendChild(button("Criar arte", "vf-btn vf-btn--secondary vf-btn--sm", () => createArtwork(item)));
      actions.appendChild(button("Duplicar", "vf-btn vf-btn--ghost vf-btn--sm", () => mutate(
        () => api.duplicateItem(state.clientId, typePath(type), item.id), `${typeLabel(type)} duplicado`
      )));
    }
    actions.appendChild(cardMenu(item, type));

    body.append(title, meta, actions);
    card.append(thumb, body);
    return card;
  }

  function renderItems() {
    let items = state.archived
      ? [...(state.workspace?.templates || []), ...(state.workspace?.artworks || [])]
      : state.tab === "artworks" ? state.workspace?.artworks || [] : state.workspace?.templates || [];
    if (state.origin) items = items.filter((item) => originBucket(item) === state.origin);
    if (state.accountRef) items = items.filter((item) => item.account_ref === state.accountRef);

    byId("ds-items-title").textContent = state.archived ? "Itens arquivados" : state.tab === "artworks" ? "Artes" : "Templates";
    byId("ds-items-count").textContent = String(items.length);
    byId("ds-grid").replaceChildren(...items.map(itemCard));
    byId("ds-empty").hidden = items.length > 0;
  }

  function renderWorkspace() {
    const client = state.workspace?.client;
    byId("ds-workspace-name").textContent = client?.nome || "Cliente";
    byId("ds-workspace-slug").textContent = client?.slug || "";
    renderClientSelect();
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

  // Contrato exigido por design-simple-editor.js: saveDocument(document,
  // context, { thumbnail }) -> novo context. `thumbnail`/`source` do
  // documento vão em preview_json — document_json continua sendo só o
  // documento (sem duplicar dado de preview dentro dele).
  async function saveDocument(newDocument, context, extra) {
    if (!state.clientId) throw new Error("Selecione um cliente antes de salvar.");
    const type = context?.type === "artwork" ? "artworks" : "templates";
    const body = {
      name: newDocument.name,
      document: newDocument,
      preview: {
        thumbnail: extra?.thumbnail || null,
        source: newDocument.source,
        pageCount: newDocument.pages.length,
      },
      accountRef: newDocument.accountRef || null,
      origin: "manual",
    };
    const response = context?.id
      ? await api.updateItem(state.clientId, type, context.id, body)
      : await api.createItem(state.clientId, type, body);
    await loadWorkspace();
    return { type: type === "artworks" ? "artwork" : "template", id: response.item.id, clienteId: state.clientId, name: response.item.name };
  }

  /* ── módulos do estúdio ───────────────────────────────────────────────── */

  const designExport = exportModuleLib ? exportModuleLib.createDesignExport({ documentModel }) : null;

  const simpleEditor = simpleEditorLib ? simpleEditorLib.createSimpleEditor({
    documentModel,
    legacyMigrationLib,
    layersLib,
    exportLib: designExport,
    workspace: { saveDocument, reload: loadWorkspace, getClientLogo },
    toast,
  }) : null;

  let importModal = null;
  if (importRegistryLib && importJsonLib && importSvgLib && importImageLib && importModalLib) {
    const registry = importRegistryLib.createImportRegistry();
    registry.register(importJsonLib.createJsonImporter({ documentModel }));
    registry.register(importSvgLib.createSvgImporter({
      documentModel,
      svgToFabricJson: (svg) => (window.fabric
        ? window.fabric.loadSVGFromString(svg).then((result) => ({
          version: "6.9.1", objects: (result.objects || []).filter(Boolean),
        }))
        : Promise.resolve(null)),
    }));
    registry.register(importImageLib.createImageImporter({ documentModel }));
    const controller = importModalLib.createImportController({ registry });
    importModal = importModalLib.bindImportModalDom(controller, {
      overlay: "dim-overlay", dropzone: "dim-dropzone", fileInput: "dim-file-input",
      errorBox: "dim-file-error", errorText: "dim-file-error-text",
      stepFile: "dim-panel-file", stepReview: "dim-panel-review", stepSave: "dim-panel-save",
      reviewFileName: "dim-review-name", reviewFormat: "dim-review-format", reviewSize: "dim-review-size",
      reviewDimensions: "dim-review-dimensions", reviewPages: "dim-review-pages", reviewObjects: "dim-review-objects",
      reviewWarnings: "dim-review-warnings",
      saveName: "dim-save-name", saveTypeTemplate: "dim-save-as-template", saveTypeArtwork: "dim-save-as-artwork",
      saveAccountField: "dim-save-account-field", saveAccount: "dim-save-account",
      back: "dim-back", cancel: "dim-cancel", next: "dim-next",
    }, {
      getContext: () => ({ clienteId: state.clientId, accountRef: state.accountRef || null }),
      listAccounts: () => state.workspace?.accounts || [],
      onImported: async (importedDocument, { warnings }) => {
        if (!state.clientId) { toast("warning", "Selecione um cliente", "Escolha o cliente antes de importar."); return; }
        try {
          const type = typePath(importedDocument.itemType);
          const response = await api.createItem(state.clientId, type, {
            name: importedDocument.name,
            document: importedDocument,
            preview: { thumbnail: null, source: importedDocument.source },
            accountRef: importedDocument.accountRef || null,
            origin: "manual",
          });
          await loadWorkspace();
          toast("success", "Template importado", warnings.length ? warnings.join(" ") : "O item foi salvo no acervo do cliente.");
          await openItem({ ...response.item, item_type: importedDocument.itemType });
        } catch (error) {
          toast("danger", "Não foi possível importar", error.message);
        }
      },
      toast,
    });
  }

  /* ── eventos ──────────────────────────────────────────────────────────── */

  function bind() {
    byId("ds-client-select").addEventListener("change", (event) => {
      state.clientId = Number(event.target.value) || null;
      if (state.clientId) sessionStorage.setItem("vf-design-client-id", String(state.clientId));
      renderClientSelect();
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
    byId("ds-search").addEventListener("input", (event) => {
      state.search = event.target.value;
      clearTimeout(bind.searchTimer);
      bind.searchTimer = setTimeout(loadWorkspace, 250);
    });
    document.querySelectorAll("[data-ds-tab]").forEach((tab) => tab.addEventListener("click", () => {
      state.tab = tab.dataset.dsTab === "artworks" ? "artworks" : "templates";
      state.archived = tab.dataset.dsTab === "archived";
      document.querySelectorAll("[data-ds-tab]").forEach((item) => item.classList.toggle("is-active", item === tab));
      renderAccounts();
      loadWorkspace();
    }));
    byId("dtl-origin-filter").addEventListener("change", (event) => {
      state.origin = event.target.value;
      renderItems();
    });
    byId("dtl-account-filter")?.addEventListener("change", (event) => {
      state.accountRef = event.target.value;
      renderItems();
    });
    byId("ds-versions-close").addEventListener("click", () => byId("ds-versions-overlay").classList.remove("is-open"));

    byId("dtl-import")?.addEventListener("click", () => {
      if (!state.clientId) { toast("warning", "Selecione um cliente", "Escolha o cliente antes de importar."); return; }
      importModal?.open();
    });
    byId("dim-close")?.addEventListener("click", () => importModal?.close());
    byId("dtl-new-blank")?.addEventListener("click", () => {
      if (!state.clientId) { toast("warning", "Selecione um cliente", "Escolha o cliente antes de criar."); return; }
      simpleEditor?.newProject(selectedClient());
    });

    document.addEventListener("click", closeAllCardMenus);
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

  window.VF_DESIGN_STUDIO_WORKSPACE = { saveDocument, reload: loadWorkspace, getClientId: () => state.clientId, getClientLogo };
  init();
})();
