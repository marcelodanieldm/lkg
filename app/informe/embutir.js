/**
 * embutir.js — Mete el informe dentro de una página de Next sin que las hojas
 * de estilo se peleen.
 *
 * EL PROBLEMA. `report.js` genera un documento HTML autocontenido, pensado para
 * abrirse solo en el cliente de correo de alguien. Sus clases son genéricas:
 * `.barra`, `.cta`, `.sub`, `.item`, `.num`. Y `globals.css` —que el layout
 * raíz carga en TODAS las páginas— define `.barra` (la navegación del panel),
 * `.cta` (el botón de la landing) y `.sub` (un párrafo apagado).
 *
 * Al renderizar el informe dentro de la app, las dos hojas se aplican sobre los
 * mismos elementos. Aunque la del informe gane por venir después, las
 * propiedades que NO redefine se filtran igual: el `max-width: 66ch` y el
 * `margin-bottom: 24px` de `.sub` de globals se cuelan en el `.sub` del
 * informe, y la maquetación queda sutilmente mal sin que nada parezca roto.
 *
 * LA SOLUCIÓN. Se acota cada selector del informe a un contenedor propio. Es
 * una capa fina de aislamiento —lo que hacen los CSS modules— hecha a mano,
 * porque el CSS llega como texto desde el generador y no pasa por el compilador.
 *
 * Alternativas descartadas: un iframe pierde la altura automática y complica
 * imprimir; `@scope` todavía no tiene soporte parejo; reescribir las clases de
 * `report.js` rompería los informes ya guardados en la base, que son HTML
 * congelado con las clases viejas.
 */

const ALCANCE = 'informe-embutido';

/** Extrae cuerpo y estilos del documento y devuelve todo listo para pintar. */
export function embutirInforme(documento) {
  const cuerpo = documento.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? documento;
  const crudo = [...documento.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)]
    .map(m => m[1]).join('\n');
  return { alcance: ALCANCE, cuerpo, estilos: acotar(crudo, `.${ALCANCE}`) };
}

/**
 * Antepone `alcance` a cada selector de una hoja de estilos.
 *
 * No es un parser de CSS completo y no pretende serlo: entiende lo que
 * `report.js` produce —reglas planas y un `@media print`— y nada más. Si algún
 * día ese archivo empieza a generar CSS más raro (anidamiento, `@supports`,
 * `@container`), esto hay que revisarlo. Un parser de verdad serían cientos de
 * líneas para resolver un problema que hoy tiene doce.
 */
export function acotar(css, alcance) {
  const salida = [];
  let i = 0;

  while (i < css.length) {
    const llave = css.indexOf('{', i);
    if (llave === -1) break;

    const selector = css.slice(i, llave).trim();
    const cierre = buscarCierre(css, llave);
    const cuerpo = css.slice(llave + 1, cierre);

    if (selector.startsWith('@')) {
      // Las reglas anidadas de un @media se acotan por dentro; @font-face,
      // @keyframes y @import no llevan selectores, así que pasan enteras.
      salida.push(/^@(media|supports|layer)/.test(selector)
        ? `${selector}{${acotar(cuerpo, alcance)}}`
        : `${selector}{${cuerpo}}`);
    } else {
      salida.push(`${prefijar(selector, alcance)}{${cuerpo}}`);
    }

    i = cierre + 1;
  }

  return salida.join('\n');
}

/** Encuentra la llave que cierra el bloque abierto en `desde`. */
function buscarCierre(css, desde) {
  let nivel = 0;
  for (let j = desde; j < css.length; j++) {
    if (css[j] === '{') nivel++;
    else if (css[j] === '}' && --nivel === 0) return j;
  }
  return css.length;
}

function prefijar(selector, alcance) {
  return selector.split(',').map(s => {
    const sel = s.trim();
    if (!sel) return sel;

    // `:root` define las variables del informe. Se mueven al contenedor: ahí
    // siguen heredando hacia adentro y dejan de pisar las del panel.
    if (sel === ':root' || sel === 'html') return alcance;

    // `body` es el contenedor mismo, no un descendiente.
    if (sel === 'body') return alcance;

    // `*` tiene que alcanzar también al propio contenedor.
    if (sel === '*') return `${alcance}, ${alcance} *`;

    return `${alcance} ${sel}`;
  }).join(', ');
}
