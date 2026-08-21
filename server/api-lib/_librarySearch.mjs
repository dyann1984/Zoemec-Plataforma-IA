/* Busqueda y "matrices similares" reales para Biblioteca (RC4).

   Deliberadamente NO es busqueda semantica/vectorial: es coincidencia de
   terminos (keyword) determinista y explicable sobre metadata + contenido ya
   extraido (contentText/contentInsumos). Se documenta asi en la UI para no
   presentarla como "IA" si no lo es (instruccion explicita del usuario). Un
   re-rank opcional con OpenAI puede añadirse despues como capa aparte,
   apagada por defecto. */

const STOPWORDS = new Set(['de','del','la','el','los','las','y','con','para','por','un','una','unos','unas','en','a','al']);

function normalize(v = ''){
  return String(v)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function termsOf(v = ''){
  return normalize(v).split(' ').filter(t => t.length > 2 && !STOPWORDS.has(t));
}

/* Texto combinado real de un documento: metadata + contenido extraido.
   Trunca contentText para no hacer O(n) costoso sobre documentos enormes. */
function docHaystack(doc){
  const insumosText = (doc.contentInsumos || []).map(i => i.desc).join(' ');
  return normalize([
    doc.name, doc.cat, doc.family, (doc.tags || []).join(' '),
    (doc.contentText || '').slice(0, 20000), insumosText
  ].join(' '));
}

/* Regresa {score, matchedTerms, matchedInsumos} -- nunca un numero opaco:
   siempre se puede explicar POR QUE un documento aparecio en el resultado. */
export function scoreLibraryDoc(doc, queryTerms){
  if(!queryTerms.length) return { score: 0, matchedTerms: [], matchedInsumos: [] };
  const haystack = docHaystack(doc);
  const matchedTerms = queryTerms.filter(t => haystack.includes(t));
  const matchedInsumos = (doc.contentInsumos || [])
    .filter(i => queryTerms.some(t => normalize(i.desc).includes(t)))
    .slice(0, 5);
  const nameBoost = queryTerms.some(t => normalize(doc.name).includes(t)) ? 3 : 0;
  const score = matchedTerms.length * 2 + matchedInsumos.length + nameBoost;
  return { score, matchedTerms, matchedInsumos };
}

export function searchLibrary(docs, query){
  const queryTerms = termsOf(query);
  return (docs || [])
    .map(doc => {
      const { score, matchedTerms, matchedInsumos } = scoreLibraryDoc(doc, queryTerms);
      return {
        id: doc.id,
        name: doc.name,
        cat: doc.cat,
        family: doc.family,
        score,
        matchedTerms,
        matchedInsumos,
        source: doc.source || 'upload',
        status: doc.status || 'Subido e indexado',
        indexed: Boolean(doc.indexed),
        driveParentPath: doc.driveParentPath || []
      };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

const MATRIX_CATEGORIES = new Set(['Matrices APU', 'Costos']);

/* "Matrices similares": mismo motor de busqueda de arriba, acotado a
   categorias de matriz/costo, comparando contra el nombre+insumos del
   documento o concepto activo. Siempre regresa evidencia explicable
   (documento, categoria, terminos/insumos coincidentes, score) -- nunca solo
   un numero. */
export function findSimilarMatrices(docs, target){
  const targetText = typeof target === 'string' ? target : [target?.name, target?.concept, (target?.contentInsumos || []).map(i => i.desc).join(' ')].filter(Boolean).join(' ');
  const queryTerms = termsOf(targetText);
  const targetId = target && typeof target === 'object' ? target.id : null;
  return (docs || [])
    .filter(doc => MATRIX_CATEGORIES.has(doc.cat) && doc.id !== targetId)
    .map(doc => {
      const { score, matchedTerms, matchedInsumos } = scoreLibraryDoc(doc, queryTerms);
      return {
        id: doc.id,
        name: doc.name,
        cat: doc.cat,
        family: doc.family,
        score,
        matchedTerms,
        matchedInsumos,
        driveParentPath: doc.driveParentPath || []
      };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);
}
