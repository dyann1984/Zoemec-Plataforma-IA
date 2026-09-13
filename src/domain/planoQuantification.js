/* Cuantificacion final del plano (Fase B, puntos 9-10). Logica pura: recibe
   la lista de elementos YA REVISADOS de un planoTakeoff y agrega solo los
   que isQuantifiable(estado) acepta (VALIDADO_POR_USUARIO/CORREGIDO_POR_USUARIO,
   ver planoReview.js) -- un elemento DETECTADO_VECTORIAL o PROPUESTO_POR_IA
   sin revisar NUNCA entra a un total, sin importar su confianza. Este es el
   resumen que se muestra en "Revision humana" antes de (en una fase
   posterior) generar el catalogo de conceptos -- Fase B se detiene aqui. */
import { isQuantifiable } from './planoReview.js';
import { resolveEffectiveDimension } from './planoElementBuilder.js';

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

function bucketFor(tipo){
  if(tipo === 'muro') return 'muros';
  if(tipo === 'piso') return 'pisos';
  if(tipo === 'losa') return 'losas';
  if(tipo === 'plafon') return 'plafones';
  if(tipo === 'puerta') return 'puertas';
  if(tipo === 'ventana') return 'ventanas';
  if(tipo === 'columna') return 'columnas';
  if(tipo === 'habitacion') return 'habitaciones';
  return 'otros';
}

function emptyBucket(){
  return { mLineal: 0, m2: 0, m3: 0, piezas: 0, confianzaMin: null, elementos: [] };
}

/* Agrega un elemento ya confirmado a su bucket. `dimension` es el shape
   generico {longitud, ancho, altura, area, volumen, perimetro, piezas} --
   cada tipo usa solo los campos que le aplican; ninguno se inventa si el
   elemento no lo trae (undefined nunca se trata como 0 "silenciosamente":
   se omite del total y queda registrado en `camposFaltantes`). */
export function buildPlanoQuantification(elementos){
  const buckets = {};
  const excluidos = [];
  const camposFaltantes = [];

  for(const el of (Array.isArray(elementos) ? elementos : [])){
    if(!isQuantifiable(el?.estado)){
      const motivo = el?.estado === 'RECHAZADO'
        ? 'Rechazado por revision humana: nunca cuenta.'
        : 'No confirmado por revision humana todavia.';
      excluidos.push({ id: el?.id, tipo: el?.tipo, estado: el?.estado, motivo });
      continue;
    }
    const key = bucketFor(el.tipo);
    if(!buckets[key]) buckets[key] = emptyBucket();
    const bucket = buckets[key];
    const dim = resolveEffectiveDimension(el);

    if(dim.longitud != null) bucket.mLineal += num(dim.longitud);
    else if(el.tipo === 'muro') camposFaltantes.push({ id: el.id, tipo: el.tipo, campo: 'longitud' });

    if(dim.area != null) bucket.m2 += num(dim.area);
    else if(['muro', 'piso', 'losa', 'plafon', 'habitacion'].includes(el.tipo)) camposFaltantes.push({ id: el.id, tipo: el.tipo, campo: 'area' });

    if(dim.volumen != null) bucket.m3 += num(dim.volumen);

    const piezas = dim.piezas != null ? num(dim.piezas) : 1;
    if(['puerta', 'ventana', 'columna'].includes(el.tipo)) bucket.piezas += piezas;

    const confianza = Number.isFinite(Number(el.confianza ?? el.confianzaIA)) ? Number(el.confianza ?? el.confianzaIA) : null;
    if(confianza != null) bucket.confianzaMin = bucket.confianzaMin == null ? confianza : Math.min(bucket.confianzaMin, confianza);
    bucket.elementos.push(el.id);
  }

  const perimetroTotal = (buckets.habitaciones?.elementos || []).length
    ? (Array.isArray(elementos) ? elementos : [])
        .filter(el => el.tipo === 'habitacion' && isQuantifiable(el.estado) && resolveEffectiveDimension(el)?.perimetro != null)
        .reduce((s, el) => s + num(resolveEffectiveDimension(el).perimetro), 0)
    : 0;

  return {
    muros: buckets.muros || emptyBucket(),
    pisos: buckets.pisos || emptyBucket(),
    losas: buckets.losas || emptyBucket(),
    plafones: buckets.plafones || emptyBucket(),
    puertas: buckets.puertas || emptyBucket(),
    ventanas: buckets.ventanas || emptyBucket(),
    columnas: buckets.columnas || emptyBucket(),
    habitaciones: buckets.habitaciones || emptyBucket(),
    perimetroTotal,
    otros: buckets.otros || emptyBucket(),
    totalConfirmados: (Array.isArray(elementos) ? elementos : []).filter(el => isQuantifiable(el?.estado)).length,
    totalPendientes: excluidos.length,
    excluidos,
    camposFaltantes
  };
}

/* Resumen legible (punto 10: "Muros: ...", "Pisos: ...", etc.) -- formateo
   puro sobre buildPlanoQuantification, para que la UI y cualquier export
   futuro (catalogo, Fase C) lean el MISMO texto, nunca dos formatos. */
export function summarizePlanoQuantification(q){
  const fmt = (n, suffix) => `${(Math.round(n * 100) / 100).toLocaleString('es-MX')} ${suffix}`;
  return {
    muros: `${fmt(q.muros.mLineal, 'm')} / ${fmt(q.muros.m2, 'm²')}`,
    pisos: fmt(q.pisos.m2, 'm²'),
    losas: `${fmt(q.losas.m2, 'm²')}${q.losas.m3 ? ` / ${fmt(q.losas.m3, 'm³')}` : ''}`,
    plafones: fmt(q.plafones.m2, 'm²'),
    puertas: `${q.puertas.piezas} pza`,
    ventanas: `${q.ventanas.piezas} pza`,
    columnas: `${q.columnas.piezas} pza`,
    perimetros: fmt(q.perimetroTotal, 'm'),
    pendientesRevision: q.totalPendientes
  };
}
