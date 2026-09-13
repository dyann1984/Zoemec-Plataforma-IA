import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildParameterTrace, PARAM_ORIGIN, PARAM_ORIGIN_LABEL_KEY, PARAM_ORIGIN_CSS_CLASS } from './parametricTraceability.js';
import { PARAMETRIC_ELEMENTS } from './parametricElements.js';
import { buildBaseAuxiliaries } from './auxiliaries.js';

const zapataAislada = PARAMETRIC_ELEMENTS.zapata_aislada;
const INPUTS = { largo: 1.2, ancho: 1.2, peralte: 0.4 };

function findByClave(trace, clave){ return trace.find(e => e.clave === clave); }

test('1. valor base sugerido NO modificado -> ZOEMEC_SUGGESTED, con valorBaseOriginal y modificadoPorUsuario=false', () => {
  const calcResult = zapataAislada.calculate(INPUTS, {});
  const trace = buildParameterTrace({ elementDef: zapataAislada, inputs: INPUTS, params: {}, calcResult, auxiliaries: buildBaseAuxiliaries() });
  const pctAcero = findByClave(trace, 'pctAceroVolumen');
  assert.equal(pctAcero.origen, PARAM_ORIGIN.ZOEMEC_SUGGESTED);
  assert.equal(pctAcero.valor, 1.2);
  assert.equal(pctAcero.valorBaseOriginal, 1.2);
  assert.equal(pctAcero.modificadoPorUsuario, false);
});

test('2. valor sugerido MODIFICADO manualmente -> USER_OVERRIDE, nunca sigue figurando como sugerido', () => {
  const params = { pctAceroVolumen: 2.5 };
  const calcResult = zapataAislada.calculate(INPUTS, params);
  const trace = buildParameterTrace({ elementDef: zapataAislada, inputs: INPUTS, params, calcResult, auxiliaries: buildBaseAuxiliaries() });
  const pctAcero = findByClave(trace, 'pctAceroVolumen');
  assert.equal(pctAcero.origen, PARAM_ORIGIN.USER_OVERRIDE);
  assert.notEqual(pctAcero.origen, PARAM_ORIGIN.ZOEMEC_SUGGESTED);
  assert.equal(pctAcero.valor, 2.5);
  assert.equal(pctAcero.valorBaseOriginal, 1.2); // el valor base original se conserva para auditoria, aunque ya no sea el vigente
  assert.equal(pctAcero.modificadoPorUsuario, true);
});

test('2b. un parametro de seleccion (no expertOnly, ej. auxConcretoClave) sigue la MISMA regla: override -> USER_OVERRIDE, sin override -> ZOEMEC_SUGGESTED', () => {
  const sinOverride = buildParameterTrace({ elementDef: zapataAislada, inputs: INPUTS, params: {}, calcResult: zapataAislada.calculate(INPUTS, {}), auxiliaries: buildBaseAuxiliaries() });
  assert.equal(findByClave(sinOverride, 'auxConcretoClave').origen, PARAM_ORIGIN.ZOEMEC_SUGGESTED);
  const conOverride = buildParameterTrace({ elementDef: zapataAislada, inputs: INPUTS, params: { auxConcretoClave: 'CONC-100' }, calcResult: zapataAislada.calculate(INPUTS, { auxConcretoClave: 'CONC-100' }), auxiliaries: buildBaseAuxiliaries() });
  assert.equal(findByClave(conOverride, 'auxConcretoClave').origen, PARAM_ORIGIN.USER_OVERRIDE);
});

test('3. valor DERIVADO DE AUXILIAR: dosificacion y desperdicio de cada ingrediente quedan marcados AUXILIARY_DERIVED con version/fecha del auxiliar', () => {
  const auxiliares = buildBaseAuxiliaries();
  const calcResult = zapataAislada.calculate(INPUTS, {});
  const trace = buildParameterTrace({ elementDef: zapataAislada, inputs: INPUTS, params: {}, calcResult, auxiliaries: auxiliares });
  const conc200 = auxiliares.find(a => a.clave === 'CONC-200');
  const cementoDosif = trace.find(e => e.origen === PARAM_ORIGIN.AUXILIARY_DERIVED && e.nombre.includes('Cemento') && e.nombre.includes('dosificación'));
  assert.ok(cementoDosif, 'debe existir un renglon de dosificacion de cemento derivado del auxiliar');
  assert.equal(cementoDosif.valor, 7.0); // cantidadPorUnidad de CONC-200 (ver auxiliaries.js)
  assert.equal(cementoDosif.auxiliarClave, 'CONC-200');
  assert.equal(cementoDosif.auxiliarVersion, conc200.version);
  assert.equal(cementoDosif.auxiliarFecha, conc200.updatedAt);
  const cementoDesp = trace.find(e => e.origen === PARAM_ORIGIN.AUXILIARY_DERIVED && e.nombre.includes('Cemento') && e.nombre.includes('desperdicio'));
  assert.ok(cementoDesp);
  assert.equal(cementoDesp.valor, 3); // desperdicioPct de cemento en CONC-200
  assert.equal(cementoDesp.unidad, '%');
});

test('4. valor CALCULADO: cada cantidad de calcResult.cantidades queda marcada CALCULATED, sin valor base ni modificacion posible', () => {
  const calcResult = zapataAislada.calculate(INPUTS, {});
  const trace = buildParameterTrace({ elementDef: zapataAislada, inputs: INPUTS, params: {}, calcResult, auxiliaries: buildBaseAuxiliaries() });
  ['volumenConcreto', 'pesoAcero', 'areaCimbraLateral'].forEach(key => {
    const entry = findByClave(trace, key);
    assert.ok(entry, `falta el renglon calculado ${key}`);
    assert.equal(entry.origen, PARAM_ORIGIN.CALCULATED);
    assert.equal(entry.valor, calcResult.cantidades[key]);
    assert.equal(entry.valorBaseOriginal, null);
    assert.equal(entry.modificadoPorUsuario, false);
  });
});

test('5. inputs geometricos siempre quedan USER_PROVIDED (nunca defaulteados por la arquitectura)', () => {
  const calcResult = zapataAislada.calculate(INPUTS, {});
  const trace = buildParameterTrace({ elementDef: zapataAislada, inputs: INPUTS, params: {}, calcResult, auxiliaries: buildBaseAuxiliaries() });
  ['largo', 'ancho', 'peralte'].forEach(key => {
    const entry = findByClave(trace, key);
    assert.equal(entry.origen, PARAM_ORIGIN.USER_PROVIDED);
    assert.equal(entry.valor, INPUTS[key]);
    assert.equal(entry.modificadoPorUsuario, true);
  });
});

test('6. IMPORTED: una clave marcada explicitamente como importada nunca aparece como sugerida/provista', () => {
  const calcResult = zapataAislada.calculate(INPUTS, {});
  const trace = buildParameterTrace({ elementDef: zapataAislada, inputs: INPUTS, params: {}, calcResult, auxiliaries: buildBaseAuxiliaries(), importedKeys: ['largo', 'pctAceroVolumen'] });
  assert.equal(findByClave(trace, 'largo').origen, PARAM_ORIGIN.IMPORTED);
  assert.equal(findByClave(trace, 'pctAceroVolumen').origen, PARAM_ORIGIN.IMPORTED);
  // el resto de las claves no listadas en importedKeys sigue su regla normal
  assert.equal(findByClave(trace, 'ancho').origen, PARAM_ORIGIN.USER_PROVIDED);
});

test('mapa de etiquetas de UI: toda clasificacion de PARAM_ORIGIN tiene una etiqueta i18n y una clase CSS definidas', () => {
  Object.values(PARAM_ORIGIN).forEach(origen => {
    assert.ok(PARAM_ORIGIN_LABEL_KEY[origen], `falta clave i18n para ${origen}`);
    assert.ok(PARAM_ORIGIN_CSS_CLASS[origen], `falta clase css para ${origen}`);
  });
});

test('cobertura completa: buildParameterTrace nunca omite un input o param declarado por el elemento', () => {
  Object.values(PARAMETRIC_ELEMENTS).forEach(elementDef => {
    const inputs = Object.fromEntries(elementDef.inputs.map(i => [i.key, i.min ?? 1]));
    const calcResult = elementDef.calculate(inputs, {});
    const trace = buildParameterTrace({ elementDef, inputs, params: {}, calcResult, auxiliaries: buildBaseAuxiliaries() });
    elementDef.inputs.forEach(i => assert.ok(findByClave(trace, i.key), `${elementDef.id}: falta trazabilidad del input ${i.key}`));
    elementDef.params.forEach(p => assert.ok(findByClave(trace, p.key), `${elementDef.id}: falta trazabilidad del parametro ${p.key}`));
  });
});
