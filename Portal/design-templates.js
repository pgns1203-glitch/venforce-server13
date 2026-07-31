(function () {
  "use strict";

  const STORAGE_KEY = "vf-design-template-studio-v1";
  const TOKEN_KEY = "vf-token";
  const API_BASE = "https://venforce-server.onrender.com";

  // Módulos do editor de imagem. Sem eles a tela continua funcionando em modo
  // reduzido (upload local, sem editor) em vez de quebrar por completo.
  const imageModel = window.VF_DESIGN_IMAGE_MODEL || null;
  const imageStorageLib = window.VF_DESIGN_IMAGE_STORAGE || null;
  const imageApiLib = window.VF_DESIGN_IMAGE_API || null;
  const imageEditorLib = window.VFDesignImageEditor || null;

  // Motor de templates: puro, sem DOM, testado à parte em Node. A tela só
  // consome a API pública — o catálogo de templates vive em
  // design-template-presets.js, como dado declarativo (sem funções).
  const templateEngine = window.VF_DESIGN_TEMPLATE_ENGINE;
  const templatePresets = window.VF_DESIGN_TEMPLATE_PRESETS;
  const templateRegistry = templateEngine.createTemplateRegistry(templatePresets.TEMPLATE_DEFINITIONS);

  // Fonte da imagem do produto: a versão editada tem precedência; sem edição
  // aplicada, vale o arquivo original. Serve tanto às peças (via renderer)
  // quanto à miniatura do painel de upload.
  function productImageSource(state) {
    if (imageModel) return imageModel.resolveProductImageSource(state.product);
    return state.product?.editedImage?.dataUrl || state.product?.originalImage?.dataUrl || null;
  }

  // Renderização das peças: adaptador de SVG + biblioteca de componentes +
  // registro de layouts. A tela não desenha mais nada por conta própria.
  const rendererLib = window.VF_DESIGN_TEMPLATE_RENDERER;
  const templateRenderer = rendererLib.createTemplateRenderer({
    documentLike: document,
    componentsLib: window.VF_DESIGN_TEMPLATE_COMPONENTS,
    layoutsLib: window.VF_DESIGN_TEMPLATE_LAYOUTS,
    resolveProductImageSource: productImageSource,
  });

  // Template salvo que não existe mais no catálogo cai para o primeiro
  // preset válido do registro — mesma regra que já valia quando só existia
  // um template.
  function resolveTemplate(templateId) {
    return templateRegistry.getById(templateId) || templateRegistry.getDefault();
  }

  function getActiveTemplate() {
    return resolveTemplate(project.templateId);
  }

  function createEmptyImage() {
    return imageModel
      ? imageModel.createEmptyImageRef()
      : { id: null, dataUrl: null, url: null, fileName: "", mimeType: "", width: null, height: null };
  }

  function createDefaultProject(templateId) {
    return templateEngine.createProjectFromTemplate(resolveTemplate(templateId), { imageModel });
  }

  // A paleta derivada (10 cores a partir das 4 escolhidas) é a mesma usada
  // pelas peças; vem do renderizador para não existir em duas versões.
  const derivedPalette = rendererLib.derivedPalette;

  // Estado da migração aplicada no boot — a tela avisa o usuário depois que
  // o DOM está pronto, não durante a leitura do localStorage.
  let migracaoAplicada = null;

  // Hidratação de projeto salvo delegada ao motor de templates: normaliza
  // paleta/textos/imagens conforme o schema do template resolvido e aplica o
  // fallback de migração V1 -> V2 das imagens via o modelo de imagem.
  function hydrateProject(stored) {
    const definition = resolveTemplate(stored && stored.templateId);
    const resultado = templateEngine.hydrateProjectFromTemplate(stored, definition, { imageModel });
    migracaoAplicada = resultado.migration;
    return resultado.project;
  }

  function loadProject() {
    try {
      return hydrateProject(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
    } catch {
      return createDefaultProject();
    }
  }

  let project = loadProject();
  let clients = [];
  let autosaveTimer = null;
  let confirmAction = null;
  let cancelAction = null;
  let focusBeforeModal = null;

  // Armazenamento de blobs (IndexedDB, com degradação controlada).
  const imageStorage = imageStorageLib
    ? imageStorageLib.createImageStorage({
      indexedDB: typeof window.indexedDB !== "undefined" ? window.indexedDB : null,
      localStorage: window.localStorage,
    })
    : null;

  const imageApi = imageApiLib
    ? imageApiLib.createDesignImageApi({
      baseUrl: API_BASE,
      getToken: () => localStorage.getItem(TOKEN_KEY),
    })
    : null;

  // Ids já gravados no armazenamento nesta sessão: evita reescrever o mesmo
  // base64 a cada autosave (o autosave dispara a cada 350 ms de digitação).
  const idsPersistidos = new Set();
  let capacidadesIa = null;
  let editorImagem = null;
  let avisoArmazenamentoEmitido = false;

  const byId = (id) => document.getElementById(id);

  function setSaveStatus(message, mode) {
    const status = byId("dt-save-status");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("is-saving", mode === "saving");
    status.classList.toggle("is-error", mode === "error");
  }

  // Grava no IndexedDB os blobs que ainda não foram para lá e apaga os órfãos.
  // Roda em segundo plano: uma falha aqui não pode travar a digitação.
  async function persistImages(leve, blobs) {
    if (!imageStorage) return;
    try {
      for (const blob of blobs) {
        if (idsPersistidos.has(blob.id)) continue;
        // eslint-disable-next-line no-await-in-loop
        await imageStorage.salvar(blob.id, blob.dataUrl);
        idsPersistidos.add(blob.id);
      }
      const vivos = imageModel ? imageModel.collectImageIds(leve) : [];
      const removidos = await imageStorage.limparOrfaos(vivos);
      removidos.forEach((id) => idsPersistidos.delete(id));
    } catch (error) {
      const codigo = error && error.codigo;
      if (codigo === "QUOTA_EXCEDIDA") {
        setSaveStatus("Sem espaço para guardar a imagem", "error");
        showToast(
          "danger",
          "Armazenamento do navegador cheio",
          "Remova a imagem atual ou libere espaço do site para que o projeto volte a ser salvo."
        );
      } else if (!avisoArmazenamentoEmitido) {
        avisoArmazenamentoEmitido = true;
        showToast(
          "warning",
          "Imagens não serão recuperadas",
          "Este navegador bloqueou o armazenamento local de imagens. O projeto vale para esta sessão."
        );
      }
    }
  }

  function persistProject(showSuccessToast) {
    if (autosaveTimer) {
      window.clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }

    // O localStorage recebe só o projeto leve: textos, cores e ids de imagem.
    // O base64 vai para o IndexedDB via persistImages().
    const separado = imageModel
      ? imageModel.splitProjectForStorage(project)
      : { leve: project, blobs: [] };

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(separado.leve));
      setSaveStatus("Alterações salvas localmente", "saved");
      if (showSuccessToast) showToast("success", "Projeto salvo", "As alterações foram persistidas neste navegador.");
    } catch (error) {
      setSaveStatus("Não foi possível salvar localmente", "error");
      showToast("danger", "Armazenamento indisponível", "Libere espaço do site neste navegador e tente novamente.");
      return false;
    }

    persistImages(separado.leve, separado.blobs);
    return true;
  }

  // Depois do boot as imagens ainda são só ids: busca os blobs e redesenha.
  async function hydrateImagesFromStorage() {
    if (!imageStorage || !imageModel) return;
    const referencias = [
      project.product.originalImage,
      project.product.editedImage,
      project.logo,
    ];
    let alterou = false;
    for (const ref of referencias) {
      // Referência já com base64 em mãos só acontece logo após a migração V1,
      // e nesse caso o blob AINDA não foi gravado — não pode ser marcado como
      // persistido aqui, senão o persistImages seguinte pula a gravação.
      if (!ref || !ref.id || ref.dataUrl) continue;
      // eslint-disable-next-line no-await-in-loop
      const dataUrl = await imageStorage.ler(ref.id);
      if (imageModel.isDataImageUrl(dataUrl)) {
        ref.dataUrl = dataUrl;
        idsPersistidos.add(ref.id);
        alterou = true;
      } else {
        // O blob sumiu (limpeza do navegador, outra máquina): a referência
        // vira vazia em vez de deixar a tela apontando para o nada.
        ref.id = null;
      }
    }
    if (alterou && project.view === "editor") renderEditor();
    else if (alterou) syncControls();
  }

  function scheduleAutosave() {
    setSaveStatus("Salvando alterações…", "saving");
    if (autosaveTimer) window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => persistProject(false), 350);
  }

  function showToast(kind, title, description) {
    const stack = byId("dt-toast-stack");
    if (!stack) return;
    const toast = document.createElement("div");
    toast.className = `vf-toast is-${kind}`;
    toast.setAttribute("role", kind === "danger" ? "alert" : "status");
    const content = document.createElement("div");
    content.className = "vf-toast__content";
    const heading = document.createElement("p");
    heading.className = "vf-toast__title";
    heading.textContent = title;
    const detail = document.createElement("p");
    detail.className = "vf-toast__description";
    detail.textContent = description;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "vf-toast__close";
    close.setAttribute("aria-label", "Fechar notificação");
    close.textContent = "×";
    content.append(heading, detail);
    toast.append(content, close);
    close.addEventListener("click", () => toast.remove());
    stack.appendChild(toast);
    window.setTimeout(() => toast.remove(), 4800);
  }

  function applyTemplateTokens() {
    const root = byId("dt-token-root");
    if (!root) return;
    const palette = derivedPalette(project.palette);
    Object.entries({
      "--template-primary": palette.primary,
      "--template-primary-dark": palette.primaryDark,
      "--template-primary-light": palette.primaryLight,
      "--template-secondary": palette.secondary,
      "--template-secondary-light": palette.secondaryLight,
      "--template-background": palette.background,
      "--template-text": palette.text,
      "--template-muted": palette.muted,
      "--template-surface": palette.surface,
    }).forEach(([name, value]) => root.style.setProperty(name, value));
  }

  function normalizeSearch(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  }

  function uniqueValues(key) {
    return [...new Set(templateRegistry.getAll().map((item) => item[key]))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }

  function populateLibraryFilters() {
    [["dt-segment-filter", "segment"], ["dt-marketplace-filter", "marketplace"]].forEach(([id, key]) => {
      const select = byId(id);
      uniqueValues(key).forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      });
    });
  }

  function createMosaic() {
    const visual = document.createElement("div");
    visual.className = "dt-template-card__visual";
    visual.setAttribute("aria-hidden", "true");
    const mosaic = document.createElement("div");
    mosaic.className = "dt-template-card__mosaic";
    for (let index = 0; index < 5; index += 1) {
      const tile = document.createElement("span");
      tile.className = "dt-template-card__tile";
      mosaic.appendChild(tile);
    }
    visual.appendChild(mosaic);
    return visual;
  }

  function createTemplateCard(template) {
    const card = document.createElement("article");
    card.className = "vf-card dt-template-card";
    card.dataset.templateId = template.id;
    const body = document.createElement("div");
    body.className = "dt-template-card__body";
    const info = document.createElement("div");
    const title = document.createElement("h2");
    title.className = "dt-template-card__title";
    title.textContent = template.name;
    const meta = document.createElement("div");
    meta.className = "dt-template-card__meta";
    [
      ["Segmento", template.segment],
      ["Marketplace", template.marketplace],
      ["Formato", `${template.canvas.width} × ${template.canvas.height} px`],
      ["Conjunto", `${template.pages.length} peças`],
    ].forEach(([label, value]) => {
      const item = document.createElement("span");
      const strong = document.createElement("strong");
      strong.textContent = `${label}:`;
      item.append(strong, document.createTextNode(` ${value}`));
      meta.appendChild(item);
    });
    const button = document.createElement("button");
    button.type = "button";
    button.className = "vf-btn vf-btn--primary";
    button.textContent = "Personalizar";
    button.addEventListener("click", () => openEditor(template.id));
    info.append(title, meta);
    body.append(info, button);
    card.append(createMosaic(), body);
    return card;
  }

  function renderLibrary() {
    const grid = byId("dt-template-grid");
    const query = normalizeSearch(byId("dt-search")?.value);
    const segment = byId("dt-segment-filter")?.value || "";
    const marketplace = byId("dt-marketplace-filter")?.value || "";
    const filtered = templateRegistry.getAll().filter((template) => {
      const searchable = normalizeSearch(`${template.name} ${template.segment} ${template.marketplace}`);
      return (!query || searchable.includes(query)) && (!segment || template.segment === segment) && (!marketplace || template.marketplace === marketplace);
    });
    grid.replaceChildren(...filtered.map(createTemplateCard));
    byId("dt-library-empty").hidden = filtered.length > 0;
  }

  function showView(view, options) {
    const next = view === "editor" ? "editor" : "library";
    project.view = next;
    byId("dt-library-view").hidden = next !== "library";
    byId("dt-editor-view").hidden = next !== "editor";
    byId("dt-editor-header-actions").hidden = next !== "editor";
    byId("dt-library-tab").classList.toggle("is-active", next === "library");
    byId("dt-library-tab").setAttribute("aria-selected", String(next === "library"));
    byId("dt-editor-tab").classList.toggle("is-active", next === "editor");
    byId("dt-editor-tab").setAttribute("aria-selected", String(next === "editor"));
    if (next === "editor") renderEditor();
    if (!options?.skipSave) scheduleAutosave();
  }

  function openEditor(templateId) {
    project.templateId = templateId;
    showView("editor");
  }

  function syncControls() {
    const values = {
      "dt-client-name": project.clienteNome,
      "dt-brand-name": project.marcaNome,
      "dt-color-primary": project.palette.primary,
      "dt-color-secondary": project.palette.secondary,
      "dt-color-background": project.palette.background,
      "dt-color-text": project.palette.text,
      "dt-product-name": project.product.name,
      "dt-product-subtitle": project.product.subtitle,
      "dt-product-scale": project.product.placement.scale,
      "dt-product-x": project.product.placement.x,
      "dt-product-y": project.product.placement.y,
      "dt-benefit": project.content.benefit,
      "dt-wireless": project.content.wireless,
      "dt-led": project.content.led,
      "dt-package": project.content.packageItems,
      "dt-width": project.content.width,
      "dt-height": project.content.height,
      "dt-depth": project.content.depth,
      "dt-features": project.content.features,
      "dt-safe": project.content.safe,
      "dt-shipping": project.content.shipping,
      "dt-warranty": project.content.warranty,
      "dt-zoom": String(project.zoom),
    };
    Object.entries(values).forEach(([id, value]) => {
      const control = byId(id);
      if (control && control.value !== String(value)) control.value = value;
    });
    byId("dt-product-scale-value").textContent = `${project.product.placement.scale}%`;
    byId("dt-product-x-value").textContent = `${project.product.placement.x}%`;
    byId("dt-product-y-value").textContent = `${project.product.placement.y}%`;
    syncUploadState("logo", project.logo.dataUrl, project.logo.fileName);
    syncProductUploadState();
    syncClientSelection();
  }

  function syncUploadState(kind, dataUrl, fileName) {
    const state = byId(`dt-${kind}-state`);
    const preview = byId(`dt-${kind}-preview`);
    const name = byId(`dt-${kind}-filename`);
    state.hidden = !dataUrl;
    if (dataUrl) preview.src = dataUrl;
    else preview.removeAttribute("src");
    name.textContent = fileName || "Imagem local";
  }

  function syncProductUploadState() {
    const original = project.product.originalImage;
    // A miniatura mostra o que as peças usam — a editada, quando existe.
    syncUploadState("product", productImageSource(project), original.fileName);

    const botaoEditar = byId("dt-edit-product");
    if (botaoEditar) {
      const podeEditar = Boolean(original.dataUrl) && Boolean(editorImagem) && Boolean(window.fabric);
      botaoEditar.disabled = !podeEditar;
      botaoEditar.title = podeEditar
        ? "Abrir o editor de imagem"
        : "O editor precisa da imagem carregada e da biblioteca de edição disponível.";
    }

    const nota = byId("dt-product-edit-note");
    if (nota) nota.hidden = !project.product.editedImage.dataUrl;

    const aviso = byId("dt-product-lowres");
    if (aviso) {
      aviso.hidden = !(imageModel && original.dataUrl
        && imageModel.isLowResolution(original.width, original.height));
    }
  }

  function syncClientSelection() {
    const select = byId("dt-client-select");
    if (!select) return;
    const desired = project.clienteId == null ? "" : String(project.clienteId);
    select.value = [...select.options].some((option) => option.value === desired) ? desired : "";
  }

  function setNested(path, value) {
    const keys = path.split(".");
    let node = project;
    for (let index = 0; index < keys.length - 1; index += 1) node = node[keys[index]];
    node[keys[keys.length - 1]] = value;
  }

  const CONTROL_BINDINGS = {
    "dt-client-name": "clienteNome",
    "dt-brand-name": "marcaNome",
    "dt-color-primary": "palette.primary",
    "dt-color-secondary": "palette.secondary",
    "dt-color-background": "palette.background",
    "dt-color-text": "palette.text",
    "dt-product-name": "product.name",
    "dt-product-subtitle": "product.subtitle",
    "dt-product-scale": "product.placement.scale",
    "dt-product-x": "product.placement.x",
    "dt-product-y": "product.placement.y",
    "dt-benefit": "content.benefit",
    "dt-wireless": "content.wireless",
    "dt-led": "content.led",
    "dt-package": "content.packageItems",
    "dt-width": "content.width",
    "dt-height": "content.height",
    "dt-depth": "content.depth",
    "dt-features": "content.features",
    "dt-safe": "content.safe",
    "dt-shipping": "content.shipping",
    "dt-warranty": "content.warranty",
  };

  function onBoundControlInput(event) {
    const path = CONTROL_BINDINGS[event.target.id];
    if (!path) return;
    const isRange = event.target.type === "range";
    setNested(path, isRange ? Number(event.target.value) : event.target.value);
    if (event.target.id === "dt-client-name") project.clienteId = null;
    applyTemplateTokens();
    renderPreviews();
    syncControls();
    scheduleAutosave();
  }

  // A tela não desenha mais: pede a peça ao renderizador, que resolve o
  // layout pelo rendererId da página. Um rendererId sem layout é erro
  // explícito do renderer — tratado aqui, nunca virando arte genérica
  // silenciosa que passaria por correta.
  function createPageSvg(pageIndex, sourceProject) {
    return templateRenderer.renderPage({
      template: resolveTemplate(sourceProject.templateId),
      project: sourceProject,
      pageIndex,
    });
  }

  // Placeholder de falha: diz que a peça não pôde ser montada, em vez de
  // fingir uma arte válida. Só aparece se um template declarar um
  // rendererId sem layout registrado.
  function createBrokenPageSvg(template, page) {
    const svg = templateRenderer.svg;
    const root = svg.element("svg", {
      viewBox: `0 0 ${template.canvas.width} ${template.canvas.height}`,
      width: template.canvas.width,
      height: template.canvas.height,
      role: "img",
      "aria-label": `Peça indisponível: ${page ? page.name : "layout desconhecido"}`,
    });
    svg.element("rect", { width: template.canvas.width, height: template.canvas.height, fill: "#f4efe5" }, root);
    svg.text(root, "Peça indisponível", {
      x: template.canvas.width / 2, y: template.canvas.height / 2 - 10,
      "text-anchor": "middle", fill: "#12202b", "font-size": 46, "font-weight": 700,
    });
    svg.text(root, "Este layout não está disponível nesta versão do estúdio.", {
      x: template.canvas.width / 2, y: template.canvas.height / 2 + 48,
      "text-anchor": "middle", fill: "#5c6670", "font-size": 26, "font-weight": 500,
    });
    return root;
  }

  // Envolve a renderização para que uma página quebrada não derrube a tela
  // inteira: a peça vira placeholder explícito e o usuário é avisado uma vez.
  let avisoLayoutEmitido = false;
  function createPageSvgSafely(pageIndex, sourceProject, template) {
    try {
      return createPageSvg(pageIndex, sourceProject);
    } catch (error) {
      if (!avisoLayoutEmitido) {
        avisoLayoutEmitido = true;
        showToast(
          "danger",
          "Layout indisponível",
          "Uma peça deste template usa um layout que o estúdio não conhece. As demais continuam disponíveis."
        );
      }
      return createBrokenPageSvg(template, template.pages[pageIndex]);
    }
  }

  function previewProject() {
    return project.compareMode === "original" ? createDefaultProject(project.templateId) : project;
  }

  function updateEditorHeader(template) {
    const title = byId("dt-editor-view-title");
    const meta = byId("dt-editor-meta");
    if (title) title.textContent = template.name;
    if (meta) meta.textContent = `${template.pages.length} peças · ${template.canvas.width} × ${template.canvas.height} px`;
  }

  function renderPreviews() {
    const template = getActiveTemplate();
    const pages = template.pages;
    const source = previewProject();
    const main = byId("dt-main-preview");
    main.replaceChildren(createPageSvgSafely(project.selectedPage, source, template));
    main.classList.toggle("is-original", project.compareMode === "original");
    main.style.width = `${project.zoom}%`;
    const totalPaginas = String(pages.length).padStart(2, "0");
    byId("dt-page-number").textContent = `PEÇA ${String(project.selectedPage + 1).padStart(2, "0")} DE ${totalPaginas}`;
    byId("dt-page-name").textContent = pages[project.selectedPage].name;
    byId("dt-view-original").classList.toggle("is-active", project.compareMode === "original");
    byId("dt-view-original").setAttribute("aria-pressed", String(project.compareMode === "original"));
    byId("dt-view-custom").classList.toggle("is-active", project.compareMode === "custom");
    byId("dt-view-custom").setAttribute("aria-pressed", String(project.compareMode === "custom"));

    const thumbnails = pages.map((page, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `dt-thumbnail${project.selectedPage === index ? " is-active" : ""}`;
      button.setAttribute("aria-label", `Abrir peça ${index + 1}: ${page.name}`);
      button.setAttribute("aria-current", project.selectedPage === index ? "true" : "false");
      const art = document.createElement("span");
      art.className = "dt-thumb-art";
      art.appendChild(createPageSvgSafely(index, source, template));
      const label = document.createElement("span");
      label.className = "dt-thumbnail__label";
      label.textContent = `${String(index + 1).padStart(2, "0")} · ${page.name}`;
      button.append(art, label);
      button.addEventListener("click", () => {
        project.selectedPage = index;
        renderPreviews();
        scheduleAutosave();
      });
      return button;
    });
    byId("dt-thumbnails").replaceChildren(...thumbnails);
  }

  function renderEditor() {
    updateEditorHeader(getActiveTemplate());
    applyTemplateTokens();
    syncControls();
    renderPreviews();
  }

  function activateControlTab(name, focusTab) {
    document.querySelectorAll("[data-control-tab]").forEach((tab) => {
      const active = tab.dataset.controlTab === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      if (active && focusTab) tab.focus();
    });
    document.querySelectorAll("[data-control-panel]").forEach((panel) => {
      const active = panel.dataset.controlPanel === name;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
    });
  }

  /* ── upload de imagem ─────────────────────────────────────────────────── */

  function setUploadBusy(kind, busy) {
    const drop = document.querySelector(`label[for="dt-${kind}-file"]`);
    if (drop) drop.classList.toggle("is-loading", busy);
    const input = byId(`dt-${kind}-file`);
    if (input) input.disabled = busy;
  }

  // Caminho degradado: sem servidor, lê o arquivo no próprio navegador com o
  // limite conservador. Sem correção de EXIF nem redimensionamento.
  function readLocalImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        const resultado = reader.result;
        if (typeof resultado !== "string" || !imageModel || !imageModel.isDataImageUrl(resultado)) {
          reject(new Error("Data URL inválida"));
          return;
        }
        // As dimensões vêm do decodificador; se falhar, seguem nulas.
        const img = new Image();
        img.onload = () => resolve({
          dataUrl: resultado,
          mimeType: imageModel.mimeFromDataUrl(resultado),
          width: img.naturalWidth || null,
          height: img.naturalHeight || null,
        });
        img.onerror = () => resolve({
          dataUrl: resultado,
          mimeType: imageModel.mimeFromDataUrl(resultado),
          width: null,
          height: null,
        });
        img.src = resultado;
      });
      reader.addEventListener("error", () => reject(new Error("Falha na leitura")));
      reader.readAsDataURL(file);
    });
  }

  // Fluxo único de upload: valida no cliente, normaliza no servidor (Sharp) e,
  // se o servidor não responder, cai para leitura local com limite menor.
  async function prepararImagem(file, kind) {
    if (!imageModel) throw new Error("Editor de imagem indisponível.");

    const validacao = imageModel.validateImageFile(file, { mode: "servidor" });
    if (!validacao.ok) {
      const erro = new Error(validacao.mensagem);
      erro.codigo = validacao.codigo;
      erro.validacao = true;
      throw erro;
    }

    if (imageApi) {
      try {
        const imagem = await imageApi.normalizar(file, { finalidade: kind });
        return {
          dataUrl: imagem.dataUrl,
          mimeType: imagem.mimeType,
          width: imagem.width,
          height: imagem.height,
          fileName: validacao.fileName,
          origem: "servidor",
          baixaResolucao: imagem.baixaResolucao === true,
        };
      } catch (error) {
        // Erro de conteúdo é do arquivo, não da rede: não adianta tentar local.
        const codigo = error && error.codigo;
        const problemaDeRede = codigo === "REDE_INDISPONIVEL" || codigo === "TIMEOUT" || codigo === "SEM_FETCH";
        if (!problemaDeRede) throw error;
      }
    }

    const localValidacao = imageModel.validateImageFile(file, { mode: "local" });
    if (!localValidacao.ok) {
      const erro = new Error(
        `${localValidacao.mensagem} O servidor não respondeu, então o limite local menor foi aplicado.`
      );
      erro.codigo = localValidacao.codigo;
      erro.validacao = true;
      throw erro;
    }

    const local = await readLocalImage(file);
    return {
      ...local,
      fileName: validacao.fileName,
      origem: "local",
      baixaResolucao: imageModel.isLowResolution(local.width, local.height),
    };
  }

  async function onProductFileSelected(file) {
    if (!file) return;
    setUploadBusy("product", true);
    setSaveStatus("Preparando imagem…", "saving");
    try {
      const imagem = await prepararImagem(file, "produto");
      // Imagem nova zera qualquer edição anterior — os parâmetros antigos não
      // fazem sentido para outro arquivo. O enquadramento na peça é mantido.
      project.product = {
        ...project.product,
        originalImage: imageModel.normalizeImageRef({
          id: imageModel.newImageId("prod"),
          dataUrl: imagem.dataUrl,
          fileName: imagem.fileName,
          mimeType: imagem.mimeType,
          width: imagem.width,
          height: imagem.height,
        }),
        editedImage: imageModel.createEmptyImageRef(),
        editing: imageModel.createDefaultEditing(),
      };
      renderEditor();
      persistProject(false);
      if (imagem.origem === "local") {
        showToast("warning", "Imagem carregada localmente", "O servidor não respondeu: a imagem não passou pela normalização.");
      } else if (imagem.baixaResolucao) {
        showToast("warning", "Resolução baixa", "A imagem tem menos de 600 px de lado. A arte pode sair sem nitidez.");
      } else {
        showToast("success", "Imagem pronta", "Use “Editar imagem” para recortar e ajustar antes de gerar as peças.");
      }
    } catch (error) {
      showToast("danger", "Não foi possível usar esta imagem", error?.message || "Tente outro arquivo.");
      setSaveStatus("Alterações salvas localmente", "saved");
    } finally {
      setUploadBusy("product", false);
      const input = byId("dt-product-file");
      if (input) input.value = "";
    }
  }

  async function onLogoFileSelected(file) {
    if (!file) return;
    setUploadBusy("logo", true);
    try {
      const imagem = await prepararImagem(file, "logo");
      project.logo = imageModel.normalizeImageRef({
        id: imageModel.newImageId("logo"),
        dataUrl: imagem.dataUrl,
        fileName: imagem.fileName,
        mimeType: imagem.mimeType,
        width: imagem.width,
        height: imagem.height,
      });
      renderEditor();
      persistProject(false);
    } catch (error) {
      showToast("danger", "Não foi possível usar este logo", error?.message || "Tente outro arquivo.");
    } finally {
      setUploadBusy("logo", false);
      const input = byId("dt-logo-file");
      if (input) input.value = "";
    }
  }

  function removeImage(kind) {
    if (kind === "logo") {
      project.logo = createEmptyImage();
      byId("dt-logo-file").value = "";
    } else {
      project.product = imageModel
        ? { ...project.product, ...imageModel.clearProductImage(project.product) }
        : { ...project.product, originalImage: createEmptyImage(), editedImage: createEmptyImage() };
      byId("dt-product-file").value = "";
    }
    renderEditor();
    persistProject(false);
  }

  /* ── editor de imagem ─────────────────────────────────────────────────── */

  function pedirConfirmacao(mensagem) {
    return new Promise((resolve) => {
      openConfirmation({
        title: "Descartar alterações?",
        description: mensagem,
        confirmLabel: "Descartar",
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
  }

  async function abrirEditorDeImagem() {
    if (!editorImagem || !imageModel) {
      showToast("danger", "Editor indisponível", "A biblioteca de edição não foi carregada. Recarregue a página.");
      return;
    }
    const original = project.product.originalImage;
    if (!original.dataUrl) {
      showToast("warning", "Nenhuma imagem", "Envie a imagem do produto antes de abrir o editor.");
      return;
    }

    const resultado = await editorImagem.abrir({
      dataUrl: original.dataUrl,
      fileName: original.fileName,
      width: original.width,
      height: original.height,
      editing: project.product.editing,
      capacidadesIa: capacidadesIa,
    });

    // Cancelar devolve null: o projeto não é tocado em nenhum ponto.
    if (!resultado) return;

    const antes = project.product.editedImage.id;
    project.product = {
      ...project.product,
      ...imageModel.applyEditingToProduct(project.product, resultado.editing, resultado.rendered),
    };
    if (antes && antes !== project.product.editedImage.id) idsPersistidos.delete(antes);

    renderEditor();
    persistProject(false);
    showToast("success", "Edição aplicada", "As 7 peças já estão usando a imagem editada.");
  }

  function restaurarImagemOriginal() {
    if (!imageModel) return;
    const antes = project.product.editedImage.id;
    project.product = { ...project.product, ...imageModel.restoreOriginalImage(project.product) };
    if (antes) idsPersistidos.delete(antes);
    renderEditor();
    persistProject(false);
  }

  async function carregarCapacidadesIa() {
    if (!imageApi) return;
    const estado = await imageApi.capacidadesIa();
    capacidadesIa = estado.capacidades;
  }

  async function loadClients() {
    const token = localStorage.getItem(TOKEN_KEY);
    const warning = byId("dt-client-warning");
    if (!token) return;
    try {
      const response = await fetch(`${API_BASE}/design/clientes`, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false || !Array.isArray(data?.clientes)) throw new Error(data?.erro || `HTTP ${response.status}`);
      clients = data.clientes.filter((client) => client && client.ativo !== false);
      const select = byId("dt-client-select");
      const options = clients.map((client) => {
        const option = document.createElement("option");
        option.value = String(client.id);
        option.textContent = client.nome || client.slug || `Cliente ${client.id}`;
        return option;
      });
      select.append(...options);
      warning.hidden = true;
      syncClientSelection();
    } catch {
      warning.hidden = false;
      byId("dt-client-warning-text").textContent = "Não foi possível carregar os clientes ativos. O projeto continua disponível com preenchimento manual.";
    }
  }

  function onClientChange() {
    const value = byId("dt-client-select").value;
    if (!value) {
      project.clienteId = null;
      if (!project.clienteNome) project.clienteNome = "Cliente personalizado";
    } else {
      const client = clients.find((item) => String(item.id) === value);
      if (client) {
        project.clienteId = client.id;
        project.clienteNome = String(client.nome || client.slug || "Cliente").slice(0, 80);
      }
    }
    renderEditor();
    scheduleAutosave();
  }

  function sanitizeFilename(value, fallback) {
    const normalized = normalizeSearch(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
    return normalized || fallback;
  }

  function timestampForFile() {
    return new Date().toISOString().replace(/[:.]/g, "-");
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportConfiguration() {
    const template = getActiveTemplate();
    const payload = {
      version: project.version,
      exportedAt: new Date().toISOString(),
      template: {
        id: template.id,
        name: template.name,
        segment: template.segment,
        marketplace: template.marketplace,
        width: template.canvas.width,
        height: template.canvas.height,
        pieces: template.pages.length,
      },
      cliente: { id: project.clienteId, nome: project.clienteNome },
      marcaNome: project.marcaNome,
      palette: { ...project.palette },
      logo: { ...project.logo },
      product: {
        name: project.product.name,
        subtitle: project.product.subtitle,
        originalImage: { ...project.product.originalImage },
        editedImage: { ...project.product.editedImage },
        editing: { ...project.product.editing },
        placement: { ...project.product.placement },
      },
      content: { ...project.content },
      selectedPage: project.selectedPage,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const name = sanitizeFilename(project.clienteNome, "cliente");
    downloadBlob(blob, `projeto-template-${name}-${timestampForFile()}.json`);
    showToast("success", "Configuração exportada", "O arquivo JSON foi gerado sem dados de autenticação.");
  }

  function exportCurrentPage() {
    const source = previewProject();
    // Exportar uma peça que não pôde ser montada geraria um PNG enganoso:
    // é melhor recusar e dizer o motivo.
    let svg;
    try {
      svg = createPageSvg(project.selectedPage, source);
    } catch {
      showToast("danger", "Não foi possível exportar", "Esta peça usa um layout que o estúdio não conhece.");
      return;
    }
    const serialized = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(svgUrl);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 1200;
        canvas.height = 1200;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas indisponível");
        context.drawImage(image, 0, 0, 1200, 1200);
        canvas.toBlob((blob) => {
          if (!blob) {
            showToast("danger", "Exportação bloqueada", "O navegador não conseguiu gerar o PNG desta peça.");
            return;
          }
          const clientName = sanitizeFilename(project.clienteNome, "cliente");
          const templateName = sanitizeFilename(getActiveTemplate().name, "template");
          downloadBlob(blob, `${clientName}-${templateName}-pagina-${String(project.selectedPage + 1).padStart(2, "0")}.png`);
          showToast("success", "Página exportada", "PNG gerado em 1200 × 1200 px.");
        }, "image/png");
      } catch {
        showToast("danger", "Não foi possível exportar", "O navegador impediu a conversão do SVG para PNG.");
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      showToast("danger", "Não foi possível exportar", "A peça não pôde ser carregada para conversão em PNG.");
    };
    image.src = svgUrl;
  }

  function openConfirmation(options) {
    const overlay = byId("dt-confirm-overlay");
    focusBeforeModal = document.activeElement;
    confirmAction = options.onConfirm;
    cancelAction = options.onCancel;
    byId("dt-confirm-title").textContent = options.title;
    byId("dt-confirm-description").textContent = options.description;
    byId("dt-confirm-accept").textContent = options.confirmLabel || "Confirmar";
    byId("dt-confirm-accept").classList.toggle("dt-confirm-danger", options.danger !== false);
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("vf-no-scroll");
    byId("dt-confirm-cancel").focus();
  }

  // `executarCancelamento` diferencia "usuário desistiu" de "usuário confirmou":
  // o editor de imagem precisa dessa resposta para decidir se fecha ou não.
  function closeConfirmation(executarCancelamento) {
    const overlay = byId("dt-confirm-overlay");
    const cancelar = cancelAction;
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    // O editor de imagem também usa a classe; só libera o scroll se ele fechou.
    if (!byId("die-overlay")?.classList.contains("is-open")) {
      document.body.classList.remove("vf-no-scroll");
    }
    confirmAction = null;
    cancelAction = null;
    if (focusBeforeModal && typeof focusBeforeModal.focus === "function") focusBeforeModal.focus();
    if (executarCancelamento !== false && typeof cancelar === "function") cancelar();
  }

  function resetProject(view) {
    const fresh = createDefaultProject(project.templateId);
    fresh.view = view || "editor";
    project = fresh;
    persistProject(false);
    showView(project.view, { skipSave: true });
    renderLibrary();
    showToast("success", "Template restaurado", "O projeto voltou ao estado original.");
  }

  function bindTabs() {
    const tabs = [...document.querySelectorAll("[data-control-tab]")];
    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => activateControlTab(tab.dataset.controlTab));
      tab.addEventListener("keydown", (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const direction = event.key === 'ArrowRight' ? 1 : -1;
        const next = tabs[(index + direction + tabs.length) % tabs.length];
        activateControlTab(next.dataset.controlTab, true);
      });
    });
  }

  function bindEvents() {
    ["dt-search", "dt-segment-filter", "dt-marketplace-filter"].forEach((id) => byId(id).addEventListener("input", renderLibrary));
    Object.keys(CONTROL_BINDINGS).forEach((id) => byId(id).addEventListener("input", onBoundControlInput));
    byId("dt-client-select").addEventListener("change", onClientChange);
    byId("dt-logo-file").addEventListener("change", (event) => onLogoFileSelected(event.target.files?.[0]));
    byId("dt-product-file").addEventListener("change", (event) => onProductFileSelected(event.target.files?.[0]));
    byId("dt-remove-logo").addEventListener("click", () => removeImage("logo"));
    byId("dt-remove-product").addEventListener("click", () => removeImage("product"));
    byId("dt-edit-product").addEventListener("click", abrirEditorDeImagem);
    byId("dt-restore-product").addEventListener("click", restaurarImagemOriginal);
    byId("dt-save").addEventListener("click", () => persistProject(true));
    byId("dt-export-config").addEventListener("click", exportConfiguration);
    byId("dt-download-page").addEventListener("click", exportCurrentPage);
    byId("dt-back-library").addEventListener("click", () => showView("library"));
    byId("dt-library-tab").addEventListener("click", () => showView("library"));
    byId("dt-editor-tab").addEventListener("click", () => showView("editor"));
    byId("dt-new-project").addEventListener("click", () => openConfirmation({
      title: "Iniciar novo projeto?",
      description: "O projeto local atual será substituído pelos valores originais deste template.",
      confirmLabel: "Iniciar projeto",
      onConfirm: () => resetProject("editor"),
    }));
    byId("dt-reset").addEventListener("click", () => openConfirmation({
      title: "Restaurar template?",
      description: "Todos os ajustes locais, textos e imagens deste projeto serão apagados.",
      confirmLabel: "Restaurar",
      onConfirm: () => resetProject("editor"),
    }));
    byId("dt-view-original").addEventListener("click", () => {
      project.compareMode = "original";
      renderPreviews();
      scheduleAutosave();
    });
    byId("dt-view-custom").addEventListener("click", () => {
      project.compareMode = "custom";
      renderPreviews();
      scheduleAutosave();
    });
    byId("dt-zoom").addEventListener("change", (event) => {
      project.zoom = Number(event.target.value);
      renderPreviews();
      scheduleAutosave();
    });
    byId("dt-confirm-cancel").addEventListener("click", () => closeConfirmation(true));
    byId("dt-confirm-accept").addEventListener("click", () => {
      const action = confirmAction;
      closeConfirmation(false);
      if (typeof action === "function") action();
    });
    byId("dt-confirm-overlay").addEventListener("click", (event) => {
      if (event.target === byId("dt-confirm-overlay")) closeConfirmation(true);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && byId("dt-confirm-overlay").classList.contains("is-open")) closeConfirmation(true);
    });
    window.addEventListener("beforeunload", () => {
      if (autosaveTimer) persistProject(false);
    });
    bindTabs();
  }

  // Projetos salvos antes do editor (V1) guardavam base64 no localStorage.
  // Depois da migração o projeto é regravado no formato novo e o base64 vai
  // para o IndexedDB — a partir daí o localStorage só carrega metadados.
  function finalizarMigracao() {
    if (!migracaoAplicada) return;
    persistProject(false);
    if (migracaoAplicada.logoDescartado) {
      showToast(
        "warning",
        "Logo em SVG removido",
        "Por segurança o estúdio deixou de aceitar SVG. Envie o logo em PNG, JPG ou WebP."
      );
    }
    migracaoAplicada = null;
  }

  // Todo template do catálogo precisa ter layout para cada rendererId. Uma
  // falha aqui é erro de configuração do preset e vale um aviso claro no
  // boot, em vez de só aparecer quando o usuário abrir a peça.
  function validarLayoutsDosTemplates() {
    templateRegistry.getAll().forEach((template) => {
      const vinculos = templateRenderer.validateRendererBindings(template);
      if (vinculos.ok) return;
      showToast("danger", "Template incompleto", vinculos.mensagem);
    });
  }

  function init() {
    if (typeof window.initLayout === "function") window.initLayout();
    if (imageEditorLib) {
      editorImagem = imageEditorLib.createDesignImageEditor({
        showToast,
        confirmar: pedirConfirmacao,
      });
    }
    validarLayoutsDosTemplates();
    populateLibraryFilters();
    bindEvents();
    renderLibrary();
    syncControls();
    showView(project.view, { skipSave: true });
    setSaveStatus("Alterações salvas localmente", "saved");
    loadClients();

    // Nada abaixo bloqueia a primeira pintura da tela.
    hydrateImagesFromStorage()
      .then(finalizarMigracao)
      .catch(() => finalizarMigracao());
    carregarCapacidadesIa();
  }

  init();
})();
