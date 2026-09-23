'use strict';
/*
 * missao — transforma uma sessão em MISSÃO para o agente (Claude/Codex):
 *  - rascunhoObjetivo(): uma frase montada por REGRAS a partir dos itens (sem IA). O usuário confirma ou edita.
 *  - gerarMissao(): o .md (13 seções, em ordem fixa) e o .json com as verificações executáveis.
 * Funções puras: nada aqui lê a página nem grava arquivo (quem grava é o server.js).
 */

const SPACE_PROPS = /^(padding|margin|gap|row-gap|column-gap|min-height|height|width|max-width)(-|$)/;
const FAMILIA = p => /^padding/.test(p) ? ['respiro', 'respiros'] : /gap$/.test(p) ? ['gap', 'gaps'] : /^margin/.test(p) ? ['margem', 'margens'] : /^min-height|^height/.test(p) ? ['altura', 'alturas'] : /width/.test(p) ? ['largura', 'larguras'] : /^font-size/.test(p) ? ['fonte', 'fontes'] : /^font-weight/.test(p) ? ['peso de fonte', 'pesos de fonte'] : /radius/.test(p) ? ['arredondamento', 'arredondamentos'] : [p, p];
const ACAO_TITULO = { remover: 'Remover', mover_antes: 'Mover para antes de', mover_depois: 'Mover para depois de', agrupar_com: 'Agrupar com', desagrupar: 'Desagrupar', compactar: 'Compactar', expandir: 'Expandir', mais_destaque: 'Mais destaque', menos_destaque: 'Menos destaque', aproximar_de: 'Aproximar de', separar_de: 'Separar de', alinhar_com: 'Alinhar com', igual_a: 'Igual a', virar_drawer: 'Virar drawer', virar_colapsavel: 'Virar colapsável' };
const ACAO_FEITO = { remover: 'removido(a)', mover_antes: 'movido(a) para antes de', mover_depois: 'movido(a) para depois de', agrupar_com: 'agrupado(a) com', desagrupar: 'desagrupado(a)', compactar: 'compactado(a)', expandir: 'expandido(a)', mais_destaque: 'com mais destaque', menos_destaque: 'com menos destaque', aproximar_de: 'aproximado(a) de', separar_de: 'separado(a) de', alinhar_com: 'alinhado(a) com', igual_a: 'igual a', virar_drawer: 'virando drawer', virar_colapsavel: 'virando colapsável' };
const IGUAL_PROPS = ['padding', 'gap', 'border-radius', 'border-top-width', 'background-color', 'font-size', 'font-weight', 'line-height', 'min-height'];

const px = v => { const m = String(v || '').trim().match(/^(-?[\d.]+)px$/); return m ? parseFloat(m[1]) : (String(v).trim() === '0' ? 0 : null); };
/** Soma os px de um valor computado (ex.: "16px 24px" -> 40). null se não for tudo px. */
const pxSum = v => { const parts = String(v || '').trim().split(/\s+/); const n = parts.map(px); return n.some(x => x == null) ? null : n.reduce((a, b) => a + b, 0); };
const plural = (n, [s, p]) => `${n} ${n === 1 ? s : p}`;
const low = s => String(s || '').replace(/^(\p{Lu})(?=\p{Ll})/u, m => m.toLowerCase());
const nomeAlvo = a => a ? (a.nome || a.seletor) : '?';
const ativos = s => s.itens.filter(i => !(i.tipo === 'css' && i.css.destino === 'descartada'));

/** Direção de um ajuste CSS, medida nos valores computados (antes da 1ª mudança → depois). */
function direcao(it) {
  const p = it.css.prop, ini = it.alvo && it.alvo.inicial && it.alvo.inicial[p], fim = it.css.computado;
  const a = pxSum(ini), b = pxSum(fim);
  if (a != null && b != null) return b < a ? 'reduzido' : b > a ? 'aumentado' : 'igual';
  const na = parseFloat(ini), nb = parseFloat(fim);
  if (/^font-weight/.test(p) && !isNaN(na) && !isNaN(nb)) return nb < na ? 'reduzido' : nb > na ? 'aumentado' : 'igual';
  return 'alterado';
}
const PARTICIPIO = { reduzido: ['reduzido', 'reduzidos'], aumentado: ['aumentado', 'aumentados'], alterado: ['alterado', 'alterados'], igual: ['sem mudança medida', 'sem mudança medida'] };
const FEM = new Set(['margem', 'altura', 'largura', 'fonte']);
function participio(fam, dir, n) {
  const [s, p] = PARTICIPIO[dir]; let w = n === 1 ? s : p;
  if (FEM.has(fam) && dir !== 'igual') w = w.replace(/o(s?)$/, 'a$1');
  return w;
}

/** Rascunho do objetivo em 1 frase, só com regras. Ex.: "Compactar a primeira dobra: 3 gaps reduzidos, 1 navegação marcada para remoção". */
function rascunhoObjetivo(s) {
  const its = ativos(s), partes = [];
  let menos = 0, mais = 0;
  const grupos = new Map();
  for (const it of its.filter(i => i.tipo === 'css')) {
    const d = direcao(it), fam = FAMILIA(it.css.prop);
    if (d === 'reduzido') menos++; else if (d === 'aumentado') mais++;
    const k = fam[0] + '|' + d;
    if (!grupos.has(k)) grupos.set(k, { fam, d, n: 0 });
    grupos.get(k).n++;
  }
  for (const g of grupos.values()) partes.push(`${plural(g.n, g.fam)} ${participio(g.fam[0], g.d, g.n)}`);
  const est = its.filter(i => i.tipo === 'estrutural');
  const rem = est.filter(i => i.estrutural.acao === 'remover');
  if (rem.length) { menos += rem.length; partes.push(`${plural(rem.length, ['item marcado', 'itens marcados'])} para remoção (${rem.map(i => low(nomeAlvo(i.alvo))).join(', ')})`); }
  for (const i of est.filter(x => x.estrutural.acao !== 'remover')) {
    const e = i.estrutural;
    if (e.acao === 'aproximar_de' || e.acao === 'agrupar_com' || e.acao === 'compactar') menos++;
    if (e.acao === 'separar_de' || e.acao === 'expandir') mais++;
    partes.push(`${nomeAlvo(i.alvo)} ${ACAO_FEITO[e.acao]}${e.relacionado ? ' ' + low(nomeAlvo(e.relacionado)) : ''}`);
  }
  const refs = its.filter(i => i.tipo === 'referencia');
  if (refs.length) partes.push(refs.map(r => `${nomeAlvo(r.referencia.b)} igual a ${nomeAlvo(r.referencia.a)}`).join(', '));
  const com = its.filter(i => i.tipo === 'comentario' && !i.comentario.resolvido);
  if (com.length) partes.push(plural(com.length, ['comentário', 'comentários']) + ' a tratar');
  if (!partes.length) return '';
  const alvos = its.map(i => i.alvo || (i.referencia && i.referencia.b)).filter(Boolean);
  const dobra = alvos.length && alvos.every(a => a.rect && a.rect.y < 900) ? 'a primeira dobra' : 'a tela';
  const soEstrutura = !its.some(i => i.tipo === 'css') && est.length && est.every(i => /^mover|agrupar|desagrupar/.test(i.estrutural.acao));
  const verbo = menos > mais ? 'Compactar' : mais > menos ? 'Dar mais respiro a' : soEstrutura ? 'Reorganizar' : 'Ajustar';
  return `${verbo} ${dobra}: ${partes.join(', ')}`;
}

/* ---------------- verificações executáveis ---------------- */
function verificacoes(s) {
  const out = [];
  let n = 0;
  const add = (item, v) => { const o = { id: 'v' + (++n), item, ...v }; o.descricao = descreveVerificacao(o); out.push(o); };
  for (const it of ativos(s)) {
    if (it.tipo === 'css') {
      if (it.css.computado == null) continue;
      add(it.id, { tipo: 'computado', seletor: it.alvo.seletor, indice: it.alvo.indice || 0, prop: it.css.prop, esperado: it.css.computado, largura: it.alvo.larguraTela || null });
    } else if (it.tipo === 'estrutural') {
      const e = it.estrutural, a = it.alvo;
      if (e.acao === 'remover') {
        const v = { tipo: 'ausente', seletor: a.seletor };
        if ((a.contagem || 1) > 1 && a.texto) v.texto = a.texto;
        add(it.id, v);
        const irmaos = (a.contexto && a.contexto.irmaos) || [];
        for (const sel of irmaos.slice(0, 3)) add(it.id, { tipo: 'presente', seletor: sel });
      } else if (e.acao === 'mover_antes' || e.acao === 'mover_depois') {
        const [x, y] = e.acao === 'mover_antes' ? [a, e.relacionado] : [e.relacionado, a];
        add(it.id, { tipo: 'ordem', pai: null, seletores: [x.seletor, y.seletor], textos: [x.texto || '', y.texto || ''] });
      } else if (e.acao === 'igual_a') {
        add(it.id, { tipo: 'igual', a: a.seletor, b: e.relacionado.seletor, props: IGUAL_PROPS });
      } else {
        add(it.id, { tipo: 'presente', seletor: a.seletor });
      }
    } else if (it.tipo === 'referencia') {
      const props = (it.referencia.diferencas || []).map(d => d.prop).filter(Boolean);
      if (props.length) add(it.id, { tipo: 'igual', a: it.referencia.a.seletor, b: it.referencia.b.seletor, props });
    }
  }
  for (const w of s.larguras || []) add(null, { tipo: 'sem-overflow', largura: w });
  return out;
}
function descreveVerificacao(v) {
  if (v.tipo === 'computado') return `\`${v.seletor}\`${v.indice ? ` (nº ${v.indice + 1})` : ''}${v.largura ? ` em ${v.largura}px` : ''}: \`getComputedStyle(el).getPropertyValue('${v.prop}')\` = \`${v.esperado}\``;
  if (v.tipo === 'ausente') return `nenhum \`${v.seletor}\`${v.texto ? ` com o texto "${v.texto}"` : ''} na página`;
  if (v.tipo === 'presente') return `\`${v.seletor}\` continua na página`;
  if (v.tipo === 'ordem') return `\`${v.seletores[0]}\` vem antes de \`${v.seletores[1]}\` no DOM`;
  if (v.tipo === 'igual') return `\`${v.b}\` com os mesmos valores computados de \`${v.a}\` em: ${v.props.join(', ')}`;
  if (v.tipo === 'sem-overflow') return `sem rolagem horizontal da página em ${v.largura}px`;
  return JSON.stringify(v);
}

/* ---------------- .md ---------------- */
const sameAlvo = (a, b) => a && b && a.seletor === b.seletor && (a.indice || 0) === (b.indice || 0);
const onde = a => `\`${a.seletor}\`${a.indice ? ` (nº ${a.indice + 1})` : ''}${a.texto ? ` · texto "${a.texto}"` : ''}`;
const fonteCss = a => a.fonteCss ? `\`${a.fonteCss.arquivo}:${a.fonteCss.linha}\` — ${a.fonteCss.evidencia || ''}`.trim() : (a.fonteCssMotivo || 'não resolvido: sem regra CSS capturada');
const componente = a => a.componente ? `\`${a.componente.arquivo}${a.componente.linha ? ':' + a.componente.linha : ''}\` — ${a.componente.evidencia || ''}${a.componente.trecho ? ` · \`${a.componente.trecho}\`` : ''}` : (a.componenteMotivo || 'não resolvido: componente não pesquisado');

function gerarMissao(s, cfg = {}) {
  const its = ativos(s), L = [];
  const css = its.filter(i => i.tipo === 'css'), est = its.filter(i => i.tipo === 'estrutural'), com = its.filter(i => i.tipo === 'comentario');
  const refs = its.filter(i => i.tipo === 'referencia'), estr = its.filter(i => i.tipo === 'estranho');
  const descartadas = s.itens.filter(i => i.tipo === 'css' && i.css.destino === 'descartada');
  const mudancas = [...css, ...est, ...refs];
  const comLigado = c => mudancas.some(m => sameAlvo(m.alvo || (m.referencia && m.referencia.b), c.alvo));
  const V = verificacoes(s);

  // 1. título
  L.push(`# Missão — ${s.titulo}`, '', `> Página: \`Portal/${s.pagina}\` · URL: \`${s.url || '/' + s.pagina}\` · Sessão: \`${s.id}\``, '');
  // 2. resumo
  const grav = css.filter(i => i.css.destino === 'gravado').length;
  L.push('## Resumo', '');
  L.push(`- ${plural(css.length, ['ajuste CSS', 'ajustes CSS'])} (${grav} já gravado${grav === 1 ? '' : 's'}, ${css.length - grav} a fazer)${descartadas.length ? ` · ${descartadas.length} descartado${descartadas.length === 1 ? '' : 's'} (não entra${descartadas.length === 1 ? '' : 'm'})` : ''}`);
  L.push(`- ${plural(est.length, ['mudança estrutural', 'mudanças estruturais'])}`);
  L.push(`- ${plural(com.length, ['comentário', 'comentários'])} (${com.filter(c => c.comentario.resolvido).length} resolvido${com.filter(c => c.comentario.resolvido).length === 1 ? '' : 's'})`);
  L.push(`- ${plural(refs.length, ['referência visual', 'referências visuais'])} · ${plural(estr.length, ['análise "está estranho"', 'análises "está estranho"'])}`);
  L.push(`- ${plural((s.estados || []).length, ['estado registrado', 'estados registrados'])} · larguras: ${(s.larguras || []).join(', ') || '(nenhuma)'}`);
  L.push(`- ${plural(V.length, ['verificação executável', 'verificações executáveis'])}`, '');
  // 3. objetivo
  L.push('## Objetivo', '', s.objetivo && s.objetivo.trim() ? s.objetivo.trim() : '(não definido)', '');
  // 4. intenções
  L.push('## Intenções', '', '_O porquê de cada mudança, nas palavras de quem revisou. Use para decidir o "como" sem contrariar a intenção._', '');
  const intencoes = [];
  for (const c of com.filter(comLigado)) intencoes.push(`- 💬 "${c.comentario.texto}"${c.comentario.resolvido ? ' _(resolvido)_' : ''} — em **${nomeAlvo(c.alvo)}** ${onde(c.alvo)}${c.alvo.regiao ? ' (região marcada)' : ''}`);
  for (const m of mudancas.filter(m => m.nota)) intencoes.push(`- 📝 "${m.nota}" — ${m.tipo === 'css' ? `\`${m.css.prop}\` de **${nomeAlvo(m.alvo)}**` : m.tipo === 'estrutural' ? `${ACAO_TITULO[m.estrutural.acao].toLowerCase()} **${nomeAlvo(m.alvo)}**` : `referência em **${nomeAlvo(m.referencia.b)}**`}`);
  L.push(...(intencoes.length ? intencoes : ['(nenhuma nota ou comentário ligado a uma mudança)']), '');
  // 5. css
  L.push('## Mudanças CSS confirmadas', '');
  if (!css.length) L.push('(nenhuma)', '');
  css.forEach((it, k) => {
    const c = it.css, feito = c.destino === 'gravado';
    L.push(`### ${k + 1}. \`${c.seletorRegra || c.seletor}\` — \`${c.arquivo}${c.linha ? ':' + c.linha : ''}\`${feito ? ' — ✅ feito, não refazer' : ''}`, '');
    L.push(`- \`${c.prop}\`: \`${c.antes || '(não existe)'}\` → \`${c.depois || '(remover a declaração)'}\`${c.computado ? ` (computado esperado: \`${c.computado}\`)` : ''}`);
    if (c.cond) L.push(`- Dentro de \`${c.cond}\``);
    if (it.nota) L.push(`- Por quê: "${it.nota}"`);
    if (feito) L.push(`- Destino: **já gravado** pelo VF DevTools${c.gravadoEm ? ` em ${c.gravadoEm.slice(0, 16).replace('T', ' ')}` : ''} — confira no diff, não refaça.`);
    else if (c.destino === 'pendente') L.push(`- Destino: **a fazer** — trocar só o valor nesta declaração${c.novo ? ' (regra nova no fim do arquivo, como override desta tela)' : ''}.`);
    else L.push(`- Destino: **a fazer na fonte** — ${c.motivo ? c.motivo + '. ' : ''}Garantir em \`${c.seletorRegra}\` sem \`!important\` e sem seletor novo se já existir um equivalente.`);
    L.push(`- Elemento: **${nomeAlvo(it.alvo)}** ${onde(it.alvo)}`, '');
  });
  // 6. estrutural
  L.push('## Mudanças estruturais', '', '_Nunca resolver com CSS de esconder/reordenar (`display:none`, `order`, `position`). A mudança é no componente/markup._', '');
  const estruturais = [...est, ...refs.filter(r => (r.referencia.criterios || []).length)];
  if (!estruturais.length) L.push('(nenhuma)', '');
  estruturais.forEach((it, k) => {
    if (it.tipo === 'referencia') {
      L.push(`### ${k + 1}. Igual à referência — ${nomeAlvo(it.referencia.b)}`, '', `- Alvo: ${onde(it.referencia.b)}`, `- Referência: **${nomeAlvo(it.referencia.a)}** ${onde(it.referencia.a)}`, `- Componente provável: ${componente(it.referencia.b)}`, '- Critérios:', ...it.referencia.criterios.map(c => `  - [ ] ${c}`), '');
      return;
    }
    const e = it.estrutural;
    L.push(`### ${k + 1}. ${ACAO_TITULO[e.acao]} — ${nomeAlvo(it.alvo)}${e.relacionado ? ` → ${nomeAlvo(e.relacionado)}` : ''}`, '');
    L.push(`- Alvo: ${onde(it.alvo)}`, `- Caminho DOM: \`${it.alvo.caminhoDom || '(não capturado)'}\``);
    if (e.relacionado) L.push(`- Relacionado: **${nomeAlvo(e.relacionado)}** ${onde(e.relacionado)}`);
    L.push(`- Componente provável: ${componente(it.alvo)}`);
    if (it.nota) L.push(`- Por quê: "${it.nota}"`);
    L.push('- Critérios:', ...(e.criterios.length ? e.criterios.map(c => `  - [ ] ${c}`) : ['  - (nenhum)']), '');
  });
  // 7. comentários sem implementação direta
  L.push('## Comentários sem implementação direta', '', '_Não há mudança registrada para estes pontos. Proponha a menor mudança que atende o comentário, dentro das restrições, e descreva o que fez. Se não houver solução segura, deixe como está e explique._', '');
  const soltos = com.filter(c => !comLigado(c) && !c.comentario.resolvido);
  const fatos = estr.flatMap(i => i.estranho.achados.map(a => ({ it: i, a })));
  if (!soltos.length && !fatos.length) L.push('(nenhum)');
  soltos.forEach((c, k) => L.push(`${k + 1}. "${c.comentario.texto}" — **${nomeAlvo(c.alvo)}** ${onde(c.alvo)}${c.alvo.regiao ? ` (região de ${c.alvo.rect.w}×${c.alvo.rect.h}px)` : ''}`));
  fatos.forEach(({ it, a }, k) => L.push(`${soltos.length + k + 1}. Fato medido (está estranho): ${a.fato} — **${nomeAlvo(it.alvo)}** ${onde(it.alvo)}`));
  L.push('');
  // 8. fontes prováveis
  L.push('## Fontes prováveis', '', '| Elemento | CSS (regra que casa) | Componente provável |', '|---|---|---|');
  const vistos = [];
  for (const it of its) for (const a of [it.alvo, it.estrutural && it.estrutural.relacionado, it.referencia && it.referencia.a, it.referencia && it.referencia.b]) {
    if (!a || vistos.some(v => sameAlvo(v, a))) continue;
    vistos.push(a);
    L.push(`| **${nomeAlvo(a)}** ${onde(a).replace(/\|/g, '\\|')} | ${fonteCss(a).replace(/\|/g, '\\|')} | ${componente(a).replace(/\|/g, '\\|')} |`);
  }
  L.push('');
  // 9. restrições
  const prot = (cfg.protectedFiles || ['style.css', 'layout.js']).map(f => `\`Portal/${f}\``).join(', ');
  L.push('## Restrições', '');
  L.push('- Não tocar no backend (`server/**`) nem em contratos de API (rotas, payloads, nomes de campos).');
  L.push('- Não tocar no shell/moldura do Portal (sidebar, `vf-shell`, navegação global).');
  L.push(`- Não tocar em arquivos protegidos: ${prot}.`);
  L.push('- Não editar assets compilados (`Portal/assets/**`): a mudança vai na fonte (`frontend-react/src/**`) e depois no build da ilha.');
  L.push('- Sem `!important` e sem subir especificidade de seletor.');
  L.push('- Sem classe nova se já existir uma equivalente; sem arquivo novo sem necessidade.');
  L.push('- Mudanças estruturais nunca com CSS de esconder/reordenar (`display:none`, `visibility`, `order`).');
  L.push('- Não mexer em textos, IDs, `data-*` e comportamento que não estejam listados.', '');
  // 10. critérios de aceite
  L.push('## Critérios de aceite', '');
  for (const v of V) L.push(`- [ ] ${descreveVerificacao(v)}`);
  if (est.length) L.push('- [ ] Todos os critérios das mudanças estruturais acima.');
  L.push('- [ ] Nenhuma linha alterada no diff além das necessárias para esta missão.', '');
  // 11. estados
  L.push('## Estados a validar', '');
  if ((s.estados || []).length) for (const e of s.estados) L.push(`- [ ] **${e.nome}** — \`${e.url}\`${e.reproducao ? ` — ${e.reproducao}` : ''}${e.largura ? ` (capturado em ${e.largura}px)` : ''}`);
  else L.push(`- [ ] Estado padrão da URL \`${s.url || '/' + s.pagina}\` (nenhum outro estado registrado).`);
  L.push('');
  // 12. larguras
  L.push('## Larguras a validar', '', ...((s.larguras || []).length ? s.larguras.map(w => `- [ ] ${w}px`) : ['- [ ] a largura atual']), '');
  // 13. como verificar
  L.push('## Como verificar', '');
  L.push(`Abra a página com o VF DevTools (\`cd tools/vfdev && npm start\` → \`http://127.0.0.1:5190/${s.pagina}\`) e clique em **Verificar missão** na aba Sessão.`);
  L.push(`As verificações executáveis estão em \`tools/vfdev/missoes/${s.id}.json\`.`, '');

  const json = { id: s.id, sessao: s.id, pagina: s.pagina, url: s.url || '/' + s.pagina, titulo: s.titulo, objetivo: s.objetivo || '', larguras: s.larguras || [], estados: s.estados || [], verificacoes: V };
  return { md: L.join('\n'), json };
}

module.exports = { rascunhoObjetivo, gerarMissao, verificacoes, descreveVerificacao, direcao };
