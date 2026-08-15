/* Clasificacion, etiquetado y busqueda de documentos de Biblioteca. Logica
   pura (sin React, sin Firebase): recibe metadatos de archivo y devuelve
   familia/tags/score. */
import { cleanText } from '../lib/excelImport.js';
import { LIBRARY_DISCIPLINES } from './taxonomy.js';

export function libKey(v=''){
  return cleanText(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9.%/ -]/g,' ').replace(/\s+/g,' ').trim();
}

export function detectLibraryFamily(name='', cat=''){
  const key=libKey(`${name} ${cat}`);
  const hit=LIBRARY_DISCIPLINES.find(([,terms])=>terms.some(t=>key.includes(libKey(t))));
  return hit ? hit[0] : 'General';
}

export function extractLibraryTags(name='', cat='', family=''){
  const key=libKey(`${name} ${cat} ${family}`);
  const tags=[
    ['apu','APU'],['matriz','Matriz'],['matrices','Matriz'],['precio','Precio'],['costo','Costo'],
    ['rendimiento','Rendimiento'],['mano de obra','Mano de obra'],['cuadrilla','Cuadrilla'],
    ['fsr','FSR'],['catalogo','Catalogo'],['base','Base'],['norma','Norma'],['formato','Formato'],
    ['excel','Excel'],['xlsx','Excel'],['pdf','PDF'],['obra publica','Obra publica'],['neodata','Neodata'],['opus','OPUS']
  ].filter(([needle])=>key.includes(needle)).map(([,tag])=>tag);
  const familyTags=family && family!=='General' ? [family] : [];
  return [...new Set([...familyTags,...tags])].slice(0,7);
}

export function enrichLibraryMeta(meta, classify){
  const cat=meta.cat || classify(meta.name);
  const family=meta.family || detectLibraryFamily(meta.name, cat);
  const tags=meta.tags?.length ? meta.tags : extractLibraryTags(meta.name, cat, family);
  const sourceType=['XLS','XLSX','CSV'].includes(meta.ext) ? 'Hoja de costos' : ['PDF'].includes(meta.ext) ? 'Documento tecnico' : ['JPG','JPEG','PNG','WEBP'].includes(meta.ext) ? 'Imagen tecnica' : 'Archivo tecnico';
  return {...meta,cat,family,tags,sourceType,indexed:true,status:meta.status && meta.status!=='Pendiente de indice' ? meta.status : 'Indexado por metadata',confidence:Math.min(98,55+tags.length*7)};
}

export function scoreLibraryFile(file,q=''){
  const query=libKey(q);
  if(!query) return 1;
  const hay=libKey([file.name,file.cat,file.family,file.sourceType,...(file.tags||[])].join(' '));
  const terms=query.split(' ').filter(Boolean);
  return terms.reduce((n,t)=>n+(hay.includes(t)?2:0), hay.includes(query)?8:0);
}
