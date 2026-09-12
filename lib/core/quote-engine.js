/**
 * quote-engine.js — Genera hasta 3 alternativas de presupuesto a partir de la
 * auditoría, y una escalera de reducción para cuando el prospecto duda.
 *
 * Principio: los 3 niveles NO son "chico / mediano / grande" inventados.
 * Se arman ordenando los servicios por eficiencia (puntos recuperables por
 * hora de trabajo) y cortando la lista en tres puntos. Así cada nivel se
 * puede justificar diciendo exactamente qué hallazgo resuelve y cuántos
 * puntos de score recupera.
 *
 * La escalera de descenso, cuando el prospecto objeta el precio, se aplica en
 * este orden — y nunca bajando el precio del mismo alcance, porque eso enseña
 * al cliente que el precio original era mentira:
 *   1. Reducir frecuencia (mismo servicio, menos cadencia)
 *   2. Reducir alcance (sacar los servicios de menor eficiencia)
 *   3. Separar el setup del abono (pago único ahora, abono después)
 */

import { SERVICIOS } from './rubric.js';

/** Monedas soportadas para la emisión de cotizaciones y presupuestos. */
export const MONEDA = {
  usd: { simbolo: 'USD', factor: 1 },
  ars: { simbolo: 'ARS', factor: null }, // se inyecta el tipo de cambio al cotizar
};

const NIVELES = [
  {
    clave: 'esencial',
    nombre: 'Esencial',
    lema: 'Arreglar lo que está costando clientes hoy',
    maxHorasMes: 4,
    descuento: 0,
    compromisoMeses: 3,
  },
  {
    clave: 'crecimiento',
    nombre: 'Crecimiento',
    lema: 'Ganar posiciones de forma sostenida',
    maxHorasMes: 9,
    descuento: 0.05,
    compromisoMeses: 6,
    recomendado: true,
  },
  {
    clave: 'dominio',
    nombre: 'Dominio local',
    lema: 'Ser la opción por defecto de la zona',
    maxHorasMes: 16,
    descuento: 0.1,
    compromisoMeses: 6,
  },
];

/**
 * @param auditoria  salida de auditar()
 * @param opts.tarifaHoraUSD  tu costo/hora objetivo (default 22 — realista para operar a medio tiempo en LATAM)
 * @param opts.moneda 'usd' | 'ars'
 * @param opts.tipoCambio  ARS por USD, requerido si moneda==='ars'
 * @param opts.margenMinimo  margen mínimo aceptable sobre el costo horario
 */
export function generarPresupuestos(auditoria, opts = {}) {
  const {
    tarifaHoraUSD = 22,
    moneda = 'usd',
    tipoCambio = null,
    incluirReporte = true,
  } = opts;

  const candidatos = auditoria.serviciosRecomendados.filter(s => s.nombre);
  const planes = [];

  for (const nivel of NIVELES) {
    const seleccion = [];
    let horas = 0;

    for (const s of candidatos) {
      const horasItem = (s.horasMes || 0) + (s.horasSetup || 0) / 6;
      if (horas + horasItem > nivel.maxHorasMes) continue;
      seleccion.push(s);
      horas += horasItem;
    }

    if (incluirReporte && !seleccion.find(s => s.servicio === 'reporte_mensual')) {
      const rep = { servicio: 'reporte_mensual', ...SERVICIOS.reporte_mensual, puntosRecuperables: 0 };
      seleccion.push(rep);
      horas += rep.horasMes;
    }

    if (!seleccion.length) continue;

    const setupBruto = seleccion.reduce((a, s) => a + (s.costoSetupUSD || 0), 0);
    const mensualBruto = seleccion.reduce((a, s) => a + (s.costoMensualUSD || 0), 0);

    // Descuento por paquete sobre el setup. Es honesto: hacer cuatro puestas a
    // punto juntas comparte relevamiento, accesos y reuniones, así que cuesta
    // menos que hacerlas sueltas. Sin esto, el setup se vuelve impagable para
    // un negocio de barrio justo cuando más lo necesita.
    const conSetup = seleccion.filter(s => (s.costoSetupUSD || 0) > 0).length;
    const bundle = conSetup >= 4 ? 0.30 : conSetup === 3 ? 0.20 : conSetup === 2 ? 0.10 : 0;

    const setup = Math.round(setupBruto * (1 - bundle) * (1 - nivel.descuento));
    const mensual = Math.round(mensualBruto * (1 - nivel.descuento));

    const puntos = +seleccion.reduce((a, s) => a + (s.puntosRecuperables || 0), 0).toFixed(1);
    const costoReal = horas * tarifaHoraUSD;

    planes.push({
      clave: nivel.clave,
      nombre: nivel.nombre,
      lema: nivel.lema,
      recomendado: !!nivel.recomendado,
      compromisoMeses: nivel.compromisoMeses,
      servicios: seleccion.map(s => ({
        clave: s.servicio, nombre: s.nombre, detalle: s.detalle,
        puntos: +(s.puntosRecuperables || 0).toFixed(1),
      })),
      setupUSD: setup,
      setupSinDescuentoUSD: setupBruto,
      descuentoPaquete: Math.round(bundle * 100),
      mensualUSD: mensual,
      primerPagoUSD: setup + mensual,
      totalCicloUSD: setup + mensual * nivel.compromisoMeses,
      horasMes: +horas.toFixed(1),
      puntosProyectados: puntos,
      scoreProyectado: Math.min(100, auditoria.score + Math.round(puntos)),
      margenEstimado: mensual ? +(((mensual - costoReal) / mensual) * 100).toFixed(0) : 0,
      rentable: mensual >= costoReal,
    });
  }

  // Dedup: si dos niveles quedaron idénticos (negocio con pocos hallazgos),
  // conservamos el más barato. Cotizar dos veces lo mismo destruye credibilidad.
  const unicos = [];
  for (const p of planes) {
    const firma = p.servicios.map(s => s.clave).sort().join('|');
    if (!unicos.find(u => u._firma === firma)) unicos.push({ ...p, _firma: firma });
  }
  unicos.forEach(p => delete p._firma);

  return convertirMoneda(unicos, moneda, tipoCambio);
}

function convertirMoneda(planes, moneda, tipoCambio) {
  if (moneda !== 'ars') return planes.map(p => ({ ...p, moneda: 'USD' }));
  if (!tipoCambio) throw new Error('Cotizar en ARS requiere opts.tipoCambio');
  const r = (v) => Math.round((v * tipoCambio) / 1000) * 1000; // redondeo comercial
  return planes.map(p => ({
    ...p,
    moneda: 'ARS',
    setupARS: r(p.setupUSD),
    mensualARS: r(p.mensualUSD),
    primerPagoARS: r(p.primerPagoUSD),
    totalCicloARS: r(p.totalCicloUSD),
    tipoCambio,
  }));
}

/**
 * Escalera de reducción. Se invoca cuando el prospecto objeta el precio.
 * Devuelve como máximo 3 alternativas, cada una con el argumento honesto de
 * qué se resigna al bajar. Nunca devuelve el mismo alcance más barato.
 */
export function generarAlternativasReduccion(plan, auditoria, opts = {}) {
  const alternativas = [];
  const ordenados = [...plan.servicios].sort((a, b) => b.puntos - a.puntos);

  // Mismo descuento por paquete que en los planes base, y tope duro: una
  // alternativa de reducción NUNCA puede salir más cara que el plan original.
  const setupDe = (servicios) => {
    const bruto = servicios.reduce((a, s) => a + (SERVICIOS[s.clave]?.costoSetupUSD || 0), 0);
    const n = servicios.filter(s => (SERVICIOS[s.clave]?.costoSetupUSD || 0) > 0).length;
    const bundle = n >= 4 ? 0.30 : n === 3 ? 0.20 : n === 2 ? 0.10 : 0;
    return Math.min(plan.setupUSD, Math.round(bruto * (1 - bundle)));
  };
  const mensualDe = (servicios) =>
    Math.min(plan.mensualUSD, servicios.reduce((a, s) => a + (SERVICIOS[s.clave]?.costoMensualUSD || 0), 0));

  // 1) Misma cobertura, menor cadencia (~35% menos de trabajo mensual)
  alternativas.push({
    clave: `${plan.clave}_cadencia`,
    nombre: `${plan.nombre} — cadencia reducida`,
    razon: 'Mismo alcance, la mitad de frecuencia en contenido y fotos.',
    resigna: 'El avance es más lento: los resultados se ven en ~5 meses en vez de ~3.',
    servicios: plan.servicios,
    setupUSD: plan.setupUSD,
    mensualUSD: Math.round(plan.mensualUSD * 0.65),
    horasMes: +(plan.horasMes * 0.65).toFixed(1),
    puntosProyectados: +(plan.puntosProyectados * 0.8).toFixed(1),
  });

  // 2) Alcance recortado: sólo el top 60% por impacto
  const corte = Math.max(2, Math.ceil(ordenados.length * 0.6));
  const recortado = ordenados.slice(0, corte);
  alternativas.push({
    clave: `${plan.clave}_recortado`,
    nombre: `${plan.nombre} — núcleo`,
    razon: 'Solo los servicios que concentran la mayor parte del impacto medido.',
    resigna: `Queda afuera: ${ordenados.slice(corte).map(s => s.nombre).join(', ') || 'nada relevante'}.`,
    servicios: recortado,
    setupUSD: setupDe(recortado),
    mensualUSD: mensualDe(recortado),
    horasMes: +recortado.reduce((a, s) => a + (SERVICIOS[s.clave]?.horasMes || 0), 0).toFixed(1),
    puntosProyectados: +recortado.reduce((a, s) => a + s.puntos, 0).toFixed(1),
  });

  // 3) Solo setup, sin abono: pago único, el cliente sigue solo
  const soloSetup = ordenados.filter(s => (SERVICIOS[s.clave]?.costoSetupUSD || 0) > 0);
  alternativas.push({
    clave: `${plan.clave}_setup`,
    nombre: 'Puesta a punto — pago único',
    razon: 'Se deja el perfil optimizado y documentado; la gestión mensual queda del lado del negocio.',
    resigna: 'Sin gestión continua el score tiende a caer entre 8 y 15 puntos en 6 meses, porque frescura y reseñas dependen de la constancia.',
    servicios: soloSetup,
    setupUSD: setupDe(soloSetup),
    mensualUSD: 0,
    horasMes: 0,
    puntosProyectados: +soloSetup.reduce((a, s) => a + s.puntos * 0.55, 0).toFixed(1),
    nota: 'Incluye 1 videollamada de traspaso y un instructivo de 2 páginas.',
  });

  const { moneda = 'usd', tipoCambio = null } = opts;
  return convertirMoneda(
    alternativas.map(a => ({ ...a, primerPagoUSD: a.setupUSD + a.mensualUSD, totalCicloUSD: a.setupUSD + a.mensualUSD * 6 })),
    moneda, tipoCambio
  ).slice(0, 3);
}

/** Justificación económica para el email/WhatsApp: qué vale una consulta más. */
export function estimarRetorno(auditoria, plan, { ticketPromedioUSD = 40, tasaCierre = 0.3, consultasBase = 30 } = {}) {
  // Modelo conservador y declarado como tal: +1% de score ≈ +0,8% de consultas.
  const upliftConsultas = (plan.puntosProyectados * 0.008);
  const consultasExtra = consultasBase * upliftConsultas;
  const ingresoExtra = consultasExtra * tasaCierre * ticketPromedioUSD;
  return {
    supuestos: { ticketPromedioUSD, tasaCierre, consultasBase },
    consultasExtraMes: +consultasExtra.toFixed(1),
    ingresoExtraMes: Math.round(ingresoExtra),
    costoPlanMes: plan.mensualUSD,
    ratio: plan.mensualUSD ? +(ingresoExtra / plan.mensualUSD).toFixed(2) : null,
    mesesRecupero: plan.mensualUSD && ingresoExtra > plan.mensualUSD
      ? +(plan.setupUSD / (ingresoExtra - plan.mensualUSD)).toFixed(1)
      : null,
    advertencia: 'Proyección basada en supuestos declarados, no en una promesa de resultado. Se recalcula con los datos reales del negocio en la primera reunión.',
  };
}
