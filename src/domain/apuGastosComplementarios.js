/* Gastos Complementarios de Ejecucion (P1 autorizado 2026-09-07, fuera de
   Costos de Campo a proposito): partidas reales de ejecucion que NO son
   materiales/mano de obra/equipo del concepto en si (viaticos, alimentacion,
   hospedaje, transporte, fletes, permisos...), capturadas por separado con
   su propia categoria de tipo-de-gasto -- a diferencia de
   apuCostosCampo.js (categoria = bucket contable A-E para "Presupuestado vs
   Real"), aqui "categoria" es el TIPO de gasto (alimentacion, viaticos...),
   por eso viven en modulos y campos distintos, sin reusar el mismo nombre
   con otro significado.

   A diferencia de Costos de Campo (100% informativo, nunca toca
   apu.calculated), estos SI afectan el precio unitario cuando el renglon
   esta marcado incluido:true -- decision explicita del usuario ("deben
   afectar realmente el precio"), aplicado en apuCalc.js#calcAPUv2 sumando
   el total incluido al costo directo antes de aplicar indirectos/
   financiamiento/utilidad/cargos (ver diagrama de la Sesion 2026-09-07).
   Con el arreglo vacio (default de todo APU nuevo/historico) el total
   incluido es 0 y calcAPUv2 da exactamente el mismo resultado que antes --
   compatibilidad total con APUs existentes. */

export const GASTO_CATEGORIA = Object.freeze({
  ALIMENTACION: 'ALIMENTACION',
  VIATICOS: 'VIATICOS',
  HOSPEDAJE: 'HOSPEDAJE',
  TRANSPORTE: 'TRANSPORTE',
  GASOLINA: 'GASOLINA',
  CASETAS: 'CASETAS',
  ESTACIONAMIENTO: 'ESTACIONAMIENTO',
  FLETES: 'FLETES',
  MANIOBRAS: 'MANIOBRAS',
  VIGILANCIA: 'VIGILANCIA',
  PERMISOS_LICENCIAS: 'PERMISOS_LICENCIAS',
  PRUEBAS_LABORATORIO: 'PRUEBAS_LABORATORIO',
  AUDITORIAS: 'AUDITORIAS',
  SEGUROS_FIANZAS: 'SEGUROS_FIANZAS',
  OTROS: 'OTROS'
});

export const GASTO_CATEGORIA_LABEL = Object.freeze({
  [GASTO_CATEGORIA.ALIMENTACION]: 'Alimentación / comidas',
  [GASTO_CATEGORIA.VIATICOS]: 'Viáticos',
  [GASTO_CATEGORIA.HOSPEDAJE]: 'Hospedaje',
  [GASTO_CATEGORIA.TRANSPORTE]: 'Transporte / traslado de personal',
  [GASTO_CATEGORIA.GASOLINA]: 'Gasolina',
  [GASTO_CATEGORIA.CASETAS]: 'Casetas',
  [GASTO_CATEGORIA.ESTACIONAMIENTO]: 'Estacionamiento',
  [GASTO_CATEGORIA.FLETES]: 'Fletes / carga y descarga',
  [GASTO_CATEGORIA.MANIOBRAS]: 'Maniobras',
  [GASTO_CATEGORIA.VIGILANCIA]: 'Vigilancia',
  [GASTO_CATEGORIA.PERMISOS_LICENCIAS]: 'Permisos / licencias',
  [GASTO_CATEGORIA.PRUEBAS_LABORATORIO]: 'Pruebas / laboratorio',
  [GASTO_CATEGORIA.AUDITORIAS]: 'Auditorías / supervisión externa',
  [GASTO_CATEGORIA.SEGUROS_FIANZAS]: 'Seguros / fianzas',
  [GASTO_CATEGORIA.OTROS]: 'Otros'
});

export const GASTO_CATEGORIA_ORDER = Object.values(GASTO_CATEGORIA);

export const GASTO_FRECUENCIA = Object.freeze({
  UNICO: 'UNICO',
  DIARIO: 'DIARIO',
  SEMANAL: 'SEMANAL',
  MENSUAL: 'MENSUAL',
  POR_TRABAJADOR: 'POR_TRABAJADOR',
  POR_CUADRILLA: 'POR_CUADRILLA',
  POR_VIAJE: 'POR_VIAJE',
  POR_EVENTO: 'POR_EVENTO'
});

export const GASTO_FRECUENCIA_LABEL = Object.freeze({
  [GASTO_FRECUENCIA.UNICO]: 'Único',
  [GASTO_FRECUENCIA.DIARIO]: 'Diario',
  [GASTO_FRECUENCIA.SEMANAL]: 'Semanal',
  [GASTO_FRECUENCIA.MENSUAL]: 'Mensual',
  [GASTO_FRECUENCIA.POR_TRABAJADOR]: 'Por trabajador',
  [GASTO_FRECUENCIA.POR_CUADRILLA]: 'Por cuadrilla',
  [GASTO_FRECUENCIA.POR_VIAJE]: 'Por viaje',
  [GASTO_FRECUENCIA.POR_EVENTO]: 'Por evento'
});

export const GASTO_FRECUENCIA_ORDER = Object.values(GASTO_FRECUENCIA);

/* Categorias que tipicamente ya estan cubiertas por el % de indirectos de
   campo/oficina (vigilancia, seguros/fianzas, permisos) -- aviso de
   duplicidad potencial, NUNCA bloqueo ni auto-exclusion: el usuario decide
   si en su caso concreto ya esta contemplado o no (mismo criterio de
   "nunca decidir por el usuario" que ya usa el Detector de costos no
   contemplados en apuRiskDetector.js). */
const CATEGORIAS_POSIBLE_DUPLICADO_INDIRECTOS = new Set([
  GASTO_CATEGORIA.VIGILANCIA,
  GASTO_CATEGORIA.SEGUROS_FIANZAS,
  GASTO_CATEGORIA.PERMISOS_LICENCIAS
]);

export const DUPLICADO_INDIRECTOS_TEXTO = 'Posible costo duplicado: este concepto podría estar incluido en indirectos.';

export function isPosibleDuplicadoIndirectos(row){
  return CATEGORIAS_POSIBLE_DUPLICADO_INDIRECTOS.has(row?.categoria);
}

export function makeEmptyGastoComplementarioRow(){
  return {
    id: '', concepto: '', categoria: GASTO_CATEGORIA.OTROS, unidad: '', cantidad: 0,
    precioUnitario: 0, frecuencia: GASTO_FRECUENCIA.UNICO, justificacion: '', fuente: '',
    incluido: true
  };
}

function toNumber(value){ const n = Number(value); return Number.isFinite(n) ? n : 0; }

/* importe = cantidad x precioUnitario -- nunca se captura a mano, siempre se
   deriva (mismo criterio que el resto del APU y que apuCostosCampo.js).
   "cantidad" ya representa el total real del renglon (ej. "6" personas-dia
   para una comida diaria de 6 personas): "frecuencia" es descriptiva/de
   trazabilidad para el revisor humano, no un multiplicador adicional --
   evita ambiguedad de si "cantidad" ya incluye o no los dias/viajes. */
export function calcGastoComplementarioImporte(row){
  return toNumber(row?.cantidad) * toNumber(row?.precioUnitario);
}

/* Un renglon cuenta para el precio unitario salvo que el usuario lo marque
   explicitamente como no incluido (ej. "ya esta contemplado en indirectos,
   lo dejo registrado solo para trazabilidad"). Default incluido:true. */
export function isGastoIncluido(row){
  return row?.incluido !== false;
}

export function summarizeGastosComplementarios(gastos){
  const rows = Array.isArray(gastos) ? gastos : [];
  let totalIncluido = 0;
  let totalExcluido = 0;
  const byCategoria = {};
  rows.forEach(row => {
    const importe = calcGastoComplementarioImporte(row);
    const cat = Object.prototype.hasOwnProperty.call(GASTO_CATEGORIA_LABEL, row?.categoria) ? row.categoria : GASTO_CATEGORIA.OTROS;
    byCategoria[cat] = (byCategoria[cat] || 0) + importe;
    if(isGastoIncluido(row)) totalIncluido += importe;
    else totalExcluido += importe;
  });
  return { count: rows.length, totalIncluido, totalExcluido, byCategoria };
}
