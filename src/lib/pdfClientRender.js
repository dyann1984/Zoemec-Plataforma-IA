/* Render de PDF a canvas en el CLIENTE (Fase B, punto 3/8): unico uso de
   pdfjs-dist en el navegador de este proyecto -- server/api-lib usa pdfjs
   solo para texto/geometria (ver _planoVectorExtract.mjs), nunca para
   render a imagen. Aqui es al reves: SOLO se usa para dibujar la pagina
   como fondo visual del visor/calibracion, nunca para volver a extraer
   geometria (eso ya lo hizo el servidor, con el mismo documento, antes).

   Build de navegador (pdfjs-dist/build/pdf.mjs), con worker real -- Vite
   empaqueta el worker automaticamente via `new URL(...,import.meta.url)`. */
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

function dataUrlToUint8Array(dataUrl){
  const base64 = String(dataUrl).split(',').pop();
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for(let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function loadPdfDocument(dataUrl){
  const data = dataUrlToUint8Array(dataUrl);
  const task = pdfjsLib.getDocument({ data });
  return task.promise;
}

/* NOTA (probado en vivo, no hipotetico): el render de pagina a canvas NO
   vive aqui como funcion reutilizable -- PlanoOverlayViewer.jsx lo hace
   inline dentro de su propio efecto con un contador de generacion, porque
   pdfjs-dist puede dejar un render() colgado INDEFINIDAMENTE (nunca
   resuelve ni rechaza) si un render anterior sobre el mismo objeto Page se
   cancelo a medias -- exactamente lo que dispara React 18 StrictMode al
   montar/desmontar/remontar un efecto una vez en desarrollo. Envolver esa
   logica en una funcion generica invitaria a reusar el patron
   "cancelar+reintentar" que causa el cuelgue. convertToViewportPoint/
   convertToPdfPoint (abajo) siguen siendo la fuente de verdad para pasar
   entre "puntos PDF reales" y "pixeles de canvas" -- eso si es seguro de
   compartir. */
export function pdfPointToCanvasPoint(viewport, x, y){
  const [cx, cy] = viewport.convertToViewportPoint(x, y);
  return { x: cx, y: cy };
}

export function canvasPointToPdfPoint(viewport, x, y){
  const [px, py] = viewport.convertToPdfPoint(x, y);
  return { x: px, y: py };
}
