---
applyTo: "app/**/*.jsx"
---

- Las pantallas privadas van dentro de `app/(panel)/`, que aplica el control de
  acceso en su layout. Las públicas (landing, `informe`, `baja`) van afuera, sin
  barra de navegación: un prospecto no tiene por qué ver el menú del CRM.
- El layout raíz pone `noindex` por defecto. Levantalo solo en una página que no
  hable del negocio de un tercero.
- El formulario público escribe en `solicitudes`, nunca en `leads`. Ver la
  migración 004.
- Ninguna página importa `lib/integrations/gmail.js`. Las pantallas dibujan y
  guardan decisiones; enviar es trabajo de una tarea programada.
- `SUPABASE_SERVICE_ROLE_KEY` nunca lleva prefijo `NEXT_PUBLIC_` ni se usa en un
  componente de cliente.
- Componentes de servidor por defecto. `'use client'` solo si hace falta estado
  del navegador, y en ese caso el componente no puede tocar la base.
- Los estilos viven en `app/globals.css` con los tokens de la identidad. Nada de
  colores sueltos en los componentes.
