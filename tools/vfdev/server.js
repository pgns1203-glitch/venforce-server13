'use strict';
/*
 * VF Visual DevTools — servidor LOCAL de desenvolvimento.
 *  - Serve a pasta Portal/ como estática (igual ao que o navegador recebe em produção).
 *  - Injeta /__vfdev/client.js nas páginas .html (nada é gravado no HTML).
 *  - Expõe /__vfdev/index (CSS com linha:coluna; bundle do Vite pareado com a fonte React) e /__vfdev/patch (patch mínimo).
 *  - Sessões, missões, histórico de gravações (desfazer), git status, CSS ao vivo (SSE) e rebuild das ilhas React.
 *  - Escuta só em 127.0.0.1. Não faz parte do deploy.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { indexCss, applyPatches, pairBundle, PatchError } = require('./cssIndex');
const { SessionStore, ACOES, ACOES_COM_RELACAO, CRITERIOS, ID_RE } = require('./sessao');
const { gerarMissao, rascunhoObjetivo, rascunhoIntencao } = require('./missao');
const { buscarOrigem } = require('./origem');

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'vfdev.config.json'), 'utf8'));
const REPO = path.resolve(process.env.VFDEV_REPO_DIR || path.join(__dirname, '..', '..'));
const PORTAL = path.resolve(process.env.VFDEV_PORTAL_DIR || path.join(REPO, CFG.portalDir || 'Portal'));
const PORT = Number(process.env.VFDEV_PORT) || CFG.port || 5190;
const HOST = '127.0.0.1';
const BACKEND = process.env.VFDEV_BACKEND || CFG.backend || null;
const TOKEN = crypto.randomBytes(16).toString('hex');
const CLIENT = path.join(__dirname, 'client', 'vf-devtools.js');
const SESSOES = new SessionStore(path.resolve(process.env.VFDEV_SESSOES_DIR || path.join(__dirname, 'sessoes')));
const MISSOES = path.resolve(process.env.VFDEV_MISSOES_DIR || path.join(__dirname, 'missoes'));
const HISTORY = path.resolve(process.env.VFDEV_HISTORY_DIR || path.join(__dirname, '.history'));
const REACT_DIR = path.resolve(REPO, CFG.reactDir || 'frontend-react');
const REACT_W = path.resolve(REPO, CFG.reactWritableDir || 'frontend-react/src/styles/');
const relTool = abs => path.relative(REPO, abs).split(path.sep).join('/');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf'
};

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
const json = (res, code, obj) => send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8');

/** Caminho relativo ao Portal -> absoluto, recusando qualquer coisa fora dele. */
function portalPath(rel) {
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = path.resolve(PORTAL, clean);
  if (abs !== PORTAL && !abs.startsWith(PORTAL + path.sep)) return null;
  return abs;
}
const relOf = abs => path.relative(PORTAL, abs).split(path.sep).join('/');

function classify(rel) {
  if ((CFG.protectedFiles || []).includes(rel)) return { kind: 'protected', writable: false, reason: 'arquivo protegido — a ferramenta nunca grava aqui' };
  const built = (CFG.builtDirs || []).find(d => rel.startsWith(d));
  if (built) {
    const dir = Object.keys(CFG.viteSources || {}).find(d => rel.startsWith(d));
    const src = dir ? CFG.viteSources[dir] : [];
    return { kind: 'built', writable: false, reason: src && src.length ? `gerado pelo Vite — fonte: ${src.join(', ')}` : 'gerado por build — fonte não versionada', sources: src || [] };
  }
  if ((CFG.globalFiles || []).includes(rel)) return { kind: 'global', writable: true, reason: 'arquivo global — afeta várias telas' };
  return { kind: 'page', writable: true, reason: '' };
}

/**
 * Arquivo gravável pelo patch: .css dentro do Portal (page/global) ou fonte React em frontend-react/src/styles/.
 * `rel` é relativo ao Portal, ou começa com "frontend-react/" (relativo ao repositório).
 */
function resolveWritable(rel) {
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (clean.startsWith((CFG.reactDir || 'frontend-react') + '/')) {
    const abs = path.resolve(REPO, clean);
    if (!abs.startsWith(REACT_W + path.sep) || !abs.endsWith('.css')) throw new PatchError(400, `Só .css dentro de ${CFG.reactWritableDir}: ${clean}`);
    return { abs, rel: relTool(abs), cls: { kind: 'react-source', writable: true, reason: '' } };
  }
  const abs = portalPath(clean);
  if (!abs || !abs.endsWith('.css')) throw new PatchError(400, `Só .css dentro de ${path.basename(PORTAL)}/ ou de ${CFG.reactWritableDir}: ${clean}`);
  const r = relOf(abs);
  return { abs, rel: r, cls: classify(r) };
}

/* ---------------- histórico de gravações (para desfazer) ---------------- */
function historyAppend(obj) {
  fs.mkdirSync(HISTORY, { recursive: true });
  fs.appendFileSync(path.join(HISTORY, new Date().toISOString().slice(0, 10) + '.jsonl'), JSON.stringify(obj) + '\n', 'utf8');
}
function historyAll() {
  if (!fs.existsSync(HISTORY)) return [];
  const entries = new Map();
  for (const f of fs.readdirSync(HISTORY).filter(f => f.endsWith('.jsonl')).sort()) {
    for (const line of fs.readFileSync(path.join(HISTORY, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch (e) { continue; }
      if (o.desfeito && entries.has(o.desfeito)) entries.get(o.desfeito).desfeitoEm = o.em;
      else if (o.id) entries.set(o.id, o);
    }
  }
  return [...entries.values()];
}

/* ---------------- eventos (SSE): CSS ao vivo e log do rebuild ---------------- */
const sseClients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const r of sseClients) r.write(msg);
}
let watching = false;
const watchers = [];
/**
 * Um fs.watch NÃO recursivo por diretório (inotify no diretório). O modo recursivo do Node no Linux perde eventos
 * quando o arquivo é trocado por rename — que é exatamente como o patch e o desfazer gravam (tmp + rename).
 */
function watchDir(dir, toRel) {
  if (!fs.existsSync(dir)) return;
  const timers = new Map();
  const walk = d => {
    try {
      watchers.push(fs.watch(d, (ev, name) => {
        if (!name || !String(name).endsWith('.css')) return;
        const abs = path.join(d, String(name));
        clearTimeout(timers.get(abs));
        timers.set(abs, setTimeout(() => { timers.delete(abs); broadcast('css', { file: toRel(abs), em: Date.now() }); }, 30));
      }));
    } catch (e) { console.warn('[vfdev] sem fs.watch em', d, e.message); return; }
    for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory() && !/^(node_modules|\.git|dist|coverage)$/.test(e.name)) walk(path.join(d, e.name));
  };
  walk(dir);
}
function ensureWatch() {
  if (watching) return; watching = true;
  watchDir(PORTAL, abs => relOf(abs));
  watchDir(path.join(REACT_DIR, 'src'), abs => relTool(abs));
}

/* ---------------- rebuild de uma ilha React ---------------- */
let building = null;
function rebuild(ilha) {
  if (!Object.prototype.hasOwnProperty.call(CFG.ilhas || {}, ilha)) throw new PatchError(400, `Ilha desconhecida: "${ilha}". Conhecidas: ${Object.keys(CFG.ilhas || {}).join(', ')}.`);
  const script = CFG.ilhas[ilha];
  if (!script) throw new PatchError(400, `A ilha "${ilha}" não tem script de build: ${(CFG.ilhasSemScript || {})[ilha] || 'sem script configurado'}.`);
  const pkgFile = path.join(REACT_DIR, 'package.json');
  if (!fs.existsSync(pkgFile)) throw new PatchError(400, `Não achei ${relTool(pkgFile)}.`);
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  if (!pkg.scripts || !pkg.scripts[script]) throw new PatchError(400, `O script "${script}" não existe em ${relTool(pkgFile)} — não há como reconstruir a ilha "${ilha}".`);
  if (building) throw new PatchError(409, `Já existe um rebuild em andamento (${building.ilha}).`);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(npm, ['run', script], { cwd: REACT_DIR, shell: false, env: process.env });
  const lines = [], inicio = Date.now();
  building = { ilha, script, child };
  const onData = d => { for (const l of String(d).split(/\r?\n/)) if (l.trim()) { lines.push(l); if (lines.length > 400) lines.shift(); broadcast('rebuild', { ilha, linha: l }); } };
  child.stdout.on('data', onData); child.stderr.on('data', onData);
  const timer = setTimeout(() => { lines.push('[vfdev] timeout de 180 s — processo encerrado'); child.kill('SIGTERM'); }, 180000);
  const fim = (codigo, erro) => {
    if (!building || building.child !== child) return;
    clearTimeout(timer); building = null;
    if (erro) lines.push('[vfdev] ' + erro);
    broadcast('rebuild-fim', { ilha, script, ok: codigo === 0 && !erro, codigo, ultimas: lines.slice(-30), ms: Date.now() - inicio });
  };
  child.on('error', e => fim(null, `não rodou "${npm} run ${script}": ${e.message}`));
  child.on('close', c => fim(c));
  return { ilha, script, iniciado: true };
}

/* ---------------- git status (sem shell) ---------------- */
function gitStatus(files) {
  return new Promise(resolve => {
    const p = spawn('git', ['status', '--porcelain', '--', ...files], { cwd: REPO, shell: false });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    p.on('error', e => resolve({ erro: e.message }));
    p.on('close', c => resolve(c === 0 ? { out } : { erro: err.trim() || `git saiu com ${c}` }));
  });
}

function readBody(req, limit = 2e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new PatchError(413, 'Corpo grande demais.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function checkAuth(req) {
  const origin = req.headers.origin;
  const okOrigins = [`http://${HOST}:${PORT}`, `http://localhost:${PORT}`];
  if (origin && !okOrigins.includes(origin)) throw new PatchError(403, `Origem recusada: ${origin}`);
  if (req.headers['x-vfdev-token'] !== TOKEN) throw new PatchError(403, 'Token do VF DevTools inválido — recarregue a página.');
}
async function jsonBody(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { throw new PatchError(400, 'JSON inválido.'); }
}

async function handleVfdev(req, res, url) {
  const p = url.pathname;

  if (p === '/__vfdev/client.js') {
    return send(res, 200, fs.readFileSync(CLIENT, 'utf8'), MIME['.js']);
  }

  if (p === '/__vfdev/config') {
    return json(res, 200, {
      protectedFiles: CFG.protectedFiles, globalFiles: CFG.globalFiles, builtDirs: CFG.builtDirs,
      viteSources: CFG.viteSources, tokens: CFG.tokens, tokensFile: CFG.tokensFile, minFontPx: CFG.minFontPx || 11,
      estrutura: { acoes: ACOES, comRelacao: ACOES_COM_RELACAO, criterios: CRITERIOS },
      ilhas: CFG.ilhas || {}, ilhasSemScript: CFG.ilhasSemScript || {}, reactWritableDir: CFG.reactWritableDir
    });
  }

  if (p === '/__vfdev/events') {
    if (url.searchParams.get('t') !== TOKEN) throw new PatchError(403, 'Token do VF DevTools inválido — recarregue a página.');
    ensureWatch();
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(`event: pronto\ndata: ${JSON.stringify({ building: building ? building.ilha : null })}\n\n`);
    sseClients.add(res);
    const ka = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => { clearInterval(ka); sseClients.delete(res); });
    return;
  }

  if (p === '/__vfdev/origem' && req.method === 'GET') {
    checkAuth(req);
    const classes = String(url.searchParams.get('classes') || '').split(',').filter(Boolean).slice(0, 20);
    return json(res, 200, buscarOrigem({ classes, texto: url.searchParams.get('texto') || '', reactSrc: path.join(REACT_DIR, 'src'), portalDir: PORTAL, repo: REPO }));
  }

  if (p === '/__vfdev/rebuild' && req.method === 'POST') {
    checkAuth(req);
    const body = await jsonBody(req);
    return json(res, 202, rebuild(String(body.ilha || '')));
  }

  if (p === '/__vfdev/historico' && req.method === 'GET') {
    checkAuth(req);
    return json(res, 200, { gravacoes: historyAll().reverse().slice(0, 40).map(h => ({ id: h.id, em: h.em, arquivos: h.arquivos.map(a => a.file), desfeitoEm: h.desfeitoEm || null })) });
  }

  let hm = p.match(/^\/__vfdev\/historico\/([\w-]+)\/desfazer$/);
  if (hm && req.method === 'POST') {
    checkAuth(req);
    const h = historyAll().find(x => x.id === hm[1]);
    if (!h) throw new PatchError(404, `Gravação "${hm[1]}" não está no histórico.`);
    if (h.desfeitoEm) throw new PatchError(409, `Esta gravação já foi desfeita em ${h.desfeitoEm}.`);
    const plan = h.arquivos.map(a => {
      const w = resolveWritable(a.file);
      if (!w.cls.writable) throw new PatchError(403, `${w.rel}: ${w.cls.reason}`);
      const cur = fs.existsSync(w.abs) ? fs.readFileSync(w.abs, 'utf8') : null;
      if (cur !== a.depois) throw new PatchError(409, `${a.file} mudou depois da gravação — desfazer recusado, nada foi alterado.`);
      return { ...w, antes: a.antes, depois: a.depois, file: a.file };
    });
    for (const f of plan) {
      if (fs.readFileSync(f.abs, 'utf8') !== f.depois) throw new PatchError(409, `${f.file} mudou durante o desfazer.`);
      const tmp = f.abs + '.vfdev-tmp';
      fs.writeFileSync(tmp, f.antes, 'utf8'); fs.renameSync(tmp, f.abs);
    }
    const em = new Date().toISOString();
    historyAppend({ desfeito: h.id, em });
    return json(res, 200, { ok: true, id: h.id, desfeitoEm: em, arquivos: plan.map(f => f.file) });
  }

  if (p === '/__vfdev/git' && req.method === 'GET') {
    checkAuth(req);
    const files = String(url.searchParams.get('files') || '').split(',').filter(Boolean).slice(0, 50);
    const list = files.map(f => { const w = resolveWritable(f); return { file: f, abs: w.abs, repo: relTool(w.abs) }; });
    if (!list.length) return json(res, 200, { arquivos: [] });
    const r = await gitStatus(list.map(x => x.repo));
    if (r.erro) return json(res, 200, { erro: `git status indisponível: ${r.erro}`, arquivos: list.map(x => ({ file: x.file, repo: x.repo, status: null })) });
    const st = new Map();
    for (const line of r.out.split('\n')) { if (!line.trim()) continue; st.set(line.slice(3).trim().replace(/^"|"$/g, ''), line.slice(0, 2)); }
    return json(res, 200, { arquivos: list.map(x => ({ file: x.file, repo: x.repo, status: st.get(x.repo) || '' })) });
  }

  if (p === '/__vfdev/sessoes' && req.method === 'GET') {
    checkAuth(req);
    return json(res, 200, { sessoes: SESSOES.list(url.searchParams.get('pagina') || null) });
  }

  let m = p.match(/^\/__vfdev\/sessoes\/([^/]+)(\/duplicar)?$/);
  if (m) {
    checkAuth(req);
    const id = decodeURIComponent(m[1]);
    if (m[2]) {
      if (req.method !== 'POST') throw new PatchError(405, 'Use POST para duplicar.');
      return json(res, 201, SESSOES.duplicate(id));
    }
    if (req.method === 'GET') return json(res, 200, SESSOES.get(id));
    if (req.method === 'DELETE') { SESSOES.delete(id); return json(res, 200, { ok: true, id }); }
    if (req.method === 'PUT') {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) { throw new PatchError(400, 'JSON inválido.'); }
      return json(res, 200, SESSOES.put(id, body));
    }
    throw new PatchError(405, `Método ${req.method} não aceito em ${p}.`);
  }

  if (p === '/__vfdev/index') {
    const rel = url.searchParams.get('file');
    const abs = portalPath(rel);
    if (!abs || !abs.endsWith('.css')) return json(res, 400, { error: 'Arquivo CSS inválido.' });
    if (!fs.existsSync(abs)) return json(res, 404, { error: `Não existe: ${rel}` });
    const r = relOf(abs), cls = classify(r), rules = indexCss(fs.readFileSync(abs, 'utf8'));
    if (cls.kind === 'built' && cls.sources.length) {
      const srcs = [], faltando = [];
      for (const f of cls.sources) { const a = path.resolve(REPO, f); if (fs.existsSync(a)) srcs.push({ file: f, rules: indexCss(fs.readFileSync(a, 'utf8')) }); else faltando.push(f); }
      const falta = faltando.length ? ` · fonte ausente no disco: ${faltando.join(', ')}` : '';
      pairBundle(rules, srcs).forEach((pr, i) => {
        if (!pr.src) { rules[i].srcMotivo = pr.motivo + falta; return; }
        const w = path.resolve(REPO, pr.src.file).startsWith(REACT_W + path.sep);
        rules[i].src = { file: pr.src.file, line: pr.src.line, column: pr.src.column, selector: pr.src.selector, cond: pr.src.cond, decls: pr.src.decls, writable: w, porOrdem: !!pr.porOrdem };
        if (!w) rules[i].srcMotivo = `fonte em ${pr.src.file}:${pr.src.line}, fora de ${CFG.reactWritableDir} — a ferramenta não grava lá (vai para a missão)`;
      });
      cls.pareadas = rules.filter(x => x.src && x.src.writable).length;
    }
    return json(res, 200, { file: r, ...cls, rules });
  }

  m = p.match(/^\/__vfdev\/missoes\/([^/]+?)(\.md)?(\/rascunho)?$/);
  if (m) {
    checkAuth(req);
    const id = decodeURIComponent(m[1]);
    if (m[2]) {
      const f = path.join(MISSOES, (ID_RE.test(id) ? id : '_') + '.md');
      if (!ID_RE.test(id) || req.method !== 'GET') throw new PatchError(400, 'Use GET /__vfdev/missoes/<id>.md');
      if (!fs.existsSync(f)) throw new PatchError(404, `A missão da sessão "${id}" ainda não foi gerada.`);
      return send(res, 200, fs.readFileSync(f, 'utf8'), 'text/markdown; charset=utf-8');
    }
    if (!ID_RE.test(id)) throw new PatchError(400, `id de sessão inválido: "${id}".`);
    const mdFile = path.join(MISSOES, id + '.md'), jsonFile = path.join(MISSOES, id + '.json');
    if (m[3]) {
      if (req.method !== 'GET') throw new PatchError(405, 'Use GET para o rascunho.');
      const ses = SESSOES.get(id);
      return json(res, 200, { objetivo: rascunhoObjetivo(ses), intencao: rascunhoIntencao(ses) });
    }
    if (req.method === 'GET') {
      if (!fs.existsSync(jsonFile)) throw new PatchError(404, `A missão da sessão "${id}" ainda não foi gerada.`);
      return json(res, 200, JSON.parse(fs.readFileSync(jsonFile, 'utf8')));
    }
    if (req.method !== 'POST') throw new PatchError(405, `Método ${req.method} não aceito em ${p}.`);
    let body = {};
    try { const raw = await readBody(req); body = raw ? JSON.parse(raw) : {}; } catch (e) { throw new PatchError(400, 'JSON inválido.'); }
    const ses = SESSOES.get(id);
    if (typeof body.objetivo === 'string') ses.objetivo = body.objetivo.trim();
    if (!ses.objetivo || !ses.objetivo.trim()) throw new PatchError(400, 'Defina o Objetivo em 1 frase antes de gerar a missão.');
    if (ses.status === 'descartada') throw new PatchError(409, 'Sessão descartada — continue ou duplique antes de gerar a missão.');
    const { md, json: mj } = gerarMissao(ses, { protectedFiles: CFG.protectedFiles });
    mj.geradaEm = new Date().toISOString();
    fs.mkdirSync(MISSOES, { recursive: true });
    fs.writeFileSync(mdFile, md, 'utf8');
    fs.writeFileSync(jsonFile, JSON.stringify(mj, null, 2) + '\n', 'utf8');
    ses.status = 'missao_gerada';
    ses.missao = { geradaEm: mj.geradaEm, md: relTool(mdFile), json: relTool(jsonFile), verificacoes: mj.verificacoes.length };
    ses.verificacao = null;
    const saved = SESSOES.put(id, ses);
    return json(res, 200, { md, missao: mj, sessao: saved, arquivos: [relTool(mdFile), relTool(jsonFile)] });
  }

  if (p === '/__vfdev/patch' && req.method === 'POST') {
    checkAuth(req);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (e) { throw new PatchError(400, 'JSON inválido.'); }
    const files = Array.isArray(body.files) ? body.files : [];
    if (!files.length) throw new PatchError(400, 'Nenhum arquivo no patch.');
    // 1) valida e calcula TUDO antes de gravar qualquer arquivo
    const plan = files.map(f => {
      const { abs, rel, cls } = resolveWritable(f.file);
      if (!cls.writable) throw new PatchError(403, `${rel}: ${cls.reason}`);
      if (!fs.existsSync(abs)) throw new PatchError(404, `Não existe: ${rel}`);
      const original = fs.readFileSync(abs, 'utf8');
      const { text, changes } = applyPatches(original, f.patches || []);
      return { abs, rel, original, text, changes };
    });
    // 2) grava (ou só devolve o diff, em dryRun)
    let historico = null;
    if (!body.dryRun) {
      const escritos = [];
      for (const f of plan) {
        const current = fs.readFileSync(f.abs, 'utf8');
        if (current !== f.original) throw new PatchError(409, `${f.rel} mudou durante a gravação — nada foi salvo nele. Recarregue.`);
        const tmp = f.abs + '.vfdev-tmp';
        fs.writeFileSync(tmp, f.text, 'utf8');
        fs.renameSync(tmp, f.abs);
        escritos.push({ file: f.rel, antes: f.original, depois: f.text });
      }
      historico = 'g' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
      historyAppend({ id: historico, em: new Date().toISOString(), arquivos: escritos });
    }
    return json(res, 200, {
      dryRun: !!body.dryRun, historico,
      results: plan.map(f => ({ file: f.rel, written: !body.dryRun, changes: f.changes }))
    });
  }

  return json(res, 404, { error: `Rota desconhecida: ${p}` });
}

function injectClient(html) {
  const tag = `<script src="/__vfdev/client.js?t=${TOKEN}" defer data-vfdev></script>`;
  const i = html.toLowerCase().lastIndexOf('</body>');
  return i >= 0 ? html.slice(0, i) + tag + '\n' + html.slice(i) : html + '\n' + tag;
}

function serveStatic(req, res, url) {
  let abs = portalPath(decodeURIComponent(url.pathname));
  if (!abs) { send(res, 403, 'Fora do Portal.'); return true; }
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) abs = path.join(abs, 'index.html');
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return false;
  const ext = path.extname(abs).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  if (ext === '.html') {
    const html = fs.readFileSync(abs, 'utf8');
    send(res, 200, url.searchParams.get('vfdev') === 'off' ? html : injectClient(html), type);
    return true;
  }
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(abs).pipe(res);
  return true;
}

function proxy(req, res) {
  const target = new URL(req.url, BACKEND);
  const lib = target.protocol === 'https:' ? https : http;
  const headers = { ...req.headers, host: target.host };
  delete headers.origin;
  const pr = lib.request(target, { method: req.method, headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  pr.on('error', e => send(res, 502, `Backend indisponível em ${BACKEND}: ${e.message}`));
  req.pipe(pr);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);
  try {
    if (url.pathname.startsWith('/__vfdev/')) return await handleVfdev(req, res, url);
    if ((req.method === 'GET' || req.method === 'HEAD') && serveStatic(req, res, url)) return;
    if (BACKEND) return proxy(req, res);
    send(res, 404, `Não encontrado: ${url.pathname}`);
  } catch (e) {
    const status = e instanceof PatchError ? e.status : 500;
    if (status === 500) console.error('[vfdev]', e);
    json(res, status, { error: e.message });
  }
});

if (require.main === module) {
  if (!fs.existsSync(PORTAL)) { console.error(`[vfdev] Pasta do Portal não encontrada: ${PORTAL}`); process.exit(1); }
  server.listen(PORT, HOST, () => {
    console.log(`\n  VF Visual DevTools rodando`);
    console.log(`  Portal:  ${PORTAL}`);
    console.log(`  Abra:    http://${HOST}:${PORT}/index.html  (faça login uma vez)`);
    console.log(`  Depois:  http://${HOST}:${PORT}/fechamentos-api.html`);
    console.log(`  Backend: ${BACKEND ? `proxy para ${BACKEND}` : 'sem proxy (o Portal chama a API pela URL configurada)'}`);
    console.log(`  Atalho no navegador: Alt+Shift+V abre/fecha a ferramenta\n`);
  });
}

module.exports = { server, classify, portalPath, TOKEN, PORT, HOST, SESSOES, closeWatchers: () => { for (const w of watchers) w.close(); watchers.length = 0; watching = false; for (const r of sseClients) r.end(); sseClients.clear(); } };
