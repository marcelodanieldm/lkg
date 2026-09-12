import { informePublico } from '../../lib/db/supabase.js';
import { confirmarBaja } from './accion.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Darse de baja', robots: 'noindex,nofollow' };

/**
 * La baja de un clic.
 *
 * Una decisión que parece un detalle y no lo es: el enlace del correo llega
 * acá con GET y NO da de baja al abrirse. Los antivirus corporativos y los
 * escáneres de enlaces de Gmail visitan todas las URLs de un correo antes de
 * mostrárselo al destinatario. Si el GET diera de baja, media lista se
 * desuscribiría sola sin que nadie hiciera clic, y encima nunca te enterarías
 * de por qué cayó la tasa de respuesta.
 *
 * Entonces: el GET muestra un botón, el POST ejecuta. Un clic, sin pedir
 * correo, sin pedir motivo, sin "¿estás seguro?".
 *
 * La excepción es la cabecera List-Unsubscribe con POST de un clic, que Gmail
 * usa desde su propia interfaz: ese POST llega directo y sí ejecuta, porque lo
 * dispara una acción deliberada de la persona dentro de su cliente de correo.
 */
export default async function Baja({ searchParams }) {
  const p = await searchParams;
  const lead = p?.lead;
  const hecho = p?.hecho === '1';

  if (!lead) {
    return (
      <Marco>
        <h1>Enlace incompleto</h1>
        <p>
          Falta el identificador. Respondé el correo con la palabra <b>BAJA</b> y te saco de la lista
          igual — se procesa automáticamente.
        </p>
      </Marco>
    );
  }

  if (hecho) {
    return (
      <Marco>
        <h1>Listo, te dimos de baja</h1>
        <p>No vas a recibir más correos nuestros. La baja es definitiva: tu dirección quedó en una
           lista de exclusión que el sistema consulta antes de cada envío.</p>
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>
          No hace falta que hagas nada más. Perdón por la molestia.
        </p>
      </Marco>
    );
  }

  const info = await informePublico(lead).catch(() => null);

  return (
    <Marco>
      <h1>Darse de baja</h1>
      <p>
        {info?.negocio
          ? <>Vas a dejar de recibir correos sobre el perfil de <b>{info.negocio}</b>.</>
          : <>Vas a dejar de recibir nuestros correos.</>}
        {' '}Un solo clic, sin más pasos.
      </p>
      <form action={confirmarBaja}>
        <input type="hidden" name="lead" value={lead} />
        <button type="submit" className="rechazar" style={{ marginTop: 10 }}>
          Confirmar la baja
        </button>
      </form>
      <p style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 22 }}>
        Es irreversible por diseño: una vez dada de baja, ni siquiera nosotros podemos volver a
        agregarte.
      </p>
    </Marco>
  );
}

/**
 * La firma al pie no es decoración. Esta pantalla la abre alguien que hizo
 * clic en un correo que no pidió; una página sin identificar que le pide
 * confirmar algo se parece demasiado a un fraude. Decir de quién es, y
 * repetir por qué recibió el correo, es lo que la vuelve creíble.
 */
const Marco = ({ children }) => (
  <main style={{ maxWidth: 520, margin: '12vh auto' }}>
    {children}
    <p style={{
      marginTop: 44, paddingTop: 18, borderTop: '1px solid var(--line)',
      fontSize: 13, color: 'var(--muted)',
    }}>
      {process.env.AGENCIA_NOMBRE || 'Lokigi'} · Recibiste el correo porque el perfil de tu negocio
      figura públicamente en Google Maps.
      {process.env.EMAIL_OPERADOR && <> Cualquier duda, escribí a {process.env.EMAIL_OPERADOR}.</>}
    </p>
  </main>
);
