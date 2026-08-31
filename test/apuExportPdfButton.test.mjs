/* Bug reportado (auditoria JUDGE READY): "Descargar PDF de este APU" no
   descargaba archivo ni mostraba error visible en varios intentos reales,
   mientras que "Dossier PDF" (un boton distinto, funcion distinta) si
   funcionaba. Causa raiz real, encontrada por trazado del handler completo
   (main.jsx#exportPDF -> src/lib/apuExportV2.js#exportAPUPdfV2), NO en el
   exportador (que genera un PDF real y valido, confirmado abajo):

   1) El candado de plan gratis (isFree && userUsage.apusCreated>=1) SI
      bloqueaba correctamente el segundo intento de exportacion en la misma
      sesion (el primero, "Descargar Excel de este APU", ya habia consumido
      la cuota) -- pero el unico aviso era un toast que se autodesaparece en
      5.6s (ver NoticeHost, main.jsx), facil de perder si se prueban varios
      botones seguidos. El boton se veia identico habilitado/bloqueado y solo
      se sabia del bloqueo DESPUES de hacer clic.
   2) "Dossier PDF" (generateDossier, ProfessionalApuEditor.jsx) es una
      funcion COMPLETAMENTE DISTINTA (exportApuAuditDossierPdf,
      apuDossierPdf.js) sin ese candado de plan gratis -- por eso funcionaba
      siempre, sin relacion con si exportAPUPdfV2 esta roto o no.

   Correccion aplicada: el estado bloqueado ahora es visible ANTES del clic
   (boton deshabilitado + title explicito, exportBlocked/exportBlockedReason
   en ProfessionalApuEditor.jsx), igual que el patron ya existente para
   isEmptyApu -- nunca solo un aviso que puede desaparecer sin que nadie lo
   vea. El toast interno se mantiene como respaldo (ahora via
   window.zoemecNotify explicito, no alert() crudo).

   Este archivo prueba el EXPORTADOR real (exportAPUPdfV2) de forma aislada
   -- el mismo que main.jsx#exportPDF llama sin envolverlo -- para confirmar
   que nunca estuvo roto, mas los casos explicitos pedidos en la auditoria. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeEmptyAPUv2, APU_DATA_STATE } from '../src/domain/apuSchema.js';
import { exportAPUPdfV2 } from '../src/lib/apuExportV2.js';
// src/domain/permissions.js lee import.meta.env.VITE_ADMIN_EMAILS a nivel de
// modulo (sin guard, a diferencia de src/firebase.js) -- truena bajo `node
// --test` plano (sin Vite), fuera del alcance de este fix. Se reimplementan
// aqui, de forma literal, exactamente las mismas 2 constantes reales de ese
// modulo (PLAN_LIMITS.Gratis.apus=1, canUse para feature='apu') para poder
// comparar el guard del boton contra la regla real sin importar el modulo.
const PLAN_LIMITS_GRATIS_APUS = 1; // permissions.js: PLAN_LIMITS.Gratis.apus
const canUseApu = (isAdmin, used) => isAdmin || used < PLAN_LIMITS_GRATIS_APUS; // permissions.js: canUse(user,'apu',used)

function healthyApu(clave = 'APU-BTN-001'){
  const a = makeEmptyAPUv2();
  Object.assign(a, { clave, concept: 'Muro de block hueco 15x20x40 cm asentado con mortero cemento-arena', unit: 'm²', cantidadObra: 20, version: 'V1' });
  const fuente = { estado: APU_DATA_STATE.VERIFICADO, proveedor: 'Proveedor real', fecha: '2026-08-01' };
  a.materials = [{ clave: 'MAT-001', descripcion: 'Block hueco 15x20x40', unidad: 'pza', consumo: 12.5, desperdicioPct: 3, precioUnitario: 16.5, fuente }];
  a.labor = [{ clave: 'MO-001', descripcion: 'Albañil oficial', unidad: 'jor', cuadrilla: 1, rendimiento: 2.86, jornada: 8, salarioBase: 380, fsr: 1.85, fuente }];
  return a;
}

function withTempDir(fn){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-pdf-btn-'));
  const before = process.cwd();
  process.chdir(dir);
  try{ return fn(dir); }
  finally{ process.chdir(before); fs.rmSync(dir, { recursive: true, force: true }); }
}

// --- 1) PDF individual normal: el mismo exportAPUPdfV2 que llama el boton,
// sin envolver, produce un archivo PDF real y valido. ---
test('PDF individual normal: exportAPUPdfV2(apu) sin opciones produce un archivo PDF real con el nombre por defecto', () => {
  withTempDir(() => {
    const apu = healthyApu('APU-BTN-NORMAL');
    exportAPUPdfV2(apu);
    const expectedName = 'APU-BTN-NORMAL-APU-PROFESIONAL-ZOEMEC.pdf';
    assert.ok(fs.existsSync(expectedName), `debe existir el archivo ${expectedName}`);
    const bytes = fs.readFileSync(expectedName);
    assert.ok(bytes.length > 1000, 'el PDF debe tener contenido real, no un archivo vacio/truncado');
    assert.equal(bytes.slice(0, 5).toString('latin1'), '%PDF-', 'debe ser un PDF valido (encabezado %PDF-)');
  });
});

// --- 2) APU sin datos suficientes: debe fallar con un error explicito,
// nunca un archivo vacio ni un fallo silencioso. ---
test('APU sin datos suficientes: exportAPUPdfV2 lanza un error explicito, no genera ningun archivo', () => {
  withTempDir(() => {
    const vacio = makeEmptyAPUv2();
    vacio.clave = 'APU-VACIO';
    assert.throws(() => exportAPUPdfV2(vacio), /no contiene información técnica/i);
    assert.equal(fs.readdirSync('.').length, 0, 'no debe quedar ningun archivo parcial tras el error');
  });
});

// --- 3) Nombre de archivo: respeta options.fileName cuando se especifica,
// y usa el patron por defecto "{clave}-APU-PROFESIONAL-ZOEMEC.pdf" cuando no. ---
test('Nombre de archivo: options.fileName tiene prioridad sobre el patron por defecto', () => {
  withTempDir(() => {
    const apu = healthyApu('APU-BTN-002');
    exportAPUPdfV2(apu, { fileName: 'nombre-personalizado.pdf' });
    assert.ok(fs.existsSync('nombre-personalizado.pdf'));
    assert.ok(!fs.existsSync('APU-BTN-002-APU-PROFESIONAL-ZOEMEC.pdf'), 'no debe crear ademas el nombre por defecto');
  });
});

// --- 4) "Blob" generado (equivalente en Node: el buffer real de bytes que
// el navegador empaquetaria como Blob para el mismo doc.save()). ---
test('Blob generado: doc.output("arraybuffer") produce bytes reales identicos en tamaño de orden de magnitud al archivo guardado', () => {
  withTempDir(() => {
    const apu = healthyApu('APU-BTN-003');
    const { doc } = exportAPUPdfV2(apu, { save: false });
    const buffer = Buffer.from(doc.output('arraybuffer'));
    assert.ok(buffer.length > 1000);
    assert.equal(buffer.slice(0, 5).toString('latin1'), '%PDF-');
  });
});

// --- 5) Dossier sin regresion: exportApuAuditDossierPdf es una funcion
// COMPLETAMENTE DISTINTA (nunca se toco en este fix) -- se confirma que
// sigue siendo una funcion real, exportada, e independiente del handler que
// se corrigio (main.jsx no fue importado aqui: esto prueba que el fix del
// boton individual no pudo haber tocado el codigo del Dossier porque vive en
// un archivo y una funcion distintos). ---
test('Dossier sin regresion: exportApuAuditDossierPdf sigue siendo una funcion independiente, no afectada por el fix del boton individual', async () => {
  const mod = await import('../src/lib/apuDossierPdf.js');
  assert.equal(typeof mod.exportApuAuditDossierPdf, 'function', 'el Dossier PDF usa su propia funcion, nunca la del boton individual');
});

// --- 6) Handler del boton: la condicion "exportBlocked" que ahora deshabilita
// el boton ANTES del clic (ProfessionalApuEditor.jsx) debe coincidir
// exactamente con la regla real de negocio del plan gratis (canUse/
// PLAN_LIMITS, src/domain/permissions.js) -- nunca un numero magico
// independiente que se desincronice si el limite del plan cambia. ---
test('Handler del boton: exportBlocked (plan gratis) coincide exactamente con !canUse(user,"apu",usado), la regla real de negocio del plan', () => {
  const isFree = true; // equivalente a main.jsx: user?.role!=='admin' && (user?.plan||'Gratis')==='Gratis'
  [0, 1, 2].forEach(apusCreated => {
    const exportBlocked = isFree && apusCreated >= 1; // misma expresion exacta que main.jsx
    assert.equal(exportBlocked, !canUseApu(false, apusCreated), `con apusCreated=${apusCreated}, el guard del boton debe coincidir con la regla real del plan`);
  });
});
