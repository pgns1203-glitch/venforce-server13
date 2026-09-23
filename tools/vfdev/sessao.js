'use strict';
/*
 * sessao — modelo de dados da sessão de revisão visual (validação por schema + armazenamento em disco).
 * Uma sessão é o objeto de primeira classe da "camada de intenção": junta ajustes CSS, ações estruturais,
 * comentários, referências e achados, e sobrevive a F5, fechar a aba e reiniciar o servidor.
 * Cada sessão vive em <dir>/<id>.json. Nada aqui toca no Portal.
 */
const fs = require('fs');
const path = require('path');
const { PatchError } = require('./cssIndex');

const STATUS = ['em_andamento', 'missao_gerada', 'verificada', 'descartada'];
const TIPOS = ['css', 'estrutural', 'comentario', 'referencia', 'estranho'];
const ACOES = ['remover', 'mover_antes', 'mover_depois', 'agrupar_com', 'desagrupar', 'compactar', 'expandir', 'mais_destaque', 'menos_destaque', 'aproximar_de', 'separar_de', 'alinhar_com', 'igual_a', 'virar_drawer', 'virar_colapsavel'];
/** Ações que pedem um segundo elemento (o "relacionado"). */
const ACOES_COM_RELACAO = ['mover_antes', 'mover_depois', 'agrupar_com', 'aproximar_de', 'separar_de', 'alinhar_com', 'igual_a'];
const DESTINOS = ['gravado', 'pendente', 'prompt', 'descartada'];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,95}$/;

/** Critérios padrão (editáveis) de cada ação estrutural. Nunca viram CSS: vão para a missão. */
const CRITERIOS = {
  remover: ['não usar display:none', 'remover a renderização do componente', 'remover container vazio e estilos exclusivos (altura, sticky, borda)', 'preservar as demais seções'],
  mover_antes: ['mudar a ordem no componente/markup, não com order/position', 'o elemento aparece imediatamente antes do relacionado', 'preservar comportamento e dados dos dois blocos'],
  mover_depois: ['mudar a ordem no componente/markup, não com order/position', 'o elemento aparece imediatamente depois do relacionado', 'preservar comportamento e dados dos dois blocos'],
  agrupar_com: ['os dois elementos passam a ter um container comum', 'sem card dentro de card (no máximo um nível com borda/fundo)', 'preservar a ordem de leitura'],
  desagrupar: ['remover o container que agrupa, mantendo os filhos', 'remover estilos exclusivos do container removido', 'preservar a ordem de leitura'],
  compactar: ['reduzir espaços usando tokens da fundação', 'não reduzir fonte abaixo do mínimo', 'não criar overflow em nenhuma largura validada'],
  expandir: ['aumentar espaços usando tokens da fundação', 'não criar overflow em nenhuma largura validada'],
  mais_destaque: ['aumentar a hierarquia visual (tamanho/peso/posição) sem cor nova fora dos tokens', 'o elemento passa a ser o mais forte do grupo'],
  menos_destaque: ['reduzir a hierarquia visual (tamanho/peso/cor secundária dos tokens)', 'manter legível (contraste ≥ 4.5:1)'],
  aproximar_de: ['reduzir a distância entre os dois elementos usando tokens', 'não sobrepor', 'preservar o alinhamento dos demais irmãos'],
  separar_de: ['aumentar a distância entre os dois elementos usando tokens', 'preservar o alinhamento dos demais irmãos'],
  alinhar_com: ['as bordas relevantes dos dois elementos ficam alinhadas (diferença ≤ 1px)', 'resolver no layout do pai, não com margem negativa'],
  igual_a: ['reaproveitar a mesma classe/componente do relacionado quando existir', 'mesmos espaçamentos, borda, raio e tipografia do relacionado', 'sem classe nova se existir equivalente'],
  virar_drawer: ['o conteúdo sai do fluxo e abre num drawer já existente no design system', 'um gatilho visível abre o drawer', 'preservar dados e ações'],
  virar_colapsavel: ['o bloco vira colapsável (fechado por padrão, salvo decisão contrária)', 'o título continua visível fechado', 'acessível por teclado (aria-expanded)']
};

/* ---------------- validação ---------------- */
function fail(msg) { throw new PatchError(400, `Sessão inválida: ${msg}`); }
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const isStr = v => typeof v === 'string';
const isNum = v => typeof v === 'number' && Number.isFinite(v);
function only(obj, keys, where) {
  const extra = Object.keys(obj).filter(k => !keys.includes(k));
  if (extra.length) fail(`${where}: campo(s) desconhecido(s) ${extra.map(k => `"${k}"`).join(', ')}. Aceitos: ${keys.join(', ')}.`);
}
function str(obj, k, where, { required = false, max = 20000, nullable = false } = {}) {
  const v = obj[k];
  if (v === undefined) { if (required) fail(`${where}.${k} é obrigatório.`); return; }
  if (v === null && nullable) return;
  if (!isStr(v)) fail(`${where}.${k} deve ser texto.`);
  if (v.length > max) fail(`${where}.${k} passa de ${max} caracteres.`);
}
function num(obj, k, where, { required = false, nullable = false } = {}) {
  const v = obj[k];
  if (v === undefined) { if (required) fail(`${where}.${k} é obrigatório.`); return; }
  if (v === null && nullable) return;
  if (!isNum(v)) fail(`${where}.${k} deve ser número.`);
}
function fonte(v, where) {
  if (v === undefined || v === null) return;
  if (!isObj(v)) fail(`${where} deve ser objeto ou null.`);
  only(v, ['arquivo', 'linha', 'coluna', 'evidencia', 'seletor', 'candidatos', 'trecho'], where);
  str(v, 'arquivo', where, { required: true, max: 400 });
  num(v, 'linha', where, { nullable: true });
  str(v, 'evidencia', where, { max: 600 });
}
const ALVO_KEYS = ['seletor', 'indice', 'contagem', 'caminhoDom', 'texto', 'rect', 'larguraTela', 'fonteCss', 'fonteCssMotivo', 'componente', 'componenteMotivo', 'regiao', 'offset', 'contexto', 'inicial', 'nome'];
function alvo(v, where, required = true) {
  if (v === undefined || v === null) { if (required) fail(`${where} é obrigatório.`); return; }
  if (!isObj(v)) fail(`${where} deve ser objeto.`);
  only(v, ALVO_KEYS, where);
  str(v, 'seletor', where, { required: true, max: 600 });
  num(v, 'indice', where);
  str(v, 'caminhoDom', where, { max: 2000 });
  str(v, 'texto', where, { max: 60 });
  str(v, 'nome', where, { max: 120 });
  if (v.rect !== undefined) {
    if (!isObj(v.rect)) fail(`${where}.rect deve ser { x, y, w, h }.`);
    for (const k of ['x', 'y', 'w', 'h']) num(v.rect, k, where + '.rect', { required: true });
  }
  num(v, 'larguraTela', where);
  fonte(v.fonteCss, where + '.fonteCss');
  fonte(v.componente, where + '.componente');
  str(v, 'fonteCssMotivo', where, { max: 600 });
  str(v, 'componenteMotivo', where, { max: 600 });
  if (v.regiao !== undefined && typeof v.regiao !== 'boolean') fail(`${where}.regiao deve ser true/false.`);
  if (v.offset !== undefined) { if (!isObj(v.offset)) fail(`${where}.offset deve ser { fx, fy }.`); num(v.offset, 'fx', where + '.offset', { required: true }); num(v.offset, 'fy', where + '.offset', { required: true }); }
  if (v.contexto !== undefined && !isObj(v.contexto)) fail(`${where}.contexto deve ser objeto.`);
  if (v.inicial !== undefined) {
    if (!isObj(v.inicial)) fail(`${where}.inicial deve ser objeto { prop: valor }.`);
    for (const [k, x] of Object.entries(v.inicial)) if (!isStr(x)) fail(`${where}.inicial.${k} deve ser texto.`);
  }
}

const ITEM_KEYS = ['id', 'tipo', 'criadoEm', 'nota', 'alvo', 'css', 'estrutural', 'comentario', 'referencia', 'estranho'];
function item(it, i) {
  const w = `itens[${i}]`;
  if (!isObj(it)) fail(`${w} deve ser objeto.`);
  only(it, ITEM_KEYS, w);
  str(it, 'id', w, { required: true, max: 60 });
  if (!TIPOS.includes(it.tipo)) fail(`${w}.tipo "${it.tipo}" inválido. Use: ${TIPOS.join(', ')}.`);
  str(it, 'criadoEm', w, { max: 40 });
  str(it, 'nota', w, { max: 4000 });
  if (it.tipo !== 'referencia') alvo(it.alvo, w + '.alvo');
  for (const t of TIPOS) if (t !== it.tipo && it[t] !== undefined) fail(`${w} é do tipo "${it.tipo}" mas tem o bloco "${t}".`);
  const b = it[it.tipo];
  if (!isObj(b)) fail(`${w}.${it.tipo} é obrigatório para itens do tipo "${it.tipo}".`);
  const bw = `${w}.${it.tipo}`;
  if (it.tipo === 'css') {
    only(b, ['arquivo', 'linha', 'coluna', 'seletor', 'seletorRegra', 'prop', 'antes', 'depois', 'destino', 'motivo', 'kind', 'cond', 'novo', 'computado', 'gravadoEm', 'regra'], bw);
    str(b, 'arquivo', bw, { required: true, max: 400 });
    num(b, 'linha', bw, { nullable: true }); num(b, 'coluna', bw, { nullable: true });
    str(b, 'seletor', bw, { required: true, max: 600 });
    if (!/^-{0,2}[a-z][a-z0-9-]*$/i.test(b.prop || '')) fail(`${bw}.prop "${b.prop}" não é uma propriedade CSS.`);
    str(b, 'antes', bw, { max: 600 }); str(b, 'depois', bw, { required: true, max: 600 });
    if (/[{};]/.test(b.depois) || /!important/i.test(b.depois)) fail(`${bw}.depois não pode ter { } ; nem !important.`);
    if (!DESTINOS.includes(b.destino)) fail(`${bw}.destino "${b.destino}" inválido. Use: ${DESTINOS.join(', ')}.`);
  } else if (it.tipo === 'estrutural') {
    only(b, ['acao', 'relacionado', 'criterios'], bw);
    if (!ACOES.includes(b.acao)) fail(`${bw}.acao "${b.acao}" inválida. Use: ${ACOES.join(', ')}.`);
    if (ACOES_COM_RELACAO.includes(b.acao)) alvo(b.relacionado, bw + '.relacionado');
    else if (b.relacionado != null) alvo(b.relacionado, bw + '.relacionado');
    if (!Array.isArray(b.criterios) || b.criterios.some(c => !isStr(c) || c.length > 400)) fail(`${bw}.criterios deve ser lista de textos.`);
  } else if (it.tipo === 'comentario') {
    only(b, ['texto', 'ponto', 'resolvido'], bw);
    str(b, 'texto', bw, { required: true, max: 4000 });
    if (!b.texto.trim()) fail(`${bw}.texto está vazio.`);
    if (b.ponto !== undefined && b.ponto !== null) { if (!isObj(b.ponto)) fail(`${bw}.ponto deve ser { x, y }.`); num(b.ponto, 'x', bw + '.ponto', { required: true }); num(b.ponto, 'y', bw + '.ponto', { required: true }); }
    if (b.resolvido !== undefined && typeof b.resolvido !== 'boolean') fail(`${bw}.resolvido deve ser true/false.`);
  } else if (it.tipo === 'referencia') {
    only(b, ['a', 'b', 'diferencas', 'criterios'], bw);
    alvo(b.a, bw + '.a'); alvo(b.b, bw + '.b');
    if (!Array.isArray(b.diferencas)) fail(`${bw}.diferencas deve ser lista.`);
    b.diferencas.forEach((d, k) => { if (!isObj(d) || !isStr(d.aspecto)) fail(`${bw}.diferencas[${k}] precisa de "aspecto".`); });
    if (b.criterios !== undefined && (!Array.isArray(b.criterios) || b.criterios.some(c => !isStr(c)))) fail(`${bw}.criterios deve ser lista de textos.`);
  } else if (it.tipo === 'estranho') {
    only(b, ['achados'], bw);
    if (!Array.isArray(b.achados)) fail(`${bw}.achados deve ser lista.`);
    b.achados.forEach((a, k) => { if (!isObj(a) || !isStr(a.fato) || !a.fato) fail(`${bw}.achados[${k}] precisa de "fato".`); });
  }
}

const TOP_KEYS = ['id', 'titulo', 'pagina', 'url', 'status', 'objetivo', 'criadaEm', 'atualizadaEm', 'larguras', 'estados', 'itens', 'regressoes', 'verificacao', 'missao'];
function validarSessao(s, idEsperado) {
  if (!isObj(s)) fail('o corpo deve ser um objeto JSON.');
  only(s, TOP_KEYS, 'sessão');
  if (!ID_RE.test(s.id || '')) fail(`id "${s.id}" inválido (use a-z, 0-9 e hífen).`);
  if (idEsperado && s.id !== idEsperado) fail(`id do corpo ("${s.id}") difere do da URL ("${idEsperado}").`);
  str(s, 'titulo', 'sessão', { required: true, max: 200 });
  if (!s.titulo.trim()) fail('titulo está vazio.');
  str(s, 'pagina', 'sessão', { required: true, max: 200 });
  if (!/^[\w./-]+\.html$/.test(s.pagina) || s.pagina.includes('..')) fail(`pagina "${s.pagina}" deve ser um .html do Portal.`);
  str(s, 'url', 'sessão', { max: 2000 });
  if (!STATUS.includes(s.status)) fail(`status "${s.status}" inválido. Use: ${STATUS.join(', ')}.`);
  str(s, 'objetivo', 'sessão', { max: 1000 });
  str(s, 'criadaEm', 'sessão', { max: 40 }); str(s, 'atualizadaEm', 'sessão', { max: 40 });
  if (s.larguras !== undefined && (!Array.isArray(s.larguras) || s.larguras.some(w => !Number.isInteger(w) || w < 240 || w > 3840))) fail('larguras deve ser lista de inteiros entre 240 e 3840.');
  if (s.estados !== undefined) {
    if (!Array.isArray(s.estados)) fail('estados deve ser lista.');
    s.estados.forEach((e, i) => {
      const w = `estados[${i}]`;
      if (!isObj(e)) fail(`${w} deve ser objeto.`);
      only(e, ['id', 'nome', 'url', 'reproducao', 'largura', 'validadoEm', 'validadoLargura'], w);
      str(e, 'id', w, { required: true, max: 40 }); str(e, 'nome', w, { required: true, max: 200 });
      str(e, 'url', w, { required: true, max: 2000 }); str(e, 'reproducao', w, { max: 2000 });
      num(e, 'largura', w, { nullable: true }); str(e, 'validadoEm', w, { max: 40, nullable: true }); num(e, 'validadoLargura', w, { nullable: true });
    });
  }
  if (!Array.isArray(s.itens)) fail('itens deve ser lista.');
  if (s.itens.length > 500) fail('mais de 500 itens numa sessão só — divida em duas.');
  s.itens.forEach(item);
  const ids = new Set();
  for (const it of s.itens) { if (ids.has(it.id)) fail(`id de item repetido: "${it.id}".`); ids.add(it.id); }
  if (s.regressoes !== undefined && !Array.isArray(s.regressoes)) fail('regressoes deve ser lista.');
  if (s.verificacao !== undefined && s.verificacao !== null && !isObj(s.verificacao)) fail('verificacao deve ser objeto ou null.');
  if (s.missao !== undefined && s.missao !== null && !isObj(s.missao)) fail('missao deve ser objeto ou null.');
  return s;
}

/* ---------------- armazenamento ---------------- */
class SessionStore {
  constructor(dir) { this.dir = dir; }
  file(id) {
    if (!ID_RE.test(id || '')) throw new PatchError(400, `id de sessão inválido: "${id}".`);
    return path.join(this.dir, id + '.json');
  }
  list(pagina) {
    if (!fs.existsSync(this.dir)) return [];
    const out = [];
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      let s; try { s = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8')); } catch (e) { continue; }
      if (pagina && s.pagina !== pagina) continue;
      out.push({ id: s.id, titulo: s.titulo, pagina: s.pagina, status: s.status, itens: (s.itens || []).length, atualizadaEm: s.atualizadaEm, criadaEm: s.criadaEm });
    }
    return out.sort((a, b) => String(b.atualizadaEm).localeCompare(String(a.atualizadaEm)));
  }
  get(id) {
    const f = this.file(id);
    if (!fs.existsSync(f)) throw new PatchError(404, `Sessão "${id}" não existe.`);
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  put(id, body) {
    validarSessao(body, id);
    const now = new Date().toISOString();
    const f = this.file(id);
    const prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    const s = { ...body, criadaEm: (prev && prev.criadaEm) || body.criadaEm || now, atualizadaEm: now };
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, f);
    return s;
  }
  delete(id) {
    const f = this.file(id);
    if (!fs.existsSync(f)) throw new PatchError(404, `Sessão "${id}" não existe.`);
    fs.unlinkSync(f);
  }
  duplicate(id) {
    const s = this.get(id);
    let n = 2, nid;
    const base = id.replace(/-copia(-\d+)?$/, '');
    do { nid = `${base}-copia${n > 2 ? '-' + (n - 1) : ''}`.slice(0, 96); n++; } while (fs.existsSync(this.file(nid)));
    const now = new Date().toISOString();
    return this.put(nid, { ...s, id: nid, titulo: `${s.titulo} (cópia)`.slice(0, 200), status: 'em_andamento', criadaEm: now, verificacao: null, missao: null });
  }
}

module.exports = { validarSessao, SessionStore, STATUS, TIPOS, ACOES, ACOES_COM_RELACAO, CRITERIOS, ID_RE };
