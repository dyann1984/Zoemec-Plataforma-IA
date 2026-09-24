/* Test estatico (analisis de codigo) que verifica que el motor server-side
   de generacion de APU NO tiene ninguna rama que dependa de rol/permisos
   para modificar el CATALOGO, PROMPT, MODELO o CALCULO tecnico.

   Regla del encargo (§4): "El backend debe aplicar autorizacion sobre
   ACCIONES y DATOS PERMITIDOS, no degradar el calculo tecnico sin
   explicarlo."

   Este test lee el codigo real (fs.readFileSync) de:
   - api/generate-apu.mjs
   - server/api-lib/_openaiApuCore.mjs
   - server/api-lib/_authGuard.mjs
   y verifica invariantes negativos (no debe haber X). Sirve como
   REGRESSION GUARD: si alguien meta una condicion basada en rol dentro
   de generateAPU/generateAPUv2 en el futuro, este test la caza. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

function readSource(rel){
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8');
}

test('SERVER: /api/generate-apu no lee role/permisos del body, solo del token verificado', () => {
  const src = readSource('api/generate-apu.mjs');
  // Prohibido leer role o admin del body directo -- solo `req.body?.schema` esta permitido
  assert.doesNotMatch(src, /req\.body\?.role/, 'no debe leer role del body');
  assert.doesNotMatch(src, /req\.body\?.isAdmin/, 'no debe leer isAdmin del body');
  assert.doesNotMatch(src, /req\.body\?.uid/, 'no debe leer uid del body para autorizar');
  // requireFeature es la unica fuente de autorizacion -- verifica el token real
  assert.match(src, /requireFeature\(req, 'apu'\)/);
});

test('SERVER: generateAPU/generateAPUv2 NO tienen if(admin)/if(role) que degraden calculo', () => {
  const src = readSource('server/api-lib/_openaiApuCore.mjs');
  // Debe NO contener condiciones que cambien el prompt/catalog/modelo por rol
  assert.doesNotMatch(src, /if\s*\(\s*(role|isAdmin|admin|collaborator|user)\s*===/, 'no debe ramificar por role literal');
  assert.doesNotMatch(src, /role\s*===\s*['"]admin['"]/, 'no debe checar role admin');
  assert.doesNotMatch(src, /authz\?.role/, 'generateAPU no debe recibir authz -- solo body limpio');
});

test('SERVER: _authGuard NO importa ni llama al motor de generacion (solo autoriza)', () => {
  const src = readSource('server/api-lib/_authGuard.mjs');
  // Debe existir la diferenciacion por plan/admin (correcta)
  assert.match(src, /isSuperAdminProfile/, 'admin se identifica por custom claim, no por body');
  // Verificar que NO importa el core del motor (permitido en comentarios)
  const importLines = src.split('\n').filter(l => /^\s*import\s/.test(l));
  const imports = importLines.join('\n');
  assert.doesNotMatch(imports, /_openaiApuCore/, 'authGuard no importa el motor de APU');
  assert.doesNotMatch(imports, /generateAPU/, 'authGuard no importa generateAPU');
  assert.doesNotMatch(imports, /materialPriceIntelligence/, 'authGuard no importa Price Intelligence');
  // Y en el codigo (excluyendo comentarios /* ... */), no debe LLAMAR a generateAPU
  const withoutBlockComments = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const withoutLineComments = withoutBlockComments.replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(withoutLineComments, /generateAPU\s*\(/, 'authGuard no llama a generateAPU()');
});

test('SERVER: la firma de generateAPU acepta solo {concept, catalog, preserveOriginal, mode}', () => {
  const src = readSource('server/api-lib/_openaiApuCore.mjs');
  // Verifica que el signature de generateAPU no acepta role/uid/permissions
  const match = src.match(/export async function generateAPU\(\{([^}]*)\}\)/);
  assert.ok(match, 'generateAPU debe existir');
  const params = match[1];
  assert.doesNotMatch(params, /role/);
  assert.doesNotMatch(params, /uid/);
  assert.doesNotMatch(params, /permissions/);
  assert.doesNotMatch(params, /admin/);
});

test('CLIENT: generateApuForConcepto envia el mismo body para cualquier rol', () => {
  const src = readSource('src/features/catalogo/generateApuForConcepto.js');
  const bodyMatch = src.match(/JSON\.stringify\(\{[^}]*\}\)/);
  assert.ok(bodyMatch, 'debe haber un body JSON');
  const body = bodyMatch[0];
  // Debe contener SOLO los campos tecnicos, nunca role/uid/isAdmin
  assert.doesNotMatch(body, /role/);
  assert.doesNotMatch(body, /isAdmin/);
  assert.doesNotMatch(body, /permissions/);
  assert.match(body, /concept/);
  assert.match(body, /catalog/);
});

test('FIX: el silent catch de enrichApuWithIntelligence2 ahora registra error trazable', () => {
  const src = readSource('src/features/catalogo/generateApuForConcepto.js');
  // El catch YA NO puede estar completamente vacio -- debe registrar
  // enrichmentError en el diagnostico. Regla 6 del encargo.
  const catchBlock = src.match(/catch\s*\([^)]*\)\{[\s\S]*?enrichmentError/);
  assert.ok(catchBlock, 'el catch debe capturar enrichmentError explicitamente, no ser silencioso');
  // Y debe importarse el modulo de diagnostico
  assert.match(src, /summarizeGenerationContext/);
});

/* P0 -- contexto empresarial server-side. Ninguna pieza que decide QUE datos
   ve el motor puede depender del rol (solo de membresia activa). */
function codeWithoutComments(src){
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}
test('P0: resolvedor de contexto, nucleo de generacion y resolucion pura NO ramifican por rol', () => {
  for(const rel of [
    'server/api-lib/_apuContextResolver.mjs',
    'server/api-lib/_apuGenerateCore.mjs',
    'src/domain/apuContextResolution.js'
  ]){
    const code = codeWithoutComments(readSource(rel));
    assert.doesNotMatch(code, /\.role\b/, `${rel} no debe leer .role`);
    assert.doesNotMatch(code, /isAdmin|super_admin|company_manager|collaborator|isOrgManagerRole/, `${rel} no debe decidir por rol`);
  }
});

test('P0: /api/generate-apu arma el catalogo en el servidor cuando hay projectId/contextMode', () => {
  const src = readSource('api/generate-apu.mjs');
  assert.match(src, /runApuGeneration\(/);
  assert.match(src, /loadOrgContext\(authz\.uid\)/, 'la organizacion sale del token verificado, nunca del body');
  assert.doesNotMatch(src, /req\.body\?\.organizationId|body\.organizationId/);
});

test('P0: los tres clientes de /api/generate-apu piden contexto empresarial', () => {
  const main = readSource('src/main.jsx');
  const calls = main.match(/\/api\/generate-apu'\),[\s\S]{0,800}?JSON\.stringify\(\{[^}]*\}\)/g) || [];
  assert.equal(calls.length, 2, 'editor individual y lote');
  calls.forEach(c => assert.match(c, /contextMode:'organization'/));
  assert.match(readSource('src/features/catalogo/generateApuForConcepto.js'), /contextMode: 'organization'/);
});

test('P0: ningun catch silencioso queda en el enriquecimiento de precios de los flujos de generacion', () => {
  const main = readSource('src/main.jsx');
  assert.doesNotMatch(main, /catch\{\s*\/\*\s*(Price Intelligence caida|si Price Intelligence falla)/);
});

test('P0: el derecho a IA de un miembro depende de la membresia, no del rol', () => {
  const src = codeWithoutComments(readSource('server/api-lib/_authGuard.mjs'));
  assert.match(src, /resolvePaidFeatureEntitlement\(/);
  assert.doesNotMatch(src, /isActiveTrialOrgMember/, 'el bypass ya no se limita al trial');
});

test('FIX: contextDiagnostics viaja en el APU guardado', () => {
  const src = readSource('src/features/catalogo/generateApuForConcepto.js');
  assert.match(src, /enrichedDraft\.contextDiagnostics\s*=\s*contextDiagnostics/, 'el APU guardado debe llevar el diagnostico');
});
