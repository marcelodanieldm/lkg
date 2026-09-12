# Prompts para desarrollar Lokigi desde Antigravity

Cada bloque de abajo se copia y se pega tal cual. Están ordenados por valor: si
solo vas a hacer uno este mes, hacé el 1.

---

## Primero: por qué son tan pocos y tan largos

El plan gratuito de Antigravity tiene **cuota semanal**, no diaria. La
documentación de Google lo dice con estas palabras: *"Meaningful quota,
refreshed weekly"*, y agrega la frase que define todo lo demás —
*"rate limits are correlated with the amount of work done by the agent"*.

No se publica el número exacto. Lo que sí se sabe es que el esquema original de
250 pedidos con refresco cada 5 horas se endureció bastante durante 2026, y que
cuando se agota la cuota el editor queda inutilizable hasta el refresco
semanal. Planificá como si tuvieras **una docena de intervenciones buenas por
semana**, no cien.

De ahí salen cuatro reglas, y son la parte que de verdad importa:

1. **Un prompt = una unidad de trabajo terminada.** Nada de "ahora agregá el
   botón". El agente tiene que poder empezar y terminar sin volver a
   preguntarte.
2. **No lo hagas explorar.** `AGENTS.md` y `.agents/rules/` ya le dicen cómo
   está armado el proyecto. Cada prompt de abajo además le nombra los archivos
   exactos. Cada búsqueda que se ahorra es cuota que no gastás.
3. **Que verifique con comandos, no razonando.** `npm test` y
   `npm run verificar` no consumen un solo token de Antigravity. Son 78 tests
   y un preflight de diez secciones: dejá que ellos digan si está bien, en vez
   de pedirle al agente que lo piense.
4. **Nunca lo dejes patinar.** Si dos intentos no arreglan algo, pará. Un
   agente dando vueltas es la forma más rápida de quemar una semana de cuota.

---

## Sobre los MCP, porque suele confundirse

Un MCP **no le pasa al agente una conversación**: le da herramientas. No existe
un servidor que "consuma este chat y lo ejecute", y no hay nada que instalar
para que Antigravity sepa de qué se trata Lokigi.

Lo que le da el contexto es el repositorio, y ya está puesto:

| Archivo | Qué le dice |
|---|---|
| `AGENTS.md` | Cómo está armado, las reglas innegociables, las trampas conocidas |
| `.agents/rules/*.md` | Guardrails, estilo y arquitectura, con `trigger: always_on` |
| `.agents/PROMPTS.md` | Este archivo: qué falta hacer y con qué palabras pedirlo |
| `.agents/mcp_config.json` | Los servidores MCP del proyecto |

Antigravity lee los tres primeros por su cuenta al abrir la carpeta. El cuarto
también: `.agents/mcp_config.json` es exactamente la ruta donde los busca a
nivel de proyecto (la global es `~/.gemini/config/mcp_config.json`, pero para
servidores que solo sirven acá conviene que viajen con el repositorio).

Vienen dos configurados, y los dos son gratis:

- **supabase**, en solo lectura, para que el agente mire el esquema y los datos
  sin que le pegues resultados de SQL a mano. En solo lectura a propósito: un
  agente con permiso de escritura sobre esta base puede borrar la lista de
  supresión.
- **github**, opcional. Si trabajás solo y hacés push directo, sacalo.

Antes de que funcionen hay que poner dos cosas en el entorno:
`SUPABASE_ACCESS_TOKEN` y el `--project-ref` de tu proyecto.

Y una advertencia de cuota: **cada servidor que agregues es superficie que el
agente puede explorar, y explorar gasta.** Con dos alcanza.

---

## P0 · El prompt con el que se abre cualquier sesión

Pegalo primero, siempre. Cuesta poco y evita que el agente arranque explorando.

```
Este es Lokigi. Antes de tocar nada leé, en este orden:

  AGENTS.md
  .agents/rules/01-guardrails.md
  .agents/rules/03-arquitectura.md

Son la fuente de verdad sobre cómo está armado y qué no se toca. No explores el
repositorio para reconstruir el contexto: ya está escrito ahí.

Reglas de trabajo para esta sesión:

- Castellano rioplatense en código, comentarios y mensajes de error.
- Los comentarios explican POR QUÉ, nunca QUÉ.
- Cero dependencias nuevas de producción sin justificarlas primero.
- Antes de dar cualquier cambio por terminado corré `npm test` y
  `npm run verificar`. Los dos tienen que salir en 0. No me digas que algo
  funciona sin haberlos corrido.
- Si un cambio toca `lib/guardrails/`, `lib/core/rubric.js` o el orden de las
  reglas del guardián: paráme y preguntá antes de escribir.

Respondeme solo "listo" y esperá la tarea.
```

---

## P1 · La tarea de seguimiento *(lo más importante que falta)*

El sistema hoy manda el **primer** toque y nada más. `SECUENCIA_PROSPECCION`
tiene cuatro pasos definidos, `proximo_toque` se calcula y se guarda, la vista
`v_cola_hoy` los junta y el panel los muestra — pero **ninguna tarea programada
los envía**. Los leads se quedan esperando para siempre.

```
Falta la tarea de seguimiento y es el agujero más grande del sistema.

Situación actual: `prospeccion` manda el paso 1 y calcula `proximo_toque`. La
vista `v_cola_hoy` (migración 001) junta los leads cuyo toque venció. Nadie los
envía nunca. `SECUENCIA_PROSPECCION` en lib/core/sequences.js tiene los cuatro
pasos con su `diaRelativo` y su plantilla.

Agregá una tarea `seguimiento` en app/api/cron/[tarea]/route.js que:

1. Lea `db.colaDeHoy()` — ya existe en lib/db/supabase.js.
2. Para cada lead, calcule qué paso le toca: el mayor paso enviado en
   `Mensajes` más uno. Si no hay ninguno, el lead no corresponde a esta tarea.
3. Si el paso siguiente no existe en SECUENCIA_PROSPECCION, marque el lead como
   `perdido` con `motivo_perdida = 'secuencia agotada sin respuesta'` y siga.
4. Redacte con `agenteRedactor`, arme el intento y lo pase por `evaluar()` del
   guardián. Igual que prospección: APROBACION va a la cola, PERMITIDO usa
   `enviarYRegistrar`.
5. Respete el mismo tope de la corrida que usa prospección.

Restricciones que no se negocian:
- La tarea NO puede llamar a `enviar()` directamente. Solo `enviarYRegistrar`,
  que ya recibe un veredicto. Hay un test que lee el código fuente y falla si
  aparece un envío fuera de la lista blanca.
- El guardián ya tiene las reglas de `espaciado_lead`, `tope_toques` e
  `idempotencia`: no las repliques en la tarea. Si el guardián difiere o
  bloquea, respetá el veredicto y seguí con el próximo lead.

Después:
- Agregá el cron en una migración nueva (005), a las 11:00 UTC de días hábiles,
  con el mismo patrón que usa 002 con `llamar_tarea`.
- Sumá la tarea a la lista de `.vscode/tasks.json` y a la tabla del README.
- Agregá al menos dos tests en tests/web.test.js: uno que verifique que
  `seguimiento` consulta al guardián antes de enviar, y otro que verifique que
  un lead sin paso siguiente se cierra en vez de quedar colgado.

Corré `npm test` y `npm run verificar` antes de decirme que está.
```

---

## P2 · Acciones sobre las solicitudes

El formulario de la landing ya guarda pedidos y el panel los muestra, pero no
se puede hacer nada con ellos. `atenderSolicitud()` existe en
`lib/db/supabase.js` y nadie la llama.

```
Las solicitudes que llegan por la landing se muestran en /panel pero no se
puede hacer nada con ellas. `atenderSolicitud(id, estado, nota)` ya existe en
lib/db/supabase.js y está sin usar.

Armá una pantalla /solicitudes dentro de app/(panel)/ con:

- La lista de solicitudes en estado `nueva` (usá `db.solicitudesNuevas()`).
- Por cada una, tres acciones como server actions: "Auditar ahora",
  "Descartar" y "Ya la contacté".
- "Auditar ahora" llama a la ruta /api/auditar con el nombre del negocio y la
  ciudad, y si encuentra el perfil guarda el `lead_id` en la solicitud y la
  pasa a estado `auditada`.

Dos cosas que importan:

- Si la solicitud tiene `nota` cargada, esa dirección está en la lista de
  supresión. Mostralo con el estilo `.aviso.stop` y NO ofrezcas ninguna acción
  que le escriba: la baja no se revierte. Solo "Descartar" y "Ya la contacté".
- La pantalla va adentro de app/(panel)/ para heredar el control de acceso del
  layout del grupo. No la pongas afuera.

Sumá el enlace a app/(panel)/nav.jsx y actualizá la lista de rutas del README y
de .agents/rules/03-arquitectura.md.

Corré `npm test` y `npm run verificar`.
```

---

## P3 · El canal de WhatsApp

Está a medio hacer y se nota: el guardián tiene `cupo_diario_whatsapp`,
`sequences.js` tiene `PLANTILLAS_META_WHATSAPP`, el esquema acepta
`canal = 'whatsapp'` — pero no existe el módulo que manda.

```
El canal de WhatsApp está declarado en todo el sistema y no existe el módulo
que envía. Esto ya está puesto y funcionando:

- `guard.js` acepta `canal: 'whatsapp'` y tiene su propio cupo diario.
- `sequences.js` exporta `PLANTILLAS_META_WHATSAPP`.
- La tabla `mensajes` acepta `canal = 'whatsapp'`.

Falta lib/integrations/whatsapp.js con la API de WhatsApp Business Cloud.

Hacelo siguiendo exactamente el patrón de lib/integrations/gmail.js:
- `fetch` directo contra graph.facebook.com, sin SDK.
- Una función `enviarPlantilla({ para, plantilla, variables })` y otra
  `enviarTexto({ para, texto })` para la ventana de 24 horas.
- Reintentos con espera creciente ante 429 y 5xx, como hace google-oauth.js.
- Las credenciales por variable de entorno: WHATSAPP_TOKEN,
  WHATSAPP_PHONE_ID. Agregalas a .env.example con su explicación.

Y ANTES de escribir una línea, dejame anotado en el bloque de comentario del
archivo:
- Que fuera de la ventana de 24 horas solo se pueden mandar plantillas
  aprobadas por Meta, y que una plantilla rechazada no se puede usar.
- Cuánto cuesta una conversación iniciada por el negocio en Argentina, si lo
  sabés; si no, dejá el lugar marcado con [VERIFICAR] en vez de inventar un
  número.

NO lo enganches todavía a ninguna tarea programada. Este prompt termina con el
módulo escrito, sus tests, y `npm test` en verde. Enganchar el canal es otra
tarea y otra decisión.
```

---

## P4 · La comparación con la competencia

`compararConCompetencia()` está en `audit-engine.js`, `report.js` ya sabe
maquetar el bloque, y ningún flujo lo produce. Es el mismo tipo de cabo suelto
que tenía `agendarLlamada()`.

```
`compararConCompetencia()` existe en lib/core/audit-engine.js y `report.js` ya
tiene `bloqueComparacion()` listo para maquetarlo. Ningún flujo la llama, así
que el informe nunca muestra esa sección.

En la tarea `prospeccion` de app/api/cron/[tarea]/route.js, después de auditar
un perfil y antes de generar el informe:

1. Buscá en Places los 3 perfiles mejor rankeados de la misma categoría y
   ciudad, distintos del auditado.
2. Auditalos con el mismo motor (sin guardarlos como leads: van al corpus
   nomás, que es donde corresponde).
3. Pasá el resultado a `generarInformeHTML` en la opción `comparacion`.

Tres límites que hay que respetar:
- Si no se consiguen al menos 2 competidores, NO muestres la sección. Comparar
  contra uno solo no dice nada y el informe pierde credibilidad.
- Cada competidor es una llamada más a Places. Contá el costo en la bitácora y
  respetá `presupuesto_api_mes_usd`.
- Los competidores van al corpus pero NUNCA a `leads`: no son prospectos, son
  referencia. Si entraran a leads, la prospección podría terminar
  escribiéndoles.

Agregá un test que verifique que con menos de 2 competidores el informe no
incluye el bloque. Corré `npm test` y `npm run verificar`.
```

---

## P5 · El paso de lead a cliente

La tabla `clientes` existe, `postventa` la lee, y nada la escribe nunca. El
momento en que alguien acepta una propuesta no está implementado.

```
La tabla `clientes` existe desde la migración 001 y la tarea `postventa` la
lee, pero NADA escribe en ella. El momento en que un prospecto acepta una
propuesta no está implementado en ningún lado.

Armá el paso:

1. En la pantalla de leads, para un lead en etapa `presupuestado`, un botón
   "Aceptó la propuesta" que abra un formulario chico: plan, setup, mensual,
   día de cobro y método de pago.
2. Un server action que, en una sola operación:
   - cree la fila en `clientes` con `score_inicial` = el score actual del lead,
   - marque la propuesta correspondiente con `aceptada_en`,
   - pase el lead a etapa `ganado`.
3. Si algo falla a mitad de camino, que no queden las tres cosas a medias:
   hacelo con una función de Postgres `security definer` en una migración
   nueva, no con tres llamadas sueltas desde la aplicación.

Ojo con esto: una propuesta ya enviada NO puede cambiar de precio — hay un
disparador en la migración 003 que lo impide. Si el precio pactado difiere del
de la propuesta, se crea una propuesta nueva y se acepta esa. No busques la
forma de saltear el disparador.

Corré `npm test` y `npm run verificar`.
```

---

## P6 · Limpieza de lo que sobra

Barato, rápido, y evita que el proyecto acumule cosas que parecen existir.

```
Hay funciones exportadas que nadie llama. Algunas son cabos sueltos de verdad
—código que parece una función del sistema y no hace nada— y otras son
herramientas legítimas que se usan a mano.

Revisá estas y decidí caso por caso:

  resumenCorto            lib/core/report.js
  render, OBJECIONES,
  detectarObjecion        lib/core/sequences.js
  aplicarBusinessProfile,
  aplicarCapturaAsistida  lib/core/normalize.js
  borrador, etiquetar,
  crearEtiqueta,
  enviadosHoy             lib/integrations/gmail.js
  gastoDelMes             lib/db/supabase.js
  moverA, carpeta,
  compartirPorEnlace      lib/integrations/workspace.js
  placeIdDesdeUrl,
  estimarCosto            lib/integrations/places.js

Para cada una, una de tres:
  a) Engancharla donde corresponde, si le falta un lugar en un flujo.
  b) Dejarla y documentar en su comentario POR QUÉ está sin usar (ej.:
     `aplicarBusinessProfile` es para clientes firmados, no para prospección).
  c) Borrarla.

No borres nada que tenga tests. Y al terminar, agregá a tests/web.test.js un
test que liste los exports sin usar y falle si alguno no está ni enganchado ni
documentado — así esto no vuelve a acumularse.

Corré `npm test` y `npm run verificar`.
```

---

## PX · El prompt de cierre

Antes de terminar cualquier sesión. Barato y evita que el proyecto se
desincronice de su propia documentación.

```
Terminamos por hoy. Antes de cerrar:

1. Corré `npm test` y `npm run verificar`. Los dos en 0.
2. Si lo que hicimos cambió una ruta, una tabla, un invariante o una trampa
   conocida, actualizá AGENTS.md y el archivo de .agents/rules/ que
   corresponda. La documentación desactualizada es peor que ninguna: la próxima
   sesión la va a leer como si fuera cierta.
3. Si agregaste una tarea programada, verificá que esté en los tres lugares:
   la migración con su cron, la tabla del README y .vscode/tasks.json.
4. Hacé un commit con un mensaje que explique POR QUÉ, no qué archivos
   tocaste. El qué está en el diff.

Decime en tres líneas qué quedó a medias, si quedó algo.
```

---

## Prompts de rescate

Cuando algo se rompe. Son cortos a propósito: el objetivo es gastar poco.

**Un test falla y no entendés por qué**

```
Falla este test: [pegá el nombre y el error]

No cambies el test para que pase. El test describe una propiedad que el sistema
tiene que cumplir; si falla, es el código el que está mal, salvo que me
demuestres que la propiedad está mal escrita.

Decime primero qué propiedad protege ese test y cuál es la causa. Recién
después, el arreglo.
```

**El despliegue de Vercel falla**

```
Falla el build en Vercel con este error: [pegá el log]

Antes de tocar nada: reproducilo en local con `npm run build`. Si en local
compila y en Vercel no, la diferencia está en las variables de entorno o en la
versión de Node, no en el código. Revisá eso primero.
```

**Algo no anda en producción y no sabés qué**

```
El sistema está corriendo pero [describí el síntoma].

La respuesta a "por qué hizo eso" está en una fila. Decime exactamente qué
consultas SQL correr contra Supabase para encontrarla, en orden, empezando por
la tabla `bitacora` —que guarda cada decisión del guardián con su regla y su
razón— y siguiendo por `cron.job_run_details` y `net._http_response`.

No cambies código hasta que sepamos qué pasó.
```

---

## Dos prompts que NO conviene usar

**"Mejorá el proyecto"** y cualquier variante. El agente va a tocar quince
archivos, gastar media semana de cuota y dejarte un diff que no podés revisar.
Si querés mejoras, pedí una sola cosa nombrada.

**"Arreglá todos los tests que fallan"** sin haber leído los errores primero.
Los tests de este proyecto que se llaman `PROPIEDAD CRÍTICA` protegen la
diferencia entre un sistema agéntico y un generador de spam. Un agente apurado
por hacerlos pasar puede "arreglarlos" borrando la propiedad.
