'use strict';
/*
 * VF Visual DevTools — servidor LOCAL de desenvolvimento.
 *  - Serve a pasta Portal/ como estática (igual ao que o navegador recebe em produção).
 *  - Injeta /__vfdev/client.js nas páginas .html (nada é gravado no HTML).
 *  - Expõe /__vfdev/index (CSS com linha:coluna) e /__vfdev/patch (grava patch mínimo).
 *  - Escuta só em 127.0.0.1. Não faz parte do deploy.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { indexCss, applyPatches, PatchError } = require('./cssIndex');
const { SessionStore, ACOES, ACOES_COM_RELACAO, CRITERIOS } = require('./sessao');

const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'vfdev.config.json'), 'utf8'));
const REPO = path.resolve(__dirname, '..', '..');
const PORTAL = path.resolve(process.env.VFDEV_PORTAL_DIR || path.join(REPO, CFG.portalDir || 'Portal'));
const PORT = Number(process.env.VFDEV_PORT) || CFG.port || 5190;
const HOST = '127.0.0.1';
const BACKEND = process.env.VFDEV_BACKEND || CFG.backend || null;
const TOKEN = crypto.randomBytes(16).toString('hex');
const CLIENT = path.join(__dirname, 'client', 'vf-devtools.js');
const SESSOES = new SessionStore(path.resolve(process.env.VFDEV_SESSOES_DIR || path.join(__dirname, 'sessoes')));

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

async function handleVfdev(req, res, url) {
  const p = url.pathname;

  if (p === '/__vfdev/client.js') {
    return send(res, 200, fs.readFileSync(CLIENT, 'utf8'), MIME['.js']);
  }

  if (p === '/__vfdev/config') {
    return json(res, 200, {
      protectedFiles: CFG.protectedFiles, globalFiles: CFG.globalFiles, builtDirs: CFG.builtDirs,
      viteSources: CFG.viteSources, tokens: CFG.tokens, tokensFile: CFG.tokensFile, minFontPx: CFG.minFontPx || 11,
      estrutura: { acoes: ACOES, comRelacao: ACOES_COM_RELACAO, criterios: CRITERIOS }
    });
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
    const r = relOf(abs);
    return json(res, 200, { file: r, ...classify(r), rules: indexCss(fs.readFileSync(abs, 'utf8')) });
  }

  if (p === '/__vfdev/patch' && req.method === 'POST') {
    checkAuth(req);
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (e) { throw new PatchError(400, 'JSON inválido.'); }
    const files = Array.isArray(body.files) ? body.files : [];
    if (!files.length) throw new PatchError(400, 'Nenhum arquivo no patch.');
    // 1) valida e calcula TUDO antes de gravar qualquer arquivo
    const plan = files.map(f => {
      const abs = portalPath(f.file);
      if (!abs || !abs.endsWith('.css')) throw new PatchError(400, `Só .css dentro de ${path.basename(PORTAL)}/: ${f.file}`);
      const rel = relOf(abs), cls = classify(rel);
      if (!cls.writable) throw new PatchError(403, `${rel}: ${cls.reason}`);
      if (!fs.existsSync(abs)) throw new PatchError(404, `Não existe: ${rel}`);
      const original = fs.readFileSync(abs, 'utf8');
      const { text, changes } = applyPatches(original, f.patches || []);
      return { abs, rel, original, text, changes };
    });
    // 2) grava (ou só devolve o diff, em dryRun)
    if (!body.dryRun) {
      for (const f of plan) {
        const current = fs.readFileSync(f.abs, 'utf8');
        if (current !== f.original) throw new PatchError(409, `${f.rel} mudou durante a gravação — nada foi salvo nele. Recarregue.`);
        const tmp = f.abs + '.vfdev-tmp';
        fs.writeFileSync(tmp, f.text, 'utf8');
        fs.renameSync(tmp, f.abs);
      }
    }
    return json(res, 200, {
      dryRun: !!body.dryRun,
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

module.exports = { server, classify, portalPath, TOKEN, PORT, HOST, SESSOES };
