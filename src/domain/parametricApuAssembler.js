/* Ensamblador de APU a partir de un resultado del Cuantificador Parametrico
   ZOEMEC (Fase B). Arma un APU con la MISMA forma que
   src/domain/apuGeneration.js#makeAPUFromConcept -- reutiliza
   standardizeAPU/applyMarketPrices/findCatalogMatches TAL CUAL (nunca se
   modifican esos archivos, ver plan aprobado) para que el resultado sea
   indistinguible en forma de un APU generado por IA: Confidence Engine,
   Bid Risk, exportaciones PDF/Excel funcionan sin ningun cambio porque
   consumen materials/labor/equipment/family de forma generica.

   POLITICA DE DESPERDICIO/MERMA: fuente unica de verdad documentada en
   src/domain/auxiliaries.js (encabezado del archivo). Resumen operativo
   para este modulo: cada renglon de material que este ensamblador arma a
   partir de un auxiliar usa `ingrediente.cantidadBase` (NETA, sin
   desperdicio) como cantidad del renglon y `ingrediente.desperdicioPct`
   como el campo de merma del renglon -- NUNCA `ingrediente.cantidad` (que
   ya trae el desperdicio incluido, pensado solo para vistas previas de
   costo). El desperdicio lo aplica una unica vez el motor de calculo
   estandar ya desplegado (src/lib/apuCalc.js -- rowImporte para v1,
   calcMaterialRow para v2), nunca este archivo. */
import { standardizeAPU, applyMarketPrices } from './apuGeneration.js';
import { findCatalogMatches } from './catalogLookup.js';
import { normalizeUnitLabel } from '../lib/excelImport.js';
import { SYSTEM_RESOURCES } from './constructionSystems.js';
import { resolveAuxiliaryCost } from './auxiliaries.js';
import { APU_DATA_STATE } from './apuSchema.js';
import { uid } from '../utils/id.js';
import { buildParameterTrace } from './parametricTraceability.js';

/* No existe un tipo 'cimbra' en SYSTEM_RESOURCES (ningun concepto de texto
   libre lo dispara hoy en el motor de plantillas) -- este es el UNICO
   coeficiente de mano de obra nuevo de todo el ensamblador, documentado
   explicitamente como valor de referencia (oficial carpintero + ayudante,
   armado y desarmado de cimbra comun por m²), ajustable como cualquier
   otro renglon de un APU ya generado. */
const CIMBRA_LABOR_JOR_POR_M2 = 0.15;
const CIMBRA_LABOR_TEMPLATE = [
  ['Carpintero de obra negra (cimbra)', CIMBRA_LABOR_JOR_POR_M2 * 0.6, 'jor', 420, 1.85],
  ['Ayudante de cimbra', CIMBRA_LABOR_JOR_POR_M2 * 0.4, 'jor', 258, 1.82]
];

function resolveRowPrice(desc, unidad, tipo, catalog, options){
  const found = findCatalogMatches(catalog, { desc, unidad, tipo }, options);
  if(!found) return { precio: null, fuente: null };
  return {
    precio: Number(found.match.precio) || 0,
    fuente: {
      estado: found.match.estado === 'VERIFICADO' ? APU_DATA_STATE.VERIFICADO : APU_DATA_STATE.BIBLIOTECA,
      matchMethod: found.matchMethod, confidence: found.confidence,
      clave: found.match.clave || null, categoria: found.match.categoria || null,
      proveedor: found.match.traceability?.sourceDocName || found.match.fuente || null,
      fecha: found.match.traceability?.validatedAt || found.match.fecha || null
    }
  };
}

/* Escala un renglon plantilla de SYSTEM_RESOURCES ([desc,coef,unidad,precio,fsr?])
   por `cantidad` (ej. volumenConcreto, pesoAcero) e intenta resolver un
   precio real de catalogo antes de caer al precio de plantilla -- mismo
   criterio que useCat en apuGeneration.js, sin duplicar esa funcion
   privada (no esta exportada). */
function scaleTemplateRows(rows, cantidad, tipo, catalog, options, sources){
  return (rows || []).map(row => {
    const [desc, coef, unidad, precioPlantilla, extra] = row;
    const { precio, fuente } = resolveRowPrice(desc, unidad, tipo, catalog, options);
    sources.push(fuente);
    const nr = [desc, coef * cantidad, normalizeUnitLabel(unidad), precio ?? precioPlantilla];
    if(extra !== undefined) nr.push(extra);
    return nr;
  });
}

/* consumo: {tipo:'auxiliar', clave, cantidad, unidad} | {tipo:'material', desc, cantidad, unidad}
   | {tipo:'labor_sistema', sistemaId, cantidad} | {tipo:'labor_cimbra', cantidad}.
   auxiliaries: lista ya fusionada (global+privados de la organizacion, ver
   listAvailableAuxiliaries en auxiliaries.js) -- este modulo nunca decide
   privacidad/organizacion, solo recibe la lista ya resuelta por el
   llamador. */
function expandConsumo(consumo, catalog, auxiliaries, options, acc){
  if(!(consumo.cantidad > 0)) return; // una cantidad 0 (ej. sin aplanado) no genera renglon vacio
  if(consumo.tipo === 'auxiliar'){
    const aux = (auxiliaries || []).find(a => a.clave === consumo.clave);
    if(!aux){
      // El auxiliar referenciado no existe en la lista disponible -- no se
      // inventa su composicion: se deja un renglon REQUIERE_VALIDACION
      // explicito en vez de omitir silenciosamente el costo.
      acc.materials.push([`Auxiliar "${consumo.clave}" no encontrado`, consumo.cantidad, consumo.unidad, 0, 0]);
      acc.materialSources.push({ estado: APU_DATA_STATE.REQUIERE_VALIDACION, matchMethod: null, confidence: null, clave: consumo.clave, categoria: null });
      return;
    }
    const resolved = resolveAuxiliaryCost(aux, catalog, options);
    resolved.desglose.forEach(ingrediente => {
      if(!(ingrediente.cantidadBase > 0)) return;
      acc.materials.push([
        ingrediente.desc, ingrediente.cantidadBase * consumo.cantidad, normalizeUnitLabel(ingrediente.unidad),
        ingrediente.precioUnitario, ingrediente.desperdicioPct
      ]);
      acc.materialSources.push(ingrediente.fuente);
    });
    return;
  }
  if(consumo.tipo === 'material'){
    const { precio, fuente } = resolveRowPrice(consumo.desc, consumo.unidad, 'material', catalog, options);
    acc.materials.push([consumo.desc, consumo.cantidad, normalizeUnitLabel(consumo.unidad), precio ?? 0, 0]);
    acc.materialSources.push(fuente || { estado: precio ? APU_DATA_STATE.BIBLIOTECA : APU_DATA_STATE.REQUIERE_VALIDACION, matchMethod: null, confidence: null, clave: null, categoria: null });
    return;
  }
  if(consumo.tipo === 'labor_sistema'){
    const template = SYSTEM_RESOURCES[consumo.sistemaId];
    if(!template) return; // sistemaId desconocido -- no se inventa una cuadrilla
    acc.labor.push(...scaleTemplateRows(template.labor, consumo.cantidad, 'labor', catalog, options, acc.laborSources));
    if(Array.isArray(template.equipment)){
      acc.equipment.push(...scaleTemplateRows(template.equipment, consumo.cantidad, 'equipment', catalog, options, acc.equipmentSources));
    }
    return;
  }
  if(consumo.tipo === 'labor_cimbra'){
    acc.labor.push(...scaleTemplateRows(CIMBRA_LABOR_TEMPLATE, consumo.cantidad, 'labor', catalog, options, acc.laborSources));
  }
}

/* Punto de entrada unico. { elementDef, inputs, params, calcResult } vienen
   de parametricElements.js#PARAMETRIC_ELEMENTS[id].calculate(...). catalog
   es el mismo catalogo real del proyecto/organizacion (con lo que ya trae
   de precios regionales -- ver findCatalogMatches). auxiliaries es la
   lista ya fusionada global+privados. item/index/sourceFile siguen el
   mismo contrato que standardAPUForConcept. */
export function assembleAPUFromParametricResult({
  elementDef, inputs, params, calcResult, catalog = [], auxiliaries = [],
  index = 0, sourceFile = 'Cuantificador Paramétrico ZOEMEC', options = {}
}){
  const acc = { materials: [], materialSources: [], labor: [], laborSources: [], equipment: [], equipmentSources: [] };
  (calcResult?.consumos || []).forEach(consumo => expandConsumo(consumo, catalog, auxiliaries, options, acc));

  const standardClave = 'PARAM-' + uid();
  const dimensionesTexto = Object.entries(inputs || {}).map(([k, v]) => `${k}=${v}`).join(', ');
  const aiNotes = [
    `Generado por el Cuantificador Paramétrico ZOEMEC (${elementDef.label}): cantidades derivadas de fórmulas técnicas estándar a partir de las dimensiones capturadas (${dimensionesTexto}), no de una estimación de IA.`,
    'Las fórmulas y dosificaciones usadas son valores de referencia de la industria, ajustables -- revisa antes de aprobar para uso normativo/estructural real.'
  ];

  const base = {
    id: standardClave, clave: standardClave,
    concept: `${elementDef.label} (${dimensionesTexto})`,
    unit: elementDef.outputUnit || 'pza',
    templateGenerated: true,
    materials: acc.materials, labor: acc.labor, equipment: acc.equipment,
    laborDetails: [],
    materialSources: acc.materialSources, laborSources: acc.laborSources, equipmentSources: acc.equipmentSources,
    seguridad: [], eppRisks: [],
    consumables: [],
    technicalJustifications: {
      materials: `Cantidades derivadas de la fórmula técnica del elemento "${elementDef.label}" (Cuantificador Paramétrico ZOEMEC), con precios resueltos contra el catálogo real cuando hay coincidencia.`,
      labor: `Cuadrillas reutilizadas de la plantilla técnica ZOEMEC para los sistemas constructivos involucrados (concreto/acero/block/aplanado/cimbra), escaladas por la cantidad real de este elemento.`,
      equipment: 'Equipo/apoyo reutilizado de la misma plantilla técnica ZOEMEC que la mano de obra asociada.',
      smallTools: 'Herramienta menor calculada como porcentaje estándar de mano de obra.',
      consumables: 'NO APLICA -- no se identificaron consumibles independientes para este elemento paramétrico.',
      safety: 'Revisar si el elemento requiere un desglose de seguridad independiente antes de aprobar.'
    },
    family: elementDef.family,
    confidence: 70,
    sat: null,
    incomplete: false,
    primaryActivity: elementDef.id,
    secondaryActivities: [],
    classificationMatch: 'parametrico',
    aiNotes,
    variables: null,
    date: new Date().toLocaleDateString('es-MX'),
    // Campos aditivos (nunca leidos por el resto del motor -- Confidence
    // Engine/Bid Risk/exportaciones consumen materials/labor/equipment/
    // family de forma generica): trazabilidad de que este APU vino del
    // Cuantificador, nunca de IA ni de clasificacion de texto.
    aiGenerated: false,
    parametricGenerated: true,
    // parameterTrace viaja CON el APU guardado (trazabilidad matematica
    // pedida explicitamente, ver parametricTraceability.js): cualquiera que
    // inspeccione este APU despues -- guardado, reabierto, en su
    // historial/version, o exportado a PDF/Excel -- puede ver, por cada
    // parametro, su nombre/valor/unidad/origen/valor base original/si fue
    // modificado por el usuario/version-fecha del auxiliar cuando aplique.
    // Nunca se recalcula aqui: se construye UNA sola vez, con la MISMA
    // funcion que usa la UI en vivo del wizard.
    parametricSource: {
      elementId: elementDef.id, inputs, params,
      estadoPorValor: calcResult?.estadoPorValor || {},
      cantidades: calcResult?.cantidades || {},
      parameterTrace: buildParameterTrace({ elementDef, inputs, params, calcResult, auxiliaries })
    }
  };

  const item = {
    concept: base.concept, unit: base.unit, code: standardClave,
    qty: 1, referencePU: 0
  };
  return applyMarketPrices(standardizeAPU(base, item, index, sourceFile));
}
