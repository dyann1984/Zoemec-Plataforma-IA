import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveConstructionDna } from './constructionDnaDerivation.js';
import { DNA_ORIGIN } from './constructionDnaSchema.js';

function concepto(overrides = {}){
  return { clave: 'C-1', capitulo: 'ALBANILERIA', concept: 'Muro de block hueco 15cm', unit: 'm²', qty: 40, ...overrides };
}

test('sin ningun dato, todos los campos quedan en Sin informacion (nunca lanza, nunca fabrica)', () => {
  const dna = deriveConstructionDna({ projectId: 'PRO-1' });
  assert.equal(dna.geometria.superficieConstruida.value, null);
  assert.equal(dna.geometria.areasPrincipales.value, null);
  assert.equal(dna.sistemaConstructivo.cimentacion.value, null);
  assert.equal(dna.recursos.materialesPrincipales.value, null);
  assert.equal(dna.costos.familiasPrincipales.value, null);
});

test('sistema constructivo se detecta por presencia real de conceptos en el capitulo, con evidencia (clave/descripcion)', () => {
  const catalogConceptos = [concepto({ clave: 'CIM-1', capitulo: 'CIMENTACION', concept: 'Zapata aislada' })];
  const dna = deriveConstructionDna({ projectId: 'PRO-1', catalogConceptos });
  assert.equal(dna.sistemaConstructivo.cimentacion.origin, DNA_ORIGIN.DETECTED);
  assert.equal(dna.sistemaConstructivo.cimentacion.value[0].clave, 'CIM-1');
  assert.equal(dna.sistemaConstructivo.estructura.value, null, 'sin conceptos de ESTRUCTURA, debe quedar sin informacion');
});

test('cubiertas se detecta por palabra clave (sin capitulo propio) -- nunca inventa un capitulo nuevo', () => {
  const catalogConceptos = [concepto({ capitulo: 'ESTRUCTURA', concept: 'Losa de azotea con impermeabilizante' })];
  const dna = deriveConstructionDna({ projectId: 'PRO-1', catalogConceptos });
  assert.equal(dna.sistemaConstructivo.cubiertas.origin, DNA_ORIGIN.DETECTED);
  assert.ok(dna.sistemaConstructivo.cubiertas.value.length >= 1);
});

test('instalaciones se clasifican por palabra clave en electrica/hidraulica/sanitaria/especiales', () => {
  const catalogConceptos = [
    concepto({ capitulo: 'INSTALACIONES', concept: 'Instalacion electrica en tablero principal' }),
    concepto({ capitulo: 'INSTALACIONES', concept: 'Instalacion hidraulica de agua potable' }),
    concepto({ capitulo: 'INSTALACIONES', concept: 'Instalacion sanitaria y drenaje' }),
    concepto({ capitulo: 'INSTALACIONES', concept: 'Instalacion de aire acondicionado' })
  ];
  const dna = deriveConstructionDna({ projectId: 'PRO-1', catalogConceptos });
  assert.equal(dna.instalaciones.electrica.value.length, 1);
  assert.equal(dna.instalaciones.hidraulica.value.length, 1);
  assert.equal(dna.instalaciones.sanitaria.value.length, 1);
  assert.equal(dna.instalaciones.especiales.value.length, 1, 'una instalacion sin palabra clave conocida cae en especiales, nunca se pierde');
});

test('geometria: muros/losas se suman por palabra clave, agrupados por unidad real (nunca se asume m²)', () => {
  const catalogConceptos = [
    concepto({ concept: 'Muro de block hueco 15cm', unit: 'm²', qty: 40 }),
    concepto({ concept: 'Muro de tabique rojo', unit: 'm²', qty: 10 }),
    concepto({ concept: 'Losa de entrepiso', capitulo: 'ESTRUCTURA', unit: 'm²', qty: 80 })
  ];
  const dna = deriveConstructionDna({ projectId: 'PRO-1', catalogConceptos });
  assert.equal(dna.geometria.muros.value[0].qty, 50);
  assert.equal(dna.geometria.muros.value[0].unit, 'm²');
  assert.equal(dna.geometria.losas.value[0].qty, 80);
});

test('recursos principales = top 5 por importe de la explosion YA calculada (Fase A), nunca un recalculo nuevo', () => {
  const explosionData = {
    materials: { rows: [{ descripcion: 'Cemento', importe: 5000 }, { descripcion: 'Grava', importe: 20000 }] },
    labor: { rows: [{ descripcion: 'Albañil', importe: 12000 }] },
    machinery: { maquinaria: [{ descripcion: 'Retroexcavadora', importe: 8000 }], equipo: [] }
  };
  const dna = deriveConstructionDna({ projectId: 'PRO-1', explosionData });
  assert.equal(dna.recursos.materialesPrincipales.value[0].descripcion, 'Grava', 'debe venir ordenado por importe descendente');
  assert.equal(dna.recursos.manoDeObra.value[0].descripcion, 'Albañil');
  assert.equal(dna.recursos.maquinariaEquipo.value[0].descripcion, 'Retroexcavadora');
});

test('costos: familias principales vienen de los subtotales por capitulo YA agregados, nivel de confianza del Confidence Engine real', () => {
  const capituloSubtotals = [{ capitulo: 'ALBANILERIA', label: 'Albañilería', importe: 15000 }, { capitulo: 'OTROS', label: 'Otros', importe: 0 }];
  const confidenceProject = { averageScore: 82, high: 3, medium: 1, low: 0, insufficientEvidence: 0 };
  const dna = deriveConstructionDna({ projectId: 'PRO-1', capituloSubtotals, confidenceProject });
  assert.equal(dna.costos.familiasPrincipales.value.length, 1, 'un capitulo con importe 0 no aporta informacion util, se descarta');
  assert.equal(dna.costos.nivelConfianza.value.averageScore, 82);
  assert.equal(dna.costos.nivelConfianza.origin, 'DERIVED');
});

test('costos regionales solo si hay ubicacion estructurada real (nunca default silencioso)', () => {
  const dnaSinUbicacion = deriveConstructionDna({ projectId: 'PRO-1', ubicacionEstructurada: null });
  assert.equal(dnaSinUbicacion.costos.costosRegionales.value, null);
  const dnaConUbicacion = deriveConstructionDna({ projectId: 'PRO-1', ubicacionEstructurada: { country: 'MX', state: 'Nuevo León', city: 'Monterrey' } });
  assert.equal(dnaConUbicacion.costos.costosRegionales.value.city, 'Monterrey');
});
