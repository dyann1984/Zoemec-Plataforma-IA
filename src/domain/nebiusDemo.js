import { finalizeProfessionalAPU } from './apuProfessional.js';
import { makeEmptyCatalogConcepto } from './catalogConceptoSchema.js';
// Controlled synthetic data. No generated explanations and no real supplier claims.
export function createNebiusDemo({ ownerUid = 'nebius-demo-engineer', organizationId = 'nebius-demo-org' } = {}) {
  const projectId = 'nebius-demo-las-palmas';
  const project = { id: projectId, ownerUid, organizationId, name: 'Residencial Las Palmas - Edificio A',
    nombre: 'Residencial Las Palmas - Edificio A', isDemo: true, moneda: 'MXN',
    descripcion: 'DEMO: datos sintéticos controlados para NVIDIA/Nebius.', createdAt: '2026-09-29T00:00:00.000Z' };
  const snapshot = finalizeProfessionalAPU({ id: 'nebius-demo-acero', projectId, proyecto: project.name, isDemo: true,
    concept: 'Suministro y habilitado de acero de refuerzo', unit: 'kg', moneda: 'MXN', cantidadObra: 800,
    primaryActivity: 'acero', classificationMatch: 'exact',
    materials: [{ descripcion: 'Acero de refuerzo', unidad: 'kg', consumo: 1.05, precioUnitario: 24, desperdicioPct: 3,
      fuente: { proveedor: 'Cotización DEMO sintética', fecha: '2026-01-01', estado: 'ESTIMADO' } },
      { descripcion: 'Alambre recocido', unidad: 'kg', consumo: 0.03, precioUnitario: 38 }],
    labor: [{ descripcion: 'Fierrero', cuadrilla: 1, rendimiento: 90, salarioBase: 650, fsr: 1.4 }],
    equipment: [], consumables: [], seguridad: [], factores: {},
    procedimientoConstructivo: ['Habilitar', 'Armar', 'Colocar'], controlCalidad: [], criterioMedicion: { unidadMedicion: 'kg' }
  });
  const concepto = { ...makeEmptyCatalogConcepto({ id: 'nebius-demo-concepto', projectId, clave: 'DEMO-ACERO',
    capitulo: 'ESTRUCTURA', concept: snapshot.concept, unit: snapshot.unit, qty: snapshot.cantidadObra }),
    ownerUid, organizationId, apuId: snapshot.id, apuVersionId: 'V1', status: 'ASOCIADO' };
  return { project, conceptos: [concepto], apus: [{ id: snapshot.id, ownerUid, organizationId, projectId, currentVersion: 'V1', snapshot,
    createdAt: project.createdAt, updatedAt: project.createdAt }] };
}
