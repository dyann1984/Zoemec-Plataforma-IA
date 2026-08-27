/* Punto de extension OPCIONAL para busqueda semantica real (embeddings/IA)
   dentro de findCatalogMatches (src/domain/catalogLookup.js), fase de
   correccion "Busqueda semantica" -- punto 3 del spec del usuario. Mismo
   patron ya establecido para AIRenderProvider (src/lib/visualizationProviders.js)
   y CloudCatalogProvider (src/lib/cloudCatalogSync.js): una interfaz clara,
   un Null-provider honesto por defecto, y un registro vacio hasta que se
   conecte un proveedor real.

   SIN proveedor configurado (caso por defecto, sin API externa): el
   pipeline de catalogLookup.js nunca llega a esta etapa para la mayoria de
   las consultas (las 5 etapas anteriores ya resuelven casi todo), y cuando
   llega, NullSemanticProvider.available=false hace que se omita sin efecto
   -- el sistema funciona exactamente igual que sin este archivo. */

/* Forma que debe implementar un proveedor real futuro:
   { name, available:true, match(items, query) => {match, confidence} | null }
   `items`: catalogo ya filtrado por tipo (mismo shape que catalogLookup.js).
   `query`: {desc, unidad, categoria, clave} normalizados. */
export const NullSemanticProvider = Object.freeze({
  name: 'none',
  available: false,
  match(){
    return null;
  }
});

/* Registro de proveedores semanticos reales -- vacio en esta fase. Un
   proveedor futuro (embeddings locales, o una API de terceros) se agrega
   aqui por nombre y se activa por configuracion explicita, nunca
   hardcodeado como "el" proveedor ni simulado. */
export const SEMANTIC_PROVIDERS = Object.freeze({});

export function getSemanticProvider(name){
  return (name && SEMANTIC_PROVIDERS[name]) || NullSemanticProvider;
}
