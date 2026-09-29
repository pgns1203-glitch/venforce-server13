'use strict';
/* Fase 3 no servidor: bundle do Vite → fonte React, gravação na fonte, desfazer byte a byte, git, SSE e rebuild. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { tmpRepo, REAL } = require('./helpers/e2e');
const { indexCss, pairBundle, normSel, normCond } = require('../cssIndex');

const DIR = tmpRepo({ real: true });
process.env.VFDEV_REPO_DIR = DIR;
process.env.VFDEV_PORTAL_DIR = path.join(DIR, 'Portal');
process.env.VFDEV_SESSOES_DIR = path.join(DIR, 'sessoes');
process.env.VFDEV_MISSOES_DIR = path.join(DIR, 'missoes');
process.env.VFDEV_HISTORY_DIR = path.join(DIR, 'history');
process.env.VFDEV_PORT = '5396';
const { server, TOKEN, closeWatchers } = require('../server');
const BASE = 'http://127.0.0.1:5396';
test.before(() => new Promise(r => server.listen(5396, '127.0.0.1', r)));
test.after(() => { closeWatchers(); server.close(); fs.rmSync(DIR, { recursive: true, force: true }); });
const H = { 'Content-Type': 'application/json', 'X-VFDEV-Token': TOKEN };
const get = p => fetch(BASE + p, { headers: H });
const post = (p, body) => fetch(BASE + p, { method: 'POST', headers: H, body: JSON.stringify(body) });
const F = rel => path.join(DIR, rel);
const V3 = fs.readdirSync(F('Portal/assets/cliente-360-v3')).find(f => f.endsWith('.css'));

/** Assina o SSE e devolve uma função que espera o próximo evento que satisfaz `pred`. */
function sse() {
  const ctrl = new AbortController(), events = [], waiters = [];
  (async () => {
    const r = await fetch(`${BASE}/__vfdev/events?t=${TOKEN}`, { signal: ctrl.signal });
    const dec = new TextDecoder(); let buf = '';
    try {
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = (block.match(/^event: (.+)$/m) || [])[1], data = (block.match(/^data: (.+)$/m) || [])[1];
          if (!ev) continue;
          const e = { ev, data: JSON.parse(data), t: Date.now() };
          events.push(e);
          for (const w of [...waiters]) if (w.pred(e)) { waiters.splice(waiters.indexOf(w), 1); w.res(e); }
        }
      }
    } catch (e) { /* abortado */ }
  })();
  return {
    next: (pred, ms = 5000) => new Promise((res, rej) => { const hit = events.find(pred); if (hit) return res(hit); const w = { pred, res }; waiters.push(w); setTimeout(() => rej(new Error('evento não chegou')), ms); }),
    close: () => ctrl.abort(), events
  };
}

test('normalização: even/odd e sintaxe de @media do minificador', () => {
  assert.equal(normSel('.t tr:nth-child(even) > *'), normSel('.t tr:nth-child(2n)>*'));
  assert.equal(normSel('li:nth-of-type(odd)'), 'li:nth-of-type(2n+1)');
  assert.equal(normCond('@media (max-width: 760px)'), normCond('@media(width<=760px)'));
});

test('pareamento bundle ↔ fonte: único, por ordem, ambíguo e sem par (com motivo)', () => {
  const src = [{ file: 'frontend-react/src/styles/a.css', rules: indexCss('.a { color: red; }\n.dup { gap: 1px; }\n.dup { gap: 2px; }\n.x { margin: 0; padding: 1px; }\n@media (max-width: 900px) {\n  .a { color: blue; }\n}\n.m1 { color: red; }\n.m2 { color: red; }\n') }];
  const bundle = indexCss('.a{color:red}.dup{gap:1px}.dup{gap:2px}.x{margin:0}@media(max-width:900px){.a{color:#00f}}.m1,.m2{color:red}.nova{top:0}');
  const r = pairBundle(bundle, src);
  assert.equal(r[0].src.line, 1);
  assert.equal(r[1].src.line, 2); assert.equal(r[1].porOrdem, true);
  assert.equal(r[2].src.line, 3);
  assert.match(r[3].motivo, /^sem par exato: o seletor existe nas fontes \(frontend-react\/src\/styles\/a\.css:4\)/);
  assert.equal(r[4].src.line, 6);
  assert.match(r[5].motivo, /^sem par: o seletor não aparece/);
  assert.match(r[6].motivo, /^sem par/);
});

test('arquivos reais: o bundle da Cliente 360 V3 pareia ≥ 95% com as fontes (só leitura no repo)', () => {
  const b = indexCss(fs.readFileSync(path.join(REAL, 'Portal/assets/cliente-360-v3', V3), 'utf8'));
  const srcs = ['cliente360.css', 'cliente360V3.css'].map(f => ({ file: 'frontend-react/src/styles/' + f, rules: indexCss(fs.readFileSync(path.join(REAL, 'frontend-react/src/styles', f), 'utf8')) }));
  const ok = pairBundle(b, srcs).filter(x => x.src).length;
  assert.ok(ok / b.length >= 0.95, `${ok}/${b.length}`);
});

test('3.1 (a) · regra de card da Cliente 360 V3 aponta a fonte React:linha e gravar muda só aquela linha', async () => {
  const idx = await (await get('/__vfdev/index?file=' + encodeURIComponent('assets/cliente-360-v3/' + V3))).json();
  assert.equal(idx.kind, 'built');
  assert.ok(idx.pareadas > 400, String(idx.pareadas));
  const card = idx.rules.find(r => r.selector === '.c360d-ind' && !r.cond);
  assert.deepEqual([card.src.file, card.src.line, card.src.writable], ['frontend-react/src/styles/cliente360V3.css', 374, true]);
  const file = F('frontend-react/src/styles/cliente360V3.css'), antes = fs.readFileSync(file, 'utf8');
  const r = await post('/__vfdev/patch', { files: [{ file: card.src.file, patches: [{ op: 'set', line: card.src.line, column: card.src.column, selector: card.src.selector, prop: 'padding', value: 'var(--c360d-pad-sm) var(--vf-sp-3)' }] }] });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.match(j.historico, /^g/);
  const depois = fs.readFileSync(file, 'utf8'), A = antes.split('\n'), D = depois.split('\n');
  assert.equal(A.length, D.length);
  const diff = A.map((l, i) => l !== D[i] ? i + 1 : 0).filter(Boolean);
  assert.deepEqual(diff, [375]);
  assert.equal(D[374], '  padding: var(--c360d-pad-sm) var(--vf-sp-3);');
  // o bundle compilado não foi tocado
  assert.equal(fs.readFileSync(F('Portal/assets/cliente-360-v3/' + V3), 'utf8'), fs.readFileSync(path.join(REAL, 'Portal/assets/cliente-360-v3', V3), 'utf8'));
});

test('3.1 · fonte React só grava em frontend-react/src/styles/; componente fora dela vira missão com o motivo', async () => {
  fs.mkdirSync(F('frontend-react/src/components'), { recursive: true });
  fs.writeFileSync(F('frontend-react/src/components/X.css'), '.x { color: red; }\n');
  const bad = await post('/__vfdev/patch', { files: [{ file: 'frontend-react/src/components/X.css', patches: [{ op: 'set', line: 1, column: 1, selector: '.x', prop: 'color', value: 'blue' }] }] });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /Só \.css dentro de frontend-react\/src\/styles\//);
  assert.equal((await post('/__vfdev/patch', { files: [{ file: 'frontend-react/src/styles/../../package.json', patches: [] }] })).status, 400);
  assert.equal((await post('/__vfdev/patch', { files: [{ file: 'frontend-react/src/App.jsx', patches: [] }] })).status, 400);
});

test('3.3 (d) · gravar e depois desfazer deixa o arquivo idêntico byte a byte; desfazer de novo é 409', async () => {
  const file = F('frontend-react/src/styles/visao.css'), orig = fs.readFileSync(file);
  const r = await (await post('/__vfdev/patch', { files: [{ file: 'frontend-react/src/styles/visao.css', patches: [{ op: 'set', line: 2, column: 1, selector: '.vz-box', prop: 'padding', value: 'var(--vf-sp-4)' }, { op: 'set', line: 2, column: 1, selector: '.vz-box', prop: 'gap', value: '4px' }] }] })).json();
  assert.notDeepEqual(fs.readFileSync(file), orig);
  const hist = (await (await get('/__vfdev/historico')).json()).gravacoes;
  assert.equal(hist[0].id, r.historico);
  assert.deepEqual(hist[0].arquivos, ['frontend-react/src/styles/visao.css']);
  const u = await post(`/__vfdev/historico/${r.historico}/desfazer`, {});
  assert.equal(u.status, 200);
  assert.ok(Buffer.compare(fs.readFileSync(file), orig) === 0, 'arquivo não voltou byte a byte');
  assert.equal((await post(`/__vfdev/historico/${r.historico}/desfazer`, {})).status, 409);
  assert.ok((await (await get('/__vfdev/historico')).json()).gravacoes[0].desfeitoEm);
});

test('3.3 · desfazer é recusado (409) se o arquivo mudou depois da gravação, sem alterar nada', async () => {
  const rel = 'css/pages/fechamentos-api-v2.css', file = F('Portal/' + rel);
  const r = await (await post('/__vfdev/patch', { files: [{ file: rel, patches: [{ op: 'set', line: 9, column: 1, selector: '.vf-page-fechamentos-api .fapi-kpis', prop: 'gap', value: 'var(--vf-sp-2)' }] }] })).json();
  const mexido = fs.readFileSync(file, 'utf8') + '\n/* editado por fora */\n';
  fs.writeFileSync(file, mexido);
  const u = await post(`/__vfdev/historico/${r.historico}/desfazer`, {});
  assert.equal(u.status, 409);
  assert.match((await u.json()).error, /mudou depois da gravação/);
  assert.equal(fs.readFileSync(file, 'utf8'), mexido);
});

test('3.3 · git status dos arquivos tocados (spawn sem shell) e erro claro fora de um repositório', async () => {
  let j = await (await get('/__vfdev/git?files=' + encodeURIComponent('css/pages/fechamentos-api-v2.css'))).json();
  assert.match(j.erro, /git status indisponível/);
  execFileSync('git', ['init', '-q'], { cwd: DIR });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', 'Portal/css/pages/fechamentos-api-v2.css', 'frontend-react/src/styles/visao.css'], { cwd: DIR });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'x'], { cwd: DIR });
  fs.appendFileSync(F('Portal/css/pages/fechamentos-api-v2.css'), '/* y */\n');
  j = await (await get('/__vfdev/git?files=' + encodeURIComponent('css/pages/fechamentos-api-v2.css,frontend-react/src/styles/visao.css,frontend-react/src/styles/cliente360V3.css'))).json();
  assert.deepEqual(j.arquivos.map(a => [a.repo, a.status]), [['Portal/css/pages/fechamentos-api-v2.css', ' M'], ['frontend-react/src/styles/visao.css', ''], ['frontend-react/src/styles/cliente360V3.css', '??']]);
  assert.equal((await get('/__vfdev/git?files=' + encodeURIComponent('../../etc/passwd.css'))).status, 400);
});

test('3.2 · SSE exige token; editar um .css por fora gera evento em < 1 s', async () => {
  assert.equal((await fetch(BASE + '/__vfdev/events?t=errado')).status, 403);
  const s = sse();
  await s.next(e => e.ev === 'pronto');
  const t0 = Date.now();
  fs.appendFileSync(F('Portal/css/vf-components-v2.css'), '\n.novo { color: red; }\n');
  const e = await s.next(e => e.ev === 'css' && e.data.file === 'css/vf-components-v2.css', 1000);
  assert.ok(e.t - t0 < 1000, `${e.t - t0}ms`);
  fs.appendFileSync(F('frontend-react/src/styles/visao.css'), '\n');
  await s.next(e => e.ev === 'css' && e.data.file === 'frontend-react/src/styles/visao.css', 1000);
  s.close();
});

test('3.1 · rebuild: script inexistente, ilha sem script, falha com as últimas 30 linhas, e sucesso com log via SSE', async () => {
  let r = await post('/__vfdev/rebuild', { ilha: 'painel-contas' });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /O script "build:painel-contas" não existe em frontend-react\/package\.json/);
  r = await post('/__vfdev/rebuild', { ilha: 'cliente-360-v2' });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /fonte Vue não versionada/);
  r = await post('/__vfdev/rebuild', { ilha: 'nada' });
  assert.equal(r.status, 400);
  const s = sse();
  await s.next(e => e.ev === 'pronto');
  r = await post('/__vfdev/rebuild', { ilha: 'financeiro-v3' });
  assert.equal(r.status, 202);
  const f = await s.next(e => e.ev === 'rebuild-fim', 15000);
  assert.equal(f.data.ok, false); assert.equal(f.data.codigo, 2);
  assert.equal(f.data.ultimas.length, 30);
  assert.equal(f.data.ultimas[29], 'Erro: sintaxe inválida em src/styles/financeiro.css:12');
  r = await post('/__vfdev/rebuild', { ilha: 'visao' });
  assert.equal(r.status, 202);
  assert.equal((await post('/__vfdev/rebuild', { ilha: 'visao' })).status, 409);
  const ok = await s.next(e => e.ev === 'rebuild-fim' && e.data.ilha === 'visao', 15000);
  assert.equal(ok.data.ok, true);
  assert.ok(s.events.some(e => e.ev === 'rebuild' && /built visao-/.test(e.data.linha)));
  assert.match(fs.readFileSync(F('Portal/fechamentos-api.html'), 'utf8'), /assets\/visao\/visao-\w+\.css/);
  s.close();
});
