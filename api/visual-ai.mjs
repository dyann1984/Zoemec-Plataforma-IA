import crypto from 'node:crypto';
import { FieldValue, getAdminDb, getAdminStorage } from '../server/api-lib/_firebaseAdmin.mjs';
import { markFeatureUsed, requireFeature } from '../server/api-lib/_authGuard.mjs';
import { countPdfPages } from '../server/api-lib/_libraryExtract.mjs';
import { validateTakeoffResponse, assertPageLimit } from '../server/api-lib/_planoValidate.mjs';
import { sanitizeFileName, MAX_UPLOAD_BYTES } from '../server/api-lib/_libraryClassify.mjs';
import { TIPOS_ELEMENTO, ESCALA_FUENTES, applyPlanoElementReview } from '../src/domain/planoReview.js';

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

/* Almacenamiento minimo del plano original (RC4, punto aprobado despues del
   informe de Fase 2). Ruta "visual/{uid}/{visualRequestId}/{fileName}":
   coincide EXACTAMENTE con una regla ya vigente en storage.rules
   (match /visual/{uid}/{fileId}/{fileName}), asi que no se toca
   storage.rules ni firestore.rules. Mismo patron ya usado por Biblioteca
   (getAdminStorage + signed URL de larga duracion). Si el archivo excede
   MAX_UPLOAD_BYTES no se almacena (el analisis igual se conserva): se
   documenta la razon en vez de fallar el analisis completo por esto. */
export async function storeOriginalPlano({ uid, visualRequestId, fileName, mimeType, buffer }){
  if(buffer.length > MAX_UPLOAD_BYTES){
    return {
      fileStored: false,
      storagePath: null, downloadURL: null, fileHash: null,
      storageError: `El archivo pesa ${(buffer.length / 1048576).toFixed(1)} MB; supera el maximo de ${(MAX_UPLOAD_BYTES / 1048576).toFixed(0)} MB para almacenar el original. El analisis se conserva; el archivo original no.`
    };
  }
  try{
    const bucket = getAdminStorage();
    const safeName = sanitizeFileName(fileName || 'plano');
    const storagePath = `visual/${uid}/${visualRequestId}/${safeName}`;
    await bucket.file(storagePath).save(buffer, { metadata: { contentType: mimeType || 'application/octet-stream' } });
    const [downloadURL] = await bucket.file(storagePath).getSignedUrl({ action: 'read', expires: '01-01-2500' });
    const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
    return { fileStored: true, storagePath, downloadURL, fileHash, storageError: '' };
  }catch(err){
    // Nunca se finge almacenado: si Storage falla, el analisis (ya
    // calculado y validado) se guarda igual, con el error explicito.
    return { fileStored: false, storagePath: null, downloadURL: null, fileHash: null, storageError: err.message || 'No se pudo almacenar el archivo original.' };
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
    if(action === 'reviewElement') return await reviewTakeoffElement(req, res, authz);
    return await generateVisualProposal(req, res, authz);
  }catch(err){
    res.status(err.status || 400).json({ error:err.message || 'No se pudo usar Visual IA.' });
  }
}
