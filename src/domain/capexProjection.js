/* CapEx futuro (Fase G, seccion 15). Modelo inicial: por componente, vida
   util + costo actual YA capturados (assetComponentSchema.js) determinan
   el año esperado de reemplazo y una prioridad. SIN inflacion futura salvo
   que el llamador pase `inflationRatePctPerYear` EXPLICITAMENTE (regla
   explicita del pedido: "no calcular inflacion sin una regla/configuracion
   explicita") -- sin esa tasa, el costo proyectado es el costo actual tal
   cual (conservador, nunca inventado). Un componente sin fecha de
   instalacion, vida util o costo queda `confiable:false` con el motivo --
   "Sin proyeccion confiable", nunca un numero inventado para rellenar el
   hueco. */
function toNumber(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }

export function computeCapexProjection(components = [], { now = new Date().toISOString(), inflationRatePctPerYear = null } = {}){
  // getUTCFullYear() (nunca getFullYear()): un ISO 'YYYY-01-01T00:00:00.000Z'
  // en un huso horario detras de UTC (Mexico, UTC-6) cae en el 31 de
  // diciembre del año anterior en hora LOCAL -- getFullYear() devolveria un
  // año equivocado. Mismo bug de fondo ya corregido en Fase E
  // (formatDateOnly), aqui se evita desde el origen usando siempre UTC.
  const currentYear = new Date(now).getUTCFullYear();
  return (components || []).map(c => {
    const missing = [];
    if(!c.fechaInstalacion) missing.push('fecha de instalación');
    if(!(c.vidaUtilAnios > 0)) missing.push('vida útil');
    if(!(c.costo > 0)) missing.push('costo');
    if(missing.length){
      return {
        componentId: c.id, nombre: c.nombre, confiable: false,
        reason: `Sin proyección confiable: falta ${missing.join(', ')}.`,
        anioEsperadoReemplazo: null, aniosRestantes: null, costoActual: c.costo ?? null, costoProyectado: null, prioridad: null
      };
    }
    const anioEsperadoReemplazo = new Date(c.fechaInstalacion).getUTCFullYear() + Number(c.vidaUtilAnios);
    const aniosRestantes = anioEsperadoReemplazo - currentYear;
    const costoProyectado = inflationRatePctPerYear != null
      ? toNumber(c.costo) * Math.pow(1 + inflationRatePctPerYear / 100, Math.max(0, Number(c.vidaUtilAnios)))
      : toNumber(c.costo);
    const prioridad = aniosRestantes <= 1 ? 'ALTA' : aniosRestantes <= 3 ? 'MEDIA' : 'BAJA';
    return {
      componentId: c.id, nombre: c.nombre, confiable: true, reason: null,
      vidaUtilAnios: Number(c.vidaUtilAnios), anioEsperadoReemplazo, aniosRestantes,
      costoActual: toNumber(c.costo), costoProyectado, prioridad,
      inflationApplied: inflationRatePctPerYear != null, inflationRatePctPerYear
    };
  });
}
