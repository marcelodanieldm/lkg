/**
 * normalize.js — Traduce respuestas crudas al modelo interno de perfil.
 *
 * Fuentes soportadas:
 *  1. Places API (New) — datos públicos de cualquier negocio. Es lo que se usa
 *     para prospectar, porque NO requiere ser dueño del perfil.
 *  2. Business Profile API — sólo para clientes ya firmados que nos dan acceso.
 *     Aporta posts, métricas de rendimiento y respuestas a reseñas.
 *  3. Captura asistida — un formulario/checklist para los ~7 campos que la API
 *     pública no expone. Sin esto, esos campos quedan como "no verificado" y
 *     el motor los excluye del cálculo en lugar de inventarlos.
 */

const CATEGORIAS_GENERICAS = new Set([
  'establishment', 'point_of_interest', 'store', 'food', 'business',
  'local_business', 'general_contractor', 'health', 'finance',
]);

const dias = (iso) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
};

const soloDigitos = (s) => (s || '').replace(/\D/g, '');

/**
 * Places API (New) — places.get con fieldMask.
 * Ver src/integrations/places.js para el fieldMask exacto y su costo por SKU.
 */
export function desdePlacesApi(place, extras = {}) {
  if (!place) throw new Error('Respuesta de Places API vacía');

  const tipos = place.types || [];
  const primaria = place.primaryType || tipos[0] || null;
  const secundarias = tipos.filter(t => t !== primaria && !CATEGORIAS_GENERICAS.has(t));

  const resenas = place.reviews || [];
  const conRespuesta = resenas.filter(r => r.authorAttribution && r.originalText && r.ownerResponse).length;

  // Places API devuelve como máximo 5 reseñas; la tasa de respuesta es una
  // muestra, no el universo. Se declara como tal en el informe.
  const tasaRespuesta = resenas.length ? conRespuesta / resenas.length : null;

  const ultimaResena = resenas
    .map(r => r.publishTime)
    .filter(Boolean)
    .sort()
    .pop();

  return {
    fuente: 'places_api',
    placeId: place.id,
    nombre: place.displayName?.text || place.name,
    direccion: place.formattedAddress || place.shortFormattedAddress,
    zona: extraerZona(place),
    telefono: place.nationalPhoneNumber || place.internationalPhoneNumber || null,
    sitioWeb: place.websiteUri || null,
    mapsUrl: place.googleMapsUri || null,
    estado: place.businessStatus || null,
    latitud: place.location?.latitude ?? null,
    longitud: place.location?.longitude ?? null,

    categoriaPrimaria: primaria,
    categoriaPrimariaLabel: place.primaryTypeDisplayName?.text || primaria,
    categoriasSecundarias: secundarias,

    descripcion: place.editorialSummary?.text || '',

    rating: place.rating ?? null,
    cantidadResenas: place.userRatingCount ?? 0,
    resenasMuestra: resenas.map(r => ({
      autor: r.authorAttribution?.displayName,
      rating: r.rating,
      texto: r.originalText?.text || r.text?.text || '',
      fecha: r.publishTime,
      tieneRespuesta: !!r.ownerResponse,
    })),
    tasaRespuestaResenas: tasaRespuesta,
    diasDesdeUltimaResena: dias(ultimaResena),

    cantidadFotos: (place.photos || []).length,
    // La API devuelve como mucho 10 referencias de foto: es un piso, no el total.
    fotosEsUnPiso: (place.photos || []).length >= 10,

    horarios: (place.regularOpeningHours?.periods || []).map(p => ({
      dia: p.open?.day,
      abre: p.open?.hour,
      cierra: p.close?.hour,
    })),
    horariosEspeciales: place.specialDays || place.currentSecondaryOpeningHours || [],

    atributos: extraerAtributos(place),
    servicios: null,

    // Campos que la API pública NO expone. Quedan null a propósito:
    // el motor los marca "no verificado" en lugar de asumir un valor.
    postsUltimos30Dias: null,
    ofertasActivas: null,
    mensajeriaActiva: null,
    reservasActivas: null,
    diasDesdeUltimaFoto: null,
    tiposDeFoto: null,

    redes: {},
    web: null,

    ...extras, // aquí entran captura asistida y análisis del sitio
  };
}

const ATRIBUTOS_BOOL = [
  'allowsDogs', 'curbsidePickup', 'delivery', 'dineIn', 'goodForChildren',
  'goodForGroups', 'goodForWatchingSports', 'liveMusic', 'outdoorSeating',
  'reservable', 'restroom', 'servesBeer', 'servesBreakfast', 'servesBrunch',
  'servesCocktails', 'servesCoffee', 'servesDessert', 'servesDinner',
  'servesLunch', 'servesVegetarianFood', 'servesWine', 'takeout',
];

function extraerAtributos(place) {
  const out = [];
  for (const k of ATRIBUTOS_BOOL) if (place[k] === true) out.push(k);
  const acc = place.accessibilityOptions || {};
  for (const [k, v] of Object.entries(acc)) if (v === true) out.push(k);
  const pay = place.paymentOptions || {};
  for (const [k, v] of Object.entries(pay)) if (v === true) out.push(k);
  const park = place.parkingOptions || {};
  for (const [k, v] of Object.entries(park)) if (v === true) out.push(k);
  return out;
}

/**
 * Fusiona los datos de la captura asistida (formulario de 7 campos que se
 * completa mirando el perfil en Maps, tarda ~90 segundos) sobre el perfil.
 */
export function aplicarCapturaAsistida(perfil, captura = {}) {
  const c = { ...captura };
  return {
    ...perfil,
    postsUltimos30Dias: c.postsUltimos30Dias ?? perfil.postsUltimos30Dias,
    ofertasActivas: c.ofertasActivas ?? perfil.ofertasActivas,
    mensajeriaActiva: c.mensajeriaActiva ?? perfil.mensajeriaActiva,
    reservasActivas: c.reservasActivas ?? perfil.reservasActivas,
    diasDesdeUltimaFoto: c.diasDesdeUltimaFoto ?? perfil.diasDesdeUltimaFoto,
    tiposDeFoto: c.tiposDeFoto ?? perfil.tiposDeFoto,
    cantidadFotos: c.cantidadFotosReal ?? perfil.cantidadFotos,
    servicios: c.servicios ?? perfil.servicios,
    descripcion: c.descripcion ?? perfil.descripcion,
    capturaAsistida: true,
  };
}

/** Fusiona el análisis del sitio web (ver integrations/website-audit.js). */
export function aplicarAnalisisWeb(perfil, web) {
  if (!web) return perfil;
  return {
    ...perfil,
    web: {
      ...web,
      napTelefono: web.telefonos
        ? web.telefonos.some(t => soloDigitos(t).endsWith(soloDigitos(perfil.telefono).slice(-8)))
        : null,
      napDireccion: web.texto && perfil.direccion
        ? coincideDireccion(web.texto, perfil.direccion)
        : null,
    },
    redes: { ...(perfil.redes || {}), ...(web.redes || {}) },
  };
}

function coincideDireccion(texto, direccion) {
  const calle = direccion.split(',')[0].trim().toLowerCase();
  if (calle.length < 5) return null;
  return texto.toLowerCase().includes(calle);
}

/**
 * Business Profile API — sólo para clientes firmados.
 * Rellena exactamente los huecos que la API pública deja abiertos.
 */
export function aplicarBusinessProfile(perfil, { localPosts = [], reviews = [], media = [], metrics = null } = {}) {
  const hace30 = Date.now() - 30 * 86400000;
  const postsRecientes = localPosts.filter(p => new Date(p.createTime).getTime() > hace30);
  const conRespuesta = reviews.filter(r => r.reviewReply).length;
  const ultimaFoto = media.map(m => m.createTime).filter(Boolean).sort().pop();

  return {
    ...perfil,
    fuente: 'business_profile_api',
    postsUltimos30Dias: postsRecientes.length,
    ofertasActivas: localPosts.filter(p => p.topicType === 'OFFER' &&
      (!p.offer?.couponCode || new Date(p.event?.schedule?.endDate || Date.now() + 1) > new Date())).length,
    tasaRespuestaResenas: reviews.length ? conRespuesta / reviews.length : perfil.tasaRespuestaResenas,
    cantidadResenas: reviews.length || perfil.cantidadResenas,
    cantidadFotos: media.length || perfil.cantidadFotos,
    diasDesdeUltimaFoto: dias(ultimaFoto),
    metricas: metrics, // impresiones, clics, llamadas, rutas
  };
}

function extraerZona(place) {
  if (place?.addressComponents && Array.isArray(place.addressComponents)) {
    const sub = place.addressComponents.find(c =>
      (c.types || []).some(t => ['sublocality_level_1', 'sublocality', 'neighborhood'].includes(t))
    );
    if (sub?.longText || sub?.shortText) return sub.longText || sub.shortText;
  }
  return null;
}
