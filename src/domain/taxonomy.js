/* Taxonomia unica de disciplinas: la usan tanto la Biblioteca (para clasificar
   documentos) como el motor de generacion de APU por concepto (para etiquetar
   la familia de un concepto, ver src/domain/apuGeneration.js). Un documento y
   un APU con la misma familia usan literalmente el mismo texto, para que
   "usar como fuente" tenga sentido. */
export const LIBRARY_DISCIPLINES = [
  ['Acabados',['acabado','piso','azulejo','loseta','porcelanato','ceramico','pintura','aplanado','recubrimiento','boquilla','marmol','granito','sellador','registro','impermeabiliz']],
  ['Albanileria',['albanileria','muro','block','tabique','castillo','cadena','mortero','aplanado']],
  ['Tablaroca y Durock',['tablaroca','durock','yeso','plafon','bastidor','panel','lavabo']],
  ['Electricidad',['electricidad','electrico','electrica','cfe','luminaria','cable','contacto','canalizacion','conduit']],
  ['Hidrosanitaria',['hidrosanitario','hidraulica','sanitario','agua potable','drenaje','alcantarillado','tuberia','valvula','bomba','bombeo']],
  ['Aire acondicionado',['aire acondicionado','hvac','ducto','difusor','chiller','minisplit']],
  ['Estructura metalica',['estructura','metalica','acero','ptr','perfil','soldadura','herrerias','herreria']],
  ['Cimentacion',['cimentacion','zapata','losa','contratrabe','pilote','plantilla','concreto']],
  ['Terracerias',['terraceria','excavacion','relleno','compactacion','acarreo','base hidraulica']],
  ['Urbanizacion',['urbanizacion','pavimento','banqueta','guarnicion','asfalto','adoquin']],
  ['Equipamiento',['equipamiento','mobiliario','senaletica','senalizacion','juego','equipo']],
  ['Limpieza y preliminares',['limpieza','preliminar','trazo','nivelacion','demolicion','retiro']],
  ['Gas e incendio',['gas','incendio','sprinkler','hidrante','extintor']]
];
