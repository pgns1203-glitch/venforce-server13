'use strict';
/*
 * Helpers dos testes de ponta a ponta: sobe o servidor do vfdev como processo filho (dá pra "reiniciar"
 * de verdade) sobre uma cópia descartável do fixture, e abre a página num Chromium via playwright-core
 * (dependência opcional). Sem playwright-core/navegador, os testes e2e são pulados com o motivo.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
let pw = null, pwMotivo = '';
try { pw = require('playwright-core'); } catch (e) { pwMotivo = 'playwright-core não instalado (dependência opcional)'; }

function tmpPortal(extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfdev-e2e-'));
  fs.cpSync(path.join(ROOT, 'test', 'fixture'), path.join(dir, 'Portal'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'sessoes'));
  fs.mkdirSync(path.join(dir, 'missoes'));
  if (extra) extra(dir);
  return dir;
}

/**
 * Repositório descartável completo: Portal/ (cópia do fixture) + frontend-react/ com a FONTE do bundle da ilha
 * Visão do fixture, um package.json com scripts de build simulados e, opcionalmente, cópias dos arquivos REAIS
 * da Cliente 360 V3 (bundle + fontes) — só leitura no repo de verdade.
 */
const REAL = path.resolve(ROOT, '..', '..');
function tmpRepo({ real = false } = {}) {
  const dir = tmpPortal();
  const fr = path.join(dir, 'frontend-react');
  fs.mkdirSync(path.join(fr, 'src', 'styles'), { recursive: true });
  fs.writeFileSync(path.join(fr, 'src', 'styles', 'visao.css'), '/* fonte da ilha Visão (fixture) */\n.vz-box {\n  padding: 18px;\n  border-radius: 8px;\n  background: #eeeeff;\n}\n\n.vz-title {\n  font-size: 13px;\n  margin: 0;\n}\n');
  fs.writeFileSync(path.join(fr, 'package.json'), JSON.stringify({ name: 'fr-fixture', private: true, scripts: { 'build:visao': 'node build.js', 'build:financeiro': 'node falha.js' } }, null, 2));
  // build simulado: gera um bundle com hash novo a partir da fonte, troca o <link> no .html e apaga o antigo
  fs.writeFileSync(path.join(fr, 'build.js'), `
const fs = require('fs'), path = require('path');
const P = path.join(__dirname, '..', 'Portal'), dir = path.join(P, 'assets', 'visao');
const src = fs.readFileSync(path.join(__dirname, 'src', 'styles', 'visao.css'), 'utf8');
const min = src.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '').replace(/\\s*([{};:,])\\s*/g, '$1').replace(/;}/g, '}').replace(/\\n/g, '').trim();
const hash = Date.now().toString(36).slice(-8);
for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
fs.writeFileSync(path.join(dir, 'visao-' + hash + '.css'), min);
const h = path.join(P, 'fechamentos-api.html');
fs.writeFileSync(h, fs.readFileSync(h, 'utf8').replace(/assets\\/visao\\/visao-[\\w-]+\\.css/, 'assets/visao/visao-' + hash + '.css'));
console.log('vite v6 building for production...');
console.log('✓ built visao-' + hash + '.css');
`);
  fs.writeFileSync(path.join(fr, 'falha.js'), 'for (let i = 1; i <= 40; i++) console.log("linha " + i);\nconsole.error("Erro: sintaxe inválida em src/styles/financeiro.css:12");\nprocess.exit(2);\n');
  if (real) {
    const b = path.join(dir, 'Portal', 'assets', 'cliente-360-v3');
    fs.mkdirSync(b, { recursive: true });
    for (const f of fs.readdirSync(path.join(REAL, 'Portal', 'assets', 'cliente-360-v3')).filter(f => f.endsWith('.css'))) fs.copyFileSync(path.join(REAL, 'Portal', 'assets', 'cliente-360-v3', f), path.join(b, f));
    for (const f of ['cliente360.css', 'cliente360V3.css']) fs.copyFileSync(path.join(REAL, 'frontend-react', 'src', 'styles', f), path.join(fr, 'src', 'styles', f));
  }
  return dir;
}

function startServer(dir, port, env = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      env: { ...process.env, VFDEV_PORTAL_DIR: path.join(dir, 'Portal'), VFDEV_SESSOES_DIR: path.join(dir, 'sessoes'), VFDEV_MISSOES_DIR: path.join(dir, 'missoes'), VFDEV_HISTORY_DIR: path.join(dir, 'history'), VFDEV_PORT: String(port), ...(fs.existsSync(path.join(dir, 'frontend-react')) ? { VFDEV_REPO_DIR: dir } : {}), ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    const t = setTimeout(() => { p.kill(); reject(new Error('servidor não subiu: ' + out)); }, 8000);
    p.stdout.on('data', d => { out += d; if (out.includes('rodando')) { clearTimeout(t); resolve({ proc: p, base: `http://127.0.0.1:${port}`, stop: () => new Promise(r => { p.once('exit', r); p.kill(); }) }); } });
    p.stderr.on('data', d => { out += d; });
    p.on('exit', c => { clearTimeout(t); if (!out.includes('rodando')) reject(new Error(`servidor saiu (${c}): ${out}`)); });
  });
}

let browserP = null;
async function browser() {
  if (!pw) return null;
  if (!browserP) browserP = pw.chromium.launch().catch(e => { pwMotivo = 'Chromium não abriu: ' + e.message.split('\n')[0]; return null; });
  return browserP;
}
async function skipMotivo() { const b = await browser(); return b ? false : pwMotivo; }

async function openPage(base, file, width = 1440, ctx) {
  const b = await browser();
  const context = ctx || await b.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  await page.route(u => !u.href.startsWith(base), r => r.abort());
  page.on('pageerror', e => { page.__errors = (page.__errors || []).concat(e.message); });
  await page.goto(`${base}/${file}`);
  await page.waitForFunction(() => window.__VFDEV__ && window.__VFDEV__.ready, null, { timeout: 8000 });
  return { context, page };
}
async function closeBrowser() { const b = browserP && await browserP; if (b) await b.close(); browserP = null; }

module.exports = { tmpPortal, tmpRepo, REAL, startServer, openPage, browser, skipMotivo, closeBrowser, ROOT };
