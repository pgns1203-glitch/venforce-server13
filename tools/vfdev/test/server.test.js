'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// cópia descartável do fixture, para o patch gravar de verdade sem sujar o repo
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vfdev-'));
fs.cpSync(path.join(__dirname, 'fixture'), TMP, { recursive: true });
process.env.VFDEV_PORTAL_DIR = TMP;
process.env.VFDEV_PORT = '5391';
const { server, TOKEN } = require('../server');
const BASE = 'http://127.0.0.1:5391';

test.before(() => new Promise(r => server.listen(5391, '127.0.0.1', r)));
test.after(() => { server.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

const post = (body, headers = {}) => fetch(BASE + '/__vfdev/patch', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-VFDEV-Token': TOKEN, ...headers }, body: JSON.stringify(body) });
const KPIS = { op: 'set', line: 9, column: 1, selector: '.vf-page-fechamentos-api .fapi-kpis', prop: 'gap', value: 'var(--vf-sp-4)' };

test('injeta o cliente no HTML e não grava nada no arquivo', async () => {
  const html = await (await fetch(BASE + '/fechamentos-api.html')).text();
  assert.match(html, /<script src="\/__vfdev\/client\.js\?t=[0-9a-f]{32}" defer data-vfdev><\/script>\n<\/body>/);
  assert.ok(!fs.readFileSync(path.join(TMP, 'fechamentos-api.html'), 'utf8').includes('__vfdev'));
});

test('?vfdev=off devolve o HTML sem o editor', async () => {
  const html = await (await fetch(BASE + '/fechamentos-api.html?vfdev=off')).text();
  assert.ok(!html.includes('__vfdev'));
});

test('index classifica os arquivos', async () => {
  const k = async f => (await (await fetch(BASE + '/__vfdev/index?file=' + encodeURIComponent(f))).json()).kind;
  assert.equal(await k('css/pages/fechamentos-api-v2.css'), 'page');
  assert.equal(await k('css/vf-components-v2.css'), 'global');
  assert.equal(await k('style.css'), 'protected');
  assert.equal(await k('assets/visao/visao-WpWiE2tl.css'), 'built');
});

test('patch sem token é recusado (403)', async () => {
  const r = await fetch(BASE + '/__vfdev/patch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: [{ file: 'css/pages/fechamentos-api-v2.css', patches: [KPIS] }] }) });
  assert.equal(r.status, 403);
});

test('patch vindo de outra origem é recusado (403)', async () => {
  const r = await post({ files: [{ file: 'css/pages/fechamentos-api-v2.css', patches: [KPIS] }] }, { Origin: 'http://evil.test' });
  assert.equal(r.status, 403);
});

test('protegido, gerado pelo Vite e fora do Portal são recusados', async () => {
  assert.equal((await post({ files: [{ file: 'style.css', patches: [KPIS] }] })).status, 403);
  assert.equal((await post({ files: [{ file: 'assets/visao/visao-WpWiE2tl.css', patches: [KPIS] }] })).status, 403);
  assert.equal((await post({ files: [{ file: '../../etc/passwd.css', patches: [KPIS] }] })).status, 400);
  assert.equal((await post({ files: [{ file: 'fechamentos-api.js', patches: [KPIS] }] })).status, 400);
});

test('dryRun devolve o diff e não grava', async () => {
  const before = fs.readFileSync(path.join(TMP, 'css/pages/fechamentos-api-v2.css'), 'utf8');
  const j = await (await post({ dryRun: true, files: [{ file: 'css/pages/fechamentos-api-v2.css', patches: [KPIS] }] })).json();
  assert.equal(j.results[0].written, false);
  assert.match(j.results[0].changes[0].after, /gap: var\(--vf-sp-4\)/);
  assert.equal(fs.readFileSync(path.join(TMP, 'css/pages/fechamentos-api-v2.css'), 'utf8'), before);
});

test('patch grava só a declaração alterada', async () => {
  const file = path.join(TMP, 'css/pages/fechamentos-api-v2.css');
  const before = fs.readFileSync(file, 'utf8');
  const r = await post({ files: [{ file: 'css/pages/fechamentos-api-v2.css', patches: [KPIS] }] });
  assert.equal(r.status, 200);
  assert.equal(fs.readFileSync(file, 'utf8'), before.replace('gap: var(--vf-sp-6)', 'gap: var(--vf-sp-4)'));
});

test('segundo patch na mesma posição antiga com seletor errado é recusado (409)', async () => {
  const r = await post({ files: [{ file: 'css/pages/fechamentos-api-v2.css', patches: [{ ...KPIS, selector: '.outra' }] }] });
  assert.equal(r.status, 409);
});
