import { finalizeProfessionalAPU } from './apuProfessional.js';
import { makeEmptyCatalogConcepto } from './catalogConceptoSchema.js';
// Controlled synthetic data. No generated explanations and no real supplier claims.
export function createNebiusDemo({ ownerUid = 'nebius-demo-engineer', organizationId = 'nebius-demo-org' } = {}) {
  const projectId = 'nebius-demo-las-palmas';
  const project = { id: projectId, ownerUid, organizationId, name: 'Residencial Las Palmas - Edificio A',
    nombre: 'Residencial Las Palmas - Edificio A', isDemo: true, moneda: 'MXN',
    descripcion: 'DEMO: datos sintéticos controlados para NVIDIA/Nebius.', createdAt: '2026-09-29T00:00:00.000Z' };
  const snapshot = finalizeProfessionalAPU({ schemaVersion: 2,
    id: 'nebius-demo-acero', projectId, proyecto: project.name, isDemo: true,
    clave: 'DEMO-ACERO-001', fechaBase: '2026-01-15',
    concept: 'Suministro y habilitado de acero de refuerzo', unit: 'kg', moneda: 'MXN', cantidadObra: 800,
    family: '', primaryActivity: 'acero', secondaryActivities: [], classificationMatch: 'exact',
    materials: [
      { clave: 'MAT-001', descripcion: 'Acero de refuerzo fy=4200 kg/cm²', unidad: 'kg', consumo: 1.05, precioUnitario: 24, desperdicioPct: 3,
        fuente: { proveedor: 'Cotización DEMO sintética', fecha: '2026-01-01', estado: 'ESTIMADO' } },
      { clave: 'MAT-002', descripcion: 'Alambre recocido #18', unidad: 'kg', consumo: 0.03, precioUnitario: 38 }
    ],
    labor: [
      { clave: 'MO-001', descripcion: 'Fierrero', cuadrilla: 1, rendimiento: 90, salarioBase: 650, fsr: 1.4,
        fuente: { proveedor: 'Tabulador regional DEMO', estado: 'ESTIMADO' } }
    ],
    equipment: [], consumables: [], seguridad: [],
    herramientaMenor: { modo: 'porcentaje', porcentaje: 3, detalle: [] },
    factores: { indCampo: 0, indOficina: 0, finance: 0, utility: 0, cargos: 0, iva: 16 },
    procedimientoConstructivo: ['Habilitar acero según planos', 'Armar y amarrar armados', 'Colocar en posición definitiva'],
    controlCalidad: ['Verificar grado del acero (fy=4200)', 'Revisar traslapes y recubrimientos'],
    criterioMedicion: { incluye: ['Acero', 'Alambre', 'Habilitado'], excluye: ['Cimbra', 'Concreto'], unidadMedicion: 'kg' },
    technicalJustifications: { materials: '', labor: '', equipment: '', smallTools: '', consumables: '', safety: '' },
    supuestos: [{ texto: 'Rendimiento asumido para estructura convencional (no especial)', categoria: 'rendimiento' }]
  });
  const concepto = { ...makeEmptyCatalogConcepto({ id: 'nebius-demo-concepto', projectId, clave: 'DEMO-ACERO',
    capitulo: 'ESTRUCTURA', concept: snapshot.concept, unit: snapshot.unit, qty: snapshot.cantidadObra }),
    ownerUid, organizationId, apuId: snapshot.id, apuVersionId: 'V1', status: 'ASOCIADO' };
  return { project, conceptos: [concepto], apus: [{ id: snapshot.id, ownerUid, organizationId, projectId, currentVersion: 'V1', snapshot,
    createdAt: project.createdAt, updatedAt: project.createdAt }] };
}
