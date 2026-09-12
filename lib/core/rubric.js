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
 *  - Cada regla declara `evidente`: si el dueño entiende el hallazgo sin que nadie
 *    se lo explique y le molesta (true), o si es una técnica avanzada (false).
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
 * Cada regla: { id, peso, evidente, evaluar(p) -> { ratio 0..1, estado, evidencia } }
 */

const escalonar = (valor, escalones) => {
  for (const [umbral, ratio] of escalones) if (valor >= umbral) return ratio;
  return 0;
};

const plural = (n, singular, pluralStr) => `${n} ${n === 1 ? singular : pluralStr}`;

export const DIMENSIONES = [
  {
    id: 'fundamentos',
    nombre: 'Fundamentos del perfil',
    peso: 20,
    descripcion: 'Los datos base que Google usa para entender qué es el negocio y cuándo mostrarlo.',
    reglas: [
      {
        id: 'categoria_primaria', peso: 5, evidente: false, verificable: 'auto', servicio: 'setup_perfil', fuente: 'categoria_descubrimiento',
        titulo: 'Categoría primaria específica',
        evaluar: (p) => {
          if (!p.categoriaPrimaria) return { ratio: 0, estado: 'ausente', evidencia: 'No se detectó categoría primaria.' };
          const generica = /establishment|point_of_interest|store|food|business|local_business/i.test(p.categoriaPrimaria);
          if (generica) return { ratio: 0.35, estado: 'debil', evidencia: `Categoría "${p.categoriaPrimariaLabel || p.categoriaPrimaria}" es demasiado genérica.` };
          return { ratio: 1, estado: 'fuerte', evidencia: `Categoría primaria: ${p.categoriaPrimariaLabel || p.categoriaPrimaria}.` };
        },
        recomendacion: 'Definir la categoría primaria más específica que exista para el rubro y usarla como eje de todo el perfil. Las secundarias se suman después, nunca antes.',
        comoSeArregla: {
          donde: 'Perfil de negocio en Google Maps › Editar perfil › Categoría de negocio',
          pasos: [
            'Buscá tu negocio en Google y hacé clic en "Editar perfil".',
            'Seleccioná "Categoría de negocio" y elegí la categoría primaria más específica.',
            'Guardá los cambios.'
          ],
          minutos: 3,
        },
      },
      {
        id: 'categorias_secundarias', peso: 3, evidente: false, verificable: 'auto', servicio: 'setup_perfil', fuente: 'categoria_descubrimiento',
        titulo: 'Categorías secundarias',
        evaluar: (p) => {
          const n = (p.categoriasSecundarias || []).length;
          return { ratio: escalonar(n, [[4, 1], [2, 0.7], [1, 0.4]]), estado: n >= 4 ? 'fuerte' : n >= 1 ? 'debil' : 'ausente',
                   evidencia: `${plural(n, 'categoría secundaria declarada', 'categorías secundarias declaradas')}.` };
        },
        recomendacion: 'Sumar entre 4 y 9 categorías secundarias reales (Google permite hasta 10 en total). Cada una abre una consulta nueva por la que el negocio puede aparecer.',
        comoSeArregla: {
          donde: 'Perfil de negocio en Google Maps › Editar perfil › Categoría de negocio',
          pasos: [
            'Ingresá a "Editar perfil" y abrí "Categoría de negocio".',
            'Hacé clic en "Agregar otra categoría" para sumar categorías secundarias reales.',
            'Guardá los cambios.'
          ],
          minutos: 5,
        },
      },
      {
        id: 'telefono', peso: 2, evidente: true, verificable: 'auto', servicio: 'setup_perfil', fuente: 'completitud_clicks',
        titulo: 'Teléfono cargado',
        evaluar: (p) => p.telefono
          ? { ratio: 1, estado: 'fuerte', evidencia: `Teléfono público: ${p.telefono}.` }
          : { ratio: 0, estado: 'ausente', evidencia: 'Sin teléfono público en el perfil.' },
        recomendacion: 'Cargar un teléfono local atendido. El clic en "Llamar" es la conversión más directa de Maps y sin número simplemente no existe.',
        comoSeArregla: {
          donde: 'Perfil de negocio en Google Maps › Editar perfil › Información de contacto',
          pasos: [
            'Abrí "Editar perfil" en tu panel de Google.',
            'Buscá el campo "Teléfono" e ingresá el número de contacto principal.',
            'Guardá los cambios.'
          ],
          minutos: 2,
        },
      },
      {
        id: 'sitio_web', peso: 3, evidente: true, verificable: 'auto', servicio: 'seo_local_web', fuente: 'peso_senales',
        titulo: 'Sitio web enlazado',
        evaluar: (p) => p.sitioWeb
          ? { ratio: 1, estado: 'fuerte', evidencia: `Sitio enlazado: ${p.sitioWeb}.` }
          : { ratio: 0, estado: 'ausente', evidencia: 'El perfil no enlaza ningún sitio web.' },
        recomendacion: 'Enlazar un sitio o al menos una landing propia. El sitio pesa ~19% del algoritmo local; sin él ese porcentaje se pierde entero.',
        comoSeArregla: {
          donde: 'Perfil de negocio en Google Maps › Editar perfil › Sitio web',
          pasos: [
            'Entrá a "Editar perfil" en tu panel de Google.',
            'Hacé clic en "Sitio web" y pegá la URL de tu página o landing.',
            'Guardá los cambios.'
          ],
          minutos: 2,
        },
      },
      {
        id: 'horarios', peso: 4, evidente: true, verificable: 'auto', servicio: 'setup_perfil', fuente: 'horarios_2026',
        titulo: 'Horarios completos y coherentes',
        evaluar: (p) => {
          const dias = (p.horarios || []).length;
          if (!dias) return { ratio: 0, estado: 'ausente', evidencia: 'Sin horarios cargados.' };
          if (dias < 7) return { ratio: 0.5, estado: 'debil', evidencia: `Solo ${dias} de 7 días con horario definido.` };
          return { ratio: 1, estado: 'fuerte', evidencia: 'Los 7 días tienen horario definido.' };
        },
        recomendacion: 'Cubrir los 7 días (incluido "Cerrado" explícito). En 2026 el estado "abierto ahora" es factor de ranking en el momento exacto de la búsqueda.',
        comoSeArregla: {
          donde: 'Perfil de negocio en Google Maps › Editar perfil › Horario',
          pasos: [
            'Entrá a "Editar perfil" y seleccioná "Horario".',
            'Configurá los horarios exactos de apertura y cierre para cada día de la semana.',
            'Guardá los cambios.'
          ],
          minutos: 5,
        },
      },
      {
        id: 'horarios_especiales', peso: 2, evidente: true, verificable: 'auto', servicio: 'setup_perfil', fuente: 'horarios_2026',
        titulo: 'Horarios especiales / feriados',
        evaluar: (p) => (p.horariosEspeciales || []).length > 0
          ? { ratio: 1, estado: 'fuerte', evidencia: `${plural(p.horariosEspeciales.length, 'fecha especial cargada', 'fechas especiales cargadas')}.` }
          : { ratio: 0, estado: 'ausente', evidencia: 'Sin horarios especiales cargados para feriados.' },
        recomendacion: 'Cargar feriados y fechas atípicas con anticipación. Un cliente que llega y encuentra cerrado suele dejar una reseña negativa: es el error más caro y más barato de evitar.',
        comoSeArregla: {
          donde: 'Perfil de negocio en Google Maps › Editar perfil › Horarios especiales',
          pasos: [
            'En "Editar perfil", seleccioná "Horarios especiales".',
            'Agregá las fechas de feriados o eventos especiales.',
            'Definí si el negocio abre o permanece cerrado y guardá los cambios.'
          ],
          minutos: 5,
        },
      },
      {
        id: 'descripcion', peso: 1, evidente: false, verificable: 'auto', servicio: 'setup_perfil', fuente: 'completitud_clicks',
        titulo: 'Descripción del negocio',
        evaluar: (p) => {
          const n = (p.descripcion || '').length;
          return { ratio: escalonar(n, [[600, 1], [250, 0.6], [1, 0.3]]), estado: n >= 600 ? 'fuerte' : n > 0 ? 'debil' : 'ausente',
                   evidencia: n ? `Descripción de ${n} caracteres.` : 'Sin descripción.' };
        },
        recomendacion: 'Escribir 600-750 caracteres describiendo servicios, zona de cobertura y diferencial, en el lenguaje que usa el cliente al buscar.',
        comoSeArregla: {
          donde: 'Perfil de negocio en Google Maps › Editar perfil › Descripción del negocio',
          pasos: [
            'Entrá a "Editar perfil" y hacé clic en "Descripción".',
            'Redactá un texto de entre 600 y 750 caracteres sobre tus servicios y diferencial.',
            'Guardá los cambios.'
          ],
          minutos: 10,
        },
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
        id: 'volumen_resenas', peso: 8, evidente: true, verificable: 'auto', servicio: 'captacion_resenas', fuente: 'umbral_resenas',
        titulo: 'Volumen de reseñas',
        evaluar: (p) => {
          const n = p.cantidadResenas || 0;
          const ratio = escalonar(n, [[150, 1], [80, 0.9], [40, 0.75], [20, 0.55], [10, 0.35], [1, 0.15]]);
          return { ratio, estado: n >= 80 ? 'fuerte' : n >= 20 ? 'ok' : n >= 1 ? 'debil' : 'ausente',
                   evidencia: `${plural(n, 'reseña publicada', 'reseñas publicadas')}.` };
        },
        recomendacion: 'Instalar un sistema de pedido de reseñas post-atención. El objetivo operativo es superar primero las 10 (piso de credibilidad) y después sostener un flujo constante.',
        comoSeArregla: {
          donde: 'Perfil de negocio en Google Maps › Solicitar opiniones',
          pasos: [
            'Hacé clic en "Solicitar opiniones" en tu panel.',
            'Copiá el enlace corto que genera Google.',
            'Compartilo por WhatsApp o email con tus clientes al finalizar la atención.'
          ],
          minutos: 5,
        },
      },
      {
        id: 'rating', peso: 7, evidente: true, verificable: 'auto', servicio: 'gestion_resenas', fuente: 'peso_senales',
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
        comoSeArregla: {
          donde: 'Perfil de negocio en Google Maps › Leer opiniones',
          pasos: [
            'Revisá las opiniones negativas recibidas para detectar problemas recurrentes de servicio.',
            'Solucioná los inconvenientes señalados por los clientes.',
            'Enviá la solicitud de opinión prioritariamente a tus clientes más satisfechos.'
          ],
          minutos: 15,
        },
      },
      {
        id: 'velocidad_resenas', peso: 5, evidente: true, verificable: 'auto', servicio: 'captacion_resenas', fuente: 'peso_senales',
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
        comoSeArregla: {
          donde: 'Perfil de negocio en Google Maps › Solicitar opiniones',
          pasos: [
            'Copiá tu enlace corto de solicitud de opiniones.',
            'Enviá el enlace de forma constante a los clientes atendidos cada semana.',
            'Mantené un ritmo de al menos 2 a 4 opiniones nuevas por mes.'
          ],
          minutos: 5,
        },
      },
      {
        id: 'tasa_respuesta', peso: 5, evidente: true, verificable: 'auto', servicio: 'gestion_resenas', fuente: 'respuesta_resenas',
        titulo: 'Respuesta del dueño a las reseñas',
        evaluar: (p) => {
          if (p.tasaRespuestaResenas == null) return { ratio: null, estado: 'nd', evidencia: 'No se pudo medir la tasa de respuesta.' };
          const t = p.tasaRespuestaResenas;
          return { ratio: escalonar(t, [[0.9, 1], [0.6, 0.75], [0.3, 0.45], [0.01, 0.2]]),
                   estado: t >= 0.9 ? 'fuerte' : t >= 0.3 ? 'debil' : 'ausente',
                   evidencia: `${Math.round(t * 100)}% de las reseñas analizadas tienen respuesta del dueño.` };
        },
        recomendacion: 'Responder el 100% de las reseñas dentro de 24-48 hs, también las positivas. Es la señal de servicio más visible y la más barata de dar.',
        comoSeArregla: {
          donde: 'Perfil de negocio en Google Maps › Leer opiniones',
          pasos: [
            'Entrá a la sección "Opiniones" en tu panel.',
            'Buscá las opiniones que aún no tienen respuesta.',
            'Escribí una respuesta personalizada y educada para cada una y publicala.'
          ],
          minutos: 10,
        },
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
        id: 'cantidad_fotos', peso: 6, evidente: true, verificable: 'auto', servicio: 'fotografia', fuente: 'fotos_conversion',
        titulo: 'Cantidad de fotos',
        evaluar: (p) => {
          const n = p.cantidadFotos || 0;
          return { ratio: escalonar(n, [[50, 1], [25, 0.85], [12, 0.6], [5, 0.35], [1, 0.15]]),
                   estado: n >= 25 ? 'fuerte' : n >= 5 ? 'debil' : 'ausente',
                   evidencia: `${plural(n, 'foto asociada al perfil', 'fotos asociadas al perfil')}.` };
        },
        recomendacion: 'Llegar a un mínimo de 25 fotos propias y sostener 5 nuevas por trimestre. Las fotos del negocio pesan más que las subidas por usuarios.',
        comoSeArregla: {
          donde: 'Perfil de negocio en Google Maps › Agregar foto',
          pasos: [
            'Hacé clic en "Agregar foto" en el panel.',
            'Seleccioná imágenes nítidas de tu local, equipo y productos.',
            'Publicá las fotos y repetí la carga periódicamente.'
          ],
          minutos: 10,
        },
      },
      {
        id: 'frescura_fotos', peso: 5, evidente: true, verificable: 'manual', servicio: 'fotografia', fuente: 'frecuencia_publicacion',
        titulo: 'Frescura de las fotos',
        evaluar: (p) => {
          if (p.diasDesdeUltimaFoto == null) return { ratio: null, estado: 'nd', evidencia: 'La API pública no expone la fecha de carga de las fotos; requiere verificación en el panel del negocio.' };
          const d = p.diasDesdeUltimaFoto;
          return { ratio: escalonar(-d, [[-30, 1], [-90, 0.7], [-180, 0.35]]),
                   estado: d <= 30 ? 'fuerte' : d <= 90 ? 'ok' : 'debil',
                   evidencia: `Última foto hace ${d} días.` };
        },
        recomendacion: 'Cargar fotos con cadencia trimestral como mínimo. Un perfil con fotos de hace dos años comunica un negocio que quizá ya no existe.',
        comoSeArregla: {
          donde: 'Perfil de negocio en Google Maps › Agregar foto',
          pasos: [
            'Ingresá a "Agregar foto" en tu panel.',
            'Subí imágenes recientes de tus últimos trabajos o novedades.',
            'Establecé un recordatorio para subir fotos nuevas al menos una vez al mes.'
          ],
          minutos: 5,
        },
      },
      {
        id: 'diversidad_fotos', peso: 4, evidente: true, verificable: 'manual', servicio: 'fotografia', fuente: 'fotos_conversion',
        titulo: 'Diversidad de tipos de foto',
        evaluar: (p) => {
          const t = p.tiposDeFoto;
          if (!t) return { ratio: null, estado: 'nd', evidencia: 'Requiere revisión visual del perfil (fachada, interior, producto, equipo).' };
          const cubiertos = ['fachada', 'interior', 'producto', 'equipo'].filter(k => t[k]).length;
          return { ratio: cubiertos / 4, estado: cubiertos === 4 ? 'fuerte' : cubiertos >= 2 ? 'debil' : 'ausente',
                   evidencia: `${cubiertos}/4 tipos de foto cubiertos.` };
        },
        recomendacion: 'Cubrir los cuatro tipos: fachada (para que lo encuentren), interior (para que se animen a entrar), producto (para que decidan) y equipo (para que confíen).',
        comoSeArregla: {
          donde: 'Perfil de negocio en Google Maps › Agregar foto',
          pasos: [
            'Hacé clic en "Agregar foto" en tu panel.',
            'Cargá fotos representativas de cada categoría: fachada, interior, productos y equipo.',
            'Publicá al menos 2 imágenes de cada tipo.'
          ],
          minutos: 15,
        },
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
        id: 'posts_recientes', peso: 6, evidente: false, verificable: 'manual', servicio: 'contenido_posts', fuente: 'frecuencia_publicacion',
        titulo: 'Publicaciones (Novedades) recientes',
        evaluar: (p) => {
          if (p.postsUltimos30Dias == null) return { ratio: null, estado: 'nd', evidencia: 'Las publicaciones de perfiles de terceros no se exponen por API; requiere captura asistida.' };
          const n = p.postsUltimos30Dias;
          return { ratio: escalonar(n, [[4, 1], [2, 0.65], [1, 0.35]]),
                   estado: n >= 4 ? 'fuerte' : n >= 1 ? 'debil' : 'ausente',
                   evidencia: `${plural(n, 'publicación en los últimos 30 días', 'publicaciones en los últimos 30 días')}.` };
        },
        recomendacion: 'Publicar 1 novedad por semana alternando Novedad, Oferta y Evento. Es el ítem con mejor relación esfuerzo/impacto de toda la lista.',
        comoSeArregla: {
          donde: 'Perfil de negocio en Google Maps › Añadir actualización',
          pasos: [
            'Hacé clic en "Añadir actualización" en tu panel.',
            'Escribí un mensaje breve, sumá una foto atractiva y elegí un botón de acción.',
            'Publicá la novedad.'
          ],
          minutos: 10,
        },
      },
      {
        id: 'ofertas_activas', peso: 4, evidente: false, verificable: 'manual', servicio: 'contenido_posts', fuente: 'frecuencia_publicacion',
        titulo: 'Ofertas o eventos activos',
        evaluar: (p) => {
          if (p.ofertasActivas == null) return { ratio: null, estado: 'nd', evidencia: 'Requiere captura asistida del perfil.' };
          return p.ofertasActivas > 0
            ? { ratio: 1, estado: 'fuerte', evidencia: `${plural(p.ofertasActivas, 'oferta u evento vigente', 'ofertas u eventos vigentes')}.` }
            : { ratio: 0, estado: 'ausente', evidencia: 'Sin ofertas ni eventos vigentes.' };
        },
        recomendacion: 'Mantener siempre al menos una oferta vigente. Ocupa espacio visual en el perfil y da un motivo concreto para elegir hoy y no mañana.',
        comoSeArregla: {
          donde: 'Perfil de negocio en Google Maps › Añadir actualización › Añadir oferta',
          pasos: [
            'Hacé clic en "Añadir actualización" y seleccioná "Añadir oferta".',
            'Ingresá el título de la oferta, las fechas de validez y una foto.',
            'Publicá la oferta.'
          ],
          minutos: 10,
        },
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
        id: 'chat_mensajes', peso: 3, evidente: false, verificable: 'manual', servicio: 'conversion_perfil', fuente: 'completitud_clicks',
        titulo: 'Canal de mensajería activo',
        evaluar: (p) => {
          if (p.mensajeriaActiva == null) return { ratio: null, estado: 'nd', evidencia: 'Requiere verificación en el perfil (botón de chat / WhatsApp).' };
          return p.mensajeriaActiva
            ? { ratio: 1, estado: 'fuerte', evidencia: 'Canal de mensajería habilitado.' }
            : { ratio: 0, estado: 'ausente', evidencia: 'Sin canal de mensajería en el perfil.' };
        },
        recomendacion: 'Habilitar el enlace de chat (idealmente a WhatsApp). Captura a quien no quiere llamar por teléfono, que hoy es la mayoría.',
        comoSeArregla: {
          donde: 'Perfil de negocio en Google Maps › Mensajes',
          pasos: [
            'Ingresá a "Mensajes" en tu panel de Google.',
            'Activá la opción de mensajería/chat.',
            'Configura las notificaciones para responder de forma rápida.'
          ],
          minutos: 5,
        },
      },
      {
        id: 'reservas_pedidos', peso: 3, evidente: false, verificable: 'manual', servicio: 'conversion_perfil', fuente: 'completitud_clicks',
        titulo: 'Reservas / pedidos / turnos',
        evaluar: (p) => {
          if (p.reservasActivas == null) return { ratio: null, estado: 'nd', evidencia: 'Requiere verificación en el perfil.' };
          return p.reservasActivas
            ? { ratio: 1, estado: 'fuerte', evidencia: 'Enlace de reserva/pedido activo.' }
            : { ratio: 0, estado: 'ausente', evidencia: 'Sin enlace de reserva, turno o pedido.' };
        },
        recomendacion: 'Conectar el sistema de turnos o pedidos al perfil, para que la conversión ocurra dentro de Google sin fricción intermedia.',
        comoSeArregla: {
          donde: 'Perfil de negocio en Google Maps › Reservas / Pedidos',
          pasos: [
            'Entrá a "Reservas" o "Hacer un pedido" en tu panel.',
            'Vinculá tu plataforma de gestión o agregá el enlace a tu sitio.',
            'Guardá los cambios.'
          ],
          minutos: 10,
        },
      },
      {
        id: 'servicios_cargados', peso: 4, evidente: false, verificable: 'auto', servicio: 'setup_perfil', fuente: 'categoria_descubrimiento',
        titulo: 'Catálogo de servicios o menú',
        evaluar: (p) => {
          const n = (p.servicios || []).length;
          return { ratio: escalonar(n, [[10, 1], [5, 0.7], [1, 0.35]]),
                   estado: n >= 10 ? 'fuerte' : n >= 1 ? 'debil' : 'ausente',
                   evidencia: `${plural(n, 'servicio cargado', 'servicios cargados')}.` };
        },
        recomendacion: 'Cargar cada servicio como ítem propio con nombre, descripción y precio o rango. Cada ítem es una consulta más por la que el negocio puede aparecer.',
        comoSeArregla: {
          donde: 'Perfil de negocio en Google Maps › Editar servicios',
          pasos: [
            'Hacé clic en "Editar servicios" en tu panel.',
            'Agregá los servicios que prestás organizados por categoría.',
            'Completá la descripción y precio estimado de cada uno y guardá.'
          ],
          minutos: 15,
        },
      },
      {
        id: 'atributos', peso: 3, evidente: false, verificable: 'auto', servicio: 'setup_perfil', fuente: 'completitud_clicks',
        titulo: 'Atributos del negocio',
        evaluar: (p) => {
          const n = (p.atributos || []).length;
          return { ratio: escalonar(n, [[8, 1], [4, 0.7], [1, 0.35]]),
                   estado: n >= 8 ? 'fuerte' : n >= 1 ? 'debil' : 'ausente',
                   evidencia: `${plural(n, 'atributo declarado', 'atributos declarados')}.` };
        },
        recomendacion: 'Completar accesibilidad, medios de pago, estacionamiento y amenities. Google los usa como filtros de búsqueda: sin ellos el negocio queda fuera de esos resultados.',
        comoSeArregla: {
          donde: 'Perfil de negocio en Google Maps › Editar perfil › Más información',
          pasos: [
            'Entrá a "Editar perfil" y abrí "Más información" (Atributos).',
            'Revisá y marcá las opciones correspondientes a pagos, accesibilidad y servicios.',
            'Guardá los cambios.'
          ],
          minutos: 5,
        },
      },
      {
        id: 'estado_operativo', peso: 2, evidente: true, verificable: 'auto', servicio: 'setup_perfil', fuente: 'horarios_2026',
        titulo: 'Estado operativo del perfil',
        evaluar: (p) => {
          if (p.estado === 'OPERATIONAL') return { ratio: 1, estado: 'fuerte', evidencia: 'Perfil marcado como operativo.' };
          if (!p.estado) return { ratio: null, estado: 'nd', evidencia: 'Estado no informado.' };
          return { ratio: 0, estado: 'ausente', evidencia: `Perfil marcado como "${p.estado}": Google lo está degradando o directamente ocultando.` };
        },
        recomendacion: 'Corregir el estado del perfil de inmediato. Un perfil marcado como cerrado temporal o permanentemente pierde casi toda su visibilidad.',
        comoSeArregla: {
          donde: 'Perfil de negocio en Google Maps › Editar perfil › Horario',
          pasos: [
            'Entrá a "Editar perfil" en tu panel.',
            'Verificá el estado del negocio y asegurate de que figure como "Abierto habitualmente".',
            'Guardá los cambios.'
          ],
          minutos: 3,
        },
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
        id: 'sitio_accesible', peso: 5, evidente: true, verificable: 'auto', servicio: 'seo_local_web', fuente: 'peso_senales',
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
        comoSeArregla: {
          donde: 'Panel de administración de tu sitio web (CMS / Hosting)',
          pasos: [
            'Asegurate de tener instalado un certificado de seguridad HTTPS (SSL).',
            'Comprobá que el diseño de tu página se adapte correctamente a pantallas de celulares.',
            'Optimizá las imágenes para asegurar una carga rápida.'
          ],
          minutos: 30,
        },
      },
      {
        id: 'nap_coherente', peso: 4, evidente: true, verificable: 'auto', servicio: 'citations', fuente: 'nap_citations',
        titulo: 'Coherencia NAP entre perfil y sitio',
        evaluar: (p) => {
          const w = p.web;
          if (!w || w.napTelefono == null) return { ratio: null, estado: 'nd', evidencia: 'No se pudo contrastar el NAP con el sitio.' };
          const aciertos = [w.napTelefono, w.napDireccion].filter(Boolean).length;
          return { ratio: aciertos / 2, estado: aciertos === 2 ? 'fuerte' : aciertos === 1 ? 'debil' : 'ausente',
                   evidencia: `Teléfono coincide: ${w.napTelefono ? 'sí' : 'no'}. Dirección coincide: ${w.napDireccion ? 'sí' : 'no'}.` };
        },
        recomendacion: 'Unificar nombre, dirección y teléfono exactos entre el perfil, el sitio y los directorios. Las discrepancias diluyen la confianza que Google le asigna al negocio.',
        comoSeArregla: {
          donde: 'Sitio web propio y perfiles digitales',
          pasos: [
            'Revisá el Nombre, Dirección y Teléfono publicados en el pie de página de tu web.',
            'Verificá que coincidan exactamente con la información cargada en Google Maps.',
            'Corregí cualquier diferencia en números, calles o nombres.'
          ],
          minutos: 15,
        },
      },
      {
        id: 'redes_enlazadas', peso: 4, evidente: false, verificable: 'auto', servicio: 'redes_sociales', fuente: 'ia_social',
        titulo: 'Redes sociales enlazadas y activas',
        evaluar: (p) => {
          const r = p.redes || {};
          const n = Object.values(r).filter(Boolean).length;
          return { ratio: escalonar(n, [[3, 1], [2, 0.7], [1, 0.4]]),
                   estado: n >= 3 ? 'fuerte' : n >= 1 ? 'debil' : 'ausente',
                   evidencia: n ? `Redes detectadas: ${Object.keys(r).filter(k => r[k]).join(', ')}.` : 'No se detectaron redes sociales enlazadas.' };
        },
        recomendacion: 'Enlazar Instagram, Facebook y las redes propias del rubro desde el perfil y desde el sitio. En 2026 las señales sociales entraron formalmente al algoritmo local.',
        comoSeArregla: {
          donde: 'Perfil de negocio en Google Maps › Editar perfil › Redes sociales',
          pasos: [
            'Entrá a "Editar perfil" y abrí la sección de "Redes sociales".',
            'Agregá los enlaces directos a tus perfiles de Instagram, Facebook y otras redes.',
            'Guardá los cambios.'
          ],
          minutos: 5,
        },
      },
      {
        id: 'datos_estructurados', peso: 2, evidente: false, verificable: 'auto', servicio: 'aeo_ia', fuente: 'ia_social',
        titulo: 'Datos estructurados LocalBusiness',
        evaluar: (p) => {
          const w = p.web;
          if (!w || w.schemaLocalBusiness == null) return { ratio: null, estado: 'nd', evidencia: 'No se pudo analizar el marcado del sitio.' };
          return w.schemaLocalBusiness
            ? { ratio: 1, estado: 'fuerte', evidencia: 'El sitio declara marcado LocalBusiness.' }
            : { ratio: 0, estado: 'ausente', evidencia: 'El sitio no declara marcado LocalBusiness (schema.org).' };
        },
        recomendacion: 'Agregar JSON-LD de LocalBusiness con NAP, horarios y geolocalización. Es lo que leen los asistentes de IA cuando deciden a quién citar.',
        comoSeArregla: {
          donde: 'Código de tu sitio web (etiqueta <head>)',
          pasos: [
            'Generá el marcado de datos estructurados en formato JSON-LD para la categoría LocalBusiness.',
            'Insertá el bloque de código en la sección de encabezado (<head>) de tu sitio.',
            'Verificá la instalación con la herramienta de prueba de resultados enriquecidos de Google.'
          ],
          minutos: 20,
        },
      },
    ],
  },
];

/** Suma total del peso de las dimensiones de la rúbrica (100 puntos). */
export const TOTAL_PESO = DIMENSIONES.reduce((a, d) => a + d.peso, 0); // 100
