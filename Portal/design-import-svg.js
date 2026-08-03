// Portal/design-import-svg.js
// -----------------------------------------------------------------------------
// Importador de SVG para a Biblioteca de Templates.
//
// A sanitização (sanitizeSvgMarkup) é PURA — string in, string out — e não
// depende de DOMParser/navegador, então roda igual em Node e no browser.
// Ela bloqueia (rejeita a importação) quando encontra <script>, e remove os
// demais riscos: <foreignObject>, atributos on*, URLs javascript: e
// referências a recursos externos (http/https) em href/src/xlink:href.
//
// A conversão de SVG em objetos Fabric é injetada via `svgToFabricJson`
// (browser); sem ela, a página entra como um único grupo travado — mesmo
// contrato de design-legacy-migration.js.
// -----------------------------------------------------------------------------

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VF_DESIGN_IMPORT_SVG = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const EXTERNAL_URL_ATTR = /(href|xlink:href|src)(\s*=\s*)(["'])\s*(https?:)\/\/[^"']*\3/gi;
  const JS_URL_ATTR = /(href|xlink:href|src)(\s*=\s*)(["'])\s*javascript:[^"']*\3/gi;
  const ON_ATTR = /\s+on[a-z]+\s*=\s*(".*?"|'.*?')/gi;
  const SCRIPT_TAG = /<\s*script[\s>]/i;
  const FOREIGN_OBJECT_TAG = /<\s*foreignObject[\s\S]*?<\s*\/\s*foreignObject\s*>/gi;

  function sanitizeSvgMarkup(rawSvg) {
    const source = String(rawSvg || "");
    if (!/<svg[\s>]/i.test(source)) {
      return { ok: false, codigo: "SVG_INVALIDO", mensagem: "O arquivo não contém um elemento <svg>." };
    }
    if (SCRIPT_TAG.test(source)) {
      return { ok: false, codigo: "SVG_SCRIPT_BLOQUEADO", mensagem: "O SVG contém <script> e não pode ser importado." };
    }

    const warnings = [];
    let sanitized = source;

    if (FOREIGN_OBJECT_TAG.test(sanitized)) {
      warnings.push("Elementos <foreignObject> foram removidos por segurança.");
      sanitized = sanitized.replace(FOREIGN_OBJECT_TAG, "");
    }
    if (ON_ATTR.test(sanitized)) {
      warnings.push("Atributos de evento (on*) foram removidos.");
      sanitized = sanitized.replace(ON_ATTR, "");
    }
    if (JS_URL_ATTR.test(sanitized)) {
      warnings.push("Links javascript: foram bloqueados.");
      sanitized = sanitized.replace(JS_URL_ATTR, (match, attr, eq, quote) => `${attr}${eq}${quote}#${quote}`);
    }
    if (EXTERNAL_URL_ATTR.test(sanitized)) {
      warnings.push("Recursos externos (http/https) foram removidos.");
      sanitized = sanitized.replace(EXTERNAL_URL_ATTR, (match, attr, eq, quote) => `${attr}${eq}${quote}${quote}`);
    }

    return { ok: true, sanitized, warnings };
  }

  // Contagem aproximada por regex — só para o resumo da Etapa 2 do modal.
  // Não decide o que o Fabric consegue de fato separar; é uma estimativa.
  const RECOGNIZED_TAGS = ["text", "image", "rect", "circle", "ellipse", "path", "g", "line", "polygon", "polyline"];

  function estimateObjectCount(svgMarkup) {
    return RECOGNIZED_TAGS.reduce((total, tag) => {
      const matches = svgMarkup.match(new RegExp(`<${tag}[\\s/>]`, "gi"));
      return total + (matches ? matches.length : 0);
    }, 0);
  }

  function readDimensions(svgMarkup) {
    const widthMatch = svgMarkup.match(/<svg[^>]*\bwidth\s*=\s*["']?([\d.]+)/i);
    const heightMatch = svgMarkup.match(/<svg[^>]*\bheight\s*=\s*["']?([\d.]+)/i);
    if (widthMatch && heightMatch) {
      return { width: Math.round(Number(widthMatch[1])), height: Math.round(Number(heightMatch[1])) };
    }
    const viewBoxMatch = svgMarkup.match(/viewBox\s*=\s*["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)/i);
    if (viewBoxMatch) {
      return { width: Math.round(Number(viewBoxMatch[1])), height: Math.round(Number(viewBoxMatch[2])) };
    }
    return { width: 1200, height: 1200 };
  }

  function createSvgImporter(deps) {
    const config = deps || {};
    const documentModel = config.documentModel;
    if (!documentModel) throw new Error("createSvgImporter precisa de documentModel.");
    const svgToFabricJson = typeof config.svgToFabricJson === "function" ? config.svgToFabricJson : null;

    // input: { text, fileName, sizeBytes }
    function analyze(input) {
      const source = input || {};
      const result = sanitizeSvgMarkup(source.text || "");
      if (!result.ok) return result;

      const dimensions = readDimensions(result.sanitized);
      const objectCount = estimateObjectCount(result.sanitized);
      const warnings = result.warnings.slice();
      if (objectCount === 0) {
        warnings.push("Não foi possível reconhecer elementos editáveis; o SVG será importado como um único grupo.");
      }

      return {
        ok: true,
        sanitizedSvg: result.sanitized,
        summary: {
          format: "svg",
          fileName: source.fileName || null,
          sizeBytes: Number(source.sizeBytes) || result.sanitized.length,
          width: dimensions.width,
          height: dimensions.height,
          pageCount: 1,
          objectCount,
          warnings,
        },
      };
    }

    function limitedGroupPage(analyzeResult) {
      const { width, height } = analyzeResult.summary;
      return documentModel.createPage({
        name: "Página 1",
        width,
        height,
        fabricJson: {
          version: "6.9.1",
          objects: [{
            type: "group",
            vfId: documentModel.generateId(),
            vfName: "SVG importado",
            vfType: "legacy-group",
            vfLocked: true,
            vfHidden: false,
            left: 0,
            top: 0,
            width,
            height,
            objects: [],
            vfLegacySvg: analyzeResult.sanitizedSvg,
          }],
        },
      });
    }

    // analyzeResult: retorno de analyze() com ok:true. options: { name,
    // clienteId, accountRef, itemType }.
    async function build(analyzeResult, options) {
      const chosen = options || {};
      const { width, height } = analyzeResult.summary;
      const warnings = analyzeResult.summary.warnings.slice();

      let page;
      if (svgToFabricJson) {
        try {
          const fabricJson = await svgToFabricJson(analyzeResult.sanitizedSvg, { width, height });
          page = fabricJson && Array.isArray(fabricJson.objects)
            ? documentModel.createPage({ name: "Página 1", width, height, fabricJson })
            : limitedGroupPage(analyzeResult);
          if (!fabricJson) warnings.push("Não foi possível separar os elementos do SVG; importado como grupo único.");
        } catch {
          page = limitedGroupPage(analyzeResult);
          warnings.push("Não foi possível separar os elementos do SVG; importado como grupo único.");
        }
      } else {
        page = limitedGroupPage(analyzeResult);
        warnings.push("Sem conversor de SVG disponível neste navegador; importado como grupo único.");
      }

      const document = documentModel.createDocument({
        name: chosen.name || analyzeResult.summary.fileName || "SVG importado",
        clienteId: chosen.clienteId ?? null,
        accountRef: chosen.itemType === "artwork" ? (chosen.accountRef || null) : null,
        itemType: chosen.itemType === "artwork" ? "artwork" : "template",
        source: { type: "svg", originalFileName: analyzeResult.summary.fileName },
        pages: [page],
      });

      return { document, warnings };
    }

    return Object.freeze({
      id: "svg",
      label: "SVG (.svg)",
      accept: [".svg"],
      analyze,
      build,
    });
  }

  return { createSvgImporter, sanitizeSvgMarkup, estimateObjectCount, readDimensions };
});
