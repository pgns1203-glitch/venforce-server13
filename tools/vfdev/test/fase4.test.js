'use strict';
/* Fase 4 sem navegador: "Nasceu onde?" (origem.js) e o rascunho de intenção maior (missao.js). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buscarOrigem } = require('../origem');
const { rascunhoIntencao } = require('../missao');

const R = fs.mkdtempSync(path.join(os.tmpdir(), 'vfdev-orig-'));
test.after(() => fs.rmSync(R, { recursive: true, force: true }));
const w = (rel, txt) => { fs.mkdirSync(path.dirname(path.join(R, rel)), { recursive: true }); fs.writeFileSync(path.join(R, rel), txt); };
w('frontend-react/src/components/FaixaExecutiva.jsx', 'import { cx } from "../utils/cx";\n\nexport function FaixaExecutiva({ forte, valor }) {\n  return (\n    <div className={cx("c360d-ind", forte && "c360d-ind--forte")}>\n      <p className="c360d-ind__valor">{valor}</p>\n      <span>Faturamento</span>\n    </div>\n  );\n}\n');
w('frontend-react/src/components/FaixaExecutiva.test.jsx', 'render(<p className="c360d-ind__valor" />);\n');
w('frontend-react/src/components/Outro.jsx', 'const x = <div className="vf-card c360d-ind">oi</div>;\n');
w('Portal/fechamentos-api.js', 'el.innerHTML = `<article class="vf-card vf-kpi"><span class="vf-kpi__label">${l}</span></article>`;\nbtn.classList.add("is-open");\n');
w('Portal/fechamentos-api.test.js', 'x.innerHTML = `<span class="vf-kpi__label"></span>`;\n');
const busca = (classes, texto) => buscarOrigem({ classes, texto, reactSrc: path.join(R, 'frontend-react/src'), portalDir: path.join(R, 'Portal'), repo: R });

test('4.1 · className literal no componente React: arquivo:linha + trecho como evidência', () => {
  const r = busca(['c360d-ind__valor']);
  assert.equal(r.candidatos.length, 1, 'arquivo de teste não entra');
  assert.deepEqual([r.candidatos[0].arquivo, r.candidatos[0].linha, r.candidatos[0].como], ['frontend-react/src/components/FaixaExecutiva.jsx', 6, 'className literal']);
  assert.equal(r.candidatos[0].trecho, '<p className="c360d-ind__valor">{valor}</p>');
  assert.match(r.candidatos[0].evidencia, /className literal com a classe `c360d-ind__valor` em FaixaExecutiva\.jsx:6/);
});

test('4.1 · a classe mais específica vem primeiro; cx() é reconhecido; texto no arquivo reforça', () => {
  const r = busca(['vf-card', 'c360d-ind', 'c360d-ind--forte'], 'Faturamento');
  assert.deepEqual(r.classesProcuradas, ['c360d-ind--forte', 'c360d-ind', 'vf-card']);
  assert.equal(r.candidatos[0].linha, 5);
  assert.equal(r.candidatos[0].como, 'className em template/cx()');
  assert.match(r.candidatos[0].evidencia, /o texto "Faturamento" aparece no mesmo arquivo \(linha 7\)/);
});

test('4.1 · Portal vanilla: class dentro de template string / innerHTML (arquivos .test.js ficam de fora)', () => {
  const r = busca(['vf-kpi__label']);
  assert.deepEqual(r.candidatos.map(c => [c.arquivo, c.linha, c.como]), [['Portal/fechamentos-api.js', 1, 'class em template string / innerHTML']]);
});

test('4.1 · classe dinâmica ou sem classe: "não resolvido" com o motivo, sem palpite', () => {
  const r = busca(['dyn-7f3a']);
  assert.deepEqual(r.candidatos, []);
  assert.equal(r.motivo, 'não resolvido: a classe `dyn-7f3a` não aparece literalmente no código (provável composição dinâmica)');
  assert.equal(busca(['dyn-1', 'dyn-2']).motivo, 'não resolvido: nenhuma das classes `dyn-1`, `dyn-2` aparece literalmente no código (provável composição dinâmica)');
  assert.match(busca([]).motivo, /^não resolvido: o elemento não tem classe/);
  assert.match(busca(['a"b']).motivo, /^não resolvido/);
});

const mk = (id, prop, ini, fim, pai) => ({ id, tipo: 'css', alvo: { seletor: '.' + id, nome: 'Bloco ' + id, contexto: { paiNome: pai }, inicial: { [prop]: ini } }, css: { arquivo: 'a.css', seletor: '.' + id, prop, antes: '', depois: '', destino: 'pendente', computado: fim } });
const base = itens => ({ id: 's', titulo: 't', pagina: 'x.html', status: 'em_andamento', itens });

test('4.3 · 3 reduções de gap + 1 remoção + 1 aproximação → rascunho cita as três direções', () => {
  const s = base([mk('a', 'gap', '24px', '16px', 'Dossiê'), mk('b', 'gap', '24px', '12px', 'Dossiê'), mk('c', 'column-gap', '16px', '8px', 'Dossiê'),
    { id: 'r', tipo: 'estrutural', alvo: { seletor: '.nav', nome: 'Navegação' }, estrutural: { acao: 'remover', criterios: [] } },
    { id: 'p', tipo: 'estrutural', alvo: { seletor: '.res', nome: 'Resultado' }, estrutural: { acao: 'aproximar_de', relacionado: { seletor: '.mud', nome: 'Mudanças' }, criterios: [] } }]);
  const t = rascunhoIntencao(s);
  assert.equal(t, 'Parece que você está simplificando dossiê (3 reduções de espaço), removendo navegação e aproximando resultado de mudanças.');
  assert.match(t, /reduções de espaço/); assert.match(t, /removendo/); assert.match(t, /aproximando/);
});

test('4.3 · com menos de 4 itens não há rascunho', () => {
  assert.equal(rascunhoIntencao(base([mk('a', 'gap', '24px', '16px', 'X')])), '');
});
