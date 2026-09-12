---
applyTo: "lib/integrations/workspace.js"
---

Este módulo **escribe** en Google Workspace. No decide nada.

- Ninguna función puede devolver algo de lo que dependa el estado del sistema.
- La única lectura es `leerNotas()`, y lo que trae se muestra y nada más. Si
  agregás otra función que empiece con `leer`, un test falla.
- El espejo se rehace entero cada noche: se limpia la hoja y se escribe de
  nuevo. Nunca actualices fila por fila.
- Todo valor que va a una celda pasa por `celda()`: un texto que empieza con
  `=`, `+`, `-` o `@` lo interpreta Sheets como fórmula.
- Si una llamada falla, el sistema tiene que seguir funcionando. Workspace es
  comodidad, no infraestructura.
