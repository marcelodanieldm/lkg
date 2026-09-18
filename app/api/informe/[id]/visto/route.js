import { NextResponse } from 'next/server';
import { registrarVistoInforme } from '../../../../../lib/db/supabase.js';

export const dynamic = 'force-dynamic';

/**
 * POST /api/informe/[id]/visto
 *
 * Señal del lado del cliente enviada tras permanencia y desplazamiento en el informe.
 * NUNCA ejecuta el barrido síncronamente: marca el visto y encola la solicitud como "pendiente".
 */
export async function POST(req, { params }) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'Falta id de informe' }, { status: 400 });
  }

  const res = await registrarVistoInforme(id);
  return NextResponse.json({ ok: true, ...res });
}
