import React, { useEffect, useRef, useState } from 'react';
import { apiGetSafe, apiPost } from '../../services/apiClient.js';
import './engineeringCopilot.css';

const QUICK = [
  ['Explicar Confidence', 'explainConfidence', '¿Por qué tiene este nivel de confianza?'],
  ['Analizar Bid Risk', 'explainRisk', '¿Qué provoca el riesgo y qué exposición económica está calculada?'],
  ['Revisar auditoría', 'analyzeAPU', '¿Qué hallazgos de auditoría son críticos?'],
  ['¿Qué debo corregir?', 'suggestReviewActions', '¿Qué debo verificar primero y qué evidencia falta?'],
  ['Analizar proyecto con IA', 'analyzeProjectContext', 'Resume el estado, riesgos, exposición, confianza y acciones prioritarias del alcance seleccionado.']
];
function Statements({ items = [], label }) {
  return <ul>{items.map((item, i) => <li key={i}><b>{label}: </b>{item.text}
    <small> Referencias: {item.evidenceRefs.join(', ')}</small></li>)}</ul>;
}
export function EngineeringAnswer({ result }) {
  const a = result.answer;
  return <article className="engineering-answer">
    {result.project?.demo && <p><b>DEMO · Datos sintéticos controlados</b></p>}
    <p><b>{a.provider} · {a.model}</b><br/><small>Solicitud {result.requestId} · {result.timestamp}</small></p>
    <h3>Conclusión</h3><p><b>INFERENCE: </b>{a.summary.text}</p>
    <small>Referencias: {a.summary.evidenceRefs.join(', ')} · Confianza de explicación: {a.confidence} (distinta del Confidence Engine)</small>
    <h3>Indicadores calculados por ZOEMEC</h3>
    {result.indicators.map(i => <div className="engineering-indicator" key={i.apuId}>
      <b>{i.concept || i.apuId} · versión {i.version || 'no registrada'}</b>
      <p>Confidence: {i.confidence.display} · Bid Risk: {i.bidRisk.severity || 'No calculable'} · Exposición estimada: {i.bidRisk.estimatedExposure == null ? 'No calculable' : String(i.bidRisk.estimatedExposure)} · Hallazgos: {i.audit.count ?? 'No calculable'}</p>
      <small>La exposición no se suma entre APUs ni se interpreta como presupuesto total. Moneda: consultar las referencias del APU.</small>
    </div>)}
    <h3>Evidencia</h3>
    <p>FACT: valores registrados o calculados por ZOEMEC; referencias seleccionadas por el modelo.</p>
    {a.evidenceRefs.map(r => <details key={r.id}><summary>{r.id} · {r.path}</summary><pre>{r.value === null ? 'No disponible' : String(r.value)}</pre></details>)}
    <Statements items={a.inferences} label="INFERENCE" />
    <h3>Riesgos</h3><Statements items={a.risks} label="INFERENCE" />
    <h3>Acciones recomendadas</h3><Statements items={a.recommendedActions} label="RECOMMENDATION" />
    <h3>Limitaciones / datos faltantes</h3><ul>{[...result.missingData, ...a.missingData].map((v, i) => <li key={i}>{v}</li>)}</ul>
    <p>Revisa las inferencias con un ingeniero. La validación de formato y referencias no demuestra que cada interpretación sea correcta.</p>
  </article>;
}
export function EngineeringCopilot({ projectId, apuId, projectName, revision }) {
  const [status, setStatus] = useState(null);
  const [question, setQuestion] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [scenarioEnabled, setScenarioEnabled] = useState(false);
  const [resource, setResource] = useState('');
  const [percent, setPercent] = useState('8');
  const [refresh, setRefresh] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    setResult(null); setError(''); setBusy(false); setQuestion(''); setScenarioEnabled(false); setStatus(null);
    apiGetSafe('/api/engineering-ai').then(data => { if (generation.current === current) setStatus(data || { unavailable: true }); });
    return () => { generation.current++; };
  }, [projectId, apuId, revision, refresh]);
  async function ask(text, analysis = 'answerEngineeringQuestion') {
    if (busy || !text.trim()) return;
    const current = generation.current;
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await apiPost('/api/engineering-ai', { projectId, ...(apuId ? { apuId } : {}), question: text, analysis,
        ...(scenarioEnabled && apuId ? { scenario: { kind: 'MATERIAL_PERCENT', resourceDescripcion: resource, value: Number(percent) } } : {}) });
      if (current === generation.current) setResult(response);
    } catch (err) { if (current === generation.current) setError(err.message || 'No se pudo analizar. Intenta de nuevo.'); }
    finally { if (current === generation.current) setBusy(false); }
  }
  const disabled = busy || !projectId || !status?.configured;
  return <section className="engineering-copilot" aria-label="Asistente de Ingeniería">
    <h2>ZOEMEC AI · Asistente de Ingeniería</h2>
    <p>Proyecto: <b>{projectName || projectId || 'Selecciona un proyecto guardado'}</b> · {apuId ? `APU: ${apuId}` : 'Todos los APUs guardados del proyecto'}</p>
    <p>Explica datos guardados con NVIDIA/Nemotron vía Nebius. Guarda tus cambios antes de analizar. Las preguntas y el contexto técnico minimizado se envían a Nebius.</p>
    <p role="status">{status?.unavailable ? 'No se pudo consultar el servicio.' : status?.status || 'Consultando configuración…'}</p>
    {status && !status.configured && <button type="button" className="soft" onClick={() => setRefresh(v => v + 1)}>Revisar configuración</button>}
    <div className="engineering-quick">{QUICK.map(([label, type, text]) => <button type="button" className="soft" key={type} disabled={disabled} onClick={() => ask(text, type)}>{apuId && type === 'analyzeProjectContext' ? 'Resumir APU seleccionado' : label}</button>)}</div>
    {apuId && <details><summary>Escenario determinístico de materiales</summary>
      <label><input type="checkbox" checked={scenarioEnabled} onChange={e => setScenarioEnabled(e.target.checked)} /> Calcular escenario antes de explicar</label>
      <label>Descripción exacta del recurso (vacío: todos los materiales)<input value={resource} maxLength={200} onChange={e => setResource(e.target.value)} /></label>
      <label>Cambio porcentual<input type="number" min="-100" max="100" step="0.1" value={percent} onChange={e => setPercent(e.target.value)} /></label>
      <p>El Scenario Engine calcula el cambio; el modelo solo lo explica. No se modifica el APU.</p>
    </details>}
    <form onSubmit={e => { e.preventDefault(); ask(question); }}>
      <label>Pregunta sobre este proyecto<textarea maxLength={1000} value={question} onChange={e => setQuestion(e.target.value)} placeholder="¿De dónde salió este precio? ¿Qué evidencia falta?" /></label>
      <button disabled={disabled || !question.trim()} type="submit">{busy ? 'Analizando…' : 'Consultar con evidencia'}</button>
    </form>
    <div aria-live="polite">{busy && <p>Consultando datos autorizados y esperando la explicación de Nebius…</p>}</div>
    {error && <p role="alert">{error} Puedes volver a intentar con las acciones anteriores.</p>}
    {result && <EngineeringAnswer result={result} />}
  </section>;
}
