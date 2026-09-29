'use strict';
/* Aceites da Fase 5 no navegador: "está estranho" (1 fixture que dispara e 1 que não, por checagem), bissecção de regressão e estados. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpPortal, startServer, openPage, skipMotivo, closeBrowser } = require('./helpers/e2e');

const DIR = tmpPortal();
fs.writeFileSync(path.join(DIR, 'Portal', 'estranho.html'), `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Estranho</title>
<link rel="stylesheet" href="css/vf-tokens-v2.css">
<style>
  body { margin: 0; font: 14px/1.4 sans-serif; background: #fff; color: #222; }
  .wrap > section { margin: 0 0 16px; padding: 0 8px; }
  .eq-card { padding: 16px; } #eq1 { padding: 32px; }
  .stack .b { margin: 0 0 16px; height: 20px; } #ev-sim { margin-top: 96px; }
  #lc-sim, #lc-nao { width: 600px; }
  .acts button, .acts2 button { width: 120px; height: 40px; border: 0; }
  .btn-pri, .btn-sec { font: 600 14px sans-serif; background: #5a2a8f; color: #fff; }
  .btn-pri2 { font: 600 14px sans-serif; background: #5a2a8f; color: #fff; } .btn-sec2 { font: 400 11px sans-serif; background: transparent; color: #333; width: 60px !important; height: 20px !important; }
  #tk-sim { border-radius: 7px; } #tk-nao { border-radius: 10px; }
</style></head>
<body><div class="wrap">
  <section class="s-eq"><div class="eq-card" id="eq1">a</div><div class="eq-card" id="eq2">b</div><div class="eq-card">c</div><div class="eq-card">d</div></section>
  <section class="stack"><div class="b">1</div><div class="b" id="ev-nao">2</div><div class="b" id="ev-sim">3</div><div class="b">4</div></section>
  <section class="s-lc"><div id="lc-sim"><span>curto</span></div><div id="lc-nao"><div>um bloco que ocupa a largura toda</div></div></section>
  <section class="s-hi"><div id="hi-sim"><span style="font-size:14px;font-weight:600">Receita</span> <strong style="font-size:15px;font-weight:600">R$ 10</strong></div><div id="hi-nao"><span style="font-size:12px;font-weight:500">Receita</span> <strong style="font-size:24px;font-weight:700">R$ 10</strong></div></section>
  <section class="s-pw"><div class="acts"><button class="btn-pri" id="pw-sim">Salvar</button><button class="btn-sec">Cancelar</button></div><div class="acts2"><button class="btn-pri2" id="pw-nao">Salvar</button><button class="btn-sec2">Cancelar</button></div></section>
  <section class="s-an"><div style="border:1px solid #ccc;padding:8px"><div id="an-sim" style="border:1px solid #ccc;padding:8px">x</div></div><div style="padding:8px"><div id="an-nao" style="border:1px solid #ccc">y</div></div></section>
  <section class="s-tk"><div id="tk-sim">raio 7</div><div id="tk-nao">raio 10</div></section>
  <section class="s-ct"><p id="ct-sim" style="color:#bbbbbb;background:#fff">texto claro</p><p id="ct-nao" style="color:#222;background:#fff">texto escuro</p></section>
  <section class="s-ap"><div id="ap-sim"><button style="width:20px;height:20px;padding:0">x</button></div><div id="ap-nao"><button style="width:40px;height:36px">ok</button></div></section>
  <section class="s-da"><div class="col"><div>a</div><div id="da-sim" style="margin-left:2px">b</div></div><div class="col"><div>a</div><div id="da-nao">b</div></div></section>
</div></body></html>
`);
let srv;
test.before(async () => { if (await skipMotivo()) return; srv = await startServer(DIR, 5402); });
test.after(async () => { if (srv) await srv.stop(); await closeBrowser(); fs.rmSync(DIR, { recursive: true, force: true }); });
const A = fn => `(() => { const A = window.__VFDEV__.api; ${fn} })()`;

const CASOS = [['equivalentes', 'eq1', 'eq2'], ['espaco-vertical', 'ev-sim', 'ev-nao'], ['largura-conteudo', 'lc-sim', 'lc-nao'], ['hierarquia', 'hi-sim', 'hi-nao'], ['peso-irmaos', 'pw-sim', 'pw-nao'],
  ['aninhado', 'an-sim', 'an-nao'], ['fora-dos-tokens', 'tk-sim', 'tk-nao'], ['contraste', 'ct-sim', 'ct-nao'], ['alvo-pequeno', 'ap-sim', 'ap-nao'], ['desalinhamento', 'da-sim', 'da-nao']];

test('5.1 · cada checagem de "está estranho" dispara no fixture certo e não dispara no outro', async t => {
  const skip = await skipMotivo(); if (skip) return t.skip(skip);
  const { context, page } = await openPage(srv.base, 'estranho.html');
  const res = await page.evaluate(casos => casos.map(([k, sim, nao]) => {
    const E = id => window.__VFDEV__.api.estranho(document.getElementById(id));
    const a = E(sim), b = E(nao);
    return { k, sim: a.filter(f => f.medida.checagem === k).map(f => f.fato), nao: b.filter(f => f.medida.checagem === k).map(f => f.fato) };
  }), CASOS);
  for (const r of res) {
    assert.ok(r.sim.length === 1, `${r.k}: não disparou no fixture que deveria — ${JSON.stringify(r)}`);
    assert.ok(r.nao.length === 0, `${r.k}: disparou onde não devia — ${JSON.stringify(r.nao)}`);
  }
  const fatos = Object.fromEntries(res.map(r => [r.k, r.sim[0]]));
  assert.match(fatos.equivalentes, /usa 32px de padding; os 3 equivalentes usam 16px/);
  assert.match(fatos['espaco-vertical'], /O espaço acima de .* é 96px; a mediana entre blocos irmãos da página é 16px/);
  assert.match(fatos.contraste, /contraste 1\.\d\d:1 \(mínimo 4\.5:1\)/);
  assert.match(fatos['alvo-pequeno'], /mede 20×20px/);
  assert.match(fatos['fora-dos-tokens'], /raio de 7px/);
  // só mede: nada na página mudou, e os fatos vêm ranqueados pelo desvio
  const antes = await page.evaluate(() => document.body.innerHTML);
  const ord = await page.evaluate(() => window.__VFDEV__.api.estranho(document.getElementById('eq1')).map(f => f.medida.desvio));
  assert.deepEqual(ord, [...ord].sort((a, b) => b - a));
  assert.equal(await page.evaluate(() => document.body.innerHTML), antes);
  await context.close();
});

test('5.1 · vira item "estranho" na sessão e cada fato vira comentário com 1 clique', async t => {
  const skip = await skipMotivo(); if (skip) return t.skip(skip);
  const { context, page } = await openPage(srv.base, 'estranho.html');
  await page.evaluate(A(`A.setTab('session');`));
  await page.locator('vf-devtools >> text=Nova sessão').click();
  await page.evaluate(A(`A.setTab('props'); A.select(document.getElementById('ct-sim'));`));
  await page.locator('vf-devtools >> button[data-act="estranho"]').click();
  const it = await page.evaluate(() => window.__VFDEV__.api.sessao().itens.find(i => i.tipo === 'estranho'));
  assert.ok(it.estranho.achados.some(f => f.medida.checagem === 'contraste'));
  await page.locator('vf-devtools >> button[data-act="fato-com"]').first().click();
  const com = await page.evaluate(() => window.__VFDEV__.api.sessao().itens.find(i => i.tipo === 'comentario'));
  assert.equal(com.comentario.texto, it.estranho.achados[0].fato);
  assert.equal(com.alvo.seletor, it.alvo.seletor);
  await page.evaluate(() => window.__VFDEV__.api.saveNow());
  assert.equal(await page.evaluate(() => window.__VFDEV__.api.erroSessao()), '');
  await context.close();
});

test('5.2 · 5 alterações, só 1 causa overflow em 768: a bissecção aponta exatamente essa; "Corrigir só ≤900px" resolve', async t => {
  const skip = await skipMotivo(); if (skip) return t.skip(skip);
  const { context, page } = await openPage(srv.base, 'fechamentos-api.html');
  await page.evaluate(A(`A.setTab('session');`));
  await page.locator('vf-devtools >> text=Nova sessão').click();
  await page.evaluate(A(`
    A.edit(document.querySelector('.fapi-kpis'), 'gap', 'var(--vf-sp-4)');
    A.edit(document.querySelector('.fapi-filters'), 'gap', 'var(--vf-sp-2)');
    A.edit(document.querySelector('.fapi-table'), 'width', '1000px');
    A.edit(document.querySelector('.vz-title'), 'font-size', '18px');
    A.edit(document.querySelector('.fapi-wrap > h2'), 'margin-bottom', '4px');`));
  assert.equal(await page.evaluate(() => window.__VFDEV__.api.changes.size), 5);
  const regs = await page.evaluate(() => window.__VFDEV__.api.checarRegressoes([1440, 768]));
  assert.equal(regs.length, 1, JSON.stringify(regs));
  const r = regs[0];
  assert.equal(r.largura, 768);
  assert.equal(r.causa.prop, 'width');
  assert.equal(r.causa.seletor, '.vf-page-fechamentos-api .fapi-table');
  assert.equal(r.causa.depois, '1000px');
  assert.match(r.texto, /^Regressão em 768px · causa provável: alteração #3 `\.vf-page-fechamentos-api \.fapi-table` width: \(não existia\) → 1000px · overflow de \d+px$/);
  assert.equal((await page.evaluate(() => window.__VFDEV__.api.sessao().regressoes)).length, 1);
  assert.deepEqual(await page.evaluate(() => window.__VFDEV__.api.breakpoints()), [900]);
  // corrigir só ≤ 900px: a alteração passa a valer só acima do breakpoint real mais próximo
  await page.locator('vf-devtools >> button[data-act="reg-fix"]').click();
  const depois = await page.evaluate(() => window.__VFDEV__.api.bissectar(768));
  assert.equal(depois.regressao, false);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.fapi-table')).width), '1000px'); // 1440 continua com a mudança
  const patch = await page.evaluate(() => window.__VFDEV__.api.buildPatch());
  const nova = patch.flatMap(f => f.patches).find(p => p.media);
  assert.deepEqual(nova, { op: 'new', selector: '.vf-page-fechamentos-api .fapi-table', media: '(min-width: 901px)', decls: [{ prop: 'width', value: '1000px' }] });
  await context.close();
});

test('5.3 · missão com 3 estados lista os 3; só fica "verificada" quando todos estão validados', async t => {
  const skip = await skipMotivo(); if (skip) return t.skip(skip);
  const { context, page } = await openPage(srv.base, 'fechamentos-api.html');
  await page.evaluate(A(`A.setTab('session');`));
  await page.locator('vf-devtools >> text=Nova sessão').click();
  await page.evaluate(A(`
    A.sessao().larguras = [1440];
    A.comentar(document.querySelector('.fapi-kpis'), 'ver nos três meses');
    history.replaceState(null, '', location.pathname + '?periodo=2026-08');
    A.registrarEstado('Agosto normal');
    history.replaceState(null, '', location.pathname + '?periodo=2026-07');
    A.registrarEstado('Julho');
    history.replaceState(null, '', location.pathname + '?periodo=2026-06#vazio');
    A.registrarEstado('Junho sem dados', 'abrir o filtro e escolher "sem vendas"');
    history.replaceState(null, '', location.pathname);
    A.setTab('session');`));
  await page.locator('vf-devtools >> button[data-act="mis-gerar"]').click();
  await page.locator('vf-devtools >> #obj-text').fill('Validar a tela nos três períodos');
  await page.locator('vf-devtools >> button[data-act="obj-ok"]').click();
  await page.waitForFunction(() => window.__VFDEV__.api.sessao().status === 'missao_gerada');
  const id = await page.evaluate(() => window.__VFDEV__.api.sessao().id);
  const md = fs.readFileSync(path.join(DIR, 'missoes', id + '.md'), 'utf8');
  const sec = md.split('## Estados a validar')[1].split('## Larguras')[0];
  assert.deepEqual(sec.trim().split('\n'), [
    '- [ ] **Agosto normal** — `/fechamentos-api.html?periodo=2026-08` (capturado em 1440px)',
    '- [ ] **Julho** — `/fechamentos-api.html?periodo=2026-07` (capturado em 1440px)',
    '- [ ] **Junho sem dados** — `/fechamentos-api.html?periodo=2026-06#vazio` — abrir o filtro e escolher "sem vendas" (capturado em 1440px)'
  ]);
  await page.locator('vf-devtools >> #dclose').click();
  await page.evaluate(() => window.__VFDEV__.api.verificarMissao());
  let s = await page.evaluate(() => JSON.parse(JSON.stringify(window.__VFDEV__.api.sessao())));
  assert.equal(s.verificacao.falhas, 0);
  assert.deepEqual([...new Set(s.verificacao.resultados.map(r => r.estado || '(padrão)'))].sort(), ['(padrão)', 'Agosto normal', 'Julho']);  // "Junho" fica como checklist manual
  assert.equal(s.status, 'missao_gerada');
  assert.equal(s.verificacao.estadosPendentes, 3);
  const ids = s.estados.map(e => e.id);
  for (const [k, eid] of ids.entries()) {
    await page.evaluate(eid => window.__VFDEV__.api.validarEstado(eid), eid);
    const st = await page.evaluate(() => window.__VFDEV__.api.sessao().status);
    assert.equal(st, k < 2 ? 'missao_gerada' : 'verificada');
  }
  await page.evaluate(() => window.__VFDEV__.api.saveNow());
  s = JSON.parse(fs.readFileSync(path.join(DIR, 'sessoes', id + '.json'), 'utf8'));
  assert.equal(s.status, 'verificada');
  assert.ok(s.estados.every(e => e.validadoEm && e.validadoLargura === 1440));
  assert.deepEqual(page.__errors || [], []);
  await context.close();
});

test('5.2 · com valor anterior, "Corrigir só ≤900px" devolve o valor antigo dentro do @media (max-width: 900px) e grava lá', async t => {
  const skip = await skipMotivo(); if (skip) return t.skip(skip);
  const { context, page } = await openPage(srv.base, 'fechamentos-api.html');
  await page.evaluate(A(`A.setTab('session');`));
  await page.locator('vf-devtools >> text=Nova sessão').click();
  await page.evaluate(A(`A.edit(document.querySelector('.fapi-wrap'), 'padding', 'var(--vf-sp-8) 500px');`));
  const [r] = await page.evaluate(() => window.__VFDEV__.api.checarRegressoes([768]));
  assert.equal(r.causa.antes, 'var(--vf-sp-8)');
  await page.evaluate(A(`A.setTab('session');`));
  await page.locator('vf-devtools >> button[data-act="reg-fix"]').click();
  assert.equal((await page.evaluate(() => window.__VFDEV__.api.bissectar(768))).regressao, false);
  const file = path.join(DIR, 'Portal', 'css/pages/fechamentos-api-v2.css'), antes = fs.readFileSync(file, 'utf8');
  await page.evaluate(() => window.__VFDEV__.api.apply(false));
  const depois = fs.readFileSync(file, 'utf8');
  assert.equal(depois.split('\n')[0], '.vf-page-fechamentos-api .fapi-wrap { padding: var(--vf-sp-8) 500px; display: flex; flex-direction: column; }');
  assert.ok(depois.endsWith('@media (max-width: 900px) {\n  .vf-page-fechamentos-api .fapi-wrap { padding: var(--vf-sp-8); }\n}\n') || depois.trimEnd().endsWith('@media (max-width: 900px) {\n  .vf-page-fechamentos-api .fapi-wrap { padding: var(--vf-sp-8); }\n}'), depois.slice(-200));
  assert.equal(depois.split('\n').slice(1, antes.split('\n').length - 1).join('\n'), antes.split('\n').slice(1, -1).join('\n'));
  await context.close();
});
