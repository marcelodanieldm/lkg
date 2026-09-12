# Lokigi

Sistema agéntico que audita perfiles de Google Business Profile, contacta
prospectos y gestiona el CRM. Next.js sobre Vercel, Postgres en Supabase,
Gemini para lo poco que escribe un modelo, Google Workspace como superficie de
trabajo.

Este archivo lo leen VS Code (`chat.useAgentsMdFile`), Antigravity, Claude Code
y Cursor. Las reglas específicas de Antigravity están en `.agents/rules/`, y los
prompts listos para pegar —con el backlog ordenado por valor— en
`.agents/PROMPTS.md`.

## Antes de tocar nada, leé esto

Este proyecto **envía correos a personas reales**. Un error acá no es un bug: es
un mensaje que no debió salir, un dominio quemado, o una denuncia por spam.

## La propiedad que sostiene el diseño

**Ningún agente puede enviar.** Los agentes producen *intenciones* de envío; un
guardián determinista de doce reglas decide si algo sale. La herramienta de
envío no está en la lista de ningún agente — no es una convención ni una
instrucción en un prompt: la herramienta no existe para ellos.

Si te encontrás agregando una llamada a `enviar()` en una tarea programada, o
una herramienta de envío al registro de agentes: **pará y preguntá**. Ese cambio
rompe la propiedad central del sistema. Hay tres tests llamados
`PROPIEDAD CRÍTICA` que leen el código fuente y fallan si pasa.

## Comandos

```bash
npm run dev        # desarrollo en localhost:3000 (la landing en /, el panel en /panel)
npm test           # 78 tests (motor · guardrails · stack web)
npm run verificar  # preflight: entorno, base, Google, los 4 casos que bloquean
npm run auth       # genera el refresh token de Google, una sola vez
npm run build      # compilar
```

`npm run verificar` tiene que salir con código 0 antes de dar por terminado
cualquier cambio. No alcanza con que pasen los tests: los tests prueban la
lógica con dobles, el preflight prueba la instalación real.

## Arquitectura en seis líneas

```
Places API + sitio web + captura asistida
  → normalize.js → audit-engine.js (25 reglas deterministas, SIN modelo)
  → report.js / quote-engine.js  → se congela el informe en Postgres
  → los agentes de gemini.js redactan → guard.js decide
  → /api/cron/[tarea] envía lo autorizado → todo queda en Supabase
  → de noche, el espejo vuelca todo a Sheets (una sola dirección)
```

- `lib/core/` — el motor. No importa de `db/` ni de `integrations/`.
- `lib/guardrails/guard.js` — la única puerta de salida.
- `lib/db/supabase.js` — PostgREST directo, sin SDK. Misma interfaz que tenía
  el cliente de Sheets: por eso el guardián se migró sin tocar una línea.
- `lib/integrations/workspace.js` — Sheets, Docs, Drive, Calendar. **Solo
  escribe.**
- `app/page.jsx` — la landing. Es la ÚNICA página pública indexable.
- `app/(panel)/` — todo lo privado. El layout del grupo aplica el control de
  acceso, así que una pantalla nueva ahí adentro queda protegida sola.
- `app/api/cron/[tarea]/` — las siete tareas. Reemplazan a los flujos de n8n.
  Las dispara `pg_cron`, no Vercel.
- `supabase/migrations/` — el esquema, la seguridad de filas, los cron.

## Reglas innegociables

1. **El puntaje no lo calcula un modelo.** Sale de `rubric.js`. Dos auditorías
   del mismo perfil dan siempre el mismo número, y cada cifra del informe se
   rastrea hasta la regla que la produjo.
2. **Los precios no los inventa un modelo.** Salen del catálogo de servicios y
   del cálculo de eficiencia en `quote-engine.js`. Un test compara cada número
   del documento de propuesta contra lo que devolvió el motor.
3. **El guardián falla cerrado.** Si una regla no puede evaluarse, el veredicto
   es `BLOQUEADO`. Un error nunca abre la puerta.
4. **El orden de las reglas está fijado.** Cumplimiento primero (bloquea
   permanente), ritmo después (solo difiere). Una baja jamás puede quedar tapada
   por un "todavía no es horario".
5. **La supresión es irreversible.** Un disparador de Postgres rechaza poner
   `opt_out` en falso. No agregues una vía para revertirla.
6. **Nada de promesas.** Ni de posiciones, ni de garantías, ni de resultados
   numéricos. El linter lo bloquea, pero la instrucción va primero.
7. **Lo que no se puede verificar no se estima.** Los campos que la API pública
   no expone quedan nulos y se excluyen del cálculo. Es lo que hace defendible
   el informe.
8. **Un pedido desde la web no es un lead.** El formulario público escribe en
   `solicitudes`, nunca en `leads`. Si pudiera escribir en `leads`, sería la vía
   para saltearse la irreversibilidad de `opt_out`: alguien dado de baja
   aparecería otra vez en la cola de envíos. Ver la migración 004.
9. **Workspace escribe, no decide.** Ninguna función de `workspace.js` puede
   devolver algo de lo que dependa el estado del sistema. La única lectura es
   `leerNotas()`, y lo que trae se muestra y nada más. Un test falla si aparece
   otra.
10. **WhatsApp nunca inicia en frío.** Un WhatsApp a un número obtenido de Google Maps sin consentimiento previo es categoría MARKETING para Meta y es sancionado con el bloqueo del número. WhatsApp se utiliza únicamente cuando el prospecto responde (abriendo la ventana conversacional de 24 hs sin requerir plantillas aprobadas).
11. **El Supervisor o un agente puede pausar, solo un humano puede reanudar.** El Supervisor y las tareas pueden activar la `pausa_general` (`TRUE`), pero desactivarla (`FALSE`) es una decisión humana exclusiva realizada desde el panel (`app/(panel)/panel/acciones.js`) con un motivo obligatorio ($\ge 20$ caracteres). Un test de código fuente lo verifica.

## Trampas conocidas

- **`\b` con acentos.** En JavaScript `\b` reconoce solo `[A-Za-z0-9_]`, así que
  `/\búltima/` **nunca** coincide. Usá el helper `B()` de `guard.js`. Este bug ya
  pasó desapercibido una vez.
- **`NEXT_PUBLIC_` compila el valor adentro del navegador.** La clave de
  servicio de Supabase ignora la seguridad de filas: si alguna vez lleva ese
  prefijo, el CRM entero queda público. Un test y el preflight lo verifican.
- **El GET de la baja no puede ejecutar.** Los escáneres de enlaces de los
  antivirus corporativos visitan todas las URLs de un correo antes de
  entregarlo. Si `/baja` diera de baja al abrirse, media lista se desuscribiría
  sola. El POST de un clic va a `/api/baja`, que es otra ruta.
- **Las tareas programadas devuelven 200 aunque fallen.** Un 500 hace que
  `pg_cron` reintente y duplique trabajo ya hecho a medias.
- **El informe se congela.** Se guarda el HTML renderizado, no los datos para
  volver a renderizarlo. Si se recalculara al abrirse, el prospecto podría ver
  un número distinto al del correo que lo trajo.
- **La app de Google en estado "Prueba" caduca el refresh token cada 7 días.**
  Hay que publicarla en la pantalla de consentimiento. Es la causa número uno de
  que un sistema así deje de mandar correos un lunes sin avisar.
- **Vercel Hobby: un cron por día, ±59 minutos.** Por eso la programación vive
  en `pg_cron`. No muevas tareas al cron de Vercel.
- **Prospección y seguimiento no corren al mismo minuto.** Si se ejecutaran en simultáneo, ambas tareas leerían el gasto diario antes de registrar sus envíos, creando una condición de carrera que superaría el `cupo_diario`. Prospección corre a las 11:00 UTC (8:00 AR) y seguimiento a las 13:00 UTC (10:00 AR).
- **`noindex` es el default del layout raíz.** Solo la landing y el informe de
  ejemplo lo levantan. Una pantalla nueva queda fuera de los buscadores salvo
  que alguien lo decida a propósito — y un test verifica cuáles se declaran
  indexables.
- **`sendUpdates=all` en Calendar es un envío.** Google le manda la invitación
  al invitado por su cuenta, sin pasar por el guardián. `agendarLlamada()` viene
  con `avisar: false` y así tiene que quedarse: el evento se crea en tu
  calendario y el mensaje que se lo comunica al prospecto sale por el circuito
  normal. Hay un test que lo verifica.
- **Una integración que nadie llama no existe.** `agendarLlamada()` estuvo
  exportada y sin usar durante un tiempo: parecía que Calendar andaba y no hacía
  nada. Hay un test que falla si alguna función de `workspace.js` queda sin
  enganchar a un flujo.
- **La raíz es pública.** Si movés el panel de vuelta a `/`, un prospecto que
  entra al dominio ve una pantalla de acceso al CRM en vez de la página que le
  explica quién le escribió. Hay un test que lo impide.
- **`/simulacro` no envía nada.** La pantalla `/simulacro` evalúa la cola en memoria sin importar `gmail.js` ni llamar a `enviar()`. La cuota diaria se acumula en un estado simulado local para que las filas sobrantes se muestren correctamente como `DIFERIDO`. Un test de `PROPIEDAD CRÍTICA` asegura que la pantalla no importe el cliente de correo.

## Estilo

Código y comentarios en castellano rioplatense. Cero dependencias de producción
más allá de Next y React. Los comentarios explican **por qué**, nunca **qué**.
Ningún número mágico suelto: la metodología vive en `rubric.js` y la operación
en la tabla `config`.

Ver `.agents/rules/02-estilo.md` para el detalle.
