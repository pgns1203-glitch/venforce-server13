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
const normSel = s => String(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '').replace(/::/g, ':').replace(/["']/g, '').toLowerCase()
  .replace(/:nth-(child|of-type|last-child|last-of-type)\(even\)/g, ':nth-$1(2n)').replace(/:nth-(child|of-type|last-child|last-of-type)\(odd\)/g, ':nth-$1(2n+1)');
const LS = {
  get(k, d) { try { const v = localStorage.getItem('vfdev:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('vfdev:' + k, JSON.stringify(v)); } catch (e) {} }
};
async function api(method, url, body) {
  const headers = { 'X-VFDEV-Token': TOKEN }; if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(url, { method, cache: 'no-store', headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j;
}
const getJSON = url => api('GET', url), postJSON = (url, body) => api('POST', url, body);
const htmlFile = () => decodeURIComponent(location.pathname.replace(/^\/+/, '')) || 'index.html';
const relFromHref = href => { try { const u = new URL(href, location.href); if (u.origin !== location.origin) return null; return decodeURIComponent(u.pathname.replace(/^\/+/, '')); } catch (e) { return null; } };

/* ---------------- estado ---------------- */
let CFG = null, host, root, ov, panel, launcher;
const S = {
  open: LS.get('open', true), dock: LS.get('dock', 'right'), mode: 'select', tab: 'props', scope: LS.get('scope', 'page'),
  selected: null, hoverEl: null, hoverDiag: null, pinned: null, hoverIssue: null, altDown: false, affected: null,
  lastEdit: null, problems: [], targets: [], beforeMode: false, grid: false,
  drag: null, dragEnded: false, region: null, talk: null, pick: null, why: null, sesCompare: false
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
  const ilha = meta.kind === 'built' ? (file.split('/')[1] || null) : null;
  fileMeta.set(file, { kind: meta.kind, writable: meta.writable, reason: meta.reason, sources: meta.sources || [], sheet, ilha, pareadas: meta.pareadas || 0 });
  for (const [r, src] of pair(list, meta.rules)) {
    if (!src) { ruleInfo.set(r, { file, kind: meta.kind, writable: false, reason: 'regra não localizada no arquivo (recarregue)', line: null, decls: {} }); continue; }
    const S2 = src.src;
    if (S2 && S2.writable) {
      ruleInfo.set(r, { file: S2.file, kind: 'react-source', writable: true, bundle: file, ilha, line: S2.line, column: S2.column, selectorSrc: S2.selector, cond: S2.cond, decls: S2.decls,
        reason: `fonte React${S2.porOrdem ? ' (pareada pela ordem de ocorrência)' : ''}; o CSS da tela vem de ${file} e só muda depois do rebuild da ilha` });
      continue;
    }
    ruleInfo.set(r, { file, kind: meta.kind, writable: meta.writable, ilha, reason: meta.kind === 'built' && src.srcMotivo ? `gerado pelo Vite — ${src.srcMotivo}` : meta.reason,
      line: src.line, column: src.column, selectorSrc: src.selector, cond: src.cond, decls: src.decls, srcFile: S2 && S2.file, srcLine: S2 && S2.line });
  }
}
async function syncSheets() { for (const s of [...document.styleSheets]) await indexSheet(s); }
async function reindexFile(file) {
  const metas = fileMeta.has(file) ? [[file, fileMeta.get(file)]] : [...fileMeta].filter(([, m]) => (m.sources || []).includes(file));
  for (const [f, m] of metas) {
    for (const [r, i] of [...ruleInfo]) if (i.file === f || i.bundle === f) ruleInfo.delete(r);
    await indexSheet(m.sheet, true);
  }
  resetCache();
}

/* ================= 2. Qual regra REALMENTE controla a propriedade ================= */
const LONG = {
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  gap: ['row-gap', 'column-gap'],
  'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius']
};
function comp(el, prop) {
  const cs = (el.ownerDocument.defaultView || window).getComputedStyle(el);
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
function getOverride(el) { return overrideRuleFor(pageFile(), overrideSelector(el)); }
function overrideRuleFor(file, sel) {
  if (!file || !sel || !fileMeta.get(file)) return null;
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
  if (src && src.info && src.info.kind === 'built') { if (src.info.srcFile) return `${src.info.srcFile}:${src.info.srcLine}`; const m = fileMeta.get(src.info.file); return (m && m.sources && m.sources.length) ? m.sources.join(' ou ') : `${src.info.file} (fonte não versionada)`; }
  if (src && src.info && src.info.kind === 'inline') return `${htmlFile()} (<style> inline)`;
  if (src && src.inline) return `${htmlFile()} (atributo style="")`;
  return pageFile() || htmlFile();
}
function getScratch(el, src) {
  return scratchRule(src && src.rule && src.info.kind === 'built' ? src.selector : (overrideSelector(el) || newSel(el)), sourceHint(src));
}
function scratchRule(sel, hint) {
  if (!scratchSheet) { const st = document.createElement('style'); st.id = 'vfdev-scratch'; document.head.appendChild(st); scratchSheet = st.sheet; }
  for (const [r, i] of ruleInfo) if (i.kind === 'scratch' && normSel(r.selectorText) === normSel(sel)) return r;
  const rule = scratchSheet.cssRules[scratchSheet.insertRule(`${sel} {}`, scratchSheet.cssRules.length)];
  ruleInfo.set(rule, { file: hint, kind: 'scratch', writable: false, isNew: true, selectorSrc: sel, line: null, decls: {}, reason: 'só vai no prompt' });
  resetCache();
  return rule;
}
function targetFor(el, prop) {
  const src = findSource(el, prop), info = src.rule && src.info;
  if (info && info.isNew) return { rule: src.rule };
  if (info && info.writable && info.line && (info.kind === 'page' || info.kind === 'react-source' || (info.kind === 'global' && S.scope === 'global'))) return { rule: src.rule };
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
  const inicial = snapInicial(el, prop);
  const t = targetFor(el, prop);
  if (!setRule(t.rule, prop, val, t.scratch ? 'important' : null)) return;
  let rule = t.rule;
  if (t.override) {
    resetCache();
    const now = findSource(el, prop);
    if (now.rule !== t.rule) {
      undo(true);
      rule = getScratch(el, t.src);
      setRule(rule, prop, val, 'important');
      toast('O override desta tela perdeu na cascata (especificidade). A mudança ficou só no prompt.');
    }
  }
  const key = keyOf(rule, prop);
  if (!changeEl.has(key)) changeEl.set(key, { el, inicial });
  S.lastEdit = { el, prop };
  showWhy(key, el, prop);
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
function drawIntent() {
  if (S.drag) { const d = S.drag; box(mk(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.max(d.x0, d.x1), Math.max(d.y0, d.y1)), 'region'); }
  if (S.region) box(S.region.rect, 'region', null, 'região');
  for (const [, p] of previews) if (p.kind === 'hide' && p.el.isConnected) box(p.el.getBoundingClientRect(), 'gone', null, 'prévia: remover');
  if (previews.size) { const b = document.createElement('div'); b.className = 'previa'; b.textContent = 'prévia — não será gravada'; ov.appendChild(b); }
  comentarios().forEach((it, i) => {
    const { el } = resolveAlvo(it.alvo); if (!el || !el.getClientRects().length) return;
    const p = pinPoint(it.alvo, el);
    if (it.alvo.regiao && it.alvo.offset && it.alvo.offset.fw) { const r = el.getBoundingClientRect(), w = it.alvo.offset.fw * r.width, h = it.alvo.offset.fh * r.height; box(mk(p.x - w / 2, p.y - h / 2, p.x + w / 2, p.y + h / 2), 'region pinreg'); }
    const b = document.createElement('button'); b.className = 'pin' + (it.comentario.resolvido ? ' done' : ''); b.dataset.pin = it.id; b.textContent = i + 1;
    b.title = it.comentario.texto; Object.assign(b.style, { left: (p.x - 11) + 'px', top: (p.y - 11) + 'px' });
    ov.appendChild(b);
  });
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
  drawIntent();
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
  if (i.kind === 'built' && i.srcFile) return `${i.file} ← fonte ${i.srcFile}:${i.srcLine}`;
  return i.line ? `${i.file}:${d ? d.line : i.line}${d && i.kind === 'built' ? ':' + d.column : ''}` : i.file;
}
function condLabel(c) { const m = c && c.match(/max-width:\s*(\d+)px/); const n = c && c.match(/min-width:\s*(\d+)px/); return m ? `só em telas ≤ ${m[1]}px` : n ? `só em telas ≥ ${n[1]}px` : c; }
const KIND = { 'react-source': '<span class="badge warn">fonte React</span>', page: '', global: '<span class="badge warn">global</span>', protected: '<span class="badge lock">protegido</span>', built: '<span class="badge lock">gerado pelo Vite</span>', inline: '<span class="badge lock">inline no HTML</span>', scratch: '<span class="badge">só prompt</span>', unknown: '<span class="badge lock">?</span>' };
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
    else if (k === 'react-source') warn = `Grava na fonte <span class="mono">${esc(src.info.file)}</span>. A tela só muda “de verdade” depois do rebuild da ilha <b>${esc(src.info.ilha)}</b>. <button class="link" data-act="rebuild" data-ilha="${esc(src.info.ilha)}">Rebuild agora</button>`;
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
  const why = S.why && S.why.el === t && S.why.prop === def.prop ? `<input class="why" data-why-key="${esc(S.why.key)}" placeholder="Por quê? (opcional — some em 6 s se ficar vazio)" value="${esc((cssItemOf(S.why.key) || {}).nota || '')}" aria-label="Por quê?">` : '';
  return `<div class="row${flash}"><div class="row-head"><div class="label">${esc(def.label)}${def.hint ? `<small>${esc(def.hint)}</small>` : ''}</div><span class="computed">${esc(src.computed)}</span></div>${ctrl}${why}${meta}</div>`;
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
  h += `<div class="actions">${el !== document.body ? `<button class="btn sm" data-act="sel" data-t="${T(el.parentElement)}">↑ Selecionar o pai</button>` : ''}<button class="btn sm pri" data-act="talk" title="C">Falar sobre isso</button>${S.ref && S.ref !== el && S.ref.isConnected ? `<button class="btn sm" data-act="ref-igual">Deixar igual à referência (${esc(nameOf(S.ref))})</button>` : ''}<button class="btn sm${S.ref === el ? ' on' : ''}" data-act="ref-usar">${S.ref === el ? 'É a referência' : 'Usar como referência'}</button><button class="btn sm" data-act="copycss">Copiar CSS</button><button class="btn sm" data-act="copysel">Copiar seletor</button></div></div>`;
  h += refHTML(el);
  h += origemHTML(el);
  h += estruturaHTML(el);
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
  if (!changes.size) return `<div class="ok">Nenhuma alteração pendente. Tudo que você mexer aparece aqui, e dá pra reverter um por um antes de gravar.</div>` + liveHTML() + histHTML();
  let h = '';
  for (const { rule, info, list } of groupChanges()) {
    h += `<div class="chg-file">${esc(info.file)}${info.kind === 'scratch' ? ' · só prompt' : info.isNew ? ' · override novo' : ` · linha ${info.line}`}</div>`;
    for (const c of list) {
      const el = matchesOf(rule.selectorText)[0], sb = srcBefore(c);
      const k = keyOf(c.rule, c.prop), it = cssItemOf(k);
      h += `<div class="chg"><div class="chg-main"><code>${esc(rule.selectorText)}</code><span class="mono">${c.prop}: ${sb ? `<span class="del">${esc(sb)}</span> → ` : ''}<span class="add">${esc(c.after || '(remover)')}</span></span></div>${el ? `<button class="btn sm" data-act="sel" data-t="${T(el)}">Ver</button>` : ''}<button class="btn sm" data-act="revert" data-k="${k}">Reverter</button><input class="why" data-why-key="${esc(k)}" placeholder="Por quê? (opcional)" value="${esc(it && it.nota || '')}" aria-label="Por quê?"></div>`;
    }
  }
  return h + liveHTML() + histHTML();
}
function liveHTML() { return S.live && Date.now() - S.live.em < 60000 ? `<div class="meta">Ao vivo: <span class="mono">${esc(S.live.file)}</span> — ${esc(S.live.msg)} (${new Date(S.live.em).toLocaleTimeString()})</div>` : ''; }
function renderTabs() {
  root.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === S.tab));
  const ci = root.getElementById('cnt-issues'); ci.textContent = S.problems.length; ci.classList.toggle('hot', S.problems.some(p => p.sev !== 'baixa'));
  root.getElementById('cnt-changes').textContent = changes.size;
  root.getElementById('cnt-session').textContent = SES ? SES.itens.length : '–';
}
function renderBody() {
  S.targets = []; resetCache();
  const b = root.getElementById('body');
  const st = b.scrollTop;
  b.innerHTML = S.tab === 'session' ? sessionPanel() : S.tab === 'tree' ? treePanel() : S.tab === 'issues' ? issuesPanel() : S.tab === 'changes' ? changesPanel() : propsPanel();
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
  sesSync();
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
    syncCssItems();
    for (const [k, c] of [...changes]) if (ruleInfo.get(c.rule).writable && done.has(ruleInfo.get(c.rule).file)) {
      const it = cssItemOf(k); if (it) { it.css.destino = 'gravado'; it.css.gravadoEm = nowIso(); if (res.historico) it.css.historico = res.historico; }
      cssItemKey.delete(k); changeEl.delete(k); changes.delete(k);
    }
    saveSoon();
    undoS.length = 0; redoS.length = 0;
    for (const f of done) await reindexFile(f);
    overrides.clear();
    const ilhas = [...new Set([...done].filter(f => f.startsWith('frontend-react/')).flatMap(f => [...fileMeta.values()].filter(m => (m.sources || []).includes(f)).map(m => m.ilha)))];
    S.hist = null;
    toast(`Gravado: ${[...done].join(', ')}.${ilhas.length ? ` Fonte React: rode o rebuild de ${ilhas.join(', ')} para o bundle refletir.` : ''} Dá para desfazer na aba Alterações.`, 6000);
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
  if (tab === 'build') {
    const f = S.buildFim;
    body.innerHTML = `<p class="note">${S.building ? `Rebuild de <b>${esc(S.building)}</b> em andamento…` : f ? (f.ok ? `Rebuild de <b>${esc(f.ilha)}</b> ok (${(f.ms / 1000).toFixed(1)} s).` : `<span class="err">Rebuild de <b>${esc(f.ilha)}</b> falhou (código ${esc(f.codigo)}). Últimas 30 linhas:</span>`) : 'Nenhum rebuild nesta aba.'}</p><pre class="prompt" id="blog">${esc((f && !f.ok ? f.ultimas : S.buildLog || []).join('\n'))}</pre>`;
    return;
  }
  if (tab === 'missao') {
    if (!S.missaoMd && SES && SES.missao) { body.innerHTML = '<p class="note">Carregando a missão…</p>'; try { S.missaoMd = await (await fetch('/__vfdev/missoes/' + encodeURIComponent(SES.id) + '.md', { headers: { 'X-VFDEV-Token': TOKEN } })).text(); } catch (e) {} }
    body.innerHTML = S.missaoMd ? `<p class="note">Cole no agente, ou mande ele ler <code>${esc(SES.missao.md)}</code>. Depois clique em <b>Verificar missão</b>.</p><pre class="prompt" id="ptext">${esc(S.missaoMd)}</pre>` : '<p class="note">Nenhuma missão gerada nesta sessão. Use <b>Gerar missão</b> na aba Sessão.</p>';
    return;
  }
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
  const widths = SES && SES.larguras && SES.larguras.length ? [...SES.larguras].sort((a, b) => a - b) : [390, 768, 1280];
  const wrap = root.getElementById('cmp-frames');
  const avail = wrap.clientWidth - 24 * (widths.length - 1), total = widths.reduce((a, b) => a + b, 0), s = Math.min(1, avail / total);
  const hgt = wrap.clientHeight - 30;
  wrap.innerHTML = widths.map(w => `<div class="cmp-col"><div class="cap"><b>${w}px</b> · ${Math.round(s * 100)}%</div><div class="cmp-box" style="width:${w * s}px;height:${hgt}px"><iframe src="${esc(u.href)}" style="width:${w}px;height:${hgt / s}px;transform:scale(${s})" title="${w}px"></iframe></div></div>`).join('');
  wrap.querySelectorAll('iframe').forEach(f => f.addEventListener('load', () => { try { const st = f.contentDocument.createElement('style'); st.id = 'vfdev-pending'; st.textContent = pendingCSS(); f.contentDocument.head.appendChild(st); } catch (e) {} pinsIntoFrame(f); }));
}

/** Pins dos comentários dentro do iframe da comparação: o mesmo alvo resolvido naquela largura. */
function pinsIntoFrame(f) {
  let doc; try { doc = f.contentDocument; } catch (e) { return; }
  if (!doc || !doc.body) return;
  const win = doc.defaultView;
  const place = () => {
    let layer = doc.getElementById('vfdev-pins');
    if (!layer) { layer = doc.createElement('div'); layer.id = 'vfdev-pins'; layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483000;pointer-events:none'; doc.documentElement.appendChild(layer); }
    layer.innerHTML = '';
    comentarios().forEach((it, i) => {
      const { el } = resolveAlvo(it.alvo, doc); if (!el || !el.getClientRects().length) return;
      const p = pinPoint(it.alvo, el), d = doc.createElement('div');
      d.setAttribute('data-vfdev-pin', it.id); d.textContent = i + 1; d.title = it.comentario.texto;
      d.style.cssText = `position:absolute;left:${p.x + win.scrollX - 11}px;top:${p.y + win.scrollY - 11}px;width:22px;height:22px;border-radius:50%;background:#e04a74;color:#fff;font:700 11px/22px system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff,0 2px 6px rgba(0,0,0,.3)`;
      layer.appendChild(d);
    });
  };
  place();
  let t; new win.MutationObserver(() => { clearTimeout(t); t = setTimeout(place, 80); }).observe(doc.body, { subtree: true, childList: true, attributes: true });
  win.addEventListener('resize', place);
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

/* ================= 14b. Sessão — a camada de intenção ================= */
/* A sessão junta ajustes CSS, ações estruturais, comentários e referências. Fica no servidor
 * (tools/vfdev/sessoes/<id>.json) e sobrevive a F5, fechar a aba e reiniciar o servidor. */
const SSKEY = 'vfdev:sessao:' + htmlFile();
let SES = null, sesOffer = [], sesErr = '', sesSig = '', saveTimer = 0, reapplyInfo = null;
const cssItemKey = new Map();   // keyOf(rule, prop) -> id do item css
const changeEl = new Map();     // keyOf(rule, prop) -> { el, inicial } (elemento editado + valores antes da 1ª mudança)
const previews = new Map();     // id do item estrutural -> { off() }
const nowIso = () => new Date().toISOString();
const uid = p => (p || 'i') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const repoRel = f => !f ? f : /^(frontend-react|Portal)\//.test(f) || / ou |\(/.test(f) ? f : 'Portal/' + f;
const portalRel = f => String(f || '').replace(/^Portal\//, '');
const ACAO_LABEL = { remover: 'Remover', mover_antes: 'Mover para antes de…', mover_depois: 'Mover para depois de…', agrupar_com: 'Agrupar com…', desagrupar: 'Desagrupar', compactar: 'Compactar', expandir: 'Expandir', mais_destaque: 'Mais destaque', menos_destaque: 'Menos destaque', aproximar_de: 'Aproximar de…', separar_de: 'Separar de…', alinhar_com: 'Alinhar com…', igual_a: 'Igual a…', virar_drawer: 'Virar drawer', virar_colapsavel: 'Virar colapsável' };
const TIPO_LABEL = { css: 'Ajuste CSS', estrutural: 'Estrutura', comentario: 'Comentário', referencia: 'Referência', estranho: 'Está estranho' };
const CHIPS = ['grande demais', 'chama atenção demais', 'parece vazio', 'desconectado', 'quero mais destaque', 'simplificar', 'não quero isso'];
const INICIAL_PROPS = ['width', 'height', 'padding', 'gap', 'margin-top', 'margin-bottom', 'font-size', 'font-weight', 'line-height', 'border-radius', 'min-height'];

/* ---- alvo: tudo que o agente precisa para achar o elemento, capturado sem o usuário escolher nada ---- */
function snapInicial(el, extra) {
  const o = {}; for (const p of INICIAL_PROPS) o[p] = comp(el, p);
  if (extra && !o[extra]) o[extra] = comp(el, extra);
  return o;
}
function stableSel(el) {
  const doc = el.ownerDocument, c = mainClass(el), cands = [];
  if (c) cands.push('.' + CSS.escape(c));
  if (el.id) cands.push('#' + CSS.escape(el.id));
  cands.push(domPath(el));
  for (const sel of cands) { let l = []; try { l = [...doc.querySelectorAll(sel)].filter(e => e !== host); } catch (e) {} const i = l.indexOf(el); if (i >= 0) return { seletor: sel, indice: i, contagem: l.length }; }
  return { seletor: domPath(el), indice: 0, contagem: 1 };
}
function domPath(el) {
  const segs = [];
  for (let n = el; n && n.nodeType === 1 && n !== n.ownerDocument.documentElement; n = n.parentElement) {
    if (n === n.ownerDocument.body) { segs.unshift('body'); break; }
    if (n.id && !/\d{4,}/.test(n.id)) { segs.unshift('#' + CSS.escape(n.id)); break; }
    const c = mainClass(n), k = [...n.parentElement.children].indexOf(n) + 1;
    segs.unshift(n.tagName.toLowerCase() + (c ? '.' + CSS.escape(c) : '') + `:nth-child(${k})`);
  }
  return segs.join(' > ');
}
const texto60 = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
function fonteCssOf(el) {
  const c = mainClass(el);
  const m = matchedRules(el).filter(([, i]) => i.line && i.kind !== 'scratch' && !i.isNew);
  if (!m.length) return { fonteCss: null, fonteCssMotivo: 'não resolvido: nenhuma regra de arquivo CSS casa com o elemento (estilo do navegador, herdado ou inline)' };
  const own = c ? m.filter(([r]) => r.selectorText.includes(c)) : [];
  const [r, i] = (own.length ? own : m)[(own.length ? own : m).length - 1];
  const extra = i.kind === 'built' ? ` — CSS gerado pelo Vite; ${i.reason}` : i.kind === 'protected' ? ' — arquivo protegido' : '';
  return { fonteCss: { arquivo: repoRel(i.file), linha: i.line, coluna: i.column, seletor: i.selectorSrc || r.selectorText, evidencia: `regra \`${i.selectorSrc || r.selectorText}\` casa com o elemento${own.length ? ` e contém a classe principal .${c}` : ' (a classe principal não aparece em nenhuma regra)'}${extra}` } };
}
function captureAlvo(el, reg, inicial) {
  const { seletor, indice, contagem } = stableSel(el), r = el.getBoundingClientRect(), par = el.parentElement;
  const a = { seletor, indice, contagem, nome: nameOf(el), caminhoDom: domPath(el), texto: texto60(el), larguraTela: window.innerWidth,
    rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
    ...fonteCssOf(el), componente: null,
    contexto: par && inPage(par) ? { pai: stableSel(par).seletor, paiNome: nameOf(par), irmaos: realKids(par).filter(k => k !== el).slice(0, 6).map(k => stableSel(k).seletor), posicao: realKids(par).indexOf(el) + 1, total: realKids(par).length } : {},
    inicial: inicial || snapInicial(el) };
  enrichAlvo(a, el);
  if (reg) {
    a.regiao = true;
    a.rect = { x: Math.round(reg.left + scrollX), y: Math.round(reg.top + scrollY), w: Math.round(reg.width), h: Math.round(reg.height) };
    a.offset = { fx: r.width ? (reg.left + reg.width / 2 - r.left) / r.width : 0.5, fy: r.height ? (reg.top + reg.height / 2 - r.top) / r.height : 0.5, fw: r.width ? reg.width / r.width : 1, fh: r.height ? reg.height / r.height : 1 };
  }
  return a;
}
/** Acha o elemento de um alvo em qualquer documento (a página ou um iframe da comparação). Sem palpite: ou acha, ou diz por quê. */
function resolveAlvo(alvo, doc = document) {
  if (!alvo) return { el: null, motivo: 'sem alvo' };
  try { const l = doc.querySelectorAll(alvo.seletor); const el = l[alvo.indice || 0]; if (el) return { el, via: 'seletor' }; } catch (e) {}
  try { const el = alvo.caminhoDom && doc.querySelector(alvo.caminhoDom); if (el) return { el, via: 'caminho DOM' }; } catch (e) {}
  return { el: null, motivo: `não resolvido: \`${alvo.seletor}\`${alvo.indice ? ` (nº ${alvo.indice + 1})` : ''} não existe nesta tela agora, e o caminho DOM também não` };
}
function pinPoint(alvo, el) {
  const r = el.getBoundingClientRect();
  if (alvo.regiao && alvo.offset) return { x: r.left + alvo.offset.fx * r.width, y: r.top + alvo.offset.fy * r.height };
  return { x: r.right - Math.min(12, r.width / 2), y: r.top + Math.min(12, r.height / 2) };
}

/* ---- ciclo de vida ---- */
function novaSessao(auto) {
  // não limpa a página: alterações feitas antes de existir sessão são adotadas por ela (quem troca de sessão limpa antes)
  const d = new Date(), dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0');
  const slug = htmlFile().replace(/\.html$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  SES = { id: `${d.toISOString().slice(0, 10)}-${slug}-${Math.random().toString(36).slice(2, 6)}`, titulo: `${(document.title || htmlFile()).trim().slice(0, 120)} — revisão visual ${dd}/${mm}`,
    pagina: htmlFile(), url: location.pathname + location.search + location.hash, status: 'em_andamento', objetivo: '', criadaEm: nowIso(), atualizadaEm: nowIso(),
    larguras: [1440, 768, 390], estados: [], itens: [], regressoes: [], verificacao: null, missao: null };
  try { sessionStorage.setItem(SSKEY, SES.id); } catch (e) {}
  sesSig = '';
  if (auto) toast(`Sessão nova criada: “${SES.titulo}”. Veja na aba Sessão.`, 4500);
  saveSoon(0);
}
function ensureSession() { if (!SES) novaSessao(true); return SES; }
/** Desfaz na página tudo o que está vivo (ao trocar de sessão), sem gravar nada. */
function clearLive() {
  for (const id of [...previews.keys()]) previewOff(id);
  for (const c of changes.values()) setDecl(c.rule, c.prop, c.before, c.prio);
  changes.clear(); undoS.length = 0; redoS.length = 0; cssItemKey.clear(); changeEl.clear(); resetCache();
  reapplyInfo = null; S.sesCompare = false; S.missaoMd = null; S.objDraft = null;
}
async function continuarSessao(id, quiet) {
  let s; try { s = await getJSON('/__vfdev/sessoes/' + encodeURIComponent(id)); } catch (e) { toast('Não abriu a sessão: ' + e.message, 6000); return; }
  clearLive();
  SES = s; if (SES.status === 'descartada') SES.status = 'em_andamento';
  try { sessionStorage.setItem(SSKEY, SES.id); } catch (e) {}
  reapplyCss();
  sesSig = ''; S.tab = S.tab === 'session' || !quiet ? 'session' : S.tab;
  render();
  const r = reapplyInfo;
  if (!quiet || (r && r.descartadas)) toast(`Sessão “${SES.titulo}”: ${SES.itens.length} itens${r && (r.ok || r.descartadas) ? ` · ${r.ok} ajuste(s) reaplicado(s)${r.descartadas ? ` · ${r.descartadas} descartado(s) porque a regra mudou` : ''}` : ''}.`, 5000);
}
function saveSoon(ms = 600) { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, ms); }
async function saveNow() {
  clearTimeout(saveTimer);
  if (!SES) return null;
  syncCssItems();
  try { const r = await api('PUT', '/__vfdev/sessoes/' + encodeURIComponent(SES.id), SES); SES.criadaEm = r.criadaEm; SES.atualizadaEm = r.atualizadaEm; sesErr = ''; }
  catch (e) { sesErr = e.message; toast('Sessão não salva: ' + e.message, 6000); }
  if (S.tab === 'session' && S.open && !(root.activeElement && root.activeElement.closest && root.activeElement.closest('#body'))) renderBody();
  return SES;
}
function sesSync() {
  const sig = [...changes].map(([k, c]) => k + '=' + c.after).join('|');
  if (sig === sesSig) return;
  sesSig = sig;
  if (!SES) { if (!changes.size) return; novaSessao(true); }
  syncCssItems(); saveSoon();
}

/* ---- itens css: espelho das alterações pendentes ---- */
const cssItemOf = key => { const id = cssItemKey.get(key); return id && SES ? SES.itens.find(i => i.id === id) : null; };
function cssBlock(c) {
  const info = ruleInfo.get(c.rule) || {}, d = info.decls && info.decls[c.prop];
  const b = { arquivo: info.kind === 'scratch' ? info.file : repoRel(info.file), linha: info.isNew || info.kind === 'scratch' ? null : (d ? d.line : info.line || null),
    seletor: c.rule.selectorText, seletorRegra: info.selectorSrc || c.rule.selectorText, prop: c.prop, antes: srcBefore(c) || '', depois: c.after || '',
    destino: info.writable ? 'pendente' : 'prompt', kind: info.kind || 'unknown', novo: !!info.isNew };
  if (info.line && !info.isNew) b.regra = { linha: info.line, coluna: info.column };
  if (info.cond) b.cond = info.cond;
  if (!info.writable && info.reason) b.motivo = info.reason;
  return b;
}
function syncCssItems() {
  if (!SES) return;
  const live = new Set();
  for (const [key, c] of changes) {
    let it = cssItemOf(key);
    const ce = changeEl.get(key), el = (ce && ce.el && ce.el.isConnected && ce.el) || matchesOf(c.rule.selectorText)[0];
    if (!it) {
      if (!el) continue;
      it = { id: uid(), tipo: 'css', criadoEm: nowIso(), alvo: captureAlvo(el, null, ce && ce.inicial) };
      SES.itens.push(it); cssItemKey.set(key, it.id);
    }
    it.css = { ...cssBlock(c), ...(el ? { computado: comp(el, c.prop) } : {}) };
    live.add(it.id);
  }
  SES.itens = SES.itens.filter(i => i.tipo !== 'css' || live.has(i.id) || ['gravado', 'descartada'].includes(i.css.destino));
}
/** Recoloca as alterações CSS pendentes de uma sessão salva. Se a regra mudou no disco, descarta com o motivo — nunca aplica "perto". */
function reapplyCss() {
  const out = { ok: 0, descartadas: 0, divergentes: [] };
  for (const it of SES.itens.filter(i => i.tipo === 'css' && ['pendente', 'prompt'].includes(i.css.destino))) {
    const c = it.css, found = ruleForCss(c);
    if (!found.rule) { c.destino = 'descartada'; c.motivo = found.motivo; out.descartadas++; continue; }
    const prio = ruleInfo.get(found.rule).kind === 'scratch' ? 'important' : null;
    const before = found.rule.style.getPropertyValue(c.prop).trim();
    if (before !== c.depois && !setRule(found.rule, c.prop, c.depois, prio)) { c.destino = 'descartada'; c.motivo = `descartada: “${c.depois}” não é aceito para ${c.prop}`; out.descartadas++; continue; }
    const key = keyOf(found.rule, c.prop); cssItemKey.set(key, it.id);
    const r = resolveAlvo(it.alvo);
    if (r.el) { changeEl.set(key, { el: r.el, inicial: it.alvo.inicial }); const now = comp(r.el, c.prop); if (c.computado && now !== c.computado) out.divergentes.push({ id: it.id, prop: c.prop, era: c.computado, agora: now }); }
    out.ok++;
  }
  undoS.length = 0; redoS.length = 0; resetCache();
  reapplyInfo = out;
  return out;
}
function ruleForCss(c) {
  const mudou = `descartada: regra mudou em ${c.arquivo}:${c.linha ?? (c.regra && c.regra.linha) ?? '?'}`;
  if (c.kind === 'scratch') return { rule: scratchRule(c.seletor, c.arquivo) };
  const file = portalRel(c.arquivo);
  if (c.novo) { const r = overrideRuleFor(file, c.seletorRegra); return r ? { rule: r } : { motivo: `descartada: ${c.arquivo} não está carregado nesta tela` }; }
  if (!c.regra) return { motivo: mudou };
  for (const [rule, i] of ruleInfo) {
    if (i.file !== file || i.line !== c.regra.linha || i.column !== c.regra.coluna || normSel(i.selectorSrc || '') !== normSel(c.seletorRegra)) continue;
    const cur = (i.decls[c.prop] || {}).value || '';
    if (cur !== (c.antes || '')) return { motivo: `${mudou} (no disco agora: ${c.prop}: ${cur || '(não existe)'}; esperado: ${c.antes || '(não existe)'})` };
    return { rule };
  }
  return { motivo: mudou };
}

/* ---- comentários ("aponta e fala") ---- */
const comentarios = () => SES ? SES.itens.filter(i => i.tipo === 'comentario') : [];
function openTalk(target) {
  const t = root.getElementById('talk');
  S.talk = target;
  const it = target.itemId && SES && SES.itens.find(i => i.id === target.itemId);
  const el = target.el || (it && resolveAlvo(it.alvo).el);
  root.getElementById('talk-h').innerHTML = it ? `Comentário <b>#${comentarios().indexOf(it) + 1}</b> · ${esc(it.alvo.nome || it.alvo.seletor)}${it.comentario.resolvido ? ' · <span class="badge">resolvido</span>' : ''}` : `Falar sobre <b>${esc(target.region ? 'esta região' : nameOf(el))}</b>`;
  const ta = root.getElementById('talk-text'); ta.value = it ? it.comentario.texto : '';
  root.getElementById('talk-del').hidden = !it; root.getElementById('talk-resolve').hidden = !it;
  root.getElementById('talk-resolve').textContent = it && it.comentario.resolvido ? 'Reabrir' : 'Resolver';
  const r = target.region ? target.region.rect : el ? el.getBoundingClientRect() : { left: 100, bottom: 100, top: 100 };
  const w = Math.min(340, innerWidth - 24), below = r.bottom + 190 < innerHeight;
  Object.assign(t.style, { left: clamp(r.left, 12, innerWidth - w - 12) + 'px', top: (below ? r.bottom + 8 : Math.max(12, r.top - 200)) + 'px', width: w + 'px' });
  t.hidden = false; ta.focus();
  draw();
}
function closeTalk() { root.getElementById('talk').hidden = true; S.talk = null; S.region = null; draw(); }
function saveTalk() {
  const txt = root.getElementById('talk-text').value.trim(), T0 = S.talk;
  if (!T0) return;
  if (T0.itemId) { const it = SES.itens.find(i => i.id === T0.itemId); if (it && txt) it.comentario.texto = txt; }
  else {
    if (!txt) return toast('Escreva o que te incomoda (ou use um dos atalhos).');
    const el = T0.el; if (!inPage(el)) return toast('O elemento sumiu da página.');
    ensureSession();
    const alvo = captureAlvo(el, T0.region && T0.region.rect);
    const p = pinPoint(alvo, el);
    SES.itens.push({ id: uid(), tipo: 'comentario', criadoEm: nowIso(), alvo, comentario: { texto: txt, ponto: { x: Math.round(p.x + scrollX), y: Math.round(p.y + scrollY) }, resolvido: false } });
  }
  closeTalk(); saveSoon(0); render();
}
function comentar(el, texto, rect) { S.talk = { el, region: rect ? { rect } : null }; root.getElementById('talk-text').value = texto; saveTalk(); return SES.itens[SES.itens.length - 1]; }
/** Região marcada com Shift+arrastar: o alvo é o menor elemento que contém a região inteira. */
function regionContainer(rect) {
  let el = pageElementAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
  while (inPage(el) && el !== document.body) {
    const r = el.getBoundingClientRect();
    if (r.left <= rect.left + 2 && r.top <= rect.top + 2 && r.right >= rect.right - 2 && r.bottom >= rect.bottom - 2) return el;
    el = el.parentElement;
  }
  return document.body;
}

/* ---- ações estruturais: sempre missão, nunca CSS ---- */
function estrutural(el, acao, rel) {
  const E = CFG.estrutura || { comRelacao: [], criterios: {} };
  if (E.comRelacao.includes(acao) && !rel) { S.pick = { acao, el }; toast(`${ACAO_LABEL[acao]} — agora clique no elemento relacionado na página (Esc cancela).`, 6000); render(); return null; }
  ensureSession();
  const it = { id: uid(), tipo: 'estrutural', criadoEm: nowIso(), alvo: captureAlvo(el), estrutural: { acao, criterios: [...(E.criterios[acao] || [])] } };
  if (rel) it.estrutural.relacionado = captureAlvo(rel);
  SES.itens.push(it); S.pick = null;
  saveSoon(0); render();
  toast(`Registrado: ${ACAO_LABEL[acao].replace('…', '')} ${nameOf(el)}${rel ? ' / ' + nameOf(rel) : ''}. Vai para a missão — nada foi gravado.`, 4500);
  return it;
}
const temPrevia = acao => acao === 'remover' || acao === 'mover_antes' || acao === 'mover_depois';
function previewOn(id) {
  const it = SES && SES.itens.find(i => i.id === id); if (!it || previews.has(id)) return false;
  const { el } = resolveAlvo(it.alvo); if (!el) { toast('Prévia indisponível: ' + resolveAlvo(it.alvo).motivo); return false; }
  const a = it.estrutural.acao;
  if (a === 'remover') {
    const had = el.hasAttribute('style'), old = el.getAttribute('style');
    el.style.setProperty('visibility', 'hidden');
    previews.set(id, { el, kind: 'hide', off: () => { if (had && old) el.setAttribute('style', old); else el.removeAttribute('style'); } });
  } else if (a === 'mover_antes' || a === 'mover_depois') {
    const rel = resolveAlvo(it.estrutural.relacionado).el; if (!rel || rel.contains(el) || el.contains(rel)) { toast('Prévia indisponível: elemento relacionado não resolvido.'); return false; }
    const par = el.parentNode, next = el.nextSibling;
    rel.parentNode.insertBefore(el, a === 'mover_antes' ? rel : rel.nextSibling);
    previews.set(id, { el, kind: 'move', off: () => { if (par.isConnected) par.insertBefore(el, next && next.parentNode === par ? next : null); } });
  } else return false;
  render(); return true;
}
function previewOff(id) { const p = previews.get(id); if (!p) return; previews.delete(id); p.off(); draw(); }

/* ---- comparar com o início ---- */
function diffInicio(it) {
  const alvos = it.tipo === 'referencia' ? [] : [it.alvo];
  const out = [];
  for (const a of alvos) {
    if (!a || !a.inicial) continue;
    const { el, motivo } = resolveAlvo(a);
    if (!el) { out.push({ motivo }); continue; }
    for (const [p, v] of Object.entries(a.inicial)) { const now = comp(el, p); if (now !== v) out.push({ prop: p, antes: v, agora: now }); }
  }
  return out;
}

/* ---- missão: objetivo, geração e verificação ---- */
async function pedirObjetivo() {
  if (!SES) return;
  await saveNow();
  let draft = SES.objetivo || '';
  if (!draft) { try { draft = (await getJSON(`/__vfdev/missoes/${encodeURIComponent(SES.id)}/rascunho`)).objetivo; } catch (e) { toast('Rascunho indisponível: ' + e.message); } }
  S.objDraft = { texto: draft, sugerido: !SES.objetivo && !!draft };
  S.tab = 'session'; render();
  const t = root.getElementById('obj-text'); if (t) { t.focus(); t.select(); }
}
async function gerarMissao(objetivo) {
  objetivo = String(objetivo || '').trim();
  if (!objetivo) { toast('Escreva o Objetivo em 1 frase antes de gerar.'); return null; }
  SES.objetivo = objetivo; await saveNow();
  let r; try { r = await postJSON(`/__vfdev/missoes/${encodeURIComponent(SES.id)}`, { objetivo }); } catch (e) { toast('Missão não gerada: ' + e.message, 6000); return null; }
  Object.assign(SES, { status: r.sessao.status, missao: r.sessao.missao, verificacao: null, objetivo: r.sessao.objetivo, atualizadaEm: r.sessao.atualizadaEm });
  S.objDraft = null; S.missaoMd = r.md; S.verif = null;
  render(); openDrawer('missao');
  toast(`Missão gerada: ${r.arquivos.join(' e ')}.`, 5000);
  return r;
}
/** Carrega a página, sem o editor e sem as alterações pendentes, num iframe fora da tela com a largura pedida. */
function frameAt(width, url) {
  return new Promise(resolve => {
    let box = root.getElementById('vbox');
    if (!box) { box = document.createElement('div'); box.id = 'vbox'; box.className = 'vbox'; root.querySelector('.wrap').appendChild(box); }
    const f = document.createElement('iframe');
    const u = new URL(url || location.href, location.href); u.searchParams.set('vfdev', 'off');
    f.style.cssText = `width:${width}px;height:900px;border:0`; f.src = u.href; f.title = `verificação ${width}px`;
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(f); } };
    f.addEventListener('load', () => {
      let doc; try { doc = f.contentDocument; } catch (e) { return finish(); }
      let quiet = 0, t0 = Date.now();
      const mo = new f.contentWindow.MutationObserver(() => { quiet = Date.now(); }); mo.observe(doc.documentElement, { subtree: true, childList: true, attributes: true });
      quiet = Date.now();
      const tick = () => { if (Date.now() - quiet > 350 || Date.now() - t0 > 6000) { mo.disconnect(); finish(); } else setTimeout(tick, 100); };
      setTimeout(tick, 150);
    }, { once: true });
    setTimeout(finish, 15000);
    box.appendChild(f);
  });
}
function runCheck(v, doc) {
  const q = sel => { try { return [...doc.querySelectorAll(sel)]; } catch (e) { return null; } };
  const byText = (l, t) => t ? l.filter(e => texto60(e).startsWith(String(t).slice(0, 20))) : l;
  if (v.tipo === 'computado') {
    const l = q(v.seletor); if (!l) return { ok: false, obtido: 'seletor inválido' };
    const el = l[v.indice || 0]; if (!el) return { ok: false, obtido: `elemento não encontrado (${l.length} com esse seletor)` };
    const o = comp(el, v.prop); return { ok: o === v.esperado, obtido: o };
  }
  if (v.tipo === 'ausente' || v.tipo === 'presente') {
    const l = q(v.seletor); if (!l) return { ok: false, obtido: 'seletor inválido' };
    const n = byText(l, v.texto).length;
    return v.tipo === 'ausente' ? { ok: n === 0, obtido: n ? `${n} ainda na página` : 'ausente' } : { ok: n > 0, obtido: n ? `${n} na página` : 'não encontrado' };
  }
  if (v.tipo === 'ordem') {
    const els = v.seletores.map((sel, i) => { const l = q(sel) || []; return byText(l, (v.textos || [])[i])[0] || null; });
    if (els.some(e => !e)) return { ok: false, obtido: `não encontrado: ${v.seletores.filter((_, i) => !els[i]).join(', ')}` };
    if (v.pai && !els.every(e => e.closest(v.pai))) return { ok: false, obtido: `fora de \`${v.pai}\`` };
    const ok = els.every((e, i) => i === 0 || (els[i - 1].compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING));
    return { ok, obtido: ok ? 'na ordem' : 'fora de ordem' };
  }
  if (v.tipo === 'igual') {
    const A = (q(v.a) || [])[0], B = (q(v.b) || [])[0];
    if (!A || !B) return { ok: false, obtido: `não encontrado: ${!A ? v.a : v.b}` };
    const d = v.props.filter(p => comp(A, p) !== comp(B, p));
    return { ok: !d.length, obtido: d.length ? d.map(p => `${p}: ${comp(B, p)} ≠ ${comp(A, p)}`).join('; ') : 'iguais' };
  }
  if (v.tipo === 'sem-overflow') {
    const e = doc.documentElement, over = e.scrollWidth - e.clientWidth;
    return { ok: over <= 1, obtido: over > 1 ? `${over}px de rolagem horizontal` : 'sem overflow' };
  }
  return { ok: false, obtido: `tipo desconhecido: ${v.tipo}` };
}
async function verificarMissao() {
  if (!SES || !SES.missao) return toast('Gere a missão antes de verificar.');
  let m; try { m = await getJSON(`/__vfdev/missoes/${encodeURIComponent(SES.id)}`); } catch (e) { return toast('Missão não encontrada: ' + e.message, 6000); }
  S.verificando = true; render();
  const W = window.innerWidth, groups = new Map();
  for (const v of m.verificacoes) { const w = v.largura || W; if (!groups.has(w)) groups.set(w, []); groups.get(w).push(v); }
  const resultados = [];
  for (const [w, list] of [...groups].sort((a, b) => b[0] - a[0])) {
    const f = await frameAt(w);
    let doc = null; try { doc = f.contentDocument; } catch (e) {}
    for (const v of list) resultados.push({ ...v, largura: w, ...(doc ? runCheck(v, doc) : { ok: false, obtido: 'página não carregou no iframe' }) });
    f.remove();
  }
  resultados.sort((a, b) => +a.id.slice(1) - +b.id.slice(1));
  const falhas = resultados.filter(r => !r.ok).length, est = SES.estados || [];
  const estadosOk = est.every(e => e.validadoEm);
  SES.verificacao = { em: nowIso(), largura: W, ok: resultados.length - falhas, falhas, estadosPendentes: est.filter(e => !e.validadoEm).length, resultados };
  SES.status = !falhas && estadosOk ? 'verificada' : 'missao_gerada';
  S.verificando = false;
  await saveNow(); render();
  toast(falhas ? `Verificação: ${resultados.length - falhas} ✓ · ${falhas} ✗` : estadosOk ? `Tudo verificado ✓ (${resultados.length})` : `Verificações ✓, mas ${est.filter(e => !e.validadoEm).length} estado(s) sem validar.`, 5000);
  return SES.verificacao;
}
function verificacaoHTML() {
  const V = SES.verificacao; if (!V) return '';
  const it = id => { const k = SES.itens.findIndex(i => i.id === id); return k < 0 ? '' : `#${k + 1} `; };
  let h = `<div class="verif"><div class="eyebrow">Verificação · ${new Date(V.em).toLocaleString()} · ${V.ok} ✓ · ${V.falhas} ✗</div>`;
  for (const r of V.resultados) h += `<div class="vr ${r.ok ? 'ok' : 'ko'}"><span class="vmark">${r.ok ? '✓' : '✗'}</span><span>${esc(it(r.item))}${esc(r.descricao || r.tipo)}${r.tipo !== 'sem-overflow' ? ` <small>(${r.largura}px)</small>` : ''}<br><small>obtido: <b>${esc(r.obtido)}</b>${!r.ok && r.esperado ? ` · esperado: <b>${esc(r.esperado)}</b>` : ''}</small></span></div>`;
  if (V.estadosPendentes) h += `<div class="warnline">${V.estadosPendentes} estado(s) ainda sem validar — a sessão só fica “verificada” com todos validados.</div>`;
  return h + '</div>';
}

/* ---- aba Sessão ---- */
function counters() {
  const n = t => SES.itens.filter(i => i.tipo === t && !(t === 'css' && i.css.destino === 'descartada')).length;
  const est = SES.estados || [];
  return [['Ajustes CSS', n('css')], ['Estruturais', n('estrutural')], ['Comentários', n('comentario')], ['Referências', n('referencia')], ['Estados validados', `${est.filter(e => e.validadoEm).length}/${est.length}`], ['Regressões', (SES.regressoes || []).length]];
}
const STATUS_LABEL = { em_andamento: 'em andamento', missao_gerada: 'missão gerada', verificada: 'verificada', descartada: 'descartada' };
function itemCard(it, n) {
  const a = it.alvo || (it.referencia && it.referencia.b) || {};
  const r = it.tipo === 'referencia' ? { el: null } : resolveAlvo(a);
  let h = `<div class="item" data-item="${esc(it.id)}"><div class="item-h"><span class="num">${n}</span><span class="badge">${TIPO_LABEL[it.tipo]}</span><b>${esc(a.nome || a.seletor || '')}</b>`;
  h += `<span class="grow"></span>${r.el ? `<button class="btn sm" data-act="item-ver" data-id="${esc(it.id)}">Ver</button>` : ''}<button class="btn sm" data-act="item-del" data-id="${esc(it.id)}">Apagar</button></div>`;
  if (it.tipo === 'css') {
    const c = it.css, dest = { gravado: 'feito — já gravado', pendente: 'pendente (gravável)', prompt: 'a fazer (só prompt)', descartada: 'descartada' }[c.destino];
    h += `<div class="mono">${esc(c.arquivo)}${c.linha ? ':' + c.linha : ''} · <code>${esc(c.seletorRegra)}</code></div><div class="mono">${esc(c.prop)}: <span class="del">${esc(c.antes || '(não existe)')}</span> → <span class="add">${esc(c.depois || '(remover)')}</span> · ${esc(dest)}</div>`;
    if (c.destino === 'descartada') h += `<div class="warnline">${esc(c.motivo || '')}</div>`;
    const dv = reapplyInfo && reapplyInfo.divergentes.find(d => d.id === it.id);
    if (dv) h += `<div class="warnline">Reaplicado, mas o valor computado agora é ${esc(dv.agora)} (na captura era ${esc(dv.era)}).</div>`;
    h += `<input class="why" data-why-item="${esc(it.id)}" placeholder="Por quê? (opcional)" value="${esc(it.nota || '')}" aria-label="Por quê?">`;
  } else if (it.tipo === 'comentario') {
    h += `<p class="quote${it.comentario.resolvido ? ' done' : ''}">“${esc(it.comentario.texto)}”</p>`;
  } else if (it.tipo === 'estrutural') {
    const e = it.estrutural;
    h += `<div><b>${esc(ACAO_LABEL[e.acao].replace('…', ''))}</b>${e.relacionado ? ` → ${esc(e.relacionado.nome || e.relacionado.seletor)} <code>${esc(e.relacionado.seletor)}</code>` : ''}</div>`;
    h += `<label class="crit">Critérios (um por linha, editáveis)<textarea data-crit="${esc(it.id)}" rows="${Math.max(2, e.criterios.length)}">${esc(e.criterios.join('\n'))}</textarea></label>`;
    if (temPrevia(e.acao)) h += `<div class="actions"><button class="btn sm${previews.has(it.id) ? ' on' : ''}" data-act="previa" data-id="${esc(it.id)}">${previews.has(it.id) ? 'Desligar prévia' : 'Ver prévia'}</button><span class="hint">prévia — não será gravada</span></div>`;
  } else if (it.tipo === 'referencia') {
    h += `<div>${it.referencia.diferencas.length} diferença(s) em relação a ${esc(it.referencia.a.nome || it.referencia.a.seletor)}</div>`;
  } else if (it.tipo === 'estranho') {
    h += `<ul class="facts">${it.estranho.achados.map(f => `<li>${esc(f.fato)}</li>`).join('')}</ul>`;
  }
  if (it.tipo !== 'css' && it.tipo !== 'comentario') h += `<input class="why" data-why-item="${esc(it.id)}" placeholder="Por quê? (opcional)" value="${esc(it.nota || '')}" aria-label="Por quê?">`;
  if (it.tipo !== 'referencia') {
    if (!r.el) h += `<div class="warnline">${esc(r.motivo)}</div>`;
    const f = a.fonteCss;
    h += `<div class="meta">CSS: ${f ? `<span class="mono">${esc(f.arquivo)}:${f.linha}</span>` : esc(a.fonteCssMotivo || 'não resolvido')}</div>`;
  }
  if (S.sesCompare && it.tipo !== 'referencia') {
    const d = diffInicio(it);
    h += `<div class="cmpini">${d.length ? d.map(x => x.motivo ? esc(x.motivo) : `<span class="mono">${esc(x.prop)}: <span class="del">${esc(x.antes)}</span> → <span class="add">${esc(x.agora)}</span></span>`).join('<br>') : 'sem diferença desde a primeira captura'}</div>`;
  }
  return h + '</div>';
}
function sessionPanel() {
  if (!SES) {
    const vivas = sesOffer.filter(s => s.status === 'em_andamento'), outras = sesOffer.filter(s => s.status !== 'em_andamento' && s.status !== 'descartada');
    let h = `<div class="empty"><b>Sessão de revisão</b><span>Tudo o que você apontar, comentar ou ajustar fica numa sessão salva no servidor. Ela vira a <b>missão</b> para o agente.</span></div>`;
    if (sesErr) h += `<div class="warnline">${esc(sesErr)}</div>`;
    for (const s of vivas) h += `<button class="btn pri wide" data-act="ses-cont" data-id="${esc(s.id)}">Continuar sessão “${esc(s.titulo)}” <small>${s.itens} itens</small></button>`;
    h += `<button class="btn wide" data-act="ses-new">Nova sessão</button>`;
    if (outras.length) h += `<details class="more"><summary>${outras.length} sessão(ões) com missão gerada/verificada</summary>${outras.map(s => `<button class="btn wide" data-act="ses-cont" data-id="${esc(s.id)}">${esc(s.titulo)} <small>${STATUS_LABEL[s.status]}</small></button>`).join('')}</details>`;
    return h;
  }
  let h = `<div class="ses-head"><input id="ses-title" class="ses-title" value="${esc(SES.titulo)}" aria-label="Título da sessão"><span class="badge st-${SES.status}">${STATUS_LABEL[SES.status]}</span></div>`;
  h += `<div class="counters">${counters().map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')}</div>`;
  h += `<div class="actions"><button class="btn sm" data-act="ses-save">Salvar</button><button class="btn sm" data-act="ses-switch">Continuar outra</button><button class="btn sm" data-act="ses-dup">Duplicar</button><button class="btn sm" data-act="ses-ren">Renomear</button><button class="btn sm" data-act="ses-disc">Descartar</button><button class="btn sm${S.sesCompare ? ' on' : ''}" data-act="ses-cmp">Comparar com o início</button></div>`;
  h += `<div class="actions"><button class="btn sm pri" data-act="mis-gerar">${SES.missao ? 'Gerar missão de novo' : 'Gerar missão'}</button><button class="btn sm" data-act="mis-ver"${SES.missao ? '' : ' disabled'}>Ver missão</button><button class="btn sm" data-act="mis-verif"${SES.missao && !S.verificando ? '' : ' disabled'}>${S.verificando ? 'Verificando…' : 'Verificar missão'}</button></div>`;
  h += intencaoHTML();
  if (S.objDraft) h += `<div class="obj"><label for="obj-text"><b>Objetivo</b> — 1 frase${S.objDraft.sugerido ? ' · <small>rascunho montado por regras a partir dos itens; confirme ou edite</small>' : ''}</label><textarea id="obj-text" rows="3">${esc(S.objDraft.texto)}</textarea><div class="actions"><button class="btn sm pri" data-act="obj-ok">Confirmar e gerar</button><button class="btn sm" data-act="obj-save">Só salvar o objetivo</button><button class="btn sm" data-act="obj-cancel">Cancelar</button></div></div>`;
  else if (SES.objetivo) h += `<div class="meta">Objetivo: <b>${esc(SES.objetivo)}</b></div>`;
  if (SES.missao) h += `<div class="meta">Missão: <span class="mono">${esc(SES.missao.md)}</span> · ${SES.missao.verificacoes} verificações</div>`;
  h += verificacaoHTML();
  h += `<div class="meta">Salva em <span class="mono">tools/vfdev/sessoes/${esc(SES.id)}.json</span>${SES.atualizadaEm ? ` · ${new Date(SES.atualizadaEm).toLocaleTimeString()}` : ''}</div>`;
  if (sesErr) h += `<div class="warnline">${esc(sesErr)}</div>`;
  if (!SES.itens.length) h += `<div class="ok">Sessão vazia. Selecione algo e aperte <kbd>C</kbd> para falar sobre ele, use <b>Estrutura</b> no Painel, ou ajuste o CSS.</div>`;
  const cc = comentarios();
  SES.itens.forEach((it, k) => { h += itemCard(it, it.tipo === 'comentario' ? '💬' + (cc.indexOf(it) + 1) : '#' + (k + 1)); });
  return h;
}
function estruturaHTML(el) {
  const E = CFG.estrutura; if (!E) return '';
  return `<details class="more estr"${S.pick ? ' open' : ''}><summary>Estrutura — vira missão, nunca CSS</summary><div class="estr-grid">${E.acoes.map(a => `<button class="btn sm" data-act="estr" data-acao="${a}" data-t="${T(el)}">${esc(ACAO_LABEL[a])}</button>`).join('')}</div>${S.pick ? `<div class="warnline">Esperando o clique no elemento relacionado para “${esc(ACAO_LABEL[S.pick.acao])}” (Esc cancela).</div>` : ''}</details>`;
}
function showWhy(key, el, prop) {
  S.why = { key, el, prop };
  setTimeout(() => {
    if (!S.why || S.why.key !== key) return;
    const i = root.querySelector(`input.why[data-why-key="${CSS.escape(key)}"]`);
    if (i && (i.value.trim() || root.activeElement === i)) return;
    S.why = null; if (i && i.closest('.row')) i.remove();
  }, 6000);
}

/* ================= 14c. CSS ao vivo, rebuild das ilhas e histórico de gravações ================= */
/* O servidor avisa (SSE) quando um .css muda no disco — inclusive quando o agente edita os arquivos.
 * A página troca o href do <link> (com ?v=) e reindexa, sem F5. */
let evs = null;
const pendentesEm = file => [...changes.values()].filter(c => { const i = ruleInfo.get(c.rule) || {}; return i.file === file || i.bundle === file; }).length;
function linksOf(test) { return [...document.querySelectorAll('link[rel~="stylesheet"]')].filter(l => { if (l.dataset.vfdevLoading) return false; const f = relFromHref(l.href); return f && test(f); }); }
function swapLink(link, href) {
  return new Promise(resolve => {
    const u = new URL(href || link.getAttribute('href'), location.href); u.searchParams.set('v', Date.now().toString(36));
    const nl = link.cloneNode(); nl.href = u.href; nl.dataset.vfdevLoading = '1';
    const done = async ok => {
      delete nl.dataset.vfdevLoading;
      if (!ok) { nl.remove(); return resolve(false); }
      const old = link.sheet;
      for (const [r] of [...ruleInfo]) if (r.parentStyleSheet === old) ruleInfo.delete(r);
      link.remove(); overrides.clear();
      await indexSheet(nl.sheet, true); readTokens(); resetCache(); render();
      resolve(true);
    };
    nl.addEventListener('load', () => done(true), { once: true });
    nl.addEventListener('error', () => done(false), { once: true });
    link.after(nl);
  });
}
/* eventos de CSS são tratados em fila: uma gravação seguida de um desfazer não pode trocar o <link> fora de ordem */
let liveQueue = Promise.resolve();
function onCssChanged(file) { liveQueue = liveQueue.then(() => handleCssChanged(file)).catch(e => console.warn('[vfdev] CSS ao vivo:', e)); return liveQueue; }
async function handleCssChanged(file) {
  if (S.building && file.startsWith(`assets/${S.building}/`)) return;   // o rebuild troca o bundle no fim
  if (file.startsWith('frontend-react/')) {
    const ms = [...fileMeta.values()].filter(m => (m.sources || []).includes(file));
    if (!ms.length) return;
    await reindexFile(file); render();
    S.live = { file, em: Date.now(), msg: `fonte mudou — a tela só reflete depois do rebuild de ${[...new Set(ms.map(m => m.ilha))].join(', ')}` };
    return;
  }
  const links = linksOf(f => f === file); if (!links.length) return;
  const n = pendentesEm(file);
  if (n) { toast(`${file} mudou no disco, mas você tem ${n} alteração(ões) pendente(s) nele. Grave ou reverta e use “Recarregar CSS”.`, 6000); S.live = { file, em: Date.now(), msg: 'mudou no disco — recarga adiada (há alterações pendentes)' }; return; }
  for (const l of links) await swapLink(l);
  S.live = { file, em: Date.now(), msg: 'recarregado do disco' };
  window.__VFDEV__.lastLive = S.live;
}
function connectEvents() {
  if (evs || typeof EventSource === 'undefined') return;
  evs = new EventSource('/__vfdev/events?t=' + encodeURIComponent(TOKEN));
  evs.addEventListener('css', e => { try { onCssChanged(JSON.parse(e.data).file); } catch (x) {} });
  evs.addEventListener('rebuild', e => { const d = JSON.parse(e.data); S.buildLog = (S.buildLog || []).concat(d.linha).slice(-300); const b = root.getElementById('dbody'); if (b && root.getElementById('drawer').dataset.tab === 'build' && !root.getElementById('drawer').hidden) { const pre = root.getElementById('blog'); if (pre) { pre.textContent = S.buildLog.join('\n'); pre.scrollTop = pre.scrollHeight; } } });
  evs.addEventListener('rebuild-fim', e => onRebuildFim(JSON.parse(e.data)));
}
async function rebuildIlha(ilha) {
  if (!ilha) return toast('Esta regra não pertence a uma ilha React.');
  S.buildLog = []; S.buildFim = null;
  try { await postJSON('/__vfdev/rebuild', { ilha }); } catch (e) { toast('Rebuild não iniciou: ' + e.message, 7000); return false; }
  S.building = ilha; openDrawer('build'); render();
  return true;
}
async function onRebuildFim(d) {
  S.building = null; S.buildFim = d;
  const dr = root.getElementById('drawer'); if (!dr.hidden && dr.dataset.tab === 'build') openDrawer('build');
  if (!d.ok) { toast(`Rebuild de ${d.ilha} falhou (código ${d.codigo}). Veja as últimas linhas na gaveta.`, 8000); openDrawer('build'); render(); return; }
  const n = linksOf(f => f.startsWith(`assets/${d.ilha}/`)).reduce((a, l) => a + pendentesEm(relFromHref(l.href)), 0);
  let html = '';
  try { const u = new URL(location.href); u.searchParams.set('vfdev', 'off'); html = await (await fetch(u.href, { cache: 'no-store' })).text(); } catch (e) {}
  const novo = [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('link[rel~="stylesheet"]')].map(l => l.getAttribute('href')).filter(h => relFromHref(h) && relFromHref(h).startsWith(`assets/${d.ilha}/`));
  const atuais = linksOf(f => f.startsWith(`assets/${d.ilha}/`));
  if (!novo.length || !atuais.length) { toast(`Rebuild ok, mas não achei o <link> do CSS de ${d.ilha} ${!novo.length ? 'no .html novo' : 'nesta página'}.`, 7000); render(); return; }
  if (n) { toast(`Rebuild ok, mas há ${n} alteração(ões) pendente(s) no CSS desta ilha — grave ou reverta antes de trocar o bundle.`, 8000); render(); return; }
  await swapLink(atuais[0], novo[0]);
  for (const l of atuais.slice(1)) l.remove();
  toast(`Rebuild de ${d.ilha} ok em ${(d.ms / 1000).toFixed(1)} s — CSS trocado sem F5.`, 5000);
  window.__VFDEV__.lastRebuild = { ...d, href: novo[0] };
  render();
}
async function loadHist() {
  try {
    const h = (await getJSON('/__vfdev/historico')).gravacoes;
    const files = [...new Set(h.filter(g => !g.desfeitoEm).flatMap(g => g.arquivos))];
    let git = { arquivos: [] };
    if (files.length) try { git = await getJSON('/__vfdev/git?files=' + encodeURIComponent(files.join(','))); } catch (e) { git = { erro: e.message, arquivos: [] }; }
    S.hist = { gravacoes: h, git };
  } catch (e) { S.hist = { erro: e.message, gravacoes: [], git: { arquivos: [] } }; }
  if (S.tab === 'changes') renderBody();
}
async function desfazerGravacao(id) {
  let r; try { r = await postJSON(`/__vfdev/historico/${encodeURIComponent(id)}/desfazer`, {}); } catch (e) { toast('Não desfez: ' + e.message, 7000); return null; }
  if (SES) { for (const it of SES.itens) if (it.tipo === 'css' && it.css.historico === id) { it.css.destino = 'descartada'; it.css.motivo = `gravação desfeita em ${r.desfeitoEm.slice(0, 16).replace('T', ' ')}`; } saveSoon(0); }
  for (const f of r.arquivos) {
    const bundles = f.startsWith('frontend-react/') ? [...fileMeta].filter(([, m]) => (m.sources || []).includes(f)).map(([b]) => b) : [];
    for (const b of bundles) if (!pendentesEm(b)) for (const l of linksOf(x => x === b)) await swapLink(l);
  }
  S.hist = null; toast(`Gravação desfeita: ${r.arquivos.join(', ')} voltou ao conteúdo anterior.`, 5000); render();
  return r;
}
function gitCmds() {
  const g = S.hist && S.hist.git;
  const files = (g && g.arquivos || []).filter(a => a.status !== '').map(a => a.repo);
  if (!files.length) return '';
  const msg = `style(${htmlFile().replace(/\.html$/, '')}): ${SES && SES.objetivo ? SES.objetivo : 'ajustes visuais via VF DevTools'}`.replace(/"/g, "'");
  return files.map(f => `git add ${f}`).join('\n') + `\ngit commit -m "${msg}"`;
}
function histHTML() {
  if (!S.hist) { loadHist(); return '<div class="meta">Carregando gravações…</div>'; }
  const H = S.hist; if (H.erro) return `<div class="warnline">Histórico indisponível: ${esc(H.erro)}</div>`;
  if (!H.gravacoes.length) return '';
  const st = new Map((H.git.arquivos || []).map(a => [a.file, a]));
  const GIT = { ' M': 'modificado', 'M ': 'no stage', 'MM': 'modificado (parte no stage)', '??': 'novo', '': 'sem mudança no git' };
  let h = `<div class="group">Gravações</div>${H.git.erro ? `<div class="warnline">${esc(H.git.erro)}</div>` : ''}`;
  for (const g of H.gravacoes.slice(0, 12)) {
    h += `<div class="chg"><div class="chg-main"><span class="mono">${new Date(g.em).toLocaleTimeString()} · ${g.arquivos.map(f => { const a = st.get(f); return `${esc(f)}${a && a.status != null && !g.desfeitoEm ? ` <span class="badge">${esc(GIT[a.status] || a.status)}</span>` : ''}`; }).join('<br>')}</span></div>${g.desfeitoEm ? '<span class="badge">desfeita</span>' : `<button class="btn sm" data-act="undo-grav" data-id="${esc(g.id)}">Desfazer gravação</button>`}</div>`;
  }
  const cmds = gitCmds();
  if (cmds) h += `<button class="btn sm" data-act="git-cmds">Copiar comandos git</button>`;
  const ilhas = [...new Set(H.gravacoes.filter(g => !g.desfeitoEm).flatMap(g => g.arquivos).filter(f => f.startsWith('frontend-react/')).flatMap(f => [...fileMeta.values()].filter(m => (m.sources || []).includes(f)).map(m => m.ilha)))];
  for (const il of ilhas) h += `<button class="btn sm" data-act="rebuild" data-ilha="${esc(il)}"${S.building ? ' disabled' : ''}>${S.building === il ? 'Reconstruindo…' : `Rebuild ${esc(il)}`}</button>`;
  return h;
}

/* ================= 14d. "Nasceu onde?", referência visual e intenção maior ================= */
const origemCache = new WeakMap();   // elemento -> Promise<{ candidatos, motivo }>
function origemOf(el) {
  if (!origemCache.has(el)) {
    const classes = [...el.classList].filter(c => !/^vf-page/.test(c));
    const q = `/__vfdev/origem?classes=${encodeURIComponent(classes.join(','))}&texto=${encodeURIComponent(texto60(el).slice(0, 40))}`;
    origemCache.set(el, getJSON(q).catch(e => ({ candidatos: [], motivo: 'não resolvido: busca falhou — ' + e.message })));
  }
  return origemCache.get(el);
}
/** Preenche alvo.componente depois (a busca é assíncrona). Sem candidato, grava o motivo. */
function enrichAlvo(alvo, el) {
  if (!alvo || !el) return;
  alvo.componenteMotivo = 'busca de componente em andamento';
  origemOf(el).then(r => {
    const c = r.candidatos && r.candidatos[0];
    if (c) { alvo.componente = { arquivo: c.arquivo, linha: c.linha, evidencia: c.evidencia, trecho: c.trecho }; delete alvo.componenteMotivo; }
    else { alvo.componente = null; alvo.componenteMotivo = r.motivo || 'não resolvido'; }
    if (SES) saveSoon();
  });
}
/** Árvore de componentes React a partir das fibras — só quando os nomes NÃO estão minificados. */
function reactTree(el) {
  let n = el, key = null;
  for (; n && n !== document.documentElement; n = n.parentElement) { key = Object.keys(n).find(k => k.startsWith('__reactFiber$')); if (key) break; }
  if (!key) return { motivo: 'sem React nesta parte da página' };
  const names = [];
  for (let f = n[key]; f && names.length < 40; f = f.return) {
    const t = f.type; let nm = null;
    if (typeof t === 'function') nm = t.displayName || t.name;
    else if (t && typeof t === 'object') nm = t.displayName || (t.render && (t.render.displayName || t.render.name)) || (t.type && (t.type.displayName || t.type.name));
    if (nm && names[names.length - 1] !== nm) names.push(nm);
  }
  if (!names.length) return { motivo: 'fibra React sem componentes nomeados' };
  const legiveis = names.filter(x => x.length >= 3 && /^[A-Z]/.test(x));
  if (legiveis.length < names.length * 0.8 || !names.some(x => x.length >= 5)) return { motivo: `nomes minificados (bundle de produção: ${names.slice(0, 4).join(', ')}…) — árvore omitida` };
  return { nomes: names.slice(0, 10) };
}
function origemHTML(el) {
  const f = fonteCssOf(el).fonteCss, tr = reactTree(el);
  const cssL = f ? `<span class="mono">${esc(f.arquivo)}:${f.linha}</span> <small>${esc(f.evidencia)}</small>` : esc(fonteCssOf(el).fonteCssMotivo);
  const arv = tr.nomes ? `<span class="mono">${tr.nomes.map(esc).join(' ‹ ')}</span>` : `<small>${esc(tr.motivo)}</small>`;
  origemOf(el).then(r => { const b = root.getElementById('orig-comp'); if (b && S.selected === el) b.innerHTML = compHTML(r); });
  return `<div class="origem"><div class="group">Origem</div><div class="meta"><b>CSS</b> ${cssL}</div><div class="meta" id="orig-comp"><b>Componente provável</b> <small>buscando…</small></div><div class="meta"><b>Árvore</b> ${arv}</div></div>`;
}
function compHTML(r) {
  if (!r.candidatos || !r.candidatos.length) return `<b>Componente provável</b> <span class="warnline">${esc(r.motivo || 'não resolvido')}</span>`;
  const [c, ...rest] = r.candidatos;
  const one = x => `<span class="mono">${esc(x.arquivo)}:${x.linha}</span> <small>${esc(x.como)}</small><code class="trecho">${esc(x.trecho)}</code>`;
  return `<b>Componente provável</b> ${one(c)}<small>${esc(c.evidencia)}</small>${rest.length ? `<details class="more"><summary>mais ${rest.length} candidato(s)</summary>${rest.map(one).join('<br>')}</details>` : ''}`;
}

/* ---- "Ficar igual àquele": compara B com a referência A e só mostra o que diverge ---- */
const REF_PROPS = [['padding', 'respiro interno'], ['gap', 'espaço entre os itens'], ['border-width', 'espessura da borda'], ['border-style', 'estilo da borda'], ['border-color', 'cor da borda'], ['border-radius', 'arredondamento'], ['background-color', 'fundo'], ['min-height', 'altura mínima'], ['align-items', 'alinhamento dos itens'], ['text-align', 'alinhamento do texto']];
const TYPO = [['font-size', 'tamanho'], ['font-weight', 'peso'], ['line-height', 'altura de linha']];
function textLeaves(el) { return [el, ...el.querySelectorAll('*')].filter(n => n.getClientRects().length && [...n.childNodes].some(t => t.nodeType === 3 && t.textContent.trim())).slice(0, 30); }
function tipoPartes(el) {
  const L = textLeaves(el); if (!L.length) return {};
  const fs = n => pf(getComputedStyle(n).fontSize);
  const valor = L.reduce((a, b) => fs(b) > fs(a) ? b : a, L[0]);
  const titulo = L.find(n => n !== valor) || null;
  return titulo ? { 'título': titulo, valor } : { texto: valor };
}
const boxed = n => { const c = getComputedStyle(n); return pf(c.borderTopWidth) > 0 && c.borderTopStyle !== 'none' || !/rgba\(0, 0, 0, 0\)|transparent/.test(c.backgroundColor); };
function profundidade(el) {
  let max = 0;
  for (const leaf of textLeaves(el)) { let d = 0; for (let n = leaf; n && n !== el; n = n.parentElement) if (n !== leaf && boxed(n)) d++; max = Math.max(max, d); }
  return max;
}
function densidade(el) {
  const r = el.getBoundingClientRect(), ks = realKids(el);
  if (!ks.length || !r.height) return null;
  const top = Math.min(...ks.map(k => k.getBoundingClientRect().top)), bot = Math.max(...ks.map(k => k.getBoundingClientRect().bottom));
  return bot > top ? r.height / (bot - top) : null;
}
function fmtVal(el, prop, computed) {
  const s = findSource(el, prop), tk = s.rule && tokenOf(s.srcValue || s.value);
  if (tk) return `${tk.replace(/^--vf-/, '')} (${computed})`;
  const px = toPx(computed), tl = px != null && px > 0 ? tokenLabelFor(px) : null;
  return tl ? `${computed} (= sp-${tl})` : computed;
}
function valorParaAplicar(A, prop) { const s = findSource(A, prop); return s.rule && tokenOf(s.srcValue || s.value) ? (s.srcValue || s.value) : comp(A, prop); }
function compararRef(A, B) {
  const out = [], nA = `A (${nameOf(A)})`, nB = `B (${nameOf(B)})`;
  const csA = getComputedStyle(A), csB = getComputedStyle(B);
  for (const [prop, label] of REF_PROPS) {
    if (prop === 'gap' && !(isFG(csA) && isFG(csB))) continue;
    if (prop.startsWith('border-') && prop !== 'border-radius' && pf(csA.borderTopWidth) === 0 && pf(csB.borderTopWidth) === 0) continue;
    const a = comp(A, prop), b = comp(B, prop);
    if (a === b) continue;
    out.push({ aspecto: label, prop, alvo: 'b', a, b, css: true, texto: `${nB} usa ${fmtVal(B, prop, b)} de ${label}; ${nA} usa ${fmtVal(A, prop, a)}`, aplicar: { el: B, prop, valor: valorParaAplicar(A, prop) } });
  }
  const pa = tipoPartes(A), pb = tipoPartes(B);
  for (const papel of Object.keys(pa)) {
    const x = pa[papel], y = pb[papel]; if (!x || !y) continue;
    for (const [prop, label] of TYPO) {
      const a = comp(x, prop), b = comp(y, prop);
      if (a !== b) out.push({ aspecto: `${label} do ${papel}`, prop, alvo: papel, a, b, css: true, texto: `${papel} de ${nB}: ${label} ${fmtVal(y, prop, b)}; em ${nA}: ${fmtVal(x, prop, a)}`, aplicar: { el: y, prop, valor: valorParaAplicar(x, prop) } });
    }
  }
  const dA = profundidade(A), dB = profundidade(B);
  if (dA !== dB) out.push({ aspecto: 'profundidade de containers', a: String(dA), b: String(dB), css: false, texto: `${nB} tem ${dB} nível(is) com borda/fundo entre ele e o conteúdo; ${nA} tem ${dA}`, criterio: `${nB}: deixar ${dA} nível(is) de container com borda/fundo até o conteúdo, como ${nA} (sem card dentro de card)` });
  const explicada = out.some(d => d.prop === 'padding' || d.prop === 'min-height');
  const eA = densidade(A), eB = densidade(B);
  if (eA && eB && !explicada && Math.abs(eA - eB) / eA > 0.15) out.push({ aspecto: 'densidade', a: eA.toFixed(2), b: eB.toFixed(2), css: false, texto: `${nB} ocupa ${eB.toFixed(2)}× a altura do conteúdo; ${nA} ocupa ${eA.toFixed(2)}×`, criterio: `${nB}: mesma densidade de ${nA} (altura ÷ conteúdo ≈ ${eA.toFixed(2)})` });
  return out;
}
function usarComoReferencia(el) { S.ref = el; S.refDiff = null; toast(`${nameOf(el)} é a referência. Selecione outro elemento e use “Deixar igual à referência”.`, 4500); render(); }
function deixarIgual(B) {
  const A = S.ref; if (!A || !A.isConnected) { S.ref = null; return toast('A referência sumiu da página — marque de novo.'); }
  if (A === B) return toast('Selecione outro elemento (não a própria referência).');
  S.refDiff = { A, B, diffs: compararRef(A, B) }; render();
  return S.refDiff;
}
function registrarReferencia(aplicar) {
  const R = S.refDiff; if (!R) return null;
  if (aplicar) for (const d of R.diffs.filter(x => x.css)) edit(d.aplicar.el, d.aplicar.prop, d.aplicar.valor);
  ensureSession();
  const it = { id: uid(), tipo: 'referencia', criadoEm: nowIso(), referencia: { a: captureAlvo(R.A), b: captureAlvo(R.B),
    diferencas: R.diffs.map(d => ({ aspecto: d.aspecto, ...(d.prop ? { prop: d.prop } : {}), papel: d.alvo, a: d.a, b: d.b, css: d.css, aplicada: !!(aplicar && d.css), texto: d.texto })),
    criterios: R.diffs.filter(d => !d.css).map(d => d.criterio) } };
  SES.itens.push(it); S.refDiff = null;
  saveSoon(0); render();
  toast(aplicar ? `${R.diffs.filter(d => d.css).length} ajuste(s) de CSS aplicados um por um; o conjunto ficou registrado como referência.` : 'Referência registrada na sessão (nada aplicado).', 5000);
  return it;
}
function refHTML(el) {
  let h = '';
  if (S.refDiff && S.refDiff.B === el) {
    const R = S.refDiff, css = R.diffs.filter(d => d.css), nao = R.diffs.filter(d => !d.css);
    h += `<div class="refbox"><div class="eyebrow">Igual à referência: ${esc(nameOf(R.A))}</div>`;
    h += R.diffs.length ? `<ul class="facts">${R.diffs.map(d => `<li>${esc(d.texto)}${d.css ? '' : ' <span class="badge">estrutura</span>'}</li>`).join('')}</ul>` : '<div class="ok">Nenhuma diferença relevante.</div>';
    h += `<div class="actions">${css.length ? `<button class="btn sm pri" data-act="ref-apl">Aplicar as de CSS (${css.length})</button>` : ''}${R.diffs.length ? '<button class="btn sm" data-act="ref-reg">Só registrar</button>' : ''}<button class="btn sm" data-act="ref-x">Fechar</button></div>${nao.length ? '<small>O que não é CSS vira critério estrutural na missão.</small>' : ''}</div>`;
  }
  return h;
}

/* ---- "O que estou tentando fazer?" ---- */
let intencaoCache = { sig: '', texto: '' }, intencaoPend = false;
const itensSig = () => SES ? SES.itens.map(i => i.id + (i.css ? i.css.depois + i.css.destino : '')).join('|') : '';
function intencaoHTML() {
  if (!SES || SES.itens.length < 4) return '';
  const sig = itensSig();
  if (S.intencaoNao === sig) return '';
  if (intencaoCache.sig !== sig) {
    if (!intencaoPend) { intencaoPend = true; saveNow().then(() => getJSON(`/__vfdev/missoes/${encodeURIComponent(SES.id)}/rascunho`)).then(r => { intencaoCache = { sig, texto: r.intencao || '' }; }).catch(() => { intencaoCache = { sig, texto: '' }; }).finally(() => { intencaoPend = false; if (S.tab === 'session') renderBody(); }); }
    return '';
  }
  if (!intencaoCache.texto) return '';
  return `<div class="intencao"><div class="eyebrow">O que estou tentando fazer?</div><p>${esc(intencaoCache.texto)}</p><div class="actions"><button class="btn sm pri" data-act="int-sim">Sim, usar como objetivo</button><button class="btn sm" data-act="int-edit">Editar</button><button class="btn sm" data-act="int-nao">Não</button></div><small>Montado por regras a partir dos itens (sem IA).</small></div>`;
}

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
.ov.region{border:2px dashed var(--o-text);background:rgba(63,143,214,.08)}
.ov.pinreg{border-color:rgba(224,74,116,.6);background:rgba(224,74,116,.06)}
.ov.gone{background:repeating-linear-gradient(-45deg,rgba(224,74,116,.5) 0 6px,rgba(224,74,116,.12) 6px 12px);outline:2px solid var(--o-sobra)}
.previa{position:fixed;left:50%;top:10px;transform:translateX(-50%);padding:4px 12px;border-radius:999px;background:var(--o-sobra);color:#fff;font:700 12px/1.4 var(--mono);box-shadow:0 4px 14px rgba(0,0,0,.25)}
.pin{position:fixed;width:22px;height:22px;border-radius:50%;border:0;background:var(--o-sobra);color:#fff;font:700 11px/22px var(--mono);text-align:center;padding:0;pointer-events:auto;box-shadow:0 0 0 2px #fff,0 2px 6px rgba(0,0,0,.3);cursor:pointer}
.pin.done{background:#8a8594}
.talk{position:fixed;z-index:5;pointer-events:auto;background:var(--bg);border:1px solid var(--line);border-radius:12px;box-shadow:0 16px 48px rgba(20,10,40,.3);padding:12px;display:flex;flex-direction:column;gap:8px}
.talk textarea,.crit textarea{width:100%;border:1px solid var(--line);background:var(--bg2);border-radius:8px;padding:8px;font:inherit;color:inherit;resize:vertical}
.chips{display:flex;flex-wrap:wrap;gap:4px}.chips button{border:1px solid var(--line);background:var(--bg2);border-radius:999px;padding:2px 9px;font-size:11.5px}.chips button:hover{border-color:var(--acc)}
.hint{font-size:11px;color:var(--mut)}
.why{width:100%;border:1px dashed var(--line);background:transparent;border-radius:6px;padding:4px 8px;font-size:12px;color:inherit}
.why:focus{border-style:solid;background:var(--bg2)}
.wide{width:100%;text-align:left;display:flex;justify-content:space-between;gap:8px}.wide small{opacity:.75}
.ses-head{display:flex;gap:8px;align-items:center}
.ses-title{flex:1;min-width:0;font:700 15px/1.3 inherit;border:1px solid transparent;border-radius:6px;padding:4px 6px;background:transparent;color:inherit}
.ses-title:hover,.ses-title:focus{border-color:var(--line);background:var(--bg2)}
.st-verificada{background:var(--add-bg);color:var(--add)}.st-descartada{background:var(--lock-bg);color:var(--lock)}
.counters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.counters div{border:1px solid var(--line);border-radius:8px;padding:6px 8px;display:flex;flex-direction:column}.counters b{font-size:16px}.counters span{font-size:11px;color:var(--mut)}
.item{border:1px solid var(--line);border-radius:9px;padding:9px 11px;display:flex;flex-direction:column;gap:6px}
.item-h{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.item-h b{overflow-wrap:anywhere}.grow{flex:1}
.num{font:700 11px var(--mono);color:var(--mut)}
.item .del{color:var(--del);text-decoration:line-through}.item .add{color:var(--add);font-weight:600}
.quote{margin:0;font-size:13px}.quote.done{text-decoration:line-through;color:var(--mut)}
.crit{display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:var(--mut)}
.warnline{font-size:11.5px;color:var(--warn);background:var(--warn-bg);border-radius:6px;padding:4px 8px}
.cmpini{font-size:11.5px;border-left:3px solid var(--acc);padding:2px 8px;color:var(--mut)}
.facts{margin:0;padding-left:18px;font-size:12px}
.obj{border:1px solid var(--acc);border-radius:9px;padding:9px 11px;display:flex;flex-direction:column;gap:6px;background:var(--soft)}
.obj textarea{width:100%;border:1px solid var(--line);background:var(--bg);border-radius:8px;padding:8px;font:inherit;color:inherit;resize:vertical}
.verif{border:1px solid var(--line);border-radius:9px;padding:9px 11px;display:flex;flex-direction:column;gap:5px}
.vr{display:flex;gap:8px;align-items:flex-start;font-size:12px}.vr small{color:var(--mut)}
.vmark{font-weight:800;width:14px;flex:none}.vr.ok .vmark{color:var(--add)}.vr.ko .vmark{color:var(--del)}
.vbox{position:fixed;left:-30000px;top:0;visibility:hidden;pointer-events:none}
.origem{border:1px solid var(--line);border-radius:9px;padding:8px 10px;display:flex;flex-direction:column;gap:4px}.origem .group{margin:0}
.origem .meta{display:block}.origem small{color:var(--mut);display:block}
.trecho{display:block;white-space:pre-wrap;word-break:break-all;background:var(--bg2);border-radius:5px;padding:3px 6px;margin-top:2px;font-size:11px}
.refbox,.intencao{border:1px solid var(--acc);border-radius:9px;padding:9px 11px;display:flex;flex-direction:column;gap:6px;background:var(--soft)}
.intencao p{margin:0;font-weight:600}
.estr-grid{display:flex;flex-wrap:wrap;gap:4px;padding-top:6px}
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
    <div class="tabs" id="tabs"><button data-tab="session">Sessão<span class="count" id="cnt-session">–</span></button><button data-tab="props">Painel</button><button data-tab="tree">Árvore</button><button data-tab="issues">Problemas<span class="count" id="cnt-issues">0</span></button><button data-tab="changes">Alterações<span class="count" id="cnt-changes">0</span></button></div>
    <div class="body" id="body"></div>
    <div class="foot"><div class="foot-count" id="foot-count"></div>
      <div class="foot-r"><button class="btn sm" id="undo">↶</button><button class="btn sm" id="redo">↷</button><button class="btn sm" id="before">Ver antes</button><button class="btn sm" id="cmpbtn">Larguras</button><button class="btn sm" id="diff">Diff</button><button class="btn sm" id="prompt">Prompt</button><button class="btn sm pri" id="apply">Gravar</button></div></div>
  </section>
  <div class="sheet" id="drawer" hidden><div class="sheet-in"><div class="sheet-top"><div class="seg" id="dtabs"><button data-tab="diff">Diff real</button><button data-tab="prompt">Prompt pro Codex</button><button data-tab="missao">Missão</button><button data-tab="build">Build</button></div><button class="btn" id="dcopy">Copiar</button><button class="btn" id="dclose">Fechar</button></div><div class="sheet-body" id="dbody"></div></div></div>
  <div class="cmd" id="cmd" hidden><div class="cmd-in"><input id="cmd-input" placeholder="Escreva do seu jeito: menos espaço, 3 colunas, centralizar…" autocomplete="off" spellcheck="false"><div class="cmd-target" id="cmd-target"></div><div class="cmd-list" id="cmd-list"></div><div class="cmd-foot"><span><kbd>↑</kbd><kbd>↓</kbd> escolher</span><span><kbd>Enter</kbd> aplicar</span><span><kbd>Esc</kbd> fechar</span><span>Aceita CSS direto: <code>gap 8</code></span></div></div></div>
  <div class="cmp" id="cmp" hidden><div class="cmp-top"><b>Comparar larguras — mesma página, sem o editor, com as alterações pendentes aplicadas</b><button class="btn" id="cmp-reload">Recarregar</button><button class="btn" id="cmp-close">Fechar</button></div><div class="cmp-frames" id="cmp-frames"></div></div>
  <div class="talk" id="talk" hidden role="dialog" aria-label="Falar sobre isso"><div class="talk-h" id="talk-h"></div><textarea id="talk-text" rows="3" placeholder="o que te incomoda aqui?"></textarea><div class="chips" id="talk-chips">${CHIPS.map(c => `<button data-chip="${c}">${c}</button>`).join('')}</div><div class="actions"><button class="btn sm pri" id="talk-save">Salvar</button><button class="btn sm" id="talk-resolve" hidden>Resolver</button><button class="btn sm" id="talk-del" hidden>Apagar</button><button class="btn sm" id="talk-cancel">Cancelar</button><span class="hint">Ctrl+Enter salva · Esc cancela</span></div></div>
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
  $('dcopy').onclick = () => copy($('drawer').dataset.tab === 'prompt' ? promptText() : $('drawer').dataset.tab === 'missao' ? (S.missaoMd || '') : [...root.querySelectorAll('#dbody .diff')].map(d => d.innerText).join('\n\n'));
  $('cmd').onclick = e => { if (e.target.id === 'cmd') return closeCmd(); const b = e.target.closest('.cmd-item'); if (b) runCmd(+b.dataset.i); };
  $('cmd-input').addEventListener('input', () => { cmdIdx = 0; renderCmd(); });
  $('cmd-input').addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') { e.preventDefault(); cmdIdx = Math.min(cmdItems.length - 1, cmdIdx + 1); renderCmd(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cmdIdx = Math.max(0, cmdIdx - 1); renderCmd(); }
    else if (e.key === 'Enter') { e.preventDefault(); runCmd(cmdIdx); }
    else if (e.key === 'Escape') { e.preventDefault(); closeCmd(); }
  });

  ov.addEventListener('click', e => { const p = e.target.closest('.pin'); if (p) openTalk({ itemId: p.dataset.pin }); });
  $('talk-chips').onclick = e => { const b = e.target.closest('[data-chip]'); if (!b) return; const ta = $('talk-text'); ta.value = ta.value.trim() ? ta.value.trim() + ', ' + b.dataset.chip : b.dataset.chip; ta.focus(); };
  $('talk-save').onclick = saveTalk; $('talk-cancel').onclick = closeTalk;
  $('talk-del').onclick = () => { if (S.talk && S.talk.itemId) delItem(S.talk.itemId); closeTalk(); };
  $('talk-resolve').onclick = () => { const it = S.talk && SES.itens.find(i => i.id === S.talk.itemId); if (it) { it.comentario.resolvido = !it.comentario.resolvido; saveSoon(0); } closeTalk(); render(); };
  $('talk-text').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); closeTalk(); } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveTalk(); } });
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
    else if (act === 'talk') openTalk({ el: S.selected });
    else if (act === 'estr') estrutural(t, b.dataset.acao);
    else if (act === 'ses-new') { novaSessao(false); S.tab = 'session'; render(); }
    else if (act === 'ses-cont') continuarSessao(b.dataset.id);
    else if (act === 'ses-save') saveNow().then(() => toast('Sessão salva.'));
    else if (act === 'ses-switch') { saveNow().then(async () => { clearLive(); SES = null; try { sessionStorage.removeItem(SSKEY); } catch (e) {} await loadOffer(); render(); }); }
    else if (act === 'ses-dup') { saveNow().then(async () => { try { const c = await postJSON('/__vfdev/sessoes/' + encodeURIComponent(SES.id) + '/duplicar', {}); await continuarSessao(c.id, true); toast(`Duplicada: agora você está em “${c.titulo}”.`); } catch (e) { toast('Não duplicou: ' + e.message, 6000); } }); }
    else if (act === 'ses-ren') { const i = root.getElementById('ses-title'); i.focus(); i.select(); }
    else if (act === 'ses-disc') { SES.status = 'descartada'; saveNow().then(async () => { clearLive(); SES = null; try { sessionStorage.removeItem(SSKEY); } catch (e) {} await loadOffer(); render(); toast('Sessão descartada (o arquivo continua em tools/vfdev/sessoes/).'); }); }
    else if (act === 'ses-cmp') { S.sesCompare = !S.sesCompare; render(); }
    else if (act === 'item-ver') { const it = SES.itens.find(i => i.id === b.dataset.id); const r = it && resolveAlvo(it.alvo); if (r && r.el) { r.el.scrollIntoView({ block: 'center' }); S.tab = 'props'; select(r.el); } }
    else if (act === 'item-del') delItem(b.dataset.id);
    else if (act === 'mis-gerar') pedirObjetivo();
    else if (act === 'ref-usar') usarComoReferencia(S.selected);
    else if (act === 'ref-igual') deixarIgual(S.selected);
    else if (act === 'ref-apl') registrarReferencia(true);
    else if (act === 'ref-reg') registrarReferencia(false);
    else if (act === 'ref-x') { S.refDiff = null; render(); }
    else if (act === 'int-sim') { SES.objetivo = intencaoCache.texto; saveSoon(0); toast('Objetivo definido.'); render(); }
    else if (act === 'int-edit') { S.objDraft = { texto: intencaoCache.texto, sugerido: true }; render(); }
    else if (act === 'int-nao') { S.intencaoNao = itensSig(); render(); }
    else if (act === 'obj-save') { const v = root.getElementById('obj-text').value.trim(); if (v) { SES.objetivo = v; S.objDraft = null; saveSoon(0); render(); } }
    else if (act === 'rebuild') rebuildIlha(b.dataset.ilha);
    else if (act === 'undo-grav') desfazerGravacao(b.dataset.id);
    else if (act === 'git-cmds') copy(gitCmds(), 'Comandos git copiados.');
    else if (act === 'obj-ok') gerarMissao(root.getElementById('obj-text').value);
    else if (act === 'obj-cancel') { S.objDraft = null; render(); }
    else if (act === 'mis-ver') openDrawer('missao');
    else if (act === 'mis-verif') verificarMissao();
    else if (act === 'previa') { previews.has(b.dataset.id) ? previewOff(b.dataset.id) : previewOn(b.dataset.id); render(); }
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
  body.addEventListener('input', e => {
    const i = e.target;
    if (i.dataset.whyKey || i.dataset.whyItem) {
      if (i.dataset.whyKey) sesSync();
      const it = i.dataset.whyItem ? SES && SES.itens.find(x => x.id === i.dataset.whyItem) : cssItemOf(i.dataset.whyKey);
      if (it) { if (i.value.trim()) it.nota = i.value; else delete it.nota; saveSoon(); }
    }
  });
  body.addEventListener('change', e => {
    const i = e.target;
    if (i.id === 'ses-title') { if (i.value.trim()) { SES.titulo = i.value.trim(); saveSoon(0); } return; }
    if (i.dataset.crit) { const it = SES.itens.find(x => x.id === i.dataset.crit); if (it) { it.estrutural.criterios = i.value.split('\n').map(x => x.trim()).filter(Boolean); saveSoon(0); } return; }
    if (i.dataset.whyKey || i.dataset.whyItem) return;
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
  if (S.drag) { S.drag.x1 = e.clientX; S.drag.y1 = e.clientY; draw(); return; }
  if (S.mode === 'space') { resetCache(); S.hoverDiag = diagnose(e.clientX, e.clientY); draw(); }
  else if (S.hoverEl !== el) { S.hoverEl = el; draw(); }
}
function block(e) {
  if (!active() || fromTool(e)) return;
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  if (e.type === 'pointerdown' && e.shiftKey && e.button === 0 && S.mode === 'select') { S.drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY }; return; }
  if (e.type !== 'click') return;
  if (S.dragEnded) { S.dragEnded = false; return; }
  if (S.pick) { const rel = pageElementAt(e.clientX, e.clientY); if (inPage(rel) && rel !== S.pick.el) estrutural(S.pick.el, S.pick.acao, rel); return; }
  if (S.mode === 'space') { resetCache(); const d = diagnose(e.clientX, e.clientY); if (d) { S.pinned = d; S.hoverDiag = null; render(); } }
  else select(pageElementAt(e.clientX, e.clientY));
}
function onUp() {
  const d = S.drag; if (!d) return; S.drag = null;
  const rect = mk(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.max(d.x0, d.x1), Math.max(d.y0, d.y1));
  if (rect.width < 8 || rect.height < 8) { draw(); return; }
  S.dragEnded = true; setTimeout(() => { S.dragEnded = false; }, 400);
  const el = regionContainer(rect);
  S.region = { rect, el };
  openTalk({ el, region: S.region });
}
function delItem(id) {
  if (!SES) return;
  const it = SES.itens.find(i => i.id === id); if (!it) return;
  previewOff(id);
  if (it.tipo === 'css') for (const [k, v] of cssItemKey) if (v === id) { const c = changes.get(k); if (c) { prep(); setRule(c.rule, c.prop, c.before); } cssItemKey.delete(k); }
  SES.itens = SES.itens.filter(i => i.id !== id);
  saveSoon(0); render();
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
    case 'c': case 'C': if (S.region) { e.preventDefault(); openTalk({ el: S.region.el, region: S.region }); } else if (sel && S.mode !== 'use') { e.preventDefault(); openTalk({ el: sel }); } break;
    case 'Escape': if (S.pick) { S.pick = null; toast('Ação estrutural cancelada.'); render(); } else if (!root.getElementById('talk').hidden) closeTalk(); else if (!root.getElementById('drawer').hidden) root.getElementById('drawer').hidden = true; else if (!root.getElementById('cmp').hidden) root.getElementById('cmp-close').click(); else { S.selected = null; S.pinned = null; render(); } break;
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
async function loadOffer() {
  try { sesOffer = (await getJSON('/__vfdev/sessoes?pagina=' + encodeURIComponent(htmlFile()))).sessoes; sesErr = ''; }
  catch (e) { sesOffer = []; sesErr = 'Não listou as sessões: ' + e.message; }
}
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
  window.addEventListener('pointerup', onUp, true);
  connectEvents();
  await loadOffer();
  let auto = null; try { auto = sessionStorage.getItem(SSKEY); } catch (e) {}
  if (auto && sesOffer.some(s => s.id === auto && s.status !== 'descartada')) await continuarSessao(auto, true);
  else if (sesOffer.some(s => s.status === 'em_andamento')) S.tab = 'session';
  if (S.open) S.problems = scan();
  render();
  window.__VFDEV__.api = { select, edit, findSource, ruleInfo, changes, buildPatch, apply, scan, state: S,
    sessao: () => SES, erroSessao: () => sesErr, pedirObjetivo, gerarMissao, verificarMissao, runCheck, origemOf, reactTree, usarComoReferencia, deixarIgual, registrarReferencia, compararRef, rebuildIlha, desfazerGravacao, loadHist, gitCmds, fileMeta, novaSessao, continuarSessao, saveNow, comentar, estrutural, previewOn, previewOff, previews, resolveAlvo, captureAlvo, openCompare, setTab, render, delItem };
  window.__VFDEV__.ready = true;
}
if (document.readyState === 'complete') boot(); else window.addEventListener('load', boot, { once: true });
})();
