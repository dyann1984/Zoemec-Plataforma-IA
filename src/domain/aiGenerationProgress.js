// Feedback visual de la generacion INDIVIDUAL de un APU con IA (main.jsx,
// generateAI/AIProgress). El backend (attemptGenerate, /api/generate-apu) no
// reporta progreso real ni porcentajes -- por eso este modulo nunca calcula
// un porcentaje, solo: (a) que texto mostrar mientras se espera, siempre a
// partir del paso real que generateAI() esta ejecutando (aiStatus) nunca
// inventado, y (b) el guard puro que decide si un clic puede iniciar una
// generacion nueva (evita doble clic / doble llamada al backend).
//
// Root cause real del hallazgo "parecia congelado" (auditoria pre-jueces):
// el estado de carga SI existia (aiBusy, AIProgress) pero su texto usaba
// colores de tarjeta clara (--muted/--ink/--ink-text) dentro de .ai-panel,
// que tiene fondo morado oscuro -- texto oscuro sobre fondo oscuro,
// practicamente invisible. El fix de contraste vive en style.css; este
// modulo solo cubre la parte de logica pura (que se puede probar sin
// renderizar el DOM).

export const AI_PROGRESS_STEPS = ['Analizando concepto...','Definiendo cuadrilla...','Calculando rendimientos...','Identificando materiales...','Evaluando equipo y herramienta...','Generando procedimiento...','Validando calidad y medición...','Construyendo APU...'];

// Avanza el indice del paso decorativo de forma ciclica e indefinida: por
// diseno nunca "termina" ni se atora, para que la animacion siga visible sin
// importar cuanto tarde la respuesta real (Prueba: timeout/espera
// prolongada mantiene feedback visible).
export function nextProgressIndex(currentIndex, stepsLength = AI_PROGRESS_STEPS.length) {
  if (!Number.isFinite(stepsLength) || stepsLength <= 0) return 0;
  const safeCurrent = Number.isFinite(currentIndex) ? currentIndex : 0;
  return (safeCurrent + 1) % stepsLength;
}

// Texto real mostrado junto al spinner mientras aiBusy es true. Nunca un
// porcentaje: si generateAI() todavia no publico un aiStatus (primer tick),
// cae a un mensaje generico pero sigue siendo un texto real de "en curso",
// nunca vacio ni "0%".
export function resolveBusyLabel(aiStatus, fallback = 'Generando APU con IA...') {
  const trimmed = String(aiStatus ?? '').trim();
  return trimmed || fallback;
}

// Guard puro que reproduce las condiciones reales de generateAI() (main.jsx)
// para decidir si un clic puede disparar una generacion nueva. Se usa para
// probar sin red/DOM que: un concepto vacio no arranca nada, y que mientras
// aiBusy es true un segundo clic (doble clic, tecla repetida, doble
// invocacion programada) se ignora en vez de disparar una segunda llamada
// real al backend.
export function canStartAiGeneration({ aiBusy, concept }) {
  if (aiBusy) return { allowed: false, reason: 'already_busy' };
  if (!String(concept ?? '').trim()) return { allowed: false, reason: 'empty_concept' };
  return { allowed: true, reason: null };
}
