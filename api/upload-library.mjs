import { FieldValue, getAdminDb, getAdminStorage } from '../server/api-lib/_firebaseAdmin.mjs';
import { requireFeature } from '../server/api-lib/_authGuard.mjs';
import { assertAllowedFile, classifyLibraryFile, sanitizeFileName, extOf } from '../server/api-lib/_libraryClassify.mjs';
import { extractLibraryContent } from '../server/api-lib/_libraryExtract.mjs';
import { searchLibrary, findSimilarMatrices } from '../server/api-lib/_librarySearch.mjs';
import { applyInsumoReview } from '../src/domain/libraryReview.js';

/* Endpoint general de Biblioteca (RC4): ademas de la subida real original
   (accion por defecto, retrocompatible con cualquier cliente que no mande
   "action"), agrega busqueda por contenido, matrices similares, extraccion
   de insumos y revision humana -- todo dentro de esta misma funcion
   serverless para no sumar al limite de 12 de Vercel Hobby. */

/* Documentos visibles para un usuario: propios + globales, deduplicados.
   Misma fuente que ya usa la pantalla Biblioteca en el cliente (localStorage/
   Firestore por proyecto): se replica aqui para que /search y /similarMatrices
   busquen exactamente sobre lo que el usuario ya puede ver, nunca sobre la
   biblioteca de otros usuarios privados. */
async function visibleLibraryDocs(db, authz){
  const [mineSnap, globalSnap] = await Promise.all([
    db.collection('library').where('ownerUid', '==', authz.uid).get(),
    db.collection('library').where('visibility', '==', 'global').get()
  ]);
  const seen = new Set();
  const docs = [];
  [...mineSnap.docs, ...globalSnap.docs].forEach(d => {
    if(seen.has(d.id)) return;
    seen.add(d.id);
    docs.push({ id: d.id, ...d.data() });
  });
  return docs;
}

async function requireOwnedDoc(db, authz, docId){
  if(!docId){
    const error = new Error('Falta el docId de Biblioteca.');
    error.status = 400;
    throw error;
  }
  const ref = db.collection('library').doc(docId);
  const snap = await ref.get();
  if(!snap.exists){
    const error = new Error('Documento de Biblioteca no encontrado.');
    error.status = 404;
    throw error;
  }
  const data = snap.data();
  const isOwner = data.ownerUid === authz.uid;
  const isGlobalReadOnly = data.visibility === 'global';
  if(!isOwner && authz.role !== 'admin' && !isGlobalReadOnly){
    const error = new Error('No tienes permiso sobre este documento de Biblioteca.');
    error.status = 403;
    throw error;
  }
  return { ref, data: { id: snap.id, ...data }, canEdit: isOwner || authz.role === 'admin' };
}

async function uploadFile(req, res, authz){
  const { fileName, mimeType, dataBase64, visibility } = req.body || {};
  if(!fileName || !dataBase64){
    const error = new Error('Falta el archivo o el nombre.');
    error.status = 400;
    throw error;
  }

  const safeName = sanitizeFileName(fileName);
  const buffer = Buffer.from(String(dataBase64).split(',').pop(), 'base64');
  if(!buffer.length){
    const error = new Error('El archivo llego vacio.');
    error.status = 400;
    throw error;
  }
  assertAllowedFile({ name: safeName, mimeType, size: buffer.length });

  const wantsGlobal = visibility === 'global' && authz.role === 'admin';
  const db = getAdminDb();
  const bucket = getAdminStorage();
  const fileId = 'LIB-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
  const storagePath = `library/${authz.uid}/${fileId}/${safeName}`;
  const file = bucket.file(storagePath);
  await file.save(buffer, { metadata: { contentType: mimeType || 'application/octet-stream' } });
  const [downloadURL] = await file.getSignedUrl({ action: 'read', expires: '01-01-2500' });

  const meta = classifyLibraryFile(safeName);
  const extraction = await extractLibraryContent({ buffer, ext: extOf(safeName) });
  const insumosReview = (extraction.contentInsumos || []).map((_, index) => ({
    index, state: 'PROPUESTO', validatedBy: null, validatedAt: null
  }));
  const docRef = await db.collection('library').add({
    name: safeName,
    size: (buffer.length / 1048576).toFixed(2) + ' MB',
    ext: extOf(safeName).toUpperCase(),
    when: new Date().toLocaleDateString('es-MX'),
    cat: meta.cat,
    family: meta.family,
    tags: [],
    status: 'Subido e indexado',
    refOnly: false,
    uses: 0,
    ownerUid: authz.uid,
    visibility: wantsGlobal ? 'global' : 'private',
    storagePath,
    downloadURL,
    indexed: extraction.status === 'done',
    source: 'upload',
    contentText: extraction.contentText || '',
    contentInsumos: extraction.contentInsumos || [],
    insumosReview,
    extraction: { status: extraction.status, method: extraction.method, error: extraction.error || '', extractedAt: FieldValue.serverTimestamp() },
    createdAt: FieldValue.serverTimestamp()
  });

  res.status(200).json({
    ok: true,
    id: docRef.id,
    name: safeName,
    cat: meta.cat,
    family: meta.family,
    size: (buffer.length / 1048576).toFixed(2) + ' MB',
    type: extOf(safeName).toUpperCase(),
    url: downloadURL,
    date: new Date().toLocaleDateString('es-MX'),
    source: 'upload',
    extraction: { status: extraction.status, method: extraction.method, insumosCount: (extraction.contentInsumos || []).length }
  });
}

/* Busqueda real por contenido (keyword/heuristica determinista, NO semantica
   ni IA -- se etiqueta asi explicitamente en la respuesta para que el
   frontend nunca la presente como "busqueda con IA"). */
async function search(req, res, authz){
  const { query } = req.body || {};
  const db = getAdminDb();
  const docs = await visibleLibraryDocs(db, authz);
  const results = searchLibrary(docs, String(query || ''));
  res.status(200).json({ ok: true, method: 'keyword-content', results });
}

/* "Matrices similares": mismo motor de busqueda, acotado a Matrices APU /
   Costos, con evidencia explicable (terminos e insumos coincidentes), nunca
   un score opaco. */
async function similarMatrices(req, res, authz){
  const { docId, concept } = req.body || {};
  const db = getAdminDb();
  const docs = await visibleLibraryDocs(db, authz);
  let target = concept || '';
  if(docId){
    const { data } = await requireOwnedDoc(db, authz, docId);
    target = data;
  }
  if(!target){
    const error = new Error('Falta docId o concept para buscar matrices similares.');
    error.status = 400;
    throw error;
  }
  const results = findSimilarMatrices(docs, target);
  res.status(200).json({ ok: true, method: 'keyword-content', results });
}

/* Extrae (o re-extrae) el contenido real de un documento ya importado.
   Nunca decide precios: solo produce candidatos en estado PROPUESTO,
   pendientes de revision humana (confirmInsumos). */
async function extractInsumos(req, res, authz){
  const { docId } = req.body || {};
  const db = getAdminDb();
  const { ref, data, canEdit } = await requireOwnedDoc(db, authz, docId);
  if(!canEdit){
    const error = new Error('No tienes permiso para (re)extraer este documento.');
    error.status = 403;
    throw error;
  }
  if(data.refOnly || !data.storagePath){
    const error = new Error('Este documento es una REFERENCIA EXTERNA (no se descargo su contenido); no se puede extraer.');
    error.status = 409;
    throw error;
  }
  const bucket = getAdminStorage();
  const [buffer] = await bucket.file(data.storagePath).download();
  const extraction = await extractLibraryContent({ buffer, ext: extOf(data.name) });
  const insumosReview = (extraction.contentInsumos || []).map((_, index) => ({
    index, state: 'PROPUESTO', validatedBy: null, validatedAt: null
  }));
  await ref.update({
    contentText: extraction.contentText || '',
    contentInsumos: extraction.contentInsumos || [],
    insumosReview,
    indexed: extraction.status === 'done',
    extraction: { status: extraction.status, method: extraction.method, error: extraction.error || '', extractedAt: FieldValue.serverTimestamp() }
  });
  res.status(200).json({
    ok: true,
    id: docId,
    extraction: { status: extraction.status, method: extraction.method, error: extraction.error || '' },
    contentInsumos: extraction.contentInsumos || [],
    insumosReview
  });
}

/* Revision humana (Fase 3/5): el UNICO efecto de esta accion es persistir el
   estado (PROPUESTO/VALIDADO/RECHAZADO) de cada insumo, con usuario y fecha.
   Nunca envia nada a generate-apu: eso lo hace el cliente, y solo con los
   insumos que aqui queden en VALIDADO (regla del usuario, ver
   src/domain/libraryReview.js -> toCatalogRow). validatedBy SIEMPRE viene de
   la sesion autenticada (authz), nunca de lo que mande el cliente en el
   body: de lo contrario cualquiera podria firmar una validacion a nombre de
   otro usuario. */
async function confirmInsumos(req, res, authz){
  const { docId, decisions } = req.body || {};
  if(!Array.isArray(decisions) || !decisions.length){
    const error = new Error('Faltan las decisiones de revision (decisions).');
    error.status = 400;
    throw error;
  }
  const db = getAdminDb();
  const { ref, data, canEdit } = await requireOwnedDoc(db, authz, docId);
  if(!canEdit){
    const error = new Error('No tienes permiso para validar insumos de este documento.');
    error.status = 403;
    throw error;
  }
  const current = Array.isArray(data.insumosReview) ? data.insumosReview : [];
  const byIndex = new Map(current.map(r => [r.index, r]));
  const validatorId = authz.email || authz.uid;
  for(const decision of decisions){
    const existing = byIndex.get(decision.index) || { index: decision.index, state: 'PROPUESTO', validatedBy: null, validatedAt: null };
    const updated = applyInsumoReview(existing, { state: decision.state, validatedBy: validatorId });
    byIndex.set(decision.index, updated);
  }
  const insumosReview = Array.from(byIndex.values()).sort((a, b) => a.index - b.index);
  await ref.update({ insumosReview });
  res.status(200).json({ ok: true, id: docId, insumosReview });
}

export default async function handler(req, res){
  if(req.method !== 'POST'){
    res.status(405).json({ ok:false, error:'Metodo no permitido.' });
    return;
  }
  try{
    const authz = await requireFeature(req, 'library');
    const action = req.body?.action || 'upload';
    if(action === 'search') return await search(req, res, authz);
    if(action === 'similarMatrices') return await similarMatrices(req, res, authz);
    if(action === 'extractInsumos') return await extractInsumos(req, res, authz);
    if(action === 'confirmInsumos') return await confirmInsumos(req, res, authz);
    return await uploadFile(req, res, authz);
  }catch(err){
    res.status(err.status || 400).json({ ok:false, error: err.message || 'No se pudo completar la operacion de Biblioteca.' });
  }
}
