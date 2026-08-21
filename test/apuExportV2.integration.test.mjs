import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import writeXlsxFileNode from 'write-excel-file/node';import {unzipSync,strFromU8} from 'fflate';
import { makeEmptyAPUv2,APU_DATA_STATE } from '../src/domain/apuSchema.js';import { calcAPUv2 } from '../src/lib/apuCalc.js';import { finalizeProfessionalAPU } from '../src/domain/apuProfessional.js';import { buildProfessionalAPUSheet,exportAPUExcelV2,exportAPUPdfV2 } from '../src/lib/apuExportV2.js';
import { readXlsxCells, findRowByLabel } from './helpers/xlsxRead.mjs';import { createSheetEvaluator } from './helpers/xlsxFormula.mjs';
function golden(i=1){const a=makeEmptyAPUv2();Object.assign(a,{clave:`ALB-APL-${String(i).padStart(3,'0')}`,concept:'Aplanado fino en muros a plomo y regla con mortero cemento-arena 1:4, espesor promedio 1.5 cm, incluye preparacion de superficie, materiales, mano de obra, herramienta, equipo, andamios, limpieza y todo lo necesario para su correcta ejecucion.',unit:'m²',cantidadObra:125,proyecto:'Golden test ZOEMEC',cliente:'Cliente de prueba',version:'V1'});const fuente={estado:APU_DATA_STATE.VERIFICADO,proveedor:'Catalogo proporcionado',fecha:'2026-08-01'};a.materials=[{clave:'MAT-001',descripcion:'Cemento CPC 30R',unidad:'kg',consumo:5.6,desperdicioPct:0,precioUnitario:2.35,fuente},{clave:'MAT-002',descripcion:'Arena lavada',unidad:'m³',consumo:.018,desperdicioPct:5,precioUnitario:450,fuente}];a.labor=[{clave:'MO-001',descripcion:'Oficial albañil',unidad:'jor',cuadrilla:1,rendimiento:25,jornada:8,salarioBase:802.15,fsr:1.382,fuente},{clave:'MO-002',descripcion:'Ayudante albañil',unidad:'jor',cuadrilla:1,rendimiento:25,jornada:8,salarioBase:601.61,fsr:1.382,fuente}];a.equipment=[{clave:'EQ-001',descripcion:'Andamio tubular',unidad:'dia',cantidad:.1,tarifa:150,rendimiento:25,fuente}];a.seguridad=[{clave:'SP-001',descripcion:'Casco de seguridad',unidad:'pza',cantidad:.001,precioUnitario:220,observaciones:'Uso obligatorio'}];a.procedimientoConstructivo=['Preparar superficie','Humedecer muro','Aplicar y reglear mortero','Curar'];a.controlCalidad=[{especificacion:'Aplome',criterio:'± 3 mm en 3 m'}];a.criterioMedicion={unidadMedicion:'m²',incluye:['materiales','mano de obra','limpieza'],excluye:['acabados adicionales']};a.supuestos=[{texto:'Jornada de 8 horas'}];return a;}
test('golden: motor y exportadores v2 conservan CD, subtotal, IVA, PU y total',async()=>{const a=golden(),t=calcAPUv2(a);const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zoemec-v2-'));const before=process.cwd();process.chdir(dir);try{await exportAPUExcelV2(a,{writeXlsxFileImpl:writeXlsxFileNode,fileName:'golden.xlsx'});const {doc,apu}=exportAPUPdfV2(a,{fileName:'golden.pdf'});assert.ok(fs.statSync('golden.xlsx').size>1000);assert.ok(fs.statSync('golden.pdf').size>1000);assert.deepEqual(['direct','iva','pu','importeTotal'].map(k=>apu.calculated[k]),['direct','iva','pu','importeTotal'].map(k=>t[k]));const raw=Buffer.from(doc.output('arraybuffer')).toString('latin1');[t.direct,t.iva,t.pu,t.importeTotal].forEach(v=>assert.ok(raw.includes(`(${new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(v).replace('MX$','$')})`)));}finally{process.chdir(before);fs.rmSync(dir,{recursive:true,force:true});}});
test('Web, Excel y PDF comparten exactamente el snapshot profesional finalizado',()=>{const web=finalizeProfessionalAPU(golden());const excel=buildProfessionalAPUSheet(web).apu;const pdf=exportAPUPdfV2(web,{save:false}).apu;const projection=a=>({identity:[a.id,a.clave,a.concept,a.unit,a.cantidadObra,a.version],resources:{materials:a.materials,labor:a.labor,tools:a.herramientaMenor,equipment:a.equipment,seguridad:a.seguridad},factors:a.factores,calculated:a.calculated,confidence:a.confidence,validationStatus:a.validationStatus,sources:[...a.materials,...a.labor,...a.equipment].map(r=>r.priceRecord)});assert.deepEqual(projection(excel),projection(web));assert.deepEqual(projection(pdf),projection(web));});
for(const count of [1,10,100])test(`Excel v2 exporta RESUMEN + CONTROL_REVISION + ${count} hojas`,async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zoemec-many-'));const before=process.cwd();process.chdir(dir);try{const sheets=await exportAPUExcelV2(Array.from({length:count},(_,i)=>golden(i+1)),{writeXlsxFileImpl:writeXlsxFileNode,fileName:`${count}.xlsx`});assert.equal(sheets.length,count+2);assert.equal(sheets[0].sheet,'RESUMEN');assert.equal(sheets[1].sheet,'CONTROL_REVISION');assert.ok(fs.statSync(`${count}.xlsx`).size>1000);if(count===1){const zip=unzipSync(fs.readFileSync('1.xlsx'));const xml=strFromU8(zip['xl/worksheets/sheet1.xml']);assert.match(xml,/<pageSetup[^>]+paperSize="9"[^>]+orientation="landscape"/);assert.match(xml,/showGridLines="false"/);assert.match(xml,/zoomScale="85"/);}}finally{process.chdir(before);fs.rmSync(dir,{recursive:true,force:true});}});

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
    const cells=readXlsxCells(fs.readFileSync('rc1-p0.xlsx'),'xl/worksheets/sheet3.xml');const evaluate=createSheetEvaluator(cells);
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
    const laborSection=layout.sections.find(s=>s.title==='1. MANO DE OBRA');
    const materialSection=layout.sections.find(s=>s.title==='2. MATERIALES');
    assert.ok(materialSection.page>laborSection.page,'Materiales debe saltar antes del encabezado cuando no cabe titulo + columnas + primera fila');
    assert.equal(materialSection.y,layout.generalHeaders.find(h=>h.page===materialSection.page).y+29,'la seccion debe iniciar bajo el encabezado general de la nueva pagina');
    for(const row of layout.rows)assert.ok(row.y+row.height<=layout.bottomLimit,`${row.section}: fila ${row.row+1} fuera del area imprimible`);
    assert.ok(doc.getNumberOfPages()>=4,'el caso de presion debe producir varias paginas de forma coherente');
  }finally{process.chdir(before);fs.rmSync(dir,{recursive:true,force:true});}
});
