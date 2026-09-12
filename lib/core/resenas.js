/**
 * resenas.js — Análisis determinista sobre reseñas de clientes.
 *
 * Cruza el texto de las reseñas de muestra provistas por Google Maps contra
 * los campos declarados en la ficha del negocio (horarios, teléfono, dirección, servicios).
 *
 * REGLA DE ORO: No usa modelos de lenguaje ni altera el puntaje de la auditoría.
 * El puntaje sale exclusivamente de rubric.js.
 */

const L = 'A-Za-z0-9_áéíóúüñÁÉÍÓÚÜÑ';
const B = (cuerpo) => new RegExp(`(?<![${L}])(?:${cuerpo})(?![${L}])`, 'i');

// Patrones deterministas para cruce con campos
const RE_HORARIOS = B('(?:fui|llegué|llegue|pasé|pase|fueron|ir|estaba|estaban|encontré|encontre)\\b.*\\bcerrado|cerrado\\b.*(?:decía|decia|figura|google|map|maps|horario)|decía\\s+abierto|decia\\s+abierto|figura\\s+abierto|estaba\\s+cerrado|encontré\\s+cerrado|encontre\\s+cerrado|no\\s+abren|no\\s+abrieron');
const RE_TELEFONO = B('(?:teléfono|telefono|celular|número|numero|llamada|llamadas)\\s*(?:no\\s+atienden?|inválido|invalido|incorrecto|no\\s+existe|no\\s+funciona|erróneo|erroneo|da\\s+ocupado|fuera\\s+de\\s+servicio|está\\s+mal|esta\\s+mal|apagado)|(?:no\\s+atienden?|nadie\\s+atiende|no\\s+contestan?|no\\s+responden?)\\s*(?:el|al)?\\s*(?:teléfono|telefono|celular|llamadas)?|número\\s+equivocado|numero\\s+equivocado|teléfono\\s+equivocado|telefono\\s+equivocado');
const RE_DIRECCION = B('(?:dirección|direccion|ubicación|ubicacion|mapa|maps)\\s*(?:incorrecta|errónea|erronea|mal|falsa|no\\s+es|está\\s+mal|esta\\s+mal)|(?:no\\s+encontré|no\\s+encontre|no\\s+existe\\s+en|no\\s+está\\s+en|no\\s+esta\\s+en|no\\s+es\\s+ahí|no\\s+es\\s+ahi|llegué\\s+y\\s+no\\s+hay|imposible\\s+encontrar)\\s*(?:la\\s+dirección|la\\s+direccion|el\\s+lugar|el\\s+local)?|se\\s+mudaron|trasladaron|ya\\s+no\\s+está|ya\\s+no\\s+esta|cambió\\s+de\\s+dirección|cambio\\s+de\\s+direccion');
const RE_SERVICIOS = B('(?:no\\s+tienen?|no\\s+aceptan?|no\\s+reciben?|sin)\\s*(?:tarjeta|débito|debito|crédito|credito|mercadopago|mercado\\s+pago|efectivo|transferencia|delivery|envíos|envios|estacionamiento|wifi|factura|posnet)|(?:tarjeta|débito|debito|crédito|credito|mercadopago|mercado\\s+pago|delivery|envíos|envios|estacionamiento|posnet)\\s*(?:no\\s+tienen?|no\\s+aceptan?|no\\s+funciona|no\\s+hay)');

/**
 * Identifica reseñas cuyo texto contradice información del perfil.
 * Devuelve array de { cita, campo, fecha }.
 */
export function contradicciones(perfil) {
  if (!perfil || !Array.isArray(perfil.resenasMuestra) || !perfil.resenasMuestra.length) {
    return [];
  }

  const resultados = [];

  for (const r of perfil.resenasMuestra) {
    const texto = r.texto || '';
    if (!texto) continue;

    const camposHallados = new Set();

    if (RE_HORARIOS.test(texto)) camposHallados.add('horarios');
    if (RE_TELEFONO.test(texto)) camposHallados.add('telefono');
    if (RE_DIRECCION.test(texto)) camposHallados.add('direccion');
    if (RE_SERVICIOS.test(texto)) camposHallados.add('servicios');

    for (const campo of camposHallados) {
      resultados.push({
        cita: texto,
        campo,
        fecha: r.fecha || null,
      });
    }
  }

  return resultados;
}

// Lista de palabras vacías (stopwords) en castellano
const STOPWORDS = new Set([
  'a', 'al', 'algo', 'algunos', 'algunas', 'ante', 'antes', 'aquel', 'aquella', 'aquellos',
  'aquellas', 'aquello', 'aqui', 'aquí', 'arriba', 'asi', 'así', 'atencion', 'atención',
  'bajo', 'bien', 'buen', 'buena', 'buenas', 'bueno', 'buenos', 'cabe', 'cada', 'casi',
  'como', 'cómo', 'con', 'conmigo', 'conseguido', 'conseguir', 'consigo', 'contigo',
  'contra', 'cual', 'cuál', 'cuales', 'cuáles', 'cualquier', 'cuando', 'cuándo', 'cuanto',
  'cuánto', 'cuanta', 'cuánta', 'cuantos', 'cuántos', 'cuantas', 'cuántas', 'de', 'del',
  'demas', 'demás', 'desde', 'dia', 'día', 'dias', 'días', 'donde', 'dónde', 'dos',
  'el', 'él', 'ella', 'ellas', 'ello', 'ellos', 'en', 'encima', 'entonces', 'entre',
  'era', 'eramos', 'eran', 'eras', 'eres', 'es', 'esa', 'esas', 'ese', 'eso',
  'esos', 'esta', 'está', 'estaba', 'estabais', 'estaban', 'estabas', 'estad',
  'estada', 'estadas', 'estado', 'estados', 'estais', 'estamos', 'estan', 'están',
  'estar', 'estara', 'estará', 'estaran', 'estarán', 'estaras', 'estarás', 'estare',
  'estaré', 'estareis', 'estaréis', 'estaremos', 'estaria', 'estaría', 'estariais',
  'estaríais', 'estarian', 'estarían', 'estarias', 'estarías', 'este', 'esté',
  'esteis', 'estéis', 'estemos', 'esto', 'estos', 'estoy', 'estuve', 'estuviera',
  'estuvieran', 'estuvieras', 'estuvieron', 'estuviese', 'estuviesen', 'estuvieses',
  'estuvimos', 'estuviste', 'estuvisteis', 'estuvo', 'excelente', 'fase', 'fin',
  'fue', 'fueron', 'fui', 'fuimos', 'gran', 'grandes', 'ha', 'habia', 'había',
  'habiais', 'habíais', 'habiamo', 'habíamos', 'habian', 'habían', 'habias',
  'habías', 'habra', 'habrá', 'habran', 'habrán', 'habras', 'habrás', 'habre',
  'habré', 'habreis', 'habréis', 'habremos', 'habria', 'habría', 'habriais',
  'habríais', 'habrian', 'habrían', 'habrias', 'habrías', 'hace', 'haceis',
  'hacéis', 'hacemos', 'hacen', 'hacer', 'hacerlo', 'haces', 'hacia', 'haciendo',
  'hago', 'hasta', 'hay', 'haya', 'hayais', 'hayáis', 'hayamos', 'hayan',
  'hayas', 'he', 'hecho', 'hemos', 'hizo', 'hoy', 'la', 'las', 'le', 'les',
  'lo', 'los', 'lugar', 'mas', 'más', 'me', 'mes', 'meses', 'mi', 'mí', 'mia',
  'mía', 'mias', 'mías', 'mio', 'mío', 'mios', 'míos', 'mis', 'misma', 'mismas',
  'mismo', 'mismos', 'mucha', 'muchas', 'mucho', 'muchos', 'muy', 'nada', 'nadie',
  'ni', 'ningun', 'ningún', 'ninguna', 'ningunas', 'ninguno', 'ningunos', 'no',
  'nos', 'nosotras', 'nosotros', 'nuestra', 'nuestras', 'nuestro', 'nuestros',
  'nunca', 'o', 'os', 'otra', 'otras', 'otro', 'otros', 'para', 'pero', 'poco',
  'pocas', 'pocos', 'por', 'porque', 'que', 'qué', 'quien', 'quién',
  'quienes', 'quiénes', 'quieres', 'se', 'sea', 'seais', 'seáis',
  'seamos', 'sean', 'seas', 'segun', 'según', 'ser', 'sera', 'será', 'seran',
  'serán', 'seras', 'serás', 'sere', 'seré', 'sereis', 'seréis', 'seremos',
  'seria', 'sería', 'seriais', 'seríais', 'serian', 'serían', 'serias', 'serías',
  'servicio', 'si', 'sí', 'siempre', 'siendo', 'sin', 'sino', 'so', 'sobre',
  'sois', 'somos', 'son', 'soy', 'su', 'sus', 'suya', 'suyas', 'suyo', 'suyos',
  'tal', 'tambien', 'también', 'tan', 'tanto', 'te', 'tenia', 'tenía', 'teniais',
  'teníais', 'tenizamos', 'teníamos', 'tenian', 'tenían', 'tenias', 'tenías',
  'tenido', 'tendra', 'tendrá', 'tendran', 'tendrán', 'tendras', 'tendrás',
  'tendre', 'tendré', 'tendreis', 'tendréis', 'tendremos', 'tendria', 'tendría',
  'tendriais', 'tendríais', 'tendrian', 'tendrían', 'tendrias', 'tendrías',
  'tened', 'teneis', 'tenéis', 'tenemos', 'tener', 'tenga', 'tengais', 'tengáis',
  'tengamos', 'tengan', 'tengas', 'tengo', 'tengan', 'tiene', 'tienen', 'tienes',
  'toda', 'todas', 'todavia', 'todavía', 'todo', 'todos', 'tras', 'tu', 'tú',
  'tus', 'tuya', 'tuyas', 'tuyo', 'tuyos', 'tuviera', 'tuvieran', 'tuvieras',
  'tuvieron', 'tuviese', 'tuviesen', 'tuvieses', 'tuvimos', 'tuviste', 'tuvisteis',
  'tuvo', 'un', 'una', 'unas', 'uno', 'unos', 'usted', 'ustedes', 'va', 'vamos',
  'van', 'vaya', 'vez', 'veces', 'vosotras', 'vosotros', 'vuestra', 'vuestras',
  'vuestro', 'vuestros', 'y', 'ya', 'yo'
]);

/**
 * Identifica términos relevantes que aparecen en DOS O MÁS reseñas distintas.
 * Devuelve array de { tema, repeticiones }.
 */
export function temasRecurrentes(perfil) {
  if (!perfil || !Array.isArray(perfil.resenasMuestra) || !perfil.resenasMuestra.length) {
    return [];
  }

  const mapaTemas = new Map();

  perfil.resenasMuestra.forEach((r, idx) => {
    const texto = r.texto || '';
    if (!texto) return;

    const palabras = texto.match(new RegExp(`[${L}]+`, 'g')) || [];
    const vistasEnEstaResena = new Set();

    for (const rawWord of palabras) {
      const w = rawWord.toLowerCase();
      if (w.length <= 3) continue;
      if (/^\d+$/.test(w)) continue;
      if (STOPWORDS.has(w)) continue;

      vistasEnEstaResena.add(w);
    }

    vistasEnEstaResena.forEach(w => {
      if (!mapaTemas.has(w)) {
        mapaTemas.set(w, new Set());
      }
      mapaTemas.get(w).add(idx);
    });
  });

  const resultado = [];
  for (const [tema, resenasSet] of mapaTemas.entries()) {
    if (resenasSet.size >= 2) {
      resultado.push({
        tema,
        repeticiones: resenasSet.size,
      });
    }
  }

  resultado.sort((a, b) => b.repeticiones - a.repeticiones || a.tema.localeCompare(b.tema));
  return resultado;
}
