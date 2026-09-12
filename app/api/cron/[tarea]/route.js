/**
 * Las tareas programadas. Reemplazan a los seis flujos de n8n.
 *
 * Quién las dispara: pg_cron dentro de Supabase, no el cron de Vercel. El plan
 * Hobby permite una sola corrida diaria con ±59 minutos de imprecisión, lo que
 * no alcanza para revisar la cola de aprobación cada quince minutos. pg_cron
 * corre dentro de Postgres, es gratis, acepta cada minuto y llama acá con
 * pg_net. Ver supabase/migrations/002_rls_y_cron.sql.
 *
 * Seguridad: sin la cabecera X-API-Key, cualquiera en internet podría disparar
 * la prospección del día. La ruta es pública por necesidad, así que la clave es
 * lo único que la separa de un botón abierto.
 */

import { NextResponse } from 'next/server';
import * as db from '../../../../lib/db/supabase.js';
import { evaluar, registrar, usarFuente, VEREDICTO, huella } from '../../../../lib/guardrails/guard.js';
import { auditar } from '../../../../lib/core/audit-engine.js';
import { generarInformeHTML } from '../../../../lib/core/report.js';
import { desdePlacesApi, aplicarAnalisisWeb } from '../../../../lib/core/normalize.js';
import { SECUENCIA_PROSPECCION, render } from '../../../../lib/core/sequences.js';
import { obtenerSiguientePaso } from '../../../../lib/core/prospeccion.js';
import { agenteProspector, agenteRedactor, agenteConversador, agenteSupervisor } from '../../../../lib/ia/gemini.js';
import * as ws from '../../../../lib/integrations/workspace.js';
import { generarPresupuestos, generarAlternativasReduccion } from '../../../../lib/core/quote-engine.js';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// El guardián se copió del proyecto anterior sin tocar una línea: ya recibía
// la fuente de datos por inyección. Acá se le enchufa Supabase en vez de Sheets.
usarFuente(db);

const APP = () => process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

function autorizado(req) {
  const clave = process.env.LOKIGI_API_KEY;
  if (!clave) return process.env.NODE_ENV !== 'production';
  // Vercel Cron manda su propio bearer; pg_cron manda X-API-Key.
  return req.headers.get('x-api-key') === clave ||
         req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET || clave}`;
}

// ─────────────────────────────────────────────────────────────────────

const TAREAS = {

  /** Busca, audita, redacta y manda al guardián. Nunca envía por su cuenta. */
  async prospeccion() {
    const [nicho, tope, pausa] = await Promise.all([
      db.config('nicho', 'gastronomía'),
      db.config('auditorias_por_corrida', 25),
      db.config('pausa_general', false),
    ]);
    if (pausa) return { saltada: true, razon: 'pausa_general activa' };

    // Resumen compacto de zonas: pasarle 3.000 filas al modelo es caro y no
    // mejora la decisión.
    const leads = await db.leer('Leads');
    const porZona = {};
    for (const l of leads) {
      const k = `${l.categoria || '?'} | ${l.ciudad || '?'}`;
      porZona[k] = (porZona[k] || 0) + 1;
    }
    const resumenZonas = Object.entries(porZona).sort((a, b) => b[1] - a[1]).slice(0, 25)
      .map(([k, v]) => `${k}: ${v}`).join('\n');

    const { salida: plan, costo: costoProsp } = await agenteProspector({ resumenZonas, nicho });

    const { buscarNegocios, detallePlace } = await import('../../../../lib/integrations/places.js');
    const { analizarSitio } = await import('../../../../lib/integrations/website-audit.js');

    const encontrados = await buscarNegocios({ consulta: plan.consulta, max: 20 });

    // Filtro determinista, no del modelo.
    const hace90 = Date.now() - 90 * 86400e3;
    const previos = new Map(leads.map(l => [l.id, l.actualizado_en]));
    const candidatos = encontrados.filter(p => {
      if (!p.id) return false;
      if ((p.userRatingCount || 0) > 250) return false;   // ya tiene quien lo trabaje
      const prev = previos.get(p.id);
      return !(prev && new Date(prev).getTime() > hace90);
    }).slice(0, Number(tope));

    const res = { plan, candidatos: candidatos.length, auditados: 0, veredictos: {}, costo: costoProsp };

    for (const p of candidatos) {
      try {
        let perfil = desdePlacesApi(await detallePlace(p.id, { conResenas: true }));
        if (perfil.sitioWeb) perfil = aplicarAnalisisWeb(perfil, await analizarSitio(perfil.sitioWeb));

        const resultado = auditar(perfil);
        res.auditados++;

        const ciudad = (perfil.direccion || '').split(',').slice(-2, -1)[0]?.trim() || plan.ciudad;
        const dim = (id) => resultado.dimensiones.find(d => d.id === id)?.score ?? null;

        // El corpus crece con TODA auditoría, responda o no el negocio.
        // Es el activo; los contactados son un subconjunto.
        await db.agregar('Corpus', {
          place_id: perfil.placeId, categoria: perfil.categoriaPrimariaLabel, ciudad,
          score: resultado.score, potencial: resultado.potencial, cobertura: resultado.meta.cobertura,
          d_fundamentos: dim('fundamentos'), d_reputacion: dim('reputacion'), d_visual: dim('visual'),
          d_actividad: dim('actividad'), d_conversion: dim('conversion'), d_presencia: dim('presencia'),
          resenas: perfil.cantidadResenas, rating: perfil.rating, fotos: perfil.cantidadFotos,
          version_rubrica: resultado.meta.version,
        });

        const pct = await db.percentil(resultado.score, perfil.categoriaPrimariaLabel, ciudad);

        const html = generarInformeHTML(resultado, {
          agencia: process.env.AGENCIA_NOMBRE || 'Lokigi',
          remitente: process.env.AGENCIA_REMITENTE || '',
          ctaUrl: `${APP()}/informe/${perfil.placeId}`,
        });

        // Copia del informe en Drive, ordenada por mes. No es para el
        // prospecto —él ve la versión web— sino para vos: es el registro de
        // qué se auditó y con qué rúbrica, y el material de los casos de
        // estudio. Si Drive falla, la auditoría igual vale.
        let driveUrl = null;
        if (ws.configurado()) {
          driveUrl = await ws.archivarInforme({
            negocio: perfil.nombre, html,
            carpetaRaizId: await db.config('drive_carpeta_informes', null),
          }).then(r => r.url).catch(() => null);
        }

        await db.upsert('Leads', {
          // Solo si esta corrida logró archivar: mandar null borraría el
          // enlace de una auditoría anterior que sí funcionó.
          ...(driveUrl ? { drive_informe_url: driveUrl } : {}),
          id: perfil.placeId, negocio: perfil.nombre, categoria: perfil.categoriaPrimariaLabel,
          ciudad, direccion: perfil.direccion, telefono: perfil.telefono,
          email: perfil.web?.emails?.[0] ?? null, sitio_web: perfil.sitioWeb, maps_url: perfil.mapsUrl,
          score: resultado.score, potencial: resultado.potencial, percentil: pct?.percentil ?? null,
          etapa: 'auditado', informe_url: `${APP()}/informe/${perfil.placeId}`,
          prioridad: Math.round((resultado.potencial - resultado.score) * 2 + (perfil.telefono ? 10 : 0)),
          actualizado_en: new Date().toISOString(),
        });

        // El informe queda congelado. Si se recalculara en cada apertura, el
        // número que ve el prospecto podría no ser el del correo que lo trajo.
        await db.guardarInforme(perfil.placeId, html, resultado.score, resultado.meta.version);

        // Los tres filtros que deciden si vale contactar.
        if (resultado.score >= 70 || resultado.brecha < 20 || resultado.meta.cobertura < 60) continue;

        const lead = await db.uno('Leads', l => l.id === perfil.placeId, { sinCache: true });
        if (!lead?.email) continue;   // sin correo no hay primer toque

        const { salida: msg, costo } = await agenteRedactor({
          auditoria: resultado, percentil: pct?.percentil ?? null,
          urlInforme: lead.informe_url, contacto: lead.contacto_nombre,
        });
        res.costo += costo;

        const intento = {
          tipo: 'prospeccion', canal: 'email', leadId: lead.id, negocio: lead.negocio,
          destinatario: lead.email, asunto: msg.asunto, cuerpo: msg.cuerpo,
          paso: 1, agente: 'redactor', confianza: msg.confianza, costo,
        };

        const v = await evaluar(intento);
        await registrar(intento, v).catch(() => {});
        res.veredictos[v.veredicto] = (res.veredictos[v.veredicto] || 0) + 1;

        if (v.veredicto === VEREDICTO.APROBACION) await encolar(intento, v);
        else if (v.veredicto === VEREDICTO.PERMITIDO) await enviarYRegistrar(intento, 'guardian');
      } catch (e) {
        await db.agregar('Bitacora', {
          agente: 'prospector', accion: 'auditar', lead_id: p.id,
          decision: 'error', razon: e.message.slice(0, 400),
        });
      }
    }
    return res;
  },

  /** Seguimiento de los leads con toques pendientes (pasos 2, 3 y 4). */
  async seguimiento() {
    const [tope, pausa] = await Promise.all([
      db.config('auditorias_por_corrida', 25),
      db.config('pausa_general', false),
    ]);
    if (pausa) return { saltada: true, razon: 'pausa_general activa' };

    const cola = await db.colaDeHoy();
    const mensajes = await db.leer('Mensajes');

    const candidatos = (cola || []).slice(0, Number(tope));
    const res = { procesados: 0, veredictos: {}, agotados: 0, costo: 0 };

    for (const item of candidatos) {
      try {
        const pasoSiguiente = obtenerSiguientePaso(item.id, mensajes);
        const ultimoPaso = pasoSiguiente - 1;

        // El primer paso lo manda prospección; esta tarea se ocupa únicamente de los posteriores.
        if (ultimoPaso === 0) continue;

        const pasoDef = SECUENCIA_PROSPECCION.find(p => p.paso === pasoSiguiente);

        // Sin paso siguiente la secuencia llegó a su fin y el lead se marca como perdido.
        if (!pasoDef) {
          await db.actualizar('Leads', {
            id: item.id,
            etapa: 'perdido',
            motivo_perdida: 'secuencia agotada sin respuesta',
          });
          res.agotados++;
          continue;
        }

        const lead = await db.uno('Leads', l => l.id === item.id, { sinCache: true }) || item;
        if (!lead?.email) continue;

        const auditoria = {
          score: lead.score ?? 50,
          potencial: lead.potencial ?? 80,
          banda: { etiqueta: 'oportunidad de mejora' },
          meta: { negocio: lead.negocio },
          hallazgos: [],
          fortalezas: [],
        };

        const { salida: msg, costo } = await agenteRedactor({
          auditoria,
          percentil: lead.percentil ?? null,
          urlInforme: lead.informe_url || `${APP()}/informe/${lead.id}`,
          contacto: lead.contacto_nombre,
        });
        res.costo += costo;
        res.procesados++;

        const intento = {
          tipo: 'prospeccion',
          canal: pasoDef.canal || 'email',
          leadId: lead.id,
          negocio: lead.negocio,
          destinatario: lead.email,
          asunto: msg.asunto || render(pasoDef.asunto || '', { negocio: lead.negocio }),
          cuerpo: msg.cuerpo,
          paso: pasoSiguiente,
          agente: 'redactor',
          confianza: msg.confianza,
          costo,
        };

        const v = await evaluar(intento);
        await registrar(intento, v).catch(() => {});
        res.veredictos[v.veredicto] = (res.veredictos[v.veredicto] || 0) + 1;

        if (v.veredicto === VEREDICTO.APROBACION) await encolar(intento, v);
        else if (v.veredicto === VEREDICTO.PERMITIDO) await enviarYRegistrar(intento, 'guardian');
      } catch (e) {
        await db.agregar('Bitacora', {
          agente: 'redactor', accion: 'seguimiento', lead_id: item.id,
          decision: 'error', razon: e.message.slice(0, 400),
        });
      }
    }
    return res;
  },

  /** Envía lo que Marcelo aprobó. Lo vuelve a pasar por el guardián antes. */
  async aprobaciones() {
    const listas = await db.aprobadasSinEnviar();
    const res = { candidatas: listas.length, enviadas: 0, bloqueadas: 0 };

    for (const a of listas) {
      const intento = {
        tipo: 'prospeccion', canal: a.canal, leadId: a.lead_id, negocio: a.negocio,
        destinatario: a.destinatario, asunto: a.asunto, cuerpo: a.cuerpo,
        paso: a.paso, agente: 'redactor', saltarAutonomia: true,
      };

      // Segunda evaluación: entre que Marcelo aprobó y llega este momento el
      // prospecto pudo haber pedido la baja. Es barata y evita el peor error
      // posible del sistema.
      const v = await evaluar(intento);
      if (v.veredicto !== VEREDICTO.PERMITIDO && v.veredicto !== VEREDICTO.APROBACION) {
        await db.actualizar('Aprobaciones', {
          id: a.id, enviado_en: new Date().toISOString(),
          resultado: `no enviado: ${v.regla} — ${v.razon}`,
        });
        res.bloqueadas++;
        continue;
      }

      try {
        await enviarYRegistrar(intento, 'humano');
        await db.actualizar('Aprobaciones', { id: a.id, enviado_en: new Date().toISOString(), resultado: 'enviado' });
        res.enviadas++;
      } catch (e) {
        await db.actualizar('Aprobaciones', { id: a.id, resultado: `error: ${e.message.slice(0, 200)}` });
      }
    }
    return res;
  },

  /** Lee Gmail. Baja → rebote → clasificación, en ese orden y sin excepción. */
  async bandeja() {
    const { respuestasNuevas, marcarLeido, enviar } = await import('../../../../lib/integrations/gmail.js');
    const nuevos = await respuestasNuevas({ max: 25 });
    const res = { leidos: nuevos.length, bajas: 0, rebotes: 0, clasificados: 0, escalados: 0 };

    for (const m of nuevos) {
      const texto = `${m.texto} ${m.asunto}`.toLowerCase();

      // PRIMER filtro, siempre, con reglas fijas. Un modelo puede equivocarse;
      // una baja no admite equivocación.
      const esBaja = /\b(baja|stop|unsubscribe|no me interesa|no gracias|dej[aá] de escribir|no escrib|remover|sacame|dar de baja|no contactar)\b/.test(texto);

      const lead = await db.uno('Leads', l => (l.email || '').toLowerCase() === m.email);

      if (esBaja) {
        if (lead) await db.darDeBaja(lead.id, 'email');
        else await db.agregar('Supresiones', { valor: m.email, tipo: 'email', motivo: 'baja solicitada', origen: 'respuesta' });
        // Confirmar la baja es la única excepción a pasar por el guardián: es
        // respuesta a un pedido explícito y reduce las denuncias por spam.
        await enviar({
          para: m.email, asunto: 'Listo, te di de baja',
          textoPlano: `Listo, te di de baja ahora mismo y no te vuelvo a escribir.\n\nGracias por avisar.\n\n${process.env.AGENCIA_REMITENTE || ''}`,
          html: '<p>Listo, te di de baja ahora mismo y no te vuelvo a escribir.</p><p>Gracias por avisar.</p>',
        }).catch(() => {});
        res.bajas++;
      } else if (m.esRebote) {
        if (lead) await db.actualizar('Leads', { id: lead.id, etapa: 'perdido', notas: `rebote: ${m.asunto}` });
        res.rebotes++;
      } else if (lead) {
        // Si en un toque anterior se le ofrecieron horarios, se los pasamos al
        // clasificador para que pueda reconocer cuál eligió.
        const ofrecidos = Array.isArray(lead.horarios_ofrecidos) ? lead.horarios_ofrecidos : [];

        const { salida: c, costo } = await agenteConversador({
          texto: m.texto, negocio: lead.negocio, score: lead.score, etapa: lead.etapa,
          horarios: ofrecidos.map(h => h.etiqueta),
        });
        await db.agregar('Mensajes', {
          id: m.id, lead_id: lead.id, direccion: 'entrante', canal: 'email',
          asunto: m.asunto, cuerpo: m.texto.slice(0, 4000),
          objecion: c.intencion, estado: 'recibido', agente: 'conversador', costo_usd: costo,
        });
        await db.actualizar('Leads', {
          id: lead.id,
          etapa: ['interes', 'precio'].includes(c.intencion) ? 'interesado' : 'respondio',
        });

        // Preparar, no enviar. Si preguntó precio se arma la propuesta en
        // Docs; si mostró interés se calculan tres horarios. En los dos casos
        // el resultado queda listo y a la vista, pero lo que sale hacia
        // afuera sigue pasando por el guardián como cualquier otro mensaje.
        // Eligió uno de los horarios que se le habían ofrecido.
        const elegido = ofrecidos[(c.horario_elegido ?? 0) - 1];
        if (elegido && ws.configurado()) {
          await agendar(lead, elegido).catch(e => registrarFalla('agenda', lead.id, e));
          res.agendados = (res.agendados || 0) + 1;
        } else if (c.intencion === 'precio') {
          await prepararPropuesta(lead).catch(e => registrarFalla('cotizador', lead.id, e));
          res.propuestas = (res.propuestas || 0) + 1;
        } else if (c.intencion === 'interes' && ws.configurado() && !ofrecidos.length) {
          // Se calculan y se guardan; el mensaje que los ofrece lo redacta el
          // agente y lo autoriza el guardián, como cualquier otro.
          const horarios = ws.proponerHorarios({ cantidad: 3 });
          await db.actualizar('Leads', { id: lead.id, horarios_ofrecidos: horarios });
          res.horarios = horarios.map(h => h.etiqueta);
        }
        await db.agregar('Bitacora', {
          agente: 'conversador', accion: 'clasificar', lead_id: lead.id,
          decision: c.intencion, razon: c.resumen, confianza: c.confianza, costo_usd: costo,
        });
        if (c.requiere_humano) {
          await avisarOperador(
            `Lokigi · respuesta que necesita tu criterio — ${lead.negocio}`,
            `${c.resumen}\n\nIntención: ${c.intencion} (confianza ${c.confianza})\n\n"""\n${m.texto.slice(0, 1200)}\n"""\n\nRespondé directo desde tu Gmail, el hilo ya está abierto.`
          );
          res.escalados++;
        }
        res.clasificados++;
      }
      await marcarLeido(m.id).catch(() => {});
    }
    return res;
  },

  /** Cierre del día: métricas, cinco alarmas deterministas y el resumen. */
  async supervisor() {
    const hoy = new Date().toISOString().slice(0, 10);
    const [mensajes, bitacora, pendientes] = await Promise.all([
      db.leer('Mensajes'), db.leer('Bitacora'), db.pendientesDeAprobacion(),
    ]);

    const esHoy = (f) => String(f || '').startsWith(hoy);
    const sal = mensajes.filter(m => m.direccion === 'saliente' && esHoy(m.fecha));
    const ent = mensajes.filter(m => m.direccion === 'entrante' && esHoy(m.fecha));
    const bitHoy = bitacora.filter(b => esHoy(b.fecha));
    const rebotes = ent.filter(m => /rebote|bounce/i.test(m.estado || ''));
    const bajas = bitHoy.filter(b => b.accion === 'baja' || b.decision === 'baja');
    const viejas = pendientes.filter(a => Date.now() - new Date(a.creado_en).getTime() > 48 * 3600e3);

    const metricas = {
      fecha: hoy,
      enviados_email: sal.filter(x => x.canal === 'email').length,
      enviados_wa: sal.filter(x => x.canal === 'whatsapp').length,
      bloqueados: bitHoy.filter(b => b.decision === 'bloqueado').length,
      diferidos: bitHoy.filter(b => b.decision === 'diferido').length,
      pendientes_aprobacion: pendientes.length,
      respuestas: ent.length,
      bajas: bajas.length,
      costo_api_usd: +bitHoy.reduce((a, b) => a + Number(b.costo_usd || 0), 0).toFixed(4),
    };

    // Cinco alarmas deterministas. No dependen del criterio de un modelo.
    const n = sal.length;
    const tasa = (x) => n ? x / n : 0;
    const alarmas = [];
    if (tasa(rebotes.length) > 0.03)
      alarmas.push({ nivel: 'grave', que: `Rebotes en ${(tasa(rebotes.length) * 100).toFixed(1)}% (tope 3%). Problema de entregabilidad.` });
    if (tasa(bajas.length) > 0.05)
      alarmas.push({ nivel: 'grave', que: `Bajas en ${(tasa(bajas.length) * 100).toFixed(1)}% (tope 5%). El mensaje está mal, no el volumen.` });
    if (viejas.length) alarmas.push({ nivel: 'medio', que: `${viejas.length} aprobaciones esperando hace más de 48 horas.` });
    if (pendientes.length > 20) alarmas.push({ nivel: 'medio', que: `${pendientes.length} pendientes: a este ritmo la cola no se vacía.` });
    const totalSal = mensajes.filter(x => x.direccion === 'saliente').length;
    const totalEnt = mensajes.filter(x => x.direccion === 'entrante').length;
    if (totalSal >= 50 && totalEnt === 0)
      alarmas.push({ nivel: 'grave', que: '50 envíos sin una sola respuesta. Revisar si están llegando a spam.' });

    await db.upsert('Metricas', metricas, 'fecha');

    const { salida: s, costo } = await agenteSupervisor({ metricas, alarmas });

    if (s.activar_pausa) {
      await db.guardarConfig('pausa_general', 'TRUE',
        `Pausada automáticamente por el Supervisor el ${new Date().toISOString()}: ${s.razon_pausa || ''}`);
    }

    await avisarOperador(
      `Lokigi · cierre del ${hoy}${s.activar_pausa ? ' — SISTEMA PAUSADO' : ''}`,
      `${s.resumen}\n\n${s.activar_pausa ? `⚠ El sistema quedó PAUSADO: ${s.razon_pausa}\nPara reanudar, poné pausa_general en FALSE.\n\n` : ''}` +
      `Enviados: ${metricas.enviados_email} email · ${metricas.enviados_wa} WhatsApp\n` +
      `Respuestas: ${metricas.respuestas} · Bajas: ${metricas.bajas}\n` +
      `Bloqueados: ${metricas.bloqueados} · Diferidos: ${metricas.diferidos}\n` +
      `Esperando tu visto bueno: ${metricas.pendientes_aprobacion}\n` +
      `Gasto de API: USD ${metricas.costo_api_usd}\n\n${APP()}`
    );

    await db.agregar('Bitacora', {
      agente: 'supervisor', accion: 'cierre_diario', decision: s.activar_pausa ? 'pausa' : 'ok',
      razon: s.resumen.slice(0, 500), costo_usd: costo,
    });

    return { metricas, alarmas, pausa: s.activar_pausa };
  },

  /**
   * El espejo en Google Sheets.
   *
   * Vuelca lo que hay en Postgres a una planilla, entero, todas las noches.
   * La planilla no manda: es para mirar desde el celular, armar una tabla
   * dinámica o compartirle números a alguien sin darle acceso al panel. Si la
   * rompés, la próxima corrida la rehace.
   *
   * Lo único que se lee de vuelta es la columna de notas, y lo que dice ahí no
   * cambia ninguna decisión del sistema — se muestra al lado del lead y nada
   * más. Ver la explicación larga en lib/integrations/workspace.js.
   */
  async espejo() {
    if (!ws.configurado()) return { saltada: true, razon: 'Workspace sin credenciales' };

    let id = await db.config('sheets_espejo_id', null);
    let creada = false;
    if (!id) {
      const nueva = await ws.crearPlanillaEspejo(`Lokigi — tablero (${process.env.AGENCIA_NOMBRE || 'operación'})`);
      id = nueva.id;
      creada = true;
      await db.guardarConfig('sheets_espejo_id', id, 'Planilla espejo. Borrar esta fila hace que se cree una nueva.');
      await db.guardarConfig('sheets_espejo_url', nueva.url, 'Enlace al tablero espejo');
    }

    const [leads, actividad, benchmarks, metricas] = await Promise.all([
      db.espejoLeads(), db.espejoActividad(), db.espejoBenchmarks(), db.espejoMetricas(),
    ]);

    const hojas = {
      Leads: leads, Actividad: actividad, Benchmarks: benchmarks, Métricas: metricas,
    };

    const res = { planilla: id, creada, hojas: {} };
    for (const [nombre, filas] of Object.entries(hojas)) {
      if (!filas?.length) { res.hojas[nombre] = 0; continue; }
      // Una hoja por vez, no en paralelo: Sheets limita a 60 escrituras por
      // minuto por usuario y cuatro volcados simultáneos con su formateo
      // pueden rozar el tope justo cuando la planilla creció.
      const r = await ws.volcarHoja(id, nombre, ws.aGrilla(filas)).catch(e => ({ error: e.message }));
      res.hojas[nombre] = r.error ? `error: ${r.error}` : r.filas;
    }

    if (creada) {
      await avisarOperador(
        'Lokigi · tu tablero en Sheets ya está',
        `Se creó la planilla espejo:\n\nhttps://docs.google.com/spreadsheets/d/${id}\n\n` +
        'Se rehace sola todas las noches a las 2. Es para mirar: editarla no cambia nada del sistema. ' +
        'Si querés dejar una nota sobre un lead, usá la columna Z de la hoja Leads — aparece en el panel.'
      );
    }
    return res;
  },

  /** Día 1: re-auditar clientes con la MISMA rúbrica con la que se vendió. */
  async postventa() {
    const clientes = await db.leer('Clientes');
    const activos = clientes.filter(c => !c.baja_en);
    const { detallePlace } = await import('../../../../lib/integrations/places.js');
    const res = { clientes: activos.length, reportes: 0, alertas: 0 };

    for (const c of activos) {
      try {
        const perfil = desdePlacesApi(await detallePlace(c.lead_id, { conResenas: true }));
        const r = auditar(perfil);
        const delta = r.score - (c.score_inicial ?? r.score);

        await db.actualizar('Clientes', { id: c.id, score_actual: r.score });

        const lead = await db.uno('Leads', l => l.id === c.lead_id);
        const periodo = new Date(Date.now() - 15 * 86400e3).toISOString().slice(0, 7);

        const { enviar } = await import('../../../../lib/integrations/gmail.js');
        const texto = `Hola,\n\nVa el reporte de ${lead?.negocio} correspondiente a ${periodo}.\n\n` +
          `El puntaje del perfil pasó de ${c.score_inicial} a ${r.score} sobre 100 ` +
          `(${delta >= 0 ? '+' : ''}${delta} puntos).\n\nCualquier cosa me escribís.`;
        await enviar({ para: lead.email, asunto: `${lead.negocio} — reporte de ${periodo} (${r.score}/100)`,
                       textoPlano: texto, html: texto.split('\n\n').map(p => `<p>${p}</p>`).join('') });
        res.reportes++;

        if (delta < 0) {
          await avisarOperador(
            `Lokigi · ${lead.negocio} retrocedió ${delta} puntos`,
            `El puntaje bajó de ${c.score_inicial} a ${r.score}. Riesgo de baja: llamar antes de que lo note el cliente.`
          );
          res.alertas++;
        }
      } catch (e) {
        await db.agregar('Bitacora', { agente: 'postventa', accion: 'reporte', lead_id: c.lead_id,
                                       decision: 'error', razon: e.message.slice(0, 300) });
      }
    }
    return res;
  },
};

// ── Auxiliares ────────────────────────────────────────────────────────

async function encolar(intento, veredicto) {
  const id = veredicto.id || huella(intento);
  const ya = await db.uno('Aprobaciones', f => f.id === id, { sinCache: true });
  if (ya) return;
  await db.agregar('Aprobaciones', {
    id, lead_id: intento.leadId, negocio: intento.negocio, canal: intento.canal,
    paso: intento.paso, destinatario: intento.destinatario, asunto: intento.asunto,
    cuerpo: intento.cuerpo, motivo: veredicto.razon,
    advertencias: (veredicto.detalle?.avisos || []).join(' · '),
  });
}

async function enviarYRegistrar(intento, aprobadoPor) {
  const { enviar } = await import('../../../../lib/integrations/gmail.js');

  // Dos URLs distintas para la misma baja, y la diferencia importa:
  //   · la visible, que abre una pantalla con un botón. Un GET no da de baja,
  //     porque los escáneres de enlaces de los antivirus visitan todo lo que
  //     hay en un correo antes de entregarlo.
  //   · la de la cabecera List-Unsubscribe, que recibe el POST de un clic que
  //     manda Gmail desde su propia interfaz y sí ejecuta al instante.
  const lead = encodeURIComponent(intento.leadId);
  const urlBajaVisible = `${APP()}/baja?lead=${lead}`;
  const urlBaja = `${APP()}/api/baja?lead=${lead}`;

  const html = intento.cuerpo.split('\n\n')
    .map(p => `<p style="margin:0 0 16px">${p.replace(/\n/g, '<br>')}</p>`).join('') +
    `<hr style="border:none;border-top:1px solid #e4e7ec;margin:26px 0 14px">` +
    `<p style="margin:0;font-size:12px;color:#8b93a1">${process.env.AGENCIA_NOMBRE || 'Lokigi'} · ` +
    `Recibís esto porque el perfil de tu negocio figura públicamente en Google Maps. ` +
    `<a href="${urlBajaVisible}">Darse de baja</a> — se procesa al instante y de forma definitiva.</p>`;

  const r = await enviar({
    para: intento.destinatario, asunto: intento.asunto,
    textoPlano: intento.cuerpo, html, urlBaja,
  });

  await db.agregar('Mensajes', {
    id: huella(intento), lead_id: intento.leadId, direccion: 'saliente', canal: intento.canal,
    paso: intento.paso, asunto: intento.asunto, cuerpo: intento.cuerpo,
    proveedor_id: r.id, estado: 'enviado', agente: intento.agente, aprobado_por: aprobadoPor,
    costo_usd: intento.costo ?? 0,
  });

  // `toques` se incrementa en Postgres, no acá: dos tareas pueden tocar el
  // mismo lead en la misma corrida y un leer-sumar-guardar perdería un toque.
  // Perder un toque significa escribirle de más a alguien, que es exactamente
  // lo que el tope de la secuencia existe para evitar.
  const actual = SECUENCIA_PROSPECCION.find(p => p.paso === intento.paso);
  const siguiente = SECUENCIA_PROSPECCION.find(p => p.paso === (intento.paso || 1) + 1);
  const proximo = siguiente
    ? new Date(Date.now() + (siguiente.diaRelativo - (actual?.diaRelativo ?? 0)) * 86400e3).toISOString()
    : null;

  await db.registrarToque(intento.leadId, proximo);
  return r;
}

/**
 * Arma la propuesta comercial cuando el prospecto pregunta el precio.
 *
 * Los números no los escribe nadie: salen de `quote-engine.js`, que es
 * determinista, y quedan congelados en la tabla `propuestas`. Si dentro de seis
 * meses el cliente pregunta por qué le cobraste eso, está la cifra exacta que
 * se le dijo ese día, no la que devolvería el motor hoy.
 *
 * Esta función NO envía nada. Deja el documento hecho y avisa; el mensaje con
 * el enlace lo redacta el agente y lo autoriza el guardián, igual que todos.
 */
async function prepararPropuesta(lead) {
  const previa = await db.propuestasDe(lead.id);
  if (previa?.some(p => !p.rechazada_en)) return null;   // ya hay una viva

  const { detallePlace } = await import('../../../../lib/integrations/places.js');
  const perfil = desdePlacesApi(await detallePlace(lead.id, { conResenas: true }));
  const auditoria = auditar(perfil);

  const [moneda, tipoCambio, tarifa] = await Promise.all([
    db.config('moneda', 'ars'),
    db.config('tipo_cambio', null),
    db.config('tarifa_hora_usd', 22),
  ]);

  const planes = generarPresupuestos(auditoria, {
    moneda, tipoCambio: tipoCambio ? Number(tipoCambio) : null, tarifaHoraUSD: Number(tarifa),
  });
  const plan = planes.find(p => p.recomendado) || planes[0];
  if (!plan) return null;

  const alternativas = generarAlternativasReduccion(plan, auditoria, {
    moneda, tipoCambio: tipoCambio ? Number(tipoCambio) : null,
  });

  let doc = null;
  if (ws.configurado()) {
    doc = await ws.crearPropuesta({
      negocio: lead.negocio, plan, alternativas, auditoria,
      carpetaId: await db.config('drive_carpeta_propuestas', null),
    }).catch(() => null);
  }

  const ars = plan.moneda === 'ARS';
  await db.guardarPropuesta({
    lead_id: lead.id, nivel: plan.clave, moneda: plan.moneda,
    setup: ars ? plan.setupARS : plan.setupUSD,
    mensual: ars ? plan.mensualARS : plan.mensualUSD,
    plan: { plan, alternativas },
    doc_id: doc?.id ?? null, doc_url: doc?.url ?? null,
    version_rubrica: auditoria.meta.version,
  });

  if (doc) {
    await db.actualizar('Leads', { id: lead.id, doc_propuesta_url: doc.url, etapa: 'presupuestado' });
  }

  await avisarOperador(
    `Lokigi · propuesta lista — ${lead.negocio}`,
    `${lead.negocio} preguntó precio. La propuesta ya está armada:\n\n${doc?.url || '(sin Docs: revisala en el panel)'}\n\n` +
    `Plan ${plan.nombre}: puesta en marcha ${ars ? plan.setupARS : plan.setupUSD} ${plan.moneda}, ` +
    `mensual ${ars ? plan.mensualARS : plan.mensualUSD} ${plan.moneda}.\n` +
    `Proyección: de ${auditoria.score} a ${plan.scoreProyectado} puntos.\n\n` +
    `Leela antes de que salga. El mensaje que la acompaña va a aparecer en ${APP()}/aprobaciones.`
  );

  return doc;
}

/**
 * Agenda la llamada cuando el prospecto eligió un horario.
 *
 * El evento se crea SIN avisarle a él: Google mandaría la invitación por su
 * cuenta, y eso es un mensaje que llega a la casilla de un tercero sin pasar
 * por el guardián. El evento queda en tu calendario con el enlace de Meet, y
 * quien se lo comunica es el mensaje que el guardián sí autorizó.
 *
 * Si el modelo se equivocó al interpretar la respuesta, lo peor que pasa es un
 * evento de más en tu agenda. Nadie recibe nada.
 */
async function agendar(lead, horario) {
  const evento = await ws.agendarLlamada({
    negocio: lead.negocio,
    email: lead.email,
    inicio: horario.inicio,
    fin: horario.fin,
    avisar: false,
    notas: `Repaso de la auditoría de ${lead.negocio} (${lead.score}/100). ` +
           `Informe: ${lead.informe_url || '—'}`,
    calendarId: await db.config('calendar_id', 'primary'),
  });

  await db.actualizar('Leads', {
    id: lead.id,
    etapa: 'interesado',
    evento_url: evento.url,
    agendado_en: horario.inicio,
    // Ya eligió: se limpia la lista para que una respuesta posterior no
    // vuelva a interpretarse como una elección.
    horarios_ofrecidos: null,
  });

  await avisarOperador(
    `Lokigi · ${lead.negocio} eligió un horario`,
    `${lead.negocio} confirmó para ${horario.etiqueta}.\n\n` +
    `El evento ya está en tu calendario con el enlace de Meet:\n${evento.url}\n` +
    (evento.meet ? `Meet: ${evento.meet}\n` : '') +
    `\nOJO: NO se le mandó la invitación. El mensaje que se lo confirma sale por el ` +
    `circuito normal y lo vas a ver en la cola de aprobación.`
  );

  return evento;
}

const registrarFalla = (agente, leadId, e) =>
  db.agregar('Bitacora', {
    agente, accion: 'preparar', lead_id: leadId,
    decision: 'error', razon: String(e?.message || e).slice(0, 400),
  }).catch(() => {});

async function avisarOperador(asunto, texto) {
  const para = process.env.EMAIL_OPERADOR;
  if (!para) return;
  const { enviar } = await import('../../../../lib/integrations/gmail.js');
  await enviar({ para, asunto, textoPlano: texto,
                 html: texto.split('\n\n').map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('') })
    .catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────

export async function POST(req, { params }) {
  if (!autorizado(req)) return NextResponse.json({ error: 'no autorizado' }, { status: 401 });

  const { tarea } = await params;
  const fn = TAREAS[tarea];
  if (!fn) return NextResponse.json({ error: `tarea desconocida: ${tarea}` }, { status: 404 });

  const t0 = Date.now();
  try {
    const salida = await fn();
    return NextResponse.json({ ok: true, tarea, ms: Date.now() - t0, ...salida });
  } catch (e) {
    // El error se registra pero la respuesta es 200: si devolviera 500, pg_cron
    // reintentaría y podría duplicar trabajo ya hecho a medias.
    await db.agregar('Bitacora', {
      agente: tarea, accion: 'tarea_programada', decision: 'error', razon: e.message.slice(0, 500),
    }).catch(() => {});
    return NextResponse.json({ ok: false, tarea, error: e.message, ms: Date.now() - t0 });
  }
}

export const GET = POST;   // Vercel Cron usa GET
