import Link from 'next/link';
import { requerirSesion } from '../../../lib/auth.js';
import * as db from '../../../lib/db/supabase.js';
import { evaluar, VEREDICTO, cupoDelDia } from '../../../lib/guardrails/guard.js';
import { obtenerSiguientePaso, armarIntentoSeguimiento } from '../../../lib/core/prospeccion.js';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const tonoVeredicto = (v) => {
  if (v === VEREDICTO.PERMITIDO) return 's-bien';
  if (v === VEREDICTO.DIFERIDO || v === VEREDICTO.APROBACION) return 's-warn';
  if (v === VEREDICTO.BLOQUEADO) return 's-stop';
  return 's-nd';
};

export default async function SimulacroPage() {
  await requerirSesion();

  const [cola, tablas, configArr] = await Promise.all([
    db.colaDeHoy(100),
    db.leerVarias(['Leads', 'Mensajes', 'Supresiones', 'Metricas']),
    db.leer('Config'),
  ]);

  const cfgObj = Object.fromEntries(configArr.map(c => [c.clave, c.valor]));

  const modo = cfgObj.modo_autonomia || 'aprobacion';
  const umbralAuto = Number(cfgObj.envios_aprobados_para_auto || 50);
  const cupoEmail = Number(cfgObj.cupo_diario_email || 25);
  const cupoWhatsapp = Number(cfgObj.cupo_diario_whatsapp || 20);
  const desde = Number(cfgObj.horario_desde || 9);
  const hasta = Number(cfgObj.horario_hasta || 18);
  const diasStr = cfgObj.dias_habiles || '1,2,3,4,5';
  const horasMin = Number(cfgObj.horas_min_entre_toques || 48);
  const maxToques = Number(cfgObj.max_toques || 4);
  const presupuesto = Number(cfgObj.presupuesto_api_mes_usd || 40);
  const zona = cfgObj.zona_horaria || 'America/Argentina/Buenos_Aires';
  const inicioCalentamiento = cfgObj.dia_inicio_calentamiento || '';
  const pausa = cfgObj.pausa_general === 'TRUE' || cfgObj.pausa_general === 'true';

  const mesActual = new Date().toISOString().slice(0, 7);
  const gastoMes = tablas.Metricas
    .filter(m => String(m.fecha || '').startsWith(mesActual))
    .reduce((a, m) => a + (Number(m.costo_api_usd) || 0), 0);

  // Copia del contexto para simulación en memoria.
  // A medida que un intento se aprueba/permite en la simulación, se pushea a ctx.mensajes.
  const ctxSimulado = {
    supresiones: [...tablas.Supresiones],
    mensajes: [...tablas.Mensajes],
    lead: null,
    aprobadosHumano: tablas.Mensajes.filter(m => m.aprobado_por === 'humano').length,
    gastoMes,
    cfg: {
      modo, umbralAuto, cupoEmail, cupoWhatsapp, desde, hasta, horasMin, maxToques,
      presupuesto, zona, inicioCalentamiento, pausa,
      diasHabiles: String(diasStr).split(',').map(Number),
    },
  };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const remitente = process.env.AGENCIA_REMITENTE || 'Martín';
  const agencia = process.env.AGENCIA_NOMBRE || 'Lokigi';

  const resultados = [];
  const resumen = {
    total: 0,
    [VEREDICTO.PERMITIDO]: 0,
    [VEREDICTO.DIFERIDO]: 0,
    [VEREDICTO.BLOQUEADO]: 0,
    [VEREDICTO.APROBACION]: 0,
    incompleto: 0,
  };

  for (const item of cola) {
    const lead = tablas.Leads.find(l => String(l.id) === String(item.id)) || item;
    const paso = obtenerSiguientePaso(lead.id, ctxSimulado.mensajes);

    const comp = armarIntentoSeguimiento({ lead, paso, appUrl, remitente, agencia });

    if (!comp || comp.incompleto || !comp.intento) {
      resumen.total++;
      resumen.incompleto++;
      resultados.push({
        id: lead.id,
        negocio: lead.negocio || 'Sin nombre',
        destinatario: lead.email || '— (sin correo)',
        paso,
        asunto: '—',
        veredicto: 'incompleto',
        regla: 'datos_incompletos',
        razon: comp?.razonIncompleto || 'Datos insuficientes para componer el intento',
      });
      continue;
    }

    const { intento } = comp;
    ctxSimulado.lead = lead;

    const v = await evaluar(intento, ctxSimulado);

    resumen.total++;
    const catVeredicto = v.veredicto || 'desconocido';
    resumen[catVeredicto] = (resumen[catVeredicto] || 0) + 1;

    resultados.push({
      id: lead.id,
      negocio: intento.negocio,
      destinatario: intento.destinatario,
      paso: intento.paso,
      asunto: intento.asunto,
      veredicto: v.veredicto,
      regla: v.regla || '—',
      razon: v.razon || '—',
    });

    // Si habría salido o quedado para aprobación, simula el registro del mensaje enviado
    // para que la simulación refleje el consumo de cupo diario e idempotencia en items siguientes.
    if (v.veredicto === VEREDICTO.PERMITIDO || v.veredicto === VEREDICTO.APROBACION) {
      ctxSimulado.mensajes.push({
        id: v.id,
        lead_id: intento.leadId,
        direccion: 'saliente',
        canal: intento.canal,
        paso: intento.paso,
        fecha: new Date().toISOString(),
      });
    }
  }

  return (
    <main>
      <h1>Simulacro de Prospección</h1>
      <p className="sub">
        Evaluación en memoria de la cola de hoy ({resultados.length} items) contra las 12 reglas del guardián.
      </p>

      <div className="aviso stop" style={{ padding: '16px 20px', marginBottom: 24 }}>
        <span className="lab" style={{ fontSize: 13 }}>SIMULACRO · ESTO NO ENVÍA NADA</span>
        <p style={{ marginTop: 4, fontWeight: 600 }}>
          Esta pantalla evalúa la cola de envíos existente sin realizar ninguna llamada a Gmail, Places o Gemini. Sirve para auditar qué mensajes saldrían, cuáles requerirían aprobación y cuáles quedarían diferidos por cupo o ventana horaria.
        </p>
      </div>

      <div className="kpis">
        <div className="kpi"><span>Items en cola</span><b>{resumen.total}</b></div>
        <div className="kpi">
          <span>Saldrían (Permitidos)</span>
          <b style={{ color: 'var(--go)' }}>{resumen[VEREDICTO.PERMITIDO]}</b>
        </div>
        <div className="kpi">
          <span>Requerirían Aprobación</span>
          <b style={{ color: 'var(--warn)' }}>{resumen[VEREDICTO.APROBACION]}</b>
        </div>
        <div className="kpi">
          <span>Diferidos</span>
          <b style={{ color: 'var(--warn)' }}>{resumen[VEREDICTO.DIFERIDO]}</b>
        </div>
        <div className="kpi">
          <span>Bloqueados</span>
          <b style={{ color: resumen[VEREDICTO.BLOQUEADO] ? 'var(--stop)' : 'var(--ink)' }}>{resumen[VEREDICTO.BLOQUEADO]}</b>
        </div>
        <div className="kpi">
          <span>Incompletos</span>
          <b>{resumen.incompleto}</b>
        </div>
      </div>

      <h2>Resultados del Simulacro</h2>
      {resultados.length === 0 ? (
        <div className="vacio">
          <b>No hay items en la cola de hoy</b>
          No existen toques agendados para evaluar en este momento.
        </div>
      ) : (
        <div className="scroller">
          <table style={{ minWidth: 800 }}>
            <thead>
              <tr>
                <th>Negocio</th>
                <th>Destinatario</th>
                <th className="n">Paso</th>
                <th>Asunto</th>
                <th>Veredicto</th>
                <th>Regla</th>
                <th>Razón</th>
              </tr>
            </thead>
            <tbody>
              {resultados.map((r, idx) => (
                <tr key={`${r.id}-${idx}`}>
                  <td><b><Link href={`/informe/${r.id}`}>{r.negocio}</Link></b></td>
                  <td style={{ fontSize: 13 }}>{r.destinatario}</td>
                  <td className="n">{r.paso}</td>
                  <td style={{ fontSize: 13, maxWidth: 280 }}>{r.asunto}</td>
                  <td>
                    <span className={`chip ${tonoVeredicto(r.veredicto)}`} style={{ textTransform: 'uppercase', fontSize: 11 }}>
                      {r.veredicto}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{r.regla}</td>
                  <td style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 320 }}>{r.razon}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
