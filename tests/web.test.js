/**
 * Tests del stack web. Reemplazan a los que revisaban los flujos de n8n.
 *
 * La propiedad que protegían aquellos tests —"el flujo de prospección no
 * contiene ningún nodo capaz de enviar"— sigue siendo la más importante del
 * repositorio, solo que ahora se verifica sobre código en vez de sobre JSON de
 * n8n: se lee el archivo de las tareas programadas y se comprueba que la única
 * función que llama a `enviar` es la que pasa por el guardián.
 *
 * Es un test que lee texto fuente y eso normalmente es frágil. Acá se acepta a
 * propósito: el costo de un falso positivo es cinco minutos de arreglar una
 * expresión regular; el costo de un falso negativo es un correo que salió sin
 * autorización.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extraerEmails } from '../lib/integrations/website-audit.js';
import { redactarPropuesta, aPeticionesDocs, aGrilla, proponerHorarios } from '../lib/integrations/workspace.js';
import { auditar } from '../lib/core/audit-engine.js';
import { generarPresupuestos, generarAlternativasReduccion } from '../lib/core/quote-engine.js';
import { PERFILES_DEMO } from '../lib/core/demo.js';

/**
 * La raíz del proyecto.
 *
 * `fileURLToPath` y no `.pathname`, por una razón que solo se ve en Windows:
 * ahí `new URL('..', import.meta.url).pathname` devuelve `/D:/Lokig/lokigi/`
 * —con una barra adelante— y `join()` lo resuelve contra la unidad actual,
 * produciendo `D:\D:\Lokig\lokigi\...`. Todos los tests que leen un archivo
 * fallan con ENOENT y el error no dice nada sobre la causa.
 *
 * En Linux y macOS las dos formas coinciden, así que el bug solo aparece
 * cuando alguien clona el proyecto en Windows.
 */
const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const leer = (p) => readFileSync(join(RAIZ, p), 'utf8');

/**
 * Ruta relativa a la raíz, siempre con barras normales.
 *
 * Windows usa `\` y las listas de este archivo están escritas con `/`. Sin
 * normalizar, una comparación como `permitidas.has(rel)` falla en Windows y
 * pasa en Linux — el peor tipo de test, el que miente según dónde corre.
 */
const relativa = (ruta) => ruta.slice(RAIZ.length).split(/[\\/]/).join('/');

// ═══════════════════════════════════════════════════════════════════════
// Que el propio andamiaje funcione
// ═══════════════════════════════════════════════════════════════════════

test('los tests encuentran la raíz del proyecto', () => {
  // Este test existe por un fallo real: en Windows, `new URL(...).pathname`
  // devolvía `/D:/…` y veinticuatro tests morían con ENOENT sobre rutas
  // `D:\D:\…`. El error no decía nada sobre la causa y en Linux no pasaba.
  //
  // Va primero a propósito: si la raíz está mal, todo lo que sigue falla por
  // el mismo motivo y conviene verlo de una.
  assert.ok(existsSync(join(RAIZ, 'package.json')), `RAIZ no apunta al proyecto: ${RAIZ}`);
  assert.ok(!/^[\\/][A-Za-z]:/.test(RAIZ),
    `RAIZ arrastra una barra delante de la unidad de disco: ${RAIZ}`);
  assert.equal(relativa(join(RAIZ, 'app', 'page.jsx')), 'app/page.jsx',
    'las rutas relativas no se normalizan a barras normales');
});

// ═══════════════════════════════════════════════════════════════════════
// La propiedad crítica: quién puede enviar
// ═══════════════════════════════════════════════════════════════════════

test('PROPIEDAD CRÍTICA: nada envía sin haber consultado al guardián', () => {
  const tareas = leer('app/api/cron/[tarea]/route.js');

  // Se extraen las funciones que usan `enviar(`. Todas deben estar en la lista
  // blanca, y cada una de esas está justificada abajo.
  const permitidas = new Set([
    'enviarYRegistrar',   // recibe un veredicto del guardián antes de llamarse
    'avisarOperador',     // va a tu propia casilla, no a un prospecto
    'bandeja',            // solo el acuse de baja, que es respuesta a un pedido
    'postventa',          // clientes firmados, no prospección
  ]);

  // Trocea el archivo por declaraciones de función/método de primer nivel.
  // `if`, `for`, `while`, `catch` y `switch` se ven igual que una declaración
  // de función a los ojos de una expresión regular, así que se descartan.
  const PALABRAS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function']);
  const bloques = [...tareas.matchAll(/(?:^|\n)\s*(?:async\s+)?(?:function\s+)?(\w+)\s*\([^)]*\)\s*\{/g)]
    .filter(m => !PALABRAS.has(m[1]));
  const usos = [];
  for (let i = 0; i < bloques.length; i++) {
    const desde = bloques[i].index;
    const hasta = i + 1 < bloques.length ? bloques[i + 1].index : tareas.length;
    const cuerpo = tareas.slice(desde, hasta);
    if (/\bawait enviar\(/.test(cuerpo) || /\benviar\(\{/.test(cuerpo)) usos.push(bloques[i][1]);
  }

  const intrusos = usos.filter(n => !permitidas.has(n));
  assert.deepEqual(intrusos, [],
    `Estas funciones envían sin estar en la lista blanca: ${intrusos.join(', ')}. ` +
    'Si agregaste un envío nuevo, tiene que pasar por evaluar() del guardián primero.');
});

test('PROPIEDAD CRÍTICA: la prospección nunca llama a enviar directamente', () => {
  const tareas = leer('app/api/cron/[tarea]/route.js');
  const prospeccion = tareas.slice(
    tareas.indexOf('async prospeccion()'),
    tareas.indexOf('async aprobaciones()')
  );
  assert.ok(prospeccion.length > 500, 'no se pudo aislar la tarea de prospección');
  assert.ok(!/\bawait enviar\(/.test(prospeccion),
    'la prospección tiene una llamada directa a enviar(): tiene que ir por enviarYRegistrar()');
  assert.ok(/await evaluar\(intento\)/.test(prospeccion),
    'la prospección tiene que consultar al guardián');
});

test('PROPIEDAD CRÍTICA: lo aprobado se vuelve a evaluar antes de salir', () => {
  const tareas = leer('app/api/cron/[tarea]/route.js');
  const aprob = tareas.slice(tareas.indexOf('async aprobaciones()'), tareas.indexOf('async bandeja()'));
  const iEval = aprob.indexOf('await evaluar(');
  const iEnviar = aprob.indexOf('enviarYRegistrar(');
  assert.ok(iEval > 0, 'la tarea de aprobaciones no consulta al guardián');
  assert.ok(iEval < iEnviar,
    'el guardián se consulta DESPUÉS de enviar: entre que aprobás y que sale, el prospecto pudo pedir la baja');
});

test('la ruta del guardián no tiene ninguna forma de enviar', () => {
  const guard = leer('app/api/guard/route.js');
  assert.ok(!/integrations\/gmail/.test(guard), 'el guardián importa el cliente de correo');
  assert.ok(!/\benviar\b/.test(guard.replace(/^\s*\*.*$/gm, '')),
    'el guardián menciona enviar fuera de los comentarios');
});

test('ninguna página del panel importa el cliente de correo', () => {
  // El panel dibuja y guarda decisiones. Si una pantalla pudiera enviar, un
  // clic de más sería un correo de más.
  const paginas = [
    'app/(panel)/panel/page.jsx',
    'app/(panel)/leads/page.jsx',
    'app/(panel)/aprobaciones/page.jsx',
    'app/(panel)/aprobaciones/acciones.js',
  ];
  for (const p of paginas) {
    assert.ok(!/integrations\/gmail/.test(leer(p)), `${p} importa gmail.js`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// La cara pública
// ═══════════════════════════════════════════════════════════════════════

test('la raíz es la landing y el panel vive en /panel', () => {
  // Si el panel volviera a la raíz, un prospecto que entra al dominio vería
  // una pantalla de acceso al CRM en vez de la página que explica quién le
  // escribió. Es la confusión que la landing existe para evitar.
  assert.ok(existsSync(join(RAIZ, 'app/page.jsx')), 'falta la landing en la raíz');
  assert.ok(existsSync(join(RAIZ, 'app/(panel)/panel/page.jsx')), 'el panel no está en /panel');
  assert.ok(!existsSync(join(RAIZ, 'app/(panel)/page.jsx')), 'quedó una página en la raíz del grupo del panel');
  assert.ok(/redirect\('\/panel'\)/.test(leer('app/acceso/accion.js')),
    'después de entrar, la sesión no lleva a /panel');
});

test('solo la landing y el informe de ejemplo se indexan', () => {
  // El default del layout raíz es noindex. Cada página que lo levanta tiene
  // que ser una que no hable del negocio de un tercero.
  const permitidas = new Set(['app/page.jsx', 'app/informe/ejemplo/page.jsx']);
  for (const archivo of recorrer(['app'])) {
    const rel = relativa(archivo);
    if (!/robots:\s*['"]index/.test(readFileSync(archivo, 'utf8'))) continue;
    assert.ok(permitidas.has(rel), `${rel} se declara indexable y no debería`);
  }
  assert.ok(/robots:\s*['"]noindex/.test(leer('app/layout.jsx')),
    'el layout raíz dejó de poner noindex por defecto');
});

test('PROPIEDAD CRÍTICA: el formulario público no crea leads ni revierte bajas', () => {
  const accion = sinComentarios(leer('app/solicitar.js'));

  // Un pedido desde la web es una SOLICITUD, no un lead. La razón está larga
  // en la migración 004: `opt_out` es irreversible, y un formulario público
  // que pudiera escribir en `leads` sería la vía para saltearse esa garantía.
  assert.ok(!/upsert\(\s*['"]Leads/.test(accion) && !/agregar\(\s*['"]Leads/.test(accion),
    'la acción de la landing escribe en Leads');
  assert.ok(!/opt_out/.test(accion), 'la acción de la landing toca opt_out');
  assert.ok(!/Supresiones/.test(accion), 'la acción de la landing toca la lista de supresión');
  assert.ok(/pedirAuditoria\(/.test(accion),
    'la acción de la landing no pasa por pedir_auditoria(), que es donde está la validación');

  // Y no puede mandarle nada al que completó el formulario: el único correo
  // que sale de ahí va a la casilla del operador.
  const sql = leer('supabase/migrations/004_solicitudes.sql');
  assert.ok(/La baja NO se revirti/.test(sql),
    'la migración 004 ya no deja constancia de que una baja no se revierte');
});

test('los estilos del informe no se escapan a la página que lo contiene', async () => {
  // `report.js` usa clases genéricas —.barra, .cta, .sub— que también existen
  // en globals.css. Sin acotarlas, la navegación del panel y el botón de la
  // landing pisan la maquetación del informe, y al revés.
  const { acotar, embutirInforme } = await import('../app/informe/embutir.js');

  const css = acotar(':root{--x:1px}\nbody{margin:0}\n*{box-sizing:border-box}\n' +
                     '.barra{height:8px}\n.cta,.sub{color:red}\n@media print{.cta{background:#fff}}', '.z');

  assert.match(css, /^\.z\{--x:1px\}/m, ':root tiene que pasar al contenedor');
  assert.match(css, /\.z\{margin:0\}/, 'body tiene que ser el contenedor');
  assert.match(css, /\.z, \.z \*\{box-sizing:border-box\}/, '* tiene que alcanzar al contenedor');
  assert.match(css, /\.z \.barra\{height:8px\}/, 'una clase queda acotada');
  assert.match(css, /\.z \.cta, \.z \.sub\{color:red\}/, 'cada selector de una lista se acota');
  assert.match(css, /@media print\{\.z \.cta\{background:#fff\}\}/, 'adentro de @media también');

  // Ninguna regla puede quedar sin acotar: una sola que se escape ya pisa.
  for (const linea of css.split('\n')) {
    const sel = linea.split('{')[0];
    if (!sel || sel.startsWith('@')) continue;
    for (const s of sel.split(',')) {
      assert.ok(s.trim().startsWith('.z'), `se escapó un selector: "${s.trim()}"`);
    }
  }

  // Y el informe real tiene que pasar entero por ahí sin perder nada.
  const { auditar } = await import('../lib/core/audit-engine.js');
  const { generarInformeHTML } = await import('../lib/core/report.js');
  const { PERFILES_DEMO } = await import('../lib/core/demo.js');
  const doc = generarInformeHTML(auditar(PERFILES_DEMO.panaderia), { agencia: 'X' });
  const { cuerpo, estilos } = embutirInforme(doc);

  assert.ok(!/<body|<\/body>|<!doctype/i.test(cuerpo), 'el cuerpo trae etiquetas que no se pueden anidar');
  assert.ok(cuerpo.includes('Panadería La Esquina de Oro'), 'se perdió el contenido');
  assert.ok(estilos.length > 400 && !estilos.includes('<style'), 'los estilos salieron mal');
});

test('el informe de ejemplo usa el perfil inventado, nunca uno real', () => {
  const p = leer('app/informe/ejemplo/page.jsx');
  assert.ok(/PERFILES_DEMO/.test(p), 'el ejemplo no sale de demo.js');
  assert.ok(!/informeHTML|informePublico/.test(p),
    'el ejemplo lee un informe de la base: sería el perfil de un negocio real');
});

// ═══════════════════════════════════════════════════════════════════════
// Que todo lo que se importa exista
// ═══════════════════════════════════════════════════════════════════════

test('ningún archivo importa un módulo que no existe', () => {
  // Este test existe por un caso real. Al migrar de Sheets a Supabase quedaron
  // dos archivos apuntando a `../crm/sheets-client.js`, que había desaparecido.
  // Uno era el guardián: cargaba igual en los tests, porque siempre le
  // inyectan un doble, y habría explotado recién en producción, en el primer
  // envío. Importar cada módulo para comprobarlo no alcanza —algunos leen
  // variables de entorno al cargar—, así que se resuelven las rutas a mano.
  const rotos = [];
  for (const archivo of recorrer(['lib', 'app', 'scripts'])) {
    const texto = readFileSync(archivo, 'utf8');
    const rutas = [
      ...texto.matchAll(/(?:^|\s)(?:import|export)[\s\S]{0,200}?from\s+['"](\.[^'"]+)['"]/g),
      ...texto.matchAll(/\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g),
    ].map(m => m[1]);

    for (const ruta of new Set(rutas)) {
      const destino = join(archivo, '..', ruta);
      if (!existsSync(destino)) rotos.push(`${relativa(archivo)} → ${ruta}`);
    }
  }
  assert.deepEqual(rotos, [], `importaciones que apuntan a la nada:\n  ${rotos.join('\n  ')}`);
});

test('el núcleo no depende de la base ni de las integraciones', () => {
  // Es lo que lo mantiene determinista y testeable sin credenciales.
  for (const archivo of recorrer(['lib/core'])) {
    const texto = sinComentarios(readFileSync(archivo, 'utf8'));
    const malas = [...texto.matchAll(/from\s+['"](\.\.\/(?:db|ia|integrations)\/[^'"]+)['"]/g)].map(m => m[1]);
    assert.deepEqual(malas, [],
      `${relativa(archivo)} importa ${malas.join(', ')}: el núcleo recibe datos, no los va a buscar`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Seguridad: la clave de servicio no puede llegar al navegador
// ═══════════════════════════════════════════════════════════════════════

test('la clave de servicio nunca lleva el prefijo público', () => {
  const archivos = recorrer(['app', 'lib']);
  for (const f of archivos) {
    const t = readFileSync(f, 'utf8');
    assert.ok(!/NEXT_PUBLIC_SUPABASE_SERVICE/.test(t),
      `${f} expone la clave de servicio al navegador. Esa clave ignora RLS: es el CRM entero.`);
  }
});

test('ningún componente de cliente toca la base', () => {
  for (const f of recorrer(['app'])) {
    const t = readFileSync(f, 'utf8');
    if (!/^['"]use client['"]/m.test(t)) continue;
    assert.ok(!/lib\/db\/supabase/.test(t),
      `${f} es un componente de cliente y además importa el adaptador de base de datos`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Workspace escribe, no decide
// ═══════════════════════════════════════════════════════════════════════

test('el guardián no sabe que Workspace existe', () => {
  // Se miran solo las instrucciones, no los comentarios: el archivo explica su
  // historia y menciona Sheets varias veces en prosa. Lo que no puede haber es
  // una llamada.
  const codigo = sinComentarios(leer('lib/guardrails/guard.js'));
  assert.ok(!/workspace|sheets|drive|calendar/i.test(codigo),
    'el guardián consulta Workspace. Una planilla que alguien edita a mano no puede decidir envíos.');
});

test('la única lectura de Sheets está aislada y documentada', () => {
  const ws = leer('lib/integrations/workspace.js');
  const lecturas = [...ws.matchAll(/export (?:async )?function (\w+)/g)].map(m => m[1])
    .filter(n => /^leer/.test(n));
  assert.deepEqual(lecturas, ['leerNotas'],
    'apareció una función de lectura nueva en workspace.js: si algo del sistema depende de ella, la planilla pasó a ser fuente de verdad');
});

test('PROPIEDAD CRÍTICA: una invitación de calendario no se manda sola', () => {
  // Con `sendUpdates=all`, Google le manda el invite al invitado por su cuenta:
  // un mensaje que llega a la casilla de un tercero sin pasar por el guardián.
  const ws = leer('lib/integrations/workspace.js');
  const fn = ws.slice(ws.indexOf('export async function agendarLlamada'));
  assert.ok(/avisar = false/.test(fn), 'agendarLlamada avisa al invitado por defecto');
  assert.ok(/sendUpdates=\$\{avisar \? 'all' : 'none'\}/.test(fn),
    'el envío de la invitación no está detrás del interruptor');

  const tareas = leer('app/api/cron/[tarea]/route.js');
  assert.ok(!/avisar:\s*true/.test(tareas), 'una tarea programada manda la invitación sola');
  assert.ok(/agendarLlamada\(\{[\s\S]{0,400}?avisar: false/.test(tareas),
    'la tarea que agenda no declara avisar: false de forma explícita');
});

test('Calendar está enganchado al flujo, no solo definido', () => {
  // Una función exportada que nadie llama es una integración que parece existir
  // y no existe. Esto ya pasó con agendarLlamada.
  const tareas = leer('app/api/cron/[tarea]/route.js');
  for (const fn of ['agendarLlamada', 'proponerHorarios', 'crearPropuesta', 'archivarInforme',
                    'crearPlanillaEspejo', 'volcarHoja']) {
    assert.ok(tareas.includes(fn), `nada llama a ws.${fn}(): Workspace quedó a medias`);
  }
  // Y leerNotas se usa desde el panel, no desde las tareas.
  assert.ok(leer('app/(panel)/leads/page.jsx').includes('leerNotas'), 'leerNotas quedó sin usar');
});

test('el espejo se rehace entero: limpia antes de escribir', () => {
  const ws = leer('lib/integrations/workspace.js');
  const v = ws.slice(ws.indexOf('export async function volcarHoja'));
  const iClear = v.indexOf(':clear');
  const iEscribe = v.indexOf('valueInputOption');
  assert.ok(iClear > 0 && iClear < iEscribe,
    'volcarHoja escribe sin limpiar: quedarían filas de corridas anteriores que parecen vigentes');
});

test('las notas de la planilla se muestran pero no deciden nada', () => {
  const leads = leer('app/(panel)/leads/page.jsx');
  assert.ok(/leerNotas/.test(leads));
  // Si alguna vez una nota llega a actualizar/agregar en la base, se rompe acá.
  assert.ok(!/notas\[[^\]]*\][^\n]*(actualizar|agregar|darDeBaja)/.test(leads),
    'una nota de la planilla está escribiendo en la base');
});

// ═══════════════════════════════════════════════════════════════════════
// La propuesta: los números no los inventa nadie
// ═══════════════════════════════════════════════════════════════════════

test('todo precio del documento sale del motor de cotización', () => {
  const auditoria = auditar(PERFILES_DEMO.panaderia);
  const plan = generarPresupuestos(auditoria, { moneda: 'ars', tipoCambio: 1450 })
    .find(p => p.recomendado) ?? generarPresupuestos(auditoria, { moneda: 'ars', tipoCambio: 1450 })[0];
  const alts = generarAlternativasReduccion(plan, auditoria, { moneda: 'ars', tipoCambio: 1450 });

  const texto = redactarPropuesta({ negocio: 'Panadería La Esquina de Oro', plan, alternativas: alts, auditoria })
    .map(b => b.t).join('\n');

  // Cada número con separador de miles que aparezca en el documento tiene que
  // corresponder a una cifra que el motor produjo.
  const permitidos = new Set([
    plan.setupARS, plan.mensualARS,
    ...alts.flatMap(a => [a.setupARS, a.mensualARS]),
  ].filter(Boolean).map(n => Math.round(n)));

  const enElTexto = [...texto.matchAll(/\$\s*([\d.]{4,})/g)]
    .map(m => Number(m[1].replace(/\./g, '')))
    .filter(Boolean);

  assert.ok(enElTexto.length > 0, 'el documento no muestra ningún precio');
  for (const n of enElTexto) {
    assert.ok(permitidos.has(n),
      `el documento muestra ${n}, que no salió de quote-engine.js. Los precios no se escriben a mano.`);
  }
});

test('la propuesta dice qué se resigna en cada alternativa', () => {
  const auditoria = auditar(PERFILES_DEMO.panaderia);
  const plan = generarPresupuestos(auditoria)[0];
  const alts = generarAlternativasReduccion(plan, auditoria);
  const texto = redactarPropuesta({ negocio: 'X', plan, alternativas: alts, auditoria })
    .map(b => b.t).join('\n');
  for (const a of alts) {
    assert.ok(texto.includes(a.resigna),
      `la alternativa "${a.nombre}" se ofrece sin decir qué se resigna`);
  }
});

test('la propuesta no promete nada que el linter prohíba', async () => {
  const { PROHIBIDO } = await import('../lib/guardrails/guard.js');
  const auditoria = auditar(PERFILES_DEMO.panaderia);
  const plan = generarPresupuestos(auditoria)[0];
  const texto = redactarPropuesta({
    negocio: 'X', plan,
    alternativas: generarAlternativasReduccion(plan, auditoria), auditoria,
  }).map(b => b.t).join('\n');

  for (const p of PROHIBIDO) {
    const m = texto.match(p.re);
    assert.equal(m, null, `la propuesta contiene "${m?.[0]}" (${p.que})`);
  }
});

test('los índices de los estilos del documento no se corren', () => {
  const bloques = [
    { t: 'Título', estilo: 'HEADING_1' },
    { t: 'Un párrafo con acentos: auditoría, posición.', estilo: 'NORMAL_TEXT' },
    { t: 'Subtítulo', estilo: 'HEADING_2' },
  ];
  const reqs = aPeticionesDocs(bloques);
  const texto = reqs[0].insertText.text;

  for (const r of reqs.slice(1)) {
    const { startIndex, endIndex } = r.updateParagraphStyle.range;
    // El texto insertado arranca en el índice 1 del documento.
    const trozo = texto.slice(startIndex - 1, endIndex - 1);
    assert.ok(bloques.some(b => trozo === b.t + '\n'),
      `un estilo apunta a "${trozo}", que no es un bloque completo`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Extracción de correos: sin esto no hay primer toque
// ═══════════════════════════════════════════════════════════════════════

test('encuentra el correo en las formas habituales', () => {
  assert.deepEqual(extraerEmails('<a href="mailto:hola@negocio.com.ar">Escribinos</a>'), ['hola@negocio.com.ar']);
  assert.ok(extraerEmails('Consultas: ventas@negocio.com').includes('ventas@negocio.com'));
  assert.ok(extraerEmails('contacto (arroba) negocio (punto) com').includes('contacto@negocio.com'));
});

test('prefiere la casilla de contacto sobre la del que hizo el sitio', () => {
  const html = 'web: estudio@agenciaweb.com — consultas: info@panaderia.com.ar';
  assert.equal(extraerEmails(html)[0], 'info@panaderia.com.ar');
});

test('descarta lo que no es una casilla de verdad', () => {
  const basura = extraerEmails(
    'src="logo@2x.png" tu@dominio.com noreply@wixpress.com algo@example.com'
  );
  assert.deepEqual(basura, [], `no debería devolver nada y devolvió ${basura.join(', ')}`);
});

test('no devuelve duplicados ni se pasa de cinco', () => {
  const html = Array.from({ length: 12 }, (_, i) => `a${i}@x.com`).join(' ') + ' a1@x.com a1@x.com';
  const r = extraerEmails(html);
  assert.ok(r.length <= 5);
  assert.equal(new Set(r).size, r.length);
});

// ═══════════════════════════════════════════════════════════════════════
// Detalles que rompen en producción
// ═══════════════════════════════════════════════════════════════════════

test('la grilla de Sheets neutraliza lo que Sheets interpretaría como fórmula', () => {
  const g = aGrilla([{ id: '+5491122334455', nota: '=SUMA(A1:A2)', score: 42 }]);
  assert.equal(g[1][0], "'+5491122334455");
  assert.equal(g[1][1], "'=SUMA(A1:A2)");
  assert.equal(g[1][2], 42, 'los números tienen que seguir siendo números para poder graficarlos');
});

test('los horarios propuestos caen en días hábiles y en el futuro', () => {
  const hs = proponerHorarios({ cantidad: 3 });
  assert.equal(hs.length, 3);
  for (const h of hs) {
    const d = new Date(h.inicio);
    assert.ok(d.getTime() > Date.now(), 'un horario propuesto ya pasó');
    const dia = new Date(d.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' })).getDay();
    assert.ok(dia >= 1 && dia <= 5, `cayó en fin de semana: ${h.etiqueta}`);
  }
});

test('la baja por GET no ejecuta: solo el POST de un clic da de baja', () => {
  const ruta = leer('app/api/baja/route.js');
  const get = ruta.slice(ruta.indexOf('export function GET'));
  assert.ok(/redirect/i.test(get),
    'el GET de /api/baja ejecuta la baja: los escáneres de enlaces desuscribirían media lista sola');
  assert.ok(!/darDeBaja/.test(get), 'el GET llama a darDeBaja');

  const pagina = leer('app/baja/page.jsx');
  assert.ok(!/darDeBaja/.test(pagina), 'la página de baja ejecuta al abrirse en vez de mostrar un botón');
});

test('el informe público no se recalcula al abrirse', () => {
  const p = leer('app/informe/[id]/page.jsx');
  assert.ok(/informeHTML/.test(p));
  assert.ok(!/\bauditar\(/.test(p),
    'el informe se recalcula al abrirse: el prospecto podría ver un número distinto al del correo');
});

test('el informe público no muestra el menú del panel', () => {
  // Vive fuera del grupo (panel), que es el único layout con la barra.
  assert.ok(existsSync(join(RAIZ, 'app/informe/[id]/page.jsx')));
  assert.ok(!existsSync(join(RAIZ, 'app/(panel)/informe')));
  assert.ok(/className="barra"/.test(leer('app/(panel)/layout.jsx')));
  assert.ok(!/className="barra"/.test(leer('app/layout.jsx')),
    'la barra está en el layout raíz: un prospecto vería "Aprobaciones" y "Leads"');
});

test('las tareas programadas devuelven 200 aunque fallen', () => {
  const t = leer('app/api/cron/[tarea]/route.js');
  const post = t.slice(t.indexOf('export async function POST'));
  assert.ok(/ok: false[\s\S]{0,200}\}\);/.test(post) && !/status: 500/.test(post),
    'un 500 hace que pg_cron reintente y duplique trabajo ya hecho a medias');
});

test('toda migración de SQL es idempotente o está numerada sin huecos', () => {
  const dir = join(RAIZ, 'supabase/migrations');
  const archivos = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  assert.ok(archivos.length >= 3);
  archivos.forEach((f, i) => {
    assert.ok(f.startsWith(String(i + 1).padStart(3, '0')), `hueco en las migraciones: ${f}`);
  });
});

// ─────────────────────────────────────────────────────────────────────

/** Quita comentarios de bloque y de línea. Deja las cadenas intactas. */
const sinComentarios = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/.*$/gm, '$1');

function recorrer(dirs) {
  const out = [];
  const visitar = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) visitar(p);
      else if (/\.(js|jsx)$/.test(e.name)) out.push(p);
    }
  };
  for (const d of dirs) visitar(join(RAIZ, d));
  return out;
}
