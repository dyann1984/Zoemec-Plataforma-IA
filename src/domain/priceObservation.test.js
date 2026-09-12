import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isEligibleForObservation, deriveObservationSource, buildPriceObservation,
  computeObservationHash, assertObservationSafe, PRICE_OBSERVATION_SOURCE, fold, isoWeekBucket,
} from './priceObservation.js';
import { APU_DATA_STATE } from './apuSchema.js';
import { PRICE_STATUS } from './priceStatus.js';

test('isEligibleForObservation: VERIFIED_MARKET siempre califica', () => {
  assert.equal(isEligibleForObservation({ priceStatus: PRICE_STATUS.VERIFIED_MARKET }), true);
});

test('isEligibleForObservation: fuente.estado VERIFICADO/IMPORTADO califica', () => {
  assert.equal(isEligibleForObservation({ fuente: { estado: APU_DATA_STATE.VERIFICADO } }), true);
  assert.equal(isEligibleForObservation({ fuente: { estado: APU_DATA_STATE.IMPORTADO } }), true);
});

test('isEligibleForObservation: ESTIMADO_IA/ASUMIDO/REQUIERE_VALIDACION NUNCA califican (regla central: no entrenar con cualquier dato)', () => {
  assert.equal(isEligibleForObservation({ fuente: { estado: APU_DATA_STATE.ESTIMADO_IA } }), false);
  assert.equal(isEligibleForObservation({ fuente: { estado: APU_DATA_STATE.ASUMIDO } }), false);
  assert.equal(isEligibleForObservation({ fuente: { estado: APU_DATA_STATE.REQUIERE_VALIDACION } }), false);
  assert.equal(isEligibleForObservation({ priceStatus: PRICE_STATUS.AI_ESTIMATE_UNVERIFIED }), false);
  assert.equal(isEligibleForObservation(null), false);
  assert.equal(isEligibleForObservation({}), false);
});

test('deriveObservationSource: catalogo importado', () => {
  assert.equal(deriveObservationSource({ fuente: { estado: APU_DATA_STATE.IMPORTADO } }), PRICE_OBSERVATION_SOURCE.CATALOG_IMPORT);
});

test('deriveObservationSource: verificado con proveedor real -> cotizacion verificada', () => {
  assert.equal(deriveObservationSource({ fuente: { estado: APU_DATA_STATE.VERIFICADO, proveedor: 'Ferreteria X' } }), PRICE_OBSERVATION_SOURCE.VERIFIED_QUOTE);
});

test('deriveObservationSource: precio de mercado verificado con referencia seleccionada -> price_intelligence_web', () => {
  assert.equal(
    deriveObservationSource({ priceStatus: PRICE_STATUS.VERIFIED_MARKET, priceRecord: { selectedReference: { precioNormalizado: 100 } } }),
    PRICE_OBSERVATION_SOURCE.PRICE_INTELLIGENCE_WEB
  );
});

test('deriveObservationSource: por defecto, captura manual del usuario', () => {
  assert.equal(deriveObservationSource({ fuente: { estado: APU_DATA_STATE.VERIFICADO } }), PRICE_OBSERVATION_SOURCE.USER_INPUT);
});

test('buildPriceObservation: construye los 13 campos pedidos a partir de un renglon real', () => {
  const row = {
    descripcion: '  Cemento Gris CPC 30R  ', unidad: 'Saco', precioUnitario: 245.5,
    fuente: { estado: APU_DATA_STATE.VERIFICADO, proveedor: 'Distribuidora ABC', fecha: '2026-01-15' },
    priceConfidence: 'HIGH',
  };
  const obs = buildPriceObservation({
    row, kind: 'materials', priceField: 'precioUnitario', organizationId: 'org-1',
    location: { country: 'MX', state: 'Jalisco', city: 'Guadalajara' }, currency: 'mxn',
    apuId: 'APU-1', projectId: 'PRO-1', now: () => '2026-01-20T00:00:00.000Z',
  });
  assert.equal(obs.conceptoNormalizado, 'cemento gris cpc 30r');
  assert.equal(obs.unidadNormalizada, 'saco');
  assert.equal(obs.moneda, 'MXN');
  assert.equal(obs.country, 'MX');
  assert.equal(obs.state, 'Jalisco');
  assert.equal(obs.city, 'Guadalajara');
  assert.equal(obs.fecha, '2026-01-15');
  assert.equal(obs.fuente, PRICE_OBSERVATION_SOURCE.VERIFIED_QUOTE);
  assert.equal(obs.proveedor, 'Distribuidora ABC');
  assert.equal(obs.organizationId, 'org-1');
  assert.equal(obs.tipoDato, 'materials');
  assert.equal(obs.nivelValidacion, APU_DATA_STATE.VERIFICADO);
  assert.equal(obs.confianza, 'HIGH');
  assert.equal(obs.precio, 245.5);
  assert.equal(obs.apuId, 'APU-1');
  assert.equal(obs.projectId, 'PRO-1');
});

test('buildPriceObservation: precio $0 o invalido nunca produce una observacion', () => {
  const row = { descripcion: 'x', unidad: 'pza', precioUnitario: 0, fuente: { estado: APU_DATA_STATE.VERIFICADO } };
  const obs = buildPriceObservation({ row, kind: 'materials', priceField: 'precioUnitario', organizationId: 'org-1' });
  assert.equal(obs, null);
});

test('buildPriceObservation: exige organizationId (nunca anonimo en este nivel)', () => {
  assert.throws(() => buildPriceObservation({ row: { precioUnitario: 10 }, kind: 'materials', priceField: 'precioUnitario' }));
});

test('assertObservationSafe: revienta si se cuela un campo de identidad personal', () => {
  assert.throws(() => assertObservationSafe({ organizationId: 'org-1', userEmail: 'x@x.com' }), /userEmail/);
});

test('assertObservationSafe: una observacion limpia no lanza', () => {
  assert.doesNotThrow(() => assertObservationSafe({ organizationId: 'org-1', precio: 100 }));
});

test('computeObservationHash: el mismo renglon guardado dos veces en la misma semana produce el MISMO hash (deduplicacion real)', async () => {
  const base = {
    organizationId: 'org-1', conceptoNormalizado: 'cemento gris', unidadNormalizada: 'saco',
    country: 'MX', state: 'Jalisco', city: 'Guadalajara', moneda: 'MXN', precio: 245.5,
    fecha: '2026-01-15T10:00:00.000Z',
  };
  const h1 = await computeObservationHash(base);
  const h2 = await computeObservationHash({ ...base, fecha: '2026-01-16T18:00:00.000Z', precio: 245.9 }); // misma semana ISO, precio redondea igual
  assert.equal(h1, h2);
});

test('computeObservationHash: otra organizacion produce un hash DISTINTO aunque todo lo demas coincida', async () => {
  const base = {
    organizationId: 'org-1', conceptoNormalizado: 'cemento gris', unidadNormalizada: 'saco',
    country: 'MX', state: 'Jalisco', city: 'Guadalajara', moneda: 'MXN', precio: 245.5, fecha: '2026-01-15',
  };
  const h1 = await computeObservationHash(base);
  const h2 = await computeObservationHash({ ...base, organizationId: 'org-2' });
  assert.notEqual(h1, h2);
});

test('computeObservationHash: otra semana produce un hash DISTINTO', async () => {
  const base = {
    organizationId: 'org-1', conceptoNormalizado: 'cemento gris', unidadNormalizada: 'saco',
    country: 'MX', state: 'Jalisco', city: 'Guadalajara', moneda: 'MXN', precio: 245.5, fecha: '2026-01-15',
  };
  const h1 = await computeObservationHash(base);
  const h2 = await computeObservationHash({ ...base, fecha: '2026-03-15' });
  assert.notEqual(h1, h2);
});

test('fold: normaliza mayusculas/acentos/espacios de sobra de forma consistente (escritura y lectura deben coincidir)', () => {
  assert.equal(fold('  Cemento   GRIS  '), 'cemento gris');
  assert.equal(fold('Saco'), fold('  saco  '));
});

test('isoWeekBucket: fechas de la misma semana ISO producen el mismo bucket', () => {
  assert.equal(isoWeekBucket('2026-01-15'), isoWeekBucket('2026-01-16'));
});
