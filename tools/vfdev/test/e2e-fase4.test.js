'use strict';
/* Aceites da Fase 4 no navegador: bloco Origem, "ficar igual àquele" e "o que estou tentando fazer?". */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpRepo, startServer, openPage, skipMotivo, closeBrowser } = require('./helpers/e2e');

const DIR = tmpRepo();
const F = rel => path.join(DIR, rel);
fs.mkdirSync(F('frontend-react/src/components'), { recursive: true });
fs.writeFileSync(F('frontend-react/src/components/FaixaExecutiva.jsx'), 'export function FaixaExecutiva({ valor }) {\n  return (\n    <section className="c360d-ind">\n      <p className="c360d-ind__valor">{valor}</p>\n    </section>\n  );\n}\n');
const html = F('Portal/fechamentos-api.html');
fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace('  </div>\n  <script src="vf-shell.js">', `    <section class="c360d-ind"><p class="c360d-ind__valor">R$ 20.136</p></section>
    <div class="dyn-7f3a">gerado dinamicamente</div>
    <div class="cards"><article class="card-a"><span class="card-t">Receita</span><strong class="card-v">R$ 1.240</strong></article><article class="card-b"><span class="card-t">Custo</span><strong class="card-v">R$ 310</strong></article></div>
  </div>
  <script src="vf-shell.js">`));
fs.appendFileSync(F('Portal/css/pages/fechamentos-api-v2.css'), `.vf-page-fechamentos-api .cards { display: flex; gap: 16px; align-items: flex-start; }
.vf-page-fechamentos-api .card-a { display: flex; flex-direction: column; gap: 8px; padding: var(--vf-sp-4); border: 1px solid #dddddd; border-radius: var(--vf-radius-lg); background: #ffffff; width: 200px; }
.vf-page-fechamentos-api .card-b { display: flex; flex-direction: column; gap: 8px; padding: 24px; border: 1px solid #dddddd; border-radius: 6px; background: #ffffff; width: 200px; }
.vf-page-fechamentos-api .card-t { font-size: 12px; font-weight: 500; }
.vf-page-fechamentos-api .card-v { font-size: 20px; font-weight: 700; }
`);

let srv, page, context;
test.before(async () => { if (await skipMotivo()) return; srv = await startServer(DIR, 5401); ({ context, page } = await openPage(srv.base, 'fechamentos-api.html')); });
test.after(async () => { if (context) await context.close(); if (srv) await srv.stop(); await closeBrowser(); fs.rmSync(DIR, { recursive: true, force: true }); });
const A = fn => `(() => { const A = window.__VFDEV__.api; ${fn} })()`;

test('4.1 · clicar no elemento mostra FaixaExecutiva.jsx:<linha> com o trecho; classe dinâmica mostra "não resolvido" com o motivo', async t => {
  const skip = await skipMotivo(); if (skip) return t.skip(skip);
  await page.evaluate(A(`A.setTab('props');`));
  await page.locator('.c360d-ind__valor').click();
  const comp = page.locator('vf-devtools >> #orig-comp');
  await page.waitForFunction(() => /FaixaExecutiva/.test(document.querySelector('vf-devtools').shadowRoot.getElementById('orig-comp').textContent));
  const txt = await comp.textContent();
  assert.match(txt, /frontend-react\/src\/components\/FaixaExecutiva\.jsx:4/);
  assert.match(txt, /<p className="c360d-ind__valor">\{valor\}<\/p>/);
  assert.match(txt, /className literal com a classe `c360d-ind__valor` em FaixaExecutiva\.jsx:4/);
  assert.match(await page.locator('vf-devtools >> .origem').textContent(), /Árvore\s*sem React nesta parte da página/);
  await page.locator('.dyn-7f3a').click();
  await page.waitForFunction(() => /não resolvido/.test(document.querySelector('vf-devtools').shadowRoot.getElementById('orig-comp').textContent));
  assert.match(await comp.textContent(), /não resolvido: a classe `dyn-7f3a` não aparece literalmente no código \(provável composição dinâmica\)/);
});

test('4.1 · árvore de componentes só aparece com nomes legíveis (bundle dev); minificados são omitidos', async t => {
  const skip = await skipMotivo(); if (skip) return t.skip(skip);
  const r = await page.evaluate(() => {
    const el = document.querySelector('.c360d-ind__valor'), dyn = document.querySelector('.dyn-7f3a');
    function FaixaExecutiva() {} function Cliente360V3Page() {} function a() {} function Qe() {}
    el['__reactFiber$x1'] = { type: 'p', return: { type: FaixaExecutiva, return: { type: Cliente360V3Page, return: null } } };
    dyn['__reactFiber$x1'] = { type: 'div', return: { type: a, return: { type: Qe, return: null } } };
    const A = window.__VFDEV__.api; return [A.reactTree(el), A.reactTree(dyn)];
  });
  assert.deepEqual(r[0], { nomes: ['FaixaExecutiva', 'Cliente360V3Page'] });
  assert.match(r[1].motivo, /^nomes minificados/);
});

test('4.2 · referência: lista exatamente as propriedades divergentes e aplicar iguala o computado de B ao de A', async t => {
  const skip = await skipMotivo(); if (skip) return t.skip(skip);
  await page.evaluate(A(`A.setTab('session');`));
  await page.locator('vf-devtools >> text=Nova sessão').click();
  await page.evaluate(A(`A.setTab('props');`));
  await page.locator('.card-a').click({ position: { x: 190, y: 5 } });
  await page.locator('vf-devtools >> button[data-act="ref-usar"]').click();
  await page.locator('.card-b').click({ position: { x: 190, y: 5 } });
  await page.locator('vf-devtools >> button[data-act="ref-igual"]').click();
  const diffs = await page.evaluate(() => window.__VFDEV__.api.state.refDiff.diffs.map(d => ({ prop: d.prop, css: d.css, alvo: d.alvo, texto: d.texto })));
  assert.deepEqual(diffs.map(d => d.prop).sort(), ['border-radius', 'padding']);
  assert.ok(diffs.every(d => d.css && d.alvo === 'b'));
  assert.equal(diffs.find(d => d.prop === 'padding').texto, 'B (Card) usa 24px (= sp-6) de respiro interno; A (Card) usa sp-4 (16px)');
  assert.equal(diffs.find(d => d.prop === 'border-radius').texto, 'B (Card) usa 6px de arredondamento; A (Card) usa radius-lg (12px)');
  await page.locator('vf-devtools >> button[data-act="ref-apl"]').click();
  const cmp = await page.evaluate(() => { const g = (s, p) => getComputedStyle(document.querySelector(s)).getPropertyValue(p); return ['padding-top', 'padding-left', 'border-top-left-radius'].map(p => [g('.card-a', p), g('.card-b', p)]); });
  for (const [a, b] of cmp) assert.equal(b, a);
  const s = await page.evaluate(() => JSON.parse(JSON.stringify(window.__VFDEV__.api.sessao())));
  const ref = s.itens.find(i => i.tipo === 'referencia');
  assert.deepEqual(ref.referencia.diferencas.map(d => d.prop).sort(), ['border-radius', 'padding']);
  assert.ok(ref.referencia.diferencas.every(d => d.aplicada));
  assert.deepEqual(s.itens.filter(i => i.tipo === 'css').map(i => [i.css.prop, i.css.depois]).sort(), [['border-radius', 'var(--vf-radius-lg)'], ['padding', 'var(--vf-sp-4)']]);
});

test('4.2 · o que não é CSS (profundidade de containers) vira critério estrutural', async t => {
  const skip = await skipMotivo(); if (skip) return t.skip(skip);
  const r = await page.evaluate(() => {
    const b = document.querySelector('.card-b'), inner = document.createElement('div');
    inner.style.cssText = 'border:1px solid #ccc;background:#f5f5f5';
    while (b.firstChild) inner.appendChild(b.firstChild);
    b.appendChild(inner);
    return window.__VFDEV__.api.compararRef(document.querySelector('.card-a'), b).filter(d => !d.css).map(d => [d.aspecto, d.a, d.b, d.criterio]);
  });
  const prof = r.find(d => d[0] === 'profundidade de containers');
  assert.deepEqual(prof.slice(0, 3), ['profundidade de containers', '0', '1']);
  assert.match(prof[3], /sem card dentro de card/);
  assert.ok(r.every(d => d[3]), 'todo item não-CSS vira critério');
});

test('4.3 · com 4+ itens a aba Sessão mostra o rascunho de intenção e "Sim" vira o objetivo', async t => {
  const skip = await skipMotivo(); if (skip) return t.skip(skip);
  await page.evaluate(A(`
    A.edit(document.querySelector('.fapi-kpis'), 'gap', 'var(--vf-sp-4)');
    A.edit(document.querySelector('.fapi-filters'), 'gap', 'var(--vf-sp-2)');
    A.estrutural(document.querySelector('.dyn-7f3a'), 'remover');
    A.setTab('session');`));
  await page.locator('vf-devtools >> .intencao').waitFor({ timeout: 5000 });
  const txt = await page.locator('vf-devtools >> .intencao p').textContent();
  assert.match(txt, /^Parece que você está .*reduções de espaço.*removendo/);
  await page.locator('vf-devtools >> button[data-act="int-sim"]').click();
  assert.equal(await page.evaluate(() => window.__VFDEV__.api.sessao().objetivo), txt);
  assert.deepEqual(page.__errors || [], []);
});
