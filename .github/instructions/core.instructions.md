---
applyTo: "lib/core/**"
---

El núcleo determinista. Recibe datos, devuelve datos.

- No importa de `lib/db/`, `lib/ia/` ni `lib/integrations/`.
- El puntaje sale de `rubric.js`; los precios, del catálogo de servicios. Nunca
  de un modelo de lenguaje.
- Dos corridas con la misma entrada dan siempre la misma salida. Nada de
  `Math.random()` ni de `Date.now()` adentro del cálculo.
- Lo que no se puede verificar queda nulo y se excluye del denominador. No se
  estima: eso es lo que hace defendible el informe.
- Todo número que llegue al informe tiene que poder rastrearse hasta la regla
  que lo produjo.
