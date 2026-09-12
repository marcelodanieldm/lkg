# Lokigi

Audita perfiles de Google Business Profile, redacta el primer contacto, y **no
manda nada sin autorización**. Corre entero sobre planes gratuitos: Vercel para
la aplicación, Supabase para la base y la programación, Gemini para lo poco que
escribe un modelo, y Google Workspace como superficie de trabajo.

---

## Lo primero: el puntaje no lo decide un modelo

`lib/core/rubric.js` tiene 25 reglas repartidas en 6 dimensiones con pesos
fijos. Cada regla declara cuánto pesa, qué fundamento la respalda y qué
servicio la corrige. El puntaje sale de ahí y **de ningún otro lado**.

Dos auditorías del mismo perfil dan el mismo número, hoy y dentro de un año. El
modelo de lenguaje solo redacta el texto del correo y clasifica las respuestas
que llegan. Ni toca el puntaje, ni toca los precios.

Eso es lo que permite que cada afirmación del informe sea rastreable hasta la
regla que la produjo. Si un prospecto pregunta "¿de dónde sacaste 34?", la
respuesta está en una fila.

## Lo segundo: nadie puede enviar

Ningún agente tiene una herramienta de envío. Los agentes producen
*intenciones*; `lib/guardrails/guard.js` las evalúa con doce reglas
deterministas y decide. En orden fijo:

```
pausa_general → destinatario_valido → supresion → etapa_terminal →
idempotencia → tope_toques → linter → ventana_horaria →
espaciado_lead → cupo_diario → presupuesto → modo_autonomia
```

Las primeras siete bloquean para siempre. Las de ritmo solo difieren. El orden
importa: una baja nunca puede quedar tapada por un "todavía no es horario".

**Falla cerrado.** Si una regla no puede evaluarse —se cayó la base, falta un
dato— el veredicto es BLOQUEADO. Un error nunca abre la puerta.

---

## Arranque

### 1. Supabase

Creá un proyecto y corré las cuatro migraciones en el editor SQL, en orden:

```
supabase/migrations/001_esquema.sql       tablas, índices, el percentil en SQL
supabase/migrations/002_rls_y_cron.sql    seguridad de filas y pg_cron
supabase/migrations/003_workspace.sql     propuestas, informes, el espejo
supabase/migrations/004_solicitudes.sql   los pedidos que llegan por la landing
```

Antes de que 002 programe los cron, cargá los dos secretos en Vault:

```sql
select vault.create_secret('https://TU-APP.vercel.app', 'app_url');
select vault.create_secret('TU_LOKIGI_API_KEY', 'lokigi_api_key');
```

### 2. Google

```bash
export GOOGLE_CLIENT_ID="...apps.googleusercontent.com"
export GOOGLE_CLIENT_SECRET="GOCSPX-..."
node scripts/google-auth.js
```

En Google Cloud, antes: habilitá Gmail, Sheets, Docs, Drive, Calendar y Places
API (New), y **publicá la app** en la pantalla de consentimiento. Mientras
figure en estado "Prueba", el refresh token caduca cada 7 días y Lokigi deja de
funcionar un lunes cualquiera sin avisar.

### 3. Vercel

Importá el repositorio, cargá las variables de `.env.example` y desplegá.

### 4. Verificá antes de encender

```bash
npm run verificar
```

Comprueba que las migraciones corrieron, que la clave anónima **no** puede leer
los leads, que cada API de Google contesta, y que los cuatro casos que tienen
que bloquearse se bloquean. Si algo falla, no enciendas nada.

---

## Cómo corre

La programación **no** vive en Vercel. El plan Hobby permite un cron por día
con ±59 minutos de imprecisión, lo que no sirve para revisar una cola de
aprobación. Vive en `pg_cron`, adentro de Postgres, que es gratis y acepta
cada minuto:

| Tarea | Cuándo | Qué hace |
|---|---|---|
| `prospeccion` | 8:00, días hábiles | Busca, audita, redacta, consulta al guardián |
| `seguimiento` | 8:00, días hábiles | Envía los pasos 2, 3 y 4 de la secuencia |
| `aprobaciones` | cada 15 min | Envía lo que aprobaste, re-evaluándolo antes |
| `bandeja` | cada 10 min | Lee Gmail: baja → rebote → clasificación |
| `supervisor` | 19:00 | Métricas, cinco alarmas, y puede pausar el sistema |
| `espejo` | 2:00 | Vuelca todo a la planilla de Sheets |
| `postventa` | día 1 de cada mes | Re-audita clientes con la misma rúbrica |

El cron de Vercel queda solo como red de seguridad diaria del supervisor.

---

## Google Workspace

**Supabase manda, Workspace espeja.** Postgres es donde vive la verdad porque
es donde están las garantías que una planilla no puede dar: la baja
irreversible, los mensajes que no se editan, la lista de supresión que no se
borra. Sheets, Docs, Drive y Calendar son superficies de trabajo.

| | Qué hace | Se rompe si… |
|---|---|---|
| **Gmail** | Envía y lee la bandeja | …es el único que el sistema *necesita* |
| **Sheets** | Tablero espejo, se rehace cada noche | …nada. Borrala y vuelve |
| **Docs** | La propuesta comercial, con los números del motor | …se manda un PDF adjunto |
| **Drive** | Archivo de informes por mes | …nada. Es respaldo |
| **Calendar** | La llamada, con Meet incluido | …nada. Podés agendar a mano |

Sobre Calendar hay una decisión que conviene tener clara: cuando el prospecto
elige uno de los tres horarios, el evento se crea **sin mandarle la
invitación**. Con `sendUpdates=all` Google se la manda por su cuenta, y eso es
un mensaje que llega a la casilla de un tercero sin pasar por el guardián. El
evento queda en tu calendario con el enlace de Meet; quien se lo comunica es el
mensaje que el guardián sí autorizó.

Si el modelo se equivocó al interpretar la respuesta, lo peor que pasa es un
evento de más en tu agenda. Nadie recibe nada.

Todo lo que este módulo hace es **escribir**. La única lectura es
`leerNotas()`, que trae la columna Z de la planilla para mostrarla al lado del
lead — y no decide nada. Un test falla si aparece otra.

Si alguna vez querés que una nota frene un envío: no lo hagas ahí. Poné el
correo en la tabla `supresiones`, que es irreversible y **sí** la consulta el
guardián.

---

## El formulario de la landing

Un pedido desde la web escribe en `solicitudes`, **nunca** en `leads`. No es
burocracia: `leads.opt_out` es irreversible por disparador, así que un
formulario público que pudiera escribir en `leads` sería la vía para saltearse
esa garantía — alguien dado de baja volvería a aparecer en la cola de envíos.

Si quien completa el formulario está en la lista de supresión, la solicitud
queda marcada y el aviso te lo dice. La baja **no** se revierte: le contestás
vos, a mano, desde tu casilla. Eso es lo correcto cuando alguien vuelve a
golpear la puerta por su cuenta.

## La baja

Dos URLs distintas, y la diferencia no es un detalle:

- `/baja?lead=…` — la visible. Un GET **muestra un botón**, no da de baja. Los
  escáneres de enlaces de los antivirus corporativos visitan todas las URLs de
  un correo antes de entregarlo: si el GET ejecutara, media lista se
  desuscribiría sola y nunca sabrías por qué cayó la tasa de respuesta.
- `/api/baja?lead=…` — la de la cabecera `List-Unsubscribe`. Recibe el POST de
  un clic que manda Gmail desde su propia interfaz, y ese sí ejecuta al
  instante.

Una vez dada de baja, `opt_out` no puede volver a `false`: hay un disparador en
la base que lo impide. Ni un error de programación ni un `update` a mano pueden
deshacerlo.

---

## Las rutas

```
/                    landing             pública, indexable
/informe/ejemplo     informe de muestra  pública, indexable, perfil inventado
/informe/[id]        informe de un lead  pública por enlace, noindex
/baja                darse de baja       pública, noindex
/acceso              ingreso             pública, noindex
/panel               el panel            PRIVADA
/aprobaciones        cola de aprobación  PRIVADA
/leads               tabla de leads      PRIVADA
```

`noindex` es el default del layout raíz y solo dos páginas lo levantan. Casi
todo acá habla del negocio de un tercero que no pidió salir en Google.

## Comandos

```bash
npm run dev          # desarrollo
npm test             # 78 tests
npm run verificar    # preflight: entorno, base, Google, guardrails
npm run build        # compilar
```

Los tests que más importan están en `tests/web.test.js` y se llaman
`PROPIEDAD CRÍTICA`. Uno lee el código de las tareas programadas y falla si
aparece una llamada a `enviar()` fuera de la lista blanca. Es un test frágil a
propósito: el costo de un falso positivo son cinco minutos; el de un falso
negativo, un correo que salió sin autorización.

---

## Encendido

Arrancá con `modo_autonomia` en `aprobacion` y `cupo_diario_email` en `10`.
Revisá a mano los primeros 50 mensajes. La pantalla de aprobaciones guarda el
texto original cada vez que editás uno: lo que corregís siempre es la señal
para ajustar el prompt del Redactor.

El cupo sube solo con la rampa de calentamiento —10 por día la primera semana,
40 al mes y medio—, porque el límite real del correo en frío no es el de
Google, es la reputación del dominio.

---

## Qué hay que saber antes

**Vercel Hobby prohíbe el uso comercial.** La documentación lo dice textual: el
plan está restringido a uso personal y no comercial. Lokigi funciona
perfectamente ahí para probar; el día que cobres el primer cliente, el plan Pro
son 20 dólares al mes.

**Ni Claude Pro ni Google AI Pro dan acceso a la API.** Son suscripciones de
chat. El nivel gratuito de la API de Gemini es otra cosa, existe y no pide
tarjeta: 1.500 pedidos diarios con Flash, treinta veces lo que Lokigi consume.
Pero Google se reserva el derecho de usar esos prompts para entrenar, y por acá
pasan nombres de negocios reales. Activar facturación —2 a 5 dólares al mes—
desactiva ese uso.

**El proyecto gratuito de Supabase se pausa tras 7 días sin actividad.** Los
cron ya la generan; además hay un `lokigi-latido` cada tres días por si alguna
vez se apagan todos.

**La Business Profile API no sirve para prospectar.** Requiere ser dueño del
perfil, aprobación formal de Google y un perfil verificado con más de 60 días.
Lokigi usa Places API (New), que cubre unas cuatro quintas partes de la
rúbrica. Los 7 campos que faltan se marcan como "no verificado" y salen del
denominador: **no se estiman**. Por eso cada informe declara su cobertura.
