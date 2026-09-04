/* Causa raiz real de "Descargar PDF de este APU" / "Dossier PDF" (produccion,
   zoemecia.com, 2026-09-03): el PDF SI se generaba (Blob real, tamano
   correcto) pero la descarga NUNCA se disparaba en el navegador -- sin
   ningun error visible. La prueba existente (test/apuExportPdfButton.test.mjs)
   daba falsa confianza: corre bajo `node --test` puro, sin `document`/
   `window`, asi que exportAPUPdfV2 sigue el camino Node de jsPDF
   (doc.save() escribe el archivo directo a disco via fs) -- el camino de
   NAVEGADOR de jsPDF (el que realmente usan los 2 botones reportados) nunca
   se ejercita ahi.

   Ese camino de navegador (jsPDF interno, node_modules/jspdf/dist/jspdf.es.js)
   arma un <a download> que JAMAS se agrega al DOM y dispara la "descarga"
   con node.dispatchEvent(new MouseEvent('click')). Chrome actual ignora esa
   accion por defecto para un click sintetico sobre un <a> desconectado --
   solo la ejecuta para node.click() nativo (o un click real de usuario).
   Confirmado en produccion con instrumentacion real: URL.createObjectURL SI
   se llamaba (Blob de 52KB/101KB, tipo application/pdf) pero ningun evento
   "click" llegaba nunca a un listener en document (captura), a diferencia
   de "Descargar Excel de este APU"/"Dossier Excel" (write-excel-file, que
   si usa node.click() nativo sobre un <a> insertado en el DOM -- por eso
   esos 2 botones nunca tuvieron el bug).

   Correccion aplicada (src/lib/apuExportV2.js#saveJsPdfDoc): bajo navegador
   real (typeof document!=='undefined'), reemplaza doc.save(fileName) por
   el mismo patron ya usado por el exportador de Excel: crear el <a>,
   agregarlo a document.body, node.click() NATIVO, quitarlo del DOM. Bajo
   Node (sin document) se sigue usando doc.save() tal cual -- cero cambio de
   comportamiento en la suite existente.

   Este archivo prueba el camino de NAVEGADOR con un DOM minimo simulado a
   mano (el repo no tiene jsdom/happy-dom): no se inventa un jsdom completo,
   solo lo estrictamente necesario para distinguir "se llamo dispatchEvent"
   (roto) de "se llamo click() nativo sobre un <a> ya insertado" (correcto),
   que es exactamente la diferencia de comportamiento real entre Chrome
   actual y el codigo viejo de jsPDF. */
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeEmptyAPUv2, APU_DATA_STATE } from '../src/domain/apuSchema.js';
import { exportAPUPdfV2, saveJsPdfDoc } from '../src/lib/apuExportV2.js';
import { exportApuAuditDossierPdf } from '../src/lib/apuDossierPdf.js';

function healthyApu(clave = 'APU-DL-001'){
  const a = makeEmptyAPUv2();
  Object.assign(a, { id: clave, clave, concept: 'Muro de block hueco 15x20x40 cm asentado con mortero cemento-arena', unit: 'm²', cantidadObra: 20, version: 'V1' });
  const fuente = { estado: APU_DATA_STATE.VERIFICADO, proveedor: 'Proveedor real', fecha: '2026-08-01' };
  a.materials = [{ clave: 'MAT-001', descripcion: 'Block hueco 15x20x40', unidad: 'pza', consumo: 12.5, desperdicioPct: 3, precioUnitario: 16.5, fuente }];
  a.labor = [{ clave: 'MO-001', descripcion: 'Albañil oficial', unidad: 'jor', cuadrilla: 1, rendimiento: 2.86, jornada: 8, salarioBase: 380, fsr: 1.85, fuente }];
  return a;
}

/* DOM minimo: un <a> creado via document.createElement se comporta como el
   <a download> real de un navegador para efectos de esta prueba --
   click() nativo marca _clicked=true (esto SI dispara la descarga real en
   Chrome); dispatchEvent(new MouseEvent('click')) sobre un nodo que nunca
   se agrego al DOM (_appended nunca paso a true) NO marca _clicked -- asi
   se distingue el patron roto (jsPDF interno) del corregido. */
let dom;
function installFakeBrowserDom(){
  const created = [];
  const revoked = [];
  let objectUrlCount = 0;
  dom = { created, revoked };
  globalThis.document = {
    body: {
      appendChild(node){ node._appended = true; },
      removeChild(node){ node._appended = false; }
    },
    createElement(tag){
      const node = {
        tagName: String(tag).toUpperCase(), _appended: false, _clicked: false,
        click(){ this._clicked = true; }, // equivalente real: activation behavior nativa del navegador
        dispatchEvent(){ return true; } // equivalente real: Chrome actual NO ejecuta la descarga para esto sobre un <a> desconectado
      };
      created.push(node);
      return node;
    }
  };
  const realURL = globalThis.URL;
  globalThis.URL = class extends realURL {
    static createObjectURL(blob){ objectUrlCount += 1; return `blob:fake-${objectUrlCount}`; }
    static revokeObjectURL(url){ revoked.push(url); }
  };
  globalThis.__realURL = realURL;
}
function uninstallFakeBrowserDom(){
  delete globalThis.document;
  globalThis.URL = globalThis.__realURL;
  delete globalThis.__realURL;
  dom = null;
}

test('saveJsPdfDoc (navegador): usa click() NATIVO sobre un <a> insertado y luego removido del DOM -- nunca dispatchEvent sobre uno desconectado', () => {
  installFakeBrowserDom();
  try{
    const fakeDoc = { output(type){ assert.equal(type, 'blob'); return { fake: true }; } };
    saveJsPdfDoc(fakeDoc, 'archivo-de-prueba.pdf');
    assert.equal(dom.created.length, 1, 'debe crear exactamente un <a>');
    const a = dom.created[0];
    assert.equal(a.tagName, 'A');
    assert.equal(a.download, 'archivo-de-prueba.pdf');
    assert.ok(String(a.href).startsWith('blob:'), 'href debe ser la URL del blob generado');
    assert.equal(a._clicked, true, 'debe invocar click() nativo -- el mismo mecanismo que ya usa el exportador de Excel (write-excel-file), que nunca tuvo este bug');
    assert.equal(a._appended, false, 'debe quedar removido del DOM despues de click() (igual que el patron ya usado para Excel)');
  } finally { uninstallFakeBrowserDom(); }
});

test('saveJsPdfDoc (Node, sin document): sigue usando doc.save() tal cual -- cero cambio de comportamiento para la suite existente', () => {
  assert.equal(typeof document, 'undefined', 'precondicion: esta prueba corre sin document, como el resto de la suite Node');
  let savedWith = null;
  const fakeDoc = { save(fileName){ savedWith = fileName; } };
  saveJsPdfDoc(fakeDoc, 'archivo-node.pdf');
  assert.equal(savedWith, 'archivo-node.pdf');
});

test('exportAPUPdfV2 (navegador simulado): "Descargar PDF de este APU" dispara una descarga real ademas de generar el PDF', () => {
  installFakeBrowserDom();
  try{
    const apu = healthyApu('APU-DL-PDF');
    const { doc } = exportAPUPdfV2(apu);
    assert.equal(dom.created.length, 1, 'debe intentar descargar exactamente un archivo');
    const a = dom.created[0];
    assert.equal(a.download, 'APU-DL-PDF-APU-PROFESIONAL-ZOEMEC.pdf');
    assert.equal(a._clicked, true, 'la descarga debe dispararse de verdad, no solo generarse el Blob en memoria');
    // El PDF generado sigue siendo real y valido (mismo doc que ya prueba
    // apuExportPdfButton.test.mjs bajo Node) -- output('blob') no lo corrompe.
    const buffer = Buffer.from(doc.output('arraybuffer'));
    assert.equal(buffer.slice(0, 5).toString('latin1'), '%PDF-');
  } finally { uninstallFakeBrowserDom(); }
});

/* PASO 6 del diagnostico de produccion: la exportacion de un APU ya
   generado debe funcionar aunque un servicio auxiliar (aqui, /api/apus,
   usado por el Dossier para buscar la version autoritativa server-side)
   este temporalmente caido -- apiGetSafe (services/apiClient.js) ya
   absorbe esa falla y el dossier cae a BORRADOR NO RESPALDADO (ver
   test/apuDossier.pdf.integration.test.mjs, CASO B); esta prueba confirma
   ademas que, en ese escenario, la descarga real (click nativo) SI se
   dispara -- no solo que el PDF se compone en memoria. */
test('Dossier PDF (navegador simulado): con /api/apus caido (fetch rechaza), exporta BORRADOR NO RESPALDADO y SI dispara la descarga real', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => { throw new Error('/api/apus no disponible (simulado, ver RESOURCE_EXHAUSTED/503 real en produccion)'); };
  installFakeBrowserDom();
  try{
    const apu = healthyApu('APU-DL-DOSSIER');
    const { data } = await exportApuAuditDossierPdf({ apu, apuId: apu.id });
    assert.equal(data.source, 'LOCAL_DRAFT', 'con la API auxiliar caida, nunca debe fingir una version server-side');
    assert.equal(data.verificationLabel, 'BORRADOR NO RESPALDADO');
    assert.equal(dom.created.length, 1, 'debe intentar descargar exactamente un archivo pese a la API caida');
    assert.equal(dom.created[0]._clicked, true, 'la descarga real debe dispararse aunque /api/apus haya fallado -- un servicio auxiliar caido nunca debe bloquear la descarga de un APU ya generado');
  } finally {
    uninstallFakeBrowserDom();
    global.fetch = originalFetch;
  }
});
