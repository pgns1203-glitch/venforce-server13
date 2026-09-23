'use strict';
/* Aceites da Fase 1 no navegador real (Chromium via playwright-core, opcional). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpPortal, startServer, openPage, skipMotivo, closeBrowser, ROOT } = require('./helpers/e2e');

const DIR = tmpPortal();
const PORT = 5393;
let srv;
test.after(async () => { if (srv) await srv.stop(); await closeBrowser(); fs.rmSync(DIR, { recursive: true, force: true }); });

const A = fn => `(() => { const A = window.__VFDEV__.api; ${fn} })()`;
const sessao = async page => {
  const [s, err] = await page.evaluate(() => [JSON.parse(JSON.stringify(window.__VFDEV__.api.sessao())), window.__VFDEV__.api.erroSessao()]);
  assert.equal(err, '', 'erro ao salvar a sessão');
  return s;
};
const inside = (p, r) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
async function pinOverTarget(page, id, sel, idx = 0) {
  await page.waitForFunction(id => document.querySelector('vf-devtools').shadowRoot.querySelector(`.pin[data-pin="${id}"]`), id, { timeout: 3000 }).catch(() => {});
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(([id, sel, idx]) => {
    const pin = document.querySelector('vf-devtools').shadowRoot.querySelector(`.pin[data-pin="${id}"]`);
    if (!pin) return { ok: false, why: 'sem pin' };
    const p = pin.getBoundingClientRect(), c = { x: p.left + p.width / 2, y: p.top + p.height / 2 };
    const r = document.querySelectorAll(sel)[idx].getBoundingClientRect();
    return { ok: c.x >= r.left && c.x <= r.right && c.y >= r.top && c.y <= r.bottom, c, r: r.toJSON() };
  }, [id, sel, idx]);
}

test('1.1 · 5 itens de tipos variados sobrevivem a fechar a aba e reiniciar o servidor, com o CSS reaplicado', async t => {
  const skip = await skipMotivo(); if (skip) return t.skip(skip);
  srv = await startServer(DIR, PORT);
  let { context, page } = await openPage(srv.base, 'fechamentos-api.html');
  await page.evaluate(A(`A.setTab('session');`));
  await page.locator('vf-devtools >> text=Nova sessão').click();
  // 1) css gravável (regra da página) e 2) css só-prompt (CSS do Vite)
  await page.evaluate(A(`A.edit(document.querySelector('.fapi-kpis'), 'gap', 'var(--vf-sp-4)'); A.edit(document.querySelector('.vz-title'), 'font-size', '18px');`));
  // 3) comentário pelo teclado: seleciona, aperta C, usa um chip e salva
  await page.evaluate(A(`A.select(document.querySelectorAll('.vf-kpi__value')[1]);`));
  await page.keyboard.press('c');
  await page.locator('vf-devtools >> [data-chip="grande demais"]').click();
  await page.keyboard.press('Control+Enter');
  // 4) estrutural "remover" pelo menu Estrutura do Painel
  await page.evaluate(A(`A.select(document.querySelector('.fapi-filters'));`));
  await page.locator('vf-devtools >> summary:has-text("Estrutura")').click();
  await page.locator('vf-devtools >> button[data-acao="remover"]').click();
  // 5) estrutural com relação: "mover para antes de" + segundo clique na página
  await page.evaluate(A(`A.select(document.querySelector('.fapi-table'));`));
  await page.locator('vf-devtools >> summary:has-text("Estrutura")').click();
  await page.locator('vf-devtools >> button[data-acao="mover_antes"]').click();
  await page.locator('.fapi-wrap > h2').click();
  await page.evaluate(() => window.__VFDEV__.api.saveNow());
  const s1 = await sessao(page);
  assert.deepEqual(s1.itens.map(i => i.tipo).sort(), ['comentario', 'css', 'css', 'estrutural', 'estrutural']);
  assert.equal(s1.itens.find(i => i.tipo === 'comentario').comentario.texto, 'grande demais');
  const mover = s1.itens.find(i => i.estrutural && i.estrutural.acao === 'mover_antes');
  assert.equal(mover.estrutural.relacionado.texto, 'Central de Vendas');
  assert.match(mover.estrutural.relacionado.caminhoDom, /h2:nth-child\(1\)$/);
  const cssGravavel = s1.itens.find(i => i.css && i.css.prop === 'gap');
  assert.equal(cssGravavel.css.destino, 'pendente');
  assert.equal(cssGravavel.css.arquivo, 'Portal/css/pages/fechamentos-api-v2.css');
  assert.equal(cssGravavel.css.linha, 9);
  assert.equal(s1.itens.find(i => i.css && i.css.prop === 'font-size').css.destino, 'prompt');
  const before = await page.evaluate(() => [getComputedStyle(document.querySelector('.fapi-kpis')).rowGap, getComputedStyle(document.querySelector('.vz-title')).fontSize]);
  assert.deepEqual(before, ['16px', '18px']);
  const onDisk = JSON.parse(fs.readFileSync(path.join(DIR, 'sessoes', s1.id + '.json'), 'utf8'));
  assert.equal(onDisk.itens.length, 5);

  await context.close();          // fecha a aba (sessionStorage some)
  await srv.stop();               // reinicia o servidor (novo token)
  srv = await startServer(DIR, PORT);
  ({ context, page } = await openPage(srv.base, 'fechamentos-api.html'));
  // sem sessionStorage: o painel OFERECE continuar (não retoma sozinho)
  assert.equal(await page.evaluate(() => window.__VFDEV__.api.sessao()), null);
  await page.locator(`vf-devtools >> button[data-act="ses-cont"][data-id="${s1.id}"]`).click();
  await page.waitForFunction(() => window.__VFDEV__.api.sessao());
  const s2 = await sessao(page);
  assert.equal(s2.itens.length, 5);
  assert.deepEqual(s2.itens.map(i => i.id), s1.itens.map(i => i.id));
  const after = await page.evaluate(() => [getComputedStyle(document.querySelector('.fapi-kpis')).rowGap, getComputedStyle(document.querySelector('.vz-title')).fontSize]);
  assert.deepEqual(after, before);
  assert.equal(await page.evaluate(() => window.__VFDEV__.api.changes.size), 2);
  assert.deepEqual(page.__errors || [], []);
  await context.close();
});

test('1.1 · CSS que não dá para reaplicar vira "descartada: regra mudou em arquivo:linha"', async t => {
  const skip = await skipMotivo(); if (skip) return t.skip(skip);
  const id = fs.readdirSync(path.join(DIR, 'sessoes'))[0].replace('.json', '');
  const f = path.join(DIR, 'Portal', 'css/pages/fechamentos-api-v2.css');
  const orig = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, '/* linha nova */\n' + orig);     // a regra desce uma linha no disco
  const { context, page } = await openPage(srv.base, 'fechamentos-api.html');
  await page.locator(`vf-devtools >> button[data-act="ses-cont"][data-id="${id}"]`).click();
  await page.waitForFunction(() => window.__VFDEV__.api.sessao());
  const s = await sessao(page);
  const gap = s.itens.find(i => i.css && i.css.prop === 'gap');
  assert.equal(gap.css.destino, 'descartada');
  assert.match(gap.css.motivo, /^descartada: regra mudou em Portal\/css\/pages\/fechamentos-api-v2\.css:9/);
  assert.equal(s.itens.find(i => i.css && i.css.prop === 'font-size').css.destino, 'prompt');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.fapi-kpis')).rowGap), '24px');
  fs.writeFileSync(f, orig);
  await context.close();
});

test('1.2 · pin criado a 1440 px fica sobre o mesmo elemento em 768 px (comparação) e depois de F5; região com Shift+arrastar', async t => {
  const skip = await skipMotivo(); if (skip) return t.skip(skip);
  const { context, page } = await openPage(srv.base, 'fechamentos-api.html', 1440);
  await page.evaluate(A(`A.setTab('session');`));
  await page.locator('vf-devtools >> text=Nova sessão').click();
  const id = await page.evaluate(A(`return A.comentar(document.querySelectorAll('.vf-kpi__value')[2], 'isso deveria subir').id;`));
  let o = await pinOverTarget(page, id, '.vf-kpi__value', 2);
  assert.ok(o.ok, JSON.stringify(o));
  // região com Shift+arrastar
  const r = await page.evaluate(() => document.querySelector('.fapi-table').getBoundingClientRect().toJSON());
  await page.keyboard.down('Shift');
  await page.mouse.move(r.left + 20, r.top + 20); await page.mouse.down();
  await page.mouse.move(r.left + 120, r.top + 60, { steps: 4 }); await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.locator('vf-devtools >> #talk-text').fill('parece vazio aqui');
  await page.locator('vf-devtools >> #talk-save').click();
  const reg = (await sessao(page)).itens.find(i => i.comentario && i.comentario.texto === 'parece vazio aqui');
  assert.equal(reg.alvo.regiao, true);
  assert.equal(reg.alvo.seletor, '.fapi-table');
  assert.equal(reg.alvo.rect.w, 100);

  // comparação de larguras: a sessão manda 1440/768/390; o pin aparece dentro do iframe de 768
  await page.evaluate(() => window.__VFDEV__.api.saveNow());
  await page.evaluate(() => window.__VFDEV__.api.openCompare());
  const frame768 = await (async () => {
    for (let k = 0; k < 50; k++) {
      for (const f of page.frames()) { if (f === page.mainFrame()) continue; try { if (await f.evaluate(() => innerWidth) === 768 && await f.evaluate(() => document.querySelectorAll('.vf-kpi__value').length) === 4) return f; } catch (e) {} }
      await page.waitForTimeout(100);
    }
    return null;
  })();
  assert.ok(frame768, 'iframe de 768 px não carregou');
  await frame768.waitForSelector(`[data-vfdev-pin="${id}"]`, { state: 'attached' });
  const inFrame = await frame768.evaluate(id => {
    const p = document.querySelector(`[data-vfdev-pin="${id}"]`).getBoundingClientRect();
    const r = document.querySelectorAll('.vf-kpi__value')[2].getBoundingClientRect();
    const c = { x: p.left + p.width / 2, y: p.top + p.height / 2 };
    return { ok: c.x >= r.left && c.x <= r.right && c.y >= r.top && c.y <= r.bottom, c, r: r.toJSON(), iw: innerWidth };
  }, id);
  assert.ok(inFrame.ok, JSON.stringify(inFrame));
  await page.locator('vf-devtools >> #cmp-close').click();

  // F5: a mesma aba retoma a sessão sozinha (sessionStorage) e o pin volta sobre o elemento
  await page.reload();
  await page.waitForFunction(() => window.__VFDEV__ && window.__VFDEV__.ready && window.__VFDEV__.api.sessao());
  await page.waitForFunction(id => document.querySelector('vf-devtools').shadowRoot.querySelector(`.pin[data-pin="${id}"]`), id);
  o = await pinOverTarget(page, id, '.vf-kpi__value', 2);
  assert.ok(o.ok, JSON.stringify(o));
  // o pin acompanha a rolagem
  await page.setViewportSize({ width: 1440, height: 300 });
  await page.evaluate(() => window.scrollTo(0, 200));
  await page.waitForTimeout(100);
  o = await pinOverTarget(page, id, '.vf-kpi__value', 2);
  assert.ok(o.ok, 'depois de rolar: ' + JSON.stringify(o));
  // clicar no pin abre o comentário para editar / resolver
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator(`vf-devtools >> .pin[data-pin="${id}"]`).click();
  assert.equal(await page.locator('vf-devtools >> #talk-text').inputValue(), 'isso deveria subir');
  await page.locator('vf-devtools >> #talk-resolve').click();
  assert.equal((await sessao(page)).itens.find(i => i.id === id).comentario.resolvido, true);
  await context.close();
});

test('1.3 · "Por quê?" aparece depois de editar, some em 6 s se vazio, e a nota vai para o item', async t => {
  const skip = await skipMotivo(); if (skip) return t.skip(skip);
  const { context, page } = await openPage(srv.base, 'fechamentos-api.html');
  await page.evaluate(A(`A.setTab('session');`));
  await page.locator('vf-devtools >> text=Nova sessão').click();
  await page.evaluate(A(`const el = document.querySelector('.fapi-kpis'); A.select(el); A.edit(el, 'gap', 'var(--vf-sp-3)');`));
  const why = page.locator('vf-devtools >> .row input.why');
  await why.fill('os KPIs parecem soltos');
  await page.evaluate(() => window.__VFDEV__.api.saveNow());
  const it = (await sessao(page)).itens.find(i => i.tipo === 'css');
  assert.equal(it.nota, 'os KPIs parecem soltos');
  assert.equal(it.css.antes, 'var(--vf-sp-6)');
  assert.equal(it.css.depois, 'var(--vf-sp-3)');
  // aba Alterações também tem o campo, com a nota
  await page.evaluate(A(`A.setTab('changes');`));
  assert.equal(await page.locator('vf-devtools >> .chg input.why').inputValue(), 'os KPIs parecem soltos');
  // outra edição sem nota: o campo some sozinho
  await page.evaluate(A(`A.setTab('props'); const el = document.querySelector('.fapi-filters'); A.select(el); A.edit(el, 'gap', 'var(--vf-sp-2)');`));
  assert.equal(await page.locator('vf-devtools >> .row input.why').count(), 1);
  await page.waitForTimeout(6300);
  assert.equal(await page.locator('vf-devtools >> .row input.why').count(), 0);
  await context.close();
});

test('1.4 · "remover" vira item estrutural com critérios; a prévia some ao desligar; nada é gravado', async t => {
  const skip = await skipMotivo(); if (skip) return t.skip(skip);
  const snap = dir => { const o = {}; const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else o[path.relative(dir, p)] = fs.readFileSync(p, 'utf8'); } }; walk(dir); return o; };
  const portal = path.join(DIR, 'Portal'), antes = snap(portal);
  const { context, page } = await openPage(srv.base, 'fechamentos-api.html');
  await page.evaluate(A(`A.setTab('session');`));
  await page.locator('vf-devtools >> text=Nova sessão').click();
  await page.evaluate(A(`A.select(document.querySelector('.vz-box'));`));
  await page.locator('vf-devtools >> summary:has-text("Estrutura")').click();
  await page.locator('vf-devtools >> button[data-acao="remover"]').click();
  const it = (await sessao(page)).itens[0];
  assert.equal(it.tipo, 'estrutural');
  assert.deepEqual(it.estrutural.criterios, ['não usar display:none', 'remover a renderização do componente', 'remover container vazio e estilos exclusivos (altura, sticky, borda)', 'preservar as demais seções']);
  await page.evaluate(A(`A.setTab('session');`));
  await page.locator(`vf-devtools >> button[data-act="previa"][data-id="${it.id}"]`).click();
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.vz-box')).visibility), 'hidden');
  assert.equal(await page.locator('vf-devtools >> .previa').textContent(), 'prévia — não será gravada');
  assert.equal(await page.evaluate(() => window.__VFDEV__.api.buildPatch().length), 0);
  await page.locator(`vf-devtools >> button[data-act="previa"][data-id="${it.id}"]`).click();
  assert.doesNotMatch(await page.evaluate(() => document.querySelector('.vz-box').getAttribute('style') || ''), /visibility/);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.vz-box')).visibility), 'visible');
  await page.waitForFunction(() => !document.querySelector('vf-devtools').shadowRoot.querySelector('.previa'), null, { timeout: 2000 });
  // critérios editáveis
  await page.locator(`vf-devtools >> textarea[data-crit="${it.id}"]`).fill('não usar display:none\nremover o componente VzBox');
  await page.locator('vf-devtools >> #ses-title').click();
  await page.evaluate(() => window.__VFDEV__.api.saveNow());
  assert.deepEqual((await sessao(page)).itens[0].estrutural.criterios, ['não usar display:none', 'remover o componente VzBox']);
  await context.close();
  assert.deepEqual(snap(portal), antes, 'nenhum arquivo do Portal pode mudar');
});
