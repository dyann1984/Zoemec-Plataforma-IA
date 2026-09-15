/* Marca ZOEMEC reutilizable: un solo componente decide que archivo de imagen
   usar, para que header/login/sidebar/landing nunca vuelvan a
   desincronizarse. Logo oficial (correccion del cliente, reemplaza el
   simbolo recortado anterior): public/images/zoemec-logo-oficial.png --
   lockup completo (icono + wordmark "ZOEMEC" + tagline "Inteligencia para
   construir") extraido tal cual del brand board oficial, sin redibujar ni
   un pixel, solo recorte + fondo transparente. Como el texto YA esta
   dentro de la imagen, este componente NO vuelve a poner "ZOEMEC" ni el
   subtitulo por separado en HTML -- eso duplicaria la marca.

   El tamaño/gap de cada variante sigue viviendo en el CSS de su contenedor
   existente (.landing .brand-mini img / .hero-logo img / .brand img). */
const LOGO_SRC = '/images/zoemec-logo-oficial.png';

export function ZoemecBrand({ variant = 'header' }){
  return <img src={LOGO_SRC} alt="ZOEMEC — Inteligencia para construir" className="zoemec-symbol" data-variant={variant} onError={(e) => { e.currentTarget.style.display = 'none'; }} />;
}
