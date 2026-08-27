import test from 'node:test';
import assert from 'node:assert/strict';
import { detectApplicableEpp, resolveEppRows } from './eppResolver.js';

test('detectApplicableEpp: EPP base (casco/botas/guantes) aplica a cualquier concepto, incluso sin ningun riesgo especifico detectado', () => {
  const { epp, risks } = detectApplicableEpp({ text: 'concepto generico sin riesgos particulares', tipo: 'generico' });
  assert.deepEqual(risks, []);
  assert.deepEqual(epp.map(e => e.clave).sort(), ['EPP-BOTAS', 'EPP-CASCO', 'EPP-GUANTES']);
});

test('detectApplicableEpp: una disciplina NUEVA (nunca vista, sin entrada propia en el resolver) hereda EPP por las mismas reglas de riesgo -- no requiere hardcodear cada disciplina', () => {
  const { epp, risks } = detectApplicableEpp({ text: 'instalacion de paneles solares con corte de perfil de aluminio', tipo: 'disciplina_inventada_para_esta_prueba' });
  assert.ok(risks.includes('corte_esmerilado'));
  assert.ok(epp.some(e => e.clave === 'EPP-LENTES'));
});

test('detectApplicableEpp: riesgo de altura (plafon/azotea/andamio) agrega arnes', () => {
  const { epp, risks } = detectApplicableEpp({ text: 'instalacion de plafon suspendido en azotea con andamio' });
  assert.ok(risks.includes('altura'));
  assert.ok(epp.some(e => e.clave === 'EPP-ARNES'));
});

test('detectApplicableEpp: riesgo electrico por tipo clasificado (sin la palabra "electrico" en el texto)', () => {
  const { epp, risks } = detectApplicableEpp({ text: 'suministro e instalacion de contacto duplex', tipo: 'electrico' });
  assert.ok(risks.includes('electrico'));
  assert.ok(epp.some(e => e.clave === 'EPP-GUANTES-DIEL'));
});

test('detectApplicableEpp: sin duplicados cuando dos reglas piden el mismo EPP', () => {
  const { epp } = detectApplicableEpp({ text: 'demolicion con rompedora, mucho polvo y ruido' });
  const claves = epp.map(e => e.clave);
  assert.equal(new Set(claves).size, claves.length);
});

test('resolveEppRows: con match real de catalogo, precio real y sin REQUIERE_VALIDACION', () => {
  const catalog = [
    { desc: 'Casco de seguridad dielectrico clase E', unidad: 'pza', precio: 185, tipo: 'epp', sinonimos: ['Casco de seguridad'] }
  ];
  const { rows } = resolveEppRows({ concept: 'concepto generico', tipo: 'generico', catalog, rendimientoDiario: 20, cuadrilla: 2 });
  const casco = rows.find(r => r.clave === 'EPP-CASCO' || r.descripcion === 'Casco de seguridad');
  assert.ok(casco);
  assert.equal(casco.precioUnitario, 185);
  assert.equal(casco.fuente.estado, 'IMPORTADO');
  assert.equal(casco.requiereValidacion, false);
  assert.equal(casco.cantidad, 2); // una por integrante de la cuadrilla
  assert.equal(casco.rendimientoDiario, 20);
});

test('resolveEppRows: SIN match de catalogo -- precio 0, REQUIERE_VALIDACION, nunca se fabrica un precio', () => {
  const { rows } = resolveEppRows({ concept: 'concepto generico', tipo: 'generico', catalog: [], rendimientoDiario: 20, cuadrilla: 1 });
  rows.forEach(r => {
    assert.equal(r.precioUnitario, 0);
    assert.equal(r.fuente.estado, 'REQUIERE_VALIDACION');
    assert.equal(r.requiereValidacion, true);
    assert.match(r.observaciones, /REQUIERE VALIDACIÓN/);
  });
});

test('resolveEppRows: con precio real pero SIN rendimiento diario -- tambien REQUIERE_VALIDACION (no se puede prorratear)', () => {
  const catalog = [{ desc: 'Casco de seguridad', unidad: 'pza', precio: 185, tipo: 'epp' }];
  const { rows } = resolveEppRows({ concept: 'x', tipo: 'generico', catalog, rendimientoDiario: 0, cuadrilla: 1 });
  const casco = rows.find(r => r.descripcion === 'Casco de seguridad');
  assert.equal(casco.requiereValidacion, true);
  assert.equal(casco.rendimientoDiario, 0);
});
