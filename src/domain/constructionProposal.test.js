import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DATA_ORIGIN, CONSTRUCTION_SYSTEM_KEYS,
  makeEmptyConstructionProposal, normalizeConstructionProposal, deriveApuConceptsFromProposal
} from './constructionProposal.js';

test('makeEmptyConstructionProposal: forma vacia, todo sin origen, requiere validacion por defecto', () => {
  const proposal = makeEmptyConstructionProposal();
  assert.equal(proposal.dimensiones.largo.valor, null);
  assert.equal(proposal.dimensiones.largo.origen, null);
  assert.deepEqual(proposal.sistemaConstructivo.muros, []);
  assert.equal(proposal.requiresProfessionalValidation, true);
});

test('normalizeConstructionProposal: acepta dimensiones DETECTADO/PROPORCIONADO reales', () => {
  const proposal = normalizeConstructionProposal({
    descripcion: 'Terraza cubierta',
    dimensiones: {
      largo: { valor: 4.2, origen: DATA_ORIGIN.PROPORCIONADO },
      ancho: { valor: 3.5, origen: DATA_ORIGIN.DETECTADO },
      superficie: { valor: 14.7, origen: DATA_ORIGIN.INFERIDO }
    },
    sistemaConstructivo: { muros: ['Block hueco 15cm'], acabados: ['Pintura vinilica'] }
  });
  assert.equal(proposal.dimensiones.largo.valor, 4.2);
  assert.equal(proposal.dimensiones.largo.origen, 'proporcionado');
  assert.equal(proposal.dimensiones.ancho.origen, 'detectado');
  assert.deepEqual(proposal.sistemaConstructivo.muros, ['Block hueco 15cm']);
  assert.deepEqual(proposal.sistemaConstructivo.acabados, ['Pintura vinilica']);
});

test('normalizeConstructionProposal: un valor sin origen reconocido nunca se acepta como dato', () => {
  const proposal = normalizeConstructionProposal({
    dimensiones: { largo: { valor: 5, origen: 'adivinado_de_la_nada' } }
  });
  assert.equal(proposal.dimensiones.largo.valor, null);
  assert.equal(proposal.dimensiones.largo.origen, null);
});

test('normalizeConstructionProposal: un valor no numerico o <=0 nunca se acepta aunque el origen sea valido', () => {
  assert.equal(normalizeConstructionProposal({ dimensiones: { altura: { valor: 'alto', origen: DATA_ORIGIN.DETECTADO } } }).dimensiones.altura.valor, null);
  assert.equal(normalizeConstructionProposal({ dimensiones: { altura: { valor: -3, origen: DATA_ORIGIN.DETECTADO } } }).dimensiones.altura.valor, null);
  assert.equal(normalizeConstructionProposal({ dimensiones: { altura: { valor: 0, origen: DATA_ORIGIN.DETECTADO } } }).dimensiones.altura.valor, null);
});

test('requiresProfessionalValidation: se activa si alguna dimension es INFERIDO/ESTIMADO', () => {
  const conDetectado = normalizeConstructionProposal({ dimensiones: { largo: { valor: 3, origen: DATA_ORIGIN.DETECTADO } } });
  assert.equal(conDetectado.requiresProfessionalValidation, false);
  const conEstimado = normalizeConstructionProposal({ dimensiones: { largo: { valor: 3, origen: DATA_ORIGIN.ESTIMADO } } });
  assert.equal(conEstimado.requiresProfessionalValidation, true);
});

test('requiresProfessionalValidation: SIEMPRE se activa si hay contenido en cimentacion o estructura, sin importar el origen de las dimensiones', () => {
  const proposal = normalizeConstructionProposal({
    dimensiones: { largo: { valor: 3, origen: DATA_ORIGIN.PROPORCIONADO } },
    sistemaConstructivo: { estructura: ['Losa de concreto armado'] }
  });
  assert.equal(proposal.requiresProfessionalValidation, true);
});

test('deriveApuConceptsFromProposal: un concepto por elemento real, con su categoria, en el mismo orden de CONSTRUCTION_SYSTEM_KEYS', () => {
  const proposal = normalizeConstructionProposal({
    sistemaConstructivo: { preliminares: ['Trazo y nivelacion'], muros: ['Block 15cm', 'Aplanado fino'], acabados: [] }
  });
  const concepts = deriveApuConceptsFromProposal(proposal);
  assert.deepEqual(concepts, [
    { categoria: 'preliminares', concept: 'Trazo y nivelacion' },
    { categoria: 'muros', concept: 'Block 15cm' },
    { categoria: 'muros', concept: 'Aplanado fino' }
  ]);
});

test('deriveApuConceptsFromProposal: propuesta vacia da lista vacia, nunca inventa un concepto de relleno', () => {
  assert.deepEqual(deriveApuConceptsFromProposal(makeEmptyConstructionProposal()), []);
  assert.deepEqual(deriveApuConceptsFromProposal(null), []);
});

test('CONSTRUCTION_SYSTEM_KEYS cubre las 7 categorias pedidas en el brief', () => {
  assert.deepEqual([...CONSTRUCTION_SYSTEM_KEYS], ['preliminares', 'cimentacion', 'estructura', 'muros', 'cubierta', 'instalaciones', 'acabados']);
});
