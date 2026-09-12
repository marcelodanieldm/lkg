import { auditar } from '../../../lib/core/audit-engine.js';
import { generarInformeHTML } from '../../../lib/core/report.js';
import { PERFILES_DEMO } from '../../../lib/core/demo.js';
import { embutirInforme } from '../embutir.js';

/**
 * El informe de ejemplo que ofrece la landing.
 *
 * No es una maqueta ni una captura: se genera en el momento con el mismo motor
 * y la misma plantilla que producen los informes de verdad. Si mañana cambiás
 * una regla de la rúbrica, este ejemplo cambia solo — que es exactamente lo que
 * hace honesto mostrarlo.
 *
 * Usa el perfil de `demo.js`, que es un negocio inventado. Nunca un cliente ni
 * un prospecto real: el ejemplo público de un mal perfil no puede ser el
 * negocio de alguien.
 *
 * Esta ruta estática gana sobre `/informe/[id]`, así que "ejemplo" queda
 * reservado y ningún place_id puede pisarla.
 */

export const metadata = {
  title: 'Un informe de ejemplo — Lokigi',
  description: 'Así se ve la auditoría que recibís: el puntaje, de dónde sale, y qué se hace con cada hallazgo.',
  robots: 'index,follow',
};

// Se recalcula en cada compilación, no en cada visita: el motor es
// determinista y el perfil es fijo, así que el resultado no cambia entre
// visitas. No tiene sentido gastar tiempo de función en rehacerlo.
export const dynamic = 'force-static';

export default function InformeDeEjemplo() {
  const auditoria = auditar(PERFILES_DEMO.panaderia);
  const html = generarInformeHTML(auditoria, {
    agencia: process.env.AGENCIA_NOMBRE || 'Lokigi',
    remitente: process.env.AGENCIA_PERSONA || '',
    ctaUrl: '/#pedir',
  });

  const { alcance, cuerpo, estilos } = embutirInforme(html);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: estilos }} />
      <div className="cinta-ejemplo">
        <b>Esto es un ejemplo.</b> Lo generó el mismo programa que produce los informes de verdad, sobre
        un negocio inventado. <a href="/#pedir">Pedí el de tu negocio →</a>
      </div>
      <div className={alcance} dangerouslySetInnerHTML={{ __html: cuerpo }} />
    </>
  );
}
