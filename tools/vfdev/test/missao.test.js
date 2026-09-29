'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { gerarMissao, rascunhoObjetivo, verificacoes } = require('../missao');
const { validarSessao } = require('../sessao');

const FIX = path.join(__dirname, 'fixture-missao');
const SES = () => JSON.parse(fs.readFileSync(path.join(FIX, 'sessao.json'), 'utf8'));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vfdev-mis-'));
fs.cpSync(path.join(__dirname, 'fixture'), path.join(TMP, 'Portal'), { recursive: true });
process.env.VFDEV_PORTAL_DIR = path.join(TMP, 'Portal');
process.env.VFDEV_SESSOES_DIR = path.join(TMP, 'sessoes');
process.env.VFDEV_MISSOES_DIR = path.join(TMP, 'missoes');
process.env.VFDEV_PORT = '5394';
const { server, TOKEN } = require('../server');
const BASE = 'http://127.0.0.1:5394';
test.before(() => new Promise(r => server.listen(5394, '127.0.0.1', r)));
test.after(() => { server.close(); fs.rmSync(TMP, { recursive: true, force: true }); });
const req = (method, p, body) => fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-VFDEV-Token': TOKEN }, body: body === undefined ? undefined : JSON.stringify(body) });

test('fixture da missão é uma sessão válida (2 CSS, 1 estrutural, 2 comentários)', () => {
  const s = validarSessao(SES());
  assert.deepEqual(s.itens.map(i => i.tipo), ['css', 'css', 'estrutural', 'comentario', 'comentario']);
});

test('2.1 · o .md gerado bate com o snapshot', () => {
  const { md } = gerarMissao(SES());
  assert.equal(md, fs.readFileSync(path.join(FIX, 'esperado.md'), 'utf8'));
});

test('2.1 · as 13 seções aparecem na ordem obrigatória', () => {
  const { md } = gerarMissao(SES());
  const heads = md.split('\n').filter(l => /^#{1,2} /.test(l)).map(l => l.replace(/^#+ /, ''));
  assert.deepEqual(heads, ['Missão — Cliente 360 — revisão visual 23/09', 'Resumo', 'Objetivo', 'Intenções', 'Mudanças CSS confirmadas', 'Mudanças estruturais', 'Comentários sem implementação direta', 'Fontes prováveis', 'Restrições', 'Critérios de aceite', 'Estados a validar', 'Larguras a validar', 'Como verificar']);
});

test('2.1 · CSS já gravado entra como "feito — não refazer"; nota aparece com antes → depois', () => {
  const { md } = gerarMissao(SES());
  assert.match(md, /### 2\. `\.vf-page-cliente-360-v3 \.c360d-head` — `Portal\/css\/pages\/cliente-360-v3\.css:12` — ✅ feito, não refazer/);
  assert.match(md, /- `gap`: `var\(--vf-sp-6\)` → `var\(--vf-sp-4\)` \(computado esperado: `16px`\)\n- Por quê: "os indicadores parecem soltos"/);
});

test('2.1 · CSS descartado não entra na missão', () => {
  const s = SES(); s.itens[0].css.destino = 'descartada'; s.itens[0].css.motivo = 'descartada: regra mudou em x.css:3';
  const { md, json } = gerarMissao(s);
  assert.ok(md.includes('- 1 ajuste CSS (1 já gravado, 0 a fazer) · 1 descartado (não entra)'));
  assert.ok(!json.verificacoes.some(v => v.item === 'i1'));
});

test('2.1 · rascunho do objetivo é montado por regras a partir dos itens', () => {
  assert.equal(rascunhoObjetivo(SES()), 'Compactar a primeira dobra: 1 gap reduzido, 1 respiro reduzido, 1 item marcado para remoção (navegação), 2 comentários a tratar');
  const s = SES();
  s.itens.push({ id: 'i6', tipo: 'estrutural', alvo: { seletor: '.res', nome: 'Resultado', rect: { x: 0, y: 400, w: 10, h: 10 } }, estrutural: { acao: 'aproximar_de', relacionado: { seletor: '.mud', nome: 'Mudanças' }, criterios: [] } });
  assert.match(rascunhoObjetivo(s), /Resultado aproximado\(a\) de mudanças/);
  assert.equal(rascunhoObjetivo({ ...s, itens: [] }), '');
});

test('2.2 · verificações executáveis por tipo de item', () => {
  const V = verificacoes(SES());
  assert.deepEqual(V.map(v => [v.tipo, v.item]), [['computado', 'i1'], ['computado', 'i2'], ['ausente', 'i3'], ['presente', 'i3'], ['presente', 'i3'], ['sem-overflow', null], ['sem-overflow', null], ['sem-overflow', null]]);
  assert.deepEqual(V[0], { id: 'v1', item: 'i1', tipo: 'computado', seletor: '.c360d-inds', indice: 0, prop: 'gap', esperado: '16px', largura: 1440, descricao: "`.c360d-inds` em 1440px: `getComputedStyle(el).getPropertyValue('gap')` = `16px`" });
  const s = SES();
  s.itens.push({ id: 'm', tipo: 'estrutural', alvo: { seletor: '.a', texto: 'A' }, estrutural: { acao: 'mover_depois', relacionado: { seletor: '.b', texto: 'B' }, criterios: [] } });
  s.itens.push({ id: 'g', tipo: 'estrutural', alvo: { seletor: '.a' }, estrutural: { acao: 'igual_a', relacionado: { seletor: '.b' }, criterios: [] } });
  const W = verificacoes(s);
  assert.deepEqual(W.find(v => v.item === 'm').seletores, ['.b', '.a']);
  assert.equal(W.find(v => v.item === 'g').tipo, 'igual');
});

test('API · rascunho, recusa sem objetivo, gera .md/.json e marca a sessão', async () => {
  const s = SES();
  s.objetivo = '';
  assert.equal((await req('PUT', '/__vfdev/sessoes/' + s.id, s)).status, 200);
  const r0 = await req('GET', `/__vfdev/missoes/${s.id}/rascunho`);
  assert.match((await r0.json()).objetivo, /^Compactar a primeira dobra/);
  const r1 = await req('POST', '/__vfdev/missoes/' + s.id, {});
  assert.equal(r1.status, 400);
  assert.match((await r1.json()).error, /Objetivo em 1 frase/);
  assert.equal((await req('GET', '/__vfdev/missoes/' + s.id)).status, 404);
  const r2 = await req('POST', '/__vfdev/missoes/' + s.id, { objetivo: 'Compactar a primeira dobra sem perder a leitura dos indicadores' });
  assert.equal(r2.status, 200);
  const j = await r2.json();
  assert.equal(j.md, fs.readFileSync(path.join(FIX, 'esperado.md'), 'utf8'));
  assert.equal(fs.readFileSync(path.join(TMP, 'missoes', s.id + '.md'), 'utf8'), j.md);
  const mj = JSON.parse(fs.readFileSync(path.join(TMP, 'missoes', s.id + '.json'), 'utf8'));
  assert.equal(mj.verificacoes.length, 8);
  assert.equal(j.sessao.status, 'missao_gerada');
  assert.equal(j.sessao.missao.verificacoes, 8);
  assert.equal((await (await req('GET', '/__vfdev/missoes/' + s.id)).json()).verificacoes.length, 8);
  assert.equal(await (await req('GET', `/__vfdev/missoes/${s.id}.md`)).text(), j.md);
  assert.equal((await fetch(BASE + `/__vfdev/missoes/${s.id}.md`)).status, 403);
});
