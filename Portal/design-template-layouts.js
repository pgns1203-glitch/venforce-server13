// Portal/design-template-layouts.js
// -----------------------------------------------------------------------------
// Registro CONTROLADO dos layouts de página do Estúdio de Templates.
//
// Cada layout é uma entrada fixa deste arquivo: id estável, metadados
// serializáveis e uma função `render(context)` que desenha a peça usando a
// biblioteca de componentes. Os ids são exatamente os rendererIds que os
// presets declaram (cover, wireless, led, package, dimensions, features, safe).
//
// O preset nunca fornece a função de desenho — ele só aponta um id. Um
// rendererId desconhecido é erro explícito (getLayout lança;
// validateTemplateLayouts devolve o relatório), nunca uma arte genérica
// silenciosa que passaria por correta.
//
// O módulo não toca document/window no import: o adaptador de SVG chega junto
// dos componentes, por injeção.
// -----------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DESIGN_TEMPLATE_LAYOUTS = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CANVAS_FAMILY = "portable-charger";

  // Fábrica dos sete layouts. Recebe a biblioteca de componentes já ligada ao
  // adaptador de SVG; devolve as definições com render() fechado sobre ela.
  function buildLayoutDefinitions(c) {
    return [
      {
        id: "cover",
        label: "Capa principal",
        family: CANVAS_FAMILY,
        version: 1,
        description: "Capa do conjunto: nome do produto, benefício e chips de destaque.",
        requiredFields: ["product.name"],
        optionalFields: ["content.benefit", "logo", "product.image"],
        render(ctx) {
          const { root, svg, palette, project, canvas } = ctx;
          c.backgroundFill(root, palette.background, canvas);
          svg.element("path", { d: "M760 0H1200V1200H610C790 1010 848 794 784 575C727 378 658 205 760 0Z", fill: palette.primary }, root);
          svg.element("circle", { cx: 1075, cy: 180, r: 170, fill: palette.secondary, opacity: 0.92 }, root);
          c.brand(root, project, palette);
          c.pageNumber(root, ctx.pageIndex, ctx.totalPages, palette, false);
          c.sectionLabel(root, "ENERGIA PORTÁTIL", { x: 76, y: 194, fill: palette.secondaryDark });
          c.headline(root, project.product.name, 72, 288, { maxChars: 18, maxLines: 3, fontSize: 76, lineHeight: 82, fill: palette.text });
          c.bodyText(root, project.content.benefit, 76, 584, { maxChars: 32, maxLines: 3, fontSize: 29, lineHeight: 38, fill: palette.muted });
          c.chip(root, "INDUÇÃO", 74, 756, palette, false);
          c.chip(root, "USB-C", 222, 756, palette, false);
          c.chip(root, "LED", 350, 756, palette, false);
          c.productPhoto(root, project, palette, 856, 655, 490);
          svg.text(root, "PRONTO PARA A ROTINA", { x: 76, y: 1096, fill: palette.text, class: "dt-body", "font-size": 18, "font-weight": 700 });
          svg.element("line", { x1: 76, y1: 1118, x2: 408, y2: 1118, stroke: palette.secondary, "stroke-width": 7 }, root);
        },
      },

      {
        id: "wireless",
        label: "Carregamento por indução",
        family: CANVAS_FAMILY,
        version: 1,
        description: "Peça de indução: faixa superior escura e alvo concêntrico atrás do produto.",
        requiredFields: [],
        optionalFields: ["content.wireless", "logo", "product.image"],
        render(ctx) {
          const { root, svg, palette, project, canvas } = ctx;
          c.backgroundFill(root, palette.surface, canvas);
          svg.element("rect", { x: 0, y: 0, width: 1200, height: 170, fill: palette.primary }, root);
          c.brand(root, project, palette, { x: 72, y: 50, onDark: true });
          c.pageNumber(root, ctx.pageIndex, ctx.totalPages, palette, true);
          c.sectionLabel(root, "SEM CABOS. SEM PAUSA.", { x: 72, y: 262, fill: palette.secondaryDark });
          c.headline(root, "Carregamento por indução", 70, 355, { maxChars: 23, maxLines: 3, fontSize: 68, lineHeight: 75, fill: palette.text });
          c.bodyText(root, project.content.wireless, 74, 650, { maxChars: 44, maxLines: 4, fontSize: 27, lineHeight: 36, fill: palette.muted });
          svg.element("circle", { cx: 906, cy: 624, r: 276, fill: palette.primaryLight }, root);
          svg.element("circle", { cx: 906, cy: 624, r: 205, fill: "none", stroke: palette.secondary, "stroke-width": 8, "stroke-dasharray": "18 15" }, root);
          svg.element("circle", { cx: 906, cy: 624, r: 151, fill: "none", stroke: palette.primary, "stroke-width": 5, opacity: 0.5 }, root);
          c.productPhoto(root, project, palette, 906, 652, 360);
          svg.text(root, "APOIE • CONECTE • CONTINUE", { x: 72, y: 1090, fill: palette.primary, class: "dt-fine", "font-size": 18, "font-weight": 700 });
        },
      },

      {
        id: "led",
        label: "Iluminação LED",
        family: CANVAS_FAMILY,
        version: 1,
        description: "Peça escura com halos de luz e os três níveis de intensidade.",
        requiredFields: [],
        optionalFields: ["content.led", "logo", "product.image"],
        render(ctx) {
          const { root, svg, palette, project, canvas, mix } = ctx;
          c.backgroundFill(root, palette.primaryDark, canvas);
          c.glowRings(root, 876, 560, palette.secondary, [
            { r: 340, opacity: 0.08 },
            { r: 270, opacity: 0.12 },
            { r: 200, opacity: 0.18 },
          ]);
          c.brand(root, project, palette, { onDark: true });
          c.pageNumber(root, ctx.pageIndex, ctx.totalPages, palette, true);
          c.sectionLabel(root, "LUZ QUANDO VOCÊ PRECISA", { x: 72, y: 228, fill: palette.secondary });
          c.headline(root, "Iluminação LED integrada", 70, 324, { maxChars: 20, maxLines: 3, fontSize: 70, lineHeight: 76, fill: palette.white });
          c.bodyText(root, project.content.led, 74, 642, { maxChars: 40, maxLines: 4, fontSize: 27, lineHeight: 36, fill: mix(palette.primary, "#ffffff", 0.74) });
          c.productPhoto(root, project, palette, 876, 646, 420);
          [[755, 892], [876, 934], [997, 892]].forEach(([x, y], index) => {
            svg.element("circle", { cx: x, cy: y, r: 25, fill: index === 1 ? palette.secondary : palette.surface, opacity: index === 1 ? 1 : 0.5 }, root);
          });
          svg.text(root, "3 NÍVEIS DE INTENSIDADE", { x: 876, y: 1028, "text-anchor": "middle", fill: palette.white, class: "dt-fine", "font-size": 16, "font-weight": 700 });
        },
      },

      {
        id: "package",
        label: "Conteúdo da embalagem",
        family: CANVAS_FAMILY,
        version: 1,
        description: "Lista numerada do que acompanha o produto, com ilustração de caixa.",
        requiredFields: [],
        optionalFields: ["content.packageItems", "logo", "product.image"],
        render(ctx) {
          const { root, svg, palette, project, canvas } = ctx;
          c.backgroundFill(root, palette.background, canvas);
          svg.element("rect", { x: 650, y: 0, width: 550, height: 1200, fill: palette.primaryLight }, root);
          c.brand(root, project, palette);
          c.pageNumber(root, ctx.pageIndex, ctx.totalPages, palette, false);
          c.sectionLabel(root, "NA CAIXA", { x: 72, y: 230, fill: palette.secondaryDark });
          c.headline(root, "Tudo o que acompanha seu produto", 70, 330, { maxChars: 21, maxLines: 4, fontSize: 63, lineHeight: 69, fill: palette.text });
          c.numberedList(root, c.parseListItems(project.content.packageItems), palette, { x: 74, y: 690, step: 86 });
          c.productPhoto(root, project, palette, 888, 570, 400);
          svg.element("path", { d: "M735 904h310l-36 170H771z", fill: palette.surface, stroke: palette.primary, "stroke-width": 5 }, root);
          svg.element("path", { d: "M735 904l155 85 155-85M890 989v85", fill: "none", stroke: palette.primary, "stroke-width": 5 }, root);
        },
      },

      {
        id: "dimensions",
        label: "Dimensões",
        family: CANVAS_FAMILY,
        version: 1,
        description: "Medidas reais do produto com cotas de largura, altura e profundidade.",
        requiredFields: [],
        optionalFields: ["content.width", "content.height", "content.depth", "logo", "product.image"],
        render(ctx) {
          const { root, svg, palette, project, canvas } = ctx;
          c.backgroundFill(root, palette.surface, canvas);
          c.brand(root, project, palette);
          c.pageNumber(root, ctx.pageIndex, ctx.totalPages, palette, false);
          c.sectionLabel(root, "MEDIDAS REAIS", { x: 72, y: 208, fill: palette.secondaryDark });
          c.headline(root, "Compacto por fora. Potente por dentro.", 70, 300, { maxChars: 23, maxLines: 3, fontSize: 66, lineHeight: 72, fill: palette.text });
          svg.element("rect", { x: 72, y: 570, width: 1056, height: 510, fill: palette.primaryLight }, root);
          c.productPhoto(root, project, palette, 600, 814, 380);
          c.dimensionLine(root, palette, { x1: 350, y1: 1050, x2: 845, y2: 1050, label: `L ${project.content.width}`, labelX: 520, labelY: 1030 });
          c.dimensionLine(root, palette, { x1: 325, y1: 610, x2: 325, y2: 1015, label: `A ${project.content.height}`, labelX: 152, labelY: 820 });
          c.dimensionLine(root, palette, { x1: 870, y1: 700, x2: 1020, y2: 632, label: `P ${project.content.depth}`, labelX: 906, labelY: 616 });
        },
      },

      {
        id: "features",
        label: "Painel e funcionalidades",
        family: CANVAS_FAMILY,
        version: 1,
        description: "Painel lateral escuro com o produto e a lista de funcionalidades marcadas.",
        requiredFields: [],
        optionalFields: ["content.features", "logo", "product.image"],
        render(ctx) {
          const { root, svg, palette, project, canvas } = ctx;
          c.backgroundFill(root, palette.background, canvas);
          svg.element("path", { d: "M0 0h480v1200H0z", fill: palette.primary }, root);
          c.brand(root, project, palette, { onDark: true });
          // O contador fica na faixa clara à direita, por isso onDark = false
          // mesmo com o painel esquerdo escuro.
          c.pageNumber(root, ctx.pageIndex, ctx.totalPages, palette, false);
          c.productPhoto(root, project, palette, 280, 650, 370);
          c.sectionLabel(root, "CONTROLE NA PALMA DA MÃO", { x: 536, y: 210, fill: palette.secondaryDark });
          c.headline(root, "Painel claro. Funções essenciais.", 532, 310, { maxChars: 20, maxLines: 3, fontSize: 63, lineHeight: 69, fill: palette.text });
          c.checkList(root, c.parseListItems(project.content.features), palette, { x: 536, y: 610, step: 100, lineEndX: 1128 });
        },
      },

      {
        id: "safe",
        label: "Compra segura",
        family: CANVAS_FAMILY,
        version: 1,
        description: "Fecho institucional: escudo, pagamento protegido, envio e garantia.",
        requiredFields: [],
        optionalFields: ["content.safe", "content.shipping", "content.warranty", "logo"],
        render(ctx) {
          const { root, svg, palette, project, canvas } = ctx;
          c.backgroundFill(root, palette.primaryDark, canvas);
          svg.element("path", { d: "M0 890C270 760 470 940 714 820c196-96 305-71 486-5v385H0z", fill: palette.primary }, root);
          c.brand(root, project, palette, { onDark: true });
          c.pageNumber(root, ctx.pageIndex, ctx.totalPages, palette, true);
          c.sectionLabel(root, "SUA ESCOLHA, PROTEGIDA", { x: 600, y: 235, fill: palette.secondary, textAnchor: "middle" });
          c.headline(root, "Compre com tranquilidade", 600, 335, { maxChars: 25, maxLines: 2, fontSize: 72, lineHeight: 80, fill: palette.white, textAnchor: "middle" });
          svg.element("path", { d: "M600 515l112 43v89c0 91-58 154-112 183-54-29-112-92-112-183v-89z", fill: palette.secondary }, root);
          svg.element("path", { d: "M548 652l34 35 74-83", fill: "none", stroke: palette.white, "stroke-width": 16, "stroke-linecap": "round", "stroke-linejoin": "round" }, root);
          c.assuranceCards(root, [project.content.safe, project.content.shipping, project.content.warranty], palette, { x: 72, y: 914, step: 362 });
        },
      },
    ];
  }

  // Só os campos serializáveis: `render` nunca sai daqui.
  function toPublicDefinition(layout) {
    return Object.freeze({
      id: layout.id,
      label: layout.label,
      family: layout.family,
      version: layout.version,
      description: layout.description,
      requiredFields: Object.freeze(layout.requiredFields.slice()),
      optionalFields: Object.freeze(layout.optionalFields.slice()),
    });
  }

  function layoutError(codigo, mensagem) {
    const error = new Error(mensagem);
    error.codigo = codigo;
    return error;
  }

  // `components` é a biblioteca devolvida por createDesignTemplateComponents.
  function createLayoutRegistry(components) {
    if (!components || typeof components.brand !== "function") {
      throw new Error("createLayoutRegistry precisa da biblioteca de componentes.");
    }

    const registro = new Map();
    buildLayoutDefinitions(components).forEach((layout) => {
      if (registro.has(layout.id)) {
        throw layoutError("LAYOUT_DUPLICADO", `Id de layout duplicado no registro: "${layout.id}".`);
      }
      registro.set(layout.id, Object.freeze(layout));
    });

    function hasLayout(id) {
      return registro.has(String(id));
    }

    // Erro explícito: um rendererId desconhecido nunca vira arte genérica.
    function getLayout(id) {
      const layout = registro.get(String(id));
      if (!layout) {
        throw layoutError("LAYOUT_DESCONHECIDO", `Nenhum layout registrado para o rendererId "${id}".`);
      }
      return layout;
    }

    function listLayoutDefinitions() {
      return [...registro.values()].map(toPublicDefinition);
    }

    // Relatório (não lança): usado na validação de um template inteiro.
    function validateTemplateLayouts(templateDefinition) {
      const pages = (templateDefinition && templateDefinition.pages) || [];
      const desconhecidos = pages
        .filter((page) => !hasLayout(page.rendererId))
        .map((page) => ({ pageId: page.id, rendererId: page.rendererId }));
      return {
        ok: desconhecidos.length === 0,
        desconhecidos,
        mensagem: desconhecidos.length === 0
          ? ""
          : `Template "${templateDefinition && templateDefinition.id}" usa rendererId sem layout: ${desconhecidos.map((d) => d.rendererId).join(", ")}.`,
      };
    }

    return Object.freeze({
      getLayout,
      hasLayout,
      listLayoutDefinitions,
      validateTemplateLayouts,
      size: registro.size,
    });
  }

  return { createLayoutRegistry };
});
