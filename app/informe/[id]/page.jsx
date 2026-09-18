/**
 * El informe público. Es la página que abre el prospecto desde el correo.
 *
 * Tres decisiones que vale la pena dejar dichas:
 *
 * 1. Sirve HTML congelado, guardado el día de la auditoría. No se recalcula.
 *    Si se recalculara, el número que ve el prospecto podría no coincidir con
 *    el del correo que lo trajo hasta acá, y el informe dejaría de funcionar
 *    como argumento.
 *
 * 2. Registra la apertura, que es la señal de interés más fuerte del embudo:
 *    alguien que abre la auditoría de su propio negocio está evaluando. El
 *    registro no bloquea el renderizado —si falla, la página se muestra igual.
 *
 * 3. Si el lead pidió la baja, el enlace deja de servir. El correo promete que
 *    la baja "se procesa al instante y de forma definitiva"; dejar el informe
 *    accesible después sería una promesa a medias. La función `informe_html`
 *    de Postgres ya filtra por `opt_out`, así que esto no depende de que la
 *    página se acuerde.
 */

import { informeHTML, informePublico, registrarApertura, config } from '../../../lib/db/supabase.js';
import { embutirInforme } from '../embutir.js';
import VistoScript from './visto-script.jsx';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { id } = await params;
  const l = await informePublico(id).catch(() => null);
  return {
    title: l ? `Auditoría de ${l.negocio}` : 'Auditoría',
    // El informe habla del negocio de otra persona: no tiene por qué aparecer
    // en un buscador. Que lo vea quien tiene el enlace, nadie más.
    robots: 'noindex,nofollow',
  };
}

export default async function Informe({ params }) {
  const { id } = await params;

  const [html, lead, segundosMinimos] = await Promise.all([
    informeHTML(id).catch(() => null),
    informePublico(id).catch(() => null),
    config('barrido_segundos_minimos', 10),
  ]);

  if (!html) {
    return (
      <main style={{ maxWidth: 560, margin: '14vh auto', textAlign: 'center' }}>
        <h1>Este enlace ya no está disponible</h1>
        <p className="sub" style={{ margin: '0 auto' }}>
          {lead
            ? 'La auditoría de este perfil todavía no se generó.'
            : 'O el informe se dio de baja, o el enlace está incompleto. Si te llegó por correo y querés verlo, respondé ese correo y te lo mando de nuevo.'}
        </p>
      </main>
    );
  }

  // No se espera: contar la apertura no puede demorar la página que el
  // prospecto vino a ver.
  registrarApertura(id).catch(() => {});

  // El informe es un documento completo con sus propios estilos. Se acota a un
  // contenedor para que sus clases genéricas —`.barra`, `.cta`, `.sub`— no
  // choquen con las del panel, que viven en globals.css. Ver embutir.js.
  const { alcance, cuerpo, estilos } = embutirInforme(html);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: estilos }} />
      <div className={alcance} dangerouslySetInnerHTML={{ __html: cuerpo }} />
      <VistoScript leadId={id} segundosMinimos={Number(segundosMinimos)} />
    </>
  );
}
