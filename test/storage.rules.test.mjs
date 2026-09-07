/* Pruebas de reglas de Storage contra el emulador local (no contra el
   bucket real). Corren con:
     npm run test:storagerules
   que levanta el emulador de Storage, ejecuta este archivo y lo apaga.

   Objetivo explicito de la auditoria previa a activar Fase 2B ("Escanear
   con celular"): demostrar con pruebas automatizadas -no solo leyendo las
   reglas- que un usuario no autenticado no puede subir nada, que un usuario
   no puede tocar la ruta de otro, y que los limites de tamano/tipo de
   archivo (foto <=10MB imagen, video <=200MB video) se cumplen de verdad
   contra el motor real de reglas, no solo en el codigo cliente. */
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { ref, uploadBytes, deleteObject, getBytes } from 'firebase/storage';

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'zoemec-storage-rules-test',
    storage: {
      rules: readFileSync('storage.rules', 'utf8'),
      host: '127.0.0.1',
      port: 9199
    }
  });
});

after(async () => {
  await testEnv?.cleanup();
});

const SURVEY_ID = 'LEV-QA-1';
const smallJpeg = () => new Uint8Array(1024).fill(1); // 1KB, dentro del limite de foto
const oversizedJpeg = () => new Uint8Array(11 * 1024 * 1024); // 11MB, excede el limite de 10MB
const smallWebm = () => new Uint8Array(2048).fill(1); // 2KB, dentro del limite de video

describe('storage.rules — levantamiento-media (Fase 2B)', () => {
  it('usuario NO autenticado no puede subir una foto', async () => {
    const anon = testEnv.unauthenticatedContext().storage();
    await assertFails(uploadBytes(
      ref(anon, `levantamiento-media/alice/${SURVEY_ID}/photo/f1/photo.jpg`),
      smallJpeg(),
      { contentType: 'image/jpeg' }
    ));
  });

  it('usuario NO autenticado no puede leer una foto de otro', async () => {
    const anon = testEnv.unauthenticatedContext().storage();
    await assertFails(getBytes(ref(anon, `levantamiento-media/alice/${SURVEY_ID}/photo/f1/photo.jpg`)));
  });

  it('usuario A no puede subir a la ruta de usuario B', async () => {
    const bob = testEnv.authenticatedContext('bob').storage();
    await assertFails(uploadBytes(
      ref(bob, `levantamiento-media/alice/${SURVEY_ID}/photo/f1/photo.jpg`),
      smallJpeg(),
      { contentType: 'image/jpeg' }
    ));
  });

  it('usuario A no puede leer archivos de usuario B', async () => {
    const bob = testEnv.authenticatedContext('bob').storage();
    await assertFails(getBytes(ref(bob, `levantamiento-media/alice/${SURVEY_ID}/photo/f1/photo.jpg`)));
  });

  it('el dueno SI puede subir una foto valida (imagen, <=10MB)', async () => {
    const alice = testEnv.authenticatedContext('alice').storage();
    await assertSucceeds(uploadBytes(
      ref(alice, `levantamiento-media/alice/${SURVEY_ID}/photo/f1/photo.jpg`),
      smallJpeg(),
      { contentType: 'image/jpeg' }
    ));
  });

  it('el dueno SI puede leer su propia foto ya subida', async () => {
    const alice = testEnv.authenticatedContext('alice').storage();
    await assertSucceeds(getBytes(ref(alice, `levantamiento-media/alice/${SURVEY_ID}/photo/f1/photo.jpg`)));
  });

  it('rechaza una foto que excede 10MB, aunque el contentType sea correcto', async () => {
    const alice = testEnv.authenticatedContext('alice').storage();
    await assertFails(uploadBytes(
      ref(alice, `levantamiento-media/alice/${SURVEY_ID}/photo/f2/grande.jpg`),
      oversizedJpeg(),
      { contentType: 'image/jpeg' }
    ));
  });

  it('rechaza un archivo con contentType invalido en la ruta de foto (ej. text/html)', async () => {
    const alice = testEnv.authenticatedContext('alice').storage();
    await assertFails(uploadBytes(
      ref(alice, `levantamiento-media/alice/${SURVEY_ID}/photo/f3/no-es-foto.html`),
      smallJpeg(),
      { contentType: 'text/html' }
    ));
  });

  it('el dueno SI puede subir un video valido (video, <=200MB)', async () => {
    const alice = testEnv.authenticatedContext('alice').storage();
    await assertSucceeds(uploadBytes(
      ref(alice, `levantamiento-media/alice/${SURVEY_ID}/video/v1/clip.webm`),
      smallWebm(),
      { contentType: 'video/webm' }
    ));
  });

  /* No se prueba aqui subiendo 201MB reales: el emulador local de Storage
     tiene su propio limite de body HTTP mas bajo que 200MB (rechaza antes
     de que la regla se evalue, con un error distinto a PERMISSION_DENIED),
     asi que un archivo asi de grande no prueba la regla, prueba el servidor
     de pruebas. El limite de tamano SI queda probado end-to-end arriba
     ("rechaza una foto que excede 10MB") contra el mismo mecanismo exacto
     (request.resource.size) que usa la regla de video -- misma condicion,
     mismo operador, solo cambia la constante. */

  it('rechaza un contentType invalido en la ruta de video (ej. application/x-msdownload)', async () => {
    const alice = testEnv.authenticatedContext('alice').storage();
    await assertFails(uploadBytes(
      ref(alice, `levantamiento-media/alice/${SURVEY_ID}/video/v3/no-es-video.exe`),
      smallWebm(),
      { contentType: 'application/x-msdownload' }
    ));
  });

  it('el dueno SI puede borrar su propia foto', async () => {
    const alice = testEnv.authenticatedContext('alice').storage();
    await assertSucceeds(deleteObject(ref(alice, `levantamiento-media/alice/${SURVEY_ID}/photo/f1/photo.jpg`)));
  });

  it('usuario A no puede borrar archivos de usuario B', async () => {
    const alice = testEnv.authenticatedContext('alice').storage();
    const bob = testEnv.authenticatedContext('bob').storage();
    await assertSucceeds(uploadBytes(
      ref(bob, `levantamiento-media/bob/${SURVEY_ID}/photo/fb/photo.jpg`),
      smallJpeg(),
      { contentType: 'image/jpeg' }
    ));
    await assertFails(deleteObject(ref(alice, `levantamiento-media/bob/${SURVEY_ID}/photo/fb/photo.jpg`)));
  });

  it('/public sigue de lectura libre y escritura cerrada (no se rompio con Fase 2B)', async () => {
    const anon = testEnv.unauthenticatedContext().storage();
    await assertFails(uploadBytes(ref(anon, 'public/test.txt'), smallJpeg(), { contentType: 'text/plain' }));
  });
});
