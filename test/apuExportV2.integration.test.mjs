import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import writeXlsxFileNode from 'write-excel-file/node';import {unzipSync,strFromU8} from 'fflate';
import { makeEmptyAPUv2,APU_DATA_STATE } from '../src/domain/apuSchema.js';import { calcAPUv2 } from '../src/lib/apuCalc.js';import { finalizeProfessionalAPU } from '../src/domain/apuProfessional.js';import { buildProfessionalAPUSheet,exportAPUExcelV2,exportAPUPdfV2,exportAPUPdfMaster,buildParametrosSheet } from '../src/lib/apuExportV2.js';
import { readXlsxCells, findRowByLabel } from './helpers/xlsxRead.mjs';import { createSheetEvaluator } from './helpers/xlsxFormula.mjs';
function golden(i=1){const a=makeEmptyAPUv2();Object.assign(a,{clave:`ALB-APL-${String(i).padStart(3,'0')}`,concept:'Aplanado fino en muros a plomo y regla con mortero cemento-arena 1:4, espesor promedio 1.5 cm, incluye preparacion de superficie, materiales, mano de obra, herramienta, equipo, andamios, limpieza y todo lo necesario para su correcta ejecucion.',unit:'m²',cantidadObra:125,proyecto:'Golden test ZOEMEC',cliente:'Cliente de prueba',version:'V1'});const fuente={estado:APU_DATA_STATE.VERIFICADO,proveedor:'Catalogo proporcionado',fecha:'2026-08-01'};a.materials=[{clave:'MAT-001',descripcion:'Cemento CPC 30R',unidad:'kg',consumo:5.6,desperdicioPct:0,precioUnitario:2.35,fuente},{clave:'MAT-002',descripcion:'Arena lavada',unidad:'m³',consumo:.018,desperdicioPct:5,precioUnitario:450,fuente}];a.labor=[{clave:'MO-001',descripcion:'Oficial albañil',unidad:'jor',cuadrilla:1,rendimiento:25,jornada:8,salarioBase:802.15,fsr:1.382,fuente},{clave:'MO-002',descripcion:'Ayudante albañil',unidad:'jor',cuadrilla:1,rendimiento:25,jornada:8,salarioBase:601.61,fsr:1.382,fuente}];a.equipment=[{clave:'EQ-001',descripcion:'Andamio tubular',unidad:'dia',cantidad:.1,tarifa:150,rendimiento:25,fuente}];a.seguridad=[{clave:'SP-001',descripcion:'Casco de seguridad',unidad:'pza',cantidad:.001,precioUnitario:220,observaciones:'Uso obligatorio'}];a.procedimientoConstructivo=['Preparar superficie','Humedecer muro','Aplicar y reglear mortero','Curar'];a.controlCalidad=[{especificacion:'Aplome',criterio:'± 3 mm en 3 m'}];a.criterioMedicion={unidadMedicion:'m²',incluye:['materiales','mano de obra','limpieza'],excluye:['acabados adicionales']};a.supuestos=[{texto:'Jornada de 8 horas'}];return a;}
test('golden: motor y exportadores v2 conservan CD, subtotal, IVA, PU y total',async()=>{const a=golden(),t=calcAPUv2(a);const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zoemec-v2-'));const before=process.cwd();process.chdir(dir);try{await exportAPUExcelV2(a,{writeXlsxFileImpl:writeXlsxFileNode,fileName:'golden.xlsx'});const {doc,apu}=exportAPUPdfV2(a,{fileName:'golden.pdf'});assert.ok(fs.statSync('golden.xlsx').size>1000);assert.ok(fs.statSync('golden.pdf').size>1000);assert.deepEqual(['direct','iva','pu','importeTotal'].map(k=>apu.calculated[k]),['direct','iva','pu','importeTotal'].map(k=>t[k]));const raw=Buffer.from(doc.output('arraybuffer')).toString('latin1');[t.direct,t.iva,t.pu,t.importeTotal].forEach(v=>assert.ok(raw.includes(`(${new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(v).replace('MX$','$')})`)));}finally{process.chdir(before);fs.rmSync(dir,{recursive:true,force:true});}});
test('Web, Excel y PDF comparten exactamente el snapshot profesional finalizado',()=>{const web=finalizeProfessionalAPU(golden());const excel=buildProfessionalAPUSheet(web).apu;const pdf=exportAPUPdfV2(web,{save:false}).apu;const projection=a=>({identity:[a.id,a.clave,a.concept,a.unit,a.cantidadObra,a.version],resources:{materials:a.materials,labor:a.labor,tools:a.herramientaMenor,equipment:a.equipment,seguridad:a.seguridad},factors:a.factores,calculated:a.calculated,confidence:a.confidence,validationStatus:a.validationStatus,sources:[...a.materials,...a.labor,...a.equipment].map(r=>r.priceRecord)});assert.deepEqual(projection(excel),projection(web));assert.deepEqual(projection(pdf),projection(web));});
test('Gap de trazabilidad de Biblioteca (2026-08-27): un renglon BIBLIOTECA con matchMethod/confidence/catalogItemId reales llega visible a Excel y PDF, nunca en blanco/generico', async () => {
  const a = golden();
  const fuenteBiblioteca = {
    estado: 'BIBLIOTECA',
    proveedor: null,
    fecha: null,
    matchMethod: 'fuzzy_token',
    confidence: 67,
    catalogItemId: 'MAT-IMPER-01',
    origenPrecio: 'BIBLIOTECA'
  };
  a.materials[0] = { ...a.materials[0], clave: 'MAT-IMPER-01', descripcion: 'Impermeabilizante acrílico', precioUnitario: 145, fuente: fuenteBiblioteca };
  a.labor[0] = { ...a.labor[0], clave: 'MO-APLIC-01', descripcion: 'Aplicador (oficial)', salarioBase: 520, fuente: fuenteBiblioteca };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoemec-biblioteca-trace-'));
  const before = process.cwd(); process.chdir(dir);
  try {
    await exportAPUExcelV2(a, { writeXlsxFileImpl: writeXlsxFileNode, fileName: 'trace.xlsx' });
    const zip = unzipSync(fs.readFileSync('trace.xlsx'));
    const xml = strFromU8(zip['xl/worksheets/sheet2.xml']);
    // Buscar el texto en sharedStrings (write-excel-file guarda texto ahi, no inline)
    const shared = strFromU8(zip['xl/sharedStrings.xml'] || new Uint8Array());
    const excelText = xml + shared;
    assert.match(excelText, /BIBLIOTECA/, 'el estado BIBLIOTECA debe aparecer en el Excel, no colapsar a IMPORTADO generico');
    assert.match(excelText, /fuzzy_token/, 'el matchMethod real debe quedar visible/auditable en el Excel (16. FUENTES DE PRECIOS)');
    assert.match(excelText, /MAT-IMPER-01/, 'el catalogItemId (clave del insumo de catalogo) debe quedar visible en el Excel');
    assert.match(excelText, /67/, 'la confianza numerica del match debe quedar visible en el Excel');

    const { doc } = exportAPUPdfV2(a, { save: false });
    const pdfText = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    assert.match(pdfText, /BIBLIOTECA/, 'el estado BIBLIOTECA debe aparecer en el PDF, no colapsar a IMPORTADO generico');
    assert.match(pdfText, /fuzzy_token/, 'el matchMethod real debe quedar visible/auditable en el PDF (13. FUENTES DE PRECIOS)');
    assert.match(pdfText, /67/, 'la confianza numerica del match debe quedar visible en el PDF');
  } finally {
    process.chdir(before);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildParametrosSheet: hoja PARAMETROS con moneda/vigencia/IVA/tolerancia/version, contenido real (no inventado)',()=>{
  const a=golden();a.moneda='MXN';a.fechaBase='2026-08-01';a.version='V2';
  const sheet=buildParametrosSheet([a],{engineVersion:'V2-test'});
  assert.equal(sheet.sheet,'PARAMETROS');
  const flat=sheet.rows.map(r=>r.map(c=>c && typeof c==='object'?c.value:c).join(' | ')).join('\n');
  assert.match(flat,/Moneda[\s\S]*MXN/);
  assert.match(flat,/vigencia[\s\S]*2026-08-01/i);
  assert.match(flat,/IVA aplicado[\s\S]*16%/);
  assert.match(flat,/Version del motor[\s\S]*V2-test/i);
  assert.match(flat,/Herramienta menor[\s\S]*3%/);
});

test('PDF individual: pie de pagina real "Pagina X de Y" (nunca un numero absoluto sin total)',()=>{
  const { doc } = exportAPUPdfV2(golden(), { save:false });
  const totalPages = doc.internal.getNumberOfPages();
  assert.ok(totalPages >= 1);
  const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  for(let i=1;i<=totalPages;i++) assert.ok(raw.includes(`Pagina ${i} de ${totalPages}`), `falta el pie "Pagina ${i} de ${totalPages}"`);
});

test('PDF maestro: "Pagina X de Y" es absoluto dentro de TODO el documento (portada+resumen+control+N APUs), nunca se reinicia por concepto',()=>{
  const apus = [1,2,3].map(i => golden(i));
  const { doc } = exportAPUPdfMaster(apus, { save:false });
  const totalPages = doc.internal.getNumberOfPages();
  assert.ok(totalPages > 3, 'el maestro debe tener mas paginas que portada+resumen+control (los 3 APUs agregan las suyas)');
  const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
  for(let i=1;i<=totalPages;i++) assert.ok(raw.includes(`Pagina ${i} de ${totalPages}`), `falta el pie "Pagina ${i} de ${totalPages}" en el PDF maestro`);
});

for(const count of [1,10,100])test(`Excel v2 exporta PORTADA + RESUMEN + CONTROL_REVISION + PARAMETROS + ${count} hojas`,async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zoemec-many-'));const before=process.cwd();process.chdir(dir);try{const sheets=await exportAPUExcelV2(Array.from({length:count},(_,i)=>golden(i+1)),{writeXlsxFileImpl:writeXlsxFileNode,fileName:`${count}.xlsx`});assert.equal(sheets.length,count+4);assert.equal(sheets[0].sheet,'PORTADA');assert.equal(sheets[1].sheet,'RESUMEN');assert.equal(sheets[2].sheet,'CONTROL_REVISION');assert.equal(sheets[3].sheet,'PARAMETROS');assert.ok(fs.statSync(`${count}.xlsx`).size>1000);if(count===1){const zip=unzipSync(fs.readFileSync('1.xlsx'));const xml=strFromU8(zip['xl/worksheets/sheet2.xml']);assert.match(xml,/<pageSetup[^>]+paperSize="9"[^>]+orientation="landscape"/);assert.match(xml,/showGridLines="false"/);assert.match(xml,/zoomScale="85"/);}}finally{process.chdir(before);fs.rmSync(dir,{recursive:true,force:true});}});

function rc1ExportRegression(){
  const a=makeEmptyAPUv2();
  Object.assign(a,{clave:'APU-PR0UNO',concept:'Muro de block hueco de concreto 15 x 20 x 40 cm con mortero 1:4',unit:'m²',cantidadObra:25,version:'V2'});
  const fuente={estado:APU_DATA_STATE.ESTIMADO_IA};
  a.materials=[{clave:'MAT-001',descripcion:'Materiales consolidados del caso RC1',unidad:'m²',consumo:1,desperdicioPct:0,precioUnitario:328.4225,fuente}];
  a.labor=[{clave:'MO-001',descripcion:'Cuadrilla de albañilería',unidad:'jor',cuadrilla:2,rendimiento:5,jornada:8,salarioBase:360,fsr:1.3,fuente}];
  a.herramientaMenor={modo:'porcentaje',porcentaje:3,detalle:[]};
  a.equipment=[
    {clave:'EQ-001',descripcion:'Andamios metálicos',unidad:'jornada',cantidad:1,tarifa:500,integracion:'POR_JORNADA',rendimientoDiario:5,fuente},
    {clave:'EQ-002',descripcion:'Herramientas manuales',unidad:'lote',cantidad:1,tarifa:150,integracion:'POR_JORNADA',rendimientoDiario:25,fuente}
  ];
  a.seguridad=[
    ['SEG-001','Casco','pza',2,250],['SEG-002','Guantes','par',2,70],['SEG-003','Lentes','pza',2,120],['SEG-004','Botas','pza',2,600],['SEG-005','Chaleco','pza',2,180]
  ].map(([clave,descripcion,unidad,cantidad,precioUnitario])=>({clave,descripcion,unidad,cantidad,precioUnitario,integracion:'AMORTIZABLE',vidaUtilDias:180,rendimientoDiario:5,factorReposicion:1,fuente}));
  return a;
}

test('regresion P0 RC1: snapshot, XLSX recalculado y PDF usan equipo/EPP efectivos',async()=>{
  const a=rc1ExportRegression();const snapshot=finalizeProfessionalAPU(a);const t=snapshot.calculated;
  assert.ok(Math.abs(t.equipo-106)<1e-9);assert.ok(Math.abs(t.seguridad-2.711111111111111)<1e-9);
  assert.ok(Math.abs(t.direct-629.9496111111112)<1e-9);assert.ok(Math.abs(t.pu-816.88810313275)<1e-9);assert.ok(Math.abs(t.importeTotal-20422.20257831875)<1e-9);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zoemec-p0-export-'));const before=process.cwd();process.chdir(dir);
  try{
    await exportAPUExcelV2(snapshot,{writeXlsxFileImpl:writeXlsxFileNode,fileName:'rc1-p0.xlsx'});
    const cells=readXlsxCells(fs.readFileSync('rc1-p0.xlsx'),'xl/worksheets/sheet5.xml');const evaluate=createSheetEvaluator(cells);
    const cases=[['SUBTOTAL EQUIPO','equipo'],['SUBTOTAL SEGURIDAD','seguridad'],['COSTO DIRECTO','direct'],['PRECIO UNITARIO FINAL','pu'],['IMPORTE TOTAL','importeTotal']];
    for(const [label,key] of cases){const ref=findRowByLabel(cells,label,'J');assert.ok(ref,`falta ${label}`);assert.ok(cells[ref].formula,`${label} debe seguir siendo formula auditable`);assert.ok(Math.abs(evaluate.getCellValue(ref)-t[key])<1e-8,`${label}: XLSX != snapshot`);}
    const {doc}=exportAPUPdfV2(snapshot,{fileName:'rc1-p0.pdf'});const raw=Buffer.from(doc.output('arraybuffer')).toString('latin1');
    const pdfMoney=v=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(v).replace('MX$','$');
    for(const value of [100,6,0.5555555556,0.1555555556,0.2666666667,1.3333333333,0.4,t.equipo,t.seguridad,t.direct,t.pu,t.importeTotal]) assert.ok(raw.includes(`(${pdfMoney(value)})`),`PDF no muestra importe efectivo ${pdfMoney(value)}`);
    assert.ok(!raw.includes(`(${pdfMoney(2440)})`),'PDF no debe presentar el costo de adquisicion EPP como subtotal integrado');
  }finally{process.chdir(before);fs.rmSync(dir,{recursive:true,force:true});}
});

test('PDF evita secciones huerfanas y mantiene encabezado general dentro del area imprimible',()=>{
  const a=golden();
  a.clave='APU-PAGINADO';
  a.concept='Caso de regresion de paginado con descripciones extensas para forzar alturas variables y saltos de pagina entre secciones del APU profesional.';
  const fuente={estado:APU_DATA_STATE.ESTIMADO_IA};
  a.labor=Array.from({length:23},(_,i)=>({clave:`MO-${String(i+1).padStart(3,'0')}`,descripcion:`Cuadrilla especializada numero ${i+1} con una descripcion suficientemente extensa para ocupar varias lineas y ejercer presion real sobre el final del area imprimible`,unidad:'jor',cuadrilla:2,rendimiento:8,jornada:8,salarioBase:350,fsr:1.3,fuente}));
  a.materials=Array.from({length:12},(_,i)=>({clave:`MAT-${String(i+1).padStart(3,'0')}`,descripcion:`Material de prueba numero ${i+1} con especificacion tecnica extensa y presentacion comercial verificable`,unidad:'pza',consumo:1,desperdicioPct:2,precioUnitario:25,fuente}));
  a.equipment=Array.from({length:8},(_,i)=>({clave:`EQ-${String(i+1).padStart(3,'0')}`,descripcion:`Equipo de prueba numero ${i+1} con descripcion larga para validar continuidad visual`,unidad:'jornada',cantidad:1,tarifa:120,integracion:'POR_JORNADA',rendimientoDiario:8,fuente}));
  a.seguridad=Array.from({length:8},(_,i)=>({clave:`SEG-${String(i+1).padStart(3,'0')}`,descripcion:`Equipo de proteccion personal numero ${i+1}`,unidad:'pza',cantidad:2,precioUnitario:80,integracion:'AMORTIZABLE',vidaUtilDias:180,rendimientoDiario:8,factorReposicion:1,fuente}));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zoemec-pdf-pagination-'));const before=process.cwd();process.chdir(dir);
  try{
    const {doc,layout}=exportAPUPdfV2(a,{fileName:'pagination.pdf'});
    assert.ok(fs.statSync('pagination.pdf').size>1000);
    assert.equal(layout.generalHeaders.length,doc.getNumberOfPages(),'cada pagina debe repetir el encabezado general');
    for(const h of layout.generalHeaders){assert.equal(h.y,layout.topMargin);assert.ok(h.y>=layout.topMargin);}
    for(const s of layout.sections){
      if(s.firstRowPage!==null){
        assert.equal(s.firstRowPage,s.page,`${s.title}: titulo y primera fila deben quedar en la misma pagina`);
        assert.ok(s.firstRowY+s.firstRowHeight<=layout.bottomLimit,`${s.title}: primera fila fuera del area imprimible`);
        assert.ok(s.y<s.columnsY&&s.columnsY<s.firstRowY,`${s.title}: orden vertical invalido o superpuesto`);
      }
    }
    const materialSection=layout.sections.find(s=>s.title==='A. MATERIALES');
    const equipmentSection=layout.sections.find(s=>s.title==='C. EQUIPO Y MAQUINARIA');
    assert.ok(equipmentSection.page>materialSection.page,'una seccion posterior con suficiente volumen de renglones previos debe saltar de pagina, nunca quedar huerfana');
    for(const row of layout.rows)assert.ok(row.y+row.height<=layout.bottomLimit,`${row.section}: fila ${row.row+1} fuera del area imprimible`);
    assert.ok(doc.getNumberOfPages()>=4,'el caso de presion debe producir varias paginas de forma coherente');
  }finally{process.chdir(before);fs.rmSync(dir,{recursive:true,force:true});}
});
