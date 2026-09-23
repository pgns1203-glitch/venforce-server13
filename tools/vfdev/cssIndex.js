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
    .toLowerCase()
    .replace(/:nth-(child|of-type|last-child|last-of-type)\(even\)/g, ':nth-$1(2n)')
    .replace(/:nth-(child|of-type|last-child|last-of-type)\(odd\)/g, ':nth-$1(2n+1)');
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

/** @media normalizada: sem espaço, minúscula, e (max-width:N) ≡ (width<=N) — o minificador pode trocar a sintaxe. */
function normCond(c) {
  if (!c) return '';
  return String(c).toLowerCase().replace(/\s+/g, '')
    .replace(/\(max-width:([^)]+)\)/g, '(width<=$1)').replace(/\(min-width:([^)]+)\)/g, '(width>=$1)')
    .replace(/\(max-height:([^)]+)\)/g, '(height<=$1)').replace(/\(min-height:([^)]+)\)/g, '(height>=$1)')
    .replace(/@mediaall and/g, '@media').replace(/@mediascreenand/g, '@media');
}
/** Conjunto de propriedades de uma regra, sem prefixos de fornecedor (o minificador pode acrescentá-los). */
const propSet = decls => Object.keys(decls).filter(p => p.startsWith('--') || !/^-(webkit|moz|ms|o)-/.test(p)).sort().join(',');

/**
 * Pareia cada regra de um CSS gerado pelo Vite (bundle) com a regra de origem em frontend-react/src/styles/*.css.
 * Chave: seletor normalizado + @media normalizada + conjunto de propriedades. Tolera a minificação.
 * Quando a mesma chave aparece N vezes no bundle e N vezes nas fontes, pareia pela ordem de ocorrência.
 * Devolve, para cada regra do bundle (mesma ordem de indexCss), { src } ou { motivo }.
 */
function pairBundle(bundleRules, sources) {
  const key = r => normSel(r.selector) + '|' + normCond(r.cond) + '|' + propSet(r.decls);
  const selKey = r => normSel(r.selector) + '|' + normCond(r.cond);
  const byKey = new Map(), bySel = new Map();
  for (const { file, rules } of sources) for (const r of rules) {
    const k = key(r), sk = selKey(r), e = { file, ...r };
    if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(e);
    if (!bySel.has(sk)) bySel.set(sk, []); bySel.get(sk).push(e);
  }
  const seen = new Map(), total = new Map();
  for (const r of bundleRules) { const k = key(r); total.set(k, (total.get(k) || 0) + 1); }
  return bundleRules.map(r => {
    const k = key(r), cands = byKey.get(k) || [], n = seen.get(k) || 0;
    seen.set(k, n + 1);
    if (cands.length === 1 && total.get(k) === 1) return { src: cands[0] };
    if (cands.length > 1 && cands.length === total.get(k)) return { src: cands[n], porOrdem: true };
    if (cands.length > 1) return { motivo: `ambíguo: ${cands.length} regras iguais nas fontes (${[...new Set(cands.map(c => `${c.file}:${c.line}`))].slice(0, 3).join(', ')}) para ${total.get(k)} no bundle` };
    const mesmoSel = bySel.get(selKey(r)) || [];
    if (mesmoSel.length) return { motivo: `sem par exato: o seletor existe nas fontes (${mesmoSel.slice(0, 2).map(c => `${c.file}:${c.line}`).join(', ')}) mas com outras propriedades — o minificador pode ter juntado ou reescrito a regra` };
    return { motivo: 'sem par: o seletor não aparece nas fontes versionadas desta ilha' };
  });
}

module.exports = { indexCss, applyPatches, normSel, normCond, pairBundle, PatchError };
