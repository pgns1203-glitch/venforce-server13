'use strict';
/*
 * origem — "Nasceu onde?": do DOM ao componente provável, sempre com evidência.
 * Procura as classes do elemento, como texto literal, no código que monta o HTML:
 *  - frontend-react/src/**\/*.{jsx,tsx,js}: className literal, template ou cx()/clsx();
 *  - Portal/*.js (vanilla): class="" em template string / innerHTML, classList, className.
 * Nunca chuta: sem ocorrência literal, devolve "não resolvido" com o motivo.
 */
const fs = require('fs');
const path = require('path');

const cache = new Map(); // arquivo -> { mtimeMs, linhas }
function linhas(abs) {
  let st; try { st = fs.statSync(abs); } catch (e) { return null; }
  const c = cache.get(abs);
  if (c && c.mtimeMs === st.mtimeMs) return c.linhas;
  const l = fs.readFileSync(abs, 'utf8').split('\n');
  cache.set(abs, { mtimeMs: st.mtimeMs, linhas: l });
  return l;
}
function listar(dir, re, { recursivo = true } = {}) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (recursivo && !/^(node_modules|\.git|dist|test|__tests__|assets)$/.test(e.name)) walk(p); }
      else if (re.test(e.name) && !/\.(test|spec)\.[jt]sx?$/.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Classe mais específica primeiro: elemento/modificador BEM, depois nomes longos; utilitárias e de estado por último. */
function especificidade(c) {
  let s = c.length;
  if (/__/.test(c)) s += 100;
  if (/--/.test(c)) s += 60;
  if (/^(is-|has-|js-)/.test(c)) s -= 200;
  if (/^vf-(card|btn|badge|chip|table|section|kpi|page)(\b|$)/.test(c)) s -= 80;
  return s;
}

function buscarOrigem({ classes = [], texto = '', reactSrc, portalDir, repo }) {
  const cls = [...new Set(classes.map(c => String(c).trim()).filter(c => /^[\w-]+$/.test(c)))].sort((a, b) => especificidade(b) - especificidade(a));
  if (!cls.length) return { candidatos: [], motivo: 'não resolvido: o elemento não tem classe para procurar no código' };
  const arquivos = [
    ...listar(reactSrc, /\.(jsx|tsx|js)$/).map(abs => ({ abs, tipo: 'react' })),
    ...listar(portalDir, /\.js$/, { recursivo: false }).map(abs => ({ abs, tipo: 'portal' }))
  ];
  const cands = [];
  cls.forEach((c, rank) => {
    const tok = new RegExp(`(^|[\\s"'\`{(,])${escRe(c)}(?=$|[\\s"'\`})\\],])`);
    for (const { abs, tipo } of arquivos) {
      const L = linhas(abs); if (!L) continue;
      L.forEach((ln, i) => {
        if (!ln.includes(c) || !tok.test(ln)) return;
        let como = null;
        if (tipo === 'react') {
          if (new RegExp(`className\\s*=\\s*["']([^"']*\\s)?${escRe(c)}(\\s[^"']*)?["']`).test(ln)) como = 'className literal';
          else if (/className|\bcx\(|\bclsx\(|classNames\(/.test(ln)) como = 'className em template/cx()';
          else if (/["'`]/.test(ln)) como = 'string no componente (provável className montado)';
        } else {
          if (/class(Name)?\s*=|classList|innerHTML|`/.test(ln)) como = /classList/.test(ln) ? 'classList no JS da página' : 'class em template string / innerHTML';
        }
        if (!como) return;
        const score = 1000 - rank * 100 + (como === 'className literal' ? 30 : como.startsWith('className') ? 20 : 0) + (tipo === 'react' ? 5 : 0);
        cands.push({ arquivo: path.relative(repo, abs).split(path.sep).join('/'), linha: i + 1, classe: c, como, trecho: ln.trim().slice(0, 180), score, evidencia: `${como} com a classe \`${c}\` em ${path.basename(abs)}:${i + 1}` });
      });
    }
  });
  if (!cands.length) return { candidatos: [], motivo: `não resolvido: ${cls.length === 1 ? `a classe \`${cls[0]}\` não aparece` : `nenhuma das classes ${cls.map(c => '`' + c + '`').join(', ')} aparece`} literalmente no código (provável composição dinâmica)` };
  // texto visível no mesmo arquivo reforça o candidato (evidência extra, não substitui a da classe)
  const t = String(texto || '').trim();
  if (t && t.length >= 3) {
    for (const cd of cands) {
      const L = linhas(path.join(repo, cd.arquivo)) || [];
      const k = L.findIndex(l => l.includes(t.slice(0, 40)));
      if (k >= 0) { cd.score += 15; cd.evidencia += ` · o texto "${t.slice(0, 40)}" aparece no mesmo arquivo (linha ${k + 1})`; }
    }
  }
  const vistos = new Set();
  const unicos = cands.sort((a, b) => b.score - a.score).filter(c => { const k = c.arquivo + ':' + c.linha; if (vistos.has(k)) return false; vistos.add(k); return true; });
  return { candidatos: unicos.slice(0, 8).map(({ score, ...c }) => c), classesProcuradas: cls };
}

module.exports = { buscarOrigem, especificidade };
