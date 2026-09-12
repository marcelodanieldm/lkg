---
applyTo: "lib/guardrails/**,app/api/guard/**,app/api/cron/**"
---

Este código decide si un correo sale hacia una persona real.

- Falla cerrado: ante cualquier error, el veredicto es `BLOQUEADO`.
- Ninguna regla consulta un modelo de lenguaje.
- El orden de las reglas está fijado: cumplimiento primero, ritmo después.
- El guardián no importa ninguna base ni nada de Workspace: recibe la fuente
  por `usarFuente()`, sin valor por defecto.
- Nada de acá puede llamar a `enviar()` salvo `enviarYRegistrar()`, que recibe
  un veredicto del guardián antes de ejecutarse.
- Toda regla nueva necesita dos tests: el caso que bloquea y un caso legítimo
  que debe seguir pasando.
- Cuidado con `\b` y los acentos en las expresiones del linter: usá `B()`.
