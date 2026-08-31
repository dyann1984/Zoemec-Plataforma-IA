/* Ronda final pre-jueces -- Fix 2: "campo Cliente requerido sin mensaje
   visible". Causa raiz real (confirmada por auditoria en produccion real):
   el requisito de Cliente SI existia (save() en Projects, main.jsx, ya
   rechazaba el alta sin Cliente), pero el unico aviso era un alert() --
   convertido globalmente en un toast que se autodesaparece en 5.6s (ver
   NoticeHost) -- facil de perder, sin resaltar el campo ni enfocarlo. El
   requisito NO cambio: sigue siendo obligatorio Nombre y Cliente, igual que
   antes. Este archivo prueba la funcion pura que decide QUE falta
   (src/domain/projectDraftValidation.js); el resaltado visual (borde rojo,
   mensaje junto al campo, foco automatico) vive en main.jsx/style.css y se
   confirmo con una prueba real en servidor de desarrollo local (dev server,
   sin desplegar), reportada aparte. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProjectDraft } from '../src/domain/projectDraftValidation.js';

function baseDraft(overrides = {}) {
  return { name: 'Remodelación local comercial', client: 'Constructora Ejemplo', ubicacion: '', moneda: 'MXN', budget: '', progress: 0, status: 'Anteproyecto', ...overrides };
}

// --- 10) Cliente vacio impide creacion: sigue siendo obligatorio, igual que
// antes -- esta prueba fija que el requisito NO se elimino. ---
test('Cliente vacío impide la creación: validateProjectDraft reporta el campo Cliente como faltante', () => {
  const errors = validateProjectDraft(baseDraft({ client: '' }));
  assert.ok(errors.client, 'debe reportar un error para Cliente');
  assert.ok(!errors.name, 'Nombre sí estaba lleno, no debe reportarse como error');
});

test('Cliente con solo espacios en blanco también impide la creación (mismo trato que vacío)', () => {
  const errors = validateProjectDraft(baseDraft({ client: '   ' }));
  assert.ok(errors.client);
});

// --- 11) Mensaje de validación visible: el texto debe ser explícito y
// mencionar el campo exacto que falta, no un mensaje generico. ---
test('Mensaje de validación visible: el texto de error de Cliente es explícito y nombra el campo', () => {
  const errors = validateProjectDraft(baseDraft({ client: '' }));
  assert.match(errors.client, /cliente/i);
});

test('Mensaje de validación visible: el texto de error de Nombre es explícito y nombra el campo', () => {
  const errors = validateProjectDraft(baseDraft({ name: '' }));
  assert.match(errors.name, /nombre/i);
});

test('Mensaje de validación visible: si faltan ambos, se reportan los dos por separado (no solo el primero)', () => {
  const errors = validateProjectDraft(baseDraft({ name: '', client: '' }));
  assert.ok(errors.name);
  assert.ok(errors.client);
});

// --- 12) Cliente válido permite continuar: con ambos campos obligatorios
// llenos, no hay errores y el alta puede seguir (equivalente a lo que
// save() hace despues: crear el proyecto y activarlo). ---
test('Cliente válido permite continuar: con Nombre y Cliente llenos, no hay errores', () => {
  const errors = validateProjectDraft(baseDraft());
  assert.deepEqual(errors, {});
});

test('Campos opcionales vacíos (ubicación, presupuesto) no bloquean la creación', () => {
  const errors = validateProjectDraft(baseDraft({ ubicacion: '', budget: '' }));
  assert.deepEqual(errors, {});
});

// --- 13) Otros campos no se borran al fallar la validación: validateProjectDraft
// es una funcion PURA de solo lectura -- nunca debe mutar el draft que
// recibe, que es justo lo que garantiza que main.jsx pueda mostrar el error
// sin perder lo que el usuario ya escribio en Ubicación/Presupuesto/etc. ---
test('No borra información ya escrita: validateProjectDraft es de solo lectura, nunca muta el draft recibido', () => {
  const draft = baseDraft({ client: '', ubicacion: 'Monterrey, NL', budget: '150000' });
  const snapshotBefore = JSON.stringify(draft);
  validateProjectDraft(draft);
  assert.equal(JSON.stringify(draft), snapshotBefore, 'el draft no debe modificarse al validarlo, aunque falte un campo obligatorio');
});

test('No borra información ya escrita: valores no-string (budget numérico, progress numérico) no rompen la validación', () => {
  const errors = validateProjectDraft({ name: 'Proyecto X', client: 'Cliente Y', budget: 150000, progress: 40 });
  assert.deepEqual(errors, {});
});

test('Defensivo: un draft undefined/incompleto no revienta, solo reporta lo que falta', () => {
  assert.doesNotThrow(() => validateProjectDraft(undefined));
  const errors = validateProjectDraft({});
  assert.ok(errors.name);
  assert.ok(errors.client);
});
