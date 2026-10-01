// Full application smoke against local demo emulators, no provider calls.
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Emulators required');
process.env.FIREBASE_PROJECT_ID = 'demo-zoemec-nebius';
process.env.VITE_FIREBASE_PROJECT_ID = 'demo-zoemec-nebius';
process.env.VITE_USE_FIREBASE_EMULATOR = 'true';
process.env.ZOEMEC_AI_PORT = '8788';
process.env.NEBIUS_API_KEY = '';
await import('../scripts/seed-nebius-demo.mjs');
const { createServer } = await import('vite');
const { chromium } = await import(process.env.ZOEMEC_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.ZOEMEC_PLAYWRIGHT_MODULE).href : 'playwright');
const api = spawn(process.execPath, ['server/openai-apu-server.mjs'], { env: process.env, stdio: 'ignore', windowsHide: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 5202, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ headless: true, channel: process.env.ZOEMEC_BROWSER_CHANNEL || 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort();
});
try {
  await mkdir('.tmp/nebius-ui', { recursive: true });
  await page.goto('http://127.0.0.1:5202');
  await page.getByRole('button', { name: /Iniciar sesi[oó]n/i }).first().click();
  await page.locator('input[type=email]').fill('ingeniero@nebius-demo.test');
  await page.locator('input[type=password]').fill('DemoLocal-2026!');
  await page.getByRole('button', { name: /Entrar|Iniciar sesi[oó]n|Acceder/i }).first().click();
  await page.getByRole('button', { name: /Proyectos y clientes/i }).first().click({ timeout: 20000 });
  await page.getByRole('heading', { name: 'Residencial Las Palmas - Edificio A', exact: true }).waitFor();
  await page.getByRole('button', { name: /Abrir proyecto/i }).first().click();
  await page.getByText('Analizar proyecto con IA · NVIDIA/Nebius', { exact: true }).click();
  await page.getByText('Nebius no configurado', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Analizar proyecto con IA', exact: true }).isDisabled(), true);
  await page.screenshot({ path: '.tmp/nebius-ui/full-project-demo.png', fullPage: true });
  await page.getByRole('button', { name: /Costos/ }).last().click();
  await page.getByRole('button', { name: /Abrir APU/i }).first().click();
  await page.getByText('ZOEMEC AI · Explicar este APU con evidencia', { exact: true }).click();
  await page.getByText('Nebius no configurado', { exact: true }).waitFor();
  await page.screenshot({ path: '.tmp/nebius-ui/full-apu-demo.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS full app: emulator login → demo project → project workspace → authenticated Nebius not configured state. No real provider call.');
} catch (error) {
  console.log((await page.locator('body').innerText()).slice(0, 7000));
  await page.screenshot({ path: '.tmp/nebius-ui/full-project-error.png', fullPage: true });
  throw error;
} finally { await browser.close(); await server.close(); api.kill(); }
