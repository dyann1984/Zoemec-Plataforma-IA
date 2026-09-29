import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createNebiusDemo } from '../src/domain/nebiusDemo.js';
import { buildEngineeringContext } from '../server/api-lib/_engineeringContext.mjs';
const { chromium } = await import(process.env.ZOEMEC_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.ZOEMEC_PLAYWRIGHT_MODULE).href : 'playwright');
const server = await createServer({ configFile: false, plugins: [react()], server: { host: '127.0.0.1', port: 5201, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ headless: true, channel: process.env.ZOEMEC_BROWSER_CHANNEL || 'msedge' });
const page = await browser.newPage();
let mode = 'not-configured'; let lastBody; let delayedResolve;
const fixture = createNebiusDemo();
const built = buildEngineeringContext({ ...fixture, identity: { uid: fixture.project.ownerUid, organizationId: fixture.project.organizationId, memberStatus: 'active' } });
const sample = { requestId: 'UI-MOCK', timestamp: '2026-09-29', project: built.context.project, indicators: built.indicators, missingData: built.context.missingData,
  answer: { provider: 'Nebius (MOCK DE PRUEBA)', model: 'MOCK', summary: { text: 'La evidencia requiere revisión.', evidenceRefs: ['E1'] }, confidence: 'low', facts: ['E1'],
    inferences: [], risks: [], recommendedActions: [{ text: 'Verificar la fuente.', evidenceRefs: ['E1'] }], evidenceRefs: built.context.refs.slice(0, 6), missingData: [] } };
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.hostname !== '127.0.0.1') return route.abort();
  if (url.pathname !== '/api/engineering-ai') return route.continue();
  if (route.request().method() === 'GET') return route.fulfill({ json: { configured: mode !== 'not-configured', status: mode === 'not-configured' ? 'Nebius no configurado' : 'Configurado (MOCK)' } });
  lastBody = route.request().postDataJSON();
  if (mode === 'error') return route.fulfill({ status: 502, json: { error: 'La respuesta no superó la validación de evidencia.', code: 'INVALID_MODEL_OUTPUT' } });
  if (mode === 'insufficient') return route.fulfill({ status: 422, json: { error: 'ZOEMEC no dispone de evidencia suficiente para responder con confianza.' } });
  if (mode === 'delayed') await new Promise(resolve => { delayedResolve = resolve; });
  return route.fulfill({ json: sample });
});
try {
  await mkdir('.tmp/nebius-ui', { recursive: true });
  await page.goto('http://127.0.0.1:5201/test/qa/nebius/index.html');
  await page.getByText('Nebius no configurado', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Consultar con evidencia' }).isDisabled(), true);
  mode = 'success'; await page.reload();
  await page.getByText('Configurado (MOCK)', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Explicar Confidence' }).click();
  await page.getByRole('heading', { name: 'Conclusión', exact: true }).waitFor();
  assert.equal(lastBody.projectId, fixture.project.id);
  for (const heading of ['Evidencia', 'Riesgos', 'Acciones recomendadas', 'Limitaciones / datos faltantes']) assert.equal(await page.getByRole('heading', { name: heading, exact: true }).count(), 1);
  await page.getByText('E1 · project.name', { exact: true }).click();
  await page.getByText('Escenario determinístico de materiales', { exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByLabel('Descripción exacta del recurso', { exact: false }).fill('Acero de refuerzo');
  await page.getByLabel('Pregunta sobre este proyecto').fill('¿Qué ocurre si el acero aumenta?');
  await page.getByRole('button', { name: 'Consultar con evidencia' }).click();
  await page.getByRole('heading', { name: 'Conclusión', exact: true }).waitFor();
  assert.equal(lastBody.scenario.value, 8);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No overflow ${width}`);
    await page.screenshot({ path: `.tmp/nebius-ui/copilot-${width}.png`, fullPage: true });
  }
  mode = 'error'; await page.getByRole('button', { name: 'Analizar Bid Risk' }).click();
  await page.getByRole('alert').waitFor(); assert.match(await page.getByRole('alert').textContent(), /validación/);
  mode = 'insufficient'; await page.getByRole('button', { name: 'Analizar Bid Risk' }).click();
  await page.getByText(/ZOEMEC no dispone de evidencia suficiente/).waitFor();
  mode = 'delayed'; await page.getByRole('button', { name: 'Explicar Confidence' }).click();
  await page.getByText('Consultando datos autorizados y esperando la explicación de Nebius…').waitFor();
  await page.getByRole('button', { name: 'Cambiar proyecto de prueba' }).click();
  delayedResolve();
  await page.getByText('Otro proyecto', { exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Conclusión', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS UI: configuration, suggested/free question, evidence, scenario, recoverable error, insufficient data, loading, project switch, desktop/mobile 1440/390/320, no page errors. Provider mocked.');
} finally { await browser.close(); await server.close(); }
