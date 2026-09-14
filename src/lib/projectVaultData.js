/* Datos del Reporte Ejecutivo del Project Vault (Fase F, seccion 16). Mismo
   criterio que apuProjectDossierData.js/presupuestoExport.js: el exportador
   NUNCA confia en lo que el cliente tenga en memoria -- vuelve a pedir el
   Vault fresco a /api/project-vault (el MISMO endpoint que alimenta la UI,
   un solo motor de agregacion) justo antes de generar el archivo. */
import { apiGetSafe } from '../services/apiClient.js';

export async function fetchProjectVaultForExport(projectId){
  if(!projectId) throw new Error('Falta projectId para generar el reporte.');
  const data = await apiGetSafe(`/api/project-vault?projectId=${encodeURIComponent(projectId)}`);
  if(!data) throw new Error('No se pudo obtener el Project Vault para el reporte.');
  return data;
}
