// Portal/design-template-renderer.js
// -----------------------------------------------------------------------------
// Renderizador das peças do Estúdio de Templates.
//
// Junta as três pontas: o adaptador de SVG (única parte que fala com o
// documento), a biblioteca de componentes e o registro de layouts. Entrega
// um elemento <svg> pronto para o preview, para o XMLSerializer e para a
// rasterização em PNG.
//
// O que este módulo NÃO faz, de propósito: conhecer ids de input, salvar
// projeto, baixar arquivo, mostrar toast, ler token, falar com rede,
// localStorage ou IndexedDB. Ele recebe template + project e devolve SVG.
//
// Nada de document/window no import: `documentLike` chega em
// createSvgAdapter()/createTemplateRenderer().
// -----------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DESIGN_TEMPLATE_RENDERER = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  const SVG_STYLE_TEXT =
    "text{font-synthesis:none} .dt-fine{font-family:'IBM Plex Mono',monospace;letter-spacing:2px} "
    + ".dt-body{font-family:'Hanken Grotesk',Arial,sans-serif} .dt-display{font-family:Manrope,Arial,sans-serif}";

  /* ── matemática de cor (pura) ─────────────────────────────────────────── */

  function clampNumber(value, min, max) {
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
    const part = (value) => clampNumber(Math.round(value), 0, 255).toString(16).padStart(2, "0");
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

  // Paleta derivada: as 4 cores escolhidas pelo usuário viram as 10 usadas
  // pelas peças (e pelos tokens CSS da tela).
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

  /* ── adaptador de SVG ─────────────────────────────────────────────────── */

  // Única fronteira com o documento. `documentLike` precisa de
  // createElementNS — no navegador é o `document`; nos testes, um fake.
  function createSvgAdapter(documentLike) {
    if (!documentLike || typeof documentLike.createElementNS !== "function") {
      throw new Error("createSvgAdapter precisa de um documento com createElementNS.");
    }

    function element(name, attributes, parent) {
      const node = documentLike.createElementNS(SVG_NS, name);
      Object.entries(attributes || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
      if (parent) parent.appendChild(node);
      return node;
    }

    function text(parent, content, attributes) {
      const node = element("text", attributes, parent);
      node.textContent = String(content || "");
      return node;
    }

    // Quebra por contagem de caracteres (não por medição): as peças usam
    // fontes fixas e o resultado precisa ser idêntico fora do navegador,
    // onde não existe medição de texto.
    function wrapped(parent, content, x, y, options) {
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
      if (lines.length > maxLines && visible.length) {
        visible[visible.length - 1] = `${visible[visible.length - 1].replace(/[.,;:]$/, "")}…`;
      }
      const textNode = element("text", {
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
        const tspan = element("tspan", {
          x,
          dy: index === 0 ? 0 : options.lineHeight || options.fontSize * 1.15,
        }, textNode);
        tspan.textContent = line;
      });
      return textNode;
    }

    function addStyles(svg) {
      const style = element("style", {}, svg);
      style.textContent = SVG_STYLE_TEXT;
      return style;
    }

    return { element, text, wrapped, addStyles, SVG_NS };
  }

  /* ── renderizador ─────────────────────────────────────────────────────── */

  function fallbackProductImageSource(project) {
    const product = project && project.product;
    if (!product) return null;
    return (product.editedImage && product.editedImage.dataUrl)
      || (product.originalImage && product.originalImage.dataUrl)
      || null;
  }

  // options:
  //   documentLike               -> documento (obrigatório)
  //   componentsLib              -> módulo design-template-components
  //   layoutsLib                 -> módulo design-template-layouts
  //   resolveProductImageSource  -> opcional; por padrão lê editedImage/originalImage
  function createTemplateRenderer(options) {
    const config = options || {};
    const componentsLib = config.componentsLib;
    const layoutsLib = config.layoutsLib;

    if (!componentsLib || typeof componentsLib.createDesignTemplateComponents !== "function") {
      throw new Error("createTemplateRenderer precisa do módulo de componentes.");
    }
    if (!layoutsLib || typeof layoutsLib.createLayoutRegistry !== "function") {
      throw new Error("createTemplateRenderer precisa do módulo de layouts.");
    }

    const svg = createSvgAdapter(config.documentLike);
    const resolveProductImageSource = typeof config.resolveProductImageSource === "function"
      ? config.resolveProductImageSource
      : fallbackProductImageSource;

    const components = componentsLib.createDesignTemplateComponents({ svg, mix, resolveProductImageSource });
    const layouts = layoutsLib.createLayoutRegistry(components);

    function pageAt(template, pageIndex) {
      const total = template.pages.length;
      const safeIndex = Math.min(total - 1, Math.max(0, Number(pageIndex) || 0));
      return { page: template.pages[safeIndex], index: safeIndex, total };
    }

    // Cria o <svg> raiz. Sem `xmlns` explícito: createElementNS já coloca o
    // elemento no namespace e o XMLSerializer emite a declaração sozinho —
    // declarar à mão gerava xmlns duplicado, XML inválido na hora do PNG.
    function createRootSvg(template, page) {
      return svg.element("svg", {
        viewBox: `0 0 ${template.canvas.width} ${template.canvas.height}`,
        width: template.canvas.width,
        height: template.canvas.height,
        role: "img",
        "aria-label": page.name,
      });
    }

    // Devolve o elemento <svg> da página. `project` é lido, nunca alterado.
    //
    // `input.mode` distingue a prévia da tela do arquivo final: só a prévia
    // pode mostrar aviso de campo vazio. O padrão é "export" — quem exporta
    // não precisa lembrar de pedir arte limpa; quem previa é que pede o
    // extra. Os layouts do conjunto original ignoram este campo.
    function renderPage(input) {
      const { template, project } = input;
      const { page, index, total } = pageAt(template, input.pageIndex);
      const layout = layouts.getLayout(page.rendererId);

      const root = createRootSvg(template, page);
      svg.addStyles(root);

      layout.render({
        root,
        svg,
        components,
        mix,
        project,
        palette: derivedPalette(project.palette),
        template,
        page,
        pageIndex: index,
        totalPages: total,
        canvas: template.canvas,
        mode: input.mode === "preview" ? "preview" : "export",
      });

      return root;
    }

    function renderAllPages(input) {
      return input.template.pages.map((_, index) => renderPage({
        template: input.template,
        project: input.project,
        pageIndex: index,
        mode: input.mode,
      }));
    }

    // Todas as páginas do template têm layout conhecido?
    function validateRendererBindings(template) {
      return layouts.validateTemplateLayouts(template);
    }

    function listAvailableLayouts() {
      return layouts.listLayoutDefinitions();
    }

    return Object.freeze({
      renderPage,
      renderAllPages,
      validateRendererBindings,
      listAvailableLayouts,
      hasLayout: layouts.hasLayout,
      derivedPalette,
      mix,
      svg,
    });
  }

  return {
    SVG_NS,
    SVG_STYLE_TEXT,
    createSvgAdapter,
    createTemplateRenderer,
    derivedPalette,
    mix,
    hexToRgb,
    rgbToHex,
  };
});
