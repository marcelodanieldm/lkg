/**
 * places.js — Cliente de Google Places API (New).
 *
 * IMPORTANTE — el punto que define toda la arquitectura:
 *
 *   La Business Profile API SOLO funciona sobre perfiles que administrás.
 *   Requiere solicitud formal a Google, un GBP verificado con 60+ días de
 *   antigüedad, sitio web propio, y la aprobación tarda días o semanas.
 *   Por eso NO sirve para prospectar.
 *
 *   Para auditar negocios que todavía no son clientes, la única vía legítima
 *   es Places API (New), que expone datos públicos. Todo lo que Places no
 *   expone (publicaciones, ofertas, botón de chat, fecha de las fotos) se
 *   cubre con captura asistida — 90 segundos mirando el perfil en Maps.
 *
 * Costos verificados (junio 2026, tramo 10K–100K/mes):
 *   Place Details Essentials              USD  5 /1.000   (10.000 gratis/mes)
 *   Place Details Pro                     USD 17 /1.000   ( 5.000 gratis/mes)
 *   Place Details Enterprise              USD 20 /1.000   ( 1.000 gratis/mes)
 *   Place Details Enterprise+Atmosphere   ~USD 25 /1.000   (incluye reviews)
 *   Text Search Pro                       USD 32 /1.000
 *   Text Search Enterprise+Atmosphere     USD 40 /1.000
 *
 * Regla de facturación clave: el precio lo fija el campo MÁS CARO del
 * fieldMask, no el promedio. Pedir `reviews` sube TODO el request al escalón
 * Atmosphere. Por eso abajo hay dos fieldMask separados.
 */

const BASE = 'https://places.googleapis.com/v1';

/** Barato: todo menos reseñas. Suficiente para el 80% de la auditoría. */
export const FIELDMASK_AUDITORIA = [
  'id', 'displayName', 'formattedAddress', 'shortFormattedAddress', 'location',
  'types', 'primaryType', 'primaryTypeDisplayName', 'googleMapsUri',
  'businessStatus', 'nationalPhoneNumber', 'internationalPhoneNumber',
  'websiteUri', 'rating', 'userRatingCount', 'priceLevel',
  'regularOpeningHours', 'currentOpeningHours', 'photos',
  'accessibilityOptions', 'paymentOptions', 'parkingOptions',
  'delivery', 'dineIn', 'takeout', 'curbsidePickup', 'reservable',
  'outdoorSeating', 'restroom', 'goodForChildren', 'goodForGroups',
].join(',');

/** Caro: suma reseñas y resumen editorial. Escalón Atmosphere. */
export const FIELDMASK_COMPLETO = [
  FIELDMASK_AUDITORIA, 'reviews', 'editorialSummary',
].join(',');

/** Máscara ampliada sólo para barrido de competidores. Escalón Text Search Pro (sin reseñas/Atmosphere). */
export const FIELDMASK_BARRIDO = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.shortFormattedAddress',
  'places.location', 'places.types', 'places.primaryType', 'places.primaryTypeDisplayName',
  'places.googleMapsUri', 'places.businessStatus', 'places.nationalPhoneNumber', 'places.internationalPhoneNumber',
  'places.websiteUri', 'places.rating', 'places.userRatingCount', 'places.priceLevel',
  'places.regularOpeningHours', 'places.currentOpeningHours', 'places.photos',
  'places.accessibilityOptions', 'places.paymentOptions', 'places.parkingOptions',
  'places.delivery', 'places.dineIn', 'places.takeout', 'places.curbsidePickup',
  'places.reservable', 'places.outdoorSeating', 'places.restroom', 'places.goodForChildren', 'places.goodForGroups',
].join(',');

function requireKey() {
  const k = process.env.GOOGLE_MAPS_API_KEY;
  if (!k) throw new Error('Falta GOOGLE_MAPS_API_KEY en el entorno');
  return k;
}

/** Busca negocios por texto + ubicación. Para armar listas de prospección o barridos. */
export async function buscarNegocios({
  consulta, lat, lng, radioMetros = 5000, max = 20, idioma = 'es-419', region = 'AR',
  locationRestriction = false, ampliado = false, pageToken = null,
}) {
  const mask = ampliado
    ? FIELDMASK_BARRIDO
    : 'places.id,places.displayName,places.formattedAddress,places.primaryTypeDisplayName,places.rating,places.userRatingCount,places.websiteUri,places.googleMapsUri,places.location';

  const body = {
    textQuery: consulta,
    languageCode: idioma,
    regionCode: region,
    maxResultCount: Math.min(max, 20),
  };

  if (pageToken) {
    body.pageToken = pageToken;
  }

  if (lat && lng) {
    if (locationRestriction) {
      const r = Number(radioMetros);
      const latDeg = r / 111320;
      const lngDeg = r / (111320 * Math.cos((Number(lat) * Math.PI) / 180));
      body.locationRestriction = {
        rectangle: {
          low: { latitude: Number(lat) - latDeg, longitude: Number(lng) - lngDeg },
          high: { latitude: Number(lat) + latDeg, longitude: Number(lng) + lngDeg },
        },
      };
    } else {
      body.locationBias = { circle: { center: { latitude: Number(lat), longitude: Number(lng) }, radius: Number(radioMetros) } };
    }
  }

  const res = await fetch(`${BASE}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': requireKey(),
      'X-Goog-FieldMask': mask,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Places searchText ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const arr = data.places || [];
  arr.nextPageToken = data.nextPageToken || null;
  return arr;
}

/** Detalle de un perfil. `conResenas` decide el escalón de precio. */
export async function detallePlace(placeId, { conResenas = true, idioma = 'es-419', region = 'AR' } = {}) {
  const mask = conResenas ? FIELDMASK_COMPLETO : FIELDMASK_AUDITORIA;
  const url = `${BASE}/places/${encodeURIComponent(placeId)}?languageCode=${idioma}&regionCode=${region}`;
  const res = await fetch(url, {
    headers: { 'X-Goog-Api-Key': requireKey(), 'X-Goog-FieldMask': mask },
  });
  if (!res.ok) throw new Error(`Places details ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Costo estimado en USD de auditar N perfiles, para no romper el presupuesto. */
export function estimarCosto(cantidadPerfiles, { conResenas = true, incluirBusqueda = true } = {}) {
  const detalle = (conResenas ? 25 : 20) / 1000;
  const busqueda = incluirBusqueda ? 32 / 1000 / 15 : 0; // 1 búsqueda rinde ~15 perfiles
  const total = cantidadPerfiles * (detalle + busqueda);
  return {
    perfiles: cantidadPerfiles,
    costoUSD: +total.toFixed(2),
    costoPorPerfilUSD: +(detalle + busqueda).toFixed(4),
    nota: 'Los primeros 1.000 Place Details Enterprise del mes no se facturan. A 30 auditorías/semana (~130/mes) el costo real de datos queda en cero o cerca.',
  };
}

/** Extrae un placeId desde un enlace de Google Maps pegado por el usuario. */
export function placeIdDesdeUrl(url) {
  const m1 = url.match(/place_id[:=]([A-Za-z0-9_-]+)/);
  if (m1) return m1[1];
  const m2 = url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/);
  if (m2) return null; // es un CID, hay que resolverlo con searchText por nombre+dirección
  return null;
}
