---
trigger: always_on
description: Cómo está organizado Lokigi y qué puede importar cada capa.
---

# Arquitectura

```
Places API + sitio web + captura asistida
  → lib/core/normalize.js
  → lib/core/audit-engine.js      25 reglas deterministas, SIN modelo
  → lib/core/report.js            el informe, que se congela en Postgres
  → lib/core/quote-engine.js      los precios, del catálogo
  → lib/ia/gemini.js              los agentes redactan
  → lib/guardrails/guard.js       el guardián decide
  → app/api/cron/[tarea]/         envía lo autorizado
  → Supabase                      todo queda registrado
  → de noche, el espejo a Sheets  en una sola dirección
```

## Quién puede importar a quién

- `lib/core/` es el núcleo. **No importa de `db/`, de `ia/` ni de
  `integrations/`.** Recibe datos, devuelve datos. Es lo que lo hace testeable
  sin credenciales y determinista.
- `lib/guardrails/guard.js` no importa ninguna base: la recibe por
  `usarFuente()`. Tampoco conoce Workspace.
- `lib/integrations/` habla con el mundo. Todos comparten el token de
  `google-oauth.js`.
- `app/` orquesta. Es el único lugar donde se juntan todas las capas.

## Dónde vive la verdad

**Supabase manda, Workspace espeja.** Postgres tiene las garantías que una
planilla no puede dar: la baja irreversible, los mensajes inmutables, la lista
de supresión que no se borra, el percentil en SQL. Sheets, Docs, Drive y
Calendar son superficies de trabajo que se escriben desde acá.

## Quién programa las tareas

`pg_cron` dentro de Supabase, con `pg_net` llamando a `/api/cron/[tarea]`. **No**
el cron de Vercel: el plan Hobby permite una corrida diaria con ±59 minutos de
imprecisión, lo que no sirve para una cola de aprobación que hay que revisar
cada quince minutos. El cron de Vercel queda como red de seguridad diaria.

Las tareas devuelven 200 aunque fallen por dentro, porque un 500 hace que
`pg_cron` reintente y duplique trabajo hecho a medias.

## Los grupos de rutas de Next

`app/(panel)/` es un grupo: los paréntesis no aparecen en la URL. Todo lo que
está adentro hereda la barra de navegación y el control de acceso. La landing,
el informe público y la pantalla de baja están **afuera** a propósito: un
prospecto no tiene por qué ver un menú que dice "Aprobaciones" y "Leads".

El mapa, entonces:

```
/                    landing            pública, indexable
/informe/ejemplo     informe de muestra pública, indexable, perfil inventado
/informe/[id]        informe de un lead pública por enlace, noindex
/baja                baja                pública, noindex
/acceso              ingreso             pública, noindex
/panel               panel               PRIVADA
/aprobaciones        cola de aprobación  PRIVADA
/leads               tabla de leads      PRIVADA
```

Si agregás una pantalla privada, va adentro de `(panel)`. Ahí queda protegida
sin que tengas que acordarte de llamar a `requerirSesion()`.

Y si agregás una pública, pensá dos veces antes de declararla indexable: el
default del layout raíz es `noindex` porque casi todo acá habla del negocio de
un tercero que no pidió salir en Google.
