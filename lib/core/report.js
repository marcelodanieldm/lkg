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
    ctaUrl = opts.ctaUrl || (process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL}/#pedir` : '/#pedir'),
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
  :root{--tinta:#14181f;--suave:#5b6472;--linea:#e4e7ec;--fondo:#fbfbfc;--acento:#1a56db;--banda:${b.color}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--fondo);color:var(--tinta);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif}
  .wrap{max-width:780px;margin:0 auto;padding:32px 20px 72px}
  header{border-bottom:2px solid var(--linea);padding-bottom:24px;margin-bottom:32px}
  .kicker{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--suave);font-weight:600}
  h1{font-size:30px;line-height:1.2;margin:8px 0 6px;letter-spacing:-.02em}
  .sub{color:var(--suave);font-size:14px}
  .puntaje{display:flex;align-items:center;gap:24px;background:#fff;border:1px solid var(--linea);border-radius:14px;padding:24px;margin:28px 0}
  .num{font-size:56px;font-weight:700;line-height:1;color:var(--banda);letter-spacing:-.03em}
  .num small{font-size:20px;color:var(--suave);font-weight:500}
  .banda{display:inline-block;background:var(--banda);color:#fff;font-size:12px;font-weight:700;padding:3px 10px;border-radius:99px;text-transform:uppercase;letter-spacing:.06em}
  h2{font-size:19px;margin:44px 0 14px;letter-spacing:-.01em}
  h2 .n{color:var(--suave);font-weight:400;margin-right:8px}
  .barra{height:8px;background:#eef0f3;border-radius:99px;overflow:hidden}
  .barra i{display:block;height:100%;border-radius:99px}
  .dim{background:#fff;border:1px solid var(--linea);border-radius:10px;padding:14px 16px;margin-bottom:10px}
  .dim .top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:8px}
  .dim .nom{font-weight:600;font-size:15px}
  .dim .val{font-variant-numeric:tabular-nums;font-weight:700}
  .dim .desc{color:var(--suave);font-size:13px;margin-top:8px}
  .item{background:#fff;border:1px solid var(--linea);border-left:4px solid var(--sev,#cbd5e1);border-radius:10px;padding:16px 18px;margin-bottom:12px}
  .item h3{font-size:16px;margin:0 0 6px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .tag{font-size:11px;font-weight:700;padding:2px 8px;border-radius:99px;text-transform:uppercase;letter-spacing:.05em;color:#fff}
  .ev{color:var(--suave);font-size:14px;margin:6px 0}
  .rec{font-size:14px;margin-top:10px;padding-top:10px;border-top:1px dashed var(--linea)}
  .rec b{font-weight:600}
  .fuente{font-size:12.5px;color:var(--suave);background:#f4f6f9;border-radius:7px;padding:99px 11px;margin-top:10px}
  .fuente a{color:var(--suave)}
  .ok{border-left-color:#16794a}
  .nd{background:#fff;border:1px dashed var(--linea);border-radius:10px;padding:14px 16px;color:var(--suave);font-size:14px}
  .chk-wrap input[type="checkbox"]:focus-visible{outline:2px solid var(--acento);outline-offset:2px}
  .chk-wrap label{cursor:pointer;line-height:1.4}
  .chk-wrap:hover{background:#f1f5f9}
  .cta{background:var(--tinta);color:#fff;border-radius:14px;padding:28px;margin-top:44px}
  .cta h2{color:#fff;margin-top:0}
  .cta p{color:#c3c9d3;font-size:15px}
  .cta a{display:inline-block;background:#fff;color:var(--tinta);text-decoration:none;font-weight:600;padding:11px 20px;border-radius:99px;margin-top:8px}
  footer{margin-top:40px;padding-top:20px;border-top:1px solid var(--linea);color:var(--suave);font-size:12.5px}
  table{width:100%;border-collapse:collapse;font-size:14px;margin-top:10px;min-width:480px}
  td,th{padding:8px 6px;border-bottom:1px solid var(--linea);text-align:left}
  th{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--suave)}
  .delta-neg{color:#b91c1c;font-weight:600}.delta-pos{color:#16794a;font-weight:600}
  @media (max-width:560px){.wrap{padding:16px 12px 48px}.puntaje{flex-direction:column;align-items:flex-start;gap:14px;padding:18px 16px}.num{font-size:44px}.dim{padding:12px}.dim .top{flex-direction:column;align-items:flex-start;gap:4px}.item{padding:14px 12px}.cta{padding:20px 16px;border-radius:12px}}
  @media print{body{background:#fff}.cta{background:#f4f6f9;color:var(--tinta)}}
</style></head><body><div class="wrap">

<header>
  ${logoUrl ? `<img src="${esc(logoUrl)}" alt="${esc(agencia)}" style="height:34px;margin-bottom:14px">` : ''}
  <div class="kicker">Auditoría de perfil · Google Maps y Business Profile</div>
  <h1>${esc(m.negocio)}</h1>
  <div class="sub">${esc(m.direccion || '')}${m.categoria ? ' · ' + esc(m.categoria) : ''}<br>
  Análisis del ${fecha(m.auditadoEn)} · ${auditoria.dimensiones.reduce((a, d) => a + d.detalles.length, 0)} puntos de control</div>
</header>

<div class="puntaje">
  <div><div class="num">${auditoria.score}<small>/100</small></div></div>
  <div>
    <span class="banda">${esc(b.etiqueta)}</span>
    <p style="margin:10px 0 0;font-size:15px">${esc(b.resumen)}</p>
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
        <td>${esc(d.nombre)}</td><td>${d.propio ?? '—'}</td><td>${d.competencia}</td>
        <td class="${d.delta < 0 ? 'delta-neg' : 'delta-pos'}">${d.delta > 0 ? '+' : ''}${d.delta}</td></tr>`).join('')}
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
