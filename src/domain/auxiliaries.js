/* Auxiliares (recetas/composiciones reutilizables) para el Cuantificador
   Parametrico ZOEMEC (Fase B). Confirmado por auditoria: no existia ningun
   concepto de "receta"/"composicion" en el repo -- esto es nuevo, pero
   reutiliza deliberadamente:
   - los MISMOS campos que un renglon de material de un APU v1
     (src/domain/apuGeneration.js: desc/cantidad/unidad/precio/desperdicioPct),
     como OBJETO en vez de arreglo posicional -- Firestore rechaza arreglos
     anidados ("Nested arrays are not supported"), y `composicion` es un
     arreglo de renglones dentro de un documento, asi que cada renglon debe
     ser un objeto para poder guardarse.
   - findCatalogMatches (src/domain/catalogLookup.js) para resolver el
     precio de cada ingrediente en vivo contra el catalogo real del
     proyecto/organizacion -- nunca se guarda un precio resuelto dentro del
     auxiliar. Esto es lo que hereda automaticamente cualquier precio
     regional que ya exista en el catalogo, sin escribir logica de
     regionalizacion aqui.
   - el mismo enum APU_DATA_STATE (src/domain/apuSchema.js) para marcar la
     confianza de cada ingrediente resuelto -- nunca un enum nuevo.

   Puro: sin React, sin Firebase. src/services/auxiliariesApi.js es quien
   lee/escribe Firestore; este modulo solo calcula y valida. */
import { findCatalogMatches } from './catalogLookup.js';
import { normalizeUnitLabel } from '../lib/excelImport.js';
import { APU_DATA_STATE } from './apuSchema.js';
import { uid } from '../utils/id.js';

export const AUXILIARY_ORIGIN = Object.freeze({
  BASE_ZOEMEC: 'BASE_ZOEMEC',
  ORGANIZACION: 'ORGANIZACION',
  USUARIO: 'USUARIO'
});

/* Orden de confianza de PEOR a MEJOR -- usado para que el estado global de
   un auxiliar sea siempre el del ingrediente MAS debil, nunca un promedio
   que esconda un ingrediente sin precio real. */
const STATE_RANK = [
  APU_DATA_STATE.REQUIERE_VALIDACION, APU_DATA_STATE.ESTIMADO_IA, APU_DATA_STATE.ASUMIDO,
  APU_DATA_STATE.IMPORTADO, APU_DATA_STATE.BIBLIOTECA, APU_DATA_STATE.VERIFICADO
];
function worstState(a, b){
  if(!a) return b;
  if(!b) return a;
  return STATE_RANK.indexOf(a) <= STATE_RANK.indexOf(b) ? a : b;
}

function makeCompositionRow(desc, cantidadPorUnidad, unidad, precioUnitario = 0, desperdicioPct = 0){
  return { desc, cantidadPorUnidad: Number(cantidadPorUnidad) || 0, unidad: normalizeUnitLabel(unidad), precioUnitario: Number(precioUnitario) || 0, desperdicioPct: Number(desperdicioPct) || 0 };
}

export function makeAuxiliaryDefinition({
  id, clave, nombre, unidad, categoria, composicion = [],
  origen = AUXILIARY_ORIGIN.USUARIO, privado = false, organizationId = null,
  activo = true, notas = '', createdBy = null
}){
  const now = new Date().toISOString();
  return {
    id: id || ('AUX-' + uid()),
    clave, nombre, unidad: normalizeUnitLabel(unidad), categoria,
    composicion: composicion.map(row => Array.isArray(row) ? makeCompositionRow(...row) : row),
    version: 1, origen, privado, organizationId,
    activo, notas, createdAt: now, updatedAt: now, createdBy
  };
}

/* Validacion estructural pura -- nunca revienta, siempre regresa
   {valid, errors[]} para que la UI decida como mostrarlo. */
export function validateAuxiliaryDefinition(aux){
  const errors = [];
  if(!aux || typeof aux !== 'object') return { valid: false, errors: ['auxiliar_invalido'] };
  if(!aux.clave || typeof aux.clave !== 'string') errors.push('clave_requerida');
  if(!aux.nombre || typeof aux.nombre !== 'string') errors.push('nombre_requerido');
  if(!aux.unidad || typeof aux.unidad !== 'string') errors.push('unidad_requerida');
  if(!aux.categoria || typeof aux.categoria !== 'string') errors.push('categoria_requerida');
  if(!Array.isArray(aux.composicion) || aux.composicion.length === 0){
    errors.push('composicion_vacia');
  } else {
    aux.composicion.forEach((row, i) => {
      if(!row || typeof row !== 'object' || Array.isArray(row)) { errors.push(`renglon_${i}_invalido`); return; }
      const { desc, cantidadPorUnidad, unidad, precioUnitario, desperdicioPct } = row;
      if(!desc || typeof desc !== 'string') errors.push(`renglon_${i}_sin_descripcion`);
      if(!(Number(cantidadPorUnidad) > 0)) errors.push(`renglon_${i}_cantidad_invalida`);
      if(!unidad || typeof unidad !== 'string') errors.push(`renglon_${i}_sin_unidad`);
      if(Number(precioUnitario) < 0) errors.push(`renglon_${i}_precio_negativo`);
      if(Number(desperdicioPct) < 0) errors.push(`renglon_${i}_desperdicio_negativo`);
    });
  }
  return { valid: errors.length === 0, errors };
}

/* Fusiona auxiliares globales (organizationId:null) con los privados de una
   organizacion, por `clave` -- una copia privada de la MISMA clave
   sombrea/reemplaza a la global (la organizacion personalizo su propia
   version), nunca se duplican ni se pierden. Nunca muta los arreglos de
   entrada. */
export function listAvailableAuxiliaries(globalAuxiliaries = [], orgAuxiliaries = []){
  const byClave = new Map();
  (globalAuxiliaries || []).filter(a => a?.activo !== false).forEach(a => byClave.set(a.clave, a));
  (orgAuxiliaries || []).filter(a => a?.activo !== false).forEach(a => byClave.set(a.clave, a));
  return Array.from(byClave.values());
}

/* Resuelve el costo por unidad de un auxiliar contra el catalogo REAL
   (nunca inventa precio: un ingrediente sin match de catalogo cae al
   precio propio guardado en el auxiliar -- 0 si no hay ninguno -- y queda
   marcado REQUIERE_VALIDACION). options se reenvia tal cual a
   findCatalogMatches (ej. semanticProvider). */
export function resolveAuxiliaryCost(aux, catalog, options = {}){
  const desglose = (aux?.composicion || []).map(row => {
    const { desc, cantidadPorUnidad, unidad, precioUnitario: precioPropio, desperdicioPct } = row;
    const found = findCatalogMatches(catalog, { desc, unidad }, options);
    let precioUnitario, fuente;
    if(found){
      precioUnitario = Number(found.match.precio) || 0;
      fuente = {
        estado: found.match.estado === 'VERIFICADO' ? APU_DATA_STATE.VERIFICADO : APU_DATA_STATE.BIBLIOTECA,
        matchMethod: found.matchMethod, confidence: found.confidence,
        clave: found.match.clave || null, categoria: found.match.categoria || null
      };
    } else {
      precioUnitario = Number(precioPropio) || 0;
      fuente = {
        estado: precioUnitario > 0 ? APU_DATA_STATE.ASUMIDO : APU_DATA_STATE.REQUIERE_VALIDACION,
        matchMethod: null, confidence: null, clave: null, categoria: null
      };
    }
    const desperdicioPctNum = Number(desperdicioPct) || 0;
    const cantidadConDesperdicio = cantidadPorUnidad * (1 + desperdicioPctNum / 100);
    const importe = cantidadConDesperdicio * precioUnitario;
    // cantidadBase + desperdicioPct por separado (ademas de `cantidad`, ya
    // con desperdicio incluido, para mostrar el desglose de costo): quien
    // arme un renglon de APU real a partir de esto (parametricApuAssembler.js)
    // debe escalar cantidadBase por el consumo del elemento y dejar que el
    // motor de calculo estandar (apuCalc.js#calcMaterialRow) aplique el
    // desperdicio UNA sola vez -- aplicarlo aqui Y otra vez alla lo
    // duplicaria.
    return { desc, cantidad: cantidadConDesperdicio, cantidadBase: cantidadPorUnidad, desperdicioPct: desperdicioPctNum, unidad, precioUnitario, importe, fuente };
  });
  const costoPorUnidad = desglose.reduce((sum, row) => sum + row.importe, 0);
  const estado = desglose.reduce((acc, row) => worstState(acc, row.fuente.estado), null) || APU_DATA_STATE.REQUIERE_VALIDACION;
  return { costoPorUnidad, desglose, estado };
}

/* Auxiliares base ZOEMEC (Fase B): dosificaciones de REFERENCIA estandar de
   la industria, documentadas como tal -- ajustables por cada organizacion
   sin perder la version base (ver restoreBaseAuxiliaries). Los precios de
   cada ingrediente quedan en 0 a proposito: se resuelven en vivo contra el
   catalogo real (ver resolveAuxiliaryCost), nunca se fija un precio de
   fabrica aqui. */
export function buildBaseAuxiliaries(){
  const now = new Date().toISOString();
  const base = (clave, nombre, unidad, categoria, composicion, notas) => ({
    id: 'AUX-BASE-' + clave, clave, nombre, unidad: normalizeUnitLabel(unidad), categoria,
    composicion: composicion.map(row => makeCompositionRow(...row)),
    version: 1, origen: AUXILIARY_ORIGIN.BASE_ZOEMEC, privado: false, organizationId: null,
    activo: true, notas, createdAt: now, updatedAt: now, createdBy: null
  });
  return [
    base('CONC-200', "Concreto f'c=200 kg/cm² (hecho en obra)", 'm³', 'concreto', [
      ['Cemento gris CPC 30R', 7.0, 'saco', 0, 3],
      ['Arena de río', 0.55, 'm³', 0, 5],
      ['Grava 3/4"', 0.75, 'm³', 0, 5],
      ['Agua', 180, 'l', 0, 0]
    ], "Dosificación de referencia (1:2:3 aprox. por volumen). Ajustar con el diseño de mezcla real de la obra cuando exista."),
    base('MORT-1-4', 'Mortero cemento-arena 1:4', 'm³', 'mortero', [
      ['Cemento gris CPC 30R', 6.4, 'saco', 0, 5],
      ['Arena de río', 1.05, 'm³', 0, 5],
      ['Agua', 200, 'l', 0, 0]
    ], 'Proporción de referencia 1:4 por volumen. Ajustar según el uso (junteo vs. aplanado) en modo experto.'),
    base('CIMBRA-COMUN', 'Cimbra común (triplay + barrotes)', 'm²', 'cimbra', [
      ['Triplay de 14mm para cimbra', 0.35, 'hoja', 0, 5],
      ['Barrote de madera 3"x3"', 2.2, 'ml', 0, 5],
      ['Clavo de 2.5"', 0.15, 'kg', 0, 0],
      ['Desmoldante', 0.10, 'l', 0, 0]
    ], 'Costo de UN uso de cimbra por m². El número de reusos reales se aplica en el elemento paramétrico (ver parametricElements.js), no aquí.')
  ];
}

/* Nunca sobreescribe un auxiliar ya existente con la misma `clave` --
   personalizado por la organizacion o no, restaurar la base solo AGREGA
   los que falten. */
export function restoreBaseAuxiliaries(existingGlobalAuxiliaries = []){
  const existingClaves = new Set((existingGlobalAuxiliaries || []).map(a => a.clave));
  const missing = buildBaseAuxiliaries().filter(a => !existingClaves.has(a.clave));
  return [...existingGlobalAuxiliaries, ...missing];
}
