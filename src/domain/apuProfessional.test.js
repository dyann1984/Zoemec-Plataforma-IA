import test from 'node:test';
import assert from 'node:assert/strict';
import { makeEmptyAPUv2, APU_DATA_STATE } from './apuSchema.js';
import { PRICE_SOURCE_TYPE, makePriceRecord, calculateAPUConfidence, validateAPU } from './apuProfessional.js';

test('makePriceRecord normaliza precio y conserva precio/unidad original', () => {
  const row = makePriceRecord({ description:'Cemento CPC 30R 50 kg', originalUnit:'saco 50 kg', unit:'kg', originalPrice:235, conversionFactor:50, sourceType:PRICE_SOURCE_TYPE.VERIFIED, verified:true });
  assert.equal(row.price, 4.7); assert.equal(row.originalPrice, 235); assert.equal(row.unit, 'kg'); assert.equal(row.verified, true);
});

test('calculateAPUConfidence proviene de cobertura, fuentes y antiguedad (ponderado por costo)', () => {
  const apu = makeEmptyAPUv2(); apu.concept='Aplanado fino'; apu.unit='m2';
  apu.materials=[{ clave:'MAT-001', consumo:1, precioUnitario:235, fuente:{ estado:APU_DATA_STATE.VERIFICADO, proveedor:'CEMEX', fecha:'2026-07-01' } }];
  apu.labor=[{ clave:'MO-001', cuadrilla:1, rendimiento:25, salarioBase:1000, fsr:1, fuente:{ estado:APU_DATA_STATE.VERIFICADO, proveedor:'Tabulador', fecha:'2026-07-01' } }];
  apu.procedimientoConstructivo=['Preparar']; apu.controlCalidad=[{criterio:'Aplome'}]; apu.criterioMedicion.unidadMedicion='m2';
  const confidence=calculateAPUConfidence(apu,{now:'2026-08-14'});
  assert.equal(confidence.score,100); assert.equal(confidence.level,'ALTA');
});

test('calculateAPUConfidence castiga renglones sin costo/evidencia aunque tengan proveedor declarado', () => {
  // Regresion del rediseno de confianza (Price Intelligence + validacion
  // tecnica): un renglon con precioUnitario/cuadrilla ausentes -- costo
  // calculado en 0 -- ya no debe poder alcanzar 100% solo por tener un
  // "proveedor" de texto libre sin respaldo economico real.
  const apu = makeEmptyAPUv2(); apu.concept='Aplanado fino'; apu.unit='m2';
  apu.materials=[{ clave:'MAT-001', consumo:1, fuente:{ estado:APU_DATA_STATE.VERIFICADO, proveedor:'CEMEX', fecha:'2026-07-01' } }];
  apu.labor=[{ clave:'MO-001', cantidad:0.04, rendimiento:25, salarioBase:1000, fsr:1, fuente:{ estado:APU_DATA_STATE.VERIFICADO, proveedor:'Tabulador', fecha:'2026-07-01' } }];
  const confidence=calculateAPUConfidence(apu,{now:'2026-08-14'});
  assert.ok(confidence.score < 100, `esperaba <100 por costo cero, obtuvo ${confidence.score}`);
});

test('calculateAPUConfidence pondera por costo: referencia ALTO en el renglon caro pesa mas que MEDIO en el barato', () => {
  const apu = makeEmptyAPUv2(); apu.concept='Concepto'; apu.unit='m2';
  apu.materials=[
    { clave:'MAT-001', consumo:1, precioUnitario:1000, fuente:{estado:APU_DATA_STATE.REQUIERE_VALIDACION}, priceRecord:{ evidenceLevel:'MERCADO', references:[{proveedor:'A',match:{verdict:'ALTO',score:95},fecha:'2026-08-01'},{proveedor:'B',match:{verdict:'ALTO',score:90},fecha:'2026-08-01'},{proveedor:'C',match:{verdict:'ALTO',score:92},fecha:'2026-08-01'}] } },
    { clave:'MAT-002', consumo:1, precioUnitario:10, fuente:{estado:APU_DATA_STATE.ESTIMADO_IA} }
  ];
  const confidence=calculateAPUConfidence(apu,{now:'2026-08-14'});
  assert.ok(confidence.dimensions.precios >= 80, `esperaba >=80 (el renglon caro domina), obtuvo ${confidence.dimensions.precios}`);
});

test('validateAPU detecta fuentes faltantes y no declara validado', () => {
  const apu=makeEmptyAPUv2(); apu.concept='Concepto'; apu.unit='m2';
  apu.labor=[{ clave:'MO-001', cantidad:1, salarioBase:100, fsr:1, fuente:{} }];
  const result=validateAPU(apu,{now:'2026-08-14'});
  assert.notEqual(result.status,'VALIDADO');
  assert.ok(result.issues.some(issue=>issue.code==='price_without_source'));
});
