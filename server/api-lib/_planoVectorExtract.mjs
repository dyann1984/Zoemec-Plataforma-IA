/* Fase B, punto 1 ("PDF vectorial primero"): extraccion REAL de geometria de
   trazo (lineas rectas) y texto posicionado desde un PDF, usando SOLO las
   APIs de pdfjs-dist ya probadas en este proyecto (getOperatorList/
   getTextContent, mismo import y polyfills que _libraryExtract.mjs -- nunca
   su ruta de render a imagen, que requiere @napi-rs/canvas). Esta capa es
   pura IO/parsing: entrega arreglos de numeros/strings; TODA la logica de
   "es esto un muro"/"que escala implica este texto" vive en
   src/domain/planoVectorGeometry.js (puro, sin pdfjs, testeable sin PDFs
   reales).

   Verificado empiricamente contra PDFs reales generados con jsPDF (no
   supuesto, no inventado): el operador `constructPath` de pdfjs-dist 6.x
   codifica sus subtrazos como una secuencia plana de
   [subopcode, ...coords] dentro de uno o mas Float32Array en argsArray[i][1]:
     0 = moveTo   (2 coords: x, y)
     1 = lineTo   (2 coords: x, y)
     2 = curveTo  (6 coords: x1,y1,x2,y2,x3,y3 -- bezier cubico)
     4 = closePath (0 coords)
   Estos codigos son INTERNOS de pdfjs (compactacion de argumentos), no el
   enum publico `OPS` (que usa otros valores para OPS.moveTo/lineTo/etc.) --
   por eso se decodifican aqui con constantes propias, documentadas y
   probadas, no importadas de pdfjs. */
import { ensurePdfEnvPolyfills } from './_pdfEnvPolyfill.mjs';

const PATH_SUBOP = Object.freeze({ MOVE_TO: 0, LINE_TO: 1, CURVE_TO: 2, CLOSE_PATH: 4 });

/* Matriz afin 2D minima (misma convencion que PDF `cm`: aplicar `m` en el
   espacio LOCAL de `base`, es decir base.multiply(m) con "aplicar m primero,
   luego base"). Independiente de _pdfEnvPolyfill.mjs#MinimalDOMMatrix a
   proposito: aqui solo se necesitan 2 operaciones (multiplicar, transformar
   un punto), no todo el contrato de DOMMatrix que ese polyfill cubre. */
function multiplyCTM(base, m){
  return {
    a: base.a * m.a + base.c * m.b, b: base.b * m.a + base.d * m.b,
    c: base.a * m.c + base.c * m.d, d: base.b * m.c + base.d * m.d,
    e: base.a * m.e + base.c * m.f + base.e, f: base.b * m.e + base.d * m.f + base.f
  };
}
function applyCTM(ctm, x, y){
  return { x: ctm.a * x + ctm.c * y + ctm.e, y: ctm.b * x + ctm.d * y + ctm.f };
}
const IDENTITY_CTM = Object.freeze({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });

/* Decodifica los subtrazos de UN constructPath ya con el CTM vigente
   aplicado -- devuelve segmentos {x1,y1,x2,y2} en espacio de pagina PDF real
   (no en el espacio local del trazo). Un curveTo se aproxima por el segmento
   recto entre su punto de partida y el punto final de la curva (suficiente
   para detectar longitud aproximada de un elemento curvo; nunca se presenta
   como VECTOR_DETECTED de alta confianza para un muro -- eso lo decide
   planoVectorGeometry.js por longitud/forma, no este extractor). Nunca
   lanza ante un subcodigo desconocido: lo omite y sigue, en vez de romper
   la extraccion completa de la pagina por un trazo atipico. */
function decodePathSegments(pathTypedArrays, ctm){
  const segments = [];
  for(const typed of (Array.isArray(pathTypedArrays) ? pathTypedArrays : [])){
    const values = Array.from(typed);
    let cursor = 0;
    let current = null;
    let subpathStart = null;
    while(cursor < values.length){
      const subop = values[cursor++];
      if(subop === PATH_SUBOP.MOVE_TO){
        const p = applyCTM(ctm, values[cursor], values[cursor + 1]); cursor += 2;
        current = p; subpathStart = p;
      }else if(subop === PATH_SUBOP.LINE_TO){
        const p = applyCTM(ctm, values[cursor], values[cursor + 1]); cursor += 2;
        if(current) segments.push({ x1: current.x, y1: current.y, x2: p.x, y2: p.y });
        current = p;
      }else if(subop === PATH_SUBOP.CURVE_TO){
        const end = applyCTM(ctm, values[cursor + 4], values[cursor + 5]); cursor += 6;
        if(current) segments.push({ x1: current.x, y1: current.y, x2: end.x, y2: end.y });
        current = end;
      }else if(subop === PATH_SUBOP.CLOSE_PATH){
        if(current && subpathStart && (current.x !== subpathStart.x || current.y !== subpathStart.y)){
          segments.push({ x1: current.x, y1: current.y, x2: subpathStart.x, y2: subpathStart.y });
        }
        current = subpathStart;
      }else{
        // Subcodigo no reconocido: se detiene esta polilinea (no se puede
        // saber cuantos argumentos consume), pero no se lanza -- el resto
        // de la pagina/documento se sigue procesando con normalidad.
        break;
      }
    }
  }
  return segments;
}

/* Extrae segmentos de linea + items de texto posicionados de UNA pagina ya
   abierta (pdfjs Page). Recorre el operator list llevando la pila real de
   CTM (save/transform/restore) para que las coordenadas devueltas esten
   SIEMPRE en espacio de pagina real, sin importar cuantos grupos
   transformados use el PDF de origen (comun en planos exportados desde
   AutoCAD/Revit con capas/bloques). */
async function extractPageGeometry(page, pageNumber, OPS){
  const opList = await page.getOperatorList();
  const stack = [IDENTITY_CTM];
  const segments = [];
  for(let i = 0; i < opList.fnArray.length; i++){
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    if(fn === OPS.save){
      stack.push(stack[stack.length - 1]);
    }else if(fn === OPS.restore){
      if(stack.length > 1) stack.pop();
    }else if(fn === OPS.transform){
      const [a, b, c, d, e, f] = args;
      stack[stack.length - 1] = multiplyCTM(stack[stack.length - 1], { a, b, c, d, e, f });
    }else if(fn === OPS.constructPath){
      const pathTypedArrays = args?.[1];
      const decoded = decodePathSegments(pathTypedArrays, stack[stack.length - 1]);
      for(const seg of decoded) segments.push({ ...seg, page: pageNumber });
    }
  }

  const textContent = await page.getTextContent();
  const textItems = textContent.items
    .filter(it => typeof it.str === 'string' && it.str.trim())
    .map(it => ({
      str: it.str,
      x: it.transform?.[4] ?? 0,
      y: it.transform?.[5] ?? 0,
      width: it.width ?? 0,
      height: it.height ?? Math.abs(it.transform?.[3] ?? 10),
      page: pageNumber
    }));

  const viewport = page.getViewport({ scale: 1 });
  return { segments, textItems, pageWidthPt: viewport.width, pageHeightPt: viewport.height };
}

/* API publica: extrae geometria+texto de hasta `maxPages` paginas de un PDF
   (buffer real, no base64 -- ya decodificado por el llamador, mismo patron
   que countPdfPages/extractPdfText). Nunca lanza por un PDF sin trazos
   vectoriales (ej. escaneado): en ese caso simplemente regresa arreglos
   vacios por pagina, y es planoVectorGeometry.js#hasUsableVectorGeometry
   quien decide, con esos datos, que la vision IA debe tomar el relevo. */
export async function extractVectorGeometry(buffer, { maxPages = 10 } = {}){
  ensurePdfEnvPolyfills();
  const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(buffer);
  const task = getDocument({ data, useWorkerFetch: false, isEvalSupported: false, disableFontFace: true });
  const pdf = await task.promise;
  const numPages = pdf.numPages;
  const pagesToRead = Math.min(numPages, maxPages);

  const pages = [];
  for(let pageNumber = 1; pageNumber <= pagesToRead; pageNumber++){
    const page = await pdf.getPage(pageNumber);
    try{
      pages.push({ pageNumber, ...(await extractPageGeometry(page, pageNumber, OPS)) });
    }catch(err){
      // Una pagina individual con contenido atipico (ej. formulario XFA,
      // objeto corrupto) no debe tumbar el analisis de las demas paginas.
      pages.push({ pageNumber, segments: [], textItems: [], pageWidthPt: null, pageHeightPt: null, error: err.message || 'No se pudo leer la geometria de esta pagina.' });
    }
  }

  return {
    numPages,
    pages,
    allSegments: pages.flatMap(p => p.segments),
    allTextItems: pages.flatMap(p => p.textItems)
  };
}
