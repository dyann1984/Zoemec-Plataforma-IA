/* Sobreconsumo de recursos (Fase G, seccion 10 del pedido). Usa
   Explosiones (Fase A, cantidadFinal/origenes por APU YA calculados,
   nunca recalculado aqui) + avance fisico (Fase E) para construir, por
   recurso:
     - cantidad presupuestada  -- Explosion.cantidadFinal (100% del alcance contratado).
     - cantidad teorica ejecutada -- SUMA, por cada APU que aporta ese
       recurso, de su aporte x el % de avance fisico real del concepto
       que usa ese APU. Es un numero DERIVADO (no una medicion
       independiente) -- se muestra siempre, es util para ver "cuanto
       deberiamos llevar consumido", pero NUNCA se compara contra si
       misma para decidir sobreconsumo (seria circular).
     - cantidad comprometida/comprada por recurso -- este codebase NO
       captura compras a nivel de material individual hoy (los
       compromisos son un monto $ por concepto/capitulo, ver
       commitmentSchema.js) -- por eso esta funcion nunca inventa esa
       cifra a nivel recurso.
     - cantidad reportada usada -- SOLO si el llamador la provee
       (`reportedUsageByResourceKey`, hoy vacio en produccion porque no
       existe captura de uso real de material). Es la UNICA fuente
       verdaderamente independiente, asi que es la UNICA que puede
       disparar una alerta real de sobreconsumo (seccion 10: "no inventar
       consumo si todavia no se captura" -- sin ese dato, el resultado
       queda informativo, nunca marca sobreconsumo). */
function toNumber(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }

export function computeResourceOverconsumption({
  explosionRows = [], avanceFisicoPctByApuId = new Map(), reportedUsageByResourceKey = new Map(), thresholdPct = 10
} = {}){
  return (explosionRows || []).map(row => {
    const resourceKey = row.key ?? row.descripcion;
    const presupuestada = toNumber(row.cantidadFinal);
    let teoricaEjecutada = 0;
    (row.origenes || []).forEach(o => {
      const avance = avanceFisicoPctByApuId.get(o.apuId);
      if(avance != null) teoricaEjecutada += toNumber(o.cantidadFinalAportada) * (toNumber(avance) / 100);
    });
    const reportadaUsada = reportedUsageByResourceKey.has(resourceKey) ? toNumber(reportedUsageByResourceKey.get(resourceKey)) : null;

    let hasOverconsumption = false, severity = null, desviacionPct = 0, actual = null, comparisonLabel = null, fuente = null, impactoEstimado = null;
    if(reportadaUsada != null && presupuestada > 0){
      desviacionPct = ((reportadaUsada - presupuestada) / presupuestada) * 100;
      if(desviacionPct > thresholdPct){
        hasOverconsumption = true; actual = reportadaUsada; comparisonLabel = 'reportada'; fuente = 'reportado';
        severity = desviacionPct > 30 ? 'ALTA' : 'MEDIA';
        impactoEstimado = (reportadaUsada - presupuestada) * toNumber(row.precioUnitario);
      }
    }

    return {
      resourceKey, descripcion: row.descripcion, unidad: row.unidad,
      presupuestada, teoricaEjecutada, reportadaUsada,
      hasOverconsumption, severity, desviacionPct, actual, comparisonLabel, fuente, impactoEstimado
    };
  });
}
