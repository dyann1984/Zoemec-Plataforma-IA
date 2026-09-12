/* Shell generico de asistente por pasos (Fase B -- Cuantificador
   Parametrico ZOEMEC). Puramente presentacional: no decide navegacion ni
   valida nada, solo dibuja el indicador de progreso y el contenido del
   paso activo -- cada llamador sigue siendo dueno de su propio estado
   (activeIndex) y de sus botones de navegacion (ver StepXxx.jsx en
   src/features/quantifier/), igual criterio que el resto de la app: los
   componentes de src/components/ui/ nunca traen logica de negocio propia.

   Se construye como componente COMPARTIDO (no local como
   PhoneScanSurveyForm.jsx/Import3DSurveyForm.jsx) porque este asistente
   especifico esta pensado para crecer de 3 a 17 elementos parametricos --
   un shell reutilizable evita duplicar el indicador de pasos 17 veces. */
export function WizardShell({ steps, activeIndex, children }){
  return <div className="wizard-shell">
    <div className="wizard-steps" role="tablist">
      {steps.map((step, i) => (
        <div key={step.key} className={'wizard-step' + (i === activeIndex ? ' active' : '') + (i < activeIndex ? ' done' : '')} role="tab" aria-selected={i === activeIndex}>
          <span className="wizard-step-index">{i < activeIndex ? '✓' : i + 1}</span>
          <span className="wizard-step-label">{step.label}</span>
        </div>
      ))}
    </div>
    <div className="wizard-step-content">{children}</div>
  </div>;
}
