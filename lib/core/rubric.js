/**
 * rubric.js — Rúbrica de auditoría de Google Business Profile.
 *
 * Este archivo es la "IP" del sistema: define QUÉ se mide, CÓMO se puntúa,
 * y CON QUÉ FUNDAMENTO se justifica cada hallazgo ante el prospecto.
 *
 * Diseño deliberado:
 *  - Determinista. El mismo input produce siempre el mismo score. El LLM
 *    redacta, NO puntúa. Así el informe es defendible y reproducible.
 *  - Cada regla declara su `fuente` (el argumento que se le muestra al cliente)
 *    y su `servicio` (a qué ítem del plan de marketing corresponde el arreglo).
 *  - Cada regla declara `verificable`: si el dato viene de Places API (auto),
 *    del sitio web (auto), o requiere captura asistida (manual).
 *
 * Escala: 100 puntos repartidos en 6 dimensiones.
 */

export const BANDAS = [
  { min: 90, clave: 'excelente', etiqueta: 'Excelente',  color: '#16794a', resumen: 'El perfil está entre el 10% superior de su categoría. El trabajo es de sostenimiento y ventaja competitiva.' },
  { min: 75, clave: 'bueno',     etiqueta: 'Bueno',      color: '#3f7d20', resumen: 'Base sólida con oportunidades concretas de crecimiento. Ajustes de precisión, no reconstrucción.' },
  { min: 60, clave: 'aceptable', etiqueta: 'Aceptable',  color: '#b8860b', resumen: 'El perfil funciona pero deja visibilidad sobre la mesa. Hay margen amplio de mejora con esfuerzo moderado.' },
  { min: 40, clave: 'debil',     etiqueta: 'Débil',      color: '#c2410c', resumen: 'El perfil está por debajo del estándar de su categoría. Probablemente esté perdiendo consultas frente a competidores directos.' },
  { min: 0,  clave: 'critico',   etiqueta: 'Crítico',    color: '#b91c1c', resumen: 'El perfil es prácticamente invisible en búsquedas por categoría. Es la situación con mayor upside: casi cualquier acción mejora resultados.' },
];

export const SEVERIDAD = {
  critico: { peso: 4, etiqueta: 'Crítico', color: '#b91c1c' },
  alto:    { peso: 3, etiqueta: 'Alto',    color: '#c2410c' },
  medio:   { peso: 2, etiqueta: 'Medio',   color: '#b8860b' },
  bajo:    { peso: 1, etiqueta: 'Bajo',    color: '#64748b' },
};

/**
 * Fuentes citables. Se referencian por clave desde las reglas para que el
 * informe muestre el fundamento y no una opinión suelta.
 */
export const FUENTES = {
  categoria_descubrimiento: {
    texto: 'El 86% de las vistas de un perfil provienen de búsquedas por categoría ("pizzería cerca mío"), no de búsquedas por nombre de marca.',
    ref: 'PinMeTo — GBP Best Practices 2026',
    url: 'https://www.pinmeto.com/blog/google-business-profile-best-practices-2026/',
  },
  completitud_clicks: {
    texto: 'Los perfiles completos reciben ~7x más clics que los incompletos, y los que se actualizan seguido ~5x más vistas que los estáticos.',
    ref: 'PinMeTo — GBP Best Practices 2026',
    url: 'https://www.pinmeto.com/blog/google-business-profile-best-practices-2026/',
  },
  fotos_conversion: {
    texto: 'Los perfiles con fotos reciben 42% más solicitudes de "Cómo llegar" y 35% más clics al sitio web.',
    ref: 'PinMeTo — GBP Best Practices 2026',
    url: 'https://www.pinmeto.com/blog/google-business-profile-best-practices-2026/',
  },
  respuesta_resenas: {
    texto: 'El 65% de los consumidores dice ser más propenso a elegir un negocio que responde sus reseñas. El estándar es responder dentro de 24-48 hs.',
    ref: 'PinMeTo — GBP Best Practices 2026',
    url: 'https://www.pinmeto.com/blog/google-business-profile-best-practices-2026/',
  },
  peso_senales: {
    texto: 'En 2026 el ranking local se reparte aprox. así: señales de GBP 32%, sitio web 19%, reseñas 16%, enlaces 15%, comportamiento 10%, señales sociales y de IA 8%.',
    ref: 'Flento — Local SEO Ranking Factors 2026',
    url: 'https://www.flento.io/blog/local-seo-ranking-factors',
  },
  umbral_resenas: {
    texto: 'El umbral de 10 reseñas funciona como piso de credibilidad; por debajo el perfil compite en desventaja aun teniendo buen promedio.',
    ref: 'Flento — Local SEO Ranking Factors 2026',
    url: 'https://www.flento.io/blog/local-seo-ranking-factors',
  },
  frecuencia_publicacion: {
    texto: 'La recomendación operativa es publicar al menos una novedad semanal, alternando Novedades, Eventos y Ofertas, y sumar al menos 5 fotos nuevas por trimestre.',
    ref: 'PinMeTo — GBP Best Practices 2026',
    url: 'https://www.pinmeto.com/blog/google-business-profile-best-practices-2026/',
  },
  horarios_2026: {
    texto: 'La exactitud de horarios y el estado "abierto ahora" pasaron a ser factor de ranking explícito en 2026: un perfil con horarios mal cargados pierde posiciones en el momento exacto de la intención de compra.',
    ref: 'Flento — Local SEO Ranking Factors 2026',
    url: 'https://www.flento.io/blog/local-seo-ranking-factors',
  },
  nap_citations: {
    texto: 'La consistencia de Nombre, Dirección y Teléfono (NAP) entre el perfil, el sitio y los directorios sigue siendo un factor de confianza del algoritmo local.',
    ref: 'Flento — Local SEO Ranking Factors 2026',
    url: 'https://www.flento.io/blog/local-seo-ranking-factors',
  },
  ia_social: {
    texto: 'Las señales sociales y de búsqueda por IA entraron por primera vez al algoritmo local en 2026 (~8% del peso combinado).',
    ref: 'Flento — Local SEO Ranking Factors 2026',
    url: 'https://www.flento.io/blog/local-seo-ranking-factors',
  },
};

/**
 * Catálogo de servicios. Cada hallazgo apunta a uno; el motor de presupuestos
 * arma los 3 niveles combinando estos servicios según impacto/esfuerzo.
 *
 * costoMensualUSD: precio de lista del ítem dentro de un abono.
 * costoSetupUSD: trabajo inicial de una sola vez.
 * horasMes: carga real de trabajo — clave para operar a medio tiempo.
 */
export const SERVICIOS = {
  setup_perfil: {
    nombre: 'Optimización integral del perfil',
    detalle: 'Categorías, descripción, atributos, horarios, servicios/menú, enlaces y datos de contacto reescritos con criterio de búsqueda.',
    costoSetupUSD: 190, costoMensualUSD: 0, horasSetup: 4, horasMes: 0, nivelMinimo: 1,
  },
  gestion_resenas: {
    nombre: 'Gestión y respuesta de reseñas',
    detalle: 'Respuesta a toda reseña nueva dentro de 24-48 hs con tono de marca, más protocolo de escalamiento para reseñas negativas.',
    costoSetupUSD: 60, costoMensualUSD: 95, horasSetup: 1, horasMes: 2, nivelMinimo: 1,
  },
  captacion_resenas: {
    nombre: 'Sistema de captación de reseñas',
    detalle: 'Link corto + QR + secuencia por WhatsApp/email post-atención para pedir reseñas de forma sistemática y respetuosa.',
    costoSetupUSD: 120, costoMensualUSD: 72, horasSetup: 2, horasMes: 1.5, nivelMinimo: 2,
  },
  contenido_posts: {
    nombre: 'Publicaciones semanales en GBP',
    detalle: '4-5 novedades por mes alternando Novedad, Oferta y Evento, con foto propia y llamado a la acción medido.',
    costoSetupUSD: 0, costoMensualUSD: 135, horasSetup: 0, horasMes: 3, nivelMinimo: 1,
  },
  fotografia: {
    nombre: 'Producción y carga de fotos',
    detalle: 'Lote trimestral de fotos (fachada, interior, producto, equipo) optimizadas y geoetiquetadas, cargadas con cadencia.',
    costoSetupUSD: 155, costoMensualUSD: 78, horasSetup: 3, horasMes: 1.5, nivelMinimo: 2,
  },
  conversion_perfil: {
    nombre: 'Activación de canales de conversión',
    detalle: 'Botón de mensajes, reservas/pedidos, catálogo de servicios y UTMs para poder atribuir las consultas que llegan de Maps.',
    costoSetupUSD: 135, costoMensualUSD: 0, horasSetup: 2.5, horasMes: 0, nivelMinimo: 1,
  },
  seo_local_web: {
    nombre: 'SEO local en el sitio web',
    detalle: 'NAP consistente, datos estructurados LocalBusiness, página de ubicación y velocidad móvil.',
    costoSetupUSD: 250, costoMensualUSD: 0, horasSetup: 5, horasMes: 0, nivelMinimo: 2,
  },
  redes_sociales: {
    nombre: 'Sincronización con redes sociales',
    detalle: 'Coherencia de marca y datos entre GBP, Instagram y Facebook, más reutilización del contenido de GBP.',
    costoSetupUSD: 90, costoMensualUSD: 115, horasSetup: 1.5, horasMes: 2.5, nivelMinimo: 3,
  },
  citations: {
    nombre: 'Directorios y citaciones locales',
    detalle: 'Alta y corrección de NAP en los directorios que Google cruza para validar el negocio.',
    costoSetupUSD: 205, costoMensualUSD: 0, horasSetup: 4, horasMes: 0, nivelMinimo: 3,
  },
  reporte_mensual: {
    nombre: 'Reporte mensual de resultados',
    detalle: 'Re-auditoría automática, evolución del score y métricas de Maps (vistas, llamadas, rutas, clics) con lectura en 1 página.',
    costoSetupUSD: 0, costoMensualUSD: 58, horasSetup: 0, horasMes: 1, nivelMinimo: 1,
  },
  aeo_ia: {
    nombre: 'Optimización para búsqueda con IA (AEO)',
    detalle: 'Preguntas frecuentes, entidades y datos estructurados pensados para que los asistentes de IA citen el negocio.',
    costoSetupUSD: 200, costoMensualUSD: 98, horasSetup: 4, horasMes: 2, nivelMinimo: 3,
  },
};

/**
 * DIMENSIONES Y REGLAS
 *
 * Cada regla: { id, peso, evaluar(p) -> { ratio 0..1, estado, evidencia } }
 * `p` es el perfil normalizado (ver normalize.js).
 *
 * estado: 'fuerte' | 'ok' | 'debil' | 'ausente' | 'nd' (no determinable)
 * Las reglas 'nd' se excluyen del denominador y se listan aparte como
 * "requiere verificación" — nunca se inventa un dato que no tenemos.
 */

const escalonar = (valor, escalones) => {
  // escalones: [[umbral, ratio], ...] de mayor a menor
  for (const [umbral, ratio] of escalones) if (valor >= umbral) return ratio;
  return 0;
};

export const DIMENSIONES = [
  {
    id: 'fundamentos',
    nombre: 'Fundamentos del perfil',
    peso: 20,
    descripcion: 'Los datos base que Google usa para entender qué es el negocio y cuándo mostrarlo.',
    reglas: [
      {
        id: 'categoria_primaria', peso: 5, verificable: 'auto', servicio: 'setup_perfil', fuente: 'categoria_descubrimiento',
        titulo: 'Categoría primaria específica',
        evaluar: (p) => {
          if (!p.categoriaPrimaria) return { ratio: 0, estado: 'ausente', evidencia: 'No se detectó categoría primaria.' };
          const generica = /establishment|point_of_interest|store|food|business|local_business/i.test(p.categoriaPrimaria);
          if (generica) return { ratio: 0.35, estado: 'debil', evidencia: `Categoría "${p.categoriaPrimariaLabel || p.categoriaPrimaria}" es demasiado genérica.` };
          return { ratio: 1, estado: 'fuerte', evidencia: `Categoría primaria: ${p.categoriaPrimariaLabel || p.categoriaPrimaria}.` };
        },
        recomendacion: 'Definir la categoría primaria más específica que exista para el rubro y usarla como eje de todo el perfil. Las secundarias se suman después, nunca antes.',
      },
      {
        id: 'categorias_secundarias', peso: 3, verificable: 'auto', servicio: 'setup_perfil', fuente: 'categoria_descubrimiento',
        titulo: 'Categorías secundarias',
        evaluar: (p) => {
          const n = (p.categoriasSecundarias || []).length;
          return { ratio: escalonar(n, [[4, 1], [2, 0.7], [1, 0.4]]), estado: n >= 4 ? 'fuerte' : n >= 1 ? 'debil' : 'ausente',
                   evidencia: `${n} categoría(s) secundaria(s) declarada(s).` };
        },
        recomendacion: 'Sumar entre 4 y 9 categorías secundarias reales (Google permite hasta 10 en total). Cada una abre una consulta nueva por la que el negocio puede aparecer.',
      },
      {
        id: 'telefono', peso: 2, verificable: 'auto', servicio: 'setup_perfil', fuente: 'completitud_clicks',
        titulo: 'Teléfono cargado',
        evaluar: (p) => p.telefono
          ? { ratio: 1, estado: 'fuerte', evidencia: `Teléfono público: ${p.telefono}.` }
          : { ratio: 0, estado: 'ausente', evidencia: 'Sin teléfono público en el perfil.' },
        recomendacion: 'Cargar un teléfono local atendido. El clic en "Llamar" es la conversión más directa de Maps y sin número simplemente no existe.',
      },
      {
        id: 'sitio_web', peso: 3, verificable: 'auto', servicio: 'seo_local_web', fuente: 'peso_senales',
        titulo: 'Sitio web enlazado',
        evaluar: (p) => p.sitioWeb
          ? { ratio: 1, estado: 'fuerte', evidencia: `Sitio enlazado: ${p.sitioWeb}.` }
          : { ratio: 0, estado: 'ausente', evidencia: 'El perfil no enlaza ningún sitio web.' },
        recomendacion: 'Enlazar un sitio o al menos una landing propia. El sitio pesa ~19% del algoritmo local; sin él ese porcentaje se pierde entero.',
      },
      {
        id: 'horarios', peso: 4, verificable: 'auto', servicio: 'setup_perfil', fuente: 'horarios_2026',
        titulo: 'Horarios completos y coherentes',
        evaluar: (p) => {
          const dias = (p.horarios || []).length;
          if (!dias) return { ratio: 0, estado: 'ausente', evidencia: 'Sin horarios cargados.' };
          if (dias < 7) return { ratio: 0.5, estado: 'debil', evidencia: `Solo ${dias} de 7 días con horario definido.` };
          return { ratio: 1, estado: 'fuerte', evidencia: 'Los 7 días tienen horario definido.' };
        },
        recomendacion: 'Cubrir los 7 días (incluido "Cerrado" explícito). En 2026 el estado "abierto ahora" es factor de ranking en el momento exacto de la búsqueda.',
      },
      {
        id: 'horarios_especiales', peso: 2, verificable: 'auto', servicio: 'setup_perfil', fuente: 'horarios_2026',
        titulo: 'Horarios especiales / feriados',
        evaluar: (p) => (p.horariosEspeciales || []).length > 0
          ? { ratio: 1, estado: 'fuerte', evidencia: `${p.horariosEspeciales.length} fecha(s) especial(es) cargada(s).` }
          : { ratio: 0, estado: 'ausente', evidencia: 'Sin horarios especiales cargados para feriados.' },
        recomendacion: 'Cargar feriados y fechas atípicas con anticipación. Un cliente que llega y encuentra cerrado suele dejar una reseña negativa: es el error más caro y más barato de evitar.',
      },
      {
        id: 'descripcion', peso: 1, verificable: 'auto', servicio: 'setup_perfil', fuente: 'completitud_clicks',
        titulo: 'Descripción del negocio',
        evaluar: (p) => {
          const n = (p.descripcion || '').length;
          return { ratio: escalonar(n, [[600, 1], [250, 0.6], [1, 0.3]]), estado: n >= 600 ? 'fuerte' : n > 0 ? 'debil' : 'ausente',
                   evidencia: n ? `Descripción de ${n} caracteres.` : 'Sin descripción.' };
        },
        recomendacion: 'Escribir 600-750 caracteres describiendo servicios, zona de cobertura y diferencial, en el lenguaje que usa el cliente al buscar.',
      },
    ],
  },
  {
    id: 'reputacion',
    nombre: 'Reputación y reseñas',
    peso: 25,
    descripcion: 'Volumen, calidad, frescura y manejo de las reseñas. Es ~16% del algoritmo local y casi 100% de la decisión humana.',
    reglas: [
      {
        id: 'volumen_resenas', peso: 8, verificable: 'auto', servicio: 'captacion_resenas', fuente: 'umbral_resenas',
        titulo: 'Volumen de reseñas',
        evaluar: (p) => {
          const n = p.cantidadResenas || 0;
          const ratio = escalonar(n, [[150, 1], [80, 0.9], [40, 0.75], [20, 0.55], [10, 0.35], [1, 0.15]]);
          return { ratio, estado: n >= 80 ? 'fuerte' : n >= 20 ? 'ok' : n >= 1 ? 'debil' : 'ausente',
                   evidencia: `${n} reseña(s) publicada(s).` };
        },
        recomendacion: 'Instalar un sistema de pedido de reseñas post-atención. El objetivo operativo es superar primero las 10 (piso de credibilidad) y después sostener un flujo constante.',
      },
      {
        id: 'rating', peso: 7, verificable: 'auto', servicio: 'gestion_resenas', fuente: 'peso_senales',
        titulo: 'Calificación promedio',
        evaluar: (p) => {
          const r = p.rating, n = p.cantidadResenas || 0;
          if (!r) return { ratio: 0, estado: 'ausente', evidencia: 'Sin calificación.' };
          if (r >= 4.9 && n < 15) return { ratio: 0.6, estado: 'debil', evidencia: `${r} con solo ${n} reseñas: un promedio perfecto con pocas reseñas genera desconfianza y es frágil.` };
          if (r >= 4.5) return { ratio: 1, estado: 'fuerte', evidencia: `Calificación ${r}.` };
          if (r >= 4.2) return { ratio: 0.8, estado: 'ok', evidencia: `Calificación ${r}, sobre el promedio pero mejorable.` };
          if (r >= 3.8) return { ratio: 0.5, estado: 'debil', evidencia: `Calificación ${r}: por debajo del umbral que la mayoría usa para filtrar.` };
          return { ratio: 0.2, estado: 'debil', evidencia: `Calificación ${r}: está costando clientes de forma activa.` };
        },
        recomendacion: 'Trabajar en dos frentes: resolver la causa raíz de las reseñas bajas y aumentar el flujo de reseñas positivas reales para mover el promedio.',
      },
      {
        id: 'velocidad_resenas', peso: 5, verificable: 'auto', servicio: 'captacion_resenas', fuente: 'peso_senales',
        titulo: 'Frescura de las reseñas',
        evaluar: (p) => {
          if (p.diasDesdeUltimaResena == null) return { ratio: null, estado: 'nd', evidencia: 'No se pudo determinar la fecha de la última reseña.' };
          const d = p.diasDesdeUltimaResena;
          if (d <= 21) return { ratio: 1, estado: 'fuerte', evidencia: `Última reseña hace ${d} días.` };
          if (d <= 60) return { ratio: 0.7, estado: 'ok', evidencia: `Última reseña hace ${d} días.` };
          if (d <= 120) return { ratio: 0.4, estado: 'debil', evidencia: `Última reseña hace ${d} días: el perfil se está enfriando.` };
          return { ratio: 0.1, estado: 'debil', evidencia: `Última reseña hace ${d} días: Google lee el perfil como inactivo.` };
        },
        recomendacion: 'Un flujo constante de reseñas pesa más que un pico. Apuntar a al menos 2-4 reseñas nuevas por mes de forma sostenida.',
      },
      {
        id: 'tasa_respuesta', peso: 5, verificable: 'auto', servicio: 'gestion_resenas', fuente: 'respuesta_resenas',
        titulo: 'Respuesta del dueño a las reseñas',
        evaluar: (p) => {
          if (p.tasaRespuestaResenas == null) return { ratio: null, estado: 'nd', evidencia: 'No se pudo medir la tasa de respuesta.' };
          const t = p.tasaRespuestaResenas;
          return { ratio: escalonar(t, [[0.9, 1], [0.6, 0.75], [0.3, 0.45], [0.01, 0.2]]),
                   estado: t >= 0.9 ? 'fuerte' : t >= 0.3 ? 'debil' : 'ausente',
                   evidencia: `${Math.round(t * 100)}% de las reseñas analizadas tienen respuesta del dueño.` };
        },
        recomendacion: 'Responder el 100% de las reseñas dentro de 24-48 hs, también las positivas. Es la señal de servicio más visible y la más barata de dar.',
      },
    ],
  },
  {
    id: 'visual',
    nombre: 'Contenido visual',
    peso: 15,
    descripcion: 'Las fotos son lo primero que mira una persona y lo que más mueve el clic a "Cómo llegar" y al sitio.',
    reglas: [
      {
        id: 'cantidad_fotos', peso: 6, verificable: 'auto', servicio: 'fotografia', fuente: 'fotos_conversion',
        titulo: 'Cantidad de fotos',
        evaluar: (p) => {
          const n = p.cantidadFotos || 0;
          return { ratio: escalonar(n, [[50, 1], [25, 0.85], [12, 0.6], [5, 0.35], [1, 0.15]]),
                   estado: n >= 25 ? 'fuerte' : n >= 5 ? 'debil' : 'ausente',
                   evidencia: `${n} foto(s) asociada(s) al perfil.` };
        },
        recomendacion: 'Llegar a un mínimo de 25 fotos propias y sostener 5 nuevas por trimestre. Las fotos del negocio pesan más que las subidas por usuarios.',
      },
      {
        id: 'frescura_fotos', peso: 5, verificable: 'manual', servicio: 'fotografia', fuente: 'frecuencia_publicacion',
        titulo: 'Frescura de las fotos',
        evaluar: (p) => {
          if (p.diasDesdeUltimaFoto == null) return { ratio: null, estado: 'nd', evidencia: 'La API pública no expone la fecha de carga de las fotos; requiere verificación en el panel del negocio.' };
          const d = p.diasDesdeUltimaFoto;
          return { ratio: escalonar(-d, [[-30, 1], [-90, 0.7], [-180, 0.35]]),
                   estado: d <= 30 ? 'fuerte' : d <= 90 ? 'ok' : 'debil',
                   evidencia: `Última foto hace ${d} días.` };
        },
        recomendacion: 'Cargar fotos con cadencia trimestral como mínimo. Un perfil con fotos de hace dos años comunica un negocio que quizá ya no existe.',
      },
      {
        id: 'diversidad_fotos', peso: 4, verificable: 'manual', servicio: 'fotografia', fuente: 'fotos_conversion',
        titulo: 'Diversidad de tipos de foto',
        evaluar: (p) => {
          const t = p.tiposDeFoto;
          if (!t) return { ratio: null, estado: 'nd', evidencia: 'Requiere revisión visual del perfil (fachada, interior, producto, equipo).' };
          const cubiertos = ['fachada', 'interior', 'producto', 'equipo'].filter(k => t[k]).length;
          return { ratio: cubiertos / 4, estado: cubiertos === 4 ? 'fuerte' : cubiertos >= 2 ? 'debil' : 'ausente',
                   evidencia: `${cubiertos}/4 tipos de foto cubiertos.` };
        },
        recomendacion: 'Cubrir los cuatro tipos: fachada (para que lo encuentren), interior (para que se animen a entrar), producto (para que decidan) y equipo (para que confíen).',
      },
    ],
  },
  {
    id: 'actividad',
    nombre: 'Actividad y frescura',
    peso: 10,
    descripcion: 'Publicar seguido es la señal más barata de "este negocio está vivo" que se le puede dar a Google.',
    reglas: [
      {
        id: 'posts_recientes', peso: 6, verificable: 'manual', servicio: 'contenido_posts', fuente: 'frecuencia_publicacion',
        titulo: 'Publicaciones (Novedades) recientes',
        evaluar: (p) => {
          if (p.postsUltimos30Dias == null) return { ratio: null, estado: 'nd', evidencia: 'Las publicaciones de perfiles de terceros no se exponen por API; requiere captura asistida.' };
          const n = p.postsUltimos30Dias;
          return { ratio: escalonar(n, [[4, 1], [2, 0.65], [1, 0.35]]),
                   estado: n >= 4 ? 'fuerte' : n >= 1 ? 'debil' : 'ausente',
                   evidencia: `${n} publicación(es) en los últimos 30 días.` };
        },
        recomendacion: 'Publicar 1 novedad por semana alternando Novedad, Oferta y Evento. Es el ítem con mejor relación esfuerzo/impacto de toda la lista.',
      },
      {
        id: 'ofertas_activas', peso: 4, verificable: 'manual', servicio: 'contenido_posts', fuente: 'frecuencia_publicacion',
        titulo: 'Ofertas o eventos activos',
        evaluar: (p) => {
          if (p.ofertasActivas == null) return { ratio: null, estado: 'nd', evidencia: 'Requiere captura asistida del perfil.' };
          return p.ofertasActivas > 0
            ? { ratio: 1, estado: 'fuerte', evidencia: `${p.ofertasActivas} oferta(s)/evento(s) vigente(s).` }
            : { ratio: 0, estado: 'ausente', evidencia: 'Sin ofertas ni eventos vigentes.' };
        },
        recomendacion: 'Mantener siempre al menos una oferta vigente. Ocupa espacio visual en el perfil y da un motivo concreto para elegir hoy y no mañana.',
      },
    ],
  },
  {
    id: 'conversion',
    nombre: 'Conversión y atención',
    peso: 15,
    descripcion: 'De nada sirve aparecer si el perfil no ofrece un camino claro para contactar, reservar o comprar.',
    reglas: [
      {
        id: 'chat_mensajes', peso: 3, verificable: 'manual', servicio: 'conversion_perfil', fuente: 'completitud_clicks',
        titulo: 'Canal de mensajería activo',
        evaluar: (p) => {
          if (p.mensajeriaActiva == null) return { ratio: null, estado: 'nd', evidencia: 'Requiere verificación en el perfil (botón de chat / WhatsApp).' };
          return p.mensajeriaActiva
            ? { ratio: 1, estado: 'fuerte', evidencia: 'Canal de mensajería habilitado.' }
            : { ratio: 0, estado: 'ausente', evidencia: 'Sin canal de mensajería en el perfil.' };
        },
        recomendacion: 'Habilitar el enlace de chat (idealmente a WhatsApp). Captura a quien no quiere llamar por teléfono, que hoy es la mayoría.',
      },
      {
        id: 'reservas_pedidos', peso: 3, verificable: 'manual', servicio: 'conversion_perfil', fuente: 'completitud_clicks',
        titulo: 'Reservas / pedidos / turnos',
        evaluar: (p) => {
          if (p.reservasActivas == null) return { ratio: null, estado: 'nd', evidencia: 'Requiere verificación en el perfil.' };
          return p.reservasActivas
            ? { ratio: 1, estado: 'fuerte', evidencia: 'Enlace de reserva/pedido activo.' }
            : { ratio: 0, estado: 'ausente', evidencia: 'Sin enlace de reserva, turno o pedido.' };
        },
        recomendacion: 'Conectar el sistema de turnos o pedidos al perfil, para que la conversión ocurra dentro de Google sin fricción intermedia.',
      },
      {
        id: 'servicios_cargados', peso: 4, verificable: 'auto', servicio: 'setup_perfil', fuente: 'categoria_descubrimiento',
        titulo: 'Catálogo de servicios o menú',
        evaluar: (p) => {
          const n = (p.servicios || []).length;
          return { ratio: escalonar(n, [[10, 1], [5, 0.7], [1, 0.35]]),
                   estado: n >= 10 ? 'fuerte' : n >= 1 ? 'debil' : 'ausente',
                   evidencia: `${n} servicio(s)/ítem(s) cargado(s).` };
        },
        recomendacion: 'Cargar cada servicio como ítem propio con nombre, descripción y precio o rango. Cada ítem es una consulta más por la que el negocio puede aparecer.',
      },
      {
        id: 'atributos', peso: 3, verificable: 'auto', servicio: 'setup_perfil', fuente: 'completitud_clicks',
        titulo: 'Atributos del negocio',
        evaluar: (p) => {
          const n = (p.atributos || []).length;
          return { ratio: escalonar(n, [[8, 1], [4, 0.7], [1, 0.35]]),
                   estado: n >= 8 ? 'fuerte' : n >= 1 ? 'debil' : 'ausente',
                   evidencia: `${n} atributo(s) declarado(s).` };
        },
        recomendacion: 'Completar accesibilidad, medios de pago, estacionamiento y amenities. Google los usa como filtros de búsqueda: sin ellos el negocio queda fuera de esos resultados.',
      },
      {
        id: 'estado_operativo', peso: 2, verificable: 'auto', servicio: 'setup_perfil', fuente: 'horarios_2026',
        titulo: 'Estado operativo del perfil',
        evaluar: (p) => {
          if (p.estado === 'OPERATIONAL') return { ratio: 1, estado: 'fuerte', evidencia: 'Perfil marcado como operativo.' };
          if (!p.estado) return { ratio: null, estado: 'nd', evidencia: 'Estado no informado.' };
          return { ratio: 0, estado: 'ausente', evidencia: `Perfil marcado como "${p.estado}": Google lo está degradando o directamente ocultando.` };
        },
        recomendacion: 'Corregir el estado del perfil de inmediato. Un perfil marcado como cerrado temporal o permanentemente pierde casi toda su visibilidad.',
      },
    ],
  },
  {
    id: 'presencia',
    nombre: 'Presencia digital extendida',
    peso: 15,
    descripcion: 'Lo que pasa fuera del perfil y que Google usa para validar que el negocio es real y relevante.',
    reglas: [
      {
        id: 'sitio_accesible', peso: 5, verificable: 'auto', servicio: 'seo_local_web', fuente: 'peso_senales',
        titulo: 'Sitio web accesible y móvil',
        evaluar: (p) => {
          const w = p.web;
          if (!p.sitioWeb) return { ratio: 0, estado: 'ausente', evidencia: 'No hay sitio web para evaluar.' };
          if (!w) return { ratio: null, estado: 'nd', evidencia: 'No se pudo analizar el sitio web.' };
          if (!w.ok) return { ratio: 0, estado: 'ausente', evidencia: `El sitio no responde correctamente (HTTP ${w.status || 'error'}).` };
          let r = 0.5;
          if (w.viewport) r += 0.25;
          if (w.https) r += 0.25;
          return { ratio: r, estado: r >= 1 ? 'fuerte' : 'debil',
                   evidencia: `Sitio responde ${w.status}. HTTPS: ${w.https ? 'sí' : 'no'}. Viewport móvil: ${w.viewport ? 'sí' : 'no'}.` };
        },
        recomendacion: 'Garantizar HTTPS, carga rápida y diseño móvil. El tráfico de Maps es casi todo móvil: un sitio que no carga rompe la conversión justo después de haberla ganado.',
      },
      {
        id: 'nap_coherente', peso: 4, verificable: 'auto', servicio: 'citations', fuente: 'nap_citations',
        titulo: 'Coherencia NAP entre perfil y sitio',
        evaluar: (p) => {
          const w = p.web;
          if (!w || w.napTelefono == null) return { ratio: null, estado: 'nd', evidencia: 'No se pudo contrastar el NAP con el sitio.' };
          const aciertos = [w.napTelefono, w.napDireccion].filter(Boolean).length;
          return { ratio: aciertos / 2, estado: aciertos === 2 ? 'fuerte' : aciertos === 1 ? 'debil' : 'ausente',
                   evidencia: `Teléfono coincide: ${w.napTelefono ? 'sí' : 'no'}. Dirección coincide: ${w.napDireccion ? 'sí' : 'no'}.` };
        },
        recomendacion: 'Unificar nombre, dirección y teléfono exactos entre el perfil, el sitio y los directorios. Las discrepancias diluyen la confianza que Google le asigna al negocio.',
      },
      {
        id: 'redes_enlazadas', peso: 4, verificable: 'auto', servicio: 'redes_sociales', fuente: 'ia_social',
        titulo: 'Redes sociales enlazadas y activas',
        evaluar: (p) => {
          const r = p.redes || {};
          const n = Object.values(r).filter(Boolean).length;
          return { ratio: escalonar(n, [[3, 1], [2, 0.7], [1, 0.4]]),
                   estado: n >= 3 ? 'fuerte' : n >= 1 ? 'debil' : 'ausente',
                   evidencia: n ? `Redes detectadas: ${Object.keys(r).filter(k => r[k]).join(', ')}.` : 'No se detectaron redes sociales enlazadas.' };
        },
        recomendacion: 'Enlazar Instagram, Facebook y las redes propias del rubro desde el perfil y desde el sitio. En 2026 las señales sociales entraron formalmente al algoritmo local.',
      },
      {
        id: 'datos_estructurados', peso: 2, verificable: 'auto', servicio: 'aeo_ia', fuente: 'ia_social',
        titulo: 'Datos estructurados LocalBusiness',
        evaluar: (p) => {
          const w = p.web;
          if (!w || w.schemaLocalBusiness == null) return { ratio: null, estado: 'nd', evidencia: 'No se pudo analizar el marcado del sitio.' };
          return w.schemaLocalBusiness
            ? { ratio: 1, estado: 'fuerte', evidencia: 'El sitio declara marcado LocalBusiness.' }
            : { ratio: 0, estado: 'ausente', evidencia: 'El sitio no declara marcado LocalBusiness (schema.org).' };
        },
        recomendacion: 'Agregar JSON-LD de LocalBusiness con NAP, horarios y geolocalización. Es lo que leen los asistentes de IA cuando deciden a quién citar.',
      },
    ],
  },
];

export const TOTAL_PESO = DIMENSIONES.reduce((a, d) => a + d.peso, 0); // 100
