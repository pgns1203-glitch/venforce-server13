'use strict';
/*
 * cssIndex — lê CSS com posição exata (linha:coluna) e aplica patches mínimos.
 * Usa postcss, que preserva o arquivo byte a byte fora do que foi alterado
 * (inclusive regras de uma linha só e CSS minificado).
 */
const postcss = require('postcss');

class PatchError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Normalização de seletor idêntica à do cliente (usada para parear CSSOM <-> fonte). */
function normSel(s) {
  return String(s)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, '')
    .replace(/::/g, ':')
    .replace(/["']/g, '')
    .toLowerCase();
}

function insideKeyframes(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === 'atrule' && /keyframes$/i.test(p.name)) return true;
  }
  return false;
}

function condOf(node) {
  const c = [];
  for (let p = node.parent; p && p.type !== 'root'; p = p.parent) {
    if (p.type === 'atrule') c.unshift(`@${p.name} ${p.params}`);
  }
  return c.length ? c.join(' ') : null;
}

/** Lista as regras de estilo na ordem do arquivo (mesma ordem do CSSOM). */
function indexCss(text) {
  const root = postcss.parse(text, { map: { prev: false } });
  const rules = [];
  root.walkRules(rule => {
    if (insideKeyframes(rule)) return;
    const decls = {};
    rule.each(n => {
      if (n.type !== 'decl') return;
      decls[n.prop.startsWith('--') ? n.prop : n.prop.toLowerCase()] = {
        value: n.value,
        important: !!n.important,
        line: n.source.start.line,
        column: n.source.start.column
      };
    });
    rules.push({
      selector: rule.selector,
      line: rule.source.start.line,
      column: rule.source.start.column,
      cond: condOf(rule),
      decls
    });
  });
  return rules;
}

/**
 * patches:
 *   { op: 'set', line, column, selector, prop, value }   // value '' remove a declaração
 *   { op: 'new', selector, decls: [{ prop, value }] }      // regra nova no fim do arquivo
 * Tudo é resolvido ANTES de mutar: se uma regra não estiver mais na posição, nada é alterado.
 */
function applyPatches(text, patches) {
  const root = postcss.parse(text, { map: { prev: false } });
  const byPos = new Map();
  root.walkRules(r => { if (!insideKeyframes(r)) byPos.set(`${r.source.start.line}:${r.source.start.column}`, r); });

  const resolved = patches.map(p => {
    if (p.op === 'new') {
      if (!p.selector || !Array.isArray(p.decls) || !p.decls.length) throw new PatchError(400, 'Regra nova sem seletor ou sem declarações.');
      return { p };
    }
    if (p.op !== 'set') throw new PatchError(400, `Operação desconhecida: ${p.op}`);
    if (!/^-{0,2}[a-z][a-z0-9-]*$/i.test(p.prop || '')) throw new PatchError(400, `Propriedade inválida: ${p.prop}`);
    const r = byPos.get(`${p.line}:${p.column}`);
    if (!r || normSel(r.selector) !== normSel(p.selector)) {
      throw new PatchError(409, `A regra "${p.selector}" não está mais em ${p.line}:${p.column}. O arquivo mudou no disco — recarregue a página.`);
    }
    return { p, r };
  });

  for (const { p } of resolved) {
    if (/[{};]/.test(String(p.value || '')) || (p.decls || []).some(d => /[{};]/.test(String(d.value)))) {
      throw new PatchError(400, 'Valor com { } ou ; não é permitido.');
    }
  }

  const touched = new Map();
  const created = [];
  for (const { p, r } of resolved) {
    if (p.op === 'set') {
      if (!touched.has(r)) touched.set(r, { before: r.toString(), line: r.source.start.line });
      const same = r.nodes.filter(n => n.type === 'decl' && n.prop.toLowerCase() === p.prop.toLowerCase());
      const d = same[same.length - 1];
      if (p.value === '' || p.value == null) {
        if (d) d.remove();
      } else if (d) {
        d.value = String(p.value);
        if (d.raws.value) delete d.raws.value;
      } else {
        const last = [...r.nodes].reverse().find(n => n.type === 'decl');
        const nd = postcss.decl({ prop: p.prop, value: String(p.value) });
        if (last) { nd.raws.before = last.raws.before; nd.raws.between = last.raws.between; }
        r.append(nd);
        r.raws.semicolon = true;
      }
    } else {
      const nr = postcss.rule({ selector: p.selector });
      for (const d of p.decls) nr.append(postcss.decl({ prop: d.prop, value: String(d.value) }));
      root.append(nr);
      created.push(nr);
    }
  }

  const out = root.toString();
  const changes = [];
  for (const [r, info] of touched) changes.push({ kind: 'set', line: info.line, selector: r.selector, before: info.before, after: r.toString() });
  for (const nr of created) changes.push({ kind: 'new', selector: nr.selector, before: '', after: nr.toString() });
  return { text: out, changes };
}

module.exports = { indexCss, applyPatches, normSel, PatchError };
