import crypto from 'node:crypto';
import { FieldValue, getAdminDb, getAdminStorage } from '../server/api-lib/_firebaseAdmin.mjs';
import { markFeatureUsed, requireFeature } from '../server/api-lib/_authGuard.mjs';
import { countPdfPages } from '../server/api-lib/_libraryExtract.mjs';
import { extractVectorGeometry } from '../server/api-lib/_planoVectorExtract.mjs';
import { validateTakeoffResponse, validateElement, assertPageLimit, MAX_PAGES_PER_ANALYSIS } from '../server/api-lib/_planoValidate.mjs';
import { sanitizeFileName, MAX_UPLOAD_BYTES } from '../server/api-lib/_libraryClassify.mjs';
import { TIPOS_ELEMENTO, ESCALA_FUENTES, applyPlanoElementReview } from '../src/domain/planoReview.js';
import {
  hasUsableVectorGeometry, groupSegmentsIntoWalls, detectGraphicScale, detectCotaScaleCandidates, resolveScale
} from '../src/domain/planoVectorGeometry.js';
import { calibrateScale } from '../src/domain/planoMeasurement.js';
import { buildVectorWallElement, attachAiOrigin } from '../src/domain/planoElementBuilder.js';

const SYSTEM = `Eres ZOEMEC Visual IA, asistente tecnico para arquitectura, construccion y obra.
Responde siempre en espanol, con criterio profesional, supuestos explicitos y alcance presupuestable.
Formatea la respuesta EXACTAMENTE con estos encabezados markdown "## ", en este orden, uno por rubro,
cada uno con 2 a 5 lineas de contenido concreto (nunca los omitas, si falta informacion indica el supuesto):
## Analisis tecnico
## Propuesta constructiva
## Materiales
## Estructura
## Acabados
## Riesgos
## Presupuesto aproximado
## Recomendaciones`;

/* Evita que un cuerpo vacio o truncado de OpenAI se muestre como
   "Unexpected end of JSON input" tal cual al usuario. */
async function readOpenAIJsonSafe(res){
  let text = '';
  try{ text = await res.text(); }catch{ text = ''; }
  if(!text || !text.trim()) return { error:{ message:`OpenAI no devolvio contenido (HTTP ${res.status}).` } };
  try{ return JSON.parse(text); }
  catch{ return { error:{ message:`OpenAI devolvio una respuesta con formato invalido (HTTP ${res.status}).` } }; }
}

function dataUrlToBlob(dataUrl){
  const [meta='', b64=''] = String(dataUrl).split(',');
  const mime = meta.match(/data:(.*?);base64/)?.[1] || 'image/png';
  const bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
  return new Blob([bytes], { type:mime });
}

function visualPrompt({ mode, prompt }){
  const modeText = {
    fachada:'Render arquitectonico realista de fachada o exterior, respetando la construccion existente y proponiendo materiales viables.',
    plano:'Visualizacion arquitectonica 3D conceptual a partir de plano, con volumenes claros, escala humana y materiales de obra.',
    interior:'Render de interiorismo constructivo, con acabados, iluminacion, mobiliario y detalles ejecutables.',
    obra:'Imagen tecnica de revision de obra con propuesta de mejora, seguridad, orden y alcance constructivo.'
  };
  return `${modeText[mode] || modeText.fachada}
Solicitud del usuario: ${prompt}
Estilo: profesional, realista, construccion mexicana, sin texto ni marcas de agua dentro de la imagen.
Debe conservar lo reconocible de la imagen de referencia cuando exista, mostrando la propuesta final de manera clara.`;
}

/* ---------------------------------------------------------------------- *
 * Planos IA / Takeoff (RC4 Fase 2). Mismo endpoint, action:'takeoff' nueva
 * y aditiva: sin ese campo, el comportamiento de arriba (fachada/render) no
 * cambia en absoluto. Persiste en visual_requests (Opcion A aprobada: cero
 * cambios a firestore.rules), con takeoffSchemaVersion para poder migrar a
 * una coleccion dedicada mas adelante sin romper lo ya guardado.
 * ---------------------------------------------------------------------- */

const TAKEOFF_SCHEMA_VERSION = 1;

const TAKEOFF_SYSTEM = `Eres ZOEMEC Takeoff IA, asistente de cuantificacion de obra a partir de planos.
Analiza el plano (PDF o imagen) e identifica UNICAMENTE elementos constructivos claramente identificables de este conjunto: ${TIPOS_ELEMENTO.join(', ')}.

Reglas estrictas, sin excepcion:
- NUNCA inventes una dimension. Una cantidad solo se propone si hay evidencia real: una cota escrita en el plano (fuenteEscala="cotas_texto"), una escala grafica o indicada explicitamente (fuenteEscala="escala_grafica"), o una medida de referencia que te de el usuario (fuenteEscala="referencia_usuario").
- Si no puedes determinar la cantidad con una de esas tres fuentes, identifica el elemento igual, pero pon cantidadPropuesta=null, unidad="" y fuenteEscala="no_determinada". Es preferible decir "no se puede determinar" que adivinar.
- "evidencia" debe citar textualmente o describir con precision la cota/rotulo/nota que sustenta tu propuesta (ej: "Cota 6.20 m visible junto al eje 3-B, pagina 2"). Nunca dejes evidencia generica o vacia.
- "confianzaIA" es tu propia estimacion de 0 a 100. No es una verificacion: nunca uses 100 como sinonimo de "confirmado". La validacion real la hace un humano despues.
- "pagina" es el numero de pagina (empezando en 1) donde detectaste el elemento.
- No propongas mas de 60 elementos. Si el plano tiene muchos elementos repetidos (ej. varias ventanas iguales), puedes agruparlos en una sola propuesta con la cantidad total, siempre que la evidencia lo respalde.
- No calcules presupuesto ni precios: solo identificacion y cuantificacion fisica.
Responde siempre en espanol.`;

function takeoffJsonSchema(){
  return {
    type: 'object',
    properties: {
      elementos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tipo: { type: 'string', enum: TIPOS_ELEMENTO },
            descripcion: { type: 'string' },
            cantidadPropuesta: { type: ['number', 'null'] },
            unidad: { type: 'string' },
            confianzaIA: { type: 'number' },
            pagina: { type: 'integer' },
            evidencia: { type: 'string' },
            fuenteEscala: { type: 'string', enum: Object.values(ESCALA_FUENTES) },
            observaciones: { type: 'string' }
          },
          required: ['tipo', 'descripcion', 'cantidadPropuesta', 'unidad', 'confianzaIA', 'pagina', 'evidencia', 'fuenteEscala', 'observaciones'],
          additionalProperties: false
        }
      },
      resumenAnalisis: { type: 'string' }
    },
    required: ['elementos', 'resumenAnalisis'],
    additionalProperties: false
  };
}

function takeoffUserText({ fileName, numPages, referenciaUsuario }){
  let text = `Archivo: ${fileName || 'sin nombre'}\nPaginas a analizar: ${numPages}.`;
  if(referenciaUsuario?.descripcion && referenciaUsuario?.medida){
    text += `\n\nEl usuario confirmo esta medida de referencia real (usala para calibrar otras cantidades cuando aplique, y marca fuenteEscala="referencia_usuario" en los elementos donde la hayas usado): "${referenciaUsuario.descripcion}" mide ${referenciaUsuario.medida} ${referenciaUsuario.unidad || ''}.`;
  }
  return text;
}

/* Llamada real a OpenAI + validacion determinista, SIN tocar Firestore.
   Separada de takeoffAnalyze (que persiste) para poder invocarla en un
   script de validacion real (ver docs/rc4-real-validation) sin depender de
   credenciales de Firebase Admin -- las dos cosas son independientes: la
   llamada real al modelo no necesita Firestore para probarse. */
export async function runTakeoffAnalysis({ fileName, mimeType = '', dataBase64, referenciaUsuario }){
  if(!process.env.OPENAI_API_KEY) throw new Error('Falta OPENAI_API_KEY en Vercel.');
  if(!dataBase64){
    const error = new Error('Falta el archivo del plano (PDF, JPG o PNG).');
    error.status = 400;
    throw error;
  }
  const isPdf = /^data:application\/pdf/i.test(dataBase64) || /pdf/i.test(mimeType);
  const isImage = /^data:image\//i.test(dataBase64);
  if(!isPdf && !isImage){
    const error = new Error('Formato no soportado para Takeoff: sube un PDF, JPG o PNG.');
    error.status = 415;
    throw error;
  }

  // Se decodifica una sola vez: sirve tanto para contar paginas (PDF) como
  // para almacenar el archivo original despues (ambos formatos), sin volver
  // a parsear el data URL en dos lugares distintos.
  const buffer = Buffer.from(String(dataBase64).split(',').pop(), 'base64');

  let numPages = 1;
  if(isPdf){
    try{
      numPages = await countPdfPages(buffer);
    }catch(err){
      const error = new Error('No se pudo leer el PDF: ' + (err.message || 'archivo invalido.'));
      error.status = 415;
      throw error;
    }
    assertPageLimit(numPages);
  }

  const content = [
    { type: 'input_text', text: takeoffUserText({ fileName, numPages, referenciaUsuario }) },
    isPdf
      ? { type: 'input_file', filename: fileName || 'plano.pdf', file_data: dataBase64 }
      : { type: 'input_image', image_url: dataBase64 }
  ];

  const model = process.env.OPENAI_VISUAL_MODEL || 'gpt-4.1-mini';
  const startedAt = Date.now();
  const aiRes = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: [{ role: 'system', content: TAKEOFF_SYSTEM }, { role: 'user', content }],
      text: { format: { type: 'json_schema', name: 'plano_takeoff', schema: takeoffJsonSchema(), strict: true } },
      max_output_tokens: 4000
    })
  });
  const elapsedMs = Date.now() - startedAt;
  const data = await readOpenAIJsonSafe(aiRes);
  if(!aiRes.ok) throw new Error(data.error?.message || 'OpenAI no pudo analizar el plano.');

  const rawText = data.output_text || data.output?.flatMap(o => o.content || []).map(c => c.text).filter(Boolean).join('') || '';
  let parsed = null;
  try{ parsed = JSON.parse(rawText); }catch{ parsed = null; }

  // Structured Outputs ayuda, pero NO es la unica defensa (instruccion
  // explicita del usuario): se valida de nuevo aqui, determinista, antes de
  // persistir nada.
  const validation = validateTakeoffResponse(parsed, { numPages });
  if(!validation.ok){
    const error = new Error('La respuesta del modelo no cumplio el formato esperado: ' + validation.error);
    error.status = 502;
    error.rawParsed = parsed;
    throw error;
  }

  return {
    model, numPages, elapsedMs, mimeType, fileName: fileName || '', buffer,
    parsed, validation,
    usage: { inputTokens: data.usage?.input_tokens || null, outputTokens: data.usage?.output_tokens || null }
  };
}

/* ---------------------------------------------------------------------- *
 * Fase B: "PDF vectorial primero". action:'takeoffVector', aditiva y
 * separada de action:'takeoff' de arriba (que sigue intacta, RC4 congelado
 * para quien ya la use). Orden real de prioridad (punto 1 del pedido):
 *   1. geometria vectorial del PDF (extractVectorGeometry, real, sin IA)
 *   2. texto/cotas del propio PDF (detectGraphicScale/detectCotaScaleCandidates)
 *   3. vision IA -- SOLO para lo que la geometria no puede clasificar
 *      (puertas/ventanas/columnas/losas/habitaciones/ejes/cotas), nunca para
 *      re-proponer muros que ya se detectaron por vector.
 * `aiCompletionFn` es inyectable (por defecto llama a OpenAI de verdad) para
 * poder probar el pipeline COMPLETO (extraccion real + fusion + reglas de
 * escala) con un PDF real y una respuesta de IA controlada, sin red.
 * ---------------------------------------------------------------------- */

const VECTOR_TAKEOFF_NON_WALL_TIPOS = TIPOS_ELEMENTO.filter(t => t !== 'muro');

function vectorTakeoffSystemPrompt(){
  return `Eres ZOEMEC Takeoff IA (vectorial). El plano YA fue analizado por geometria vectorial real: algunos muros pueden haber sido detectados con su longitud EXACTA a partir de las lineas del propio PDF -- NUNCA vuelvas a proponer esos muros, ya estan resueltos sin ti.

Tu trabajo es COMPLEMENTAR esa geometria, identificando SOLO elementos de este conjunto que la geometria vectorial no puede clasificar por si sola: ${VECTOR_TAKEOFF_NON_WALL_TIPOS.join(', ')}.

Reglas estrictas, sin excepcion (identicas a Takeoff clasico):
- NUNCA inventes una dimension. Una cantidad solo se propone si hay evidencia real (cota escrita, escala grafica, o referencia del usuario). Si no puedes determinarla, cantidadPropuesta=null, unidad="" y fuenteEscala="no_determinada".
- "evidencia" debe citar o describir con precision la cota/rotulo/nota que sustenta tu propuesta. Nunca vacia ni generica.
- "confianzaIA" es tu estimacion 0-100, nunca 100 como sinonimo de "confirmado".
- "pagina" es el numero de pagina (desde 1) donde detectaste el elemento.
- "bbox" es tu mejor aproximacion de {x0,y0,x1,y1} en fraccion 0-1 del tamano de la pagina/imagen completa (0,0 = esquina superior izquierda), para poder ubicar el elemento en un visor -- ES SOLO UNA APROXIMACION VISUAL, nunca una medicion geometrica exacta ni una coordenada real del documento.
- No propongas mas de 60 elementos.
- No calcules presupuesto ni precios.
Responde siempre en espanol.`;
}

function vectorTakeoffJsonSchema(){
  return {
    type: 'object',
    properties: {
      elementos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tipo: { type: 'string', enum: VECTOR_TAKEOFF_NON_WALL_TIPOS },
            descripcion: { type: 'string' },
            cantidadPropuesta: { type: ['number', 'null'] },
            unidad: { type: 'string' },
            confianzaIA: { type: 'number' },
            pagina: { type: 'integer' },
            evidencia: { type: 'string' },
            fuenteEscala: { type: 'string', enum: Object.values(ESCALA_FUENTES) },
            observaciones: { type: 'string' },
            bbox: {
              type: 'object',
              properties: { x0: { type: 'number' }, y0: { type: 'number' }, x1: { type: 'number' }, y1: { type: 'number' } },
              required: ['x0', 'y0', 'x1', 'y1'], additionalProperties: false
            }
          },
          required: ['tipo', 'descripcion', 'cantidadPropuesta', 'unidad', 'confianzaIA', 'pagina', 'evidencia', 'fuenteEscala', 'observaciones', 'bbox'],
          additionalProperties: false
        }
      },
      resumenAnalisis: { type: 'string' }
    },
    required: ['elementos', 'resumenAnalisis'],
    additionalProperties: false
  };
}

function vectorTakeoffUserText({ fileName, numPages, resolvedScale, vectorWallCount }){
  let text = `Archivo: ${fileName || 'sin nombre'}\nPaginas a analizar: ${numPages}.`;
  text += `\n\nLa geometria vectorial ya detecto ${vectorWallCount} muro(s) real(es) -- no los repitas.`;
  if(resolvedScale?.fuente && resolvedScale.fuente !== ESCALA_FUENTES.NO_DETERMINADA){
    text += `\nEscala ya resuelta por el sistema (fuente: ${resolvedScale.fuente}): usa fuenteEscala="${resolvedScale.fuente}" en los elementos donde puedas aplicar esta misma escala con evidencia real.`;
  }else{
    text += `\nAun NO hay escala determinada para este plano: si no encuentras tu propia evidencia de escala/cota, deja cantidadPropuesta=null y fuenteEscala="no_determinada".`;
  }
  return text;
}

/* Llamada real a OpenAI para el complemento de Fase B -- mismo endpoint/
   formato que runTakeoffAnalysis, extraida a funcion propia SOLO para poder
   inyectarla en pruebas (ver test/visualAiVectorTakeoff.test.mjs). */
async function defaultAiCompletion({ systemPrompt, userText, isPdf, dataBase64, fileName, jsonSchema }){
  const content = [
    { type: 'input_text', text: userText },
    isPdf ? { type: 'input_file', filename: fileName || 'plano.pdf', file_data: dataBase64 } : { type: 'input_image', image_url: dataBase64 }
  ];
  const model = process.env.OPENAI_VISUAL_MODEL || 'gpt-4.1-mini';
  const aiRes = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: [{ role: 'system', content: systemPrompt }, { role: 'user', content }],
      text: { format: { type: 'json_schema', name: 'plano_takeoff_vector', schema: jsonSchema, strict: true } },
      max_output_tokens: 4000
    })
  });
  const data = await readOpenAIJsonSafe(aiRes);
  if(!aiRes.ok) throw new Error(data.error?.message || 'OpenAI no pudo analizar el plano.');
  const rawText = data.output_text || data.output?.flatMap(o => o.content || []).map(c => c.text).filter(Boolean).join('') || '';
  let parsed = null;
  try{ parsed = JSON.parse(rawText); }catch{ parsed = null; }
  return { parsed, usage: { inputTokens: data.usage?.input_tokens || null, outputTokens: data.usage?.output_tokens || null } };
}

/* Orquestador principal de Fase B. Pura de red/Firestore (solo llama al PDF
   parser real y, opcionalmente, a `aiCompletionFn`) para poder probarse con
   un PDF real generado en la prueba + una respuesta de IA falsa inyectada,
   sin depender de credenciales de OpenAI. NUNCA escribe en Firestore --
   la persistencia real (Fase B, punto 11) la hace el llamador via
   POST /api/plano-takeoffs, que es quien deriva organizationId server-side. */
export async function runVectorTakeoffAnalysis({
  fileName, mimeType = '', dataBase64, manualCalibration, aiCompletionFn = defaultAiCompletion
}){
  if(!dataBase64){
    const error = new Error('Falta el archivo del plano (PDF, JPG o PNG).');
    error.status = 400;
    throw error;
  }
  const isPdf = /^data:application\/pdf/i.test(dataBase64) || /pdf/i.test(mimeType);
  const isImage = /^data:image\//i.test(dataBase64);
  if(!isPdf && !isImage){
    const error = new Error('Formato no soportado para Takeoff: sube un PDF, JPG o PNG.');
    error.status = 415;
    throw error;
  }
  const buffer = Buffer.from(String(dataBase64).split(',').pop(), 'base64');

  let numPages = 1;
  let vectorWalls = [];
  let resolvedScale = { fuente: ESCALA_FUENTES.NO_DETERMINADA, realUnitsPerPdfPoint: null, evidencia: 'No aplica: entrada no es PDF (imagen rasterizada, sin geometria vectorial posible).' };
  let vectorSummary = { hasUsableVectorGeometry: false, segmentCount: 0 };

  if(isPdf){
    try{ numPages = await countPdfPages(buffer); }
    catch(err){ const error = new Error('No se pudo leer el PDF: ' + (err.message || 'archivo invalido.')); error.status = 415; throw error; }
    assertPageLimit(numPages);

    const extracted = await extractVectorGeometry(buffer, { maxPages: MAX_PAGES_PER_ANALYSIS });
    const usable = hasUsableVectorGeometry(extracted.allSegments);
    vectorSummary = { hasUsableVectorGeometry: usable, segmentCount: extracted.allSegments.length };

    const graphicScale = detectGraphicScale(extracted.allTextItems);
    const cotaCandidates = detectCotaScaleCandidates(extracted.allTextItems, extracted.allSegments);
    const manualScale = manualCalibration && Number(manualCalibration.pixelDistance) > 0 && Number(manualCalibration.realDistance) > 0
      ? { realUnitsPerPdfPoint: calibrateScale(manualCalibration.pixelDistance, manualCalibration.realDistance), evidencia: manualCalibration.evidencia || `Calibracion manual: ${manualCalibration.realDistance} en ${manualCalibration.pixelDistance}pt.` }
      : null;
    resolvedScale = resolveScale({ graphicScale, cotaCandidates, referenciaUsuario: manualScale });

    if(usable){
      const wallGroups = groupSegmentsIntoWalls(extracted.allSegments);
      vectorWalls = wallGroups.map(w => buildVectorWallElement(w, { resolvedScale, fileName: fileName || '' }));
    }
  }

  let aiElements = [];
  let resumenAnalisis = '';
  let aiValidation = { elementosInvalidos: [], resultadoParcial: false, elementosDescartados: 0 };
  if(process.env.OPENAI_API_KEY || aiCompletionFn !== defaultAiCompletion){
    const systemPrompt = vectorTakeoffSystemPrompt();
    const userText = vectorTakeoffUserText({ fileName, numPages, resolvedScale, vectorWallCount: vectorWalls.length });
    const { parsed } = await aiCompletionFn({ systemPrompt, userText, isPdf, dataBase64, fileName, jsonSchema: vectorTakeoffJsonSchema() });
    const validation = validateTakeoffResponse(parsed, { numPages });
    if(validation.ok){
      aiElements = validation.elementos.map((el, i) => attachAiOrigin(el, { bbox: parsed?.elementos?.[i]?.bbox || null, fileName: fileName || '' }));
      aiValidation = { elementosInvalidos: validation.elementosInvalidos, resultadoParcial: validation.resultadoParcial, elementosDescartados: validation.elementosDescartados };
      resumenAnalisis = typeof parsed?.resumenAnalisis === 'string' ? parsed.resumenAnalisis.slice(0, 4000) : '';
    }
  }

  return {
    numPages, mimeType, fileName: fileName || '', buffer,
    vectorSummary, resolvedScale,
    elementos: [...vectorWalls, ...aiElements],
    elementosInvalidos: aiValidation.elementosInvalidos,
    resultadoParcial: aiValidation.resultadoParcial,
    elementosDescartados: aiValidation.elementosDescartados,
    resumenAnalisis
  };
}

/* Mensajes reales observados cuando Firebase Storage no esta disponible en
   este proyecto (plan Spark sin bucket habilitado -- decision explicita del
   usuario de RC4: no activar Storage ni introducir facturacion para el
   concurso) o cuando no hay credenciales de Admin SDK configuradas. Se
   normalizan a un mensaje unico y claro; cualquier OTRO error de Storage
   (uno inesperado, no de "no configurado") conserva su texto real, nunca se
   oculta. */
function isStorageNotConfiguredError(err){
  const msg = String(err?.message || '');
  return /specified bucket does not exist/i.test(msg)
    || /FIREBASE_SERVICE_ACCOUNT_JSON/i.test(msg)
    || /GOOGLE_APPLICATION_CREDENTIALS/i.test(msg);
}

const STORAGE_NOT_CONFIGURED_MESSAGE = 'Firebase Storage no esta habilitado en este entorno (plan Spark, sin bucket). El plano original no se almaceno; el analisis, la revision humana y el APU funcionan igual con la evidencia y el hash SHA-256 del archivo.';

/* Almacenamiento minimo del plano original (RC4, punto aprobado despues del
   informe de Fase 2). Ruta "visual/{uid}/{visualRequestId}/{fileName}":
   coincide EXACTAMENTE con una regla ya vigente en storage.rules
   (match /visual/{uid}/{fileId}/{fileName}), asi que no se toca
   storage.rules ni firestore.rules. Mismo patron ya usado por Biblioteca
   (getAdminStorage + signed URL de larga duracion).

   Storage es OPCIONAL (decision explicita, RC4): el hash SHA-256 SIEMPRE se
   calcula, exista o no un bucket -- es lo unico que permite demostrar despues
   que archivo produjo un analisis cuando el archivo original no se guarda.
   Si el archivo excede MAX_UPLOAD_BYTES, o si Storage no esta configurado, o
   si falla por cualquier otra razon real: nunca se lanza, nunca se finge
   almacenado, y el analisis (ya calculado y validado) se persiste igual. */
export async function storeOriginalPlano({ uid, visualRequestId, fileName, mimeType, buffer }){
  const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

  if(buffer.length > MAX_UPLOAD_BYTES){
    return {
      fileStored: false,
      storagePath: null, downloadURL: null, fileHash,
      storageError: `El archivo pesa ${(buffer.length / 1048576).toFixed(1)} MB; supera el maximo de ${(MAX_UPLOAD_BYTES / 1048576).toFixed(0)} MB para almacenar el original. El analisis se conserva; el archivo original no.`
    };
  }
  try{
    const bucket = getAdminStorage();
    const safeName = sanitizeFileName(fileName || 'plano');
    const storagePath = `visual/${uid}/${visualRequestId}/${safeName}`;
    await bucket.file(storagePath).save(buffer, { metadata: { contentType: mimeType || 'application/octet-stream' } });
    const [downloadURL] = await bucket.file(storagePath).getSignedUrl({ action: 'read', expires: '01-01-2500' });
    return { fileStored: true, storagePath, downloadURL, fileHash, storageError: '' };
  }catch(err){
    const storageError = isStorageNotConfiguredError(err) ? STORAGE_NOT_CONFIGURED_MESSAGE : (err.message || 'No se pudo almacenar el archivo original.');
    return { fileStored: false, storagePath: null, downloadURL: null, fileHash, storageError };
  }
}

async function takeoffAnalyze(req, res, authz){
  const { fileName, mimeType = '', dataBase64, referenciaUsuario } = req.body || {};
  const { numPages, validation, parsed, usage, buffer } = await runTakeoffAnalysis({ fileName, mimeType, dataBase64, referenciaUsuario });

  const db = getAdminDb();
  const docRef = db.collection('visual_requests').doc();
  const storage = await storeOriginalPlano({ uid: authz.uid, visualRequestId: docRef.id, fileName, mimeType, buffer });

  await docRef.set({
    uid: authz.uid,
    email: authz.email || '',
    fileName: fileName || '',
    mode: 'takeoff',
    takeoffSchemaVersion: TAKEOFF_SCHEMA_VERSION,
    mimeType,
    fileSize: buffer.length,
    numPages,
    elementos: validation.elementos,
    elementosInvalidosCount: validation.elementosInvalidos.length,
    resultadoParcial: validation.resultadoParcial,
    elementosDescartados: validation.elementosDescartados,
    resumenAnalisis: typeof parsed?.resumenAnalisis === 'string' ? parsed.resumenAnalisis.slice(0, 4000) : '',
    usage,
    // Plano original -> analisis IA -> elemento -> revision humana -> APU:
    // este bloque preserva el primer eslabon de esa cadena de trazabilidad.
    storagePath: storage.storagePath,
    downloadURL: storage.downloadURL,
    fileHash: storage.fileHash,
    fileStored: storage.fileStored,
    storageError: storage.storageError,
    createdAt: FieldValue.serverTimestamp()
  });
  await markFeatureUsed(authz);

  res.status(200).json({
    ok: true,
    visualRequestId: docRef.id,
    takeoffSchemaVersion: TAKEOFF_SCHEMA_VERSION,
    fileName: fileName || '',
    numPages,
    elementos: validation.elementos,
    elementosInvalidos: validation.elementosInvalidos,
    resultadoParcial: validation.resultadoParcial,
    elementosDescartados: validation.elementosDescartados,
    resumenAnalisis: typeof parsed?.resumenAnalisis === 'string' ? parsed.resumenAnalisis.slice(0, 4000) : '',
    fileStored: storage.fileStored,
    downloadURL: storage.downloadURL,
    storageError: storage.storageError
  });
}

/* action:'takeoffVector' (Fase B): a diferencia de takeoffAnalyze arriba,
   NUNCA escribe en Firestore -- solo analiza (vector-first + IA
   complementaria) y devuelve el resultado. La persistencia real (con
   organizationId derivado server-side, punto 12) la hace el cliente
   despues via POST /api/plano-takeoffs action=create/save-version. Separar
   "analizar" de "persistir" evita duplicar la logica de organizationId en
   dos archivos distintos. */
async function takeoffVectorAnalyze(req, res, authz){
  const { fileName, mimeType = '', dataBase64, manualCalibration } = req.body || {};
  const { numPages, mimeType: mt, buffer, vectorSummary, resolvedScale, elementos, elementosInvalidos, resultadoParcial, elementosDescartados, resumenAnalisis }
    = await runVectorTakeoffAnalysis({ fileName, mimeType, dataBase64, manualCalibration });

  const analysisId = crypto.randomUUID();
  const storage = await storeOriginalPlano({ uid: authz.uid, visualRequestId: analysisId, fileName, mimeType: mt, buffer });
  await markFeatureUsed(authz);

  res.status(200).json({
    ok: true,
    fileName: fileName || '',
    numPages,
    vectorSummary,
    resolvedScale,
    elementos,
    elementosInvalidos,
    resultadoParcial,
    elementosDescartados,
    resumenAnalisis,
    fileStored: storage.fileStored,
    downloadURL: storage.downloadURL,
    fileHash: storage.fileHash,
    storageError: storage.storageError
  });
}

/* Revision humana de UN elemento (Fase 2, punto 8/9). validatedBy SIEMPRE
   viene de la sesion autenticada, nunca del body del cliente -- mismo
   principio ya aplicado en confirmInsumos de Biblioteca (api/upload-library.mjs). */
async function reviewTakeoffElement(req, res, authz){
  const { visualRequestId, elementIndex, decision } = req.body || {};
  if(!visualRequestId || elementIndex == null || !decision){
    const error = new Error('Falta visualRequestId, elementIndex o decision.');
    error.status = 400;
    throw error;
  }
  const db = getAdminDb();
  const ref = db.collection('visual_requests').doc(visualRequestId);
  const snap = await ref.get();
  if(!snap.exists){
    const error = new Error('Analisis de plano no encontrado.');
    error.status = 404;
    throw error;
  }
  const dataDoc = snap.data();
  if(dataDoc.uid !== authz.uid && authz.role !== 'admin'){
    const error = new Error('No tienes permiso sobre este analisis de plano.');
    error.status = 403;
    throw error;
  }
  const elementos = Array.isArray(dataDoc.elementos) ? [...dataDoc.elementos] : [];
  if(!elementos[elementIndex]){
    const error = new Error('Ese elemento no existe en este analisis.');
    error.status = 404;
    throw error;
  }
  const validatorId = authz.email || authz.uid;
  const updated = applyPlanoElementReview(elementos[elementIndex], {
    state: decision.state,
    validatedBy: validatorId,
    cantidadCorregida: decision.cantidadCorregida,
    unidadCorregida: decision.unidadCorregida,
    descripcionCorregida: decision.descripcionCorregida,
    motivo: decision.motivo
  });
  elementos[elementIndex] = updated;
  await ref.update({ elementos });
  res.status(200).json({ ok: true, visualRequestId, elementIndex, elemento: updated });
}

async function generateVisualProposal(req, res, authz){
    if(!process.env.OPENAI_API_KEY) throw new Error('Falta OPENAI_API_KEY en Vercel.');
    const { image, fileName, mode='fachada', prompt='', libraryDocs } = req.body || {};
    if(!prompt.trim()) throw new Error('Escribe una instruccion para la IA.');

    /* Evidencia real de la Biblioteca del usuario (solo nombre/categoria, nunca
       el archivo completo) para que el analisis pueda referenciarla en vez de
       trabajar a ciegas. Antes Visual IA no recibia ningun contexto documental. */
    const docList = Array.isArray(libraryDocs) ? libraryDocs.slice(0, 20) : [];
    const libraryContext = docList.length
      ? `Documentos disponibles en la Biblioteca del usuario (usalos como referencia si aplica; no los inventes si no aparecen aqui):\n${docList.map(d=>`- ${d.name} (${d.cat}${d.family ? ' / ' + d.family : ''})`).join('\n')}`
      : 'El usuario no tiene documentos en su Biblioteca todavia.';

    const content = [
      { type:'input_text', text:`Modo: ${mode}\nArchivo: ${fileName || 'sin nombre'}\nSolicitud: ${prompt}\n\n${libraryContext}` }
    ];
    if(image && String(image).startsWith('data:image/')){
      content.push({ type:'input_image', image_url:image });
    }

    const aiRes = await fetch('https://api.openai.com/v1/responses', {
      method:'POST',
      headers:{
        Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({
        model:process.env.OPENAI_VISUAL_MODEL || 'gpt-4.1-mini',
        input:[{ role:'system', content:SYSTEM }, { role:'user', content }],
        max_output_tokens:1200
      })
    });
    const data = await readOpenAIJsonSafe(aiRes);
    if(!aiRes.ok) throw new Error(data.error?.message || 'OpenAI no pudo generar la respuesta.');
    const result = data.output_text || data.output?.flatMap(o=>o.content||[]).map(c=>c.text).filter(Boolean).join('\n') || 'Sin texto generado.';
    let imageUrl = '';
    let imageB64 = '';
    let imageError = '';
    const imageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
    const promptImage = visualPrompt({ mode, prompt });
    try{
      let imgRes;
      if(image && String(image).startsWith('data:image/')){
        const form = new FormData();
        form.append('model', imageModel);
        form.append('image', dataUrlToBlob(image), fileName || 'referencia.png');
        form.append('prompt', promptImage);
        form.append('size', process.env.OPENAI_IMAGE_SIZE || '1024x1024');
        imgRes = await fetch('https://api.openai.com/v1/images/edits', {
          method:'POST',
          headers:{ Authorization:`Bearer ${process.env.OPENAI_API_KEY}` },
          body:form
        });
      }else{
        imgRes = await fetch('https://api.openai.com/v1/images/generations', {
          method:'POST',
          headers:{
            Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type':'application/json'
          },
          body:JSON.stringify({
            model:imageModel,
            prompt:promptImage,
            size:process.env.OPENAI_IMAGE_SIZE || '1024x1024'
          })
        });
      }
      const imgData = await readOpenAIJsonSafe(imgRes);
      if(!imgRes.ok) throw new Error(imgData.error?.message || 'OpenAI no pudo generar la imagen.');
      imageUrl = imgData.data?.[0]?.url || '';
      imageB64 = imgData.data?.[0]?.b64_json || '';
      if(!imageUrl && !imageB64) throw new Error('La respuesta de imagen no trajo archivo generado.');
    }catch(err){
      /* Nunca se finge un render: si la generacion de imagen falla o no esta
         disponible para esta cuenta/proveedor, se dice explicitamente. */
      imageError = 'Análisis técnico disponible; generación visual pendiente de proveedor configurado.';
      if(process.env.NODE_ENV !== 'production'){
        imageError += ` (detalle interno: ${err.message || 'sin detalle'})`;
      }
    }

    if(authz.uid){
      try{
        const db = getAdminDb();
        await db.collection('visual_requests').add({
          uid:authz.uid,
          email:authz.email || '',
          fileName:fileName || '',
          mode,
          prompt,
          result,
          imageGenerated:Boolean(imageUrl || imageB64),
          imageError,
          createdAt:FieldValue.serverTimestamp()
        });
      }catch{}
    }
    await markFeatureUsed(authz);

    res.status(200).json({ result: imageError ? `${result}\n\n${imageError}` : result, imageUrl, imageB64, imageError });
}

export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.status(405).json({ error:'Metodo no permitido.' });
    return;
  }
  try{
    const authz = await requireFeature(req, 'visual');
    const action = req.body?.action || 'propuesta';
    if(action === 'takeoff') return await takeoffAnalyze(req, res, authz);
    if(action === 'takeoffVector') return await takeoffVectorAnalyze(req, res, authz);
    if(action === 'reviewElement') return await reviewTakeoffElement(req, res, authz);
    return await generateVisualProposal(req, res, authz);
  }catch(err){
    res.status(err.status || 400).json({ error:err.message || 'No se pudo usar Visual IA.' });
  }
}
