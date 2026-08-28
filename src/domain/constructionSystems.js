/* Registro extensible de sistemas constructivos: reemplaza el cascade de
   if/else que antes vivia dentro de makeAPUFromConcept (src/domain/
   apuGeneration.js) por una tabla ordenada e inspeccionable. Agregar una
   disciplina nueva es agregar una entrada a CONSTRUCTION_SYSTEMS_ORDER (+
   sus recursos en SYSTEM_RESOURCES y su metadata en SYSTEM_META), nunca
   anidar un nuevo if dentro de la funcion de clasificacion.

   MIGRACION: las entradas marcadas "migrado de apuGeneration.js" usan el
   MISMO texto de regex, en el MISMO orden relativo (primera coincidencia
   gana, igual que el cascade original: cascade A completo, luego cascade B
   completo) que el codigo que reemplazan -- comportamiento identico para
   los conceptos que ya estaban probados en apuGeneration.test.js, salvo el
   fix explicito documentado en isManualHaulingGuarded. */

/* --- Fix del caso reportado: "acero de refuerzo... incluye acarreos,
   cortes y dobleces" clasificaba como acarreo_manual (Terracerias) en vez
   de acero (Estructura metalica), porque el chequeo de "acarreo" corria
   antes que cualquier chequeo de material estructural en el cascade
   original. La cadena "incluye acarreos" es una ACTIVIDAD INCLUIDA, no la
   actividad principal del concepto.

   Fix quirurgico (no se reordena todo el cascade -- eso rompe el caso ya
   probado "acarreo de loseta 1.5m3" que SI debe seguir clasificando como
   acarreo, no como colocacion de piso, aunque mencione "loseta"): se
   excluye acarreo_manual SOLO cuando el texto combina un verbo de
   fabricacion/habilitado/montaje CON un material estructural real (acero,
   concreto, estructura metalica) -- la firma especifica del caso
   reportado. "Acarreo de loseta"/"acarreo de costales"/"acarreo de
   escombro" no traen ese verbo, asi que siguen clasificando igual que
   antes. */
function isManualHaulingGuarded(t){
  const mentionsHauling = /acarreo|acarrear/.test(t) && !/cami[oó]n|volteo|for[aá]neo/.test(t);
  if(!mentionsHauling) return false;
  const isFabricationOfStructuralMaterial = /habilitad|armad[oa]|montaje|fabricaci[oó]n|suministro y habilitado/.test(t)
    && /acero|varilla|fierro|concreto|estructura met[aá]lica/.test(t);
  return !isFabricationOfStructuralMaterial;
}

/* Orden de evaluacion: identico al cascade original (cascade A completa,
   despues cascade B), primera coincidencia gana DENTRO DE CADA NIVEL DE
   PRIORIDAD explicito (ver mas abajo) -- ya no es un simple "primero en el
   array gana" a ciegas. Ver comentario de apuGeneration.js#makeAPUFromConcept
   (version anterior a esta migracion) para el texto fuente de cada condicion.

   PRIORIDAD EXPLICITA (bug reportado: "impermeabilizante acrilico"
   clasificaba como pintura porque la regla de pintura, que contiene
   "acril", se evaluaba ANTES que "impermeabiliz" solo por posicion
   accidental en el array -- y "retiro de impermeabilizante... hasta losa
   de concreto" clasificaba como concreto por la misma razon con "losa").
   Cada entrada tiene un campo opcional `priority` (default 1 si se omite):

     0 = sistema constructivo especifico / nombre de disciplina inequivoco.
         La palabra que dispara la regla NO tiene otro significado plausible
         en ninguna otra disciplina (ej. "impermeabiliz", "canalizacion
         electrica", "minisplit", "sprinkler"). Estas reglas se evaluan
         ANTES que cualquier regla de prioridad 1 o 2, sin importar su
         posicion en el array.
     1 = verbo/actividad (default). Terminos razonablemente especificos de
         una actividad o elemento tecnico (ej. "aplanado", "colado",
         "zapata", nombres de producto como PUA501/MAPLA). Pueden coincidir
         entre si; dentro de este nivel gana el primero en orden de array,
         igual que el cascade original.
     2 = material generico. Adjetivos o sustantivos de material que
         MULTIPLES disciplinas comparten como contexto (ej. "acrilico",
         "vinilico", "primario", "yeso" a secas, "plaf" a secas) -- nunca
         deben ganarle a un sistema constructivo especifico (nivel 0) ni a
         una actividad concreta (nivel 1) solo por texto compartido. Se
         evaluan al final, y solo si nada de nivel 0/1 coincidio.

   classifyConstructionSystem() evalua nivel 0 completo, luego nivel 1
   completo, luego nivel 2 completo (cada nivel en el orden en que las
   entradas aparecen en este array) -- la prioridad es explicita y
   documentada, ya no un efecto secundario de donde quedo la entrada. */
export const CONSTRUCTION_SYSTEMS_ORDER = [
  { tipo:'demolicion', test:t=>/demolic|demoler|desmontar|retiro\s+de\s+(loseta|piso|azulejo|cer[aá]mic|porcelanato)/.test(t) },
  { tipo:'movimiento_mobiliario', test:t=>/movimiento\s+de\s+(mueble|mobiliario)|reacomodo\s+de\s+mobiliario|protecci[oó]n\s+y\s+movimiento\s+de\s+mobiliario/.test(t) },
  { tipo:'adhesivo', test:t=>/(aplicaci[oó]n|colocaci[oó]n|instalaci[oó]n)\s+de\s+adhesivo|pegazulejo|cemento\s+cola/.test(t) && !/loseta|azulejo|porcelanato|cer[aá]mic|\bpiso\b/.test(t) },
  { tipo:'acarreo_manual', test:isManualHaulingGuarded },
  { tipo:'plafon_suspendido', test:t=>/falso\s*plaf|plaf[oó]n(d)?\s+de\s+(tablaroca|yeso|tablacemento)|suspensi[oó]n\s*oculta|colganter[ií]a|canal\s*list[oó]n|perfacinta|redimix/.test(t) },
  { tipo:'tablaroca', test:t=>/falso\s*plaf|plaf[oó]n(d)?\s+de\s+(tablaroca|yeso|tablacemento)|suspensi[oó]n\s*oculta|colganter[ií]a|canal\s*list[oó]n|perfacinta|redimix|tablaroca|durock|tablacemento|trasdosado|cajillo|panel.*yeso/.test(t) },
  { tipo:'pintura', test:t=>{
    const isDrywall = /falso\s*plaf|plaf[oó]n(d)?\s+de\s+(tablaroca|yeso|tablacemento)|suspensi[oó]n\s*oculta|colganter[ií]a|canal\s*list[oó]n|perfacinta|redimix|tablaroca|durock|tablacemento|trasdosado|cajillo|panel.*yeso/.test(t);
    // "ep[oó]x" bare (sin contexto de pintura/recubrimiento) tambien
    // describe boquilla/adhesivo epoxico de piso, NUNCA solo pintura -- ver
    // caso reproducido "Colocacion de azulejo... con boquilla epoxica"
    // (evidencia motor universal, VAL-023). Los nombres de producto reales
    // (PUA 501/MAPLA) y la rama muro/plafon+recubrimiento ya cubren la
    // pintura epoxica genuina sin necesitar el match bare.
    // "vin[ií]lic"/"acr[ií]l" YA NO viven aqui como match "bare": son
    // adjetivos de material compartidos con impermeabilizacion
    // ("impermeabilizante acrilico"), no una actividad de pintura por si
    // solos -- ver la regla priority:2 mas abajo. "fachada(s)" se agrega al
    // grupo de sustrato junto a muro/plafon: es el sustrato tipico de
    // pintura de exteriores y NUNCA es sustrato de impermeabilizacion en la
    // practica real (azotea/losa si lo son, fachada no), asi que ampliarlo
    // aqui no reintroduce el riesgo de colision que motivo este fix.
    return !isDrywall && (
      /pua\s*501|pua501|mapla|suministro y aplicaci[oó]n de pintura|pintar|repint|esmalte|sellador vin/.test(t)
      || (/(muro|muros|plaf[oó]n|plafones|fachadas?)/.test(t) && /(pintura|recubrimiento|preparaci[oó]n de la superficie|lija|lavado|ep[oó]x)/.test(t))
    );
  } },
  { tipo:'estructura_metalica', test:t=>/escalera|barandal|herrer|ptr|perfil tubular|estructura metal|soldadur|acero.*calibre|bastidor.*acero/.test(t) },
  { tipo:'tablaroca', test:t=>/fald|tablaroca|durock|tablacemento|trasdosado|cajillo|panel.*yeso/.test(t) },
  /* Regla priority:2 (material generico): "yeso"/"plaf" a secas y "enchape"/
     "antimoho" NO identifican un sistema de tablaroca/drywall por si solos
     -- "aplanado ... con yeso" es un aplanado (mezcla aplicada con llana),
     no un panel prefabricado. Bug encontrado durante el mismo audit que el
     de pintura/impermeabilizacion (mismo patron: palabra de material
     compartida ganando por posicion de array a la actividad real): "Aplanado
     fino en muros interiores con yeso" clasificaba como tablaroca en vez de
     aplanado. Los terminos realmente especificos del sistema (tablaroca,
     durock, tablacemento, trasdosado, cajillo, "panel...yeso") se quedan en
     la regla de arriba (priority 1); solo el "yeso"/"plaf" sueltos bajan de
     nivel. Los casos genuinos de plafon ("plafon de yeso", "falso plafon")
     ya estan cubiertos por la regla plafon_suspendido/tablaroca de mas
     arriba en este mismo array, que sigue en priority 1. */
  { tipo:'tablaroca', priority:2, pattern:/plaf|enchape|antimoho|anti moho|yeso/, test:t=>/plaf|enchape|antimoho|anti moho|yeso/.test(t) },
  { tipo:'marmol_granito', test:t=>/marmol|granito|cubierta|barra lavamanos/.test(t) },
  { tipo:'registro', test:t=>/registro|tapa de acceso|tapa registro|paso de instalaciones/.test(t) },
  { tipo:'aplanado', test:t=>/aplanado|repellado|enjarre|plaster|uniblock|resane|emboquillado|chukum/.test(t) },
  // "epox" solo (sin contexto real de pintura) tambien describe boquilla/
  // adhesivo epoxico de piso -- ver caso reproducido "Colocacion de
  // azulejo... con boquilla epoxica" (evidencia motor universal, VAL-023):
  // ese concepto se clasificaba como pintura solo por la palabra "epoxica",
  // aunque "azulejo"/"boquilla" ya identifican claramente un piso. Se quita
  // "epox" de este chequeo generico (isPaintingConcept, mas arriba, sigue
  // reconociendo pintura epoxica real via su propio contexto de
  // muro/plafon/recubrimiento, sin este cambio).
  { tipo:'pintura', test:t=>/pintura|pintar|esmalte/.test(t) },
  /* Regla priority:2 (material generico): "acrilico"/"vinilico"/"primario"
     a secas NO identifican pintura por si mismos -- "impermeabilizante
     acrilico", "adhesivo acrilico" y "sellador vinilico" (impermeabilizacion,
     pisos) usan exactamente el mismo vocabulario. Bug reportado: esta regla
     vivia mas arriba (linea original ~59/76) SIN nivel de prioridad, y
     ganaba por posicion de array a "impermeabiliz" (ver CONSTRUCTION_
     SYSTEMS_ORDER, comentario de prioridad). Ahora solo se evalua si NADA
     de priority 0 o 1 coincidio (impermeabilizacion, pintura con contexto
     de sustrato, etc. siempre le ganan).
     El guard "!/impermeab/" es el caso explicito pedido: un texto como
     "Primer acrilico impermeable" (sin verbo de pintura, sin sustrato
     muro/plafon/fachada, pero con la palabra "impermeable") NO debe
     asumirse como pintura -- se deja caer al fallback por solape de
     palabras (matchType:'score', confianza baja) en vez de fingir certeza. */
  { tipo:'pintura', priority:2, pattern:/vin[ií]lic|acr[ií]l|primario/, test:t=>/vin[ií]lic|acr[ií]l|primario/.test(t) && !/impermeab/.test(t) },
  { tipo:'piso', test:t=>/porcelanato|loseta|azulejo|cer[aá]mic|lambr|piso|zoclo|boquilla|sardinel/.test(t) },
  { tipo:'marmol_granito', test:t=>/marmol|m[aá]rmol|granito|cubierta|barra lavamanos/.test(t) },
  { tipo:'sello', test:t=>/sellado|sello|silicon|silic[oó]n|calafate|junta|espuma/.test(t) },
  // --- (equivalente a `if(!tipo){...}`, cascade B del codigo original) ---
  { tipo:'bomba', test:t=>/bomba|electrobomba|equipo de bombeo|bombeo hidr[aá]ulico|motobomba/.test(t) },
  { tipo:'tuberia', test:t=>/tuber[ií]a|tubo\s|tubos\s|conducci[oó]n hidr[aá]ulica|red hidr[aá]ulica|l[ií]nea hidr[aá]ulica|bajada pluvial|drenaje sanitario/.test(t) },
  { tipo:'lavabo_ptr', test:t=>/lavabo|durock|ptr|mueble.*bañ|mueble.*ban|base.*lavabo|cer[aá]mico/.test(t) },
  { tipo:'estructura_metalica', test:t=>/estructura met[aá]lica|astm|a500|fy\s*=?\s*46|soldadur|perfil de acero|placa.*acero|grout|primario anticorrosivo|montaje.*estructura|fabricaci[oó]n.*estructura/.test(t) },
  // "concreto" evalua ANTES que "acero": un elemento de concreto armado real
  // (zapata/columna/losa/dado...) casi siempre menciona el refuerzo
  // (armada/varilla) en la MISMA descripcion -- ver caso reproducido con
  // descripciones reales de la Biblioteca ZOEMEC (samples/library/*.xlsx):
  // "Zapata aislada... de concreto... armada con varilla del No. 4..."
  // clasificaba como acero (Estructura metalica, sin ningun material de
  // concreto) en vez de concreto (Cimentacion, con cemento/arena/grava),
  // porque "armad"/"varilla" se evaluaba primero. Un concepto de acero como
  // linea PROPIA ("Suministro y habilitado de acero de refuerzo fy=4200")
  // sigue clasificando como acero: no menciona "concreto/losa/zapata/...".
  { tipo:'concreto', test:t=>/concreto|losa|zapata|firme|cimentaci|colado|columna de conc/.test(t) },
  { tipo:'acero', test:t=>/acero|varilla|castillo|cadena|armad|fierro|malla/.test(t) },
  { tipo:'block', test:t=>/block|tabique|tabic[oó]n|muro|partici[oó]n|mamposter|junteo/.test(t) },
  // priority:0 -- "impermeabiliz" es una raiz que no significa nada mas en
  // ninguna otra disciplina (a diferencia de "acrilico"/"losa"/"concreto",
  // que impermeabilizacion comparte como vocabulario de contexto). Bug
  // reportado + bug encontrado durante el mismo audit: "impermeabilizante
  // acrilico" (colisionaba con pintura) y "retiro de impermeabilizante...
  // hasta losa de concreto" (colisionaba con concreto, por la palabra
  // "losa") clasificaban mal solo porque "impermeabiliz" vivia sin
  // prioridad explicita, mas abajo en el array que 'pintura' y 'concreto'.
  { tipo:'imper', priority:0, pattern:/impermeabiliz/, test:t=>/impermeabiliz/.test(t) },
  { tipo:'limpieza_trazo', test:t=>/limpieza\s*(y|,)?\s*trazo|trazo\s*y\s*nivelaci[oó]n|trazo\s+topogr[aá]fico|desyerbe|chapeo|limpieza\s+(inicial|del\s+terreno|del\s+predio|del\s+solar)/.test(t) },
  { tipo:'desmonte_mecanico', test:t=>/desmonte|desenra[ií]ce|destronque/.test(t) },
  { tipo:'acarreo_camion', test:t=>/acarreo/.test(t) && /cami[oó]n|volteo|for[aá]neo/.test(t) },
  { tipo:'excavacion_mecanica', test:t=>/excavaci[oó]n?.*(m[aá]quina|mec[aá]nica|retroexcavadora|excavadora)|retroexcavadora|excavadora/.test(t) },
  { tipo:'excavacion', test:t=>/excavaci|zanja|despalme/.test(t) },
  // --- Disciplinas nuevas (motor universal): sin cobertura previa en el
  // cascade original. Cada una con recursos reales propios (SYSTEM_RESOURCES),
  // nunca relleno generico.
  //
  // priority:0 en las 13 -- bug encontrado durante el mismo audit de
  // pintura/impermeabilizacion: por vivir al FINAL del array (posicion
  // "nueva" al agregarse), cualquiera de estas colisionaba con las reglas
  // genericas de obra civil (block/tablaroca, que testean "muro"/"tabique"/
  // "yeso" a secas) cuando el texto mencionaba el sustrato/ubicacion de la
  // instalacion junto con el trabajo real. Ej.: "Instalacion de contacto
  // duplex en muro de tablaroca" clasificaba como tablaroca (Tablaroca y
  // Durock) en vez de electrica, solo porque 'block'/'tablaroca' aparecen
  // antes en el array -- "contacto\s"/"conduit"/"canalizacion electrica" no
  // significan nada mas que trabajo electrico, exactamente el mismo patron
  // que impermeabilizacion. Subirlas a priority:0 es la correccion
  // estructural (no un parche solo para electrica): las 13 comparten la
  // misma raiz del problema y el mismo tipo de regla (nombre de sistema
  // inequivoco), asi que reciben el mismo nivel de prioridad. ---
  { tipo:'electrica', priority:0, test:t=>/electricidad|el[eé]ctric[oa]|luminaria|contacto\s|apagador|canalizaci[oó]n el[eé]ctrica|conduit|charola\s*(porta)?cable|centro\s*de\s*carga|tablero\s*el[eé]ctrico|cableado\s*el[eé]ctrico/.test(t) },
  { tipo:'voz_datos', priority:0, test:t=>/voz\s*y\s*datos|cableado\s*estructurado|categor[ií]a\s*[567]|patch\s*panel|rack\s*de\s*telecomunicaciones|fibra\s*[oó]ptica/.test(t) },
  { tipo:'cctv', priority:0, test:t=>/cctv|c[aá]mara\s*de\s*seguridad|videovigilancia|circuito\s*cerrado/.test(t) },
  { tipo:'hvac', priority:0, test:t=>/hvac|aire\s*acondicionado|minisplit|mini\s*split|chiller|ducto\s*de\s*aire|difusor|climatizaci[oó]n/.test(t) },
  { tipo:'gas', priority:0, test:t=>/tuber[ií]a\s*de\s*gas|instalaci[oó]n\s*de\s*gas|regulador\s*de\s*gas|tanque\s*estacionario/.test(t) },
  { tipo:'contra_incendio', priority:0, test:t=>/contra\s*incendio|sprinkler|rociador(es)?|hidrante|extintor|gabinete\s*contra\s*incendio|red\s*h[uú]meda|red\s*seca/.test(t) },
  { tipo:'elevadores', priority:0, test:t=>/elevador|ascensor|montacargas\s*el[eé]ctrico|escalera\s*el[eé]ctrica/.test(t) },
  { tipo:'canceleria_aluminio_vidrio', priority:0, test:t=>/canceler[ií]a|ventana\s*de\s*aluminio|puerta\s*de\s*aluminio|perfil\s*de\s*aluminio|vidrio\s*templado|cristal\s*templado|dvh|doble\s*vidriado/.test(t) },
  { tipo:'carpinteria', priority:0, test:t=>/carpinter[ií]a|puerta\s*de\s*madera|closet\s*de\s*madera|mueble\s*de\s*madera|marco\s*de\s*madera/.test(t) },
  { tipo:'herreria', priority:0, test:t=>/herrer[ií]a|reja\s*met[aá]lica|port[oó]n\s*met[aá]lico|barandal\s*met[aá]lico(?!.*ptr)/.test(t) },
  { tipo:'jardineria', priority:0, test:t=>/jardiner[ií]a|[aá]rea\s*verde|pasto\s*en\s*rollo|siembra\s*de|riego\s*por\s*goteo|sistema\s*de\s*riego/.test(t) },
  { tipo:'pavimento', priority:0, test:t=>/pavimento|carpeta\s*asf[aá]ltica|adoqu[ií]n|guarnici[oó]n|banqueta|concreto\s*hidr[aá]ulico\s*para\s*calle/.test(t) },
  { tipo:'senalizacion', priority:0, test:t=>/se[nñ]alizaci[oó]n|se[nñ]al[eé]tica|pintura\s*de\s*franjas|topes\s*vehiculares/.test(t) }
];

/* Recursos por tipo (misma forma [descripcion,cantidad,unidad,precio,merma]
   que siempre uso este motor). Las 24 entradas migradas conservan EXACTAMENTE
   los mismos valores que el TPL original de apuGeneration.js. */
export const SYSTEM_RESOURCES = {
  lavabo_ptr:{ unit:'m',
    materials:[['Perfil PTR de acero de 2" x 2" cal. 14',1.15,'m',92,0],['Tablero de cemento Durock 12.7 mm',0.65,'m²',210,0],['Anclajes, fijaciones, tornillería y soldadura',1,'lote',25,0],['Pasta, cinta y malla para juntas',0.18,'jgo',85,3],['Pintura anticorrosiva / primario',0.08,'L',98,3],['Materiales misceláneos de ajuste y protección',0.04,'jgo',120,0]],
    labor:[['Cuadrilla de herrero + ayudante',0.035,'jor',1400,1],['Trazo, nivelación y presentación',0.015,'jor',700,1],['Resanes, cortes y adecuaciones',0.02,'jor',700,1],['Limpieza, retiro y protección del área',0.02,'jor',470,1]],
    equipment:[['Equipo de protección y andamios (5% de M.O.)',0.05,'(%MO)',49],['Soldadora y herramienta de corte',0.03,'día',120]] },
  tablaroca:{ unit:'m²',
    materials:[['Panel de yeso / tablacemento 12.7 mm segun especificacion',1.05,'m²',210,5],['Poste o canal metalico galvanizado',1.25,'m',38,5],['Canal de amarre y refuerzos',0.55,'m',32,5],['Tornilleria, taquetes y fijaciones',0.18,'jgo',85,3],['Cinta y compuesto para juntas',0.22,'kg',42,5],['Pasta / sellador de acabado',0.12,'L',70,5],['Materiales miscelaneos y proteccion',0.04,'jgo',120,0]],
    labor:[['Instalador de panel (oficial)',0.12,'jor',420,1.85],['Ayudante instalador',0.12,'jor',285,1.82],['Trazo, plomeo y nivelacion',0.025,'jor',420,1.85],['Tratamiento de juntas y resanes',0.05,'jor',380,1.85],['Limpieza y retiro de desperdicio',0.035,'jor',258,1.82]],
    equipment:[['Andamio / escalera de trabajo',0.04,'día',120],['Herramienta electrica de corte y fijacion',0.03,'día',150],['Equipo de seguridad personal',0.02,'día',90]] },
  plafon_suspendido:{ unit:'m²',
    materials:[
      ['Panel de yeso (tablaroca) 12.7 mm segun especificacion',1.05,'m²',95,8],
      ['Canaleta de carga 38 mm cal. 22 con pintura anticorrosiva',0.95,'m',38,5],
      ['Canal liston para suspension oculta',2.3,'m',30,5],
      ['Colganteria de alambre galvanizado No. 14',0.12,'kg',48,5],
      ['Alambre recocido No. 16 para amarres',0.05,'kg',38,3],
      ['Ancla de agujero tipo Ramset con fulminante',1.5,'pza',9,3],
      ['Tornilleria S-1" y fijaciones para panel',0.18,'jgo',85,3],
      ['Perfacinta para tratamiento de juntas',1.5,'m',3,5],
      ['Compuesto Redimix para juntas y resanes',0.9,'kg',22,5]
    ],
    labor:[
      ['Tablaroquero oficial (suspension oculta hasta 4.00 m)',0.1,'jor',420,1.85],
      ['Ayudante instalador',0.1,'jor',285,1.82],
      ['Trazo, nivelacion y balanceado de colganteria',0.03,'jor',420,1.85],
      ['Tratamiento de juntas: perfacinta y Redimix',0.05,'jor',380,1.85],
      ['Limpieza y retiro de desperdicio',0.03,'jor',258,1.82]
    ],
    equipment:[
      ['Andamio de trabajo hasta 4.00 m de altura',0.06,'día',120],
      ['Herramienta electrica: rotomartillo y atornillador',0.04,'día',150],
      ['Equipo de seguridad personal',0.02,'día',90]
    ] },
  sello:{ unit:'ml',
    materials:[['Sellador elastomerico / silicon anti hongos',0.12,'cartucho',95,5],['Primer o limpiador de superficie',0.03,'L',85,3],['Cinta de respaldo o espuma de poliuretano',0.08,'m',18,5],['Material de limpieza y proteccion',0.03,'jgo',60,0]],
    labor:[['Oficial aplicador de sellos',0.035,'jor',380,1.85],['Ayudante',0.025,'jor',258,1.82],['Preparacion, limpieza y retiro',0.02,'jor',258,1.82]],
    equipment:[['Pistola calafateadora y herramienta menor',0.02,'día',60],['Escalera / andamio proporcional',0.02,'día',120]] },
  marmol_granito:{ unit:'m²',
    materials:[['Adhesivo flexible para piedra natural',0.22,'bulto',220,5],['Boquilla / resina de junta',0.28,'kg',85,5],['Anclajes, separadores y niveladores',0.12,'jgo',120,3],['Material de limpieza y proteccion',0.05,'jgo',90,0]],
    labor:[['Colocador especializado en marmol/granito',0.16,'jor',520,1.85],['Ayudante colocador',0.16,'jor',285,1.82],['Trazo, cortes y ajuste de piezas',0.06,'jor',520,1.85],['Limpieza final y proteccion',0.04,'jor',258,1.82]],
    equipment:[['Cortadora con disco diamantado',0.05,'día',180],['Pulidora / herramienta menor',0.04,'día',150],['Equipo de izaje o apoyo proporcional',0.02,'día',200]] },
  registro:{ unit:'pza',
    materials:[['Marco y tapa de registro segun medida especificada',1,'pza',480,3],['Canal / perfil galvanizado para soporte',1.2,'m',38,5],['Tornilleria, taquetes y fijaciones',0.12,'jgo',85,3],['Panel de cierre o placa de ajuste',0.35,'m²',210,5],['Pasta, cinta y resane perimetral',0.15,'kg',42,5],['Material de limpieza y proteccion',0.03,'jgo',60,0]],
    labor:[['Oficial instalador',0.18,'jor',420,1.85],['Ayudante instalador',0.18,'jor',285,1.82],['Trazo, nivelacion y ajuste de vano',0.04,'jor',420,1.85],['Resane y limpieza final',0.04,'jor',258,1.82]],
    equipment:[['Herramienta electrica de corte y fijacion',0.05,'día',150],['Escalera / andamio proporcional',0.03,'día',120],['Equipo de seguridad personal',0.02,'día',90]] },
  estructura_metalica:{ unit:'kg',
    materials:[['Acero estructural ASTM A500 Fy=46 KSI (incl. desperdicio)',1.05,'kg',46.5,0],['Soldadura E-7018 y consumibles de taller',0.03,'kg',120,0],['Primario anticorrosivo alquidálico de alta resistencia',0.02,'L',110,0],['Grout, anclajes y placas base proporcionales',0.015,'jgo',180,0]],
    labor:[['Cuadrilla de montadores y soldadores calificados',0.012,'jor',1650,1],['Trazo, plomeo y verificación de montaje',0.004,'jor',900,1],['Habilitado, limpieza y protección de soldadura',0.004,'jor',780,1]],
    equipment:[['Grúa / equipo de izaje proporcional',0.015,'hr',550],['Soldadora, extensiones y herramienta de montaje',0.018,'hr',180],['Herramienta menor y equipo de protección (EPP)',0.08,'(%MO)',19.8]] },
  concreto:{ unit:'m³',
    materials:[['Cemento gris CPC 30R',7,'bulto',225,3],['Arena',0.55,'m³',480,5],['Grava 19 mm',0.75,'m³',520,5],['Agua',0.18,'m³',65,0],['Curacreto / membrana de curado',0.12,'L',68,3],['Clavo y madera auxiliar para niveles',0.015,'jgo',180,5]],
    labor:[['Oficial albañil',0.22,'jor',380,1.85],['Ayudante / peón',0.22,'jor',258,1.82],['Cabo de obra',0.03,'jor',520,1.85],['Limpieza y curado',0.08,'jor',258,1.82]],
    equipment:[['Revolvedora 1 saco',0.25,'hr',95],['Vibrador de concreto',0.2,'hr',110],['Herramienta de nivelación',0.05,'día',90]] },
  acero:{ unit:'kg',
    materials:[['Acero de refuerzo fy=4200',1.05,'kg',26.5,2],['Alambre recocido cal. 18',0.03,'kg',32,3]],
    labor:[['Fierrero (oficial)',0.018,'jor',400,1.85],['Ayudante',0.018,'jor',258,1.82]],
    equipment:[['Cizalla / dobladora',0.01,'día',180]] },
  pintura:{ unit:'m²',
    materials:[['Pintura vinílica / acrílica según especificación',0.18,'L',85,5],['Sellador vinílico 5x1 / primario según sustrato',0.06,'L',70,5],['Diluyente / agua limpia para aplicación',0.02,'L',28,0],['Lija fina para preparación de superficie',0.08,'pza',18,0],['Cinta masking para cortes y remates',0.05,'rollo',42,0],['Plástico, cartón y protección de áreas',0.08,'m²',12,0],['Rodillo, brocha y charola proporcional',0.035,'jgo',145,0]],
    labor:[['Pintor oficial',0.055,'jor',360,1.85],['Ayudante de pintor',0.045,'jor',258,1.82],['Preparación, lavado ligero, lijado y limpieza de superficie',0.025,'jor',258,1.82],['Protección de áreas, cortes y limpieza final',0.02,'jor',258,1.82]],
    equipment:[['Andamio / escalera de trabajo',0.04,'día',120],['Herramienta de aplicación: extensiones, rodillos y brochas',0.025,'día',75],['Equipo de seguridad personal',0.015,'día',90]] },
  imper:{ unit:'m²',
    materials:[['Impermeabilizante acrílico',1.6,'L',78,5],['Membrana de refuerzo',0.3,'m²',22,5],['Sellador / primario',0.15,'L',60,5]],
    labor:[['Aplicador (oficial)',0.05,'jor',360,1.85],['Ayudante',0.05,'jor',258,1.82]],
    equipment:[['Equipo de aplicación',0.03,'día',90]] },
  aplanado:{ unit:'m²',
    materials:[['Cemento gris CPC 30R',0.09,'bulto',225,3],['Cal hidratada',0.04,'bulto',95,3],['Arena cernida',0.025,'m³',480,5],['Agua',0.012,'m³',65,0],['Sellador / aditivo de adherencia',0.04,'L',85,3],['Materiales misceláneos',0.03,'jgo',120,0],['Plástico y protección de áreas',0.04,'m²',12,5]],
    labor:[['Albañil (oficial)',0.18,'jor',380,1.85],['Peón',0.18,'jor',258,1.82],['Resanes, cortes y adecuaciones',0.08,'jor',380,1.85],['Limpieza, acarreos y retiro al término',0.06,'jor',258,1.82]],
    equipment:[['Andamio / regla',0.04,'día',120],['Herramienta menor especializada',0.03,'día',85],['Carretilla y equipo de acarreo',0.02,'día',75]] },
  piso:{ unit:'m²',
    materials:[['Loseta cerámica 30x30',1.05,'m²',135,8],['Adhesivo / pegazulejo',0.18,'bulto',135,5],['Boquilla / junteador',0.3,'kg',28,5]],
    labor:[['Colocador (oficial)',0.12,'jor',400,1.85],['Ayudante',0.12,'jor',258,1.82]],
    equipment:[['Cortadora de loseta',0.03,'día',150]] },
  demolicion:{ unit:'m²',
    materials:[['Costales para retiro de escombro',0.4,'pza',12,0]],
    labor:[['Oficial de demolición',0.1,'jor',380,1.85],['Ayudante',0.1,'jor',258,1.82]],
    equipment:[['Rotomartillo / equipo de demolición',0.04,'día',180],['Herramienta menor (marro, cincel, pala)',0.04,'día',80],['Equipo de seguridad personal (EPP: careta, guantes, botas)',0.03,'día',90]] },
  acarreo_manual:{ unit:'viaje',
    materials:[],
    labor:[['Peón de acarreo',0.05,'jor',258,1.82]],
    equipment:[['Carretilla / diablito de carga',0.03,'día',70],['Herramienta menor',0.02,'día',50],['Equipo de seguridad personal (EPP: guantes, faja, botas)',0.02,'día',90]] },
  adhesivo:{ unit:'m²',
    materials:[['Adhesivo / cemento cola según especificación',0.2,'bulto',135,8],['Agua para mezcla',0.02,'m³',65,0],['Material de limpieza y protección',0.03,'jgo',60,0]],
    labor:[['Aplicador oficial (llana dentada)',0.06,'jor',400,1.85],['Ayudante',0.06,'jor',258,1.82]],
    equipment:[['Llana dentada y herramienta de aplicación',0.02,'día',80],['Mezclador / taladro con batidor',0.02,'día',100],['Cubetas graduadas',0.02,'día',40],['Equipo de seguridad personal (EPP: guantes, lentes)',0.02,'día',70]] },
  movimiento_mobiliario:{ unit:'lote',
    materials:[['Material de protección (cartón, plástico, cinta)',1,'lote',180,0]],
    labor:[['Cuadrilla de maniobras (oficial + ayudante)',0.15,'jor',700,1.85]],
    equipment:[['Herramienta menor de maniobra',0.05,'día',60],['Equipo de seguridad personal (EPP: guantes, faja)',0.03,'día',70]] },
  excavacion:{ unit:'m³',
    materials:[],
    labor:[['Peón (excavación manual)',0.6,'jor',258,1.82],['Cabo de obra',0.03,'jor',380,1.85]],
    equipment:[['Herramienta de excavación (pala, pico, barreta)',0.05,'día',60]] },
  limpieza_trazo:{ unit:'m²',
    materials:[['Cal para trazo',0.05,'kg',12,0],['Estacas de madera',0.08,'pza',8,5],['Hilo nylon para trazo',0.02,'rollo',35,0],['Pintura en aerosol para referencias',0.01,'pza',55,0]],
    labor:[['Cuadrilla de trazo y nivelación (topógrafo/albañil oficial)',0.02,'jor',480,1.85],['Ayudante de trazo',0.02,'jor',258,1.82]],
    equipment:[['Equipo topográfico básico (nivel, estadal, cinta)',0.015,'día',180],['Herramienta menor',0.02,'día',60]] },
  desmonte_mecanico:{ unit:'m²',
    materials:[],
    labor:[['Operador de maquinaria pesada',0.015,'jor',650,1.85],['Peón de apoyo',0.02,'jor',258,1.82]],
    equipment:[['Tractor / retroexcavadora para desmonte',0.04,'hr',850],['Combustible y consumibles de equipo (costo horario)',0.04,'hr',180]] },
  excavacion_mecanica:{ unit:'m³',
    materials:[],
    labor:[['Operador de excavadora / retroexcavadora',0.025,'jor',650,1.85],['Peón de apoyo',0.03,'jor',258,1.82]],
    equipment:[['Excavadora / retroexcavadora',0.06,'hr',950],['Combustible y consumibles de equipo (costo horario)',0.06,'hr',150]] },
  acarreo_camion:{ unit:'m³',
    materials:[],
    labor:[['Operador de camión de volteo',0.02,'jor',480,1.85],['Ayudante de maniobras',0.01,'jor',258,1.82]],
    equipment:[['Camión de volteo 7 m³ (costo por hora/ciclo, editable segun distancia)',0.08,'hr',680],['Cargador frontal (carga de material, si aplica)',0.015,'hr',780]] },
  block:{ unit:'m²',
    materials:[['Block hueco 15x20x40',12.5,'pza',16.5,3],['Cemento gris CPC 30R',0.16,'bulto',225,3],['Arena cernida',0.035,'m³',480,5],['Agua',0.012,'m³',65,0],['Alambre / plomeo / nivelación',0.015,'jgo',90,0],['Materiales misceláneos',0.02,'jgo',120,0]],
    labor:[['Albañil (oficial)',0.35,'jor',380,1.85],['Peón',0.35,'jor',258,1.82],['Trazo, plomeo y nivelación',0.04,'jor',380,1.85],['Acarreos internos y limpieza',0.05,'jor',258,1.82]],
    equipment:[['Andamio / equipo básico',0.05,'día',280],['Revolvedora 1 saco',0.04,'hr',95],['Herramienta de corte y ajuste',0.02,'día',90]] },
  bomba:{ unit:'pza',
    materials:[['Bomba centrifuga / sumergible segun especificacion',1,'pza',8500,0],['Base o soporte antivibratorio',1,'jgo',420,0],['Valvulas de conexion (check y compuerta)',2,'pza',380,0],['Conexiones electricas, cable y proteccion termica',1,'lote',650,0],['Accesorios de acople e instalacion',1,'jgo',280,3]],
    labor:[['Instalador electromecanico (oficial)',0.8,'jor',520,1.85],['Ayudante instalador',0.8,'jor',285,1.82],['Pruebas, arranque y ajuste de equipo',0.2,'jor',520,1.85]],
    equipment:[['Polipasto / equipo de izaje proporcional',0.15,'día',220],['Herramienta electrica y de conexion',0.1,'día',150],['Equipo de seguridad personal',0.05,'día',90]] },
  tuberia:{ unit:'m',
    materials:[['Tubo segun diametro y material especificado',1.05,'m',95,3],['Coples y conexiones proporcionales',0.3,'pza',45,3],['Pegamento / soldadura segun material de tuberia',0.06,'lote',85,0],['Soporteria y abrazaderas',0.25,'pza',38,3]],
    labor:[['Tubero / plomero (oficial)',0.09,'jor',400,1.85],['Ayudante',0.09,'jor',258,1.82],['Pruebas hidrostaticas y ajuste de juntas',0.02,'jor',400,1.85]],
    equipment:[['Herramienta de corte y union de tuberia',0.03,'día',110],['Equipo de prueba de presion',0.02,'día',150]] },
  generico:{ unit:'pza',
    materials:[['Pendiente de cotización: insumo principal no identificado automáticamente',1,'pza',0,0],['Pendiente de cotización: materiales complementarios y de fijación',1,'lote',0,0]],
    labor:[['Oficial (revisar cuadrilla segun concepto)',0.1,'jor',380,1.85],['Ayudante',0.1,'jor',258,1.82]],
    equipment:[['Herramienta menor y equipo de apoyo (revisar segun concepto)',0.05,'día',100]] },
  // --- Disciplinas nuevas (motor universal) ---
  electrica:{ unit:'pza',
    materials:[['Cable THW-LS calibre según circuito',3,'m',18,5],['Tubería conduit PVC/EMT y conexiones',1,'m',22,5],['Contacto / apagador / luminaria según especificación',1,'pza',180,0],['Caja de conexiones y accesorios de fijación',1,'jgo',45,3]],
    labor:[['Electricista (oficial)',0.1,'jor',420,1.85],['Ayudante electricista',0.1,'jor',258,1.82]],
    equipment:[['Herramienta eléctrica de instalación',0.03,'día',110],['Multímetro / equipo de prueba',0.02,'día',80]] },
  voz_datos:{ unit:'pza',
    materials:[['Cable UTP categoría según especificación',3,'m',12,5],['Jack RJ45 / patch cord',1,'pza',60,0],['Canaleta / tubería para cableado',1,'m',20,5],['Placa y accesorios de salida',1,'pza',85,0]],
    labor:[['Técnico instalador de redes (oficial)',0.08,'jor',450,1.85],['Ayudante',0.08,'jor',258,1.82]],
    equipment:[['Certificador de cableado estructurado',0.03,'día',150],['Herramienta de ponchado/crimpado',0.03,'día',60]] },
  cctv:{ unit:'pza',
    materials:[['Cámara de seguridad según especificación',1,'pza',1800,0],['Cable UTP/coaxial para transmisión',5,'m',12,5],['Fuente de alimentación / conector',1,'jgo',180,0]],
    labor:[['Técnico instalador de CCTV (oficial)',0.15,'jor',450,1.85],['Ayudante',0.15,'jor',258,1.82]],
    equipment:[['Herramienta de instalación y configuración',0.05,'día',100],['Equipo de prueba de señal',0.03,'día',80]] },
  hvac:{ unit:'pza',
    materials:[['Equipo de aire acondicionado según especificación',1,'pza',9500,0],['Tubería de cobre y aislamiento',3,'m',85,3],['Refrigerante según equipo',1,'kg',350,0],['Soportería y accesorios de fijación',1,'jgo',280,0]],
    labor:[['Técnico HVAC (oficial)',0.4,'jor',520,1.85],['Ayudante instalador',0.4,'jor',285,1.82]],
    equipment:[['Bomba de vacío y manifold de carga',0.1,'día',220],['Herramienta de instalación (soldadura, corte)',0.08,'día',150]] },
  gas:{ unit:'m',
    materials:[['Tubería de cobre/CPVC para gas según diámetro',1.05,'m',110,3],['Conexiones y reguladores proporcionales',0.3,'pza',180,3],['Cinta/sellador para roscas',0.05,'pza',35,0]],
    labor:[['Instalador certificado de gas (oficial)',0.12,'jor',480,1.85],['Ayudante',0.12,'jor',258,1.82]],
    equipment:[['Equipo de prueba de hermeticidad',0.03,'día',150],['Herramienta de corte y unión',0.03,'día',110]] },
  contra_incendio:{ unit:'pza',
    materials:[['Rociador / hidrante / extintor según especificación',1,'pza',650,0],['Tubería y conexiones del sistema',2,'m',120,3],['Soportería y accesorios de fijación',1,'jgo',180,0]],
    labor:[['Instalador certificado contra incendio (oficial)',0.2,'jor',480,1.85],['Ayudante',0.2,'jor',258,1.82]],
    equipment:[['Equipo de prueba de presión del sistema',0.05,'día',180],['Herramienta de instalación',0.05,'día',110]] },
  elevadores:{ unit:'pza',
    materials:[['Componentes de cabina/mecanismo según especificación',1,'lote',85000,0],['Cableado y accesorios de control',1,'lote',3500,0]],
    labor:[['Técnico instalador certificado (oficial)',2,'jor',900,1.85],['Ayudante instalador',2,'jor',450,1.82]],
    equipment:[['Grúa / equipo de izaje',0.3,'día',650],['Equipo de prueba y calibración',0.1,'día',300]] },
  canceleria_aluminio_vidrio:{ unit:'m²',
    materials:[['Perfil de aluminio según especificación',2.2,'m',180,3],['Cristal/vidrio según espesor especificado',1.05,'m²',650,3],['Sellador estructural y accesorios de fijación',1,'jgo',220,0]],
    labor:[['Instalador de cancelería (oficial)',0.15,'jor',450,1.85],['Ayudante',0.15,'jor',258,1.82]],
    equipment:[['Ventosas de izaje y herramienta de instalación',0.05,'día',150],['Equipo de nivelación',0.03,'día',80]] },
  carpinteria:{ unit:'pza',
    materials:[['Madera/MDF según especificación',1,'pza',1200,5],['Herrajes y accesorios de fijación',1,'jgo',280,0],['Barniz/acabado según especificación',0.3,'L',180,3]],
    labor:[['Carpintero (oficial)',0.6,'jor',450,1.85],['Ayudante',0.6,'jor',258,1.82]],
    equipment:[['Herramienta eléctrica de carpintería',0.05,'día',120]] },
  herreria:{ unit:'kg',
    materials:[['Perfil/lámina de acero según especificación',1.05,'kg',42,3],['Soldadura y consumibles',0.03,'kg',110,0],['Pintura anticorrosiva / acabado',0.02,'L',105,0]],
    labor:[['Herrero (oficial)',0.02,'jor',420,1.85],['Ayudante',0.02,'jor',258,1.82]],
    equipment:[['Soldadora y herramienta de corte',0.02,'día',150]] },
  jardineria:{ unit:'m²',
    materials:[['Tierra vegetal / composta',0.1,'m³',380,0],['Pasto en rollo / planta según especificación',1.05,'m²',65,5],['Sistema de riego (proporcional)',0.1,'lote',450,0]],
    labor:[['Jardinero (oficial)',0.05,'jor',350,1.85],['Ayudante',0.05,'jor',258,1.82]],
    equipment:[['Herramienta de jardinería',0.02,'día',60]] },
  pavimento:{ unit:'m²',
    materials:[['Carpeta asfáltica / concreto hidráulico según especificación',0.08,'m³',2200,3],['Base hidráulica compactada',0.15,'m³',380,5],['Riego de liga/impregnación',0.5,'L',22,0]],
    labor:[['Cuadrilla de pavimentación (oficial + ayudante)',0.03,'jor',700,1.85]],
    equipment:[['Compactador / rodillo',0.02,'hr',450],['Terminadora/extendedora (si aplica)',0.01,'hr',1200]] },
  senalizacion:{ unit:'pza',
    materials:[['Señal/letrero según especificación',1,'pza',450,0],['Poste/soporte y accesorios de fijación',1,'jgo',280,0]],
    labor:[['Instalador de señalización (oficial)',0.1,'jor',380,1.85],['Ayudante',0.1,'jor',258,1.82]],
    equipment:[['Herramienta de instalación',0.03,'día',80]] }
};

/* Metadata por tipo: familia (mismo vocabulario que LIBRARY_DISCIPLINES en
   taxonomy.js), confianza/SAT base cuando hubo match EXACTO, palabras
   requeridas por categoria (motor de QA, ver technicalQualityRules.js) y
   bolsa de palabras para el fallback por score (§6 del plan -- NUNCA se usa
   para el match exacto, solo cuando ninguna entrada de
   CONSTRUCTION_SYSTEMS_ORDER coincidio). */
export const SYSTEM_META = {
  plafon_suspendido:{ discipline:'Tablaroca y Durock', confidence:88, sat:'72152400', requiredResourceKeywords:{ materials:['panel','tablaroca','yeso'] }, keywordBag:['plafon','suspendido','tablaroca','colganteria','panel'] },
  pintura:{ discipline:'Acabados', confidence:88, sat:'72151300', requiredResourceKeywords:{ materials:['pintura','esmalte','vinil'] }, keywordBag:['pintura','pintar','esmalte','vinilica','acrilica','recubrimiento'] },
  lavabo_ptr:{ discipline:'Tablaroca y Durock', confidence:98, sat:'72101500', requiredResourceKeywords:{}, keywordBag:['lavabo','ptr','durock','mueble bano'] },
  estructura_metalica:{ discipline:'Estructura metalica', confidence:97, sat:'72101700', requiredResourceKeywords:{ materials:['acero','perfil','placa'] }, keywordBag:['estructura','metalica','acero','soldadura','montaje','astm'] },
  bomba:{ discipline:'Hidrosanitaria', confidence:90, sat:'40101700', requiredResourceKeywords:{ materials:['bomba'] }, keywordBag:['bomba','bombeo','electrobomba','motobomba'] },
  tuberia:{ discipline:'Hidrosanitaria', confidence:88, sat:'72101507', requiredResourceKeywords:{ materials:['tub'] }, keywordBag:['tuberia','tubo','hidraulica','sanitaria','drenaje'] },
  limpieza_trazo:{ discipline:'Limpieza y preliminares', confidence:85, sat:'72101505', requiredResourceKeywords:{}, keywordBag:['limpieza','trazo','nivelacion','preliminar'] },
  desmonte_mecanico:{ discipline:'Terracerias', confidence:83, sat:'72101503', requiredResourceKeywords:{ equipment:['tractor','retroexcavadora'] }, keywordBag:['desmonte','desenraice','destronque','mecanico'] },
  excavacion_mecanica:{ discipline:'Terracerias', confidence:85, sat:'72101503', requiredResourceKeywords:{ equipment:['excavadora','retroexcavadora'] }, keywordBag:['excavacion','mecanica','retroexcavadora','excavadora'] },
  acarreo_camion:{ discipline:'Terracerias', confidence:82, sat:'78101800', requiredResourceKeywords:{ equipment:['camion'] }, keywordBag:['acarreo','camion','volteo','foraneo'] },
  demolicion:{ discipline:'Limpieza y preliminares', confidence:82, sat:'72101504', requiredResourceKeywords:{}, keywordBag:['demolicion','demoler','desmontar','retiro'] },
  acarreo_manual:{ discipline:'Terracerias', confidence:80, sat:'78101800', requiredResourceKeywords:{}, keywordBag:['acarreo','manual','costales','carretilla'] },
  adhesivo:{ discipline:'Acabados', confidence:85, sat:'72151600', requiredResourceKeywords:{ materials:['adhesivo','cemento cola'] }, keywordBag:['adhesivo','pegazulejo','cemento cola'] },
  movimiento_mobiliario:{ discipline:'Equipamiento', confidence:78, sat:'78102200', requiredResourceKeywords:{}, keywordBag:['movimiento','mueble','mobiliario','reacomodo'] },
  generico:{ discipline:'General', confidence:45, sat:'72100000', requiredResourceKeywords:{}, keywordBag:[] },
  tablaroca:{ discipline:'Tablaroca y Durock', confidence:88, sat:'72100000', requiredResourceKeywords:{ materials:['panel','tablaroca','yeso'] }, keywordBag:['tablaroca','durock','panel','yeso','plafon'] },
  marmol_granito:{ discipline:'Acabados', confidence:88, sat:'72100000', requiredResourceKeywords:{ materials:['adhesivo','boquilla'] }, keywordBag:['marmol','granito','piedra natural','cubierta'] },
  registro:{ discipline:'Acabados', confidence:85, sat:'72100000', requiredResourceKeywords:{ materials:['registro','tapa'] }, keywordBag:['registro','tapa','acceso'] },
  aplanado:{ discipline:'Acabados', confidence:86, sat:'72100000', requiredResourceKeywords:{ materials:['cemento','cal','arena'] }, keywordBag:['aplanado','repellado','enjarre','plaster'] },
  piso:{ discipline:'Acabados', confidence:85, sat:'72100000', requiredResourceKeywords:{ materials:['loseta','adhesivo','boquilla'] }, keywordBag:['piso','loseta','porcelanato','azulejo','ceramico'] },
  sello:{ discipline:'Acabados', confidence:82, sat:'72100000', requiredResourceKeywords:{ materials:['sellador','silicon'] }, keywordBag:['sello','sellado','silicon','junta','calafate'] },
  acero:{ discipline:'Estructura metalica', confidence:88, sat:'72100000', requiredResourceKeywords:{ materials:['acero','varilla','fierro'] }, keywordBag:['acero','varilla','fierro','refuerzo','armado'] },
  concreto:{ discipline:'Cimentacion', confidence:88, sat:'72100000', requiredResourceKeywords:{ materials:['cemento','concreto'] }, keywordBag:['concreto','cemento','losa','zapata','cimentacion','colado'] },
  block:{ discipline:'Albanileria', confidence:87, sat:'72100000', requiredResourceKeywords:{ materials:['block','tabique','cemento'] }, keywordBag:['block','tabique','muro','mamposteria'] },
  imper:{ discipline:'Acabados', confidence:86, sat:'72100000', requiredResourceKeywords:{ materials:['impermeabiliz'] }, keywordBag:['impermeabilizante','membrana','sellador'] },
  excavacion:{ discipline:'Terracerias', confidence:80, sat:'72100000', requiredResourceKeywords:{}, keywordBag:['excavacion','zanja','despalme','manual'] },
  electrica:{ discipline:'Electricidad', confidence:80, sat:'72100000', requiredResourceKeywords:{ materials:['cable'] }, keywordBag:['electrico','electrica','cable','luminaria','contacto','tablero'] },
  voz_datos:{ discipline:'Electricidad', confidence:78, sat:'72100000', requiredResourceKeywords:{ materials:['cable','utp'] }, keywordBag:['voz','datos','cableado estructurado','red','fibra'] },
  cctv:{ discipline:'Electricidad', confidence:78, sat:'72100000', requiredResourceKeywords:{ materials:['camara'] }, keywordBag:['cctv','camara','seguridad','videovigilancia'] },
  hvac:{ discipline:'Aire acondicionado', confidence:80, sat:'72100000', requiredResourceKeywords:{ materials:['refrigerante','cobre'] }, keywordBag:['hvac','aire acondicionado','minisplit','chiller','climatizacion'] },
  gas:{ discipline:'Gas e incendio', confidence:78, sat:'72100000', requiredResourceKeywords:{ materials:['tuberia'] }, keywordBag:['gas','tuberia de gas','regulador','tanque'] },
  contra_incendio:{ discipline:'Gas e incendio', confidence:80, sat:'72100000', requiredResourceKeywords:{ materials:['rociador','extintor','hidrante'] }, keywordBag:['contra incendio','sprinkler','hidrante','extintor'] },
  elevadores:{ discipline:'Equipamiento', confidence:75, sat:'72100000', requiredResourceKeywords:{}, keywordBag:['elevador','ascensor','montacargas'] },
  canceleria_aluminio_vidrio:{ discipline:'Acabados', confidence:80, sat:'72100000', requiredResourceKeywords:{ materials:['aluminio','vidrio','cristal'] }, keywordBag:['canceleria','aluminio','vidrio','cristal','ventana'] },
  carpinteria:{ discipline:'Equipamiento', confidence:78, sat:'72100000', requiredResourceKeywords:{ materials:['madera'] }, keywordBag:['carpinteria','madera','mueble','closet'] },
  herreria:{ discipline:'Estructura metalica', confidence:78, sat:'72100000', requiredResourceKeywords:{ materials:['acero','lamina','perfil'] }, keywordBag:['herreria','reja','porton','metalico'] },
  jardineria:{ discipline:'Equipamiento', confidence:75, sat:'72100000', requiredResourceKeywords:{}, keywordBag:['jardineria','area verde','pasto','riego','siembra'] },
  pavimento:{ discipline:'Urbanizacion', confidence:80, sat:'72100000', requiredResourceKeywords:{}, keywordBag:['pavimento','asfaltica','adoquin','guarnicion','banqueta'] },
  senalizacion:{ discipline:'Equipamiento', confidence:75, sat:'72100000', requiredResourceKeywords:{}, keywordBag:['senalizacion','senaletica','senal'] }
};

const MIN_SCORE_FALLBACK = 2; // piso minimo de solape de palabras para aceptar un match aproximado

function tokenize(t){
  return String(t || '').toLowerCase().split(/[^a-záéíóúñ0-9]+/i).filter(Boolean);
}

/* La descripcion PRINCIPAL de un concepto real mexicano casi siempre trae
   la forma "[elemento/actividad principal], incluye: [actividades y
   materiales incluidos]" -- la clasificacion NUNCA debe decidirse por una
   palabra que aparece SOLO dentro de la clausula "incluye" (esa lista es
   de actividades secundarias, ver extractSecondaryActivities), sino por la
   descripcion principal antes de ella. Ver caso reproducido con
   descripciones reales de la Biblioteca ZOEMEC: "Aplanado... incluye:
   suministro de materiales, ACARREOS, andamios..." clasificaba como
   acarreo_manual (Terracerias) en vez de aplanado, solo porque "acarreos"
   vive dentro de "incluye". Si no hay clausula "incluye" (o el texto antes
   de ella es demasiado corto para ser una descripcion real), se usa el
   texto completo tal cual -- nunca se recorta informacion real. */
export function splitPrimaryText(t){
  const text = String(t || '');
  const match = text.match(/\bincluy(?:e|endo)\b/);
  if(!match) return text;
  const primary = text.slice(0, match.index).trim();
  return primary.length >= 10 ? primary : text;
}

/* Cada entrada recibe un `id` estable (tipo#indice-original-en-el-array) y
   una `priority` explicita (0/1/2, default 1 si la entrada no la declara --
   ver el comentario de prioridad junto a CONSTRUCTION_SYSTEMS_ORDER). Se
   precalcula UNA sola vez al cargar el modulo (no en cada llamada a
   classifyConstructionSystem): tres listas, una por nivel, cada una en el
   mismo orden relativo en que las entradas aparecen en el array original --
   la prioridad decide QUE NIVEL se evalua primero; el orden de array sigue
   siendo el desempate DENTRO de un mismo nivel, exactamente como el cascade
   original, nunca al revés. */
const RULES_WITH_ID = CONSTRUCTION_SYSTEMS_ORDER.map((entry, i) => ({
  ...entry,
  id: entry.id || `${entry.tipo}#${i}`,
  priority: entry.priority ?? 1
}));
const RULES_BY_PRIORITY = [0, 1, 2].flatMap(p => RULES_WITH_ID.filter(entry => entry.priority === p));

function confidenceFor(tipo, priority){
  const base = typeof SYSTEM_META[tipo]?.confidence === 'number' ? SYSTEM_META[tipo].confidence : 70;
  // Nivel 2 (material generico) es, por definicion, el ultimo recurso antes
  // del fallback por score -- su confianza nunca debe leerse igual de firme
  // que un match de sistema especifico (nivel 0) o de actividad (nivel 1).
  return priority === 2 ? Math.max(50, base - 15) : base;
}

/* Clasifica un concepto (texto ya en minusculas): primero exacto por nivel
   de prioridad explicito (0 -> 1 -> 2, ver RULES_BY_PRIORITY) sobre la
   descripcion PRINCIPAL (ver splitPrimaryText), y si nada coincide, un
   fallback por solape de palabras contra keywordBag de TODAS las
   disciplinas conocidas -- sobre el texto completo (una palabra suelta en
   "incluye" SI puede aportar una pista aproximada cuando no hubo match
   exacto, a diferencia del match exacto que nunca debe decidirse por ella).

   Devuelve { tipo, matchType:'exact'|'score'|'generico', priority?, ruleId?,
   discipline, confidence, matchedTerms, score? }, nunca null. Los campos
   nuevos (priority/ruleId/discipline/confidence/matchedTerms) son evidencia
   de diagnostico -- ningun consumidor existente los requiere, solo lee
   `.tipo` y `.matchType` (ver apuGeneration.js#makeAPUFromConcept). */
export function classifyConstructionSystem(t){
  const primaryText = splitPrimaryText(t);
  for(const entry of RULES_BY_PRIORITY){
    if(entry.test(primaryText)){
      const matchedTerms = entry.pattern ? [...new Set(primaryText.match(entry.pattern) || [])] : [];
      return {
        tipo: entry.tipo,
        matchType: 'exact',
        priority: entry.priority,
        ruleId: entry.id,
        discipline: SYSTEM_META[entry.tipo]?.discipline || null,
        confidence: confidenceFor(entry.tipo, entry.priority),
        matchedTerms
      };
    }
  }
  const tokens = new Set(tokenize(t));
  let best = null;
  for(const [tipo, meta] of Object.entries(SYSTEM_META)){
    if(tipo === 'generico' || !meta.keywordBag?.length) continue;
    const matched = meta.keywordBag.filter(kw => tokens.has(kw) || t.includes(kw));
    if(matched.length > 0 && (!best || matched.length > best.score)) best = { tipo, score: matched.length, matchedTerms: matched };
  }
  if(best && best.score >= MIN_SCORE_FALLBACK){
    return {
      tipo: best.tipo,
      matchType: 'score',
      score: best.score,
      discipline: SYSTEM_META[best.tipo]?.discipline || null,
      confidence: Math.min(60, SYSTEM_META[best.tipo]?.confidence ?? 60),
      matchedTerms: best.matchedTerms
    };
  }
  return {
    tipo: 'generico',
    matchType: 'generico',
    discipline: SYSTEM_META.generico?.discipline || 'General',
    confidence: SYSTEM_META.generico?.confidence ?? 45,
    matchedTerms: []
  };
}

/* Actividades secundarias declaradas explicitamente en el propio texto del
   concepto ("incluye X, Y, Z" / "incluyendo X, Y, Z"): se extraen como
   etiquetas informativas, NUNCA cambian la clasificacion principal (ver
   caso del acero+incluye-acarreos en isManualHaulingGuarded arriba). */
const SECONDARY_ACTIVITY_KEYWORDS = [
  'acarreo','acarreos','corte','cortes','doblado','dobleces','habilitado','colocacion','colocación',
  'amarre','amarres','suministro','trazo','nivelacion','nivelación','limpieza','retiro','proteccion',
  'protección','prueba','pruebas','ajuste','montaje','soldadura','izaje','conexion','conexión'
];
export function extractSecondaryActivities(originalText){
  const t = String(originalText || '').toLowerCase();
  const match = t.match(/inclu(?:ye|yendo)\s*:?\s*([^.]+)/);
  if(!match) return [];
  const clause = match[1];
  const found = SECONDARY_ACTIVITY_KEYWORDS.filter(kw => clause.includes(kw));
  return [...new Set(found)];
}
