'use strict';
/* Aceite da Fase 2 no navegador: gerar missão pela UI, "agente" aplica 3 de 4 mudanças no disco, Verificar missão. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpPortal, startServer, openPage, skipMotivo, closeBrowser } = require('./helpers/e2e');

const DIR = tmpPortal();
let srv;
test.after(async () => { if (srv) await srv.stop(); await closeBrowser(); fs.rmSync(DIR, { recursive: true, force: true }); });
const A = fn => `(() => { const A = window.__VFDEV__.api; ${fn} })()`;
const P = f => path.join(DIR, 'Portal', f);
const troca = (f, de, para) => { const t = fs.readFileSync(P(f), 'utf8'); assert.ok(t.includes(de), `${f} não tem ${de}`); fs.writeFileSync(P(f), t.replace(de, para)); };

test('2.1 + 2.2 · gerar missão pela UI; agente aplica 3 de 4 → 3 ✓ e 1 ✗ com o valor real; depois 4/4 → verificada', async t => {
  const skip = await skipMotivo(); if (skip) return t.skip(skip);
  srv = await startServer(DIR, 5395);
  const { context, page } = await openPage(srv.base, 'fechamentos-api.html');
  await page.evaluate(A(`A.setTab('session');`));
  await page.locator('vf-devtools >> text=Nova sessão').click();
  await page.evaluate(A(`
    A.edit(document.querySelector('.fapi-kpis'), 'gap', 'var(--vf-sp-4)');
    A.edit(document.querySelector('.vz-title'), 'font-size', '18px');
    A.edit(document.querySelector('.fapi-filters'), 'margin-bottom', 'var(--vf-sp-4)');
    A.estrutural(document.querySelector('.inline-note'), 'remover');
    A.sessao().larguras = [1440];
    A.setTab('session');`));
  // Gerar missão: pede o Objetivo e sugere um rascunho por regras
  await page.locator('vf-devtools >> button[data-act="mis-gerar"]').click();
  const obj = page.locator('vf-devtools >> #obj-text');
  await obj.waitFor();
  const rascunho = await obj.inputValue();
  assert.equal(rascunho, 'Compactar a primeira dobra: 1 gap reduzido, 1 fonte aumentada, 1 margem reduzida, 1 item marcado para remoção (nota)');
  await obj.fill('Compactar a primeira dobra e tirar a nota solta');
  await page.locator('vf-devtools >> button[data-act="obj-ok"]').click();
  await page.waitForFunction(() => window.__VFDEV__.api.sessao().status === 'missao_gerada');
  const id = await page.evaluate(() => window.__VFDEV__.api.sessao().id);
  const md = fs.readFileSync(path.join(DIR, 'missoes', id + '.md'), 'utf8');
  assert.match(md, /## Objetivo\n\nCompactar a primeira dobra e tirar a nota solta/);
  assert.match(await page.locator('vf-devtools >> #ptext').textContent(), /^# Missão — /);
  const mj = JSON.parse(fs.readFileSync(path.join(DIR, 'missoes', id + '.json'), 'utf8'));
  assert.deepEqual(mj.verificacoes.map(v => v.tipo), ['computado', 'computado', 'computado', 'ausente', 'presente', 'presente', 'presente', 'sem-overflow']);
  await page.locator('vf-devtools >> #dclose').click();

  // "agente" aplica 3 das 4 mudanças direto nos arquivos
  troca('css/pages/fechamentos-api-v2.css', 'gap: var(--vf-sp-6); margin-bottom', 'gap: var(--vf-sp-4); margin-bottom');
  troca('assets/visao/visao-WpWiE2tl.css', '.vz-title{font-size:13px', '.vz-title{font-size:18px');
  troca('fechamentos-api.html', '    <p class="inline-note" style="margin-top: 20px">Nota com estilo inline</p>\n', '');

  await page.locator('vf-devtools >> button[data-act="mis-verif"]').click();
  await page.waitForFunction(() => { const s = window.__VFDEV__.api.sessao(); return s.verificacao && s.verificacao.resultados; }, null, { timeout: 30000 });
  const s = await page.evaluate(() => JSON.parse(JSON.stringify(window.__VFDEV__.api.sessao())));
  const porItem = s.itens.map(it => ({ id: it.id, tipo: it.tipo, prop: it.css && it.css.prop, res: s.verificacao.resultados.filter(r => r.item === it.id) }));
  const ok = porItem.filter(x => x.res.length && x.res.every(r => r.ok)), ko = porItem.filter(x => x.res.some(r => !r.ok));
  assert.equal(ok.length, 3, JSON.stringify(porItem));
  assert.equal(ko.length, 1);
  assert.equal(ko[0].prop, 'margin-bottom');
  const falha = ko[0].res.find(r => !r.ok);
  assert.equal(falha.esperado, '16px');
  assert.equal(falha.obtido, '32px');
  assert.equal(s.status, 'missao_gerada');
  const ui = await page.locator('vf-devtools >> .vr.ko').allTextContents();
  assert.equal(ui.length, 1);
  assert.match(ui[0], /margin-bottom.*obtido: 32px · esperado: 16px/);
  assert.equal(await page.locator('vf-devtools >> .vr.ok').count(), s.verificacao.resultados.length - 1);

  // agente termina; verificação passa e a sessão fica "verificada"
  troca('css/pages/fechamentos-api-v2.css', 'margin-bottom: var(--vf-sp-8);\n}', 'margin-bottom: var(--vf-sp-4);\n}');
  await page.locator('vf-devtools >> button[data-act="mis-verif"]').click();
  await page.waitForFunction(() => window.__VFDEV__.api.sessao().status === 'verificada', null, { timeout: 30000 });
  const onDisk = JSON.parse(fs.readFileSync(path.join(DIR, 'sessoes', id + '.json'), 'utf8'));
  assert.equal(onDisk.status, 'verificada');
  assert.equal(onDisk.verificacao.falhas, 0);
  assert.deepEqual(page.__errors || [], []);
  await context.close();
});
