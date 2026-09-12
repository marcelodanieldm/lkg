---
trigger: always_on
description: Reglas innegociables del sistema de guardrails de Lokigi. Se aplican a cualquier cambio en el repositorio.
---

# Guardrails: lo que no se toca

Este proyecto envía mensajes comerciales a personas reales. Un error acá no es
un bug: es un correo que no debió salir, un dominio quemado o una denuncia.

## La propiedad que sostiene todo el diseño

**Ningún agente puede enviar.** Los agentes producen *intenciones*; el guardián
determinista decide. Si al modificar código te encontrás agregando una llamada
a `enviar()` en una tarea programada, o una herramienta de envío al registro de
agentes, **pará y preguntá**.

Está verificado por tests que leen el código fuente: los tres que se llaman
`PROPIEDAD CRÍTICA` en `tests/web.test.js` fallan si aparece un envío fuera de
la lista blanca, si la prospección llama a `enviar()` directo, o si lo aprobado
sale sin volver a pasar por el guardián.

## Al tocar `lib/guardrails/guard.js`

1. **Falla cerrado, siempre.** Si una regla no puede evaluarse, el veredicto es
   `BLOQUEADO`. Nunca `PERMITIDO`. Un error jamás debe abrir la puerta.
2. **Ninguna regla consulta un modelo de lenguaje.** El modelo redacta; el
   guardián decide. Si el modelo pudiera influir en su propia autorización, no
   habría guardián.
3. **El orden importa y está fijado.** Cumplimiento primero (bloquea permanente),
   ritmo después (solo difiere). Una baja nunca puede quedar tapada por un
   "todavía no es horario". Si agregás una regla, ubicala en el grupo correcto.
4. **Toda regla nueva necesita un test** que pruebe el caso que bloquea *y* un
   caso legítimo que debe seguir pasando. Un guardrail con falsos positivos es
   un guardrail que alguien va a desactivar.
5. **No le pongas valor por defecto a la fuente de datos.** El guardián no
   importa ningún módulo de base: la recibe por `usarFuente()`. Cuando esa línea
   tenía un default apuntando a Sheets, la migración a Supabase la dejó
   apuntando a un archivo inexistente y habría explotado en el primer envío
   real. Sin default, falta de fuente = BLOQUEADO.

## Al tocar el linter de contenido

Cuidado con `\b` y los acentos: en JavaScript `\b` reconoce únicamente
`[A-Za-z0-9_]`, así que `/\búltima/` **nunca** coincide. Usá el helper `B()`
que arma lookarounds sobre una clase que incluye vocales acentuadas y ñ.

Este bug ya existió una vez y pasó desapercibido: el linter decía "limpio" y
las frases prohibidas que empiezan con acento salían derecho.

## Lo irreversible

- **La supresión no se revierte.** Un disparador de Postgres rechaza poner
  `opt_out` en falso. No agregues una vía para hacerlo.
- **Las tablas `supresiones` y `config` no se escriben desde un agente.**
- **Los mensajes enviados no se editan ni se borran.** Hay reglas de Postgres
  (`mensajes_no_update`, `mensajes_no_delete`) que lo impiden.
- **Una propuesta ya enviada no cambia de precio.** Si hace falta otro número,
  se crea una propuesta nueva.
- **El Supervisor puede activar la pausa general, nunca desactivarla.**
  Reanudar es siempre decisión de una persona.

## Al tocar Google Workspace

`lib/integrations/workspace.js` **solo escribe**. La única lectura es
`leerNotas()`, y lo que devuelve se muestra en pantalla y nada más. Si algo del
sistema empezara a depender de lo que hay en la planilla, una persona editando
una celda un domingo podría hacer que el lunes se le escriba a alguien que pidió
la baja.

Si querés que algo de la planilla frene un envío: poné el correo en la tabla
`supresiones`.

## Antes de dar por terminado cualquier cambio

```bash
npm test          # 69 tests
npm run verificar # preflight sobre la instalación real
```

Si `verificar` sale con código distinto de cero, el cambio no está listo.
