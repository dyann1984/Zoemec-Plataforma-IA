/* Prueba de la logica de auto-vinculacion de APUs legacy sin projectId
   (Fase 8 Parte 2, cierre del gap "APU sin projectId", seccion 11 del
   spec): `autoLinkOrphans` (src/hooks/useAuthoritativeApus.js) NUNCA
   adivina un proyecto -- solo vincula automaticamente cuando hay
   EXACTAMENTE un proyecto real del usuario; con 0 o mas de 1, marca
   `projectLinkRequired:true` en memoria para que la UI (main.jsx) ofrezca
   vincular manualmente.

   No existe infraestructura de pruebas de hooks de React en este repo
   (ver limitaciones documentadas en fases previas) -- por eso esta prueba
   llama a `autoLinkOrphans` directamente como funcion pura (recibe/regresa
   arreglos planos, no toca useState/useEffect), mockeando `global.fetch`
   con las MISMAS formas de respuesta reales de /api/projects y
   /api/apus?action=link-project ya probadas por separado en
   test/projectsApi.test.mjs y test/apusApi.test.mjs. */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { autoLinkOrphans } from '../src/hooks/useAuthoritativeApus.js';

let responses, linkCalls;
const originalFetch = global.fetch;
before(() => {
  global.fetch = async (url, opts) => {
    const u = new URL(String(url), 'http://localhost');
    const key = u.pathname + (u.search || '');
    if(opts?.method === 'POST' && key === '/api/apus'){
      const body = JSON.parse(opts.body);
      if(body.action === 'link-project'){
        linkCalls.push(body);
        return { ok: true, status: 200, json: async () => ({ apu: { id: body.id, projectId: body.projectId } }), text: async () => '{}' };
      }
    }
    const found = Object.entries(responses).find(([pattern]) => key.startsWith(pattern));
    const body = found ? found[1] : { error: 'not mocked: ' + key };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
});
after(() => { global.fetch = originalFetch; });
beforeEach(() => { linkCalls = []; responses = {}; });

test('con exactamente UN proyecto: vincula automaticamente los APUs huerfanos, nunca los ambiguos', async () => {
  responses['/api/projects'] = { projects: [{ id: 'PRO-UNICO', name: 'Unico proyecto' }] };
  const apus = [
    { id: 'APU-1', projectId: null },
    { id: 'APU-2', projectId: 'PRO-OTRO' }
  ];
  const result = await autoLinkOrphans(apus);
  assert.equal(linkCalls.length, 1);
  assert.deepEqual(linkCalls[0], { action: 'link-project', id: 'APU-1', projectId: 'PRO-UNICO' });
  assert.equal(result.find(a => a.id === 'APU-1').projectId, 'PRO-UNICO');
  assert.equal(result.find(a => a.id === 'APU-1').projectLinkRequired, undefined);
  assert.equal(result.find(a => a.id === 'APU-2').projectId, 'PRO-OTRO'); // no tocado, ya tenia proyecto
});

test('con CERO proyectos: nunca adivina, marca projectLinkRequired en memoria', async () => {
  responses['/api/projects'] = { projects: [] };
  const apus = [{ id: 'APU-1', projectId: null }];
  const result = await autoLinkOrphans(apus);
  assert.equal(linkCalls.length, 0);
  assert.equal(result[0].projectLinkRequired, true);
  assert.equal(result[0].projectId, null);
});

test('con MAS DE UN proyecto (ambiguo): nunca adivina, marca projectLinkRequired en memoria', async () => {
  responses['/api/projects'] = { projects: [{ id: 'PRO-A', name: 'A' }, { id: 'PRO-B', name: 'B' }] };
  const apus = [{ id: 'APU-1', projectId: null }];
  const result = await autoLinkOrphans(apus);
  assert.equal(linkCalls.length, 0);
  assert.equal(result[0].projectLinkRequired, true);
});

test('sin APUs huerfanos: no consulta /api/projects ni vincula nada', async () => {
  let calledProjects = false;
  const originalHandler = global.fetch;
  global.fetch = async (url, opts) => {
    if(String(url).includes('/api/projects')) calledProjects = true;
    return originalHandler(url, opts);
  };
  const apus = [{ id: 'APU-1', projectId: 'PRO-YA' }];
  const result = await autoLinkOrphans(apus);
  assert.equal(calledProjects, false);
  assert.deepEqual(result, apus);
});

test('fallo de red al vincular cae a projectLinkRequired, nunca bloquea el resto del bootstrap', async () => {
  responses['/api/projects'] = { projects: [{ id: 'PRO-UNICO', name: 'Unico proyecto' }] };
  global.fetch = async (url, opts) => {
    const u = new URL(String(url), 'http://localhost');
    if(opts?.method === 'POST' && u.pathname === '/api/apus') throw new Error('network down');
    const key = u.pathname + (u.search || '');
    const found = Object.entries(responses).find(([pattern]) => key.startsWith(pattern));
    return { ok: true, status: 200, json: async () => (found ? found[1] : {}), text: async () => '{}' };
  };
  const apus = [{ id: 'APU-1', projectId: null }];
  const result = await autoLinkOrphans(apus);
  assert.equal(result[0].projectLinkRequired, true);
});
