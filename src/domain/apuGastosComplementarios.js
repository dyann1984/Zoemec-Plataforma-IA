/* Gastos Complementarios de Ejecucion (P1 autorizado 2026-09-07, fuera de
   Costos de Campo a proposito): partidas reales de ejecucion que NO son
   materiales/mano de obra/equipo del concepto en si (viaticos, alimentacion,
   hospedaje, transporte, fletes, permisos...), capturadas por separado con
   su propia categoria de tipo-de-gasto -- a diferencia de
   apuCostosCampo.js (categoria = bucket contable A-E para "Presupuestado vs
   Real"), aqui "categoria" es el TIPO de gasto (alimentacion, viaticos...).

   A diferencia de Costos de Campo (100% informativo, nunca toca
   apu.calculated), estos SI afectan el precio unitario -- ver
   src/lib/apuCalc.js#applyCascade: Costo directo + Gastos complementarios
   (los que cuentan, ver cuentaParaPrecio de abajo) = Base de ejecucion, y
   la cascada existente (indirectos/financiamiento/utilidad/cargos) corre
   sobre esa base, exactamente el mismo orden/formula que ya usaba el motor.

   Con el arreglo vacio o ausente (default de todo APU nuevo/historico) el
   total que cuenta es 0 y calcAPUv2 da exactamente el mismo resultado que
   antes -- compatibilidad total, ver apuCalc.test.js. */

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

/* Frecuencia: puramente DESCRIPTIVA/de trazabilidad para el revisor humano
   (regla 5 del mensaje de la sesion: "no uses texto de frecuencia para
   multiplicar automaticamente si faltan variables"). "cantidad" ya debe
   representar el TOTAL real del renglon (ej. 6 = 6 personas-dia de comida
   ya contadas por quien captura), nunca se re-multiplica aqui por un factor
   implicito de "diario"/"por viaje"/etc -- eso evitaria justo la
   ambiguedad de "cantidad ya incluye o no los dias/viajes" que la regla 5
   pide resolver de forma determinista. */
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

/* Ciclo de vida de una sugerencia (regla 6 del mensaje de la sesion): el
   Detector de costos no contemplados (apuRiskDetector.js, reusado, NUNCA
   un segundo motor) puede senalar que falta un gasto complementario, pero
   la UNICA forma de que eso se vuelva un renglon real es una accion
   explicita del usuario ("Agregar al APU"). La IA/el detector nunca deciden
   solos sumar o descartar un costo -- ver cuentaParaPrecio de abajo, que
   por diseno excluye TODO lo que no sea ACEPTADO. */
export const GASTO_ESTADO = Object.freeze({
  SUGERIDO: 'SUGERIDO',
  ACEPTADO: 'ACEPTADO',
  DESCARTADO: 'DESCARTADO',
  JUSTIFICADO: 'JUSTIFICADO'
});

export const GASTO_ESTADO_LABEL = Object.freeze({
  [GASTO_ESTADO.SUGERIDO]: 'Sugerido (pendiente de revisar)',
  [GASTO_ESTADO.ACEPTADO]: 'Aceptado',
  [GASTO_ESTADO.DESCARTADO]: 'Descartado',
  [GASTO_ESTADO.JUSTIFICADO]: 'Justificado (no se suma al precio)'
});

/* Categorias que tipicamente ya estan cubiertas por el % de indirectos de
   campo/oficina (vigilancia, seguros/fianzas, permisos) -- SOLO una
   sugerencia de default para posibleDuplicidad cuando el renglon no trae
   el campo explicito, NUNCA una decision automatica de excluir el costo
   (regla 4 del mensaje: "la IA nunca debe decidir silenciosamente eliminar
   o sumar un costo"). El usuario puede fijar row.posibleDuplicidad en
   true/false explicitamente y esa decision manda sobre el heuristico. */
const CATEGORIAS_POSIBLE_DUPLICADO_INDIRECTOS = new Set([
  GASTO_CATEGORIA.VIGILANCIA,
  GASTO_CATEGORIA.SEGUROS_FIANZAS,
  GASTO_CATEGORIA.PERMISOS_LICENCIAS
]);

export const DUPLICADO_INDIRECTOS_TEXTO = 'Posible costo duplicado: revisar indirectos.';

/* Aviso informativo (nunca excluye del precio por si solo -- ver
   cuentaParaPrecio, que solo obedece a incluidoEnIndirectos). Si el
   renglon no declara row.posibleDuplicidad explicitamente, se sugiere por
   categoria; una vez que el usuario lo fija (true o false) esa decision
   manda siempre. */
export function shouldShowPosibleDuplicidad(row){
  if(typeof row?.posibleDuplicidad === 'boolean') return row.posibleDuplicidad;
  return CATEGORIAS_POSIBLE_DUPLICADO_INDIRECTOS.has(row?.categoria);
}

export function makeEmptyGastoComplementarioRow(){
  return {
    id: '', concepto: '', categoria: GASTO_CATEGORIA.OTROS, unidad: '', cantidad: 0,
    precioUnitario: 0, frecuencia: GASTO_FRECUENCIA.UNICO, justificacion: '', fuente: '',
    // Un renglon agregado a mano por el usuario ya es una decision explicita
    // ("Agregar al APU"), por eso arranca ACEPTADO -- SUGERIDO es solo para
    // el flujo del detector (ver makeSuggestedGastoComplementarioRow).
    estado: GASTO_ESTADO.ACEPTADO,
    // Ninguno de los dos se asume true por defecto (regla 4: nunca decidir
    // en silencio) -- posibleDuplicidad queda sin fijar (undefined) para
    // que shouldShowPosibleDuplicidad use el heuristico de categoria hasta
    // que el usuario lo confirme/descarte explicitamente.
    incluidoEnIndirectos: false, posibleDuplicidad: undefined
  };
}

/* Stub para una sugerencia del detector (regla 6): SIN monto (nunca se
   inventa una cantidad/precio), estado SUGERIDO -- el usuario debe llenar
   cantidad/precioUnitario y cambiar el estado a ACEPTADO para que cuente. */
export function makeSuggestedGastoComplementarioRow({ categoria = GASTO_CATEGORIA.OTROS, concepto = '', justificacion = '' } = {}){
  return { ...makeEmptyGastoComplementarioRow(), categoria, concepto, justificacion, estado: GASTO_ESTADO.SUGERIDO };
}

function toNumber(value){ const n = Number(value); return Number.isFinite(n) ? n : 0; }

/* Formula minima determinista (regla 5): cantidad x precioUnitario, siempre
   -- nunca se captura el importe a mano, nunca se multiplica por un factor
   implicito de frecuencia. Se calcula SIEMPRE (incluso para renglones que
   no cuentan para el precio) porque la tabla debe mostrar el importe real
   de cada renglon para trazabilidad, cuente o no cuente. */
export function calcGastoComplementarioImporte(row){
  return toNumber(row?.cantidad) * toNumber(row?.precioUnitario);
}

/* Unica funcion que decide si un renglon suma al precio (usada por
   apuCalc.js#calcAPUv2 y por la UI/exportadores para el subtotal "incluido
   en el precio") -- regla 4 y 6 del mensaje de la sesion:
   - SUGERIDO/DESCARTADO/JUSTIFICADO NUNCA suman (solo ACEPTADO, y solo tras
     una accion explicita del usuario -- nunca la IA/el detector solos).
   - incluidoEnIndirectos:true NUNCA suma aunque este ACEPTADO (ya esta
     contemplado en el % de indirectos -- se muestra, no se duplica).
   Un renglon sin "estado" (no deberia ocurrir tras makeEmptyGastoComplementarioRow,
   pero se sanea igual que el resto del motor) se trata como ACEPTADO para
   no romper filas ya capturadas antes de que este campo se agregara en
   esta misma sesion. */
export function cuentaParaPrecio(row){
  const estado = row?.estado || GASTO_ESTADO.ACEPTADO;
  if(estado !== GASTO_ESTADO.ACEPTADO) return false;
  if(row?.incluidoEnIndirectos === true) return false;
  return true;
}

export function summarizeGastosComplementarios(gastos){
  const rows = Array.isArray(gastos) ? gastos : [];
  let totalIncluido = 0;
  let totalNoIncluido = 0;
  const byCategoria = {};
  const byEstado = {};
  rows.forEach(row => {
    const importe = calcGastoComplementarioImporte(row);
    const cat = Object.prototype.hasOwnProperty.call(GASTO_CATEGORIA_LABEL, row?.categoria) ? row.categoria : GASTO_CATEGORIA.OTROS;
    const estado = row?.estado || GASTO_ESTADO.ACEPTADO;
    byCategoria[cat] = (byCategoria[cat] || 0) + importe;
    byEstado[estado] = (byEstado[estado] || 0) + 1;
    if(cuentaParaPrecio(row)) totalIncluido += importe;
    else totalNoIncluido += importe;
  });
  return { count: rows.length, totalIncluido, totalNoIncluido, byCategoria, byEstado };
}
