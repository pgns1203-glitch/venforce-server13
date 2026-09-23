'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { indexCss, applyPatches, PatchError } = require('../cssIndex');

const PAGE = fs.readFileSync(path.join(__dirname, 'fixture/css/pages/fechamentos-api-v2.css'), 'utf8');
const MIN = fs.readFileSync(path.join(__dirname, 'fixture/assets/visao/visao-WpWiE2tl.css'), 'utf8');

test('indexa regras de uma linha com linha:coluna exatas', () => {
  const rules = indexCss(PAGE);
  const kpis = rules.find(r => r.selector === '.vf-page-fechamentos-api .fapi-kpis' && !r.cond);
  assert.equal(kpis.line, 9);
  assert.equal(kpis.column, 1);
  assert.equal(kpis.decls.gap.value, 'var(--vf-sp-6)');
  assert.equal(kpis.decls.gap.line, 9);
});

test('ignora frames de @keyframes e marca regras dentro de @media', () => {
  const rules = indexCss(PAGE);
  assert.ok(!rules.some(r => r.selector === 'from' || r.selector === 'to'));
  const inMedia = rules.find(r => r.cond === '@media (max-width: 900px)');
  assert.equal(inMedia.selector, '.vf-page-fechamentos-api .fapi-kpis');
});

test('CSS minificado em uma linha: colunas distintas', () => {
  const rules = indexCss(MIN);
  assert.equal(rules.length, 2);
  assert.equal(rules[0].line, 1);
  assert.ok(rules[1].column > rules[0].column);
});

test('set troca SÓ o valor, o resto do arquivo fica byte a byte igual', () => {
  const { text, changes } = applyPatches(PAGE, [{ op: 'set', line: 9, column: 1, selector: '.vf-page-fechamentos-api .fapi-kpis', prop: 'gap', value: 'var(--vf-sp-4)' }]);
  assert.equal(text, PAGE.replace('gap: var(--vf-sp-6)', 'gap: var(--vf-sp-4)'));
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, 'set');
});

test('set de propriedade que não existe acrescenta no fim da mesma regra, no mesmo estilo', () => {
  const { text } = applyPatches(PAGE, [{ op: 'set', line: 1, column: 1, selector: '.vf-page-fechamentos-api .fapi-wrap', prop: 'gap', value: 'var(--vf-sp-4)' }]);
  const line1 = text.split('\n')[0];
  assert.equal(line1, '.vf-page-fechamentos-api .fapi-wrap { padding: var(--vf-sp-8); display: flex; flex-direction: column; gap: var(--vf-sp-4); }');
  assert.equal(text.split('\n').slice(1).join('\n'), PAGE.split('\n').slice(1).join('\n'));
});

test('set em regra multilinha mantém a indentação', () => {
  const { text } = applyPatches(PAGE, [{ op: 'set', line: 2, column: 1, selector: '.vf-page-fechamentos-api .fapi-filters', prop: 'margin-bottom', value: 'var(--vf-sp-4)' }]);
  assert.ok(text.includes('  margin-bottom: var(--vf-sp-4);\n}'));
});

test('regra nova vai para o fim do arquivo', () => {
  const { text, changes } = applyPatches(PAGE, [{ op: 'new', selector: '.vf-page-fechamentos-api .vf-card', decls: [{ prop: 'padding', value: 'var(--vf-sp-4)' }] }]);
  assert.ok(text.startsWith(PAGE.trimEnd()));
  assert.match(text.slice(PAGE.trimEnd().length), /\.vf-page-fechamentos-api \.vf-card \{\s*padding: var\(--vf-sp-4\);?\s*\}\s*$/);
  assert.equal(changes[0].kind, 'new');
});

test('valor vazio remove a declaração', () => {
  const { text } = applyPatches(PAGE, [{ op: 'set', line: 9, column: 1, selector: '.vf-page-fechamentos-api .fapi-kpis', prop: 'margin-bottom', value: '' }]);
  assert.ok(!text.split('\n')[8].includes('margin-bottom'));
});

test('recusa quando a regra saiu do lugar (409) e não altera nada', () => {
  assert.throws(() => applyPatches(PAGE, [
    { op: 'set', line: 9, column: 1, selector: '.vf-page-fechamentos-api .fapi-kpis', prop: 'gap', value: '1px' },
    { op: 'set', line: 3, column: 1, selector: '.nao-existe', prop: 'gap', value: '1px' }
  ]), e => e instanceof PatchError && e.status === 409);
});

test('recusa valor com { } ;', () => {
  assert.throws(() => applyPatches(PAGE, [{ op: 'set', line: 9, column: 1, selector: '.vf-page-fechamentos-api .fapi-kpis', prop: 'gap', value: '1px; color: red' }]), e => e.status === 400);
});

test('round-trip sem patch devolve o arquivo idêntico', () => {
  assert.equal(applyPatches(PAGE, []).text, PAGE);
  assert.equal(applyPatches(MIN, []).text, MIN);
});

test('regra nova dentro de @media vai para o fim do arquivo; @media fora do formato é recusado', () => {
  const { text, changes } = applyPatches(PAGE, [{ op: 'new', selector: '.vf-page-fechamentos-api .fapi-table', media: '(max-width: 900px)', decls: [{ prop: 'width', value: 'auto' }] }]);
  assert.ok(text.startsWith(PAGE.trimEnd()));
  assert.ok(text.trimEnd().endsWith('@media (max-width: 900px) {\n  .vf-page-fechamentos-api .fapi-table { width: auto; }\n}'));
  assert.equal(changes[0].media, '(max-width: 900px)');
  const r = indexCss(text).pop();
  assert.equal(r.cond, '@media (max-width: 900px)');
  assert.throws(() => applyPatches(PAGE, [{ op: 'new', selector: '.x', media: 'screen { } .y', decls: [{ prop: 'width', value: '1px' }] }]), e => e.status === 400);
});
