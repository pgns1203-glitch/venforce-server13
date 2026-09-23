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

function startServer(dir, port, env = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      env: { ...process.env, VFDEV_PORTAL_DIR: path.join(dir, 'Portal'), VFDEV_SESSOES_DIR: path.join(dir, 'sessoes'), VFDEV_MISSOES_DIR: path.join(dir, 'missoes'), VFDEV_HISTORY_DIR: path.join(dir, 'history'), VFDEV_PORT: String(port), ...env },
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

module.exports = { tmpPortal, startServer, openPage, browser, skipMotivo, closeBrowser, ROOT };
