---
trigger: glob
globs: lib/**/*.js, app/**/*.js, app/**/*.jsx, scripts/*.js
description: Estilo de código y de comentarios en el repositorio de Lokigi.
---

# Estilo

## Idioma

El código está **en castellano**: nombres de funciones, variables, comentarios y
mensajes de error. `evaluar()`, `veredicto`, `huella()`, `cupoDelDia()`. No
mezclar con inglés salvo en lo que viene de una API externa (`placeId`,
`threadId`, `messageId`).

Los mensajes de error los lee Marcelo, no un desarrollador anglosajón. Que
digan qué pasó y qué hacer: *"Cotizar en ARS requiere opts.tipoCambio"*, no
*"Invalid argument"*.

## Comentarios

Un comentario explica **por qué**, nunca **qué**. Si hace falta explicar qué
hace una línea, la línea está mal escrita.

```js
// Mal: incrementa el contador
contador++;

// Bien: append es atómico en Sheets; leer-sumar-escribir se pisa
// cuando dos flujos de n8n corren a la vez.
await sheets.agregar('Mensajes', fila);
```

Los archivos importantes abren con un bloque que explica su rol en el sistema y
las decisiones no obvias. Ese bloque es lo primero que lee alguien que vuelve al
código en seis meses: escribilo para esa persona.

## Dependencias

**Cero dependencias de producción más allá de Next y React.** Antes de agregar
un paquete, preguntate si son cuarenta líneas de código propio.

Dos casos concretos de este repositorio: `googleapis` son unos 50 MB para usar
cuatro endpoints REST, y `@supabase/supabase-js` son 2 MB que se cargarían en
cada arranque en frío de una función serverless. Los dos se reemplazan con
`fetch` y se nota en el tiempo de respuesta.

Si una dependencia es realmente necesaria, hay que justificarla en el PR.

## Tests

Node test runner nativo, sin framework. Los tests van en castellano y describen
el comportamiento, no la función: `'la baja gana sobre el horario y sobre el
cupo'`, no `'test evaluar()'`.

Inyección de dependencias antes que mocks de módulo: `usarFuente()` en vez de
`mock.module()`, para que los tests corran sin banderas experimentales.

## Números

Ningún precio, umbral o peso se escribe suelto en el medio del código. Todo vive
en `rubric.js` (rúbrica y servicios), en la tabla `config` (operación) o en
`quote-engine.js` (niveles). Un número mágico en una función es un número que
nadie va a encontrar cuando haya que cambiarlo.
