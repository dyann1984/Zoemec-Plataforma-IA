/* Componentes/sistemas del activo (Fase G, seccion 13). Cada componente
   puede traer fecha de instalacion, fabricante, modelo, proveedor,
   garantia, vida util, costo y documento -- todos OPCIONALES (seccion 12:
   nunca se inventa un dato que el usuario no capturo, el componente sigue
   siendo valido con solo tipo+nombre). El estado de garantia se CALCULA
   (computeWarrantyStatus), nunca se captura a mano -- una sola fuente de
   verdad para "vigente/por vencer/vencida". */
export const ASSET_COMPONENT_TYPE = Object.freeze({
  ESTRUCTURA: 'ESTRUCTURA', CUBIERTA: 'CUBIERTA', IMPERMEABILIZACION: 'IMPERMEABILIZACION',
  ELECTRICA: 'ELECTRICA', HIDRAULICA: 'HIDRAULICA', SANITARIA: 'SANITARIA', HVAC: 'HVAC',
  BOMBAS: 'BOMBAS', ELEVADORES: 'ELEVADORES', EQUIPOS_ESPECIALES: 'EQUIPOS_ESPECIALES', ACABADOS: 'ACABADOS'
});

export const WARRANTY_STATUS = Object.freeze({ SIN_DATOS: 'SIN_DATOS', VIGENTE: 'VIGENTE', POR_VENCER: 'POR_VENCER', VENCIDA: 'VENCIDA' });
const WARRANTY_WARNING_DAYS = 60; // "proxima a vencer" documentado: 60 dias o menos de vigencia restante.

export function makeEmptyAssetComponent({
  id = null, assetId, projectId = null, tipo, nombre,
  fechaInstalacion = null, fabricante = null, modelo = null, proveedor = null,
  garantiaMeses = null, garantiaVigenciaHasta = null, vidaUtilAnios = null, costo = null,
  documentoGarantiaUrl = null, trazabilidad = null
} = {}){
  const now = new Date().toISOString();
  // Si no se declara explicitamente la fecha de vigencia de garantia pero
  // si hay fecha de instalacion + meses de garantia, se DERIVA (nunca se
  // inventa un plazo default) -- calculo de fecha real, no una suposicion.
  const vigenciaCalculada = garantiaVigenciaHasta || (fechaInstalacion && garantiaMeses
    ? new Date(new Date(fechaInstalacion).setMonth(new Date(fechaInstalacion).getMonth() + Number(garantiaMeses))).toISOString()
    : null);
  return {
    id, assetId, projectId, tipo, nombre,
    fechaInstalacion, fabricante, modelo, proveedor,
    garantiaMeses: garantiaMeses != null ? Number(garantiaMeses) : null,
    garantiaVigenciaHasta: vigenciaCalculada,
    vidaUtilAnios: vidaUtilAnios != null ? Number(vidaUtilAnios) : null,
    costo: costo != null ? Number(costo) : null,
    documentoGarantiaUrl, trazabilidad,
    createdAt: now, updatedAt: now, archivedAt: null
  };
}

export function validateAssetComponent(component){
  const errors = [];
  if(!component || typeof component !== 'object') errors.push('El componente no tiene una forma valida.');
  if(!component?.assetId) errors.push('El componente debe pertenecer a un activo.');
  if(!Object.values(ASSET_COMPONENT_TYPE).includes(component?.tipo)) errors.push('tipo invalido.');
  if(!component?.nombre) errors.push('El componente necesita un nombre.');
  return { valid: errors.length === 0, errors };
}

export function computeWarrantyStatus(component, now = new Date().toISOString()){
  if(!component?.garantiaVigenciaHasta) return { warrantyStatus: WARRANTY_STATUS.SIN_DATOS, diasRestantes: null };
  const diasRestantes = Math.floor((new Date(component.garantiaVigenciaHasta).getTime() - new Date(now).getTime()) / 86400000);
  if(diasRestantes < 0) return { warrantyStatus: WARRANTY_STATUS.VENCIDA, diasRestantes };
  if(diasRestantes <= WARRANTY_WARNING_DAYS) return { warrantyStatus: WARRANTY_STATUS.POR_VENCER, diasRestantes };
  return { warrantyStatus: WARRANTY_STATUS.VIGENTE, diasRestantes };
}
