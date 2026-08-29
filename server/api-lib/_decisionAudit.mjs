import { FieldValue } from './_firebaseAdmin.mjs';

/* Trail de auditoria INMUTABLE (Fase 6, reglas 7 y 9 del spec): un documento
   NUEVO por accion via .add() (auto-id), nunca se actualiza ni se borra un
   registro existente -- "no borrar historia", "no mutar el pasado". Comun a
   Technical Memory y Challenge Decisions: misma forma de registro, distinta
   coleccion segun el dominio (evita duplicar la logica de "agregar un
   registro de auditoria" en cada endpoint). */
export async function appendAudit(dbOrTx, collectionRefOrDb, record){
  // Dos formas de uso: appendAudit(db, 'coleccion', record) para escrituras
  // sueltas, o appendAudit(tx, db.collection('coleccion').doc(), record)
  // dentro de una transaccion (regla 6: la accion de estado y su registro de
  // auditoria deben confirmarse juntos, atomicamente).
  if(typeof collectionRefOrDb === 'string'){
    await dbOrTx.collection(collectionRefOrDb).add({ ...record, timestamp: FieldValue.serverTimestamp() });
  }else{
    dbOrTx.set(collectionRefOrDb, { ...record, timestamp: FieldValue.serverTimestamp() });
  }
}
