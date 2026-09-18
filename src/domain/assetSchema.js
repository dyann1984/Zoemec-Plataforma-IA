/* Ciclo de vida del activo (Fase G, secciones 11-12). Un `asset` se crea
   SOLO cuando un proyecto se marca como terminado/entregado -- nunca
   duplica el proyecto, solo lo REFERENCIA (`projectId`) junto con la
   version de Construction DNA vigente en ese momento
   (`constructionDnaVersion`), para que el activo conserve el snapshot
   tecnico exacto con el que se entrego, aunque el DNA del proyecto se
   vuelva a versionar despues (algo raro, pero posible si el proyecto se
   reabre). */
export const ASSET_STATUS = Object.freeze({ ACTIVO: 'ACTIVO', ARCHIVADO: 'ARCHIVADO' });

export function makeEmptyAsset({
  id = null, projectId, nombre = null, ubicacion = null, fechaEntrega = null,
  superficie = null, constructionDnaVersion = null
} = {}){
  const now = new Date().toISOString();
  return {
    id, projectId, nombre, ubicacion, fechaEntrega, superficie, constructionDnaVersion,
    status: ASSET_STATUS.ACTIVO, createdAt: now, updatedAt: now, archivedAt: null
  };
}

export function validateAsset(asset){
  const errors = [];
  if(!asset || typeof asset !== 'object') errors.push('El activo no tiene una forma valida.');
  if(!asset?.projectId) errors.push('El activo debe referenciar el proyecto del que proviene.');
  if(!asset?.nombre) errors.push('El activo necesita un nombre.');
  return { valid: errors.length === 0, errors };
}
