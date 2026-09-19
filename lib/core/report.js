/**
 * report.js — Genera el informe de diagnóstico en HTML autocontenido.
 *
 * El informe es el producto que se le entrega al prospecto antes de pedirle
 * nada. Tiene que poder leerse en el celular, en 3 minutos, y dejar claro:
 *   1. Qué está bien (empezar por acá: nadie escucha después de un reproche)
 *   2. Qué está mal, con evidencia y fundamento citado
 *   3. Qué se hace al respecto
 *
 * No incluye precios. El presupuesto es una conversación aparte y posterior.
 */

import { SEVERIDAD } from './rubric.js';
import { contradicciones, temasRecurrentes } from './resenas.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fecha = (iso) => new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });

export function generarInformeHTML(auditoria, opts = {}) {
  const {
    agencia = 'Tu Agencia',
    remitente = '',
    contacto = '',
    comparacion = null,
    ctaUrl = opts.ctaUrl || `${(process.env.NEXT_PUBLIC_APP_URL || 'https://lokigi.vercel.app').replace(/\/$/, '')}/#pedir`,
    logoUrl = '',
  } = opts;

  const m = auditoria.meta;
  const b = auditoria.banda;
  const topHallazgos = auditoria.hallazgos.slice(0, 8);
  const topFortalezas = auditoria.fortalezas.slice(0, 6);

  const perfil = auditoria.perfil || {
    ...auditoria.meta,
    resenasMuestra: auditoria.resenasMuestra || auditoria.meta?.resenasMuestra || [],
  };
  const conts = contradicciones(perfil);
  const temas = temasRecurrentes(perfil);
  const totalResenasMuestra = (perfil.resenasMuestra || []).length;
  const tieneSeccionResenas = conts.length > 0 || temas.length > 0;

  const nReparte = '01';
  const nFortalezas = topFortalezas.length ? '02' : null;
  const nHallazgos = topFortalezas.length ? '03' : '02';
  const nResenas = tieneSeccionResenas ? (topFortalezas.length ? '04' : '03') : null;
  const nNoVerificados = auditoria.noVerificados.length
    ? (tieneSeccionResenas ? (topFortalezas.length ? '05' : '04') : (topFortalezas.length ? '04' : '03'))
    : null;

  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Auditoría de ${esc(m.negocio)} — ${agencia}</title>
<style>
  :root{--tinta:#0f172a;--suave:#475569;--linea:#e2e8f0;--fondo:#f8fafc;--acento:#2563eb;--banda:${b.color}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--fondo);color:var(--tinta);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
  .wrap{max-width:800px;margin:0 auto;padding:36px 24px 80px}
  header{border-bottom:1px solid var(--linea);padding-bottom:28px;margin-bottom:36px}
  .kicker{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#2563eb;font-weight:700;display:inline-flex;align-items:center;gap:6px}
  .kicker::before{content:"";display:inline-block;width:6px;height:6px;border-radius:99px;background:#2563eb}
  h1{font-size:32px;line-height:1.2;margin:10px 0 8px;letter-spacing:-.025em;color:var(--tinta);font-weight:800}
  .sub{color:var(--suave);font-size:14.5px;line-height:1.5}
  .puntaje{display:flex;align-items:center;gap:28px;background:#ffffff;border:1px solid var(--linea);border-radius:16px;padding:28px;margin:32px 0;box-shadow:0 4px 6px -1px rgba(0,0,0,0.04),0 2px 4px -2px rgba(0,0,0,0.04);position:relative;overflow:hidden}
  .puntaje::before{content:"";position:absolute;top:0;left:0;bottom:0;width:5px;background:var(--banda)}
  .num{font-size:56px;font-weight:800;line-height:1;color:var(--banda);letter-spacing:-.04em}
  .num small{font-size:22px;color:#94a3b8;font-weight:600}
  .banda{display:inline-flex;align-items:center;background:var(--banda);color:#ffffff;font-size:11px;font-weight:700;padding:4px 12px;border-radius:99px;text-transform:uppercase;letter-spacing:.08em;box-shadow:0 2px 4px rgba(0,0,0,0.1)}
  h2{font-size:20px;font-weight:700;margin:44px 0 16px;letter-spacing:-.015em;color:var(--tinta);display:flex;align-items:center}
  h2 .n{color:#64748b;font-weight:600;margin-right:10px;font-size:14px;background:#f1f5f9;padding:2px 8px;border-radius:6px;border:1px solid #e2e8f0}
  .barra{height:9px;background:#f1f5f9;border-radius:99px;overflow:hidden}
  .barra i{display:block;height:100%;border-radius:99px;transition:width .4s ease}
  .dim{background:#ffffff;border:1px solid var(--linea);border-radius:12px;padding:18px 20px;margin-bottom:12px;box-shadow:0 1px 3px rgba(15,23,42,0.04);transition:transform .15s ease,box-shadow .15s ease}
  .dim:hover{box-shadow:0 4px 12px rgba(15,23,42,0.06)}
  .dim .top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:10px}
  .dim .nom{font-weight:700;font-size:15.5px;color:var(--tinta)}
  .dim .val{font-variant-numeric:tabular-nums;font-weight:800;font-size:15px}
  .dim .desc{color:var(--suave);font-size:13.5px;margin-top:10px;line-height:1.5}
  .item{background:#ffffff;border:1px solid var(--linea);border-left:4px solid var(--sev,#cbd5e1);border-radius:12px;padding:18px 20px;margin-bottom:14px;box-shadow:0 1px 3px rgba(15,23,42,0.04)}
  .item h3{font-size:16.5px;font-weight:700;margin:0 0 8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;color:var(--tinta)}
  .tag{font-size:10.5px;font-weight:800;padding:3px 9px;border-radius:99px;text-transform:uppercase;letter-spacing:.06em;color:#fff;box-shadow:0 1px 2px rgba(0,0,0,0.1)}
  .ev{color:var(--suave);font-size:14.5px;margin:8px 0;line-height:1.55}
  .rec{font-size:14.5px;margin-top:12px;padding-top:12px;border-top:1px dashed var(--linea);color:var(--tinta);line-height:1.55}
  .rec b{font-weight:700;color:var(--tinta)}
  .fuente{font-size:13px;color:var(--suave);background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-top:12px;line-height:1.5}
  .fuente a{color:var(--acento);font-weight:500}
  .ok{border-left-color:#16794a}
  .nd{background:#ffffff;border:1px dashed #cbd5e1;border-radius:12px;padding:18px 20px;color:var(--suave);font-size:14.5px}
  .chk-wrap{display:flex;align-items:center;gap:10px;margin-top:12px;background:#f8fafc;padding:10px 14px;border-radius:9px;border:1px solid var(--linea);transition:background .15s ease,border-color .15s ease}
  .chk-wrap:hover{background:#f1f5f9;border-color:#cbd5e1}
  .chk-wrap input[type="checkbox"]:focus-visible{outline:2px solid var(--acento);outline-offset:2px}
  .chk-wrap label{cursor:pointer;line-height:1.4;color:var(--tinta);font-size:13.5px;font-weight:600}
  .cta{background:linear-gradient(135deg, #0f172a 0%, #1e293b 100%);color:#ffffff;border-radius:16px;padding:32px;margin-top:52px;box-shadow:0 10px 25px -5px rgba(15,23,42,0.15)}
  .cta h2{color:#ffffff;margin-top:0;font-size:22px;font-weight:800}
  .cta p{color:#94a3b8;font-size:15px;line-height:1.6}
  .cta a{display:inline-flex;align-items:center;gap:8px;background:#ffffff;color:#0f172a;text-decoration:none;font-weight:700;font-size:14.5px;padding:12px 24px;border-radius:99px;margin-top:12px;box-shadow:0 4px 12px rgba(0,0,0,0.15);transition:transform .15s ease,background-color .15s ease}
  .cta a:hover{transform:translateY(-1px);background:#f8fafc}
  footer{margin-top:48px;padding-top:24px;border-top:1px solid var(--linea);color:#64748b;font-size:12.5px;line-height:1.6}
  table{width:100%;border-collapse:separate;border-spacing:0;font-size:14px;margin-top:12px;min-width:480px}
  th{font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:700;padding:10px 12px;border-bottom:2px solid #e2e8f0;background:#f8fafc;text-align:left}
  td{padding:10px 12px;border-bottom:1px solid var(--linea);text-align:left;color:var(--tinta)}
  .delta-neg{color:#dc2626;font-weight:700;background:#fef2f2;padding:2px 8px;border-radius:6px;display:inline-block}
  .delta-pos{color:#16a34a;font-weight:700;background:#f0fdf4;padding:2px 8px;border-radius:6px;display:inline-block}
  @media (max-width:560px){.wrap{padding:20px 14px 48px}.puntaje{flex-direction:column;align-items:flex-start;gap:16px;padding:20px 18px}.num{font-size:48px}.dim{padding:14px}.dim .top{flex-direction:column;align-items:flex-start;gap:4px}.item{padding:16px 14px}.cta{padding:24px 18px;border-radius:14px}}
  @media print{body{background:#fff}.cta{background:#f8fafc;color:var(--tinta);border:1px solid #cbd5e1}}
</style></head><body><div class="wrap">

<header>
  ${logoUrl ? `<img src="${esc(logoUrl)}" alt="${esc(agencia)}" style="height:34px;margin-bottom:14px">` : ''}
  <div class="kicker">Auditoría de perfil · Google Maps y Business Profile</div>
  <h1>${esc(m.negocio)}</h1>
  <div class="sub">${esc(m.direccion || '')}${m.categoria ? ' · ' + esc(m.categoria) : ''}<br>
  Análisis del ${fecha(m.auditadoEn)} · ${auditoria.dimensiones.reduce((a, d) => a + d.detalles.length, 0)} puntos de control</div>
</header>

<div class="puntaje">
  <div class="gauge-box" style="position:relative;width:120px;height:120px;flex-shrink:0;">
    <svg viewBox="0 0 100 100" style="width:100%;height:100%;transform:rotate(-90deg);">
      <circle cx="50" cy="50" r="42" fill="none" stroke="#e2e8f0" stroke-width="8" />
      ${auditoria.potencial > auditoria.score ? `
        <circle cx="50" cy="50" r="42" fill="none" stroke="#cbd5e1" stroke-width="8" stroke-dasharray="${+( (auditoria.potencial / 100) * 263.89 ).toFixed(2)} 263.89" stroke-linecap="round" opacity="0.4" />
      ` : ''}
      <circle cx="50" cy="50" r="42" fill="none" stroke="var(--banda)" stroke-width="8" stroke-dasharray="${+( (auditoria.score / 100) * 263.89 ).toFixed(2)} 263.89" stroke-linecap="round" />
    </svg>
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">
      <div class="num">${auditoria.score}<small>/100</small></div>
    </div>
  </div>
  <div>
    <span class="banda">${esc(b.etiqueta)}</span>
    <p style="margin:10px 0 0;font-size:15px;color:var(--tinta);font-weight:500;">${esc(b.resumen)}</p>
    ${auditoria.brecha > 0 ? `<p style="margin:8px 0 0;font-size:14px;color:var(--suave)">Techo alcanzable resolviendo lo detectado: <b style="color:var(--tinta)">${auditoria.potencial}/100</b> (+${auditoria.brecha} puntos).</p>` : ''}
  </div>
</div>

${comparacion ? bloqueComparacion(comparacion) : ''}

<h2><span class="n">${nReparte}</span>Cómo se reparte el puntaje</h2>
${auditoria.dimensiones.map(d => `
<div class="dim">
  <div class="top"><span class="nom">${esc(d.nombre)}</span><span class="val" style="color:${colorScore(d.score)}">${d.score == null ? '—' : d.score + '/100'}</span></div>
  <div class="barra"><i style="width:${d.score ?? 0}%;background:${colorScore(d.score)}"></i></div>
  <div class="desc">${esc(d.descripcion)}${d.cobertura < 100 ? ` <em>(${d.cobertura}% de esta sección pudo verificarse con datos públicos)</em>` : ''}</div>
</div>`).join('')}

${topFortalezas.length ? `
<h2><span class="n">${nFortalezas}</span>Lo que ya está bien resuelto</h2>
<p style="color:var(--suave);font-size:14.5px;margin-top:-4px">Esto no es relleno: son las bases sobre las que conviene construir, y lo que no habría que tocar.</p>
${topFortalezas.map(f => `
<div class="item ok">
  <h3>${esc(f.titulo)}</h3>
  <div class="ev">${esc(f.evidencia)}</div>
</div>`).join('')}` : ''}

<h2><span class="n">${nHallazgos}</span>Puntos a mejorar</h2>
<p style="color:var(--suave);font-size:14.5px;margin-top:-4px">Ordenados por impacto real sobre el puntaje, no por facilidad. Cada uno incluye el fundamento en el que se apoya.</p>
${topHallazgos.map(h => {
  const sev = SEVERIDAD[h.severidad];
  const chkId = `chk-${esc(m.placeId || 'demo')}-${esc(h.id)}`;
  return `
<div class="item" style="--sev:${sev.color}">
  <h3>${esc(h.titulo)} <span class="tag" style="background:${sev.color}">${sev.etiqueta}</span>
    <span style="font-size:12.5px;color:var(--suave);font-weight:400">−${h.puntosPerdidos} pts · ${esc(h.dimensionNombre)}</span></h3>
  <div class="ev"><b>Lo que se observa:</b> ${esc(h.evidencia)}</div>
  <div class="rec"><b>Qué hacer:</b> ${esc(h.recomendacion)}</div>
  ${h.comoSeArregla ? `
  <div style="font-size:14px;margin-top:10px;padding-top:10px;border-top:1px dashed var(--linea)">
    <b>Cómo resolverlo tú mismo:</b> <span style="font-size:12.5px;color:var(--suave)">(${esc(h.comoSeArregla.donde)} · ~${h.comoSeArregla.minutos} min)</span>
    <ol style="margin:6px 0 10px;padding-left:20px;font-size:13.5px;color:var(--tinta)">
      ${h.comoSeArregla.pasos.map(p => `<li style="margin-bottom:3px">${esc(p)}</li>`).join('')}
    </ol>
  </div>` : ''}
  <div class="chk-wrap" style="display:flex;align-items:center;gap:10px;margin-top:10px;background:#f8fafc;padding:8px 12px;border-radius:8px;border:1px solid var(--linea)">
    <input type="checkbox" class="chk-tarea" id="${chkId}" data-place="${esc(m.placeId || 'demo')}" data-rule="${esc(h.id)}" style="width:18px;height:18px;cursor:pointer;accent-color:var(--acento)">
    <label for="${chkId}" style="font-size:13.5px;font-weight:500;cursor:pointer;user-select:none">Marcar como resuelto</label>
  </div>
  ${h.fuente ? `<div class="fuente"><b>Fundamento:</b> ${esc(h.fuente.texto)}<br><span style="opacity:.75">${esc(h.fuente.ref)}</span></div>` : ''}
</div>`;
}).join('')}
${auditoria.hallazgos.length > 8 ? `<p style="color:var(--suave);font-size:14px">Hay ${auditoria.hallazgos.length - 8} punto(s) adicional(es) de menor impacto en el detalle completo.</p>` : ''}

${tieneSeccionResenas ? `
<h2><span class="n">${nResenas}</span>Observaciones en las reseñas de los clientes</h2>
<p style="color:var(--suave);font-size:14.5px;margin-top:-4px">Análisis cruzado realizado sobre las ${totalResenasMuestra} reseña(s) de muestra provistas por Google Maps.</p>
${conts.map(c => `
<div class="item" style="border-left-color:#c2410c">
  <h3>Contradicción detectada en ${esc(c.campo)}</h3>
  <div class="ev"><b>Reseña textual:</b> “${esc(c.cita)}” ${c.fecha ? `<span style="color:var(--suave);font-size:13px">(${esc(c.fecha)})</span>` : ''}</div>
  <div class="rec"><b>Inconsistencia:</b> El testimonio del cliente contradice la información registrada en el campo <b>${esc(c.campo)}</b> del perfil.</div>
</div>`).join('')}
${temas.length ? `
<div class="item">
  <h3>Temas recurrentes entre clientes</h3>
  <div class="ev">${temas.map(t => `<b>${esc(t.tema)}</b> (${t.repeticiones} reseñas)`).join(' · ')}</div>
</div>` : ''}` : ''}

${auditoria.noVerificados.length ? `
<h2><span class="n">${nNoVerificados}</span>Lo que no pudimos verificar</h2>
<p style="color:var(--suave);font-size:14.5px;margin-top:-4px">Preferimos decir "no lo sé" antes que estimar. Estos puntos quedaron fuera del cálculo del puntaje y se revisan en la primera reunión.</p>
<div class="nd"><ul style="margin:0;padding-left:18px">
${auditoria.noVerificados.map(n => `<li><b style="color:var(--tinta)">${esc(n.titulo)}</b> — ${esc(n.evidencia)}</li>`).join('')}
</ul></div>` : ''}

${opts.muestraBarrido ? bloqueMuestraBarrido(opts.muestraBarrido) : ''}

<div class="cta">
  <h2 style="margin-top:0">${esc(agencia)}</h2>
  <p>Este informe se generó automáticamente con datos públicos del perfil de ${esc(m.negocio)} en Google Maps${auditoria.meta.cobertura < 100 ? ` (cobertura de datos: ${auditoria.meta.cobertura}%)` : ''}. Podés usarlo por tu cuenta, con nosotros o con quien quieras.</p>
  ${ctaUrl ? `<a href="${esc(ctaUrl)}">Ver qué se haría con esto</a>` : ''}
</div>

<footer>
  Metodología v${esc(m.version)} · ${auditoria.dimensiones.reduce((a,d)=>a+d.detalles.length,0)} puntos de control ponderados sobre ${auditoria.dimensiones.length} dimensiones · puntaje determinista y reproducible.<br>
  ${remitente ? esc(remitente) + ' — ' : ''}${esc(agencia)}. Datos obtenidos del perfil público de Google Maps${m.mapsUrl ? ` (<a href="${esc(m.mapsUrl)}" style="color:inherit">ver perfil</a>)` : ''}.<br>
  Si no querés recibir más comunicaciones, respondé "BAJA" al mensaje con el que recibiste este informe y damos de baja tus datos.
</footer>

<script>
(function() {
  try {
    var inputs = document.querySelectorAll('.chk-tarea');
    inputs.forEach(function(chk) {
      var place = chk.getAttribute('data-place') || 'demo';
      var rule = chk.getAttribute('data-rule');
      var key = 'lokigi_hecho_' + place + '_' + rule;
      try {
        if (localStorage.getItem(key) === '1') {
          chk.checked = true;
        }
      } catch (e) {}

      chk.addEventListener('change', function() {
        try {
          if (chk.checked) {
            localStorage.setItem(key, '1');
          } else {
            localStorage.removeItem(key);
          }
        } catch (e) {}
      });
    });
  } catch (e) {}
})();
</script>

</div></body></html>`;
}

function colorScore(s) {
  if (s == null) return '#94a3b8';
  if (s >= 85) return '#16794a';
  if (s >= 70) return '#3f7d20';
  if (s >= 50) return '#b8860b';
  if (s >= 30) return '#c2410c';
  return '#b91c1c';
}

function bloqueComparacion(c) {
  return `
<h2><span class="n">00</span>Frente a la competencia directa</h2>
<p style="color:var(--suave);font-size:14.5px;margin-top:-4px">Mismos ${Object.keys(c.porDimension).length} criterios aplicados a los perfiles que hoy aparecen arriba en la misma búsqueda.</p>
<div class="dim">
  <div class="top"><span class="nom">Posición en el grupo analizado</span><span class="val">${c.posicion}º de ${c.total}</span></div>
  <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;">
    <table>
      <tr><th>Dimensión</th><th>Este perfil</th><th>Promedio competencia</th><th>Diferencia</th></tr>
      ${Object.values(c.porDimension).map(d => `<tr>
        <td>${esc(d.nombre)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-weight:700;min-width:24px;">${d.propio ?? '—'}</span>
            <div style="flex:1;max-width:70px;height:7px;background:#e2e8f0;border-radius:99px;overflow:hidden;">
              <div style="width:${Math.min(100, Math.max(0, d.propio ?? 0))}%;height:100%;background:${colorScore(d.propio)};border-radius:99px;"></div>
            </div>
          </div>
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="min-width:24px;">${d.competencia}</span>
            <div style="flex:1;max-width:70px;height:7px;background:#e2e8f0;border-radius:99px;overflow:hidden;">
              <div style="width:${Math.min(100, Math.max(0, d.competencia ?? 0))}%;height:100%;background:#94a3b8;border-radius:99px;"></div>
            </div>
          </div>
        </td>
        <td class="${d.delta < 0 ? 'delta-neg' : 'delta-pos'}">${d.delta > 0 ? '+' : ''}${d.delta}</td>
      </tr>`).join('')}
    </table>
  </div>
</div>`;
}

/** Versión corta para el cuerpo del email/WhatsApp. Selecciona el primer hallazgo evidente (evidente === true). */
export function resumenCorto(auditoria) {
  const hallazgos = auditoria.hallazgos || [];
  const h = hallazgos.find(x => x.evidente) || hallazgos[0];
  return {
    score: auditoria.score,
    banda: auditoria.banda.etiqueta.toLowerCase(),
    hallazgoTop: h ? h.titulo : 'El perfil está sólido en los puntos de control principales',
    hallazgoTopDetalle: h ? `${h.evidencia} ${h.recomendacion}` : '',
    potencial: auditoria.potencial,
  };
}

function bloqueMuestraBarrido(mb) {
  if (!mb || !mb.total) return '';

  const catNom = esc(mb.categoria || 'tu rubro').toLowerCase();
  const pluralCat = catNom.endsWith('s') ? catNom : (/[aeiouáéíóú]$/i.test(catNom) ? `${catNom}s` : `${catNom}es`);

  if (mb.pocoCompetida) {
    return `
<h2>Y cómo estás frente a tu cuadra</h2>
<div class="dim">
  <p style="margin:0;font-size:15px;color:var(--tinta)">
    Hay pocos competidores directos en tu zona (encontramos solo ${mb.total} negocio${mb.total === 1 ? '' : 's'} dentro de 4 km).
  </p>
  <div class="fuente" style="margin-top:12px">
    <b>Límite del relevamiento:</b> Esto sale de una pasada rápida sobre lo que Google muestra en la búsqueda. Para decirte en qué puesto estás en el grupo hay que abrir ficha por ficha —cuántas reseñas responde cada uno, qué tan frescas son sus fotos— y eso no entra en una pasada automática.
  </div>
</div>`;
  }

  return `
<h2>Y cómo estás frente a tu cuadra</h2>
<div class="dim">
  <p style="margin:0 0 12px;font-size:15px;font-weight:600;color:var(--tinta)">
    Hay ${mb.total} ${pluralCat} dentro de 4 km de la tuya.
  </p>
  <ul style="margin:0 0 14px;padding-left:20px;font-size:14.5px;color:var(--tinta)">
    ${(mb.hechos || []).map(h => `<li style="margin-bottom:6px">${esc(h)}</li>`).join('')}
  </ul>
  <div class="fuente" style="margin-top:12px">
    <b>Límite del relevamiento:</b> Esto sale de una pasada rápida sobre lo que Google muestra en la búsqueda. Para decirte en qué puesto estás en el grupo hay que abrir ficha por ficha —cuántas reseñas responde cada uno, qué tan frescas son sus fotos— y eso no entra en una pasada automática.
  </div>
</div>`;
}

export function bloqueComparacionCompleto(c) {
  if (!c) return '';

  const porDim = c.porDimension || {};
  const cercs = c.anilloCercano?.competidores || (Array.isArray(c.anilloCercano) ? c.anilloCercano : []);
  const p1 = c.parrafos?.parrafo1 || '';
  const p2 = c.parrafos?.parrafo2 || '';

    const hm = c.huecoMercado;
  const lr = c.liderYReceta;
  const ue = c.umbralEntrada;

  const bloqueHueco = (hm && hm.sePublica && hm.huecos?.length) ? `
  <div style="background:#fffbebfb;border:1px solid #fde68a;border-left:4px solid #d97706;border-radius:8px;padding:12px 14px;margin-top:12px;font-size:14px;color:#78350f;">
    <b style="color:#b45309">El hueco del mercado:</b>
    <ul style="margin:6px 0 0;padding-left:18px">
      ${hm.huecos.map(h => `<li style="margin-bottom:4px">${esc(h.texto)}</li>`).join('')}
    </ul>
  </div>` : '';

  const bloqueLider = (lr && lr.sePublica && lr.texto) ? `
  <div style="background:#f0f9ff;border:1px solid #bae6fd;border-left:4px solid #0284c7;border-radius:8px;padding:12px 14px;margin-top:12px;font-size:14px;color:#0369a1;">
    <b style="color:#0369a1">El líder y su receta:</b>
    <p style="margin:4px 0 0">${esc(lr.texto)}</p>
  </div>` : '';

  const bloqueUmbral = (ue && ue.sePublica && ue.texto) ? `
  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-left:4px solid #16a34a;border-radius:8px;padding:12px 14px;margin-top:12px;font-size:14px;color:#15803d;">
    <b style="color:#15803d">El umbral de entrada:</b>
    <p style="margin:4px 0 0">${esc(ue.texto)}</p>
  </div>` : '';

  return `
<h2><span class="n">00</span>Frente a la competencia directa</h2>
<p style="color:var(--suave);font-size:14.5px;margin-top:-4px">Mismos ${Object.keys(porDim).length} criterios aplicados a los perfiles que hoy aparecen arriba en la misma búsqueda.</p>
<div class="dim">
  <div class="top"><span class="nom">Posición en el grupo analizado</span><span class="val">${c.posicion || '—'}º de ${c.resumen?.totalCompetidores || c.total || '—'}</span></div>
  <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;margin-bottom:16px;">
    <table>
      <tr><th>Dimensión</th><th>Este perfil</th><th>Promedio competencia</th><th>Diferencia</th></tr>
      ${Object.values(porDim).map(d => `<tr>
        <td>${esc(d.nombre)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-weight:700;min-width:24px;">${d.propio ?? '—'}</span>
            <div style="flex:1;max-width:70px;height:7px;background:#e2e8f0;border-radius:99px;overflow:hidden;">
              <div style="width:${Math.min(100, Math.max(0, d.propio ?? 0))}%;height:100%;background:${colorScore(d.propio)};border-radius:99px;"></div>
            </div>
          </div>
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="min-width:24px;">${d.competencia}</span>
            <div style="flex:1;max-width:70px;height:7px;background:#e2e8f0;border-radius:99px;overflow:hidden;">
              <div style="width:${Math.min(100, Math.max(0, d.competencia ?? 0))}%;height:100%;background:#94a3b8;border-radius:99px;"></div>
            </div>
          </div>
        </td>
        <td class="${d.delta < 0 ? 'delta-neg' : 'delta-pos'}">${d.delta > 0 ? '+' : ''}${d.delta}</td>
      </tr>`).join('')}
    </table>
  </div>

  ${cercs.length ? `
  <div style="border-top:1px dashed var(--linea);padding-top:14px;margin-top:14px;">
    <p style="margin:0 0 10px;font-size:14.5px;font-weight:600;color:var(--tinta)">Los cinco vecinos más cercanos (análisis detallado uno por uno):</p>
    <ul style="margin:0 0 14px;padding-left:20px;font-size:14px;color:var(--tinta)">
      ${cercs.slice(0, 5).map(v => `
        <li style="margin-bottom:6px">
          <b>${esc(v.nombre)}</b> (${v.distanciaMetros ? v.distanciaMetros + 'm' : (v.distancia_m ? v.distancia_m + 'm' : 'cercano')}) — Puntaje: <b>${v.auditoria?.score ?? v.score ?? '—'}/100</b>
        </li>
      `).join('')}
    </ul>
  </div>` : ''}

  ${(p1 || p2) ? `
  <div style="background:#f8fafc;border:1px solid var(--linea);border-radius:8px;padding:12px 14px;margin-top:12px;font-size:14px;color:var(--tinta);">
    ${p1 ? `<p style="margin:0 0 8px">${esc(p1)}</p>` : ''}
    ${p2 ? `<p style="margin:0">${esc(p2)}</p>` : ''}
  </div>` : ''}

  ${bloqueHueco}
  ${bloqueLider}
  ${bloqueUmbral}
</div>`;
}

/**
 * Eleva un informe congelado existente sustituyendo la muestra por el bloque completo de competencia.
 * INVARIANTE CRÍTICO: Mantiene el puntaje, dimensiones, hallazgos y meta byte a byte idénticos.
 */
export function upgradeInformeHTML(htmlOriginal, comparacion) {
  if (!htmlOriginal) return htmlOriginal;
  const nuevoBloque = bloqueComparacionCompleto(comparacion);
  if (!nuevoBloque) return htmlOriginal;

  const idxMuestra = htmlOriginal.indexOf('<h2>Y cómo estás frente a tu cuadra</h2>');
  if (idxMuestra !== -1) {
    const corteFinalMuestra = htmlOriginal.indexOf('</div>', idxMuestra);
    if (corteFinalMuestra !== -1) {
      const parteAntes = htmlOriginal.slice(0, idxMuestra);
      const parteDespues = htmlOriginal.slice(corteFinalMuestra + 6);
      return parteAntes + nuevoBloque + parteDespues;
    }
  }

  const idxComp = htmlOriginal.indexOf('<h2><span class="n">00</span>Frente a la competencia directa</h2>');
  if (idxComp !== -1) {
    const corteFinalComp = htmlOriginal.indexOf('</div>', idxComp);
    if (corteFinalComp !== -1) {
      const parteAntes = htmlOriginal.slice(0, idxComp);
      const parteDespues = htmlOriginal.slice(corteFinalComp + 6);
      return parteAntes + nuevoBloque + parteDespues;
    }
  }

  const idxCta = htmlOriginal.indexOf('<div class="cta">');
  if (idxCta !== -1) {
    return htmlOriginal.slice(0, idxCta) + nuevoBloque + '\n\n' + htmlOriginal.slice(idxCta);
  }

  return htmlOriginal;
}


