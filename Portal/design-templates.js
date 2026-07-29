(function () {
  "use strict";

  const STORAGE_KEY = "vf-design-template-studio-v1";
  const TOKEN_KEY = "vf-token";
  const API_BASE = "https://venforce-server.onrender.com";
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
  const SVG_NS = "http://www.w3.org/2000/svg";

  const TEMPLATE_CATALOG = [
    {
      id: "portable-charger-complete-v1",
      name: "Carregador portátil — conjunto completo",
      segment: "Eletrônicos",
      marketplace: "Mercado Livre",
      width: 1200,
      height: 1200,
      pieces: 7,
    },
  ];

  const PAGE_DEFINITIONS = [
    { id: "cover", name: "Capa principal" },
    { id: "wireless", name: "Carregamento por indução" },
    { id: "led", name: "Iluminação LED" },
    { id: "package", name: "Conteúdo da embalagem" },
    { id: "dimensions", name: "Dimensões" },
    { id: "features", name: "Painel e funcionalidades" },
    { id: "safe", name: "Compra segura" },
  ];

  function createDefaultProject() {
    return {
      version: 1,
      templateId: TEMPLATE_CATALOG[0].id,
      clienteId: null,
      clienteNome: "Cliente personalizado",
      marcaNome: "NOVA",
      palette: {
        primary: "#123047",
        secondary: "#ef6f55",
        background: "#f4efe5",
        text: "#12202b",
      },
      product: {
        name: "Power Station One",
        subtitle: "Energia portátil, conexão sem fio e luz para acompanhar sua rotina.",
        imageDataUrl: null,
        fileName: "",
        scale: 100,
        x: 50,
        y: 50,
      },
      logoDataUrl: null,
      logoFileName: "",
      content: {
        benefit: "Energia para o dia inteiro, onde você estiver.",
        wireless: "Carregue dispositivos compatíveis por indução, sem cabos e com encaixe simples.",
        led: "Iluminação LED integrada com intensidade confortável para emergências e uso diário.",
        packageItems: "1 carregador portátil\n1 cabo USB-C\n1 manual de uso",
        width: "8,2 cm",
        height: "14,6 cm",
        depth: "2,8 cm",
        features: "Display digital de carga\nSaídas USB e USB-C\nProteção contra sobrecarga\nBase para apoio do celular",
        safe: "Pagamento protegido do início ao fim.",
        shipping: "Envio rápido com acompanhamento do pedido.",
        warranty: "Garantia de 90 dias contra defeitos de fabricação.",
      },
      selectedPage: 0,
      view: "library",
      compareMode: "custom",
      zoom: 100,
    };
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Number(value)));
  }

  function hexToRgb(hex) {
    const clean = String(hex || "").replace("#", "");
    const normalized = clean.length === 3 ? clean.split("").map((part) => part + part).join("") : clean;
    const value = Number.parseInt(normalized, 16);
    if (!Number.isFinite(value)) return { r: 0, g: 0, b: 0 };
    return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
  }

  function rgbToHex(rgb) {
    const part = (value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
    return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
  }

  function mix(hex, target, amount) {
    const source = hexToRgb(hex);
    const destination = hexToRgb(target);
    return rgbToHex({
      r: source.r + (destination.r - source.r) * amount,
      g: source.g + (destination.g - source.g) * amount,
      b: source.b + (destination.b - source.b) * amount,
    });
  }

  function isHex(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || ""));
  }

  function hydrateProject(stored) {
    const defaults = createDefaultProject();
    if (!stored || stored.version !== 1 || stored.templateId !== defaults.templateId) return defaults;
    return {
      ...defaults,
      clienteId: stored.clienteId ?? null,
      clienteNome: String(stored.clienteNome || defaults.clienteNome).slice(0, 80),
      marcaNome: String(stored.marcaNome || defaults.marcaNome).slice(0, 40),
      palette: {
        primary: isHex(stored.palette?.primary) ? stored.palette.primary : defaults.palette.primary,
        secondary: isHex(stored.palette?.secondary) ? stored.palette.secondary : defaults.palette.secondary,
        background: isHex(stored.palette?.background) ? stored.palette.background : defaults.palette.background,
        text: isHex(stored.palette?.text) ? stored.palette.text : defaults.palette.text,
      },
      product: {
        ...defaults.product,
        name: String(stored.product?.name || defaults.product.name).slice(0, 64),
        subtitle: String(stored.product?.subtitle || defaults.product.subtitle).slice(0, 120),
        imageDataUrl: typeof stored.product?.imageDataUrl === "string" ? stored.product.imageDataUrl : null,
        fileName: String(stored.product?.fileName || "").slice(0, 180),
        scale: clamp(stored.product?.scale ?? defaults.product.scale, 60, 145),
        x: clamp(stored.product?.x ?? defaults.product.x, 20, 80),
        y: clamp(stored.product?.y ?? defaults.product.y, 20, 80),
      },
      logoDataUrl: typeof stored.logoDataUrl === "string" ? stored.logoDataUrl : null,
      logoFileName: String(stored.logoFileName || "").slice(0, 180),
      content: {
        benefit: String(stored.content?.benefit || defaults.content.benefit).slice(0, 110),
        wireless: String(stored.content?.wireless || defaults.content.wireless).slice(0, 180),
        led: String(stored.content?.led || defaults.content.led).slice(0, 180),
        packageItems: String(stored.content?.packageItems || defaults.content.packageItems).slice(0, 260),
        width: String(stored.content?.width || defaults.content.width).slice(0, 18),
        height: String(stored.content?.height || defaults.content.height).slice(0, 18),
        depth: String(stored.content?.depth || defaults.content.depth).slice(0, 18),
        features: String(stored.content?.features || defaults.content.features).slice(0, 300),
        safe: String(stored.content?.safe || defaults.content.safe).slice(0, 140),
        shipping: String(stored.content?.shipping || defaults.content.shipping).slice(0, 140),
        warranty: String(stored.content?.warranty || defaults.content.warranty).slice(0, 140),
      },
      selectedPage: clamp(stored.selectedPage ?? 0, 0, PAGE_DEFINITIONS.length - 1),
      view: stored.view === "editor" ? "editor" : "library",
      compareMode: stored.compareMode === "original" ? "original" : "custom",
      zoom: [75, 100, 125].includes(Number(stored.zoom)) ? Number(stored.zoom) : 100,
    };
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
  let focusBeforeModal = null;

  const byId = (id) => document.getElementById(id);

  function setSaveStatus(message, mode) {
    const status = byId("dt-save-status");
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("is-saving", mode === "saving");
    status.classList.toggle("is-error", mode === "error");
  }

  function persistProject(showSuccessToast) {
    if (autosaveTimer) {
      window.clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
      setSaveStatus("Alterações salvas localmente", "saved");
      if (showSuccessToast) showToast("success", "Projeto salvo", "As alterações foram persistidas neste navegador.");
      return true;
    } catch (error) {
      setSaveStatus("Não foi possível salvar localmente", "error");
      showToast("danger", "Armazenamento indisponível", "Remova uma imagem grande ou libere espaço local e tente novamente.");
      return false;
    }
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

  function derivedPalette(source) {
    return {
      primary: source.primary,
      primaryDark: mix(source.primary, "#000000", 0.28),
      primaryLight: mix(source.primary, "#ffffff", 0.88),
      secondary: source.secondary,
      secondaryDark: mix(source.secondary, "#000000", 0.2),
      secondaryLight: mix(source.secondary, "#ffffff", 0.84),
      background: source.background,
      text: source.text,
      muted: mix(source.text, source.background, 0.5),
      surface: mix(source.background, "#ffffff", 0.72),
      white: "#ffffff",
    };
  }

  function normalizeSearch(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  }

  function uniqueValues(key) {
    return [...new Set(TEMPLATE_CATALOG.map((item) => item[key]))].sort((a, b) => a.localeCompare(b, "pt-BR"));
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
      ["Formato", `${template.width} × ${template.height} px`],
      ["Conjunto", `${template.pieces} peças`],
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
    const filtered = TEMPLATE_CATALOG.filter((template) => {
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
      "dt-product-scale": project.product.scale,
      "dt-product-x": project.product.x,
      "dt-product-y": project.product.y,
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
    byId("dt-product-scale-value").textContent = `${project.product.scale}%`;
    byId("dt-product-x-value").textContent = `${project.product.x}%`;
    byId("dt-product-y-value").textContent = `${project.product.y}%`;
    syncUploadState("logo", project.logoDataUrl, project.logoFileName);
    syncUploadState("product", project.product.imageDataUrl, project.product.fileName);
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
    "dt-product-scale": "product.scale",
    "dt-product-x": "product.x",
    "dt-product-y": "product.y",
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

  function svgElement(name, attributes, parent) {
    const element = document.createElementNS(SVG_NS, name);
    Object.entries(attributes || {}).forEach(([key, value]) => element.setAttribute(key, String(value)));
    if (parent) parent.appendChild(element);
    return element;
  }

  function svgText(parent, content, attributes) {
    const element = svgElement("text", attributes, parent);
    element.textContent = String(content || "");
    return element;
  }

  function wrappedText(parent, content, x, y, options) {
    const maxChars = options.maxChars || 26;
    const maxLines = options.maxLines || 3;
    const words = String(content || "").trim().split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    words.forEach((word) => {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > maxChars && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    });
    if (current) lines.push(current);
    const visible = lines.slice(0, maxLines);
    if (lines.length > maxLines && visible.length) visible[visible.length - 1] = `${visible[visible.length - 1].replace(/[.,;:]$/, "")}…`;
    const textNode = svgElement("text", {
      x,
      y,
      fill: options.fill,
      "font-family": options.fontFamily || "Manrope, Arial, sans-serif",
      "font-size": options.fontSize,
      "font-weight": options.fontWeight || 600,
      "letter-spacing": options.letterSpacing || 0,
      "text-anchor": options.textAnchor || "start",
    }, parent);
    visible.forEach((line, index) => {
      const tspan = svgElement("tspan", { x, dy: index === 0 ? 0 : options.lineHeight || options.fontSize * 1.15 }, textNode);
      tspan.textContent = line;
    });
    return textNode;
  }

  function addSvgStyles(svg) {
    const style = svgElement("style", {}, svg);
    style.textContent = "text{font-synthesis:none} .dt-fine{font-family:'IBM Plex Mono',monospace;letter-spacing:2px} .dt-body{font-family:'Hanken Grotesk',Arial,sans-serif} .dt-display{font-family:Manrope,Arial,sans-serif}";
  }

  function drawBrand(svg, state, palette, options) {
    const group = svgElement("g", {}, svg);
    const x = options?.x ?? 72;
    const y = options?.y ?? 66;
    const onDark = options?.onDark;
    if (state.logoDataUrl) {
      svgElement("image", { href: state.logoDataUrl, x, y, width: 190, height: 72, preserveAspectRatio: "xMinYMid meet" }, group);
    } else {
      svgElement("rect", { x, y, width: 48, height: 48, rx: 9, fill: onDark ? palette.secondary : palette.primary }, group);
      svgText(group, String(state.marcaNome || "N").slice(0, 1).toUpperCase(), { x: x + 24, y: y + 33, "text-anchor": "middle", fill: palette.white, "font-family": "Manrope,Arial,sans-serif", "font-size": 25, "font-weight": 800 });
      svgText(group, state.marcaNome || "NOVA", { x: x + 62, y: y + 34, fill: onDark ? palette.white : palette.text, "font-family": "Manrope,Arial,sans-serif", "font-size": 25, "font-weight": 800, "letter-spacing": 2 });
    }
    return group;
  }

  function drawPageNumber(svg, index, palette, onDark) {
    svgText(svg, `${String(index + 1).padStart(2, "0")} / 07`, { x: 1124, y: 84, "text-anchor": "end", fill: onDark ? palette.white : palette.muted, class: "dt-fine", "font-size": 15, "font-weight": 600 });
  }

  function drawProduct(svg, state, palette, centerX, centerY, baseSize) {
    const scale = (state.product.scale / 100) * (baseSize / 430);
    const offsetX = (state.product.x - 50) * 4.5;
    const offsetY = (state.product.y - 50) * 4.5;
    const group = svgElement("g", { transform: `translate(${centerX + offsetX} ${centerY + offsetY}) scale(${scale})` }, svg);
    if (state.product.imageDataUrl) {
      svgElement("image", { href: state.product.imageDataUrl, x: -260, y: -260, width: 520, height: 520, preserveAspectRatio: "xMidYMid meet" }, group);
      return group;
    }
    svgElement("ellipse", { cx: 12, cy: 230, rx: 210, ry: 34, fill: palette.primaryDark, opacity: 0.18 }, group);
    svgElement("rect", { x: -174, y: -250, width: 348, height: 494, rx: 52, fill: palette.primaryDark, transform: "rotate(-7)", stroke: palette.surface, "stroke-width": 8 }, group);
    svgElement("rect", { x: -151, y: -226, width: 302, height: 446, rx: 39, fill: palette.primary, transform: "rotate(-7)" }, group);
    svgElement("circle", { cx: -6, cy: -36, r: 100, fill: "none", stroke: palette.secondary, "stroke-width": 10, opacity: 0.9 }, group);
    svgElement("circle", { cx: -6, cy: -36, r: 72, fill: "none", stroke: palette.surface, "stroke-width": 3, opacity: 0.55 }, group);
    const bolt = svgElement("path", { d: "M 8 -100 L -34 -20 L 8 -20 L -10 40 L 55 -47 L 12 -47 Z", fill: palette.secondary }, group);
    bolt.setAttribute("transform", "rotate(-7)");
    svgElement("rect", { x: -82, y: 157, width: 120, height: 32, rx: 9, fill: palette.surface, opacity: 0.94, transform: "rotate(-7)" }, group);
    svgText(group, "72%", { x: -22, y: 180, "text-anchor": "middle", fill: palette.primaryDark, class: "dt-fine", "font-size": 18, "font-weight": 700, transform: "rotate(-7)" });
    return group;
  }

  function drawChip(svg, label, x, y, palette, onDark) {
    const width = Math.max(112, String(label).length * 11 + 34);
    svgElement("rect", { x, y, width, height: 42, rx: 21, fill: onDark ? palette.white : palette.primaryLight, opacity: onDark ? 0.14 : 1 }, svg);
    svgText(svg, label, { x: x + width / 2, y: y + 27, "text-anchor": "middle", fill: onDark ? palette.white : palette.primary, class: "dt-body", "font-size": 15, "font-weight": 700 });
  }

  function drawCover(svg, state, palette) {
    svgElement("rect", { width: 1200, height: 1200, fill: palette.background }, svg);
    svgElement("path", { d: "M760 0H1200V1200H610C790 1010 848 794 784 575C727 378 658 205 760 0Z", fill: palette.primary }, svg);
    svgElement("circle", { cx: 1075, cy: 180, r: 170, fill: palette.secondary, opacity: 0.92 }, svg);
    drawBrand(svg, state, palette);
    drawPageNumber(svg, 0, palette, false);
    svgText(svg, "ENERGIA PORTÁTIL", { x: 76, y: 194, fill: palette.secondaryDark, class: "dt-fine", "font-size": 17, "font-weight": 700 });
    wrappedText(svg, state.product.name, 72, 288, { maxChars: 18, maxLines: 3, fontSize: 76, lineHeight: 82, fill: palette.text, fontWeight: 800 });
    wrappedText(svg, state.content.benefit, 76, 584, { maxChars: 32, maxLines: 3, fontSize: 29, lineHeight: 38, fill: palette.muted, fontWeight: 500, fontFamily: "Hanken Grotesk,Arial,sans-serif" });
    drawChip(svg, "INDUÇÃO", 74, 756, palette, false);
    drawChip(svg, "USB-C", 222, 756, palette, false);
    drawChip(svg, "LED", 350, 756, palette, false);
    drawProduct(svg, state, palette, 856, 655, 490);
    svgText(svg, "PRONTO PARA A ROTINA", { x: 76, y: 1096, fill: palette.text, class: "dt-body", "font-size": 18, "font-weight": 700 });
    svgElement("line", { x1: 76, y1: 1118, x2: 408, y2: 1118, stroke: palette.secondary, "stroke-width": 7 }, svg);
  }

  function drawWireless(svg, state, palette) {
    svgElement("rect", { width: 1200, height: 1200, fill: palette.surface }, svg);
    svgElement("rect", { x: 0, y: 0, width: 1200, height: 170, fill: palette.primary }, svg);
    drawBrand(svg, state, palette, { x: 72, y: 50, onDark: true });
    drawPageNumber(svg, 1, palette, true);
    svgText(svg, "SEM CABOS. SEM PAUSA.", { x: 72, y: 262, fill: palette.secondaryDark, class: "dt-fine", "font-size": 17, "font-weight": 700 });
    wrappedText(svg, "Carregamento por indução", 70, 355, { maxChars: 23, maxLines: 3, fontSize: 68, lineHeight: 75, fill: palette.text, fontWeight: 800 });
    wrappedText(svg, state.content.wireless, 74, 650, { maxChars: 44, maxLines: 4, fontSize: 27, lineHeight: 36, fill: palette.muted, fontWeight: 500, fontFamily: "Hanken Grotesk,Arial,sans-serif" });
    svgElement("circle", { cx: 906, cy: 624, r: 276, fill: palette.primaryLight }, svg);
    svgElement("circle", { cx: 906, cy: 624, r: 205, fill: "none", stroke: palette.secondary, "stroke-width": 8, "stroke-dasharray": "18 15" }, svg);
    svgElement("circle", { cx: 906, cy: 624, r: 151, fill: "none", stroke: palette.primary, "stroke-width": 5, opacity: 0.5 }, svg);
    drawProduct(svg, state, palette, 906, 652, 360);
    svgText(svg, "APOIE • CONECTE • CONTINUE", { x: 72, y: 1090, fill: palette.primary, class: "dt-fine", "font-size": 18, "font-weight": 700 });
  }

  function drawLed(svg, state, palette) {
    svgElement("rect", { width: 1200, height: 1200, fill: palette.primaryDark }, svg);
    svgElement("circle", { cx: 876, cy: 560, r: 340, fill: palette.secondary, opacity: 0.08 }, svg);
    svgElement("circle", { cx: 876, cy: 560, r: 270, fill: palette.secondary, opacity: 0.12 }, svg);
    svgElement("circle", { cx: 876, cy: 560, r: 200, fill: palette.secondary, opacity: 0.18 }, svg);
    drawBrand(svg, state, palette, { onDark: true });
    drawPageNumber(svg, 2, palette, true);
    svgText(svg, "LUZ QUANDO VOCÊ PRECISA", { x: 72, y: 228, fill: palette.secondary, class: "dt-fine", "font-size": 17, "font-weight": 700 });
    wrappedText(svg, "Iluminação LED integrada", 70, 324, { maxChars: 20, maxLines: 3, fontSize: 70, lineHeight: 76, fill: palette.white, fontWeight: 800 });
    wrappedText(svg, state.content.led, 74, 642, { maxChars: 40, maxLines: 4, fontSize: 27, lineHeight: 36, fill: mix(palette.primary, "#ffffff", 0.74), fontWeight: 500, fontFamily: "Hanken Grotesk,Arial,sans-serif" });
    drawProduct(svg, state, palette, 876, 646, 420);
    [[755, 892], [876, 934], [997, 892]].forEach(([x, y], index) => {
      svgElement("circle", { cx: x, cy: y, r: 25, fill: index === 1 ? palette.secondary : palette.surface, opacity: index === 1 ? 1 : 0.5 }, svg);
    });
    svgText(svg, "3 NÍVEIS DE INTENSIDADE", { x: 876, y: 1028, "text-anchor": "middle", fill: palette.white, class: "dt-fine", "font-size": 16, "font-weight": 700 });
  }

  function drawPackage(svg, state, palette) {
    svgElement("rect", { width: 1200, height: 1200, fill: palette.background }, svg);
    svgElement("rect", { x: 650, y: 0, width: 550, height: 1200, fill: palette.primaryLight }, svg);
    drawBrand(svg, state, palette);
    drawPageNumber(svg, 3, palette, false);
    svgText(svg, "NA CAIXA", { x: 72, y: 230, fill: palette.secondaryDark, class: "dt-fine", "font-size": 17, "font-weight": 700 });
    wrappedText(svg, "Tudo o que acompanha seu produto", 70, 330, { maxChars: 21, maxLines: 4, fontSize: 63, lineHeight: 69, fill: palette.text, fontWeight: 800 });
    const items = String(state.content.packageItems || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 5);
    items.forEach((item, index) => {
      const y = 690 + index * 86;
      svgElement("rect", { x: 74, y: y - 34, width: 46, height: 46, rx: 10, fill: palette.secondary }, svg);
      svgText(svg, String(index + 1).padStart(2, "0"), { x: 97, y: y - 4, "text-anchor": "middle", fill: palette.white, class: "dt-fine", "font-size": 14, "font-weight": 700 });
      svgText(svg, item, { x: 144, y, fill: palette.text, class: "dt-body", "font-size": 25, "font-weight": 600 });
    });
    drawProduct(svg, state, palette, 888, 570, 400);
    svgElement("path", { d: "M735 904h310l-36 170H771z", fill: palette.surface, stroke: palette.primary, "stroke-width": 5 }, svg);
    svgElement("path", { d: "M735 904l155 85 155-85M890 989v85", fill: "none", stroke: palette.primary, "stroke-width": 5 }, svg);
  }

  function drawDimensions(svg, state, palette) {
    svgElement("rect", { width: 1200, height: 1200, fill: palette.surface }, svg);
    drawBrand(svg, state, palette);
    drawPageNumber(svg, 4, palette, false);
    svgText(svg, "MEDIDAS REAIS", { x: 72, y: 208, fill: palette.secondaryDark, class: "dt-fine", "font-size": 17, "font-weight": 700 });
    wrappedText(svg, "Compacto por fora. Potente por dentro.", 70, 300, { maxChars: 23, maxLines: 3, fontSize: 66, lineHeight: 72, fill: palette.text, fontWeight: 800 });
    svgElement("rect", { x: 72, y: 570, width: 1056, height: 510, fill: palette.primaryLight }, svg);
    drawProduct(svg, state, palette, 600, 814, 380);
    const dimensionLine = (x1, y1, x2, y2, label, tx, ty) => {
      svgElement("line", { x1, y1, x2, y2, stroke: palette.secondaryDark, "stroke-width": 4 }, svg);
      svgElement("circle", { cx: x1, cy: y1, r: 7, fill: palette.secondary }, svg);
      svgElement("circle", { cx: x2, cy: y2, r: 7, fill: palette.secondary }, svg);
      svgText(svg, label, { x: tx, y: ty, fill: palette.text, class: "dt-fine", "font-size": 20, "font-weight": 700 });
    };
    dimensionLine(350, 1050, 845, 1050, `L ${state.content.width}`, 520, 1030);
    dimensionLine(325, 610, 325, 1015, `A ${state.content.height}`, 152, 820);
    dimensionLine(870, 700, 1020, 632, `P ${state.content.depth}`, 906, 616);
  }

  function drawFeatures(svg, state, palette) {
    svgElement("rect", { width: 1200, height: 1200, fill: palette.background }, svg);
    svgElement("path", { d: "M0 0h480v1200H0z", fill: palette.primary }, svg);
    drawBrand(svg, state, palette, { onDark: true });
    drawPageNumber(svg, 5, palette, false);
    drawProduct(svg, state, palette, 280, 650, 370);
    svgText(svg, "CONTROLE NA PALMA DA MÃO", { x: 536, y: 210, fill: palette.secondaryDark, class: "dt-fine", "font-size": 17, "font-weight": 700 });
    wrappedText(svg, "Painel claro. Funções essenciais.", 532, 310, { maxChars: 20, maxLines: 3, fontSize: 63, lineHeight: 69, fill: palette.text, fontWeight: 800 });
    const features = String(state.content.features || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 5);
    features.forEach((item, index) => {
      const y = 610 + index * 100;
      svgElement("line", { x1: 536, y1: y - 37, x2: 1128, y2: y - 37, stroke: mix(palette.text, palette.background, 0.8), "stroke-width": 2 }, svg);
      svgElement("circle", { cx: 558, cy: y, r: 16, fill: palette.secondary }, svg);
      svgElement("path", { d: `M${550} ${y}l6 6 12-15`, fill: "none", stroke: palette.white, "stroke-width": 4, "stroke-linecap": "round", "stroke-linejoin": "round" }, svg);
      svgText(svg, item, { x: 594, y: y + 8, fill: palette.text, class: "dt-body", "font-size": 25, "font-weight": 600 });
    });
  }

  function drawSafe(svg, state, palette) {
    svgElement("rect", { width: 1200, height: 1200, fill: palette.primaryDark }, svg);
    svgElement("path", { d: "M0 890C270 760 470 940 714 820c196-96 305-71 486-5v385H0z", fill: palette.primary }, svg);
    drawBrand(svg, state, palette, { onDark: true });
    drawPageNumber(svg, 6, palette, true);
    svgText(svg, "SUA ESCOLHA, PROTEGIDA", { x: 600, y: 235, "text-anchor": "middle", fill: palette.secondary, class: "dt-fine", "font-size": 17, "font-weight": 700 });
    wrappedText(svg, "Compre com tranquilidade", 600, 335, { maxChars: 25, maxLines: 2, fontSize: 72, lineHeight: 80, fill: palette.white, fontWeight: 800, textAnchor: "middle" });
    svgElement("path", { d: "M600 515l112 43v89c0 91-58 154-112 183-54-29-112-92-112-183v-89z", fill: palette.secondary }, svg);
    svgElement("path", { d: "M548 652l34 35 74-83", fill: "none", stroke: palette.white, "stroke-width": 16, "stroke-linecap": "round", "stroke-linejoin": "round" }, svg);
    const assurances = [state.content.safe, state.content.shipping, state.content.warranty];
    assurances.forEach((item, index) => {
      const x = 72 + index * 362;
      svgElement("rect", { x, y: 914, width: 330, height: 190, rx: 12, fill: palette.surface }, svg);
      svgText(svg, String(index + 1).padStart(2, "0"), { x: x + 26, y: 955, fill: palette.secondaryDark, class: "dt-fine", "font-size": 15, "font-weight": 700 });
      wrappedText(svg, item, x + 26, 1002, { maxChars: 28, maxLines: 3, fontSize: 21, lineHeight: 28, fill: palette.text, fontWeight: 650, fontFamily: "Hanken Grotesk,Arial,sans-serif" });
    });
  }

  const PAGE_DRAWERS = [drawCover, drawWireless, drawLed, drawPackage, drawDimensions, drawFeatures, drawSafe];

  function createPageSvg(pageIndex, sourceProject) {
    const safeIndex = clamp(pageIndex, 0, PAGE_DRAWERS.length - 1);
    const svg = svgElement("svg", { xmlns: SVG_NS, viewBox: "0 0 1200 1200", width: 1200, height: 1200, role: "img", "aria-label": PAGE_DEFINITIONS[safeIndex].name });
    addSvgStyles(svg);
    PAGE_DRAWERS[safeIndex](svg, sourceProject, derivedPalette(sourceProject.palette));
    return svg;
  }

  function previewProject() {
    return project.compareMode === "original" ? createDefaultProject() : project;
  }

  function renderPreviews() {
    const source = previewProject();
    const main = byId("dt-main-preview");
    main.replaceChildren(createPageSvg(project.selectedPage, source));
    main.classList.toggle("is-original", project.compareMode === "original");
    main.style.width = `${project.zoom}%`;
    byId("dt-page-number").textContent = `PEÇA ${String(project.selectedPage + 1).padStart(2, "0")} DE 07`;
    byId("dt-page-name").textContent = PAGE_DEFINITIONS[project.selectedPage].name;
    byId("dt-view-original").classList.toggle("is-active", project.compareMode === "original");
    byId("dt-view-original").setAttribute("aria-pressed", String(project.compareMode === "original"));
    byId("dt-view-custom").classList.toggle("is-active", project.compareMode === "custom");
    byId("dt-view-custom").setAttribute("aria-pressed", String(project.compareMode === "custom"));

    const thumbnails = PAGE_DEFINITIONS.map((page, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `dt-thumbnail${project.selectedPage === index ? " is-active" : ""}`;
      button.setAttribute("aria-label", `Abrir peça ${index + 1}: ${page.name}`);
      button.setAttribute("aria-current", project.selectedPage === index ? "true" : "false");
      const art = document.createElement("span");
      art.className = "dt-thumb-art";
      art.appendChild(createPageSvg(index, source));
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

  function readLocalImage(file, onSuccess) {
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) {
      showToast("danger", "Arquivo não suportado", "Selecione um arquivo de imagem válido.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      showToast("danger", "Imagem muito grande", "O limite local é de 2 MB por arquivo.");
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string" || !reader.result.startsWith("data:image/")) {
        showToast("danger", "Falha ao ler imagem", "O navegador não conseguiu preparar este arquivo.");
        return;
      }
      onSuccess(reader.result, file.name);
      renderEditor();
      scheduleAutosave();
    });
    reader.addEventListener("error", () => showToast("danger", "Falha ao ler imagem", "Tente selecionar outro arquivo."));
    reader.readAsDataURL(file);
  }

  function removeImage(kind) {
    if (kind === "logo") {
      project.logoDataUrl = null;
      project.logoFileName = "";
      byId("dt-logo-file").value = "";
    } else {
      project.product.imageDataUrl = null;
      project.product.fileName = "";
      byId("dt-product-file").value = "";
    }
    renderEditor();
    scheduleAutosave();
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
    const template = TEMPLATE_CATALOG.find((item) => item.id === project.templateId) || TEMPLATE_CATALOG[0];
    const payload = {
      version: project.version,
      exportedAt: new Date().toISOString(),
      template: { ...template },
      cliente: { id: project.clienteId, nome: project.clienteNome },
      marcaNome: project.marcaNome,
      palette: { ...project.palette },
      logoDataUrl: project.logoDataUrl,
      product: { ...project.product },
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
    const svg = createPageSvg(project.selectedPage, source);
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
          const templateName = sanitizeFilename(TEMPLATE_CATALOG[0].name, "template");
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
    byId("dt-confirm-title").textContent = options.title;
    byId("dt-confirm-description").textContent = options.description;
    byId("dt-confirm-accept").textContent = options.confirmLabel || "Confirmar";
    byId("dt-confirm-accept").classList.toggle("dt-confirm-danger", options.danger !== false);
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("vf-no-scroll");
    byId("dt-confirm-cancel").focus();
  }

  function closeConfirmation() {
    const overlay = byId("dt-confirm-overlay");
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("vf-no-scroll");
    confirmAction = null;
    if (focusBeforeModal && typeof focusBeforeModal.focus === "function") focusBeforeModal.focus();
  }

  function resetProject(view) {
    const fresh = createDefaultProject();
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
    byId("dt-logo-file").addEventListener("change", (event) => readLocalImage(event.target.files?.[0], (dataUrl, name) => {
      project.logoDataUrl = dataUrl;
      project.logoFileName = name;
    }));
    byId("dt-product-file").addEventListener("change", (event) => readLocalImage(event.target.files?.[0], (dataUrl, name) => {
      project.product.imageDataUrl = dataUrl;
      project.product.fileName = name;
    }));
    byId("dt-remove-logo").addEventListener("click", () => removeImage("logo"));
    byId("dt-remove-product").addEventListener("click", () => removeImage("product"));
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
    byId("dt-confirm-cancel").addEventListener("click", closeConfirmation);
    byId("dt-confirm-accept").addEventListener("click", () => {
      const action = confirmAction;
      closeConfirmation();
      if (typeof action === "function") action();
    });
    byId("dt-confirm-overlay").addEventListener("click", (event) => {
      if (event.target === byId("dt-confirm-overlay")) closeConfirmation();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && byId("dt-confirm-overlay").classList.contains("is-open")) closeConfirmation();
    });
    window.addEventListener("beforeunload", () => {
      if (autosaveTimer) persistProject(false);
    });
    bindTabs();
  }

  function init() {
    if (typeof window.initLayout === "function") window.initLayout();
    populateLibraryFilters();
    bindEvents();
    renderLibrary();
    syncControls();
    showView(project.view, { skipSave: true });
    setSaveStatus("Alterações salvas localmente", "saved");
    loadClients();
  }

  init();
})();
