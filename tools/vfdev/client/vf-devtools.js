/*
 * VF Visual DevTools — cliente injetado pelo tools/vfdev/server.js.
 * Roda dentro da página real do Portal. Não é servido em produção.
 * UI isolada em shadow DOM, anexada ao <html> (fora do <body>, que o vf-shell reorganiza).
 */
(() => {
'use strict';
if (window.__VFDEV__) return;
window.__VFDEV__ = { version: '0.1.0' };

const SCRIPT = document.currentScript;
const TOKEN = SCRIPT ? new URL(SCRIPT.src).searchParams.get('t') : '';

/* ---------------- utilitários ---------------- */
const pf = v => parseFloat(v) || 0;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const normSel = s => String(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '').replace(/::/g, ':').replace(/["']/g, '').toLowerCase();
const LS = {
  get(k, d) { try { const v = localStorage.getItem('vfdev:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('vfdev:' + k, JSON.stringify(v)); } catch (e) {} }
};
async function getJSON(url) { const r = await fetch(url, { cache: 'no-store' }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; }
async function postJSON(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-VFDEV-Token': TOKEN }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j;
}
const htmlFile = () => decodeURIComponent(location.pathname.replace(/^\/+/, '')) || 'index.html';
const relFromHref = href => { try { const u = new URL(href, location.href); if (u.origin !== location.origin) return null; return decodeURIComponent(u.pathname.replace(/^\/+/, '')); } catch (e) { return null; } };

/* ---------------- estado ---------------- */
let CFG = null, host, root, ov, panel, launcher;
const S = {
  open: LS.get('open', true), dock: LS.get('dock', 'right'), mode: 'select', tab: 'props', scope: LS.get('scope', 'page'),
  selected: null, hoverEl: null, hoverDiag: null, pinned: null, hoverIssue: null, altDown: false, affected: null,
  lastEdit: null, problems: [], targets: [], beforeMode: false, grid: false
};

/* ================= 1. Índice: regra do CSSOM -> arquivo:linha:coluna ================= */
const ruleInfo = new Map();          // CSSStyleRule -> info
const fileMeta = new Map();          // arquivo -> { kind, writable, reason, sources, sheet }
const indexed = new WeakSet();
let scratchSheet = null;

function cssomRules(sheet) {
  const out = [];
  const walk = list => {
    for (const r of list) {
      if (r instanceof CSSStyleRule) out.push(r);
      else if (r instanceof CSSKeyframesRule || r instanceof CSSImportRule) continue;
      else if (r.cssRules) walk(r.cssRules);
    }
  };
  try { walk(sheet.cssRules); } catch (e) { return null; } // cross-origin (CDN)
  return out;
}
function pair(cssom, src) {
  const out = []; let j = 0;
  for (const r of cssom) {
    const ns = normSel(r.selectorText); let found = -1;
    for (let k = j; k < src.length && k < j + 120; k++) if (normSel(src[k].selector) === ns) { found = k; break; }
    if (found >= 0) { out.push([r, src[found]]); j = found + 1; } else out.push([r, null]);
  }
  return out;
}
async function indexSheet(sheet, force) {
  if (!force && indexed.has(sheet)) return;
  if (sheet.ownerNode && sheet.ownerNode.id === 'vfdev-scratch') return;
  indexed.add(sheet);
  const list = cssomRules(sheet); if (!list) return;
  const file = sheet.href ? relFromHref(sheet.href) : null;
  if (!sheet.href) {
    list.forEach(r => ruleInfo.set(r, { file: htmlFile(), kind: 'inline', writable: false, reason: '<style> dentro do HTML', line: null, decls: {} }));
    return;
  }
  if (!file) return;
  let meta;
  try { meta = await getJSON('/__vfdev/index?file=' + encodeURIComponent(file)); }
  catch (e) { list.forEach(r => ruleInfo.set(r, { file, kind: 'unknown', writable: false, reason: e.message, line: null, decls: {} })); return; }
  fileMeta.set(file, { kind: meta.kind, writable: meta.writable, reason: meta.reason, sources: meta.sources || [], sheet });
  for (const [r, src] of pair(list, meta.rules)) {
    ruleInfo.set(r, src
      ? { file, kind: meta.kind, writable: meta.writable, reason: meta.reason, line: src.line, column: src.column, selectorSrc: src.selector, cond: src.cond, decls: src.decls }
      : { file, kind: meta.kind, writable: false, reason: 'regra não localizada no arquivo (recarregue)', line: null, decls: {} });
  }
}
async function syncSheets() { for (const s of [...document.styleSheets]) await indexSheet(s); }
async function reindexFile(file) {
  const m = fileMeta.get(file); if (!m) return;
  for (const [r, i] of [...ruleInfo]) if (i.file === file) ruleInfo.delete(r);
  await indexSheet(m.sheet, true);
}

/* ================= 2. Qual regra REALMENTE controla a propriedade ================= */
const LONG = {
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  gap: ['row-gap', 'column-gap'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius']
};
function comp(el, prop) {
  const cs = getComputedStyle(el);
  if (LONG[prop]) { const v = LONG[prop].map(p => cs.getPropertyValue(p).trim()); return v.every(x => x === v[0]) ? v[0] : v.join(' '); }
  return cs.getPropertyValue(prop).trim();
}
function sentinel(prop, cur) {
  if (prop === 'flex-direction') return cur === 'row' ? 'column' : 'row';
  if (prop === 'align-items' || prop === 'justify-content') return cur === 'flex-end' ? 'flex-start' : 'flex-end';
  if (prop === 'font-weight') return cur === '100' ? '900' : '100';
  if (prop === 'grid-template-columns') return '31px 37px';
  if (prop.startsWith('overflow')) return cur === 'hidden' ? 'scroll' : 'hidden';
  return '777px';
}
let matchCache = new WeakMap();
const resetCache = () => { matchCache = new WeakMap(); };
function matchedRules(el) {
  let m = matchCache.get(el); if (m) return m;
  m = [];
  for (const [rule, info] of ruleInfo) { let ok = false; try { ok = el.matches(rule.selectorText); } catch (e) {} if (ok) m.push([rule, info]); }
  matchCache.set(el, m); return m;
}
function findSource(el, prop) {
  const before = comp(el, prop), cands = [];
  for (const [rule, info] of matchedRules(el)) {
    const v = rule.style.getPropertyValue(prop); if (!v) continue;
    cands.push({ rule, info, value: v.trim(), prio: rule.style.getPropertyPriority(prop) });
  }
  let win = null;
  for (const c of cands) {
    c.rule.style.setProperty(prop, sentinel(prop, before), c.prio);
    const after = comp(el, prop);
    c.rule.style.setProperty(prop, c.value, c.prio);
    if (after !== before) { win = c; break; }
  }
  const base = { prop, computed: before };
  if (!win) {
    if (el.style.getPropertyValue(prop)) return { ...base, inline: true, value: el.style.getPropertyValue(prop) };
    return { ...base, none: true };
  }
  const srcDecl = win.info.decls && win.info.decls[prop];
  return {
    ...base, rule: win.rule, info: win.info, value: win.value, srcValue: srcDecl ? srcDecl.value : win.value,
    important: !!win.prio, selector: win.rule.selectorText, affects: countMatches(win.rule.selectorText),
    losers: cands.filter(c => c !== win && !c.info.cond).slice(0, 3)
  };
}
function matchesOf(sel) { try { return [...document.querySelectorAll(sel)].filter(e => e !== host); } catch (e) { return []; } }
const countMatches = sel => matchesOf(sel).length;

/* ================= 3. Tokens da fundação (lidos do :root real) ================= */
let SPACE = [], RADII = [], FONTS = [], tokenDecl = {};
function remPx() { return pf(getComputedStyle(document.documentElement).fontSize) || 16; }
function toPx(v) { v = String(v).trim(); if (/^-?[\d.]+px$/.test(v)) return pf(v); if (/^-?[\d.]+rem$/.test(v)) return pf(v) * remPx(); if (v === '0') return 0; return null; }
function readTokens() {
  const names = new Set();
  for (const [rule, info] of ruleInfo) {
    if (rule.selectorText !== ':root') continue;
    for (let i = 0; i < rule.style.length; i++) { const n = rule.style[i]; if (n.startsWith('--')) names.add(n); }
    for (const n of Object.keys(info.decls || {})) if (n.startsWith('--') && !tokenDecl[n]) tokenDecl[n] = { file: info.file, line: info.decls[n].line };
  }
  const cs = getComputedStyle(document.documentElement);
  const scale = (prefix, label) => {
    const seen = new Set(), out = [];
    for (const n of names) {
      if (!n.startsWith(prefix)) continue;
      const px = toPx(cs.getPropertyValue(n)); if (px == null || seen.has(px)) continue;
      seen.add(px); out.push({ name: n, label: label(n), px });
    }
    return out.sort((a, b) => a.px - b.px);
  };
  const T = CFG.tokens || {};
  SPACE = [{ name: '0', label: '0', px: 0 }, ...scale(T.space || '--vf-sp-', n => n.slice((T.space || '--vf-sp-').length))];
  RADII = scale(T.radius || '--vf-radius', n => n.slice((T.radius || '--vf-radius').length).replace(/^-/, '') || 'base').filter(t => t.px < 500);
  FONTS = scale(T.fontSize || '--vf-fs-', n => n.slice((T.fontSize || '--vf-fs-').length));
}
const rootVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const tokVal = t => t.name === '0' ? '0' : `var(${t.name})`;
const tokenOf = v => { const m = String(v).match(/^var\((--[\w-]+)\)$/); return m ? m[1] : null; };
const tokenLabelFor = px => { const f = SPACE.find(s => s.name !== '0' && Math.abs(s.px - px) < 0.5); return f ? f.label : null; };

/* ================= 4. Nomes humanos ================= */
const isFlex = cs => /flex/.test(cs.display), isGrid = cs => /grid/.test(cs.display), isFG = cs => isFlex(cs) || isGrid(cs);
const DEFS = [
  { g: 'Espaço', prop: 'padding', label: 'Respiro interno', hint: 'distância da borda até o conteúdo', scale: 'space', step: 4 },
  { g: 'Espaço', prop: 'gap', label: 'Espaço entre os itens', hint: 'vão entre cada filho', scale: 'space', step: 4, when: isFG },
  { g: 'Espaço', prop: 'margin-top', label: 'Espaço acima (por fora)', hint: 'empurra o que vem antes', scale: 'space', step: 4 },
  { g: 'Espaço', prop: 'margin-bottom', label: 'Espaço abaixo (por fora)', hint: 'empurra o que vem depois', scale: 'space', step: 4 },
  { g: 'Layout', prop: 'grid-template-columns', label: 'Colunas', hint: 'quantos itens por linha', cols: true, when: isGrid },
  { g: 'Layout', prop: 'flex-direction', label: 'Direção', when: isFlex, opts: [['row', 'Lado a lado'], ['column', 'Empilhado']] },
  { g: 'Layout', prop: 'align-items', label: 'Alinhar no outro eixo', when: isFG, opts: [['normal', 'Padrão (esticar)'], ['stretch', 'Esticar'], ['flex-start', 'Início'], ['center', 'Centro'], ['flex-end', 'Fim'], ['baseline', 'Linha do texto']] },
  { g: 'Layout', prop: 'justify-content', label: 'Distribuir no eixo principal', when: isFlex, opts: [['normal', 'Padrão (início)'], ['flex-start', 'Início'], ['center', 'Centro'], ['flex-end', 'Fim'], ['space-between', 'Espalhar até as pontas']] },
  { g: 'Tamanho', prop: 'width', label: 'Largura', step: 8 },
  { g: 'Tamanho', prop: 'max-width', label: 'Largura máxima', step: 8 },
  { g: 'Tamanho', prop: 'min-height', label: 'Altura mínima', hint: 'nunca fica mais baixo que isso', step: 8 },
  { g: 'Tamanho', prop: 'overflow-x', label: 'Se não couber na largura', opts: [['visible', 'Vaza pra fora'], ['auto', 'Rola dentro'], ['hidden', 'Corta']] },
  { g: 'Texto', prop: 'font-size', label: 'Tamanho da fonte', scale: 'font', step: 1 },
  { g: 'Texto', prop: 'font-weight', label: 'Peso da fonte', opts: [['400', 'Normal'], ['500', 'Médio'], ['600', 'Semi-negrito'], ['700', 'Negrito'], ['800', 'Extra-negrito']] },
  { g: 'Visual', prop: 'border-radius', label: 'Arredondamento', scale: 'radius', step: 2 }
];
const DEF = Object.fromEntries(DEFS.map(d => [d.prop, d]));
for (const s of ['top', 'right', 'bottom', 'left']) {
  DEF['margin-' + s] = DEF['margin-' + s] || { g: 'Espaço', prop: 'margin-' + s, label: `Espaço ${{ right: 'à direita', left: 'à esquerda' }[s]} (por fora)`, scale: 'space', step: 4 };
  DEF['padding-' + s] = { g: 'Espaço', prop: 'padding-' + s, label: `Respiro ${{ top: 'em cima', bottom: 'embaixo', left: 'à esquerda', right: 'à direita' }[s]}`, scale: 'space', step: 4 };
}
const scaleOf = def => def.scale === 'space' ? SPACE : def.scale === 'radius' ? RADII : def.scale === 'font' ? FONTS : null;

const TAGS = { h1: 'Título', h2: 'Subtítulo', h3: 'Subtítulo', h4: 'Subtítulo', th: 'Cabeçalho de coluna', td: 'Célula', tr: 'Linha da tabela', p: 'Parágrafo', table: 'Tabela', thead: 'Topo da tabela', tbody: 'Corpo da tabela', button: 'Botão', a: 'Link', input: 'Campo', select: 'Seleção', label: 'Rótulo', section: 'Seção', aside: 'Lateral', header: 'Cabeçalho', main: 'Conteúdo principal', nav: 'Navegação', form: 'Formulário', ul: 'Lista', li: 'Item de lista', img: 'Imagem', svg: 'Ícone', span: 'Trecho', div: 'Bloco', body: 'Página' };
const WORDS = { kpi: 'KPI', card: 'Card', grid: 'Grade', table: 'Tabela', tbl: 'Tabela', btn: 'Botão', head: 'Cabeçalho', header: 'Cabeçalho', body: 'Corpo', toolbar: 'Barra de ferramentas', filters: 'Filtros', filter: 'Filtro', tabs: 'Abas', tab: 'Aba', panel: 'Painel', drawer: 'Gaveta lateral', modal: 'Janela', title: 'Título', label: 'Rótulo', value: 'Valor', badge: 'Selo', chip: 'Etiqueta', row: 'Linha', col: 'Coluna', list: 'Lista', item: 'Item', sidebar: 'Barra lateral', topbar: 'Barra do topo', content: 'Conteúdo', section: 'Seção', search: 'Busca', field: 'Campo', icon: 'Ícone', empty: 'Vazio', state: 'Estado', status: 'Status', footer: 'Rodapé', actions: 'Ações', meta: 'Detalhes', stack: 'Pilha', bar: 'Barra', summary: 'Resumo', stat: 'Indicador', delta: 'Variação', hint: 'Dica', note: 'Nota', wrap: 'Envoltório', main: 'Principal', page: 'Página', shell: 'Moldura' };
const mainClass = el => {
  const cls = [...el.classList].filter(c => !/^(is-|has-|js-)/.test(c) && !/^vf-page/.test(c));
  return cls.find(c => !c.includes('--')) && cls.filter(c => !c.includes('--')).pop() || cls.pop();
};
function nameOf(el) {
  if (!el || el.nodeType !== 1) return '';
  const c = mainClass(el);
  if (c) {
    const parts = c.replace(/^vf-|^vfc?-|^vfop-/, '').split(/__|-|_/).filter(Boolean);
    const w = p => { p = p.toLowerCase(); return WORDS[p] || (p.endsWith('s') && WORDS[p.slice(0, -1)] ? WORDS[p.slice(0, -1)] + 's' : null); };
    const human = parts.map(w).filter(Boolean);
    if (human.length) return human.slice(-2).join(' de ').replace(/^(\w)/, m => m.toUpperCase());
  }
  return TAGS[el.tagName.toLowerCase()] || el.tagName.toLowerCase();
}
const nm = el => { const c = mainClass(el); return `<b>${esc(nameOf(el))}</b>${c ? ` <code>.${esc(c)}</code>` : ''}`; };
const selOf = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + [...el.classList].slice(0, 4).map(c => '.' + c).join('');
const snippet = el => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), t = []; while (w.nextNode()) { const v = w.currentNode.textContent.trim(); if (v) t.push(v); if (t.join(' ').length > 40) break; } return t.join(' ').replace(/\s+/g, ' ').slice(0, 32); };
const inPage = el => !!el && el.nodeType === 1 && el !== host && document.documentElement.contains(el) && el !== document.documentElement;
function newSel(el) {
  if (el === document.body) return 'body';
  const c = mainClass(el); if (c) return '.' + CSS.escape(c);
  const anc = el.parentElement && el.parentElement.closest('[class]');
  const ac = anc && anc !== document.body ? mainClass(anc) : null;
  return (ac ? '.' + CSS.escape(ac) + ' ' : '') + el.tagName.toLowerCase();
}
const ancestor = (el, test) => { for (let n = el; inPage(n); n = n.parentElement) if (test(getComputedStyle(n))) return n; return null; };
const fgAnc = el => ancestor(el, isFG), gridAnc = el => ancestor(el, isGrid), flexAnc = el => ancestor(el, isFlex);
const realKids = el => [...el.children].filter(k => k !== host && k.getClientRects().length);

/* ================= 5. Onde gravar: regra da página, global, override ou só prompt ================= */
function pageFile() {
  let last = null;
  for (const s of document.styleSheets) { const f = s.href && relFromHref(s.href); const m = f && fileMeta.get(f); if (m && m.kind === 'page' && m.writable) last = f; }
  return last;
}
function pagePrefix() { const c = [...document.body.classList].find(c => /^vf-page-./.test(c)); return c ? '.' + CSS.escape(c) : null; }
function overrideSelector(el) {
  const pre = pagePrefix(); const sel = newSel(el);
  if (!pre) return null;
  return sel === 'body' ? `body${pre}` : `${pre} ${sel}`;
}
const overrides = new Map();
function getOverride(el) {
  const file = pageFile(), sel = overrideSelector(el);
  if (!file || !sel) return null;
  const key = file + '|' + sel;
  if (overrides.has(key) && overrides.get(key).parentStyleSheet) return overrides.get(key);
  for (const [r, i] of ruleInfo) if (i.file === file && !i.cond && normSel(r.selectorText) === normSel(sel)) { overrides.set(key, r); return r; }
  const sheet = fileMeta.get(file).sheet;
  const rule = sheet.cssRules[sheet.insertRule(`${sel} {}`, sheet.cssRules.length)];
  ruleInfo.set(rule, { file, kind: 'page', writable: true, isNew: true, selectorSrc: sel, line: null, decls: {} });
  overrides.set(key, rule); resetCache();
  return rule;
}
function sourceHint(src) {
  if (src && src.info && src.info.kind === 'built') { const m = fileMeta.get(src.info.file); return (m && m.sources && m.sources.length) ? m.sources.join(' ou ') : `${src.info.file} (fonte não versionada)`; }
  if (src && src.info && src.info.kind === 'inline') return `${htmlFile()} (<style> inline)`;
  if (src && src.inline) return `${htmlFile()} (atributo style="")`;
  return pageFile() || htmlFile();
}
function getScratch(el, src) {
  if (!scratchSheet) { const st = document.createElement('style'); st.id = 'vfdev-scratch'; document.head.appendChild(st); scratchSheet = st.sheet; }
  const sel = src && src.rule && src.info.kind === 'built' ? src.selector : (overrideSelector(el) || newSel(el));
  for (const [r, i] of ruleInfo) if (i.kind === 'scratch' && r.selectorText === sel) return r;
  const rule = scratchSheet.cssRules[scratchSheet.insertRule(`${sel} {}`, scratchSheet.cssRules.length)];
  ruleInfo.set(rule, { file: sourceHint(src), kind: 'scratch', writable: false, isNew: true, selectorSrc: sel, line: null, decls: {}, reason: 'só vai no prompt' });
  resetCache();
  return rule;
}
function targetFor(el, prop) {
  const src = findSource(el, prop), info = src.rule && src.info;
  if (info && info.isNew) return { rule: src.rule };
  if (info && info.writable && info.line && (info.kind === 'page' || (info.kind === 'global' && S.scope === 'global'))) return { rule: src.rule };
  if (info && info.kind === 'built') return { rule: getScratch(el, src), scratch: true, src };
  if (!src.important) { const o = getOverride(el); if (o) return { rule: o, override: true, src }; }
  return { rule: getScratch(el, src), scratch: true, src };
}

/* ---------------- alterações, undo/redo ---------------- */
const changes = new Map(), undoS = [], redoS = [];
let rid = 0; const RID = new WeakMap();
const keyOf = (rule, prop) => { if (!RID.has(rule)) RID.set(rule, ++rid); return RID.get(rule) + '|' + prop; };
function setDecl(rule, prop, val, prio) { if (!val) rule.style.removeProperty(prop); else rule.style.setProperty(prop, val, prio || ''); }
function setRule(rule, prop, val, prioOverride) {
  const prio = prioOverride != null ? prioOverride : rule.style.getPropertyPriority(prop), from = rule.style.getPropertyValue(prop).trim();
  if (from === val) return false;
  setDecl(rule, prop, val, prio);
  if (val && !rule.style.getPropertyValue(prop)) { setDecl(rule, prop, from, prio); toast(`“${val}” não é um valor válido para ${prop}.`); return false; }
  const key = keyOf(rule, prop), rec = changes.get(key), before = rec ? rec.before : from;
  if (val === before) changes.delete(key); else changes.set(key, { rule, prop, before, after: val, prio });
  undoS.push({ rule, prop, prio, from, to: val, before }); redoS.length = 0;
  resetCache();
  return true;
}
function prep() { endPreview(); if (S.beforeMode) toggleBefore(true); }
function edit(el, prop, val) {
  if (!el) return toast('Selecione um elemento primeiro.');
  prep(); val = String(val).trim(); if (!val) return;
  const t = targetFor(el, prop);
  if (!setRule(t.rule, prop, val, t.scratch ? 'important' : null)) return;
  if (t.override) {
    resetCache();
    const now = findSource(el, prop);
    if (now.rule !== t.rule) {
      undo(true);
      const s = getScratch(el, t.src);
      setRule(s, prop, val, 'important');
      toast('O override desta tela perdeu na cascata (especificidade). A mudança ficou só no prompt.');
    }
  }
  S.lastEdit = { el, prop };
  render();
}
function nextValue(el, prop, dir) {
  const def = DEF[prop] || { step: 4 }, src = findSource(el, prop);
  const v = (src.rule || src.inline) ? src.value : src.computed;
  if (def.cols) {
    const m = v.match(/^repeat\((\d+),\s*(.+)\)$/);
    if (m) return `repeat(${clamp(+m[1] + dir, 1, 12)}, ${m[2]})`;
    return `repeat(${clamp(src.computed.split(/\s+/).length + dir, 1, 12)}, minmax(0, 1fr))`;
  }
  const sc = scaleOf(def);
  if (sc && sc.length) {
    const tk = tokenOf(v);
    let i = tk ? sc.findIndex(t => t.name === tk) : -1;
    if (i < 0 && (tk || /^[\d.]+(px|rem)$|^0$/.test(v))) {
      const px = toPx(src.computed) ?? toPx(v);
      if (px != null) { i = sc.reduce((b, t, k) => Math.abs(t.px - px) < Math.abs(sc[b].px - px) ? k : b, 0); if (sc[i].px === px || tk) return tokVal(sc[clamp(i + dir, 0, sc.length - 1)]); }
    }
    if (i >= 0) return tokVal(sc[clamp(i + dir, 0, sc.length - 1)]);
  }
  if (/^-?[\d.]+px$/.test(v) || v === '0') return Math.max(0, Math.round(pf(v) + dir * def.step)) + 'px';
  if (/^[\d.]+px$/.test(src.computed)) return Math.max(0, Math.round(pf(src.computed) + dir * def.step)) + 'px';
  return null;
}
function stepProp(el, prop, dir) {
  if (!el) return toast('Selecione um elemento primeiro.');
  const v = nextValue(el, prop, dir);
  if (v) edit(el, prop, v); else toast('Valor composto — edite direto no campo.');
}
let pv = null;
function startPreview(el, prop, val) {
  endPreview(); if (S.beforeMode) return;
  const t = targetFor(el, prop), prio = t.scratch ? 'important' : t.rule.style.getPropertyPriority(prop), from = t.rule.style.getPropertyValue(prop).trim(), fromPrio = t.rule.style.getPropertyPriority(prop);
  setDecl(t.rule, prop, val, prio);
  if (!t.rule.style.getPropertyValue(prop)) { setDecl(t.rule, prop, from, fromPrio); return; }
  pv = { rule: t.rule, prop, from, prio: fromPrio }; draw();
}
function endPreview() { if (!pv) return; setDecl(pv.rule, pv.prop, pv.from, pv.prio); pv = null; draw(); }
function replay(e, dir) {
  const v = dir < 0 ? e.from : e.to;
  setDecl(e.rule, e.prop, v, e.prio);
  const key = keyOf(e.rule, e.prop);
  if (v === e.before) changes.delete(key); else changes.set(key, { rule: e.rule, prop: e.prop, before: e.before, after: v, prio: e.prio });
  resetCache();
}
function undo(silent) { if (!silent) prep(); const e = undoS.pop(); if (!e) return; replay(e, -1); redoS.push(e); if (!silent) render(); }
function redo() { prep(); const e = redoS.pop(); if (!e) return; replay(e, 1); undoS.push(e); render(); }
function toggleBefore(silent) {
  endPreview(); S.beforeMode = !S.beforeMode;
  for (const c of changes.values()) setDecl(c.rule, c.prop, S.beforeMode ? c.before : c.after, c.prio);
  resetCache(); if (!silent) render();
}

/* ================= 6. Geometria ================= */
const mk = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b, width: Math.max(0, r - l), height: Math.max(0, b - t) });
const inR = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
const four = (cs, p, suf = '') => ({ top: pf(cs[p + 'Top' + suf]), right: pf(cs[p + 'Right' + suf]), bottom: pf(cs[p + 'Bottom' + suf]), left: pf(cs[p + 'Left' + suf]) });
function boxes(el) {
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
  const b = four(cs, 'border', 'Width'), p = four(cs, 'padding'), m = four(cs, 'margin');
  const pad = mk(r.left + b.left, r.top + b.top, r.right - b.right, r.bottom - b.bottom);
  const content = mk(pad.left + p.left, pad.top + p.top, pad.right - p.right, pad.bottom - p.bottom);
  const outer = mk(r.left - m.left, r.top - m.top, r.right + m.right, r.bottom + m.bottom);
  return { r, cs, b, p, m, pad, content, outer };
}
function gapRegions(el) {
  const cs = getComputedStyle(el); if (!isFG(cs)) return [];
  const rg = pf(cs.rowGap), cg = pf(cs.columnGap); if (!rg && !cg) return [];
  const K = realKids(el).slice(0, 80).map(k => ({ k, r: k.getBoundingClientRect() })), out = [];
  for (const A of K) {
    let right = null, below = null;
    for (const B of K) {
      if (A === B) continue;
      const vo = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top), ho = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
      const hg = B.r.left - A.r.right, vg = B.r.top - A.r.bottom;
      if (cg && vo > 0 && hg > 0.5 && (!right || hg < right.d)) right = { B, d: hg };
      if (rg && ho > 0 && vg > 0.5 && (!below || vg < below.d)) below = { B, d: vg };
    }
    if (right) out.push({ a: A.k, b: right.B.k, axis: 'col' });
    if (below) out.push({ a: A.k, b: below.B.k, axis: 'row' });
  }
  return out.map(g => ({ ...g, rect: gapRect(g) }));
}
function gapRect(g) {
  const A = g.a.getBoundingClientRect(), B = g.b.getBoundingClientRect();
  return g.axis === 'col' ? mk(A.right, Math.max(A.top, B.top), B.left, Math.min(A.bottom, B.bottom)) : mk(Math.max(A.left, B.left), A.bottom, Math.min(A.right, B.right), B.top);
}

/* ================= 7. "Por que tem espaço aqui?" ================= */
function pageElementAt(x, y) {
  const list = document.elementsFromPoint(x, y);
  return list.find(e => e !== host && e !== document.documentElement) || null;
}
function diagnose(x, y) {
  const el = pageElementAt(x, y); if (!inPage(el)) return null;
  for (const k of realKids(el)) {
    const B = boxes(k), r = B.r, m = B.m;
    if (m.bottom > 0 && inR(mk(r.left, r.bottom, r.right, r.bottom + m.bottom), x, y)) return { type: 'margin', el: k, side: 'bottom' };
    if (m.top > 0 && inR(mk(r.left, r.top - m.top, r.right, r.top), x, y)) return { type: 'margin', el: k, side: 'top' };
    if (m.left > 0 && inR(mk(r.left - m.left, r.top, r.left, r.bottom), x, y)) return { type: 'margin', el: k, side: 'left' };
    if (m.right > 0 && inR(mk(r.right, r.top, r.right + m.right, r.bottom), x, y)) return { type: 'margin', el: k, side: 'right' };
  }
  const B = boxes(el), c = B.content;
  if (!inR(c, x, y)) {
    const side = y < c.top ? 'top' : y > c.bottom ? 'bottom' : x < c.left ? 'left' : 'right';
    if (B.p[side] > 0) return { type: 'padding', el, side };
  }
  for (const g of gapRegions(el)) if (inR(g.rect, x, y)) return { type: 'gap', el, a: g.a, b: g.b, axis: g.axis };
  if (!el.children.length || /^(TD|TH|P|H[1-6]|SPAN|B|STRONG|A|BUTTON|LABEL)$/.test(el.tagName)) return { type: 'text', el };
  if (findSource(el, 'min-height').rule) return { type: 'minh', el };
  const par = el.parentElement;
  if (inPage(par)) { const pcs = getComputedStyle(par); if (isFG(pcs) && /normal|stretch/.test(pcs.alignItems)) return { type: 'stretch', el, parent: par }; }
  return { type: 'empty', el };
}
function regionOf(d) {
  const B = boxes(d.el), r = B.r;
  if (d.type === 'margin') { const m = B.m[d.side]; return { bottom: mk(r.left, r.bottom, r.right, r.bottom + m), top: mk(r.left, r.top - m, r.right, r.top), left: mk(r.left - m, r.top, r.left, r.bottom), right: mk(r.right, r.top, r.right + m, r.bottom) }[d.side]; }
  if (d.type === 'padding') { const P = B.pad, c = B.content; return { top: mk(P.left, P.top, P.right, c.top), bottom: mk(P.left, c.bottom, P.right, P.bottom), left: mk(P.left, c.top, c.left, c.bottom), right: mk(c.right, c.top, P.right, c.bottom) }[d.side]; }
  if (d.type === 'gap') return gapRect(d);
  if (d.type === 'text') return B.content;
  const ks = realKids(d.el); const last = ks.length ? Math.max(...ks.map(k => boxes(k).outer.bottom)) : B.content.top;
  return mk(B.content.left, Math.min(last, B.content.bottom), B.content.right, B.content.bottom);
}
const COLORS = { margin: 'var(--o-margin)', padding: 'var(--o-padding)', gap: 'var(--o-gap)', minh: 'var(--o-sobra)', stretch: 'var(--o-sobra)', empty: 'var(--o-sobra)', text: 'var(--o-text)' };
const SIDEWORD = { top: 'acima', bottom: 'abaixo', left: 'à esquerda', right: 'à direita' };
function explain(d) {
  const n = nm(d.el);
  if (d.type === 'margin') { const px = comp(d.el, 'margin-' + d.side); return { target: d.el, prop: 'margin-' + d.side, short: `${px} · margem`, big: `${px} de espaço ${SIDEWORD[d.side]} de ${esc(nameOf(d.el))}`, body: `É a margem externa (<code>margin-${d.side}</code>): ${n} empurra o que está ${SIDEWORD[d.side]} dele. Não é o pai, é o próprio elemento.` }; }
  if (d.type === 'padding') { const px = comp(d.el, 'padding-' + d.side); return { target: d.el, prop: 'padding', short: `${px} · respiro`, big: `${px} de respiro interno de ${esc(nameOf(d.el))}`, body: `É o <code>padding</code>: a borda de ${n} fica afastada do conteúdo. Mexer aqui muda os quatro lados; pra um lado só, use a caixa no Painel.` }; }
  if (d.type === 'gap') { const px = comp(d.el, d.axis === 'col' ? 'column-gap' : 'row-gap'); return { target: d.el, prop: 'gap', short: `${px} · entre itens`, big: `${px} de espaço entre os itens de ${esc(nameOf(d.el))}`, body: `É o <code>gap</code> do container, não dos filhos. Vale para todos os vãos de ${n} de uma vez.` }; }
  if (d.type === 'minh') { const mh = comp(d.el, 'min-height'), h = Math.round(regionOf(d).height); return { target: d.el, prop: 'min-height', short: `${h}px · sobra`, big: `Sobra: ${esc(nameOf(d.el))} tem altura mínima de ${mh}`, body: `O conteúdo acaba antes, mas <code>min-height</code> obriga ${n} a ter pelo menos ${mh}. Os ${h}px embaixo são essa sobra.` }; }
  if (d.type === 'stretch') return { target: d.parent, prop: 'align-items', short: 'esticado', big: `Sobra: ${esc(nameOf(d.el))} está sendo esticado`, body: `O pai (<b>${esc(nameOf(d.parent))}</b>) estica os filhos até a altura do mais alto (<code>align-items: stretch</code>). Troque para “Início” e cada um fica do tamanho do próprio conteúdo.` };
  if (d.type === 'text') { const lh = comp(d.el, 'line-height'); return { target: d.el, prop: 'font-size', short: 'conteúdo', big: `Isso é o conteúdo de ${esc(nameOf(d.el))}`, body: `Não é espaço sobrando: é a caixa do conteúdo. A altura vem da fonte e da altura da linha (<code>line-height: ${esc(lh)}</code>).` }; }
  return { target: d.el, prop: 'min-height', short: 'sem regra', big: 'Espaço sem regra clara', body: 'Nenhuma margem, respiro ou gap explica esse ponto. Selecione o elemento e confira largura e altura.' };
}
const sameDiag = (a, b) => a.type === b.type && a.el === b.el && a.side === b.side && a.a === b.a && a.b === b.b;

/* ================= 8. Overlay ================= */
function box(r, cls, color, label) {
  if (!r || r.width <= 0 || r.height <= 0) return;
  const d = document.createElement('div'); d.className = 'ov ' + cls;
  Object.assign(d.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
  if (color) d.style.setProperty('--c', color);
  if (label) { const t = document.createElement('span'); t.className = 'tag' + (r.top < 22 ? ' in' : ''); t.textContent = label; d.appendChild(t); }
  ov.appendChild(d);
}
function strips(o, s, cls) {
  box(mk(o.left, o.top, o.right, o.top + s.top), cls); box(mk(o.left, o.bottom - s.bottom, o.right, o.bottom), cls);
  box(mk(o.left, o.top + s.top, o.left + s.left, o.bottom - s.bottom), cls); box(mk(o.right - s.right, o.top + s.top, o.right, o.bottom - s.bottom), cls);
}
function seg(x1, y1, x2, y2) {
  const len = Math.round(Math.hypot(x2 - x1, y2 - y1)); if (len < 1) return;
  const d = document.createElement('div'), h = Math.abs(y1 - y2) < 0.5;
  d.className = 'ln ' + (h ? 'h' : 'v');
  Object.assign(d.style, h ? { left: Math.min(x1, x2) + 'px', top: y1 + 'px', width: len + 'px' } : { left: x1 + 'px', top: Math.min(y1, y2) + 'px', height: len + 'px' });
  const t = document.createElement('span'); t.className = 'tag'; const tl = tokenLabelFor(len);
  t.textContent = tl ? `${len} · sp-${tl}` : `${len}px`; d.appendChild(t); ov.appendChild(d);
}
function drawMeasure(a, b) {
  const A = a.getBoundingClientRect(), B = b.getBoundingClientRect();
  box(A, 'sel', null, nameOf(a)); box(B, 'hover');
  const inside = (o, i) => i.left >= o.left - .5 && i.right <= o.right + .5 && i.top >= o.top - .5 && i.bottom <= o.bottom + .5;
  if (inside(A, B) || inside(B, A)) {
    const O = inside(A, B) ? A : B, I = O === A ? B : A, cx = (I.left + I.right) / 2, cy = (I.top + I.bottom) / 2;
    seg(cx, O.top, cx, I.top); seg(cx, I.bottom, cx, O.bottom); seg(O.left, cy, I.left, cy); seg(I.right, cy, O.right, cy); return;
  }
  const vo = [Math.max(A.top, B.top), Math.min(A.bottom, B.bottom)], ho = [Math.max(A.left, B.left), Math.min(A.right, B.right)];
  const y = vo[1] > vo[0] ? (vo[0] + vo[1]) / 2 : (B.top + B.bottom) / 2, x = ho[1] > ho[0] ? (ho[0] + ho[1]) / 2 : (B.left + B.right) / 2;
  if (B.left >= A.right) seg(A.right, y, B.left, y); else if (A.left >= B.right) seg(B.right, y, A.left, y);
  if (B.top >= A.bottom) seg(x, A.bottom, x, B.top); else if (A.top >= B.bottom) seg(x, B.bottom, x, A.top);
}
function drawDiag(d) { const e = explain(d), c = COLORS[d.type]; box(e.target.getBoundingClientRect(), 'culprit', c); box(regionOf(d), 'd', c, e.short); }
let rafId = 0;
function draw() { if (rafId) return; rafId = requestAnimationFrame(() => { rafId = 0; drawNow(); }); }
function drawNow() {
  if (!ov) return;
  ov.innerHTML = ''; ov.classList.toggle('grid', S.grid);
  if (!S.open) return;
  resetCache();
  if (S.affected && Date.now() < S.affected.until) matchesOf(S.affected.sel).slice(0, 200).forEach(el => box(el.getBoundingClientRect(), 'aff'));
  if (S.hoverIssue && S.hoverIssue.isConnected) box(S.hoverIssue.getBoundingClientRect(), 'issue', null, nameOf(S.hoverIssue));
  if (S.mode === 'use') return;
  if (S.mode === 'space') {
    if (S.pinned && S.pinned.el.isConnected) drawDiag(S.pinned);
    if (S.hoverDiag && !(S.pinned && sameDiag(S.pinned, S.hoverDiag))) drawDiag(S.hoverDiag);
    return;
  }
  if (S.mode === 'measure' || S.altDown) {
    if (S.selected && S.hoverEl && S.hoverEl !== S.selected) return drawMeasure(S.selected, S.hoverEl);
    if (S.selected) box(S.selected.getBoundingClientRect(), 'sel', null, nameOf(S.selected) + ' (âncora)');
    else if (S.hoverEl) box(S.hoverEl.getBoundingClientRect(), 'hover');
    return;
  }
  if (S.selected && S.selected.isConnected) {
    const B = boxes(S.selected);
    strips(B.outer, B.m, 'm'); strips(B.pad, B.p, 'p');
    for (const g of gapRegions(S.selected)) box(g.rect, 'g');
    box(B.r, 'sel', null, `${nameOf(S.selected)}  ${Math.round(B.r.width)} × ${Math.round(B.r.height)}`);
  }
  if (S.hoverEl && S.hoverEl !== S.selected) { const r = S.hoverEl.getBoundingClientRect(); box(r, 'hover', null, `${nameOf(S.hoverEl)} · ${Math.round(r.width)}×${Math.round(r.height)}`); }
}

/* ================= 9. Problemas (raio-x da tela atual) ================= */
function scan() {
  resetCache();
  const out = [], W = window.innerWidth;
  const all = [...document.body.querySelectorAll('*')].filter(e => e !== host && e.getClientRects().length).slice(0, 4000);
  const over = all.filter(el => {
    if (/^(TR|TBODY|THEAD|TD|TH|B|SPAN|SVG|PATH|G|STRONG|EM|I|SMALL)$/i.test(el.tagName)) return false;
    const cs = getComputedStyle(el); if (/auto|scroll/.test(cs.overflowX)) return false;
    return el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0;
  });
  over.filter(el => !over.some(o => o !== el && el.contains(o))).slice(0, 8).forEach(el => {
    const cs = getComputedStyle(el), px = el.scrollWidth - el.clientWidth;
    if (cs.overflowX === 'hidden') { out.push({ sev: 'media', title: 'Conteúdo cortado', el, text: `${nm(el)} esconde ${px}px de conteúdo em ${W}px (<code>overflow: hidden</code>).`, fix: { label: 'Deixar rolar', run: () => edit(el, 'overflow-x', 'auto') } }); return; }
    const limit = el.getBoundingClientRect().width + 1;
    const wide = [...el.querySelectorAll('*')].filter(d => !/^(TR|TBODY|THEAD|TD|TH|B|SPAN)$/.test(d.tagName) && d.getBoundingClientRect().width > limit);
    const leaves = wide.filter(d => !wide.some(o => o !== d && d.contains(o)));
    const deep = leaves.find(d => /^(TABLE|IMG|PRE|CANVAS)$/i.test(d.tagName)) || leaves.sort((a, b) => b.scrollWidth - a.scrollWidth)[0];
    const fixEl = deep && deep.parentElement !== el && inPage(deep.parentElement) ? deep.parentElement : (deep || el);
    out.push({ sev: 'alta', title: 'Conteúdo vazando', el: fixEl, text: `Em ${W}px, ${deep ? `${nm(deep)} é mais larga que o espaço e empurra ` : ''}${nm(fixEl)} ${px}px pra fora de ${nm(el)}.`, fix: { label: `Deixar ${nameOf(fixEl)} rolar por dentro`, run: () => edit(fixEl, 'overflow-x', 'auto') } });
  });
  all.forEach(el => {
    const cs = getComputedStyle(el);
    if (!isFlex(cs) || cs.flexWrap === 'nowrap' || cs.flexDirection.startsWith('column')) return;
    const rs = realKids(el).map(k => k.getBoundingClientRect()).sort((a, b) => a.top - b.top);
    let lines = 0, lb = -Infinity;
    for (const r of rs) { if (r.top >= lb - 0.5) { lines++; lb = r.bottom; } else lb = Math.max(lb, r.bottom); }
    if (lines > 1) out.push({ sev: 'media', title: 'Quebrou em mais de uma linha', el, text: `${nm(el)} quebrou em ${lines} linhas em ${W}px. Se não for intencional, diminua o espaço entre os itens.`, fix: { label: 'Menos espaço entre os itens', run: () => stepProp(el, 'gap', -1) } });
  });
  const minF = CFG.minFontPx || 11;
  let small = 0;
  for (const el of all) {
    if (small >= 6) break;
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const fs = pf(getComputedStyle(el).fontSize);
    if (fs && fs < minF) { small++; out.push({ sev: 'media', title: 'Texto pequeno demais', el, text: `${nm(el)} está com ${fs}px. Abaixo de ${minF}px fica difícil de ler.`, fix: { label: `Voltar para ${Math.max(minF, 12)}px`, run: () => edit(el, 'font-size', Math.max(minF, 12) + 'px') } }); }
  }
  const sp = SPACE.filter(t => t.name !== '0');
  if (sp.length) {
    const nearest = px => sp.reduce((a, b) => Math.abs(b.px - px) < Math.abs(a.px - px) ? b : a);
    let n = 0;
    for (const [rule, info] of ruleInfo) {
      if (n >= 30) break;
      if (!info.writable || !info.line || !info.decls) continue;
      for (const prop of Object.keys(info.decls).filter(p => /^(padding|margin|gap|row-gap|column-gap)(-|$)/.test(p))) {
        const v = info.decls[prop].value, parts = v.split(/\s+/), isPx = p => /^\d+(\.\d+)?px$/.test(p) && pf(p) !== 0;
        const bad = parts.filter(p => isPx(p) && !sp.some(t => t.px === pf(p)));
        if (!bad.length) continue;
        const el = matchesOf(rule.selectorText)[0]; if (!el) continue;
        const fix = parts.map(p => isPx(p) ? `var(${nearest(pf(p)).name})` : p).join(' ');
        n++;
        out.push({ sev: 'baixa', title: 'Fora da escala de espaço', el, text: `<code>${esc(rule.selectorText)}</code> usa <code>${prop}: ${esc(v)}</code> (${esc(info.file)}:${info.decls[prop].line}). ${bad.join(', ')} não existe na fundação.`, fix: { label: `Trocar por ${fix}${info.kind === 'global' ? ' (global)' : ''}`, run: () => { prep(); if (setRule(rule, prop, fix)) render(); } } });
      }
    }
  }
  const order = { alta: 0, media: 1, baixa: 2 };
  return out.sort((a, b) => order[a.sev] - order[b.sev]);
}

/* ================= 10. Painel ================= */
const T = el => S.targets.push(el) - 1;
function locOf(src) {
  const i = src.info;
  if (i.kind === 'scratch') return 'só no prompt';
  if (i.isNew) return `${i.file} · regra nova`;
  const d = i.decls && i.decls[src.prop];
  return i.line ? `${i.file}:${d ? d.line : i.line}${d && i.kind === 'built' ? ':' + d.column : ''}` : i.file;
}
function condLabel(c) { const m = c && c.match(/max-width:\s*(\d+)px/); const n = c && c.match(/min-width:\s*(\d+)px/); return m ? `só em telas ≤ ${m[1]}px` : n ? `só em telas ≥ ${n[1]}px` : c; }
const KIND = { page: '', global: '<span class="badge warn">global</span>', protected: '<span class="badge lock">protegido</span>', built: '<span class="badge lock">gerado pelo Vite</span>', inline: '<span class="badge lock">inline no HTML</span>', scratch: '<span class="badge">só prompt</span>', unknown: '<span class="badge lock">?</span>' };
function rowHTML(t, def, src) {
  const i = T(t), val = src.rule || src.inline ? src.value : '', id = `in-${def.prop}-${i}`;
  const flash = S.lastEdit && S.lastEdit.el === t && S.lastEdit.prop === def.prop ? ' flash' : '';
  let ctrl = '';
  if (def.opts) {
    const cur = src.computed, has = def.opts.some(([v]) => v === cur);
    ctrl = `<select id="${id}" data-t="${i}" data-prop="${def.prop}" aria-label="${esc(def.label)}">${has ? '' : `<option value="${esc(cur)}" selected>${esc(cur)}</option>`}${def.opts.map(([v, l]) => `<option value="${v}"${cur === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  } else {
    const sc = scaleOf(def);
    if (sc && sc.length) ctrl += `<div class="tokens">${sc.map(tk => `<button data-act="tok" data-t="${i}" data-prop="${def.prop}" data-val="${tokVal(tk)}" aria-pressed="${val === tokVal(tk)}" title="${tk.name}">${esc(tk.label)}<small>${tk.px}</small></button>`).join('')}</div>`;
    const stepOk = def.step || def.cols;
    ctrl += `<div class="step">${stepOk ? `<button data-act="step" data-dir="-1" data-t="${i}" data-prop="${def.prop}" aria-label="Diminuir">−</button>` : ''}<input id="${id}" data-t="${i}" data-prop="${def.prop}" value="${esc(val || src.computed)}" aria-label="${esc(def.label)}" spellcheck="false">${stepOk ? `<button data-act="step" data-dir="1" data-t="${i}" data-prop="${def.prop}" aria-label="Aumentar">+</button>` : ''}</div>`;
  }
  let meta = '';
  if (src.rule) {
    const k = src.info.kind;
    meta += `<div class="meta"><code>${def.prop}</code>·<code>${esc(src.selector)}</code>·<span class="mono">${esc(locOf(src))}</span>${src.info.isNew && k === 'page' ? '<span class="badge">override desta tela</span>' : KIND[k] || ''}${src.info.cond ? `<span class="badge">${esc(condLabel(src.info.cond))}</span>` : ''}${src.important ? '<span class="badge lock">!important</span>' : ''}</div>`;
    const tk = tokenOf(src.srcValue || src.value);
    if (tk) meta += `<div class="meta">token <code>${tk}</code> = ${esc(rootVar(tk))}${tokenDecl[tk] ? ` · <span class="mono">${esc(tokenDecl[tk].file)}:${tokenDecl[tk].line}</span>` : ''}</div>`;
    if (src.losers.length) meta += `<div class="meta">vence de ${src.losers.map(l => `<code>${esc(l.rule.selectorText)}</code> <span class="mono">(${esc(l.info.file)}${l.info.line ? ':' + ((l.info.decls[def.prop] || {}).line || l.info.line) : ''})</span>`).join(', ')}</div>`;
    let warn;
    if (k === 'protected') warn = 'Arquivo protegido: editar cria um override no CSS desta tela.';
    else if (k === 'built') warn = `CSS gerado pelo Vite (${esc(src.info.reason || '')}). Editar aqui vira só prompt — a correção vai na fonte React.`;
    else if (k === 'inline') warn = 'Estilo dentro do HTML: editar vira só prompt.';
    else if (k === 'global' && S.scope === 'page') warn = 'Regra global: editar cria um override só nesta tela.';
    else warn = `Afeta ${src.affects} elemento${src.affects === 1 ? '' : 's'} nesta tela.`;
    meta += `<div class="meta">${warn}${src.affects > 1 ? ` <button class="link" data-act="aff" data-sel="${esc(src.selector)}">mostrar os ${src.affects}</button>` : ''}</div>`;
  } else if (src.inline) {
    meta += `<div class="meta">Vem do atributo <code>style=""</code> no HTML. Editar vira override desta tela ou só prompt.</div>`;
  } else {
    const os = overrideSelector(t);
    meta += `<div class="meta">Sem regra no seu CSS (padrão do navegador ou herdado). ${os && pageFile() ? `Editar cria <code>${esc(os)}</code> em ${esc(pageFile())}.` : 'Editar vira só prompt.'}</div>`;
  }
  return `<div class="row${flash}"><div class="row-head"><div class="label">${esc(def.label)}${def.hint ? `<small>${esc(def.hint)}</small>` : ''}</div><span class="computed">${esc(src.computed)}</span></div>${ctrl}${meta}</div>`;
}
function boxModelHTML(el) {
  const cs = getComputedStyle(el), r = el.getBoundingClientRect();
  const inp = prop => `<input class="${prop.split('-')[1]}" id="bm-${prop}" data-t="${T(el)}" data-prop="${prop}" data-bm="1" value="${Math.round(pf(cs.getPropertyValue(prop)))}" aria-label="${esc(DEF[prop].label)}" title="${esc(DEF[prop].label)} (${prop})" inputmode="numeric">`;
  return `<div class="bm"><div class="bm-l m"><span class="bm-lab">margem</span>${inp('margin-top')}${inp('margin-left')}<div class="mid"><div class="bm-l p"><span class="bm-lab">respiro</span>${inp('padding-top')}${inp('padding-left')}<div class="mid bm-c">${Math.round(r.width)} × ${Math.round(r.height)}</div>${inp('padding-right')}${inp('padding-bottom')}</div></div>${inp('margin-right')}${inp('margin-bottom')}</div></div>`;
}
function propsPanel() {
  if (S.mode === 'use') return `<div class="empty"><b>Modo “usar a página”.</b><span>Os cliques vão pra página normalmente — abra abas, gavetas, filtros. Depois volte pra <b>Selecionar</b> (tecla <kbd>1</kbd>).</span></div>`;
  if (S.mode === 'space') {
    if (!S.pinned || !S.pinned.el.isConnected) return `<div class="empty"><b>Clique em qualquer espaço vazio da página.</b><span>O espaço fica pintado com a cor da causa, e aqui aparece qual propriedade, de qual elemento, em qual arquivo:linha está criando ele.</span></div>`;
    const e = explain(S.pinned), src = findSource(e.target, e.prop), def = DEF[e.prop];
    let h = `<div class="diag" style="--c:${COLORS[S.pinned.type]}"><div class="eyebrow">Esse espaço é</div><div class="diag-big">${e.big}</div><p>${e.body}</p></div>`;
    if (def) h += rowHTML(e.target, def, src);
    return h + `<button class="btn" data-act="goto" data-t="${T(e.target)}">Ver todas as propriedades de ${esc(nameOf(e.target))} →</button>`;
  }
  if (S.mode === 'measure') return `<div class="empty"><b>Medir distâncias</b><span>1. Clique num elemento (vira a âncora).<br>2. Passe o mouse em outro: aparecem as distâncias em px e o token quando bate com a escala (ex.: <code>24 · sp-6</code>).</span><span>Atalho: no modo Selecionar, segure <kbd>Alt</kbd>.</span>${S.selected ? `<span>Âncora: <b>${esc(nameOf(S.selected))}</b></span>` : ''}</div>`;
  const el = S.selected;
  if (!el || !el.isConnected) return `<div class="empty"><b>Passe o mouse na página e clique em algo.</b><span>Ou aperte <kbd>Ctrl K</kbd> e escreva o que quer, do seu jeito.</span><span>Pra clicar em abas, gavetas e botões da página, use o modo <b>Usar</b> (tecla <kbd>0</kbd>).</span></div>`;
  const cs = getComputedStyle(el), chain = [];
  for (let n = el; inPage(n) && n !== document.documentElement; n = n.parentElement) chain.unshift(n);
  const short = chain.length > 6 ? [chain[0], null, ...chain.slice(-5)] : chain;
  let h = `<div class="el"><div class="el-name">${esc(nameOf(el))}</div><div class="el-sub"><code>${esc(selOf(el))}</code><span class="mono">${Math.round(el.getBoundingClientRect().width)} × ${Math.round(el.getBoundingClientRect().height)}</span><span>${isGrid(cs) ? 'grade' : isFlex(cs) ? 'flex' : cs.display}</span></div>`;
  h += `<nav class="crumbs">${short.map((n, k) => n ? `${k ? '<span>›</span>' : ''}<button data-act="sel" data-t="${T(n)}" title="${esc(selOf(n))}"${n === el ? ' aria-current="true"' : ''}>${esc(nameOf(n))}</button>` : '<span>› …</span>').join('')}</nav>`;
  h += `<div class="actions">${el !== document.body ? `<button class="btn sm" data-act="sel" data-t="${T(el.parentElement)}">↑ Selecionar o pai</button>` : ''}<button class="btn sm" data-act="copycss">Copiar CSS</button><button class="btn sm" data-act="copysel">Copiar seletor</button></div></div>`;
  h += boxModelHTML(el);
  const rows = [], more = [];
  for (const def of DEFS) {
    if (def.when && !def.when(cs)) continue;
    const src = findSource(el, def.prop);
    (src.rule || src.inline ? rows : more).push([def, src]);
  }
  if (rows.some(([, s]) => s.rule && s.info.kind === 'global')) {
    h += `<div class="scope" role="radiogroup"><label><input type="radio" name="scope" id="scope-page" value="page"${S.scope === 'page' ? ' checked' : ''}><span>Só nesta tela<small>Override em ${esc(pageFile() || '(esta tela não tem CSS próprio — vira prompt)')}. Padrão seguro.</small></span></label><label><input type="radio" name="scope" id="scope-global" value="global"${S.scope === 'global' ? ' checked' : ''}><span>Todas as telas<small>Edita a regra global direto.</small></span></label></div>`;
  }
  let g = '';
  for (const [def, src] of rows) { if (def.g !== g) { g = def.g; h += `<div class="group">${g}</div>`; } h += rowHTML(el, def, src); }
  if (!rows.length) h += `<div class="empty">Nenhuma propriedade deste elemento vem de uma regra. Tente o pai.</div>`;
  if (more.length) h += `<details class="more"><summary>Mais ${more.length} propriedades sem regra própria</summary>${more.map(([d, s]) => rowHTML(el, d, s)).join('')}</details>`;
  return h;
}
function treePanel() {
  const el = S.selected && S.selected.isConnected ? S.selected : document.querySelector('main') || document.body;
  const chain = []; for (let n = el.parentElement; inPage(n) && n !== document.documentElement; n = n.parentElement) chain.unshift(n);
  const item = (n, extra = '') => { const i = T(n), c = mainClass(n); return `<button data-act="sel" data-t="${i}" data-hov="${i}" class="${n === S.selected ? 'on' : ''}${extra}"><span>${esc(nameOf(n))}</span><code>${c ? '.' + esc(c) : esc(n.tagName.toLowerCase())}${n.id ? '#' + esc(n.id) : ''}</code></button>`; };
  const kids = n => { const k = realKids(n); const cut = k.length > 12; return `<ul>${k.slice(0, 12).map(c => `<li>${item(c)}${realKids(c).length ? `<ul>${realKids(c).slice(0, 6).map(g => `<li>${item(g)}</li>`).join('')}${realKids(c).length > 6 ? `<li class="more-rows">+ ${realKids(c).length - 6}</li>` : ''}</ul>` : ''}</li>`).join('')}${cut ? `<li class="more-rows">+ ${k.length - 12} itens</li>` : ''}</ul>`; };
  const par = el.parentElement && inPage(el.parentElement) ? el.parentElement : null;
  const sibs = par ? realKids(par) : [el];
  return `<div class="empty"><span>Vizinhança do elemento selecionado. <kbd>↑</kbd> pai · <kbd>↓</kbd> filho · <kbd>←</kbd><kbd>→</kbd> irmãos.</span></div>
  <nav class="tree"><div class="chain">${chain.slice(-4).map(n => item(n, ' anc')).join('')}</div><ul>${sibs.slice(0, 20).map(s => `<li>${item(s)}${s === el ? kids(el) : ''}</li>`).join('')}${sibs.length > 20 ? `<li class="more-rows">+ ${sibs.length - 20} irmãos</li>` : ''}</ul></nav>`;
}
function issuesPanel() {
  if (!S.problems.length) return `<div class="ok">Nenhum problema em ${window.innerWidth}px. Teste outras larguras em <b>Comparar larguras</b> ou redimensionando a janela.</div>`;
  const lab = { alta: 'alta', media: 'média', baixa: 'baixa' };
  const card = (p, i) => `<div class="issue" data-issue="${i}"><div class="issue-h"><span class="sev ${p.sev}">${lab[p.sev]}</span>${esc(p.title)}</div><p>${p.text}</p><div class="actions">${p.el ? `<button class="btn sm" data-act="sel" data-t="${T(p.el)}">Selecionar</button>` : ''}${p.fix ? `<button class="btn sm pri" data-act="fix" data-i="${i}">${esc(p.fix.label)}</button>` : ''}</div></div>`;
  const idx = S.problems.map((p, i) => [p, i]), top = idx.filter(([p]) => p.sev !== 'baixa'), low = idx.filter(([p]) => p.sev === 'baixa');
  let h = `<div class="empty"><span>Checagem em <b>${window.innerWidth}px</b>. Passe o mouse pra ver onde é. <button class="link" data-act="rescan">Checar de novo</button></span></div>`;
  h += top.length ? top.map(([p, i]) => card(p, i)).join('') : `<div class="ok">Nada quebrando em ${window.innerWidth}px.</div>`;
  if (low.length) h += `<details class="more"><summary>${low.length} valores fora da escala de espaço (não quebram nada, mas fogem da fundação)</summary>${low.map(([p, i]) => card(p, i)).join('')}</details>`;
  return h;
}
function changesPanel() {
  if (!changes.size) return `<div class="ok">Nenhuma alteração pendente. Tudo que você mexer aparece aqui, e dá pra reverter um por um antes de gravar.</div>`;
  let h = '';
  for (const { rule, info, list } of groupChanges()) {
    h += `<div class="chg-file">${esc(info.file)}${info.kind === 'scratch' ? ' · só prompt' : info.isNew ? ' · override novo' : ` · linha ${info.line}`}</div>`;
    for (const c of list) {
      const el = matchesOf(rule.selectorText)[0], sb = srcBefore(c);
      h += `<div class="chg"><div class="chg-main"><code>${esc(rule.selectorText)}</code><span class="mono">${c.prop}: ${sb ? `<span class="del">${esc(sb)}</span> → ` : ''}<span class="add">${esc(c.after || '(remover)')}</span></span></div>${el ? `<button class="btn sm" data-act="sel" data-t="${T(el)}">Ver</button>` : ''}<button class="btn sm" data-act="revert" data-k="${keyOf(c.rule, c.prop)}">Reverter</button></div>`;
    }
  }
  return h;
}
function renderTabs() {
  root.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === S.tab));
  const ci = root.getElementById('cnt-issues'); ci.textContent = S.problems.length; ci.classList.toggle('hot', S.problems.some(p => p.sev !== 'baixa'));
  root.getElementById('cnt-changes').textContent = changes.size;
}
function renderBody() {
  S.targets = []; resetCache();
  const b = root.getElementById('body');
  const st = b.scrollTop;
  b.innerHTML = S.tab === 'tree' ? treePanel() : S.tab === 'issues' ? issuesPanel() : S.tab === 'changes' ? changesPanel() : propsPanel();
  b.scrollTop = st;
  S.lastEdit = null;
}
function renderFooter() {
  const n = changes.size, w = [...changes.values()].filter(c => ruleInfo.get(c.rule).writable).length;
  root.getElementById('foot-count').innerHTML = n ? `<b>${n}</b> pendente${n === 1 ? '' : 's'}${n - w ? ` · ${n - w} só prompt` : ''}` : 'Nada pendente';
  root.getElementById('undo').disabled = !undoS.length; root.getElementById('redo').disabled = !redoS.length;
  for (const id of ['before', 'diff', 'prompt']) root.getElementById(id).disabled = !n && !S.beforeMode;
  root.getElementById('apply').disabled = !w || S.beforeMode;
  root.getElementById('before').textContent = S.beforeMode ? 'Ver depois' : 'Ver antes';
  root.getElementById('before').classList.toggle('on', S.beforeMode);
}
function render() {
  if (!panel) return;
  host.classList.toggle('closed', !S.open);
  panel.hidden = !S.open; launcher.hidden = S.open;
  panel.classList.toggle('left', S.dock === 'left');
  root.querySelectorAll('#modes button').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === S.mode));
  if (S.open) { renderTabs(); renderBody(); renderFooter(); }
  draw();
  if (S.open) rescanSoon();
}
let scanTimer = 0;
function rescanSoon() { clearTimeout(scanTimer); scanTimer = setTimeout(() => { if (!S.open) return; S.problems = scan(); renderTabs(); if (S.tab === 'issues') renderBody(); }, 400); }

/* ================= 11. Diff, prompt e gravação ================= */
function groupChanges() {
  const by = new Map();
  for (const c of changes.values()) { if (!by.has(c.rule)) by.set(c.rule, []); by.get(c.rule).push(c); }
  return [...by].map(([rule, list]) => ({ rule, info: ruleInfo.get(rule), list }));
}
const srcBefore = c => { const i = ruleInfo.get(c.rule); return (i && i.decls && i.decls[c.prop] && i.decls[c.prop].value) || c.before; };
function buildPatch() {
  const files = new Map();
  for (const { rule, info, list } of groupChanges()) {
    if (!info.writable) continue;
    if (!files.has(info.file)) files.set(info.file, []);
    const P = files.get(info.file);
    if (info.isNew) P.push({ op: 'new', selector: info.selectorSrc || rule.selectorText, decls: list.filter(c => c.after).map(c => ({ prop: c.prop, value: c.after + (c.prio ? ' !important' : '') })) });
    else for (const c of list) P.push({ op: 'set', line: info.line, column: info.column, selector: info.selectorSrc, prop: c.prop, value: c.after });
  }
  return [...files].map(([file, patches]) => ({ file, patches: patches.filter(p => p.op !== 'new' || p.decls.length) })).filter(f => f.patches.length);
}
async function apply(dry) {
  const files = buildPatch();
  if (!files.length) return toast('Nada gravável — as alterações pendentes são só de prompt.');
  if (S.beforeMode) toggleBefore(true);
  try {
    const res = await postJSON('/__vfdev/patch', { dryRun: dry, files });
    if (dry) return res;
    const done = new Set(files.map(f => f.file));
    for (const [k, c] of [...changes]) if (ruleInfo.get(c.rule).writable && done.has(ruleInfo.get(c.rule).file)) changes.delete(k);
    undoS.length = 0; redoS.length = 0;
    for (const f of done) await reindexFile(f);
    overrides.clear();
    toast(`Gravado: ${[...done].join(', ')}. Confira com git diff.`);
    render(); rescanSoon();
  } catch (e) { toast('Não gravou: ' + e.message, 6000); }
}
function promptText() {
  const L = [`## Ajuste visual — Portal/${htmlFile()}`, '', 'Restrições:', '- Alterar SOMENTE o que está listado abaixo. Nada além.', '- Não criar classes, arquivos ou seletores novos além dos listados.', '- Não tocar em JS, backend, IDs, data-attributes ou textos.', `- Não tocar em ${(CFG.protectedFiles || []).join(' nem ')} (protegidos).`, '', 'Alterações:'];
  let k = 0;
  for (const { rule, info, list } of groupChanges()) {
    k++;
    if (info.kind === 'scratch') {
      L.push(`${k}. Fonte provável: \`${info.file}\` — garantir para \`${info.selectorSrc}\` (sem !important, sem seletor novo se já existir um equivalente):`);
      for (const c of list) L.push(`   - \`${c.prop}: ${c.after};\``);
    } else if (info.isNew) {
      L.push(`${k}. \`Portal/${info.file}\` — adicionar no FIM do arquivo:`, '```css', `${info.selectorSrc} {`, ...list.map(c => `  ${c.prop}: ${c.after};`), '}', '```');
    } else {
      L.push(`${k}. \`Portal/${info.file}\` linha ${info.line} — \`${info.selectorSrc}\`${info.cond ? ` (dentro de \`${info.cond}\`)` : ''}`);
      for (const c of list) { const sb = srcBefore(c); L.push(sb ? `   - antes: \`${c.prop}: ${sb};\`` : '   - antes: (não existe)', c.after ? `   - depois: \`${c.prop}: ${c.after};\`` : '   - depois: remover a declaração'); }
    }
  }
  L.push('', `Critério de aceite (janela com ${window.innerWidth}px de largura):`);
  for (const c of changes.values()) { const el = matchesOf(c.rule.selectorText)[0]; if (el) L.push(`- \`${c.rule.selectorText}\`: \`getComputedStyle(el).${c.prop.replace(/-([a-z])/g, (_, x) => x.toUpperCase())}\` = \`${comp(el, c.prop)}\``); }
  L.push('- Nenhuma outra linha alterada no diff.');
  return L.join('\n');
}
function cssOf(el) {
  const cs = getComputedStyle(el), lines = [];
  for (const def of DEFS) { if (def.when && !def.when(cs)) continue; const s = findSource(el, def.prop); if (s.rule) lines.push(`/* ${locOf(s)} */ ${s.selector} { ${def.prop}: ${s.value}; }`); }
  return lines.join('\n') || '/* nenhuma regra própria */';
}
async function openDrawer(tab) {
  const d = root.getElementById('drawer'), body = root.getElementById('dbody');
  d.hidden = false; d.dataset.tab = tab;
  root.querySelectorAll('#dtabs button').forEach(b => b.setAttribute('aria-pressed', b.dataset.tab === tab));
  if (tab === 'prompt') { body.innerHTML = `<p class="note">Formato cirúrgico: arquivo, linha, antes/depois e critério medível.</p><pre class="prompt" id="ptext">${esc(promptText())}</pre>`; return; }
  body.innerHTML = '<p class="note">Calculando o diff real no disco…</p>';
  const files = buildPatch(), prompts = groupChanges().filter(g => !g.info.writable);
  let h = '';
  if (files.length) {
    try {
      const res = await postJSON('/__vfdev/patch', { dryRun: true, files });
      h += '<p class="note">Diff exato que será gravado (calculado pelo servidor, sem salvar ainda).</p>';
      for (const r of res.results) for (const c of r.changes) {
        h += `<div class="diff"><div class="diff-h"><b>Portal/${esc(r.file)}</b> · ${c.kind === 'new' ? 'fim do arquivo · override desta tela' : `linha ${c.line}`}</div>`;
        if (c.before) h += c.before.split('\n').map(l => `<div class="l del">- ${esc(l)}</div>`).join('');
        h += c.after.split('\n').map(l => `<div class="l add">+ ${esc(l)}</div>`).join('') + '</div>';
      }
    } catch (e) { h += `<p class="note err">O servidor recusou: ${esc(e.message)}</p>`; }
  }
  if (prompts.length) h += `<p class="note">Estas ficam só no prompt (CSS gerado pelo Vite, inline ou sem arquivo próprio da tela): ${prompts.map(g => `<code>${esc(g.rule.selectorText)}</code>`).join(', ')}</p>`;
  body.innerHTML = h || '<p class="note">Nada pendente.</p>';
}
function copy(text, what = 'Copiado.') {
  const fail = () => { openDrawer('prompt').then(() => { const p = root.getElementById('ptext'); p.textContent = text; const s = document.getSelection(), r = document.createRange(); r.selectNodeContents(p); s.removeAllRanges(); s.addRange(r); }); toast('Cópia bloqueada — o texto está selecionado, use Ctrl+C.'); };
  try { navigator.clipboard.writeText(text).then(() => toast(what), fail); } catch (e) { fail(); }
}
let tt; function toast(msg, ms = 3000) { const t = root.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, ms); }

/* ================= 12. Comparar larguras (iframes da mesma página, sem o editor) ================= */
function pendingCSS() {
  return [...changes.values()].filter(c => c.after).map(c => {
    const i = ruleInfo.get(c.rule), body = `${c.rule.selectorText} { ${c.prop}: ${c.after}${c.prio ? ' !important' : ''}; }`;
    const m = i && i.cond && i.cond.match(/^@media (.+)$/);
    return m ? `@media ${m[1]} { ${body} }` : body;
  }).join('\n');
}
function openCompare() {
  const m = root.getElementById('cmp'); m.hidden = false;
  const u = new URL(location.href); u.searchParams.set('vfdev', 'off');
  const widths = [390, 768, 1280];
  const wrap = root.getElementById('cmp-frames');
  const avail = wrap.clientWidth - 24 * (widths.length - 1), total = widths.reduce((a, b) => a + b, 0), s = Math.min(1, avail / total);
  const hgt = wrap.clientHeight - 30;
  wrap.innerHTML = widths.map(w => `<div class="cmp-col"><div class="cap"><b>${w}px</b> · ${Math.round(s * 100)}%</div><div class="cmp-box" style="width:${w * s}px;height:${hgt}px"><iframe src="${esc(u.href)}" style="width:${w}px;height:${hgt / s}px;transform:scale(${s})" title="${w}px"></iframe></div></div>`).join('');
  wrap.querySelectorAll('iframe').forEach(f => f.addEventListener('load', () => { try { const st = f.contentDocument.createElement('style'); st.id = 'vfdev-pending'; st.textContent = pendingCSS(); f.contentDocument.head.appendChild(st); } catch (e) {} }));
}

/* ================= 13. Paleta de comandos ================= */
const CMDS = [
  { s: 'Espaço', l: 'Menos respiro interno', a: 'menos espaco compacto apertar enxugar respiro padding diminuir espaco dentro', tgt: el => el, run: el => stepProp(el, 'padding', -1), k: '[' },
  { s: 'Espaço', l: 'Mais respiro interno', a: 'mais espaco respirar folga padding aumentar espaco dentro', tgt: el => el, run: el => stepProp(el, 'padding', 1), k: ']' },
  { s: 'Espaço', l: 'Aproximar dos vizinhos (menos espaço entre este e os do lado)', a: 'juntar aproximar colar menos espaco entre gap vizinhos cards irmaos', tgt: el => el.parentElement && isFG(getComputedStyle(el.parentElement)) ? el.parentElement : null, run: el => stepProp(el, 'gap', -1) },
  { s: 'Espaço', l: 'Afastar dos vizinhos (mais espaço entre este e os do lado)', a: 'separar afastar mais espaco entre gap vizinhos cards irmaos', tgt: el => el.parentElement && isFG(getComputedStyle(el.parentElement)) ? el.parentElement : null, run: el => stepProp(el, 'gap', 1) },
  { s: 'Espaço', l: 'Juntar o que tem dentro (menos espaço entre os filhos)', a: 'juntar aproximar colar menos espaco entre gap dentro filhos itens', tgt: el => isFG(getComputedStyle(el)) ? el : null, run: el => stepProp(el, 'gap', -1) },
  { s: 'Espaço', l: 'Separar o que tem dentro (mais espaço entre os filhos)', a: 'separar afastar mais espaco entre gap dentro filhos itens', tgt: el => isFG(getComputedStyle(el)) ? el : null, run: el => stepProp(el, 'gap', 1) },
  { s: 'Espaço', l: 'Aproximar do que vem embaixo', a: 'aproximar menos espaco abaixo margem margin bottom colar embaixo tabela', tgt: el => el, run: el => stepProp(el, 'margin-bottom', -1) },
  { s: 'Espaço', l: 'Afastar do que vem embaixo', a: 'afastar mais espaco abaixo margem margin bottom', tgt: el => el, run: el => stepProp(el, 'margin-bottom', 1) },
  { s: 'Tamanho', l: 'Deixar menos alto', a: 'menos alto mais baixo altura menor encurtar achatar min-height diminuir altura', tgt: el => el, run: el => findSource(el, 'min-height').rule ? stepProp(el, 'min-height', -1) : stepProp(el, 'padding', -1) },
  { s: 'Tamanho', l: 'Deixar mais alto', a: 'mais alto altura maior aumentar altura min-height', tgt: el => el, run: el => stepProp(el, 'min-height', 1) },
  { s: 'Tamanho', l: 'Deixar rolar se não couber', a: 'rolar scroll overflow vazando tabela mobile celular nao cabe', tgt: el => el, run: el => edit(el, 'overflow-x', 'auto') },
  { s: 'Layout', l: 'Mais colunas', a: 'mais colunas grid grade aumentar colunas', tgt: gridAnc, run: el => stepProp(el, 'grid-template-columns', 1) },
  { s: 'Layout', l: 'Menos colunas', a: 'menos colunas grid grade diminuir colunas', tgt: gridAnc, run: el => stepProp(el, 'grid-template-columns', -1) },
  { s: 'Layout', l: 'Centralizar no outro eixo', a: 'centralizar centro meio alinhar vertical align center', tgt: fgAnc, run: el => edit(el, 'align-items', 'center') },
  { s: 'Layout', l: 'Alinhar tudo no início', a: 'alinhar inicio topo esquerda start nao esticar', tgt: fgAnc, run: el => edit(el, 'align-items', 'flex-start') },
  { s: 'Layout', l: 'Espalhar até as pontas', a: 'espalhar distribuir pontas space between separar extremos', tgt: flexAnc, run: el => edit(el, 'justify-content', 'space-between') },
  { s: 'Layout', l: 'Empilhar (um embaixo do outro)', a: 'empilhar coluna vertical column um embaixo do outro', tgt: flexAnc, run: el => edit(el, 'flex-direction', 'column') },
  { s: 'Layout', l: 'Colocar lado a lado', a: 'lado a lado linha horizontal row', tgt: flexAnc, run: el => edit(el, 'flex-direction', 'row') },
  { s: 'Texto', l: 'Texto maior', a: 'texto fonte letra maior aumentar font size', tgt: el => el, run: el => stepProp(el, 'font-size', 1) },
  { s: 'Texto', l: 'Texto menor', a: 'texto fonte letra menor diminuir font size', tgt: el => el, run: el => stepProp(el, 'font-size', -1) },
  { s: 'Texto', l: 'Negrito', a: 'negrito bold forte peso destacar', tgt: el => el, run: el => edit(el, 'font-weight', '700') },
  { s: 'Texto', l: 'Tirar negrito', a: 'normal sem negrito peso leve', tgt: el => el, run: el => edit(el, 'font-weight', '400') },
  { s: 'Visual', l: 'Mais arredondado', a: 'arredondar mais redondo borda radius', tgt: el => el, run: el => stepProp(el, 'border-radius', 1) },
  { s: 'Visual', l: 'Menos arredondado', a: 'menos redondo quadrado reto borda radius', tgt: el => el, run: el => stepProp(el, 'border-radius', -1) },
  { s: 'Navegar', l: 'Selecionar o pai', a: 'pai container de fora acima selecionar', tgt: el => el !== document.body ? el.parentElement : null, run: el => select(el) },
  { s: 'Ferramenta', l: 'Usar a página (cliques normais)', a: 'usar navegar clicar pagina abrir aba gaveta', run: () => setMode('use') },
  { s: 'Ferramenta', l: 'Por que tem espaço aqui?', a: 'modo espaco por que diagnostico vao sobrando', run: () => setMode('space') },
  { s: 'Ferramenta', l: 'Medir distâncias', a: 'medir regua distancia alinhado', run: () => setMode('measure') },
  { s: 'Ferramenta', l: 'Ver problemas da tela', a: 'problemas erros auditoria raio x checar quebra vazando', run: () => setTab('issues') },
  { s: 'Ferramenta', l: 'Comparar larguras (390 · 768 · 1280)', a: 'comparar lado a lado mobile celular responsivo tablet', run: () => openCompare() },
  { s: 'Ferramenta', l: 'Ligar/desligar grade de 8px', a: 'grade grid 8px linhas alinhamento', run: () => { S.grid = !S.grid; draw(); } },
  { s: 'Ferramenta', l: 'Ver antes / depois', a: 'antes depois comparar original', run: () => toggleBefore() },
  { s: 'Ferramenta', l: 'Ver diff real', a: 'diff mudancas revisar', run: () => openDrawer('diff') },
  { s: 'Ferramenta', l: 'Copiar prompt pro Codex', a: 'copiar prompt codex agente', run: () => copy(promptText(), 'Prompt copiado.') },
  { s: 'Ferramenta', l: 'Gravar no arquivo', a: 'gravar salvar aplicar arquivo patch', run: () => apply(false) },
  { s: 'Ferramenta', l: 'Desfazer', a: 'desfazer voltar undo', run: () => undo(), k: 'Ctrl Z' }
];
let cmdItems = [], cmdIdx = 0;
function buildCmdItems(q) {
  const nq = norm(q), words = nq.split(/\s+/).filter(Boolean), items = [];
  const m = nq.match(/^(\d{1,2})\s*colunas?$/);
  if (m) items.push({ s: 'Direto', l: `${m[1]} colunas`, tgt: gridAnc, run: el => { const v = nextValue(el, 'grid-template-columns', 0); edit(el, 'grid-template-columns', v.replace(/^repeat\(\d+/, `repeat(${m[1]}`)); } });
  const c = q.trim().match(/^([a-z-]+)\s*:?\s+(.+?);?$/i) || q.trim().match(/^([a-z-]+)\s*:\s*(.+?);?$/i);
  if (c) { let [, p, v] = c; p = p.toLowerCase(); if (/^-?\d+(\.\d+)?$/.test(v) && !/weight|opacity|z-index|flex-grow|line-height|order/.test(p)) v += 'px'; if (CSS.supports(p, v)) items.push({ s: 'CSS direto', l: `${p}: ${v}`, tgt: el => el, run: el => edit(el, p, v) }); }
  for (const cmd of CMDS) { const hay = norm(cmd.l + ' ' + (cmd.a || '')); if (!words.length || words.every(w => hay.includes(w))) items.push(cmd); }
  return items;
}
function renderCmd() {
  const q = root.getElementById('cmd-input').value;
  cmdItems = buildCmdItems(q); cmdIdx = clamp(cmdIdx, 0, Math.max(0, cmdItems.length - 1));
  const sel = S.selected && S.selected.isConnected ? S.selected : null;
  root.getElementById('cmd-target').innerHTML = sel ? `Aplicando em: <b>${esc(nameOf(sel))}</b> <code>${esc(selOf(sel))}</code>` : 'Nada selecionado — os comandos de edição pedem um elemento.';
  const list = root.getElementById('cmd-list');
  if (!cmdItems.length) { list.innerHTML = `<div class="empty" style="padding:12px"><span>Nada com “${esc(q)}”. Tente <b>espaço</b>, <b>colunas</b>, <b>centralizar</b>, <b>texto</b>, <b>rolar</b>.</span></div>`; return; }
  let sec = '', h = '';
  cmdItems.forEach((c, i) => {
    if (c.s !== sec) { sec = c.s; h += `<div class="cmd-sec">${esc(sec)}</div>`; }
    const t = c.tgt && sel ? c.tgt(sel) : null;
    const hint = c.tgt ? (t ? `em ${nameOf(t)}${t !== sel ? ' (pai)' : ''}` : (sel ? 'não se aplica' : 'selecione algo')) : '';
    h += `<button class="cmd-item" data-i="${i}" aria-selected="${i === cmdIdx}"><span>${esc(c.l)}</span><small>${c.k ? `<kbd>${c.k}</kbd> ` : ''}${esc(hint)}</small></button>`;
  });
  list.innerHTML = h;
  const act = list.querySelector('[aria-selected="true"]'); if (act) act.scrollIntoView({ block: 'nearest' });
}
function openCmd() { root.getElementById('cmd').hidden = false; const i = root.getElementById('cmd-input'); i.value = ''; cmdIdx = 0; renderCmd(); i.focus(); }
function closeCmd() { root.getElementById('cmd').hidden = true; }
function runCmd(i) {
  const c = cmdItems[i]; if (!c) return; closeCmd();
  if (c.tgt) { const sel = S.selected && S.selected.isConnected ? S.selected : null; if (!sel) return toast('Selecione um elemento primeiro.'); const t = c.tgt(sel); if (!t) return toast(`“${c.l}” não se aplica a ${nameOf(sel)}.`); c.run(t); }
  else c.run();
}

/* ================= 14. Navegação ================= */
function select(el) { if (!inPage(el)) return; S.selected = el; S.affected = null; if (S.tab !== 'tree') S.tab = 'props'; render(); }
function setTab(t) { S.tab = t; if (t === 'issues') S.problems = scan(); render(); }
function setMode(m) { S.mode = m; S.hoverDiag = null; S.hoverEl = null; S.tab = 'props'; render(); }
function setOpen(o) { S.open = o; LS.set('open', o); if (o) { S.problems = scan(); } render(); }

/* ================= 15. UI (shadow DOM) ================= */
const CSS_TEXT = `
:host{all:initial}
*{box-sizing:border-box}
[hidden]{display:none!important}
.wrap{--bg:#fff;--bg2:#f7f6fa;--ink:#1c1824;--mut:#6d6679;--line:#e3dee9;--acc:#5a2a8f;--acc-ink:#fff;--soft:#f1eaf9;--code:#4a2a78;--warn:#8a5200;--warn-bg:#fff1d6;--lock:#8a2d3b;--lock-bg:#fbe7ea;--add:#1d6b43;--add-bg:#e2f4e9;--del:#9b2c2c;--del-bg:#fbe6e6;
  --o-margin:#f0913a;--o-padding:#4fae63;--o-gap:#8e4fd9;--o-sobra:#e04a74;--o-text:#3f8fd6;--o-sel:#6a33b0;
  --mono:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;font:13px/1.45 "Hanken Grotesk",Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink)}
@media (prefers-color-scheme:dark){.wrap{--bg:#1b1720;--bg2:#221d29;--ink:#ece8f2;--mut:#9e96ab;--line:#322a3b;--acc:#b68be8;--acc-ink:#1a1222;--soft:#2b2238;--code:#d6c2f4;--warn:#f0bf6a;--warn-bg:#3a2c12;--lock:#f19aa7;--lock-bg:#3b1c22;--add:#7ed3a2;--add-bg:#16301f;--del:#f19a9a;--del-bg:#361a1a}}
code,.mono{font-family:var(--mono);font-size:11.5px}
button,input,select{font:inherit;color:inherit}
button{cursor:pointer}
:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
kbd{font-family:var(--mono);font-size:10.5px;padding:0 5px;border:1px solid var(--line);border-bottom-width:2px;border-radius:4px;background:var(--bg2);color:var(--mut)}
.ovl{position:fixed;inset:0;pointer-events:none;z-index:1}
.ovl.grid{background-image:linear-gradient(to right,rgba(106,51,176,.13) 1px,transparent 1px),linear-gradient(to bottom,rgba(106,51,176,.13) 1px,transparent 1px);background-size:8px 8px}
.ov{position:fixed;box-sizing:border-box}
.ov.hover{outline:1.5px dashed var(--o-sel);outline-offset:-1px}
.ov.sel{outline:2px solid var(--o-sel);outline-offset:-1px}
.ov.aff{outline:2px solid var(--o-gap);outline-offset:-1px;background:rgba(142,79,217,.1)}
.ov.issue{outline:2px solid var(--o-sobra);outline-offset:-1px;background:rgba(224,74,116,.1)}
.ov.m{background:rgba(240,145,58,.3)}
.ov.p{background:rgba(79,174,99,.28)}
.ov.g{background:repeating-linear-gradient(45deg,rgba(142,79,217,.45) 0 4px,rgba(142,79,217,.14) 4px 9px)}
.ov.d{border:2px solid var(--c);background:color-mix(in srgb,var(--c) 32%,transparent)}
.ov.culprit{outline:2px dashed var(--c);outline-offset:1px}
.tag{position:absolute;left:0;bottom:100%;margin-bottom:3px;white-space:nowrap;padding:2px 6px;border-radius:4px;background:var(--c,var(--o-sel));color:#fff;font:600 11px/1.3 var(--mono)}
.tag.in{bottom:auto;top:0;margin:0}
.ln{position:fixed;background:var(--o-sobra)}.ln.h{height:1.5px}.ln.v{width:1.5px}
.ln .tag{--c:var(--o-sobra)}.ln.h .tag{left:50%;transform:translateX(-50%)}.ln.v .tag{left:100%;bottom:auto;top:50%;transform:translateY(-50%);margin:0 0 0 4px}
.launch{position:fixed;right:16px;bottom:16px;z-index:3;pointer-events:auto;display:flex;align-items:center;gap:8px;border:1px solid var(--line);background:var(--bg);border-radius:999px;padding:8px 14px;font-weight:700;box-shadow:0 6px 20px rgba(20,10,40,.2)}
.launch i{width:9px;height:9px;border-radius:2px;background:var(--acc);transform:rotate(45deg)}
.panel{position:fixed;top:12px;right:12px;bottom:12px;width:min(400px,calc(100vw - 24px));z-index:2;pointer-events:auto;display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 40px rgba(20,10,40,.25);overflow:hidden}
.panel.left{right:auto;left:12px}
.head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:7px;font-weight:700;margin-right:auto}
.brand i{width:8px;height:8px;border-radius:2px;background:var(--acc);transform:rotate(45deg)}
.icon{border:1px solid var(--line);background:var(--bg2);border-radius:7px;padding:3px 8px;font-size:12px}
.modes{display:flex;border-bottom:1px solid var(--line);padding:8px 12px;gap:8px;flex-wrap:wrap;align-items:center}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--bg2)}
.seg button{border:0;background:none;padding:5px 9px;font-size:12px;color:var(--mut);white-space:nowrap}
.seg button+button{border-left:1px solid var(--line)}
.seg button[aria-pressed="true"]{background:var(--acc);color:var(--acc-ink);font-weight:600}
.cmdbtn{flex:1;min-width:140px;display:flex;justify-content:space-between;align-items:center;border:1px solid var(--line);background:var(--bg2);border-radius:8px;padding:5px 8px;color:var(--mut);font-size:12px}
.tabs{display:flex;gap:2px;padding:2px 8px 0;border-bottom:1px solid var(--line);overflow-x:auto}
.tabs button{border:0;background:none;padding:8px 9px 7px;font-size:12px;font-weight:600;color:var(--mut);border-bottom:2px solid transparent;white-space:nowrap}
.tabs button[aria-selected="true"]{color:var(--ink);border-bottom-color:var(--acc)}
.count{display:inline-block;min-width:18px;padding:0 5px;border-radius:9px;background:var(--soft);color:var(--code);font-size:10.5px;margin-left:4px;text-align:center}
.count.hot{background:var(--lock-bg);color:var(--lock)}
.body{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
.empty{color:var(--mut);display:flex;flex-direction:column;gap:6px}.empty b{color:var(--ink)}
.el{display:flex;flex-direction:column;gap:6px}
.el-name{font-size:16px;font-weight:700}
.el-sub{display:flex;flex-wrap:wrap;gap:4px 10px;color:var(--mut)}.el-sub code{color:var(--code);overflow-wrap:anywhere}
.crumbs{display:flex;flex-wrap:wrap;gap:2px;align-items:center;font-size:11.5px}
.crumbs button{border:0;background:none;padding:2px 4px;border-radius:4px;color:var(--mut)}
.crumbs button:hover{background:var(--soft);color:var(--ink)}
.crumbs button[aria-current="true"]{color:var(--acc);font-weight:600}
.crumbs span{color:var(--mut);opacity:.6}
.actions{display:flex;flex-wrap:wrap;gap:6px}
.btn{border:1px solid var(--line);background:var(--bg2);border-radius:7px;padding:5px 10px;font-size:12px;font-weight:500}
.btn:hover{border-color:var(--acc)}.btn[disabled]{opacity:.45;cursor:not-allowed}
.btn.pri{background:var(--acc);border-color:var(--acc);color:var(--acc-ink);font-weight:600}
.btn.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.btn.sm{padding:3px 8px;font-size:11.5px}
.link{border:0;background:none;padding:0;color:var(--acc);font-size:11.5px;font-weight:600;text-decoration:underline;text-underline-offset:2px}
.bm{font-family:var(--mono);font-size:11px}
.bm-l{position:relative;display:grid;grid-template-columns:44px minmax(0,1fr) 44px;grid-template-rows:auto 1fr auto;align-items:center;justify-items:center;border-radius:7px;padding:2px}
.bm-l.m{background:rgba(240,145,58,.14);border:1px dashed rgba(240,145,58,.7)}
.bm-l.p{background:rgba(79,174,99,.16);border:1px solid rgba(79,174,99,.6);width:100%}
.bm-c{background:rgba(63,143,214,.14);border:1px solid rgba(63,143,214,.55);padding:9px 8px;border-radius:4px;text-align:center;width:100%;font-weight:600}
.bm-lab{position:absolute;top:3px;left:7px;font:600 9px/1 system-ui;text-transform:uppercase;letter-spacing:.08em;color:var(--mut)}
.bm input{width:40px;text-align:center;border:1px solid transparent;background:transparent;border-radius:4px;padding:2px;font:inherit}
.bm input:hover,.bm input:focus{border-color:var(--line);background:var(--bg)}
.bm .top{grid-column:2;grid-row:1}.bm .left{grid-column:1;grid-row:2}.bm .mid{grid-column:2;grid-row:2;width:100%}.bm .right{grid-column:3;grid-row:2}.bm .bottom{grid-column:2;grid-row:3}
.scope{border:1px solid var(--line);border-radius:8px;padding:9px 11px;display:flex;flex-direction:column;gap:6px;background:var(--bg2);font-size:12px}
.scope label{display:flex;gap:8px;align-items:flex-start}.scope small{color:var(--mut);display:block}
.group{font-size:10.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--mut);margin-bottom:-4px}
.row{border:1px solid var(--line);border-radius:9px;padding:9px 11px;display:flex;flex-direction:column;gap:7px;background:var(--bg)}
.row.flash{animation:flash 1.1s ease-out}
@keyframes flash{from{background:var(--soft);border-color:var(--acc)}to{background:var(--bg)}}
.row-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.label{font-weight:600}.label small{display:block;font-weight:400;color:var(--mut);font-size:11.5px}
.computed{font-family:var(--mono);font-size:12px;font-weight:600;white-space:nowrap;max-width:45%;overflow:hidden;text-overflow:ellipsis}
.tokens{display:flex;flex-wrap:wrap;gap:4px}
.tokens button{border:1px solid var(--line);background:var(--bg2);border-radius:6px;padding:3px 6px;font-size:11px;line-height:1.2;display:flex;flex-direction:column;align-items:center;min-width:32px}
.tokens button:hover{border-color:var(--acc)}
.tokens button small{font-family:var(--mono);font-size:9.5px;color:var(--mut)}
.tokens button[aria-pressed="true"]{background:var(--acc);border-color:var(--acc);color:var(--acc-ink)}
.tokens button[aria-pressed="true"] small{color:inherit;opacity:.8}
.step{display:flex;gap:4px}
.step button{width:30px;border:1px solid var(--line);background:var(--bg2);border-radius:6px;font-weight:600}
.step input,.row select{flex:1;min-width:0;border:1px solid var(--line);background:var(--bg2);border-radius:6px;padding:5px 8px;font-family:var(--mono);font-size:12px}
.row select{font-family:inherit}
.meta{font-size:11.5px;color:var(--mut);display:flex;flex-wrap:wrap;gap:3px 6px;align-items:center}.meta code{color:var(--code);overflow-wrap:anywhere}
.badge{font-size:10px;font-weight:600;padding:1px 6px;border-radius:4px;background:var(--soft);color:var(--code)}
.badge.warn{background:var(--warn-bg);color:var(--warn)}.badge.lock{background:var(--lock-bg);color:var(--lock)}
details.more summary{cursor:pointer;color:var(--mut);font-size:12px;padding:4px 0}
details.more[open]{display:flex;flex-direction:column;gap:10px}
.diag{border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px;background:color-mix(in srgb,var(--c) 10%,var(--bg));border:1px solid color-mix(in srgb,var(--c) 45%,var(--line))}
.eyebrow{font-size:10.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--mut)}
.diag-big{font-size:17px;font-weight:700;line-height:1.25}
.diag p{margin:0}.diag code{color:var(--code)}
.tree{font-size:12px}.tree ul{list-style:none;margin:0;padding-left:12px;border-left:1px solid var(--line)}.tree>ul{padding-left:0;border:0}
.tree li{margin:1px 0}.chain{display:flex;flex-direction:column;gap:1px;margin-bottom:4px}
.tree button{border:0;background:none;padding:3px 6px;border-radius:5px;text-align:left;display:flex;gap:6px;align-items:baseline;width:100%;min-width:0}
.tree button:hover{background:var(--soft)}.tree button.on{background:var(--acc);color:var(--acc-ink)}.tree button.anc{color:var(--mut)}
.tree code{color:var(--mut);font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tree .on code{color:inherit;opacity:.8}
.more-rows{color:var(--mut);font-size:11px;padding:2px 6px}
.issue{border:1px solid var(--line);border-radius:9px;padding:9px 11px;display:flex;flex-direction:column;gap:6px}
.issue-h{display:flex;gap:8px;align-items:center;font-weight:600}.issue p{margin:0;color:var(--mut);font-size:12px}.issue code{color:var(--code)}
.sev{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:1px 6px;border-radius:4px}
.sev.alta{background:var(--lock-bg);color:var(--lock)}.sev.media{background:var(--warn-bg);color:var(--warn)}.sev.baixa{background:var(--soft);color:var(--code)}
.ok{border:1px dashed var(--line);border-radius:9px;padding:12px;color:var(--mut);text-align:center}
.chg-file{font:600 11.5px var(--mono);color:var(--mut);margin-top:4px}
.chg{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;border:1px solid var(--line);border-radius:8px;padding:7px 9px}
.chg-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.chg-main code{overflow-wrap:anywhere}
.chg .del{color:var(--del);text-decoration:line-through}.chg .add{color:var(--add);font-weight:600}
.foot{border-top:1px solid var(--line);padding:9px 12px;display:flex;flex-direction:column;gap:7px}
.foot-count{font-size:12px;color:var(--mut)}.foot-count b{color:var(--ink)}
.foot-r{display:flex;flex-wrap:wrap;gap:5px}
.sheet{position:fixed;inset:0;z-index:4;pointer-events:auto;background:rgba(10,6,16,.45);display:flex;justify-content:flex-end}
.sheet-in{width:min(680px,100%);height:100%;background:var(--bg);display:flex;flex-direction:column}
.sheet-top{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--line)}.sheet-top .seg{margin-right:auto}
.sheet-body{flex:1;overflow:auto;padding:14px}
.note{font-size:12px;color:var(--mut);margin:0 0 10px}.note.err{color:var(--lock)}
.diff{font-family:var(--mono);font-size:12px;line-height:1.6;border:1px solid var(--line);border-radius:8px;overflow-x:auto;margin-bottom:12px}
.diff-h{padding:6px 12px;background:var(--bg2);border-bottom:1px solid var(--line);color:var(--mut);white-space:nowrap}.diff-h b{color:var(--ink)}
.diff .l{padding:0 12px;white-space:pre}.diff .add{background:var(--add-bg);color:var(--add)}.diff .del{background:var(--del-bg);color:var(--del)}
.prompt{font-family:var(--mono);font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word;border:1px solid var(--line);border-radius:8px;padding:12px;background:var(--bg2);margin:0}
.cmd{position:fixed;inset:0;z-index:5;pointer-events:auto;background:rgba(10,6,16,.4);display:flex;justify-content:center;align-items:flex-start;padding:10vh 16px 16px}
.cmd-in{width:min(580px,100%);background:var(--bg);border:1px solid var(--line);border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.3);overflow:hidden;display:flex;flex-direction:column;max-height:80vh}
.cmd-in input{width:100%;border:0;border-bottom:1px solid var(--line);padding:14px 16px;font-size:15px;background:transparent;outline:none}
.cmd-target{padding:7px 16px;font-size:11.5px;color:var(--mut);border-bottom:1px solid var(--line)}.cmd-target b{color:var(--ink)}
.cmd-list{overflow:auto;padding:6px}
.cmd-item{display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;border:0;background:none;padding:8px 10px;border-radius:7px;text-align:left}
.cmd-item[aria-selected="true"]{background:var(--soft)}.cmd-item small{color:var(--mut);font-size:11px;white-space:nowrap}
.cmd-sec{padding:8px 10px 4px;font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--mut)}
.cmd-foot{border-top:1px solid var(--line);padding:8px 16px;font-size:11px;color:var(--mut);display:flex;flex-wrap:wrap;gap:4px 14px}
.cmp{position:fixed;inset:0;z-index:4;pointer-events:auto;background:rgba(10,6,16,.55);display:flex;flex-direction:column;padding:16px;gap:10px}
.cmp-top{display:flex;align-items:center;gap:8px;color:#fff}.cmp-top b{margin-right:auto}
.cmp-frames{flex:1;display:flex;gap:24px;justify-content:center;align-items:flex-start;overflow:hidden}
.cmp-col{display:flex;flex-direction:column;gap:6px}.cmp-col .cap{color:#fff;font:500 11px var(--mono)}
.cmp-box{overflow:hidden;background:#fff;border-radius:6px;box-shadow:0 8px 30px rgba(0,0,0,.35)}
.cmp-box iframe{border:0;transform-origin:0 0;display:block;background:#fff}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:6;max-width:calc(100% - 32px);padding:9px 14px;border-radius:8px;background:var(--ink);color:var(--bg);font-size:12.5px;box-shadow:0 8px 24px rgba(0,0,0,.25);pointer-events:none}
@media (prefers-reduced-motion:reduce){.row.flash{animation:none}}
`;
const HTML = `
<div class="wrap">
  <div class="ovl" id="ov"></div>
  <button class="launch" id="launch" title="Alt+Shift+V"><i></i>VF DevTools</button>
  <section class="panel" id="panel" aria-label="VF Visual DevTools">
    <div class="head"><div class="brand"><i></i>VF DevTools</div>
      <button class="icon" id="dock" title="Trocar de lado">⇆</button><button class="icon" id="close" title="Fechar (Alt+Shift+V)">✕</button></div>
    <div class="modes">
      <div class="seg" id="modes"><button data-mode="select" title="1">Selecionar</button><button data-mode="space" title="2">Espaço?</button><button data-mode="measure" title="3">Medir</button><button data-mode="use" title="0">Usar</button></div>
      <button class="cmdbtn" id="cmdbtn"><span>O que você quer fazer?</span><kbd>Ctrl K</kbd></button>
    </div>
    <div class="tabs" id="tabs"><button data-tab="props">Painel</button><button data-tab="tree">Árvore</button><button data-tab="issues">Problemas<span class="count" id="cnt-issues">0</span></button><button data-tab="changes">Alterações<span class="count" id="cnt-changes">0</span></button></div>
    <div class="body" id="body"></div>
    <div class="foot"><div class="foot-count" id="foot-count"></div>
      <div class="foot-r"><button class="btn sm" id="undo">↶</button><button class="btn sm" id="redo">↷</button><button class="btn sm" id="before">Ver antes</button><button class="btn sm" id="cmpbtn">Larguras</button><button class="btn sm" id="diff">Diff</button><button class="btn sm" id="prompt">Prompt</button><button class="btn sm pri" id="apply">Gravar</button></div></div>
  </section>
  <div class="sheet" id="drawer" hidden><div class="sheet-in"><div class="sheet-top"><div class="seg" id="dtabs"><button data-tab="diff">Diff real</button><button data-tab="prompt">Prompt pro Codex</button></div><button class="btn" id="dcopy">Copiar</button><button class="btn" id="dclose">Fechar</button></div><div class="sheet-body" id="dbody"></div></div></div>
  <div class="cmd" id="cmd" hidden><div class="cmd-in"><input id="cmd-input" placeholder="Escreva do seu jeito: menos espaço, 3 colunas, centralizar…" autocomplete="off" spellcheck="false"><div class="cmd-target" id="cmd-target"></div><div class="cmd-list" id="cmd-list"></div><div class="cmd-foot"><span><kbd>↑</kbd><kbd>↓</kbd> escolher</span><span><kbd>Enter</kbd> aplicar</span><span><kbd>Esc</kbd> fechar</span><span>Aceita CSS direto: <code>gap 8</code></span></div></div></div>
  <div class="cmp" id="cmp" hidden><div class="cmp-top"><b>Comparar larguras — mesma página, sem o editor, com as alterações pendentes aplicadas</b><button class="btn" id="cmp-reload">Recarregar</button><button class="btn" id="cmp-close">Fechar</button></div><div class="cmp-frames" id="cmp-frames"></div></div>
  <div class="toast" id="toast" hidden></div>
</div>`;

function buildUI() {
  host = document.createElement('vf-devtools');
  host.setAttribute('data-vfdev', '');
  host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483000;';
  document.documentElement.appendChild(host);
  root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS_TEXT}</style>${HTML}`;
  ov = root.getElementById('ov'); panel = root.getElementById('panel'); launcher = root.getElementById('launch');
  const $ = id => root.getElementById(id);

  launcher.onclick = () => setOpen(true);
  $('close').onclick = () => setOpen(false);
  $('dock').onclick = () => { S.dock = S.dock === 'left' ? 'right' : 'left'; LS.set('dock', S.dock); render(); };
  $('modes').onclick = e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); };
  $('tabs').onclick = e => { const b = e.target.closest('button'); if (b) setTab(b.dataset.tab); };
  $('cmdbtn').onclick = openCmd;
  $('undo').onclick = () => undo(); $('redo').onclick = redo; $('before').onclick = () => toggleBefore();
  $('diff').onclick = () => openDrawer('diff'); $('prompt').onclick = () => copy(promptText(), 'Prompt copiado.');
  $('apply').onclick = () => apply(false);
  $('cmpbtn').onclick = openCompare; $('cmp-reload').onclick = openCompare; $('cmp-close').onclick = () => { $('cmp').hidden = true; $('cmp-frames').innerHTML = ''; };
  $('dtabs').onclick = e => { const b = e.target.closest('button'); if (b) openDrawer(b.dataset.tab); };
  $('dclose').onclick = () => $('drawer').hidden = true;
  $('drawer').onclick = e => { if (e.target.id === 'drawer') $('drawer').hidden = true; };
  $('dcopy').onclick = () => copy($('drawer').dataset.tab === 'prompt' ? promptText() : [...root.querySelectorAll('#dbody .diff')].map(d => d.innerText).join('\n\n'));
  $('cmd').onclick = e => { if (e.target.id === 'cmd') return closeCmd(); const b = e.target.closest('.cmd-item'); if (b) runCmd(+b.dataset.i); };
  $('cmd-input').addEventListener('input', () => { cmdIdx = 0; renderCmd(); });
  $('cmd-input').addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') { e.preventDefault(); cmdIdx = Math.min(cmdItems.length - 1, cmdIdx + 1); renderCmd(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cmdIdx = Math.max(0, cmdIdx - 1); renderCmd(); }
    else if (e.key === 'Enter') { e.preventDefault(); runCmd(cmdIdx); }
    else if (e.key === 'Escape') { e.preventDefault(); closeCmd(); }
  });

  const body = $('body');
  body.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const t = S.targets[+b.dataset.t], prop = b.dataset.prop, act = b.dataset.act;
    if (act === 'sel') { if (S.tab === 'issues' || S.tab === 'changes') S.tab = 'props'; select(t); }
    else if (act === 'goto') { S.mode = 'select'; select(t); }
    else if (act === 'tok') { endPreview(); edit(t, prop, b.dataset.val); }
    else if (act === 'step') stepProp(t, prop, +b.dataset.dir);
    else if (act === 'aff') { S.affected = { sel: b.dataset.sel, until: Date.now() + 3500 }; draw(); setTimeout(draw, 3600); }
    else if (act === 'copycss') copy(cssOf(S.selected), 'CSS copiado.');
    else if (act === 'copysel') copy(newSel(S.selected), 'Seletor copiado.');
    else if (act === 'fix') { const p = S.problems[+b.dataset.i]; if (p && p.fix) p.fix.run(); }
    else if (act === 'rescan') { S.problems = scan(); render(); }
    else if (act === 'revert') { const c = [...changes.values()].find(x => keyOf(x.rule, x.prop) === b.dataset.k); if (c) { prep(); if (setRule(c.rule, c.prop, c.before)) render(); } }
  });
  body.addEventListener('pointerover', e => {
    const tk = e.target.closest('[data-act="tok"]');
    if (tk && tk.getAttribute('aria-pressed') !== 'true') { startPreview(S.targets[+tk.dataset.t], tk.dataset.prop, tk.dataset.val); return; }
    const hv = e.target.closest('[data-hov]'); if (hv) { S.hoverEl = S.targets[+hv.dataset.hov]; draw(); return; }
    const is = e.target.closest('[data-issue]'); if (is) { const p = S.problems[+is.dataset.issue]; S.hoverIssue = p && p.el; draw(); }
  });
  body.addEventListener('pointerout', e => {
    const rel = e.relatedTarget;
    const tk = e.target.closest('[data-act="tok"]'); if (tk && !(rel && tk.contains(rel))) endPreview();
    if (e.target.closest('[data-hov]') && !(rel && rel.closest && rel.closest('[data-hov]'))) { S.hoverEl = null; draw(); }
    if (e.target.closest('[data-issue]') && !(rel && rel.closest && rel.closest('[data-issue]'))) { S.hoverIssue = null; draw(); }
  });
  body.addEventListener('change', e => {
    const i = e.target;
    if (i.name === 'scope') { S.scope = i.value; LS.set('scope', S.scope); render(); return; }
    if (!i.dataset.prop) return;
    let v = i.value.trim(); if (i.dataset.bm && /^-?\d+(\.\d+)?$/.test(v)) v += 'px';
    edit(S.targets[+i.dataset.t], i.dataset.prop, v);
  });
  body.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && e.target.matches('input[data-prop]')) e.target.blur(); });
}

/* ================= 16. Eventos da página ================= */
const fromTool = e => e.composedPath().includes(host);
const active = () => S.open && S.mode !== 'use';
function onMove(e) {
  if (!active() || fromTool(e)) return;
  const el = pageElementAt(e.clientX, e.clientY); if (!inPage(el)) return;
  if (S.mode === 'space') { resetCache(); S.hoverDiag = diagnose(e.clientX, e.clientY); draw(); }
  else if (S.hoverEl !== el) { S.hoverEl = el; draw(); }
}
function block(e) {
  if (!active() || fromTool(e)) return;
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  if (e.type !== 'click') return;
  if (S.mode === 'space') { resetCache(); const d = diagnose(e.clientX, e.clientY); if (d) { S.pinned = d; S.hoverDiag = null; render(); } }
  else select(pageElementAt(e.clientX, e.clientY));
}
function onKey(e) {
  if (e.altKey && e.shiftKey && (e.key === 'V' || e.key === 'v' || e.code === 'KeyV')) { e.preventDefault(); setOpen(!S.open); return; }
  if (!S.open) return;
  if (e.key === 'Alt' && S.mode === 'select' && !S.altDown) { S.altDown = true; draw(); }
  const inTool = fromTool(e);
  const typing = !inTool && e.target && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !typing) { e.preventDefault(); root.getElementById('cmd').hidden ? openCmd() : closeCmd(); return; }
  if (inTool || typing) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && (undoS.length || redoS.length)) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const nav = el => { if (inPage(el) && el !== host) { e.preventDefault(); select(el); } };
  const sel = S.selected && S.selected.isConnected ? S.selected : null;
  switch (e.key) {
    case 'Escape': if (!root.getElementById('drawer').hidden) root.getElementById('drawer').hidden = true; else if (!root.getElementById('cmp').hidden) root.getElementById('cmp-close').click(); else { S.selected = null; S.pinned = null; render(); } break;
    case '/': e.preventDefault(); openCmd(); break;
    case '0': setMode('use'); break;
    case '1': setMode('select'); break;
    case '2': setMode('space'); break;
    case '3': setMode('measure'); break;
    case 'g': case 'G': S.grid = !S.grid; draw(); break;
    case 'b': case 'B': if (changes.size || S.beforeMode) toggleBefore(); break;
    case '[': if (sel) { e.preventDefault(); stepProp(sel, 'padding', -1); } break;
    case ']': if (sel) { e.preventDefault(); stepProp(sel, 'padding', 1); } break;
    case 'ArrowUp': if (sel && S.mode !== 'use') nav(sel.parentElement); break;
    case 'ArrowDown': if (sel && S.mode !== 'use') nav(realKids(sel)[0]); break;
    case 'ArrowLeft': if (sel && S.mode !== 'use') nav(sel.previousElementSibling); break;
    case 'ArrowRight': if (sel && S.mode !== 'use') nav(sel.nextElementSibling); break;
  }
}

/* ================= 17. Boot ================= */
async function boot() {
  try { CFG = await getJSON('/__vfdev/config'); } catch (e) { console.warn('[vfdev] servidor do VF DevTools não respondeu:', e); return; }
  await new Promise(r => setTimeout(r, 150)); // deixa layout.js / vf-shell.js montarem a moldura
  await syncSheets();
  readTokens();
  buildUI();
  window.addEventListener('pointermove', onMove, true);
  for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) window.addEventListener(t, block, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', e => { if (e.key === 'Alt' && S.altDown) { S.altDown = false; draw(); } }, true);
  window.addEventListener('blur', () => { if (S.altDown) { S.altDown = false; draw(); } });
  window.addEventListener('scroll', draw, true);
  window.addEventListener('resize', () => { draw(); rescanSoon(); });
  let sheetTimer = 0;
  new MutationObserver(muts => {
    if (muts.every(m => m.target === host || (host && host.contains(m.target)))) return;
    draw();
    if (S.selected && !S.selected.isConnected) { S.selected = null; render(); }
    clearTimeout(sheetTimer);
    sheetTimer = setTimeout(async () => { const n = ruleInfo.size; await syncSheets(); if (ruleInfo.size !== n) { readTokens(); resetCache(); } rescanSoon(); }, 300);
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open'] });
  if (S.open) S.problems = scan();
  render();
  window.__VFDEV__.api = { select, edit, findSource, ruleInfo, changes, buildPatch, apply, scan, state: S };
}
if (document.readyState === 'complete') boot(); else window.addEventListener('load', boot, { once: true });
})();
