// Portal/design-template-presets.js
// -----------------------------------------------------------------------------
// Catálogo de definições de template do Estúdio de Templates.
//
// Cada definição é dado puro e serializável: nenhum campo aqui é uma função.
// A seleção de qual desenho SVG usa cada página acontece pelo `rendererId`,
// resolvido num registro controlado dentro de design-templates.js
// (PAGE_RENDERERS) — o preset nunca fornece código executável.
//
// Hoje só existe um template (o carregador portátil já publicado). Novos
// templates entram como novas entradas de TEMPLATE_DEFINITIONS, sem tocar no
// motor (design-template-engine.js) nem na tela.
// -----------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DESIGN_TEMPLATE_PRESETS = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PORTABLE_CHARGER_COMPLETE_V1 = {
    id: "portable-charger-complete-v1",
    name: "Carregador portátil — conjunto completo",
    segment: "Eletrônicos",
    marketplace: "Mercado Livre",
    canvas: { width: 1200, height: 1200 },

    // Sete peças do conjunto. `rendererId` aponta para uma função conhecida
    // do registro da tela (drawCover, drawWireless, ...) — nunca uma função
    // literal aqui.
    pages: [
      { id: "cover", name: "Capa principal", rendererId: "cover" },
      { id: "wireless", name: "Carregamento por indução", rendererId: "wireless" },
      { id: "led", name: "Iluminação LED", rendererId: "led" },
      { id: "package", name: "Conteúdo da embalagem", rendererId: "package" },
      { id: "dimensions", name: "Dimensões", rendererId: "dimensions" },
      { id: "features", name: "Painel e funcionalidades", rendererId: "features" },
      { id: "safe", name: "Compra segura", rendererId: "safe" },
    ],

    defaults: {
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
      },
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
      compareMode: "custom",
      zoom: 100,
    },

    // Limites de sanitização usados na hidratação de projeto salvo — os
    // mesmos tamanhos que a tela já aplicava antes da extração para o motor.
    contentSchema: {
      benefit: { maxLength: 110 },
      wireless: { maxLength: 180 },
      led: { maxLength: 180 },
      packageItems: { maxLength: 260 },
      width: { maxLength: 18 },
      height: { maxLength: 18 },
      depth: { maxLength: 18 },
      features: { maxLength: 300 },
      safe: { maxLength: 140 },
      shipping: { maxLength: 140 },
      warranty: { maxLength: 140 },
    },
    productSchema: {
      name: { maxLength: 64 },
      subtitle: { maxLength: 120 },
    },
    clientSchema: {
      clienteNome: { maxLength: 80 },
      marcaNome: { maxLength: 40 },
    },
  };

  const TEMPLATE_DEFINITIONS = [PORTABLE_CHARGER_COMPLETE_V1];

  return {
    PORTABLE_CHARGER_COMPLETE_V1,
    TEMPLATE_DEFINITIONS,
  };
});
