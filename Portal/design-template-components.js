// Portal/design-template-components.js
// -----------------------------------------------------------------------------
// Biblioteca CONTROLADA de componentes SVG do Estúdio de Templates.
//
// Aqui moram os blocos visuais que as páginas reaproveitam: marca, contador,
// foto do produto, chips, rótulos de seção, títulos, listas, dimensões e
// cards de garantia. Nenhum componente conhece a interface, o projeto salvo,
// rede ou armazenamento — só recebe o que precisa desenhar.
//
// Nada aqui é fornecido pelo preset: a biblioteca é fechada e definida por
// este arquivo. Não existe eval, Function, script dinâmico nem HTML arbitrário.
//
// O módulo NÃO toca document/window no import. O adaptador de SVG (que é quem
// fala com o documento) chega por injeção em createDesignTemplateComponents().
// -----------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DESIGN_TEMPLATE_COMPONENTS = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Listas de conteúdo são digitadas uma por linha; vazias somem e o excesso
  // é cortado para não estourar a área reservada na arte.
  const MAX_LIST_ITEMS = 5;

  function parseListItems(value, limit) {
    return String(value || "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, limit || MAX_LIST_ITEMS);
  }

  // "Potência: 650 W" -> { label: "Potência", value: "650 W" }.
  // Linha sem dois pontos NÃO é erro: vira só rótulo, sem valor — a grade
  // desenha o rótulo sozinho em vez de quebrar ou inventar conteúdo.
  function parseSpecPairs(value, limit) {
    return parseListItems(value, limit || 6).map((linha) => {
      const corte = linha.indexOf(":");
      if (corte === -1) return { label: linha, value: "" };
      return { label: linha.slice(0, corte).trim(), value: linha.slice(corte + 1).trim() };
    }).filter((par) => par.label || par.value);
  }

  // Só as medidas realmente preenchidas viram cota. Nada de "0", "undefined"
  // ou rótulo órfão na arte: campo vazio simplesmente não existe na peça.
  function collectMeasures(content) {
    const source = content && typeof content === "object" ? content : {};
    return [
      { key: "width", label: "LARGURA", short: "L", value: source.width },
      { key: "height", label: "ALTURA", short: "A", value: source.height },
      { key: "depth", label: "PROFUNDIDADE", short: "P", value: source.depth },
    ]
      .map((medida) => ({ ...medida, value: typeof medida.value === "string" ? medida.value.trim() : "" }))
      .filter((medida) => medida.value.length > 0);
  }

  // `dependencies`:
  //   svg  -> adaptador { element, text, wrapped } (ver design-template-renderer)
  //   mix  -> mistura de cores (hex, hex, 0..1) -> hex
  //   resolveProductImageSource(project) -> data URL da imagem em uso, ou null
  function createDesignTemplateComponents(dependencies) {
    const deps = dependencies || {};
    const svg = deps.svg;
    const mix = deps.mix;
    const resolveProductImageSource = deps.resolveProductImageSource;

    if (!svg || typeof svg.element !== "function" || typeof svg.text !== "function" || typeof svg.wrapped !== "function") {
      throw new Error("createDesignTemplateComponents precisa de um adaptador svg com element/text/wrapped.");
    }
    if (typeof mix !== "function") {
      throw new Error("createDesignTemplateComponents precisa da função mix.");
    }
    if (typeof resolveProductImageSource !== "function") {
      throw new Error("createDesignTemplateComponents precisa de resolveProductImageSource.");
    }

    function productPlacement(project) {
      return (project && project.product && project.product.placement) || { scale: 100, x: 50, y: 50 };
    }

    /* ── marca ──────────────────────────────────────────────────────────── */

    // Com logo enviado, desenha a imagem. Sem logo, monta o selo com a
    // inicial da marca + o nome — o mesmo fallback de sempre.
    function brand(parent, project, palette, options) {
      const group = svg.element("g", {}, parent);
      const x = options && options.x != null ? options.x : 72;
      const y = options && options.y != null ? options.y : 66;
      const onDark = options && options.onDark;
      const logoDataUrl = (project.logo && project.logo.dataUrl) || null;

      if (logoDataUrl) {
        svg.element("image", {
          href: logoDataUrl, x, y, width: 190, height: 72, preserveAspectRatio: "xMinYMid meet",
        }, group);
        return group;
      }

      svg.element("rect", {
        x, y, width: 48, height: 48, rx: 9, fill: onDark ? palette.secondary : palette.primary,
      }, group);
      svg.text(group, String(project.marcaNome || "N").slice(0, 1).toUpperCase(), {
        x: x + 24, y: y + 33, "text-anchor": "middle", fill: palette.white,
        "font-family": "Manrope,Arial,sans-serif", "font-size": 25, "font-weight": 800,
      });
      svg.text(group, project.marcaNome || "NOVA", {
        x: x + 62, y: y + 34, fill: onDark ? palette.white : palette.text,
        "font-family": "Manrope,Arial,sans-serif", "font-size": 25, "font-weight": 800, "letter-spacing": 2,
      });
      return group;
    }

    /* ── contador de página ─────────────────────────────────────────────── */

    // "03 / 07". O total vem do template, não de um literal — mas continua
    // rendendo exatamente o mesmo texto para o conjunto de 7 peças.
    function pageNumber(parent, pageIndex, totalPages, palette, onDark) {
      const atual = String(pageIndex + 1).padStart(2, "0");
      const total = String(totalPages).padStart(2, "0");
      return svg.text(parent, `${atual} / ${total}`, {
        x: 1124, y: 84, "text-anchor": "end", fill: onDark ? palette.white : palette.muted,
        class: "dt-fine", "font-size": 15, "font-weight": 600,
      });
    }

    /* ── foto do produto ────────────────────────────────────────────────── */

    // Com imagem enviada usa a imagem (editada tem precedência sobre a
    // original). Sem imagem, desenha o placeholder ilustrado do template.
    // `baseSize` é o tamanho de referência da peça; 430 é a escala neutra.
    function productPhoto(parent, project, palette, centerX, centerY, baseSize) {
      const placement = productPlacement(project);
      const scale = (placement.scale / 100) * (baseSize / 430);
      const offsetX = (placement.x - 50) * 4.5;
      const offsetY = (placement.y - 50) * 4.5;
      const group = svg.element("g", {
        transform: `translate(${centerX + offsetX} ${centerY + offsetY}) scale(${scale})`,
      }, parent);

      const imageDataUrl = resolveProductImageSource(project);
      if (imageDataUrl) {
        svg.element("image", {
          href: imageDataUrl, x: -260, y: -260, width: 520, height: 520, preserveAspectRatio: "xMidYMid meet",
        }, group);
        return group;
      }

      svg.element("ellipse", { cx: 12, cy: 230, rx: 210, ry: 34, fill: palette.primaryDark, opacity: 0.18 }, group);
      svg.element("rect", { x: -174, y: -250, width: 348, height: 494, rx: 52, fill: palette.primaryDark, transform: "rotate(-7)", stroke: palette.surface, "stroke-width": 8 }, group);
      svg.element("rect", { x: -151, y: -226, width: 302, height: 446, rx: 39, fill: palette.primary, transform: "rotate(-7)" }, group);
      svg.element("circle", { cx: -6, cy: -36, r: 100, fill: "none", stroke: palette.secondary, "stroke-width": 10, opacity: 0.9 }, group);
      svg.element("circle", { cx: -6, cy: -36, r: 72, fill: "none", stroke: palette.surface, "stroke-width": 3, opacity: 0.55 }, group);
      svg.element("path", { d: "M 8 -100 L -34 -20 L 8 -20 L -10 40 L 55 -47 L 12 -47 Z", fill: palette.secondary, transform: "rotate(-7)" }, group);
      svg.element("rect", { x: -82, y: 157, width: 120, height: 32, rx: 9, fill: palette.surface, opacity: 0.94, transform: "rotate(-7)" }, group);
      svg.text(group, "72%", { x: -22, y: 180, "text-anchor": "middle", fill: palette.primaryDark, class: "dt-fine", "font-size": 18, "font-weight": 700, transform: "rotate(-7)" });
      return group;
    }

    /* ── chip / pill ────────────────────────────────────────────────────── */

    function chip(parent, label, x, y, palette, onDark) {
      const width = Math.max(112, String(label).length * 11 + 34);
      svg.element("rect", {
        x, y, width, height: 42, rx: 21,
        fill: onDark ? palette.white : palette.primaryLight, opacity: onDark ? 0.14 : 1,
      }, parent);
      svg.text(parent, label, {
        x: x + width / 2, y: y + 27, "text-anchor": "middle",
        fill: onDark ? palette.white : palette.primary, class: "dt-body", "font-size": 15, "font-weight": 700,
      });
    }

    /* ── textos ─────────────────────────────────────────────────────────── */

    // Etiqueta curta em caixa alta acima do título ("NA CAIXA", "MEDIDAS
    // REAIS"). `textAnchor` só é escrito quando pedido: o padrão do SVG já é
    // `start` e um atributo a mais mudaria a arte serializada à toa.
    function sectionLabel(parent, content, options) {
      const attributes = {
        x: options.x, y: options.y, fill: options.fill,
        class: "dt-fine", "font-size": 17, "font-weight": 700,
      };
      if (options.textAnchor) attributes["text-anchor"] = options.textAnchor;
      return svg.text(parent, content, attributes);
    }

    // Título da peça: sempre Manrope 800, com quebra automática.
    function headline(parent, content, x, y, options) {
      return svg.wrapped(parent, content, x, y, {
        maxChars: options.maxChars,
        maxLines: options.maxLines,
        fontSize: options.fontSize,
        lineHeight: options.lineHeight,
        fill: options.fill,
        fontWeight: 800,
        textAnchor: options.textAnchor,
      });
    }

    // Texto corrido de apoio: Hanken Grotesk, peso 500 por padrão.
    function bodyText(parent, content, x, y, options) {
      return svg.wrapped(parent, content, x, y, {
        maxChars: options.maxChars,
        maxLines: options.maxLines,
        fontSize: options.fontSize,
        lineHeight: options.lineHeight,
        fill: options.fill,
        fontWeight: options.fontWeight || 500,
        fontFamily: "Hanken Grotesk,Arial,sans-serif",
      });
    }

    /* ── listas ─────────────────────────────────────────────────────────── */

    // Lista numerada com selo quadrado (conteúdo da embalagem).
    function numberedList(parent, items, palette, options) {
      items.forEach((item, index) => {
        const y = options.y + index * options.step;
        svg.element("rect", { x: options.x, y: y - 34, width: 46, height: 46, rx: 10, fill: palette.secondary }, parent);
        svg.text(parent, String(index + 1).padStart(2, "0"), {
          x: options.x + 23, y: y - 4, "text-anchor": "middle", fill: palette.white,
          class: "dt-fine", "font-size": 14, "font-weight": 700,
        });
        svg.text(parent, item, {
          x: options.x + 70, y, fill: palette.text, class: "dt-body", "font-size": 25, "font-weight": 600,
        });
      });
    }

    // Lista com marcador de "check" e régua separadora (funcionalidades).
    function checkList(parent, items, palette, options) {
      items.forEach((item, index) => {
        const y = options.y + index * options.step;
        svg.element("line", {
          x1: options.x, y1: y - 37, x2: options.lineEndX, y2: y - 37,
          stroke: mix(palette.text, palette.background, 0.8), "stroke-width": 2,
        }, parent);
        svg.element("circle", { cx: options.x + 22, cy: y, r: 16, fill: palette.secondary }, parent);
        svg.element("path", {
          d: `M${options.x + 14} ${y}l6 6 12-15`, fill: "none", stroke: palette.white,
          "stroke-width": 4, "stroke-linecap": "round", "stroke-linejoin": "round",
        }, parent);
        svg.text(parent, item, {
          x: options.x + 58, y: y + 8, fill: palette.text, class: "dt-body", "font-size": 25, "font-weight": 600,
        });
      });
    }

    /* ── medidas ────────────────────────────────────────────────────────── */

    // Cota: linha com bolinhas nas pontas e rótulo solto ao lado.
    function dimensionLine(parent, palette, options) {
      svg.element("line", {
        x1: options.x1, y1: options.y1, x2: options.x2, y2: options.y2,
        stroke: palette.secondaryDark, "stroke-width": 4,
      }, parent);
      svg.element("circle", { cx: options.x1, cy: options.y1, r: 7, fill: palette.secondary }, parent);
      svg.element("circle", { cx: options.x2, cy: options.y2, r: 7, fill: palette.secondary }, parent);
      svg.text(parent, options.label, {
        x: options.labelX, y: options.labelY, fill: palette.text,
        class: "dt-fine", "font-size": 20, "font-weight": 700,
      });
    }

    /* ── cards de garantia ──────────────────────────────────────────────── */

    function assuranceCards(parent, items, palette, options) {
      items.forEach((item, index) => {
        const x = options.x + index * options.step;
        svg.element("rect", { x, y: options.y, width: 330, height: 190, rx: 12, fill: palette.surface }, parent);
        svg.text(parent, String(index + 1).padStart(2, "0"), {
          x: x + 26, y: options.y + 41, fill: palette.secondaryDark,
          class: "dt-fine", "font-size": 15, "font-weight": 700,
        });
        bodyText(parent, item, x + 26, options.y + 88, {
          maxChars: 28, maxLines: 3, fontSize: 21, lineHeight: 28, fill: palette.text, fontWeight: 650,
        });
      });
    }

    /* ── blocos do construtor modular ───────────────────────────────────── */

    // Cards numerados de benefício. A largura é calculada a partir da
    // quantidade REAL de itens: um, dois ou três benefícios ocupam a mesma
    // faixa sem deixar buraco nem card vazio na arte.
    function benefitCards(parent, items, palette, options) {
      const total = items.length;
      if (!total) return;
      const gap = options.gap == null ? 26 : options.gap;
      const width = (options.width - gap * (total - 1)) / total;
      const height = options.height || 300;
      // Quebra por contagem de caracteres (o SVG não mede texto fora do
      // navegador). 13,4 px por caractere é a largura média do Hanken
      // Grotesk 600 em 24 px; os 60 px descontados são o respiro lateral.
      const maxChars = Math.max(12, Math.floor((width - 60) / 13.4));

      items.forEach((item, index) => {
        const x = options.x + index * (width + gap);
        svg.element("rect", {
          x, y: options.y, width, height, rx: 10,
          fill: palette.surface, stroke: mix(palette.text, palette.background, 0.82), "stroke-width": 2,
        }, parent);
        svg.element("rect", { x, y: options.y, width: 78, height: 8, fill: palette.secondary }, parent);
        svg.text(parent, String(index + 1).padStart(2, "0"), {
          x: x + 30, y: options.y + 78, fill: palette.secondaryDark,
          class: "dt-fine", "font-size": 22, "font-weight": 700,
        });
        bodyText(parent, item, x + 30, options.y + 136, {
          maxChars, maxLines: 4, fontSize: 24, lineHeight: 33, fill: palette.text, fontWeight: 600,
        });
      });
    }

    // Grade de especificações: cada par vira rótulo pequeno em cima e valor
    // grande embaixo. Par sem valor mostra só o rótulo.
    function specGrid(parent, pairs, palette, options) {
      const columns = options.columns || 2;
      const gapX = options.gapX == null ? 48 : options.gapX;
      const cellWidth = (options.width - gapX * (columns - 1)) / columns;

      pairs.forEach((pair, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = options.x + column * (cellWidth + gapX);
        const y = options.y + row * options.rowHeight;

        svg.element("line", {
          x1: x, y1: y - 46, x2: x + cellWidth, y2: y - 46,
          stroke: mix(palette.text, palette.background, 0.78), "stroke-width": 2,
        }, parent);
        svg.element("rect", { x, y: y - 46, width: 54, height: 5, fill: palette.secondary }, parent);
        svg.text(parent, String(pair.label).slice(0, 26).toUpperCase(), {
          x, y, fill: palette.muted, class: "dt-fine", "font-size": 17, "font-weight": 700,
        });
        if (pair.value) {
          svg.text(parent, String(pair.value).slice(0, 24), {
            x, y: y + 46, fill: palette.text, class: "dt-body", "font-size": 31, "font-weight": 700,
          });
        }
      });
    }

    // Fichas de medida (largura/altura/profundidade). Recebe a lista já
    // filtrada por collectMeasures — o componente não decide o que é vazio.
    function measureCards(parent, measures, palette, options) {
      measures.forEach((medida, index) => {
        const y = options.y + index * options.step;
        svg.element("rect", { x: options.x, y, width: options.width, height: 84, rx: 8, fill: palette.surface }, parent);
        svg.element("rect", { x: options.x, y, width: 7, height: 84, fill: palette.secondary }, parent);
        svg.text(parent, medida.label, {
          x: options.x + 30, y: y + 34, fill: palette.muted,
          class: "dt-fine", "font-size": 15, "font-weight": 700,
        });
        svg.text(parent, medida.value, {
          x: options.x + 30, y: y + 66, fill: palette.text,
          class: "dt-body", "font-size": 27, "font-weight": 700,
        });
      });
    }

    // Aviso de edição: aparece SÓ na prévia (ctx.mode === "preview"). O PNG
    // exportado nunca carrega mensagem de erro — a peça sai limpa ou o
    // usuário corrige o dado antes.
    function editingNote(parent, message, palette, options) {
      const width = options.width || 640;
      svg.element("rect", {
        x: options.x, y: options.y, width, height: 82, rx: 8,
        fill: palette.secondaryLight, stroke: palette.secondary,
        "stroke-width": 2, "stroke-dasharray": "11 8",
      }, parent);
      bodyText(parent, message, options.x + 26, options.y + 40, {
        maxChars: Math.floor(width / 11), maxLines: 2, fontSize: 21, lineHeight: 27,
        fill: palette.secondaryDark, fontWeight: 600,
      });
    }

    /* ── blocos decorativos ─────────────────────────────────────────────── */

    function backgroundFill(parent, color, canvas) {
      return svg.element("rect", { width: canvas.width, height: canvas.height, fill: color }, parent);
    }

    // Halos concêntricos usados como fundo luminoso da peça de LED.
    function glowRings(parent, cx, cy, color, rings) {
      rings.forEach((ring) => {
        svg.element("circle", { cx, cy, r: ring.r, fill: color, opacity: ring.opacity }, parent);
      });
    }

    return {
      MAX_LIST_ITEMS,
      parseListItems,
      parseSpecPairs,
      collectMeasures,

      benefitCards,
      specGrid,
      measureCards,
      editingNote,

      brand,
      pageNumber,
      productPhoto,
      chip,
      sectionLabel,
      headline,
      bodyText,
      numberedList,
      checkList,
      dimensionLine,
      assuranceCards,
      backgroundFill,
      glowRings,
    };
  }

  return { createDesignTemplateComponents, MAX_LIST_ITEMS, parseListItems, parseSpecPairs, collectMeasures };
});
