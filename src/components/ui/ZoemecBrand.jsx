/* Marca ZOEMEC reutilizable (correccion unica de logo, todas las vistas):
   un solo componente decide que archivo de imagen usar y que texto la
   acompaña, para que header/login/sidebar nunca vuelvan a desincronizarse
   en tamaño o estilo. El simbolo es SIEMPRE el mismo asset transparente
   (public/images/logo-header-symbol.png -- fondo blanco recortado, sin la
   palabra ZOEMEC dentro de la imagen, canal alfa real).

   El tamaño/gap/glow de cada variante sigue viviendo en el CSS de su
   contenedor existente (.landing .brand-mini img / .hero-logo img /
   .brand img) -- este componente NO inventa un sistema de estilos nuevo,
   solo unifica la fuente de la imagen y evita que cada vista tenga su
   propia copia manual del markup. */
const SYMBOL_SRC = '/images/logo-header-symbol.png';

export function ZoemecBrand({ variant = 'header', subtitle }){
  const symbol = <img src={SYMBOL_SRC} alt="" className="zoemec-symbol" onError={(e) => { e.currentTarget.style.display = 'none'; }} />;
  if(variant === 'sidebar'){
    return <>{symbol}<div><b>ZOEMEC</b><span>{subtitle}</span></div></>;
  }
  if(variant === 'login'){
    return <>{symbol}<span>ZOEMEC</span></>;
  }
  return <>{symbol}<b>ZOEMEC</b></>; // header/landing
}
