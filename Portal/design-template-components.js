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

  // Largura média de um caractere, em fração do font-size. O SVG é gerado
  // fora do navegador (testes, export), onde não existe medição de texto —
  // então a quebra e o corte são feitos por CONTAGEM, com estes fatores
  // medidos nas três famílias que as peças usam.
  const CHAR_RATIO = { display: 0.585, body: 0.552, mono: 0.62 };

  // Quantos caracteres cabem em `width` com este corpo de fonte.
  function charsForWidth(width, fontSize, kind) {
    const ratio = CHAR_RATIO[kind] || CHAR_RATIO.body;
    return Math.max(6, Math.floor(width / (fontSize * ratio)));
  }

  // Corta um texto de UMA linha na largura disponível, com reticências. Usado
  // onde a quebra automática não cabe (célula de tabela, chip, rótulo).
  function fitText(value, width, fontSize, kind) {
    const texto = typeof value === "string" || typeof value === "number" ? String(value) : "";
    const limite = charsForWidth(width, fontSize, kind);
    if (texto.length <= limite) return texto;
    return `${texto.slice(0, Math.max(1, limite - 1)).trimEnd()}…`;
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
    // `textAnchor` só muda o resultado quando informado — o adaptador já
    // escreve "start" por padrão, então as peças antigas seguem idênticas.
    function bodyText(parent, content, x, y, options) {
      return svg.wrapped(parent, content, x, y, {
        maxChars: options.maxChars,
        maxLines: options.maxLines,
        fontSize: options.fontSize,
        lineHeight: options.lineHeight,
        fill: options.fill,
        fontWeight: options.fontWeight || 500,
        fontFamily: "Hanken Grotesk,Arial,sans-serif",
        textAnchor: options.textAnchor,
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

    /* ── variações do Construtor (famílias com 3 versões) ───────────────── */

    // Benefícios em lista vertical: número grande à esquerda, texto à direita
    // e régua separando. Hierarquia oposta à dos cards (leitura em coluna).
    function benefitSideList(parent, items, palette, options) {
      items.forEach((item, index) => {
        const y = options.y + index * options.step;
        if (index > 0) {
          // A régua fica no MEIO do intervalo, não logo abaixo do item
          // anterior: um benefício de duas linhas desce até y+36 e cruzaria
          // uma régua colada nele.
          const yRegua = y - options.step / 2;
          svg.element("line", {
            x1: options.x, y1: yRegua, x2: options.x + options.width, y2: yRegua,
            stroke: mix(palette.text, palette.background, options.onDark ? 0.7 : 0.82), "stroke-width": 2,
          }, parent);
        }
        svg.text(parent, String(index + 1).padStart(2, "0"), {
          x: options.x, y: y + 12, fill: palette.secondary,
          "font-family": "Manrope,Arial,sans-serif", "font-size": 54, "font-weight": 800,
        });
        bodyText(parent, item, options.x + 108, y, {
          maxChars: charsForWidth(options.width - 108, 27, "body"), maxLines: 2,
          fontSize: 27, lineHeight: 36, fill: options.textFill || palette.text, fontWeight: 600,
        });
      });
    }

    // Benefícios em órbita: selos numerados distribuídos ao redor do produto,
    // com o texto ancorado para fora. Composição radial, não em colunas.
    function benefitOrbit(parent, items, palette, options) {
      const posicoes = options.slots || [];
      items.forEach((item, index) => {
        const slot = posicoes[index];
        if (!slot) return;
        // O conector sai da BORDA do anel (fromX/fromY), não do centro: uma
        // linha partindo do meio atravessaria a foto do produto.
        svg.element("line", {
          x1: slot.fromX == null ? options.centerX : slot.fromX,
          y1: slot.fromY == null ? options.centerY : slot.fromY,
          x2: slot.x, y2: slot.y,
          stroke: palette.secondary, "stroke-width": 3, opacity: 0.45,
        }, parent);
        svg.element("circle", { cx: slot.x, cy: slot.y, r: 34, fill: palette.secondary }, parent);
        svg.text(parent, String(index + 1).padStart(2, "0"), {
          x: slot.x, y: slot.y + 9, "text-anchor": "middle", fill: palette.white,
          class: "dt-fine", "font-size": 19, "font-weight": 700,
        });
        bodyText(parent, item, slot.textX, slot.textY, {
          maxChars: charsForWidth(slot.width, 25, "body"), maxLines: 3,
          fontSize: 25, lineHeight: 33, fill: options.textFill || palette.text,
          fontWeight: 600, textAnchor: slot.anchor,
        });
      });
    }

    // Ficha técnica em tabela: faixas alternadas, rótulo à esquerda e valor
    // alinhado à direita. É a leitura de "documento", não de grade.
    function specTable(parent, pairs, palette, options) {
      pairs.forEach((pair, index) => {
        const y = options.y + index * options.rowHeight;
        if (index % 2 === 0) {
          svg.element("rect", {
            x: options.x, y, width: options.width, height: options.rowHeight,
            fill: options.stripeFill || mix(palette.surface, palette.primary, 0.06),
          }, parent);
        }
        const base = y + options.rowHeight / 2 + 10;
        svg.text(parent, fitText(pair.label, options.width * 0.55, 27, "body"), {
          x: options.x + 30, y: base, fill: options.labelFill || palette.muted,
          class: "dt-body", "font-size": 27, "font-weight": 600,
        });
        if (pair.value) {
          svg.text(parent, fitText(pair.value, options.width * 0.4, 29, "body"), {
            x: options.x + options.width - 30, y: base, "text-anchor": "end",
            fill: options.valueFill || palette.text, class: "dt-body", "font-size": 29, "font-weight": 700,
          });
        }
      });
    }

    // Ficha técnica em cartões: cada par vira um bloco fechado com barra de
    // acento. Formato "destaque", pensado para a direção comercial.
    function specCards(parent, pairs, palette, options) {
      const columns = options.columns || 3;
      const gap = options.gap == null ? 24 : options.gap;
      const cellWidth = (options.width - gap * (columns - 1)) / columns;
      pairs.forEach((pair, index) => {
        const coluna = index % columns;
        const linha = Math.floor(index / columns);
        const x = options.x + coluna * (cellWidth + gap);
        const y = options.y + linha * (options.rowHeight + gap);
        svg.element("rect", { x, y, width: cellWidth, height: options.rowHeight, rx: 12, fill: palette.surface }, parent);
        svg.element("rect", { x, y, width: cellWidth, height: 7, fill: palette.secondary }, parent);
        svg.text(parent, fitText(String(pair.label).toUpperCase(), cellWidth - 44, 16, "mono"), {
          x: x + 24, y: y + 58, fill: palette.muted, class: "dt-fine", "font-size": 16, "font-weight": 700,
        });
        if (pair.value) {
          svg.text(parent, fitText(pair.value, cellWidth - 44, 32, "display"), {
            x: x + 24, y: y + 108, fill: palette.text,
            "font-family": "Manrope,Arial,sans-serif", "font-size": 32, "font-weight": 800,
          });
        }
      });
    }

    // Conteúdo da embalagem em grade: cada item é uma célula com o número no
    // canto. Leitura em bloco, não em coluna.
    function packageGrid(parent, items, palette, options) {
      const columns = options.columns || 2;
      const gap = options.gap == null ? 20 : options.gap;
      const cellWidth = (options.width - gap * (columns - 1)) / columns;
      items.forEach((item, index) => {
        const coluna = index % columns;
        const linha = Math.floor(index / columns);
        const x = options.x + coluna * (cellWidth + gap);
        const y = options.y + linha * (options.rowHeight + gap);
        svg.element("rect", {
          x, y, width: cellWidth, height: options.rowHeight, rx: 8,
          fill: options.cellFill || palette.surface,
          stroke: mix(palette.text, palette.background, 0.84), "stroke-width": 2,
        }, parent);
        svg.text(parent, String(index + 1).padStart(2, "0"), {
          x: x + 22, y: y + 38, fill: palette.secondary, class: "dt-fine", "font-size": 16, "font-weight": 700,
        });
        bodyText(parent, item, x + 22, y + 78, {
          maxChars: charsForWidth(cellWidth - 44, 23, "body"), maxLines: 2,
          fontSize: 23, lineHeight: 30, fill: options.textFill || palette.text, fontWeight: 600,
        });
      });
    }

    // Conteúdo da embalagem com item principal em destaque e os demais em
    // linha compacta abaixo. Hierarquia: o primeiro item é o produto.
    function packageFocus(parent, items, palette, options) {
      if (!items.length) return;
      svg.element("rect", { x: options.x, y: options.y, width: options.width, height: 132, rx: 10, fill: palette.secondary }, parent);
      svg.text(parent, "01", {
        x: options.x + 30, y: options.y + 50, fill: palette.white, class: "dt-fine", "font-size": 17, "font-weight": 700,
      });
      bodyText(parent, items[0], options.x + 30, options.y + 96, {
        maxChars: charsForWidth(options.width - 60, 30, "body"), maxLines: 1,
        fontSize: 30, lineHeight: 38, fill: palette.white, fontWeight: 700,
      });

      items.slice(1).forEach((item, index) => {
        const y = options.y + 158 + index * 74;
        svg.element("rect", { x: options.x, y, width: 46, height: 46, rx: 8, fill: palette.primaryLight }, parent);
        svg.text(parent, String(index + 2).padStart(2, "0"), {
          x: options.x + 23, y: y + 30, "text-anchor": "middle", fill: palette.primary,
          class: "dt-fine", "font-size": 14, "font-weight": 700,
        });
        svg.text(parent, fitText(item, options.width - 76, 25, "body"), {
          x: options.x + 68, y: y + 32, fill: options.textFill || palette.text,
          class: "dt-body", "font-size": 25, "font-weight": 600,
        });
      });
    }

    // Medidas como pílulas horizontais. Recebe a lista JÁ filtrada: medida
    // ausente não vira pílula vazia.
    function measureBadges(parent, measures, palette, options) {
      const gap = options.gap == null ? 18 : options.gap;
      // 12,6 px por caractere = IBM Plex Mono 17 px + 2 px de letter-spacing.
      // Os 84 px fixos são o recuo do marcador (56) mais o respiro à direita.
      const larguraDe = (medida) => Math.max(190, 84 + `${medida.label} ${medida.value}`.length * 12.6);
      // Com `centerX` o conjunto é centralizado: a largura total depende de
      // QUANTAS medidas foram preenchidas, e ela varia de peça para peça.
      let x = options.x;
      if (options.centerX != null) {
        const total = measures.reduce((soma, m) => soma + larguraDe(m), 0) + gap * Math.max(0, measures.length - 1);
        x = options.centerX - total / 2;
      }
      measures.forEach((medida) => {
        const rotulo = `${medida.label} ${medida.value}`;
        const width = larguraDe(medida);
        svg.element("rect", { x, y: options.y, width, height: 66, rx: 33, fill: options.fill || palette.surface }, parent);
        svg.element("circle", { cx: x + 33, cy: options.y + 33, r: 9, fill: palette.secondary }, parent);
        svg.text(parent, rotulo, {
          x: x + 56, y: options.y + 42, fill: options.textFill || palette.text,
          class: "dt-fine", "font-size": 17, "font-weight": 700,
        });
        x += width + gap;
      });
    }

    // Painel escuro de medidas: coluna com rótulo pequeno e valor grande,
    // separados por régua. Aparência de ficha técnica.
    function measurePanel(parent, measures, palette, options) {
      measures.forEach((medida, index) => {
        const y = options.y + index * options.step;
        if (index > 0) {
          svg.element("line", {
            x1: options.x, y1: y - 46, x2: options.x + options.width, y2: y - 46,
            stroke: options.ruleStroke || mix(palette.white, palette.primary, 0.7), "stroke-width": 2,
          }, parent);
        }
        svg.text(parent, medida.label, {
          x: options.x, y, fill: options.labelFill || palette.secondary,
          class: "dt-fine", "font-size": 16, "font-weight": 700,
        });
        svg.text(parent, medida.value, {
          x: options.x + options.width, y, "text-anchor": "end",
          fill: options.valueFill || palette.white,
          "font-family": "Manrope,Arial,sans-serif", "font-size": 44, "font-weight": 800,
        });
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
      charsForWidth,
      fitText,

      benefitCards,
      specGrid,
      measureCards,
      editingNote,

      benefitSideList,
      benefitOrbit,
      specTable,
      specCards,
      packageGrid,
      packageFocus,
      measureBadges,
      measurePanel,

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

  return {
    createDesignTemplateComponents,
    MAX_LIST_ITEMS,
    CHAR_RATIO,
    parseListItems,
    parseSpecPairs,
    collectMeasures,
    charsForWidth,
    fitText,
  };
});
