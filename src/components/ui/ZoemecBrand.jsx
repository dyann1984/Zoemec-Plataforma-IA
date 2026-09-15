import React from 'react';

/* Asset de marca oficial definitivo aprobado:
   Horizontal lockup con símbolo 3D azul + ZOEMEC® + INGENIERÍA Y CONSTRUCCIÓN.
   Usa exclusivamente /images/zoemec-logo-oficial.png sin reconstruir texto con HTML. */
const BRAND_LOGO_SRC = '/images/zoemec-logo-oficial.png';

export function ZoemecBrand({ variant = 'header', className = '', ...props }){
  return (
    <div className={`brand-wrap brand-wrap-${variant} ${className}`.trim()} {...props}>
      <img
        src={BRAND_LOGO_SRC}
        alt="ZOEMEC · Ingeniería y construcción"
        className="zoemec-brand-logo"
        data-variant={variant}
      />
    </div>
  );
}
