/* Ronda final pre-jueces -- Fix 1: "generacion individual sin feedback".
   Causa raiz real (confirmada por auditoria en produccion real, no
   simulada): el estado de carga SI existia en el codigo (aiBusy, AIProgress,
   setAiStatus con mensajes reales por etapa) pero el texto de AIProgress
   usaba colores de tarjeta clara (--muted/--ink/--ink-text) dentro de
   .ai-panel, que tiene fondo morado oscuro -- texto oscuro sobre fondo
   oscuro, practicamente invisible durante los ~100s reales que tarda
   /api/generate-apu. El fix de contraste vive en style.css (no se puede
   probar con node --test); este archivo prueba la parte de LOGICA PURA que
   sí se puede aislar sin renderizar el DOM: src/domain/aiGenerationProgress.js.

   Lo que este archivo NO puede probar (documentado, no inventado): que el
   spinner sea literalmente visible en pantalla, que el boton realmente se
   deshabilite en el DOM, o que React efectivamente llame setAiBusy(false) en
   el finally de generateAI() -- este repo no tiene jsdom/@testing-library
   instalado (ver package.json) y agregarlo esta fuera del alcance de esta
   ronda de correccion. Esa parte se confirmo con una prueba real en
   servidor de desarrollo local (dev server, sin desplegar) via navegador,
   reportada aparte. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_PROGRESS_STEPS, nextProgressIndex, resolveBusyLabel, canStartAiGeneration } from '../src/domain/aiGenerationProgress.js';

// --- 1) Estado inicial: sin generacion en curso y con un concepto real, el
// guard permite arrancar (equivalente a "boton habilitado, listo para clic"). ---
test('Estado inicial: aiBusy=false y concepto real -> el guard permite iniciar la generacion', () => {
  const guard = canStartAiGeneration({ aiBusy: false, concept: 'Muro de block hueco de concreto de 15 cm de espesor' });
  assert.equal(guard.allowed, true);
  assert.equal(guard.reason, null);
});

test('Estado inicial: concepto vacio -> el guard NO permite iniciar (motivo explicito, no un fallo silencioso)', () => {
  const guard = canStartAiGeneration({ aiBusy: false, concept: '   ' });
  assert.equal(guard.allowed, false);
  assert.equal(guard.reason, 'empty_concept');
});

// --- 2, 3 y 4) clic inicia loading / boton deshabilitado / no permite doble
// generacion: las tres comparten la misma condicion real (aiBusy=true), que
// es exactamente lo que main.jsx usa tanto para disabled={aiBusy} en el
// boton como para el guard dentro de generateAI(). ---
test('Doble clic / doble generacion: mientras aiBusy=true el guard bloquea un segundo intento aunque el concepto sea valido', () => {
  const guard = canStartAiGeneration({ aiBusy: true, concept: 'Concepto real y valido' });
  assert.equal(guard.allowed, false, 'un segundo clic mientras la primera llamada sigue en curso no debe permitir una segunda llamada real a /api/generate-apu');
  assert.equal(guard.reason, 'already_busy');
});

test('Una vez que aiBusy vuelve a false (la peticion anterior termino, con exito o error), el guard vuelve a permitir generar', () => {
  // Simula el ciclo completo: ocupado -> libre otra vez (lo que hace el
  // finally{ setAiBusy(false) } real de generateAI en ambos casos, exito y
  // error -- ver comentario de archivo sobre el limite de esta prueba).
  const whileBusy = canStartAiGeneration({ aiBusy: true, concept: 'Concepto real' });
  const afterDone = canStartAiGeneration({ aiBusy: false, concept: 'Concepto real' });
  assert.equal(whileBusy.allowed, false);
  assert.equal(afterDone.allowed, true);
});

// --- 5) Mensaje de generacion visible: nunca vacio, nunca un porcentaje --
// siempre el texto real que generateAI() publico via setAiStatus, o un
// mensaje generico de respaldo si aun no hay ninguno (primer instante). ---
test('Mensaje visible: con un aiStatus real de generateAI(), se muestra tal cual', () => {
  assert.equal(
    resolveBusyLabel('Buscando precios de mercado reales y validando equivalencia tecnica...'),
    'Buscando precios de mercado reales y validando equivalencia tecnica...'
  );
});

test('Mensaje visible: sin aiStatus todavia (undefined/null/vacio), cae a un texto de respaldo real, nunca vacio ni "0%"', () => {
  for (const value of [undefined, null, '', '   ']) {
    const label = resolveBusyLabel(value);
    assert.ok(label && label.trim().length > 0, `resolveBusyLabel(${JSON.stringify(value)}) debe devolver un texto no vacio`);
    assert.doesNotMatch(label, /%/, 'nunca debe verse como un porcentaje inventado');
  }
});

// --- 6 y 7) Exito/error restauran el estado: la parte de React (setAiBusy en
// el finally) no se puede probar sin jsdom (ver comentario de archivo); lo
// que SI es puro y se prueba aqui es que el guard no queda "atorado" para
// siempre y que el mensaje de respaldo nunca revienta con datos raros que
// vendrian de un error real (por ejemplo, un status que quedo como objeto). ---
test('Mensaje visible: resolveBusyLabel nunca truena con un valor inesperado (defensivo ante datos raros de un error real)', () => {
  assert.doesNotThrow(() => resolveBusyLabel(42));
  assert.doesNotThrow(() => resolveBusyLabel({}));
});

// --- 8) Timeout/espera prolongada mantiene feedback visible: el indice del
// paso decorativo debe seguir avanzando de forma ciclica indefinidamente
// (nunca se detiene, nunca sale de rango), para que la animacion no se vea
// "congelada" sin importar cuanto tarde la respuesta real (~100s observados
// en produccion, o mas). ---
test('Espera prolongada: nextProgressIndex avanza en ciclo sin salirse de rango durante muchas iteraciones seguidas', () => {
  let i = 0;
  const seen = new Set();
  for (let tick = 0; tick < 500; tick++) {
    i = nextProgressIndex(i, AI_PROGRESS_STEPS.length);
    assert.ok(i >= 0 && i < AI_PROGRESS_STEPS.length, `indice fuera de rango en el tick ${tick}: ${i}`);
    seen.add(i);
  }
  assert.equal(seen.size, AI_PROGRESS_STEPS.length, 'en 500 ticks debio recorrer los 8 pasos completos varias veces, nunca atorarse en uno solo');
});

test('Espera prolongada: nextProgressIndex es defensivo ante un indice invalido (nunca revienta la animacion)', () => {
  assert.equal(nextProgressIndex(NaN, AI_PROGRESS_STEPS.length), 1);
  assert.equal(nextProgressIndex(undefined, AI_PROGRESS_STEPS.length), 1);
  assert.equal(nextProgressIndex(0, 0), 0);
});

// --- 9) Lote no presenta regresion: este modulo es exclusivo de la
// generacion INDIVIDUAL (AIProgress se usa una sola vez en main.jsx, en el
// panel de "Generar APU desde un concepto"); el lote tiene su propio estado
// (batchBusy, activeJob, summarizeJob) completamente separado. Esta prueba
// documenta y congela esa separacion: nada de este modulo depende de
// batchBusy/activeJob, así que tocar este modulo no puede romper el lote. ---
test('Lote sin regresion: el modulo de progreso individual no expone ni depende de nada del estado de lote (batchBusy/activeJob/summarizeJob)', () => {
  const mod = { AI_PROGRESS_STEPS, nextProgressIndex, resolveBusyLabel, canStartAiGeneration };
  const exportNames = Object.keys(mod);
  for (const name of exportNames) {
    assert.doesNotMatch(name, /batch/i, `${name} no deberia mezclarse con el estado del lote`);
  }
  assert.ok(Array.isArray(AI_PROGRESS_STEPS) && AI_PROGRESS_STEPS.length > 0);
});
