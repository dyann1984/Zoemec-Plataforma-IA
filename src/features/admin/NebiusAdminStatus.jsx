import React, { useEffect, useState } from 'react';
import { apiGetSafe } from '../../services/apiClient.js';
export function NebiusAdminStatus() {
  const [data, setData] = useState(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => { let live = true; setData(null); apiGetSafe('/api/engineering-ai?admin=1').then(v => { if (live) setData(v || { error: true }); }); return () => { live = false; }; }, [refresh]);
  return <section className="panel"><h3>Nebius · NVIDIA/Nemotron</h3>
    <button type="button" className="soft" onClick={() => setRefresh(v => v + 1)}>Actualizar Nebius</button>
    {!data ? <p role="status">Consultando…</p> : data.error ? <p role="alert">No se pudo consultar Nebius.</p> : <>
      <p>{data.status} · {data.model}</p><p>{data.sample}</p>
      <p>Análisis: {data.calls} · Éxitos: {data.successes} · Errores: {data.errors} · Latencia media: {data.latencyMs == null ? 'No disponible' : `${data.latencyMs} ms`} · Tokens reportados: {data.tokens ?? 'No disponibles'}</p>
      <p>Costo: no disponible. Este registro no se suma a las estimaciones de OpenAI.</p>
      <small>Última solicitud: {data.latestRequestId || 'Sin solicitudes'}</small>
    </>}
  </section>;
}
