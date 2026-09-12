/* Motor de formulas parametricas (Cuantificador Parametrico ZOEMEC, Fase B).
   Puro y determinista -- sin React, sin Firebase, sin llamadas a IA. Cada
   elemento declara sus INPUTS geometricos (siempre capturados por el
   usuario, nunca ambiguos) y sus PARAMS tecnicos (con un valor por defecto
   de "modo sencillo", editable en "modo experto"). calculate() regresa
   cantidades + una lista normalizada de `consumos` que
   parametricApuAssembler.js convierte en renglones de APU.

   Alcance de este primer corte (Fase B, 1 elemento representativo por
   familia, ver plan aprobado): zapata_aislada, columna (solo rectangular
   -- circular queda como extension natural futura, no se sobre-construye
   ahora) y muro (huecos como un area agregada, no una lista de vanos
   editable -- misma logica de "no construir de mas en el primer corte").
   El registro esta deliberadamente armado para poder agregar los otros 14
   elementos del pedido sin rediseno: cada elemento nuevo solo necesita su
   propio {id,family,label,inputs,params,calculate}. */
import { STEEL_DENSITY_KG_PER_M3, rebarLinearWeightKgPerM } from './unitConversion.js';

export const PARAMETRIC_FAMILIES = Object.freeze({
  CIMENTACION: 'CIMENTACION', ESTRUCTURA: 'ESTRUCTURA', ALBANILERIA: 'ALBANILERIA'
});

/* estadoPorValor: solo se marca ASUMIDO cuando un PARAMETRO tecnico se
   quedo en su valor por defecto de modo sencillo (nunca los inputs
   geometricos -- esos siempre los escribe el usuario, no son un supuesto).
   Un parametro que el usuario edito explicitamente en modo experto queda
   FUERA de estadoPorValor -- su ausencia ahi significa "confirmado por el
   usuario", igual criterio que el resto de la app (nunca presentar un
   supuesto como dato confirmado, nunca marcar como supuesto algo que el
   usuario si escribio). */
function computeEstadoPorValor(paramDefs, params){
  const estadoPorValor = {};
  paramDefs.forEach(def => {
    const current = params?.[def.key];
    if(current === undefined || current === def.default) estadoPorValor[def.key] = 'ASUMIDO';
  });
  return estadoPorValor;
}

function resolveParams(paramDefs, params){
  const resolved = {};
  paramDefs.forEach(def => { resolved[def.key] = params?.[def.key] !== undefined ? params[def.key] : def.default; });
  return resolved;
}

const ZAPATA_AISLADA_PARAMS = [
  { key: 'pctAceroVolumen', label: 'Porcentaje de acero (peso/volumen de concreto)', unit: '%', default: 1.2, expertOnly: true },
  { key: 'usosCimbra', label: 'Usos de la cimbra', default: 4, expertOnly: true },
  { key: 'auxConcretoClave', label: 'Auxiliar de concreto', default: 'CONC-200' },
  { key: 'auxCimbraClave', label: 'Auxiliar de cimbra', default: 'CIMBRA-COMUN' }
];

const zapataAislada = {
  id: 'zapata_aislada', family: PARAMETRIC_FAMILIES.CIMENTACION, label: 'Zapata aislada', outputUnit: 'pza',
  inputs: [
    { key: 'largo', label: 'Largo', unit: 'm', min: 0.3 },
    { key: 'ancho', label: 'Ancho', unit: 'm', min: 0.3 },
    { key: 'peralte', label: 'Peralte', unit: 'm', min: 0.15 }
  ],
  params: ZAPATA_AISLADA_PARAMS,
  calculate(inputs, params){
    const p = resolveParams(ZAPATA_AISLADA_PARAMS, params);
    const { largo, ancho, peralte } = inputs;
    const volumenConcreto = largo * ancho * peralte;
    const pesoAcero = volumenConcreto * (p.pctAceroVolumen / 100) * STEEL_DENSITY_KG_PER_M3;
    const areaCimbraLateral = 2 * (largo + ancho) * peralte;
    return {
      cantidades: { volumenConcreto, pesoAcero, areaCimbraLateral },
      consumos: [
        { tipo: 'auxiliar', clave: p.auxConcretoClave, cantidad: volumenConcreto, unidad: 'm³' },
        { tipo: 'material', desc: 'Varilla corrugada de refuerzo', cantidad: pesoAcero, unidad: 'kg' },
        { tipo: 'auxiliar', clave: p.auxCimbraClave, cantidad: areaCimbraLateral / p.usosCimbra, unidad: 'm²' },
        // Mano de obra: se reutiliza el mismo renglon de cuadrilla que ya usa
        // el motor de plantillas por texto (SYSTEM_RESOURCES en
        // constructionSystems.js) para 'concreto'/'acero', escalado por la
        // cantidad real de este elemento -- nunca se inventa una cuadrilla
        // nueva. 'cimbra' no existe como tipo en SYSTEM_RESOURCES (ningun
        // concepto de texto libre lo dispara hoy); ese unico coeficiente si
        // es nuevo, documentado en parametricApuAssembler.js.
        { tipo: 'labor_sistema', sistemaId: 'concreto', cantidad: volumenConcreto },
        { tipo: 'labor_sistema', sistemaId: 'acero', cantidad: pesoAcero },
        { tipo: 'labor_cimbra', cantidad: areaCimbraLateral }
      ],
      estadoPorValor: computeEstadoPorValor(ZAPATA_AISLADA_PARAMS, params)
    };
  }
};

const COLUMNA_PARAMS = [
  { key: 'numVarillasLongitudinales', label: 'Número de varillas longitudinales', default: 4, expertOnly: true },
  { key: 'diametroVarillaLongitudinal', label: 'Varilla longitudinal (número)', default: 4, expertOnly: true },
  { key: 'diametroEstribo', label: 'Estribo (número)', default: 3, expertOnly: true },
  { key: 'separacionEstribos', label: 'Separación de estribos', unit: 'm', default: 0.20, expertOnly: true },
  { key: 'recubrimiento', label: 'Recubrimiento', unit: 'm', default: 0.03, expertOnly: true },
  { key: 'usosCimbra', label: 'Usos de la cimbra', default: 4, expertOnly: true },
  { key: 'auxConcretoClave', label: 'Auxiliar de concreto', default: 'CONC-200' },
  { key: 'auxCimbraClave', label: 'Auxiliar de cimbra', default: 'CIMBRA-COMUN' }
];

const columna = {
  id: 'columna', family: PARAMETRIC_FAMILIES.ESTRUCTURA, label: 'Columna (sección rectangular)', outputUnit: 'pza',
  inputs: [
    { key: 'base', label: 'Base', unit: 'm', min: 0.15 },
    { key: 'peralte', label: 'Peralte', unit: 'm', min: 0.15 },
    { key: 'altura', label: 'Altura', unit: 'm', min: 0.5 }
  ],
  params: COLUMNA_PARAMS,
  calculate(inputs, params){
    const p = resolveParams(COLUMNA_PARAMS, params);
    const { base, peralte, altura } = inputs;
    const seccion = base * peralte;
    const volumenConcreto = seccion * altura;
    const perimetro = 2 * (base + peralte);
    const areaCimbra = perimetro * altura;

    const pesoLongitudinalPorM = rebarLinearWeightKgPerM(p.diametroVarillaLongitudinal) || 0;
    const pesoLongitudinal = p.numVarillasLongitudinales * altura * pesoLongitudinalPorM;

    // Perimetro de estribo aproximado al nucleo confinado (descontando
    // recubrimiento en las 2 direcciones) -- aproximacion estandar de
    // referencia, ajustable en modo experto via `recubrimiento`.
    const perimetroEstribo = 2 * ((base - 2 * p.recubrimiento) + (peralte - 2 * p.recubrimiento));
    const numEstribos = Math.ceil(altura / p.separacionEstribos) + 1;
    const TRASLAPE_GANCHO_M = 0.10; // longitud adicional por ganchos/traslape, valor de referencia
    const pesoEstribosPorM = rebarLinearWeightKgPerM(p.diametroEstribo) || 0;
    const pesoEstribos = numEstribos * (perimetroEstribo + TRASLAPE_GANCHO_M) * pesoEstribosPorM;

    return {
      cantidades: { volumenConcreto, areaCimbra, pesoLongitudinal, pesoEstribos, numEstribos },
      consumos: [
        { tipo: 'auxiliar', clave: p.auxConcretoClave, cantidad: volumenConcreto, unidad: 'm³' },
        { tipo: 'material', desc: `Varilla corrugada #${p.diametroVarillaLongitudinal} (longitudinal)`, cantidad: pesoLongitudinal, unidad: 'kg' },
        { tipo: 'material', desc: `Varilla corrugada #${p.diametroEstribo} (estribos)`, cantidad: pesoEstribos, unidad: 'kg' },
        { tipo: 'auxiliar', clave: p.auxCimbraClave, cantidad: areaCimbra / p.usosCimbra, unidad: 'm²' },
        { tipo: 'labor_sistema', sistemaId: 'concreto', cantidad: volumenConcreto },
        { tipo: 'labor_sistema', sistemaId: 'acero', cantidad: pesoLongitudinal + pesoEstribos },
        { tipo: 'labor_cimbra', cantidad: areaCimbra }
      ],
      estadoPorValor: computeEstadoPorValor(COLUMNA_PARAMS, params)
    };
  }
};

const MURO_PARAMS = [
  { key: 'anchoBlock', label: 'Ancho de pieza', unit: 'm', default: 0.39, expertOnly: true },
  { key: 'altoBlock', label: 'Alto de pieza', unit: 'm', default: 0.19, expertOnly: true },
  { key: 'espesorJunta', label: 'Espesor de junta', unit: 'm', default: 0.015, expertOnly: true },
  { key: 'desperdicioPiezasPct', label: 'Desperdicio de piezas', unit: '%', default: 5, expertOnly: true },
  { key: 'volumenMorteroJunteoPorM2', label: 'Mortero de junteo por m²', unit: 'm³/m²', default: 0.018, expertOnly: true },
  { key: 'numCarasAplanado', label: 'Caras con aplanado', default: 2, expertOnly: true },
  { key: 'espesorAplanado', label: 'Espesor de aplanado', unit: 'm', default: 0.015, expertOnly: true },
  { key: 'descPieza', label: 'Pieza de albañilería', default: 'Block hueco de concreto 15x20x40 cm' },
  { key: 'auxMorteroClave', label: 'Auxiliar de mortero', default: 'MORT-1-4' }
];

const muro = {
  id: 'muro', family: PARAMETRIC_FAMILIES.ALBANILERIA, label: 'Muro de block/mampostería', outputUnit: 'm²',
  inputs: [
    { key: 'largo', label: 'Largo', unit: 'm', min: 0.3 },
    { key: 'altura', label: 'Altura', unit: 'm', min: 0.3 },
    { key: 'areaVanos', label: 'Área de puertas/ventanas (total)', unit: 'm²', min: 0, default: 0 }
  ],
  params: MURO_PARAMS,
  calculate(inputs, params){
    const p = resolveParams(MURO_PARAMS, params);
    const { largo, altura, areaVanos = 0 } = inputs;
    const areaBruta = largo * altura;
    const areaNeta = Math.max(0, areaBruta - areaVanos);
    const moduloBlock = (p.anchoBlock + p.espesorJunta) * (p.altoBlock + p.espesorJunta);
    const numPiezas = Math.ceil((areaNeta / moduloBlock) * (1 + p.desperdicioPiezasPct / 100));
    const volumenMorteroJunteo = areaNeta * p.volumenMorteroJunteoPorM2;
    const areaAplanado = areaNeta * p.numCarasAplanado;
    const volumenMorteroAplanado = areaAplanado * p.espesorAplanado;
    const volumenMorteroTotal = volumenMorteroJunteo + volumenMorteroAplanado;

    return {
      cantidades: { areaBruta, areaNeta, numPiezas, volumenMorteroJunteo, areaAplanado, volumenMorteroAplanado },
      consumos: [
        { tipo: 'material', desc: p.descPieza, cantidad: numPiezas, unidad: 'pza' },
        { tipo: 'auxiliar', clave: p.auxMorteroClave, cantidad: volumenMorteroTotal, unidad: 'm³' },
        // 'block' y 'aplanado' SI existen en SYSTEM_RESOURCES con
        // coeficiente de mano de obra por m² -- se reutilizan tal cual.
        { tipo: 'labor_sistema', sistemaId: 'block', cantidad: areaNeta },
        { tipo: 'labor_sistema', sistemaId: 'aplanado', cantidad: areaAplanado }
      ],
      estadoPorValor: computeEstadoPorValor(MURO_PARAMS, params)
    };
  }
};

export const PARAMETRIC_ELEMENTS = Object.freeze({
  zapata_aislada: zapataAislada,
  columna,
  muro
});

export function listElementsByFamily(family){
  return Object.values(PARAMETRIC_ELEMENTS).filter(el => el.family === family);
}

export function getParametricElement(elementId){
  return PARAMETRIC_ELEMENTS[elementId] || null;
}
