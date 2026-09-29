'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validarSessao, SessionStore, CRITERIOS, ACOES } = require('../sessao');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vfdev-ses-'));
fs.cpSync(path.join(__dirname, 'fixture'), path.join(TMP, 'Portal'), { recursive: true });
process.env.VFDEV_PORTAL_DIR = path.join(TMP, 'Portal');
process.env.VFDEV_SESSOES_DIR = path.join(TMP, 'sessoes');
process.env.VFDEV_PORT = '5392';
const { server, TOKEN } = require('../server');
const BASE = 'http://127.0.0.1:5392';
test.before(() => new Promise(r => server.listen(5392, '127.0.0.1', r)));
test.after(() => { server.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

const alvo = (seletor = '.fapi-kpis') => ({ seletor, indice: 0, caminhoDom: '#fapi-kpis', texto: 'Faturamento', rect: { x: 0, y: 0, w: 100, h: 20 }, larguraTela: 1440, fonteCss: null, fonteCssMotivo: 'x', componente: null });
const base = (over = {}) => ({ id: '2026-09-23-fechamentos-api-ab12', titulo: 'Central — revisão', pagina: 'fechamentos-api.html', url: '/fechamentos-api.html', status: 'em_andamento', objetivo: '', larguras: [1440, 768, 390], estados: [], regressoes: [], itens: [], ...over });
const req = (method, p, body, headers = {}) => fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', 'X-VFDEV-Token': TOKEN, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

test('schema aceita os 5 tipos de item', () => {
  const s = base({ itens: [
    { id: 'i1', tipo: 'css', alvo: alvo(), css: { arquivo: 'Portal/css/pages/fechamentos-api-v2.css', linha: 9, seletor: '.x', prop: 'gap', antes: 'var(--vf-sp-6)', depois: 'var(--vf-sp-4)', destino: 'pendente' } },
    { id: 'i2', tipo: 'estrutural', alvo: alvo(), estrutural: { acao: 'remover', criterios: CRITERIOS.remover } },
    { id: 'i3', tipo: 'comentario', alvo: alvo(), comentario: { texto: 'grande demais', ponto: { x: 1, y: 2 } } },
    { id: 'i4', tipo: 'referencia', referencia: { a: alvo('.a'), b: alvo('.b'), diferencas: [{ aspecto: 'padding', a: '16px', b: '24px' }] } },
    { id: 'i5', tipo: 'estranho', alvo: alvo(), estranho: { achados: [{ fato: 'usa 32px', medida: {} }] } }
  ] });
  assert.equal(validarSessao(s), s);
});

test('schema recusa com mensagem clara', () => {
  const bad = (s, re) => assert.throws(() => validarSessao(s), e => e.status === 400 && re.test(e.message), re.toString());
  bad(base({ status: 'feito' }), /status "feito" inválido/);
  bad(base({ lixo: 1 }), /campo\(s\) desconhecido\(s\) "lixo"/);
  bad(base({ pagina: '../etc/passwd' }), /pagina .* deve ser um \.html/);
  bad(base({ itens: [{ id: 'i1', tipo: 'css', alvo: alvo(), css: { arquivo: 'a.css', seletor: '.x', prop: 'gap', depois: '1px !important', destino: 'pendente' } }] }), /não pode ter .*!important/);
  bad(base({ itens: [{ id: 'i1', tipo: 'estrutural', alvo: alvo(), estrutural: { acao: 'mover_antes', criterios: [] } }] }), /relacionado é obrigatório/);
  bad(base({ itens: [{ id: 'i1', tipo: 'estrutural', alvo: alvo(), estrutural: { acao: 'explodir', criterios: [] } }] }), /acao "explodir" inválida/);
  bad(base({ itens: [{ id: 'i1', tipo: 'comentario', alvo: alvo(), comentario: { texto: '   ' } }] }), /texto está vazio/);
  bad(base({ itens: [{ id: 'i1', tipo: 'comentario', alvo: alvo(), comentario: { texto: 'a' }, css: {} }] }), /tem o bloco "css"/);
  bad(base({ itens: [{ id: 'i1', tipo: 'comentario', comentario: { texto: 'a' } }] }), /alvo é obrigatório/);
  bad(base({ itens: [{ id: 'i1', tipo: 'comentario', alvo: { ...alvo(), texto: 'x'.repeat(61) }, comentario: { texto: 'a' } }] }), /texto passa de 60/);
  bad(base({ itens: [{ id: 'i1', tipo: 'comentario', alvo: alvo(), comentario: { texto: 'a' } }, { id: 'i1', tipo: 'comentario', alvo: alvo(), comentario: { texto: 'b' } }] }), /id de item repetido/);
});

test('toda ação estrutural tem critérios padrão', () => {
  for (const a of ACOES) assert.ok(CRITERIOS[a] && CRITERIOS[a].length >= 2, a);
  assert.deepEqual(CRITERIOS.remover, ['não usar display:none', 'remover a renderização do componente', 'remover container vazio e estilos exclusivos (altura, sticky, borda)', 'preservar as demais seções']);
});

test('API de sessões exige token e origem', async () => {
  assert.equal((await fetch(BASE + '/__vfdev/sessoes')).status, 403);
  assert.equal((await req('GET', '/__vfdev/sessoes', undefined, { Origin: 'http://evil.test' })).status, 403);
  assert.equal((await req('PUT', '/__vfdev/sessoes/x', base(), { 'X-VFDEV-Token': 'errado' })).status, 403);
});

test('PUT / GET / lista por página / duplicar / DELETE', async () => {
  const s = base();
  let r = await req('PUT', '/__vfdev/sessoes/' + s.id, s);
  assert.equal(r.status, 200);
  const saved = await r.json();
  assert.ok(saved.criadaEm && saved.atualizadaEm);
  assert.ok(fs.existsSync(path.join(TMP, 'sessoes', s.id + '.json')));
  assert.equal((await (await req('GET', '/__vfdev/sessoes/' + s.id)).json()).titulo, 'Central — revisão');
  let l = (await (await req('GET', '/__vfdev/sessoes?pagina=fechamentos-api.html')).json()).sessoes;
  assert.equal(l.length, 1);
  assert.equal((await (await req('GET', '/__vfdev/sessoes?pagina=outra.html')).json()).sessoes.length, 0);
  r = await req('POST', `/__vfdev/sessoes/${s.id}/duplicar`, {});
  assert.equal(r.status, 201);
  const dup = await r.json();
  assert.equal(dup.id, s.id + '-copia');
  assert.equal(dup.titulo, 'Central — revisão (cópia)');
  assert.equal((await req('DELETE', '/__vfdev/sessoes/' + dup.id)).status, 200);
  assert.equal((await req('GET', '/__vfdev/sessoes/' + dup.id)).status, 404);
});

test('PUT inválido é recusado sem gravar; id do corpo precisa bater com a URL', async () => {
  let r = await req('PUT', '/__vfdev/sessoes/outra-id', base());
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /difere do da URL/);
  r = await req('PUT', '/__vfdev/sessoes/ruim', { ...base({ id: 'ruim' }), status: 'x' });
  assert.equal(r.status, 400);
  assert.ok(!fs.existsSync(path.join(TMP, 'sessoes', 'ruim.json')));
  r = await req('GET', '/__vfdev/sessoes/..%2F..%2Fetc');
  assert.equal(r.status, 400);
});

test('store: criadaEm é preservado entre PUTs', () => {
  const st = new SessionStore(path.join(TMP, 'st2'));
  const a = st.put('abc', base({ id: 'abc' }));
  const b = st.put('abc', base({ id: 'abc', criadaEm: '1999-01-01' }));
  assert.equal(b.criadaEm, a.criadaEm);
});
