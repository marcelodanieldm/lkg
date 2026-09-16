import Link from 'next/link';
import Formulario from './formulario.jsx';

/**
 * La landing.
 *
 * Existe para respaldar el correo en frío. El recorrido real es: alguien
 * recibe una auditoría que no pidió, desconfía —con razón—, busca quién se la
 * mandó, y cae acá. Por eso la sección más larga de la página se llama
 * "Si te escribí sin que me lo pidieras, esto te lo debo": no es letra chica,
 * es la objeción principal.
 *
 * El hero no describe el servicio: muestra un puntaje real con sus seis
 * dimensiones. El objeto más convincente que produce este sistema es su propia
 * salida, así que se pone primero.
 *
 * Es la única página pública indexable del proyecto. Todo lo demás —el panel,
 * el informe de un prospecto, la baja— lleva `noindex`.
 */

export const dynamic = 'force-dynamic';

export const metadata = {
  title: `${process.env.AGENCIA_NOMBRE || 'Lokigi'} — Auditoría gratuita de tu perfil en Google Maps`,
  description:
    'Reviso 25 puntos de control sobre el perfil público de tu negocio en Google Maps y te mando ' +
    'un informe con lo que está bien, lo que falta y qué se hace con cada cosa.',
  robots: 'index,follow',
};

const AGENCIA = process.env.AGENCIA_NOMBRE || 'Lokigi';
const CIUDAD = process.env.AGENCIA_CIUDAD || '[TU CIUDAD]';
const CORREO = process.env.EMAIL_OPERADOR || '[TU CORREO]';
const PERSONA = process.env.AGENCIA_PERSONA || '[TU NOMBRE]';

/** El ejemplo del hero. Sale del perfil demo, con el motor real. */
const DEMO = {
  score: 26, potencial: 95, brecha: 69, banda: 'Crítico',
  dimensiones: [
    { nombre: 'Fundamentos del perfil', score: 45, tono: 'warn' },
    { nombre: 'Reputación y reseñas',  score: 40, tono: 'alto' },
    { nombre: 'Contenido visual',      score: 19, tono: 'stop' },
    { nombre: 'Actividad y frescura',  score: 0,  tono: 'stop' },
    { nombre: 'Conversión y atención', score: 20, tono: 'stop' },
    { nombre: 'Presencia digital',     score: 0,  tono: 'stop' },
  ],
};

const DIMENSIONES = [
  ['20%', 'Fundamentos del perfil',
   'Categorías, descripción, horarios, atributos. Es lo que Google usa para entender qué es tu negocio y cuándo mostrarlo.'],
  ['25%', 'Reputación y reseñas',
   'Volumen, calidad, frescura y si respondés. Pesa alrededor del 16% del algoritmo local y casi el 100% de la decisión de una persona.'],
  ['15%', 'Contenido visual',
   'Cuántas fotos hay, de qué tipo y hace cuánto se subió la última. Es lo primero que mira una persona antes de decidir.'],
  ['10%', 'Actividad y frescura',
   'Publicaciones, ofertas y eventos. Es la señal más barata de “este negocio está vivo” que le podés dar a Google, y casi nadie la usa.'],
  ['15%', 'Conversión y atención',
   'Botón de mensajes, reservas, pedidos, enlaces. De nada sirve aparecer si el que te encuentra no tiene cómo escribirte.'],
  ['15%', 'Presencia digital',
   'Sitio web, redes, coherencia de dirección y teléfono. Lo que pasa fuera del perfil y que Google usa para validar que existís.'],
];

const PROHIBIDAS = [
  ['“Te garantizamos el primer puesto”',
   'La posición depende de dónde está parado el que busca. No es una cosa sola que se pueda prometer.'],
  ['“Vas a duplicar tus ventas”',
   'Puedo estimar consultas, no ventas. Lo que pasa cuando alguien entra a tu local depende de vos.'],
  ['“Última oportunidad, solo por hoy”',
   'El precio de la semana que viene es el mismo. Apurarte no me conviene a mí ni a vos.'],
];

const PREGUNTAS = [
  ['¿De dónde saliste?',
   <>Tu perfil figura públicamente en Google Maps. Lo leí de ahí, igual que lo lee cualquier persona que
     busca tu rubro en tu zona. No compré ninguna base de datos ni te saqué el correo de ningún lado
     raro: está en tu propio sitio web.</>],
  ['¿Me vas a llamar?',
   <>No. Te escribo como mucho cuatro veces, espaciadas, y si no contestás dejo de escribir solo.
     No hay call center, no hay número desconocido a las nueve de la noche.</>],
  ['¿Cómo me saco esto de encima?',
   <>Respondés “BAJA” o hacés clic en el enlace del pie del correo. Se procesa al instante y es
     definitivo: tu dirección queda en una lista que el sistema consulta antes de cada envío, y ni yo
     puedo volver a agregarte.</>],
  ['¿Quién está atrás?',
   <>Una persona: {PERSONA}, desde {CIUDAD}. La auditoría la hace un programa, pero cada mensaje que te
     llega lo leí yo antes de que saliera.</>],
];

export default function Landing() {
  return (
    <>
      <header className="tapa">
        <div className="ancho" style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          <Link href="/" className="marca"
                style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none', color: 'var(--ink)' }}>
            <Pin size={24} />
            <b style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 20, letterSpacing: '-.02em' }}>{AGENCIA}</b>
          </Link>
          <nav>
            <a href="#metodo">Cómo se mide</a>
            <a href="#planes">Qué cuesta</a>
            <a href="#datos">De dónde saqué tus datos</a>
          </nav>
          <a href="#pedir" className="cta oscuro" style={{ marginLeft: 'auto' }}>Pedir mi auditoría</a>
        </div>
      </header>

      <div className="ancho">
        <section className="hero">
          <div className="pila">
            <span className="sello">Auditoría de Google Maps · {CIUDAD}</span>
            <h1>Tu perfil de Google tiene un puntaje. Te digo cuál es, gratis.</h1>
            <p className="entrada">
              Reviso 25 puntos de control sobre el perfil público de tu negocio en Google Maps y te mando
              un informe con lo que está bien, lo que falta y qué se hace con cada cosa.
              {' '}<b>Sin compromiso y sin llamarte por teléfono.</b>
            </p>
            <div className="acciones-hero">
              <a href="#pedir" className="cta">Pedir mi auditoría</a>
              <Link href="/informe/ejemplo" className="cta calada">Ver un informe de ejemplo</Link>
            </div>
            <p style={{ fontSize: 14.5, color: 'var(--muted)' }}>
              Tarda dos días. Si no te sirve, respondés “BAJA” y no te escribo nunca más.
            </p>
          </div>

          <div className="puntaje">
            <div className="rotulo">Auditoría en vivo · Muestra de control</div>
            <div className="cifra">
              <span className="num">{DEMO.score}</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 7 }}>
                <span className="de">/100</span>
                <span className="chip stop">{DEMO.banda}</span>
              </span>
            </div>
            <p style={{ fontSize: 15, color: 'var(--ink-2)', marginTop: 16 }}>
              Techo alcanzable resolviendo lo detectado:{' '}
              <b style={{ color: 'var(--ink)' }}>{DEMO.potencial}/100</b>{' '}
              <span style={{ color: 'var(--muted)' }}>(+{DEMO.brecha} puntos).</span>
            </p>
            <div className="dims">
              {DEMO.dimensiones.map(d => (
                <div className="dim" key={d.nombre}>
                  <span className="nom">{d.nombre}</span>
                  <span className="via">
                    {/* Mínimo 2% para que un cero se lea como una barra vacía y
                        no como un error de renderizado. */}
                    <i style={{ width: `${Math.max(d.score, 2)}%`, background: `var(--${d.tono === 'alto' ? 'alto' : d.tono})` }} />
                  </span>
                  <span className={`val s-${d.tono}`}>{d.score}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section className="franja blanca" id="metodo">
        <div className="ancho">
          <div style={{ maxWidth: 700 }}>
            <h2 className="titulo">El número no lo decide nadie. Lo decide una planilla de reglas.</h2>
            <p className="entradilla">
              Veinticinco puntos de control repartidos en seis dimensiones, cada uno con un peso fijo y
              una fuente que lo respalda. Si auditás el mismo perfil dos veces te da el mismo número —
              hoy y dentro de un año. No hay criterio personal, no hay “me parece”.
            </p>
          </div>
          <div className="rejilla-3">
            {DIMENSIONES.map(([peso, titulo, texto]) => (
              <div className="pieza" key={titulo}>
                <div className="peso">Peso {peso}</div>
                <h3>{titulo}</h3>
                <p>{texto}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="franja">
        <div className="ancho dos">
          <div>
            <h2 className="titulo">Tres cosas que no vas a leer en mi informe</h2>
            <p className="entradilla">
              Si alguien te promete el primer puesto en Google, no sabe cómo funciona Google o sabe que
              vos no lo sabés. Estas tres frases están prohibidas en mis mensajes, y hay un filtro
              automático que no las deja salir.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {PROHIBIDAS.map(([frase, porque]) => (
              <div className="tachado" key={frase}>
                <p className="frase">{frase}</p>
                <p className="por">{porque}</p>
              </div>
            ))}
            <div className="enverdad">
              <p>
                <b>Lo que sí vas a leer:</b> cuántos puntos pierde cada cosa, qué se observa exactamente,
                y de dónde sale el criterio. Cada hallazgo cita su fuente.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="franja blanca" id="planes">
        <div className="ancho">
          <div style={{ maxWidth: 660 }}>
            <h2 className="titulo">Y si querés que lo arregle yo</h2>
            <p className="entradilla">
              El informe es gratis y podés dárselo a quien quieras. Si preferís que me encargue, estos son
              los tres alcances. Los precios salen de las horas que lleva cada tarea, no de cuánto parezca
              que te puedo cobrar.
            </p>
          </div>

          <div className="planes">
            <Plan nombre="Esencial" lema="Arreglar lo que está costando clientes hoy"
                  mensual="$197.000" cada="por mes · 3 meses" setup="$741.000" proyeccion={66}
                  incluye={['Optimización integral del perfil', 'Canales de conversión activados',
                            'SEO local en el sitio', 'Fotos, lote trimestral', 'Reporte mensual']} />
            <Plan nombre="Crecimiento" lema="Ganar posiciones de forma sostenida" elegido
                  mensual="$418.000" cada="por mes · 6 meses" setup="$877.000" proyeccion={81}
                  incluye={['Todo lo del plan Esencial', 'Respuesta a reseñas en 24-48 hs',
                            'Sistema para pedir reseñas', 'QR y link corto para el local', 'Reporte mensual']} />
            <Plan nombre="Dominio local" lema="Ser la opción por defecto de la zona"
                  mensual="$722.000" cada="por mes · 6 meses" setup="$914.000" proyeccion={89}
                  incluye={['Todo lo del plan Crecimiento', 'Publicaciones semanales',
                            'Citas locales y directorios', 'Seguimiento de competencia', 'Reporte mensual']} />
          </div>

          <p style={{ fontSize: 14.5, color: 'var(--muted)', marginTop: 26, maxWidth: '74ch' }}>
            Precios en pesos, calculados sobre la auditoría de ejemplo. El tuyo sale del informe: si tu
            perfil ya tiene resuelto algo, no te lo cobro. Y si ninguno te cierra, hay tres versiones
            reducidas con el detalle de qué se resigna en cada una.
          </p>
        </div>
      </section>

      <section className="franja" id="datos">
        <div className="ancho dos">
          <div>
            <h2 className="titulo">Si te escribí sin que me lo pidieras, esto te lo debo</h2>
            <p className="entradilla">Es la pregunta que haría cualquiera y casi nadie la contesta. Va derecho:</p>
          </div>
          <div className="faq">
            {PREGUNTAS.map(([pregunta, respuesta]) => (
              <div key={pregunta}>
                <h3>{pregunta}</h3>
                <p>{respuesta}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="franja oscura" id="pedir">
        <div className="ancho cierre">
          <div>
            <h2>Decime el nombre de tu negocio y te mando el informe</h2>
            <p className="entradilla">
              No hace falta que me des accesos, ni contraseñas, ni que instales nada. Con el nombre y la
              ciudad alcanza — lo demás lo leo del perfil público.
            </p>
          </div>
          <Formulario />
        </div>
      </section>

      <footer className="pie">
        <div className="ancho">
          <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Pin size={20} color="var(--muted)" />
            <span style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 16, color: 'var(--muted)' }}>{AGENCIA}</span>
          </span>
          <span style={{ fontSize: 13.5, color: 'var(--muted)' }}>{CIUDAD}, Argentina · {CORREO}</span>
          <span className="der">
            <a href="#datos">De dónde saqué tus datos</a>
            <Link href="/baja">Darse de baja</Link>
          </span>
        </div>
      </footer>
    </>
  );
}

function Plan({ nombre, lema, mensual, cada, setup, incluye, proyeccion, elegido }) {
  return (
    <div className={elegido ? 'plan elegido' : 'plan'}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <h3>{nombre}</h3>
        {elegido && <span className="marca-plan">Más elegido</span>}
      </div>
      <p className="lema">{lema}</p>
      <div className="precio">
        <div className="monto">{mensual}</div>
        <div className="cada">{cada}</div>
        <div className="cada" style={{ marginTop: 6 }}>
          Puesta en marcha{' '}
          <b style={{ color: 'var(--ink)', fontFamily: '"IBM Plex Mono", ui-monospace, monospace' }}>{setup}</b>
        </div>
      </div>
      <ul>{incluye.map(i => <li key={i}>{i}</li>)}</ul>
      <p className="proy">
        Proyección: de {DEMO.score} a <b style={{ color: 'var(--ink)' }}>{proyeccion}</b> puntos
      </p>
    </div>
  );
}

const Pin = ({ size = 24, color = 'var(--accent)' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 22s7.5-7.2 7.5-12.5A7.5 7.5 0 0 0 4.5 9.5C4.5 14.8 12 22 12 22z"
          fill="none" stroke={color} strokeWidth="1.8" />
    <circle cx="12" cy="9.4" r="2.6" fill={color} />
  </svg>
);
