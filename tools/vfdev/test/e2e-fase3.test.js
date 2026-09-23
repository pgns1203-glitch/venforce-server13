'use strict';
/* Aceites da Fase 3 no navegador: fonte React gravável, rebuild sem F5, CSS ao vivo e desfazer gravação. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpRepo, startServer, openPage, skipMotivo, closeBrowser } = require('./helpers/e2e');

const DIR = tmpRepo();
let srv, page, context;
test.before(async () => { if (await skipMotivo()) return; srv = await startServer(DIR, 5397); ({ context, page } = await openPage(srv.base, 'fechamentos-api.html')); });
test.after(async () => { if (context) await context.close(); if (srv) await srv.stop(); await closeBrowser(); fs.rmSync(DIR, { recursive: true, force: true }); });
const A = fn => `(() => { const A = window.__VFDEV__.api; ${fn} })()`;
const F = rel => path.join(DIR, rel);
const cs = (sel, prop) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s)).getPropertyValue(p), [sel, prop]);

test('3.1 (a) · regra do bundle aponta a fonte React:linha no Painel; Gravar muda só aquela linha da fonte', async t => {
  const skip = await skipMotivo(); if (skip) return t.skip(skip);
  const info = await page.evaluate(A(`const s = A.findSource(document.querySelector('.vz-box'), 'padding'); return { kind: s.info.kind, file: s.info.file, line: s.info.line, bundle: s.info.bundle };`));
  assert.deepEqual(info, { kind: 'react-source', file: 'frontend-react/src/styles/visao.css', line: 2, bundle: 'assets/visao/visao-WpWiE2tl.css' });
  await page.evaluate(A(`A.setTab('props'); A.select(document.querySelector('.vz-box'));`));
  assert.match(await page.locator('vf-devtools >> .row .meta .mono').first().textContent(), /frontend-react\/src\/styles\/visao\.css:3/);
  const antes = fs.readFileSync(F('frontend-react/src/styles/visao.css'), 'utf8');
  await page.evaluate(A(`A.edit(document.querySelector('.vz-box'), 'padding', '10px');`));
  assert.deepEqual(await page.evaluate(() => window.__VFDEV__.api.buildPatch().map(f => f.file)), ['frontend-react/src/styles/visao.css']);
  await page.evaluate(() => window.__VFDEV__.api.apply(false));
  const depois = fs.readFileSync(F('frontend-react/src/styles/visao.css'), 'utf8');
  assert.equal(depois, antes.replace('  padding: 18px;', '  padding: 10px;'));
  assert.equal(await page.evaluate(() => window.__VFDEV__.api.changes.size), 0);
  assert.equal(await cs('.vz-box', 'padding-top'), '10px');
});

test('3.1 (b) · rebuild troca o <link> do bundle pelo hash novo sem F5', async t => {
  const skip = await skipMotivo(); if (skip) return t.skip(skip);
  await page.evaluate(() => { window.__semF5 = 'mesma página'; });
  const ok = await page.evaluate(() => window.__VFDEV__.api.rebuildIlha('visao'));
  assert.equal(ok, true);
  await page.waitForFunction(() => window.__VFDEV__.lastRebuild, null, { timeout: 20000 });
  const r = await page.evaluate(() => ({ marca: window.__semF5, href: [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.getAttribute('href')).find(h => h.includes('assets/visao/')), rb: window.__VFDEV__.lastRebuild }));
  assert.equal(r.marca, 'mesma página');
  assert.equal(r.rb.ok, true);
  assert.match(r.href, /\/assets\/visao\/visao-\w+\.css\?v=/);
  assert.ok(!r.href.includes('WpWiE2tl'));
  assert.equal(await cs('.vz-box', 'padding-top'), '10px');          // agora vem do bundle novo (com a fonte gravada)
  assert.equal(await cs('.vz-box', 'background-color'), 'rgb(238, 238, 255)');
  // a regra do bundle novo continua apontando a fonte
  assert.equal(await page.evaluate(A(`return A.findSource(document.querySelector('.vz-box'), 'padding').info.kind;`)), 'react-source');
  assert.match(await page.locator('vf-devtools >> #dbody').textContent(), /Rebuild de visao ok/);
});

test('3.2 (c) · editar um CSS por fora reflete na tela em menos de 1 s', async t => {
  const skip = await skipMotivo(); if (skip) return t.skip(skip);
  assert.equal(await cs('.fapi-kpis', 'row-gap'), '24px');
  const t0 = Date.now();
  const f = F('Portal/css/pages/fechamentos-api-v2.css');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('gap: var(--vf-sp-6); margin-bottom', 'gap: var(--vf-sp-2); margin-bottom'));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.fapi-kpis')).rowGap === '8px', null, { timeout: 1000, polling: 20 });
  const ms = Date.now() - t0;
  assert.ok(ms < 1000, `${ms}ms`);
  await page.waitForFunction(() => { const l = window.__VFDEV__.lastLive; return l && l.file === 'css/pages/fechamentos-api-v2.css' && l.msg === 'recarregado do disco'; }, null, { timeout: 3000 });
  // reindexado: a regra continua apontando o arquivo:linha certo
  assert.equal(await page.evaluate(A(`const s = A.findSource(document.querySelector('.fapi-kpis'), 'gap'); return s.info.file + ':' + s.info.line + ' ' + s.value;`)), 'css/pages/fechamentos-api-v2.css:9 var(--vf-sp-2)');
});

test('3.3 (d) · Gravar e Desfazer gravação pela aba Alterações: arquivo idêntico byte a byte e a tela volta', async t => {
  const skip = await skipMotivo(); if (skip) return t.skip(skip);
  const f = F('Portal/css/pages/fechamentos-api-v2.css'), orig = fs.readFileSync(f);
  if (await page.locator('vf-devtools >> #drawer').isVisible()) await page.locator('vf-devtools >> #dclose').click();
  await page.evaluate(A(`A.edit(document.querySelector('.fapi-filters'), 'gap', 'var(--vf-sp-6)');`));
  await page.evaluate(() => window.__VFDEV__.api.apply(false));
  assert.notDeepEqual(fs.readFileSync(f), orig);
  await page.evaluate(A(`A.setTab('changes');`));
  const undo = page.locator('vf-devtools >> button[data-act="undo-grav"]').first();
  await undo.waitFor({ timeout: 5000 });
  assert.match(await page.locator('vf-devtools >> .chg').first().textContent(), /css\/pages\/fechamentos-api-v2\.css/);
  await undo.click();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.fapi-filters')).columnGap === '12px', null, { timeout: 2000 });
  assert.ok(Buffer.compare(fs.readFileSync(f), orig) === 0, 'não voltou byte a byte');
  await page.locator('vf-devtools >> .badge:has-text("desfeita")').first().waitFor();
  assert.deepEqual(page.__errors || [], []);
});
