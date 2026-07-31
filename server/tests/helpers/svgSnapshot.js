// server/tests/helpers/svgSnapshot.js
// -----------------------------------------------------------------------------
// Infra compartilhada de regressão visual das peças do Estúdio de Templates.
//
// Serializa uma árvore SVG de forma NORMALIZADA e determinística:
//   • atributos em ordem alfabética (a ordem real de setAttribute é irrelevante
//     para o resultado visual e varia conforme a extração);
//   • números formatados de forma estável (evita "90" vs "90.0");
//   • ordem dos filhos preservada (essa sim importa: é a ordem de pintura);
//   • nenhum timestamp, id aleatório ou dado de sessão entra no snapshot.
//
// O mesmo DOM mínimo e o mesmo serializador são usados para gerar o baseline
// (antes da extração) e para conferi-lo (depois), de modo que uma diferença
// no snapshot signifique diferença real na arte — nunca ruído do harness.
// -----------------------------------------------------------------------------

const crypto = require("crypto");

/* ── DOM mínimo, suficiente para os desenhos SVG ──────────────────────── */

function criarElemento(tag, ns) {
  const atributos = new Map();
  const classes = new Set();
  const el = {
    tagName: String(tag || "div"),
    _ns: ns || null,
    _atributos: atributos,
    // Texto atribuído DIRETAMENTE neste nó. O DOM real concatenaria os
    // descendentes; aqui guardamos só o próprio, e o serializador percorre
    // os filhos explicitamente — assim nada é contado duas vezes.
    _ownText: "",
    children: [],
    parentNode: null,
    hidden: false,
    disabled: false,
    title: "",
    type: "",
    files: null,
    style: { setProperty() {}, width: "" },
    dataset: {},
    options: [],
    classList: {
      add: (...n) => n.forEach((c) => classes.add(c)),
      remove: (...n) => n.forEach((c) => classes.delete(c)),
      toggle: (c, force) => {
        const ativo = force === undefined ? !classes.has(c) : Boolean(force);
        if (ativo) classes.add(c); else classes.delete(c);
        return ativo;
      },
      contains: (c) => classes.has(c),
    },
    setAttribute: (nome, valor) => atributos.set(nome, String(valor)),
    getAttribute: (nome) => (atributos.has(nome) ? atributos.get(nome) : null),
    removeAttribute: (nome) => atributos.delete(nome),
    addEventListener() {},
    removeEventListener() {},
    appendChild(filho) { el.children.push(filho); if (filho) filho.parentNode = el; return filho; },
    append(...filhos) { filhos.forEach((f) => el.appendChild(f)); },
    replaceChildren(...filhos) { el.children = []; filhos.forEach((f) => el.appendChild(f)); },
    remove() {
      if (!el.parentNode) return;
      const indice = el.parentNode.children.indexOf(el);
      if (indice >= 0) el.parentNode.children.splice(indice, 1);
    },
    focus() {},
    click() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    get offsetParent() { return el.hidden ? null : {}; },
  };
  Object.defineProperty(el, "textContent", {
    get: () => el._ownText,
    set: (v) => { el._ownText = v == null ? "" : String(v); },
  });
  let valor = "";
  Object.defineProperty(el, "value", {
    get: () => valor,
    set: (v) => { valor = v == null ? "" : String(v); },
  });
  return el;
}

// Adapter de documento que os módulos de renderização consomem por injeção.
function criarDocumentoFake() {
  return {
    createElement: (tag) => criarElemento(tag),
    createElementNS: (ns, tag) => criarElemento(tag, ns),
    createTextNode: (texto) => {
      const no = criarElemento("#text");
      no.textContent = texto;
      return no;
    },
  };
}

/* ── serialização normalizada ─────────────────────────────────────────── */

// Números com muitas casas decimais vindos de cálculo de paleta/posição
// seriam frágeis num snapshot. Arredondamos para 4 casas e removemos o
// zero à direita, mantendo a precisão visualmente relevante.
function normalizarValor(valor) {
  const texto = String(valor);
  const numero = Number(texto);
  if (texto.trim() !== "" && Number.isFinite(numero) && /^-?\d*\.?\d+(e-?\d+)?$/i.test(texto.trim())) {
    return String(Math.round(numero * 10000) / 10000);
  }
  return texto;
}

function serializarNo(no, profundidade) {
  const recuo = "  ".repeat(profundidade);
  const atributos = [...no._atributos.entries()]
    .map(([nome, valor]) => `${nome}="${normalizarValor(valor)}"`)
    .sort()
    .join(" ");
  const cabecalho = atributos ? `${no.tagName} ${atributos}` : String(no.tagName);
  const texto = no._ownText ? ` #text=${JSON.stringify(no._ownText)}` : "";
  const linhas = [`${recuo}<${cabecalho}>${texto}`];
  (no.children || []).forEach((filho) => linhas.push(serializarNo(filho, profundidade + 1)));
  return linhas.join("\n");
}

function serializarSvg(svg) {
  return serializarNo(svg, 0);
}

function hashDoSvg(svg) {
  return crypto.createHash("sha256").update(serializarSvg(svg), "utf8").digest("hex");
}

module.exports = {
  criarElemento,
  criarDocumentoFake,
  serializarSvg,
  hashDoSvg,
  normalizarValor,
};
