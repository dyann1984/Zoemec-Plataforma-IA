// F4-QA -- shim de 'firebase/storage': Storage no existe en el servidor QA
// (igual que en el plan actual de produccion, Storage deshabilitado).
const off = () => Promise.reject(Object.assign(new Error('Storage no disponible en el servidor QA.'), { code: 'storage/unavailable' }));
export function getStorage(){ return { __qaStorage: true }; }
export function connectStorageEmulator(){}
export function ref(storage, path = ''){ return { fullPath: path, name: String(path).split('/').pop() }; }
export const uploadBytes = off;
export const getDownloadURL = off;
export const deleteObject = off;
export function uploadBytesResumable(){
  return { on(evt, next, error){ setTimeout(() => error?.(Object.assign(new Error('Storage no disponible en el servidor QA.'), { code: 'storage/unavailable' })), 0); }, cancel(){}, then: (a, b) => off().then(a, b) };
}
