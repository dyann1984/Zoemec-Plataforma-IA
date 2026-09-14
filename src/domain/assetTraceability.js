/* Trazabilidad del activo (Fase G, seccion 17): Activo -> Componente ->
   Construction DNA -> APU -> Concepto -> Plano/Proyecto. Puramente
   formatea una cadena de eslabones a partir de referencias YA resueltas
   por el llamador (server/api-lib/_route-assets.mjs) -- nunca vuelve a
   consultar Firestore ni recalcula ningun dato de los eslabones. Un
   eslabon sin dato real se omite (nunca se inventa un punto intermedio). */
export function buildComponentTraceability(component, { asset = null, constructionDnaVersion = null, apu = null, concepto = null, project = null } = {}){
  const chain = [];
  if(asset) chain.push({ level: 'ACTIVO', id: asset.id, label: asset.nombre || asset.id });
  if(component) chain.push({ level: 'COMPONENTE', id: component.id, label: component.nombre || component.id });
  if(constructionDnaVersion) chain.push({ level: 'CONSTRUCTION_DNA', id: constructionDnaVersion.version, label: `Construction DNA ${constructionDnaVersion.version}` });
  if(apu) chain.push({ level: 'APU', id: apu.id, label: apu.concept || apu.clave || apu.id });
  if(concepto) chain.push({ level: 'CONCEPTO', id: concepto.id, label: concepto.concept || concepto.clave || concepto.id });
  if(project) chain.push({ level: 'PROYECTO', id: project.id, label: project.name || project.id });
  return chain;
}
