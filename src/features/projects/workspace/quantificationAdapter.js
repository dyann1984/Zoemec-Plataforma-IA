import { isQuantifiable } from '../../../domain/planoReview.js';
import { resolveEffectiveDimension } from '../../../domain/planoElementBuilder.js';
import { recomputeSurvey } from '../../../lib/levantamientoCalc.js';
import { ELEMENT_TYPE } from '../../../domain/levantamientoSchema.js';

/**
 * Adaptador de lectura y consolidación para la etapa Cuantificación de ZOEMEC.
 * Integra de forma determinista y sin duplicar:
 * 1. Takeoffs 2D sobre planos (elementos validados/corregidos y propuestos)
 * 2. Levantamiento IA (geometría de espacios calculada con deducción de vanos)
 * 3. Modelos 3D (dimensiones de envolvente / Bounding Box)
 *
 * REGLAS ARQUITECTÓNICAS ESTRICTAS:
 * - APU NO es fuente de Cuantificación: Cuantificación alimenta APU/Costos, nunca al revés.
 * - Regla canónica de muros netos: wallNetArea = Math.max(0, wallGrossArea - doorsArea - windowsArea - openingsArea).
 * - Aislamiento estricto por projectId.
 */

export const QUANTITY_SOURCE = Object.freeze({
  PLANO: 'plano',
  SURVEY: 'survey',
  MODEL_3D: 'model_3d'
});

export const QUANTITY_STATUS = Object.freeze({
  CONFIRMADO: 'confirmado',
  PROPUESTO: 'propuesto',
  ESTIMADO: 'estimado'
});

const TIPO_A_CATEGORIA = Object.freeze({
  muro: 'Muros',
  piso: 'Pisos',
  losa: 'Losas',
  plafon: 'Plafones',
  puerta: 'Puertas',
  ventana: 'Ventanas',
  columna: 'Estructura',
  trabe: 'Estructura',
  habitacion: 'Espacios',
  otro: 'Otros'
});

function round2(num) {
  const n = Number(num);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

/**
 * Crea un registro canónico inmutable de cantidad para el proyecto.
 */
export function makeProjectQuantityRecord({
  id,
  projectId,
  source = QUANTITY_SOURCE.PLANO,
  concept = '',
  category = 'Otros',
  quantity = 0,
  unit = '',
  origin = '',
  evidenceId = null,
  planId = null,
  surveyId = null,
  createdAt = Date.now(),
  status = QUANTITY_STATUS.PROPUESTO,
  metadata = {}
}) {
  return Object.freeze({
    id: String(id),
    projectId: String(projectId || ''),
    source,
    concept: String(concept || 'Sin concepto'),
    category: String(category || 'Otros'),
    quantity: round2(quantity),
    unit: String(unit || ''),
    origin: String(origin || ''),
    evidenceId: evidenceId ? String(evidenceId) : null,
    planId: planId ? String(planId) : null,
    surveyId: surveyId ? String(surveyId) : null,
    createdAt: Number(createdAt) || Date.now(),
    status,
    metadata: Object.freeze({ ...metadata })
  });
}

/**
 * Normaliza tipos de elementos en español canónico (ELEMENT_TYPE)
 * para compatibilidad con el motor de cálculo de Levantamiento IA.
 */
function normalizeSurveySpaceElements(rawSurvey) {
  if (!rawSurvey || !Array.isArray(rawSurvey.spaces)) return rawSurvey;
  return {
    ...rawSurvey,
    spaces: rawSurvey.spaces.map(space => {
      if (!space || !Array.isArray(space.elements)) return space;
      return {
        ...space,
        elements: space.elements.map(el => {
          if (!el || typeof el !== 'object') return el;
          let type = el.type;
          if (type === 'door') type = ELEMENT_TYPE.DOOR;
          else if (type === 'window') type = ELEMENT_TYPE.WINDOW;
          else if (type === 'opening') type = ELEMENT_TYPE.OPENING;
          return { ...el, type };
        })
      };
    })
  };
}

/**
 * Construye la lista consolidada de cantidades para el projectId activo.
 * NUNCA lee ni acepta APUs.
 */
export function buildProjectQuantityList({
  projectId,
  planoTakeoffs = [],
  surveys = [],
  evidenceItems = []
}) {
  if (!projectId) return [];

  const records = [];

  // 1. Procesar Takeoffs 2D sobre planos del proyecto
  const projectTakeoffs = (planoTakeoffs || []).filter(
    t => (t?.projectId ?? null) === projectId
  );

  for (const takeoff of projectTakeoffs) {
    const planId = takeoff.id || null;
    const fileName = takeoff.fileName || 'Plano';
    const elementos = Array.isArray(takeoff?.snapshot?.elementos)
      ? takeoff.snapshot.elementos
      : (Array.isArray(takeoff?.elementos) ? takeoff.elementos : []);

    for (const el of elementos) {
      if (!el || typeof el !== 'object') continue;

      const isConf = isQuantifiable(el.estado);
      const dim = resolveEffectiveDimension(el);

      // Determinar cantidad efectiva
      let qty = 0;
      if (el.cantidadCorregida != null && Number.isFinite(Number(el.cantidadCorregida))) {
        qty = Number(el.cantidadCorregida);
      } else if (el.cantidadPropuesta != null && Number.isFinite(Number(el.cantidadPropuesta))) {
        qty = Number(el.cantidadPropuesta);
      } else if (dim?.area != null && Number.isFinite(Number(dim.area))) {
        qty = Number(dim.area);
      } else if (dim?.longitud != null && Number.isFinite(Number(dim.longitud))) {
        qty = Number(dim.longitud);
      } else if (dim?.piezas != null && Number.isFinite(Number(dim.piezas))) {
        qty = Number(dim.piezas);
      } else if (dim?.volumen != null && Number.isFinite(Number(dim.volumen))) {
        qty = Number(dim.volumen);
      }

      // Determinar unidad
      const unit = el.unidadCorregida || el.unidad || (
        dim?.area != null ? 'm²' :
        dim?.longitud != null ? 'm' :
        dim?.volumen != null ? 'm³' : 'pza'
      );

      // Determinar categoría
      const category = TIPO_A_CATEGORIA[el.tipo] || 'Otros';

      // Concepto
      const concept = el.descripcionCorregida || el.descripcion ||
        `${category} detectado en ${fileName}`;

      records.push(
        makeProjectQuantityRecord({
          id: el.id ? `qty-plano-${el.id}` : `qty-plano-${planId}-${records.length}`,
          projectId,
          source: QUANTITY_SOURCE.PLANO,
          concept,
          category,
          quantity: qty,
          unit,
          origin: el.origin || 'plano-takeoff-vector',
          planId,
          createdAt: el.updatedAt || el.createdAt || takeoff.updatedAt || takeoff.createdAt || Date.now(),
          status: isConf ? QUANTITY_STATUS.CONFIRMADO : QUANTITY_STATUS.PROPUESTO,
          metadata: {
            elementId: el.id,
            tipo: el.tipo,
            estadoOriginal: el.estado,
            confianza: el.confianza ?? el.confianzaIA ?? null,
            fileName
          }
        })
      );
    }
  }

  // 2. Procesar Levantamientos IA (Surveys) del proyecto con fórmulas canónicas
  const projectSurveys = (surveys || []).filter(
    s => (s?.projectId ?? null) === projectId
  );

  for (const rawSurvey of projectSurveys) {
    const normalizedSurvey = normalizeSurveySpaceElements(rawSurvey);
    const survey = recomputeSurvey(normalizedSurvey);
    const surveyId = survey.id || null;
    const surveyName = survey.name || survey.title || 'Levantamiento';
    const spaces = Array.isArray(survey.spaces) ? survey.spaces : [];

    for (let i = 0; i < spaces.length; i++) {
      const space = spaces[i];
      const spaceName = space.name || `Espacio ${i + 1}`;
      const spacePrefix = `${surveyName} — ${spaceName}`;

      // 2.1 Superficie de piso
      if (space.floorArea > 0) {
        records.push(
          makeProjectQuantityRecord({
            id: `qty-survey-${surveyId}-${i}-piso`,
            projectId,
            source: QUANTITY_SOURCE.SURVEY,
            concept: `Superficie de piso (${spacePrefix})`,
            category: 'Pisos',
            quantity: space.floorArea,
            unit: 'm²',
            origin: 'levantamiento-ia',
            surveyId,
            createdAt: survey.updatedAt || survey.createdAt || Date.now(),
            status: QUANTITY_STATUS.CONFIRMADO,
            metadata: {
              spaceName,
              length: round2(space.length),
              width: round2(space.width)
            }
          })
        );
      }

      // 2.2 Muros netos (regresión canónica obligatoria con descuento de vanos)
      if (space.wallNetArea > 0) {
        records.push(
          makeProjectQuantityRecord({
            id: `qty-survey-${surveyId}-${i}-muros-netos`,
            projectId,
            source: QUANTITY_SOURCE.SURVEY,
            concept: `Muros netos con descuento de vanos (${spacePrefix})`,
            category: 'Muros',
            quantity: space.wallNetArea,
            unit: 'm²',
            origin: 'levantamiento-ia',
            surveyId,
            createdAt: survey.updatedAt || survey.createdAt || Date.now(),
            status: QUANTITY_STATUS.CONFIRMADO,
            metadata: {
              spaceName,
              wallGrossArea: round2(space.wallGrossArea),
              doorsArea: round2(space.doorsArea),
              windowsArea: round2(space.windowsArea),
              openingsArea: round2(space.openingsArea),
              perimeter: round2(space.perimeter),
              height: round2(space.height)
            }
          })
        );
      }

      // 2.3 Plafón / Techo
      if (space.ceilingArea > 0) {
        records.push(
          makeProjectQuantityRecord({
            id: `qty-survey-${surveyId}-${i}-plafon`,
            projectId,
            source: QUANTITY_SOURCE.SURVEY,
            concept: `Plafón / Cielo raso (${spacePrefix})`,
            category: 'Plafones',
            quantity: space.ceilingArea,
            unit: 'm²',
            origin: 'levantamiento-ia',
            surveyId,
            createdAt: survey.updatedAt || survey.createdAt || Date.now(),
            status: QUANTITY_STATUS.CONFIRMADO,
            metadata: { spaceName }
          })
        );
      }

      // 2.4 Perímetro / Rodapié
      if (space.perimeter > 0) {
        records.push(
          makeProjectQuantityRecord({
            id: `qty-survey-${surveyId}-${i}-perimetro`,
            projectId,
            source: QUANTITY_SOURCE.SURVEY,
            concept: `Perímetro / Rodapié (${spacePrefix})`,
            category: 'Acabados',
            quantity: space.perimeter,
            unit: 'm',
            origin: 'levantamiento-ia',
            surveyId,
            createdAt: survey.updatedAt || survey.createdAt || Date.now(),
            status: QUANTITY_STATUS.CONFIRMADO,
            metadata: { spaceName }
          })
        );
      }

      // 2.5 Volumen interior
      if (space.volume > 0) {
        records.push(
          makeProjectQuantityRecord({
            id: `qty-survey-${surveyId}-${i}-volumen`,
            projectId,
            source: QUANTITY_SOURCE.SURVEY,
            concept: `Volumen interior (${spacePrefix})`,
            category: 'Volumen',
            quantity: space.volume,
            unit: 'm³',
            origin: 'levantamiento-ia',
            surveyId,
            createdAt: survey.updatedAt || survey.createdAt || Date.now(),
            status: QUANTITY_STATUS.CONFIRMADO,
            metadata: { spaceName }
          })
        );
      }

      // 2.6 Elementos del espacio (puertas, ventanas, aberturas)
      const spaceElements = Array.isArray(space.elements) ? space.elements : [];
      spaceElements.forEach((el, elIdx) => {
        const qty = Number(el.quantity || 1);
        if (qty > 0) {
          const isDoor = el.type === ELEMENT_TYPE.DOOR || el.type === 'door';
          const isWin = el.type === ELEMENT_TYPE.WINDOW || el.type === 'window';
          const cat = isDoor ? 'Puertas' : isWin ? 'Ventanas' : 'Vanos';
          const elLabel = el.name || (isDoor ? 'Puerta' : isWin ? 'Ventana' : 'Abertura');
          records.push(
            makeProjectQuantityRecord({
              id: `qty-survey-${surveyId}-${i}-elem-${elIdx}`,
              projectId,
              source: QUANTITY_SOURCE.SURVEY,
              concept: `${elLabel} (${spacePrefix})`,
              category: cat,
              quantity: qty,
              unit: 'pza',
              origin: 'levantamiento-ia',
              surveyId,
              createdAt: survey.updatedAt || survey.createdAt || Date.now(),
              status: QUANTITY_STATUS.CONFIRMADO,
              metadata: {
                spaceName,
                width: round2(el.width),
                height: round2(el.height),
                area: round2(el.area)
              }
            })
          );
        }
      });
    }
  }

  // 3. Procesar modelos 3D de Evidencia (Bounding Box / Envolvente)
  const project3dItems = (evidenceItems || []).filter(
    e => (e?.projectId ?? null) === projectId && (
      e.kind === '3d' || e.type === 'model_3d' ||
      String(e.name || '').match(/\.(glb|gltf|obj)$/i)
    )
  );

  for (const item of project3dItems) {
    const bbox = item.metadata?.boundingBox;
    const size = bbox?.size;
    if (size && (size.x > 0 || size.y > 0 || size.z > 0)) {
      const vol = round2(Number(size.x || 0) * Number(size.y || 0) * Number(size.z || 0));
      if (vol > 0) {
        records.push(
          makeProjectQuantityRecord({
            id: `qty-3d-${item.id}-envolvente`,
            projectId,
            source: QUANTITY_SOURCE.MODEL_3D,
            concept: `Envolvente 3D Bounding Box (${item.name || 'Modelo 3D'})`,
            category: 'Volumen',
            quantity: vol,
            unit: 'm³',
            origin: 'modelo-3d',
            evidenceId: item.id,
            createdAt: item.createdAt || Date.now(),
            status: QUANTITY_STATUS.ESTIMADO,
            metadata: {
              dimensions: {
                length: round2(size.x),
                height: round2(size.y),
                depth: round2(size.z)
              },
              meshCount: item.metadata?.meshCount || 0,
              triangleCount: item.metadata?.triangleCount || 0
            }
          })
        );
      }
    }

    if (item.metadata?.meshCount > 0) {
      records.push(
        makeProjectQuantityRecord({
          id: `qty-3d-${item.id}-mallas`,
          projectId,
          source: QUANTITY_SOURCE.MODEL_3D,
          concept: `Mallas geométricas (${item.name || 'Modelo 3D'})`,
          category: 'Estructura 3D',
          quantity: item.metadata.meshCount,
          unit: 'pza',
          origin: 'modelo-3d',
          evidenceId: item.id,
          createdAt: item.createdAt || Date.now(),
          status: QUANTITY_STATUS.ESTIMADO,
          metadata: {
            triangleCount: item.metadata?.triangleCount || 0
          }
        })
      );
    }
  }

  return records;
}

/**
 * Resumen cuantitativo para métricas rápidas del Workspace.
 */
export function calculateQuantificationSummary(records = []) {
  const validRecords = Array.isArray(records) ? records : [];
  const confirmedCount = validRecords.filter(r => r.status === QUANTITY_STATUS.CONFIRMADO).length;

  const planIds = new Set();
  const categories = new Set();

  let totalArea = 0;
  let totalLength = 0;
  let totalVolume = 0;
  let totalPieces = 0;
  let latestTs = 0;

  for (const r of validRecords) {
    if (r.planId) planIds.add(r.planId);
    if (r.category) categories.add(r.category);

    const q = Number(r.quantity) || 0;
    if (r.unit === 'm²') totalArea += q;
    else if (r.unit === 'm') totalLength += q;
    else if (r.unit === 'm³') totalVolume += q;
    else if (r.unit === 'pza') totalPieces += q;

    if (r.createdAt && r.createdAt > latestTs) {
      latestTs = r.createdAt;
    }
  }

  return {
    totalElements: validRecords.length,
    confirmedCount,
    pendingReviewCount: validRecords.length - confirmedCount,
    planosCount: planIds.size,
    categoriesCount: categories.size,
    categories: Array.from(categories),
    totalArea: round2(totalArea),
    totalLength: round2(totalLength),
    totalVolume: round2(totalVolume),
    totalPieces: Math.round(totalPieces),
    lastUpdated: latestTs || Date.now()
  };
}
