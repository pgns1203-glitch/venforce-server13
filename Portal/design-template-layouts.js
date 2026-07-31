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

  // Família das páginas combináveis do Construtor Modular: elas não formam um
  // conjunto fixo, entram em qualquer ordem e só usam o que estiver preenchido.
  const MODULAR_FAMILY = "modular";

  // Fábrica dos layouts (7 do conjunto do carregador + 5 modulares). Recebe a
  // biblioteca de componentes já ligada ao adaptador de SVG; devolve as
  // definições com render() fechado sobre ela.
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

      /* ── páginas modulares do Construtor ──────────────────────────────── */
      //
      // Estas cinco entradas são combináveis: cada uma se vira sozinha com o
      // que o projeto tiver preenchido, sem depender das outras nem de uma
      // ordem fixa. Campo vazio some da arte — nunca vira "0" ou "undefined".

      {
        id: "cover-split-v1",
        label: "Capa dividida",
        family: MODULAR_FAMILY,
        version: 1,
        description: "Capa em duas colunas: texto à esquerda, produto grande à direita.",
        requiredFields: ["product.name"],
        optionalFields: ["product.subtitle", "content.mainBenefit", "logo", "product.image"],
        render(ctx) {
          const { root, svg, palette, project, canvas } = ctx;
          c.backgroundFill(root, palette.background, canvas);

          // Coluna direita: painel claro que isola o produto do texto.
          svg.element("rect", { x: 600, y: 0, width: 600, height: 1200, fill: palette.primaryLight }, root);
          svg.element("rect", { x: 600, y: 0, width: 6, height: 1200, fill: palette.secondary }, root);

          c.brand(root, project, palette);
          c.pageNumber(root, ctx.pageIndex, ctx.totalPages, palette, false);

          c.sectionLabel(root, String(ctx.template.segment || "DESTAQUE").toUpperCase(), { x: 76, y: 232, fill: palette.secondaryDark });
          c.headline(root, project.product.name, 74, 330, { maxChars: 15, maxLines: 3, fontSize: 74, lineHeight: 80, fill: palette.text });
          c.bodyText(root, project.product.subtitle, 76, 588, { maxChars: 30, maxLines: 3, fontSize: 27, lineHeight: 36, fill: palette.muted });

          // Benefício principal em bloco marcado: é a promessa da capa.
          if (String(project.content.mainBenefit || "").trim()) {
            svg.element("rect", { x: 74, y: 742, width: 452, height: 200, rx: 10, fill: palette.surface }, root);
            svg.element("rect", { x: 74, y: 742, width: 8, height: 200, fill: palette.secondary }, root);
            c.bodyText(root, project.content.mainBenefit, 110, 812, {
              maxChars: 28, maxLines: 4, fontSize: 25, lineHeight: 34, fill: palette.text, fontWeight: 650,
            });
          }

          svg.element("line", { x1: 76, y1: 1058, x2: 420, y2: 1058, stroke: palette.secondary, "stroke-width": 7 }, root);
          c.productPhoto(root, project, palette, 900, 600, 520);
        },
      },

      {
        id: "benefits-three-cards-v1",
        label: "Benefícios em três cards",
        family: MODULAR_FAMILY,
        version: 1,
        description: "Produto no topo e até três benefícios numerados em cards.",
        requiredFields: [],
        optionalFields: ["content.benefit1", "content.benefit2", "content.benefit3", "logo", "product.image"],
        render(ctx) {
          const { root, svg, palette, project, canvas } = ctx;
          c.backgroundFill(root, palette.background, canvas);
          svg.element("rect", { x: 0, y: 0, width: 1200, height: 156, fill: palette.primary }, root);

          c.brand(root, project, palette, { x: 72, y: 44, onDark: true });
          c.pageNumber(root, ctx.pageIndex, ctx.totalPages, palette, true);

          c.sectionLabel(root, "POR QUE ESCOLHER", { x: 72, y: 252, fill: palette.secondaryDark });
          c.headline(root, project.product.name, 70, 344, { maxChars: 26, maxLines: 2, fontSize: 62, lineHeight: 70, fill: palette.text });

          c.productPhoto(root, project, palette, 600, 620, 330);

          // Só os benefícios preenchidos viram card, no máximo três.
          const beneficios = [project.content.benefit1, project.content.benefit2, project.content.benefit3]
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
            .slice(0, 3);
          c.benefitCards(root, beneficios, palette, { x: 72, y: 858, width: 1056, height: 268 });
        },
      },

      {
        id: "specifications-grid-v1",
        label: "Especificações em grade",
        family: MODULAR_FAMILY,
        version: 1,
        description: "Ficha técnica em grade de chave e valor, com até seis linhas.",
        requiredFields: [],
        optionalFields: ["content.specs", "logo", "product.image"],
        render(ctx) {
          const { root, svg, palette, project, canvas } = ctx;
          c.backgroundFill(root, palette.background, canvas);
          // A faixa começa depois da descida do título (linha de base 296 +
          // descendente de uma fonte de 60 px). maxChars 26 garante o título
          // numa linha só, sem invadir a faixa.
          svg.element("rect", { x: 0, y: 380, width: 1200, height: 820, fill: palette.surface }, root);

          c.brand(root, project, palette);
          c.pageNumber(root, ctx.pageIndex, ctx.totalPages, palette, false);

          c.sectionLabel(root, "FICHA DO PRODUTO", { x: 72, y: 208, fill: palette.secondaryDark });
          c.headline(root, "Especificações técnicas", 70, 296, { maxChars: 26, maxLines: 2, fontSize: 60, lineHeight: 68, fill: palette.text });

          const pares = c.parseSpecPairs(project.content.specs, 6);
          if (pares.length) {
            c.specGrid(root, pares, palette, { x: 72, y: 522, width: 1056, columns: 2, gapX: 56, rowHeight: 202 });
          } else if (ctx.mode === "preview") {
            c.editingNote(root, "Preencha as especificações técnicas — uma por linha, no formato “Potência: 650 W”.",
              palette, { x: 72, y: 520, width: 1056 });
          }

          svg.element("line", { x1: 72, y1: 1128, x2: 1128, y2: 1128, stroke: palette.secondary, "stroke-width": 6 }, root);
        },
      },

      {
        id: "package-list-v1",
        label: "Conteúdo da embalagem",
        family: MODULAR_FAMILY,
        version: 1,
        description: "Lista numerada do que acompanha o produto, com o produto ao lado.",
        requiredFields: [],
        optionalFields: ["content.packageItems", "logo", "product.image"],
        render(ctx) {
          const { root, svg, palette, project, canvas } = ctx;
          c.backgroundFill(root, palette.surface, canvas);
          svg.element("rect", { x: 700, y: 0, width: 500, height: 1200, fill: palette.primaryLight }, root);

          c.brand(root, project, palette);
          c.pageNumber(root, ctx.pageIndex, ctx.totalPages, palette, false);

          c.sectionLabel(root, "NA CAIXA", { x: 72, y: 226, fill: palette.secondaryDark });
          c.headline(root, "Conteúdo da embalagem", 70, 318, { maxChars: 18, maxLines: 3, fontSize: 60, lineHeight: 66, fill: palette.text });

          const itens = c.parseListItems(project.content.packageItems, 6);
          if (itens.length) {
            c.numberedList(root, itens, palette, { x: 74, y: 542, step: 82 });
          } else if (ctx.mode === "preview") {
            // Aviso de edição: some no PNG exportado (ver componente).
            c.editingNote(root, "Liste o que acompanha o produto — um item por linha.",
              palette, { x: 72, y: 508, width: 580 });
          }

          c.productPhoto(root, project, palette, 950, 600, 400);
        },
      },

      {
        id: "dimensions-technical-v1",
        label: "Dimensões técnicas",
        family: MODULAR_FAMILY,
        version: 1,
        description: "Produto ao centro com cotas e fichas apenas das medidas preenchidas.",
        requiredFields: [],
        optionalFields: ["content.width", "content.height", "content.depth", "logo", "product.image"],
        render(ctx) {
          const { root, svg, palette, project, canvas } = ctx;
          c.backgroundFill(root, palette.background, canvas);

          c.brand(root, project, palette);
          c.pageNumber(root, ctx.pageIndex, ctx.totalPages, palette, false);

          c.sectionLabel(root, "MEDIDAS REAIS", { x: 72, y: 214, fill: palette.secondaryDark });
          c.headline(root, "Dimensões técnicas", 70, 302, { maxChars: 20, maxLines: 2, fontSize: 64, lineHeight: 70, fill: palette.text });

          // Palco técnico: malha discreta atrás do produto, sem inventar cota.
          svg.element("rect", { x: 72, y: 396, width: 700, height: 700, fill: palette.surface }, root);
          [0, 1, 2, 3].forEach((linha) => {
            const y = 396 + linha * 175;
            svg.element("line", { x1: 72, y1: y, x2: 772, y2: y, stroke: palette.primaryLight, "stroke-width": 2 }, root);
          });
          c.productPhoto(root, project, palette, 422, 746, 400);

          const medidas = c.collectMeasures(project.content);
          if (medidas.length) {
            c.measureCards(root, medidas, palette, { x: 824, y: 470, width: 304, step: 108 });
          } else if (ctx.mode === "preview") {
            c.editingNote(root, "Informe largura, altura ou profundidade para gerar as cotas.",
              palette, { x: 824, y: 470, width: 304 });
          }

          // As cotas seguem as medidas: nenhuma linha é desenhada sem valor.
          medidas.forEach((medida) => {
            if (medida.key === "width") {
              c.dimensionLine(root, palette, {
                x1: 152, y1: 1046, x2: 692, y2: 1046,
                label: `${medida.short} ${medida.value}`, labelX: 372, labelY: 1026,
              });
            }
            if (medida.key === "height") {
              c.dimensionLine(root, palette, {
                x1: 118, y1: 452, x2: 118, y2: 1010,
                label: `${medida.short} ${medida.value}`, labelX: 96, labelY: 428,
              });
            }
            if (medida.key === "depth") {
              c.dimensionLine(root, palette, {
                x1: 700, y1: 512, x2: 772, y2: 440,
                label: `${medida.short} ${medida.value}`, labelX: 640, labelY: 424,
              });
            }
          });
        },
      },

      /* ── variações: capa ──────────────────────────────────────────────── */

      {
        id: "cover-centered-v1",
        label: "Capa centralizada",
        family: MODULAR_FAMILY,
        version: 1,
        description: "Eixo vertical centralizado sobre painel escuro, com faixa de benefício no rodapé.",
        requiredFields: ["product.name"],
        optionalFields: ["product.subtitle", "content.mainBenefit", "logo", "product.image"],
        render(ctx) {
          const { root, svg, palette, project, canvas, mix } = ctx;
          c.backgroundFill(root, palette.primaryDark, canvas);
          svg.element("rect", {
            x: 48, y: 48, width: 1104, height: 1104, fill: "none",
            stroke: palette.secondary, "stroke-width": 2, opacity: 0.35,
          }, root);

          c.brand(root, project, palette, { onDark: true });
          c.pageNumber(root, ctx.pageIndex, ctx.totalPages, palette, true);

          c.sectionLabel(root, String(ctx.template.segment || "PRODUTO").toUpperCase(), {
            x: 600, y: 268, fill: palette.secondary, textAnchor: "middle",
          });
          c.headline(root, project.product.name, 600, 358, {
            maxChars: 19, maxLines: 2, fontSize: 68, lineHeight: 76, fill: palette.white, textAnchor: "middle",
          });
          // Subtítulo com 2 linhas termina em ~521; a foto começa em 571
          // (centro 780, altura do placeholder × escala). O intervalo é a
          // folga que impede o texto de sumir atrás do produto.
          c.bodyText(root, project.product.subtitle, 600, 486, {
            maxChars: 46, maxLines: 2, fontSize: 26, lineHeight: 35,
            fill: mix(palette.primary, "#ffffff", 0.72), textAnchor: "middle",
          });

          svg.element("circle", { cx: 600, cy: 780, r: 215, fill: palette.primary, opacity: 0.55 }, root);
          c.productPhoto(root, project, palette, 600, 780, 360);

          svg.element("rect", { x: 0, y: 1010, width: 1200, height: 190, fill: palette.primary }, root);
          if (String(project.content.mainBenefit || "").trim()) {
            c.bodyText(root, project.content.mainBenefit, 600, 1090, {
              maxChars: 42, maxLines: 2, fontSize: 29, lineHeight: 38,
              fill: palette.white, fontWeight: 650, textAnchor: "middle",
            });
          }
        },
      },

      {
        id: "cover-impact-v1",
        label: "Capa de impacto",
        family: MODULAR_FAMILY,
        version: 1,
        description: "Título muito grande, faixa diagonal e produto ampliado invadindo a composição.",
        requiredFields: ["product.name"],
        optionalFields: ["product.subtitle", "content.mainBenefit", "logo", "product.image"],
        render(ctx) {
          const { root, svg, palette, project, canvas } = ctx;
          c.backgroundFill(root, palette.background, canvas);
          svg.element("path", { d: "M0 668L1200 402V1200H0Z", fill: palette.primary }, root);
          svg.element("circle", { cx: 900, cy: 590, r: 270, fill: palette.secondary, opacity: 0.92 }, root);

          c.brand(root, project, palette);
          c.pageNumber(root, ctx.pageIndex, ctx.totalPages, palette, false);

          c.sectionLabel(root, "DESTAQUE", { x: 74, y: 202, fill: palette.secondaryDark });
          // A coluna de texto vai até x≈617 (12 caracteres a 78 px) e a foto
          // começa em 622. São 3 linhas de título porque nomes de produto
          // reais raramente cabem em duas nesse corpo.
          c.headline(root, project.product.name, 70, 300, {
            maxChars: 12, maxLines: 3, fontSize: 78, lineHeight: 84, fill: palette.text,
          });
          c.bodyText(root, project.product.subtitle, 74, 576, {
            maxChars: 24, maxLines: 2, fontSize: 26, lineHeight: 34, fill: palette.muted,
          });

          c.productPhoto(root, project, palette, 900, 620, 460);

          if (String(project.content.mainBenefit || "").trim()) {
            svg.element("rect", { x: 74, y: 852, width: 10, height: 176, fill: palette.secondary }, root);
            c.bodyText(root, project.content.mainBenefit, 112, 912, {
              maxChars: 24, maxLines: 3, fontSize: 32, lineHeight: 42, fill: palette.white, fontWeight: 700,
            });
          }
        },
      },

      /* ── variações: benefícios ────────────────────────────────────────── */

      {
        id: "benefits-side-list-v1",
        label: "Benefícios em lista lateral",
        family: MODULAR_FAMILY,
        version: 1,
        description: "Painel escuro com o produto à esquerda e a lista numerada à direita.",
        requiredFields: [],
        optionalFields: ["content.benefit1", "content.benefit2", "content.benefit3", "logo", "product.image"],
        render(ctx) {
          const { root, svg, palette, project, canvas } = ctx;
          c.backgroundFill(root, palette.surface, canvas);
          svg.element("rect", { x: 0, y: 0, width: 520, height: 1200, fill: palette.primaryDark }, root);
          svg.element("rect", { x: 514, y: 0, width: 6, height: 1200, fill: palette.secondary }, root);

          c.brand(root, project, palette, { onDark: true });
          c.pageNumber(root, ctx.pageIndex, ctx.totalPages, palette, false);
          c.productPhoto(root, project, palette, 258, 660, 400);

          c.sectionLabel(root, "PONTOS FORTES", { x: 588, y: 258, fill: palette.secondaryDark });
          c.headline(root, project.product.name, 586, 348, {
            maxChars: 17, maxLines: 2, fontSize: 54, lineHeight: 62, fill: palette.text,
          });

          const beneficios = [project.content.benefit1, project.content.benefit2, project.content.benefit3]
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
            .slice(0, 3);
          c.benefitSideList(root, beneficios, palette, { x: 588, y: 600, width: 540, step: 190 });
        },
      },

      {
        id: "benefits-orbit-v1",
        label: "Benefícios em órbita",
        family: MODULAR_FAMILY,
        version: 1,
        description: "Produto ao centro com os benefícios distribuídos em torno de um anel técnico.",
        requiredFields: [],
        optionalFields: ["content.benefit1", "content.benefit2", "content.benefit3", "logo", "product.image"],
        render(ctx) {
          const { root, svg, palette, project, canvas } = ctx;
          c.backgroundFill(root, palette.background, canvas);

          c.brand(root, project, palette);
          c.pageNumber(root, ctx.pageIndex, ctx.totalPages, palette, false);
          c.sectionLabel(root, "POR QUE ESCOLHER", { x: 600, y: 210, fill: palette.secondaryDark, textAnchor: "middle" });

          svg.element("circle", { cx: 600, cy: 610, r: 250, fill: palette.primaryLight }, root);
          svg.element("circle", {
            cx: 600, cy: 610, r: 315, fill: "none",
            stroke: palette.secondary, "stroke-width": 4, "stroke-dasharray": "16 14", opacity: 0.7,
          }, root);
          c.productPhoto(root, project, palette, 600, 610, 340);

          const beneficios = [project.content.benefit1, project.content.benefit2, project.content.benefit3]
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
            .slice(0, 3);
          // Slots fixos nos cantos: o conector parte da borda do anel (fromX/
          // fromY, pré-calculados) para não cruzar a foto do produto.
          c.benefitOrbit(root, beneficios, palette, {
            centerX: 600, centerY: 610,
            slots: [
              { x: 170, y: 380, fromX: 322, fromY: 461, textX: 170, textY: 476, width: 280, anchor: "middle" },
              { x: 1030, y: 380, fromX: 878, fromY: 461, textX: 1030, textY: 476, width: 280, anchor: "middle" },
              { x: 600, y: 1000, fromX: 600, fromY: 925, textX: 600, textY: 1094, width: 520, anchor: "middle" },
            ],
          });
        },
      },

      /* ── variações: especificações ────────────────────────────────────── */

      {
        id: "specifications-table-v1",
        label: "Especificações em tabela",
        family: MODULAR_FAMILY,
        version: 1,
        description: "Cabeçalho escuro e ficha em linhas alternadas, com valor alinhado à direita.",
        requiredFields: [],
        optionalFields: ["content.specs", "logo"],
        render(ctx) {
          const { root, svg, palette, project, canvas, mix } = ctx;
          c.backgroundFill(root, palette.surface, canvas);
          svg.element("rect", { x: 0, y: 0, width: 1200, height: 320, fill: palette.primaryDark }, root);
          svg.element("rect", { x: 0, y: 314, width: 1200, height: 6, fill: palette.secondary }, root);

          c.brand(root, project, palette, { onDark: true });
          c.pageNumber(root, ctx.pageIndex, ctx.totalPages, palette, true);
          c.sectionLabel(root, "FICHA TÉCNICA", { x: 72, y: 186, fill: palette.secondary });
          c.headline(root, "Especificações técnicas", 70, 268, {
            maxChars: 26, maxLines: 1, fontSize: 58, lineHeight: 64, fill: palette.white,
          });

          const pares = c.parseSpecPairs(project.content.specs, 6);
          if (pares.length) {
            c.specTable(root, pares, palette, {
              x: 72, y: 396, width: 1056, rowHeight: 104,
              stripeFill: mix(palette.surface, palette.primary, 0.07),
              labelFill: palette.muted, valueFill: palette.text,
            });
          } else if (ctx.mode === "preview") {
            c.editingNote(root, "Preencha as especificações técnicas — uma por linha, no formato “Potência: 650 W”.",
              palette, { x: 72, y: 420, width: 1056 });
          }
        },
      },

      {
        id: "specifications-cards-v1",
        label: "Especificações em cartões",
        family: MODULAR_FAMILY,
        version: 1,
        description: "Faixa clara com o produto e a ficha distribuída em cartões de destaque.",
        requiredFields: [],
        optionalFields: ["content.specs", "logo", "product.image"],
        render(ctx) {
          const { root, svg, palette, project, canvas } = ctx;
          c.backgroundFill(root, palette.background, canvas);
          svg.element("rect", { x: 0, y: 0, width: 1200, height: 404, fill: palette.primaryLight }, root);

          c.brand(root, project, palette);
          c.pageNumber(root, ctx.pageIndex, ctx.totalPages, palette, false);
          c.sectionLabel(root, "O QUE VEM DENTRO", { x: 72, y: 196, fill: palette.secondaryDark });
          c.headline(root, "Especificações técnicas", 70, 286, {
            maxChars: 17, maxLines: 2, fontSize: 58, lineHeight: 64, fill: palette.text,
          });
          // Centro em 254 (não 206): a foto subia até 61 e passava por cima
          // do contador de páginas, que fica na linha de base 84.
          c.productPhoto(root, project, palette, 1010, 254, 230);

          const pares = c.parseSpecPairs(project.content.specs, 6);
          if (pares.length) {
            c.specCards(root, pares, palette, {
              x: 72, y: 486, width: 1056, columns: 3, gap: 24, rowHeight: 190,
            });
          } else if (ctx.mode === "preview") {
            c.editingNote(root, "Preencha as especificações técnicas — uma por linha, no formato “Potência: 650 W”.",
              palette, { x: 72, y: 486, width: 1056 });
          }

          // Rodapé com o nome do produto: fecha a composição e evita a faixa
          // vazia que sobrava abaixo dos cartões.
          if (String(project.product.name || "").trim()) {
            svg.text(root, c.fitText(project.product.name, 1056, 36, "display"), {
              x: 72, y: 1058, fill: palette.text,
              "font-family": "Manrope,Arial,sans-serif", "font-size": 36, "font-weight": 800,
            });
          }
          svg.element("rect", { x: 72, y: 1108, width: 220, height: 8, fill: palette.secondary }, root);
        },
      },

      /* ── variações: conteúdo da embalagem ─────────────────────────────── */

      {
        id: "package-grid-v1",
        label: "Embalagem em grade",
        family: MODULAR_FAMILY,
        version: 1,
        description: "Cabeçalho escuro, produto à esquerda e itens em células empilhadas à direita.",
        requiredFields: [],
        optionalFields: ["content.packageItems", "logo", "product.image"],
        render(ctx) {
          const { root, svg, palette, project, canvas } = ctx;
          c.backgroundFill(root, palette.surface, canvas);
          svg.element("rect", { x: 0, y: 0, width: 1200, height: 288, fill: palette.primaryDark }, root);

          c.brand(root, project, palette, { onDark: true });
          c.pageNumber(root, ctx.pageIndex, ctx.totalPages, palette, true);
          c.headline(root, "Conteúdo da embalagem", 70, 226, {
            maxChars: 27, maxLines: 1, fontSize: 54, lineHeight: 60, fill: palette.white,
          });

          c.productPhoto(root, project, palette, 300, 740, 400);

          const itens = c.parseListItems(project.content.packageItems, 6);
          if (itens.length) {
            c.packageGrid(root, itens, palette, {
              x: 600, y: 372, width: 528, columns: 1, gap: 14, rowHeight: 108,
              cellFill: palette.background,
            });
          } else if (ctx.mode === "preview") {
            c.editingNote(root, "Liste o que acompanha o produto — um item por linha.",
              palette, { x: 600, y: 372, width: 528 });
          }
        },
      },

      {
        id: "package-focus-v1",
        label: "Embalagem com item principal",
        family: MODULAR_FAMILY,
        version: 1,
        description: "Primeiro item em faixa de destaque e os demais em linha compacta abaixo.",
        requiredFields: [],
        optionalFields: ["content.packageItems", "logo", "product.image"],
        render(ctx) {
          const { root, svg, palette, project, canvas } = ctx;
          c.backgroundFill(root, palette.background, canvas);
          svg.element("rect", { x: 0, y: 0, width: 1200, height: 556, fill: palette.primaryLight }, root);

          c.brand(root, project, palette);
          c.pageNumber(root, ctx.pageIndex, ctx.totalPages, palette, false);
          c.sectionLabel(root, "NA CAIXA", { x: 72, y: 238, fill: palette.secondaryDark });
          c.headline(root, "Conteúdo da embalagem", 70, 330, {
            maxChars: 15, maxLines: 2, fontSize: 58, lineHeight: 64, fill: palette.text,
          });
          c.productPhoto(root, project, palette, 916, 320, 360);

          const itens = c.parseListItems(project.content.packageItems, 6);
          if (itens.length) {
            c.packageFocus(root, itens, palette, { x: 72, y: 618, width: 1056 });
          } else if (ctx.mode === "preview") {
            c.editingNote(root, "Liste o que acompanha o produto — um item por linha.",
              palette, { x: 72, y: 618, width: 1056 });
          }
        },
      },

      /* ── variações: dimensões ─────────────────────────────────────────── */

      {
        id: "dimensions-clean-v1",
        label: "Dimensões limpas",
        family: MODULAR_FAMILY,
        version: 1,
        description: "Produto grande ao centro e as medidas em pílulas centralizadas no rodapé.",
        requiredFields: [],
        optionalFields: ["content.width", "content.height", "content.depth", "logo", "product.image"],
        render(ctx) {
          const { root, svg, palette, project, canvas } = ctx;
          c.backgroundFill(root, palette.background, canvas);

          c.brand(root, project, palette);
          c.pageNumber(root, ctx.pageIndex, ctx.totalPages, palette, false);
          c.sectionLabel(root, "MEDIDAS REAIS", { x: 600, y: 216, fill: palette.secondaryDark, textAnchor: "middle" });
          c.headline(root, "Dimensões do produto", 600, 306, {
            maxChars: 22, maxLines: 1, fontSize: 62, lineHeight: 68, fill: palette.text, textAnchor: "middle",
          });

          svg.element("circle", { cx: 600, cy: 648, r: 268, fill: palette.surface }, root);
          c.productPhoto(root, project, palette, 600, 648, 480);

          const medidas = c.collectMeasures(project.content);
          if (medidas.length) {
            // Centralizado: a largura total muda conforme quantas medidas
            // foram preenchidas, então a peça nunca fica torta.
            c.measureBadges(root, medidas, palette, { centerX: 600, y: 1004, fill: palette.surface });
          } else if (ctx.mode === "preview") {
            c.editingNote(root, "Informe largura, altura ou profundidade para gerar as medidas.",
              palette, { x: 290, y: 990, width: 620 });
          }
        },
      },

      {
        id: "dimensions-panel-v1",
        label: "Dimensões em painel",
        family: MODULAR_FAMILY,
        version: 1,
        description: "Produto sobre malha técnica à esquerda e painel escuro de medidas à direita.",
        requiredFields: [],
        optionalFields: ["content.width", "content.height", "content.depth", "logo", "product.image"],
        render(ctx) {
          const { root, svg, palette, project, canvas, mix } = ctx;
          c.backgroundFill(root, palette.surface, canvas);
          svg.element("rect", { x: 620, y: 0, width: 580, height: 1200, fill: palette.primaryDark }, root);

          c.brand(root, project, palette);
          c.pageNumber(root, ctx.pageIndex, ctx.totalPages, palette, true);
          c.sectionLabel(root, "MEDIDAS REAIS", { x: 72, y: 212, fill: palette.secondaryDark });
          c.headline(root, "Dimensões técnicas", 70, 300, {
            maxChars: 13, maxLines: 2, fontSize: 56, lineHeight: 62, fill: palette.text,
          });

          [0, 1, 2, 3, 4].forEach((linha) => {
            const y = 448 + linha * 156;
            svg.element("line", {
              x1: 72, y1: y, x2: 548, y2: y,
              stroke: mix(palette.text, palette.surface, 0.88), "stroke-width": 2,
            }, root);
          });
          c.productPhoto(root, project, palette, 322, 764, 400);

          const medidas = c.collectMeasures(project.content);
          if (medidas.length) {
            c.measurePanel(root, medidas, palette, {
              x: 692, y: 468, width: 436, step: 170,
              labelFill: palette.secondary, valueFill: palette.white,
              ruleStroke: mix(palette.white, palette.primaryDark, 0.72),
            });
          } else if (ctx.mode === "preview") {
            c.editingNote(root, "Informe largura, altura ou profundidade.",
              palette, { x: 692, y: 440, width: 436 });
          }
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
