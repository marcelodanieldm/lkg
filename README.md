# Lokigi

Sistema agéntico para la auditoría automatizada de perfiles de Google Business Profile, prospección comercial y gestión de CRM. Construido sobre Next.js en Vercel, Postgres en Supabase, Gemini para redacción/clasificación y Google Workspace como superficie de trabajo.

---

## 🔒 La propiedad central del diseño

**Ningún agente puede enviar.** Los agentes producen *intenciones* de contacto; un guardián determinista de doce reglas en `lib/guardrails/guard.js` las evalúa y decide si salen. La herramienta de envío no existe en la lista de ningún agente.

```
pausa_general → destinatario_valido → supresion → etapa_terminal →
idempotencia → tope_toques → linter → ventana_horaria →
espaciado_lead → cupo_diario → presupuesto → modo_autonomia
```

- **Falla cerrado**: Si una regla no puede evaluarse (caída de base, dato faltante), el veredicto es `BLOQUEADO`.
- **Invariante de reanudación**: El Supervisor o cualquier rutina pueden activar la `pausa_general` (`TRUE`), pero **únicamente una persona desde el panel** puede desactivarla (`FALSE`) mediante un formulario con motivo escrito obligatorio ($\ge 20$ caracteres).
- **PROPIEDAD CRÍTICA**: Múltiples tests leen el código fuente e impiden que exista envío directo fuera del guardián o reanudación automática de la pausa.

---

## 📐 Arquitectura de Software

```
Places API + sitio web + captura asistida
  → lib/core/normalize.js → lib/core/audit-engine.js (25 reglas deterministas)
  → lib/core/report.js / quote-engine.js → informe congelado en Postgres
  → los agentes de lib/ia/gemini.js redactan → lib/guardrails/guard.js decide
  → app/api/cron/[tarea]/ envía lo autorizado → todo registrado en Supabase
  → de noche, el espejo vuelca todo a Sheets (una sola dirección)
```

- **`lib/core/`**: El motor puro del sistema. No importa de `db/`, `ia/` ni `integrations/`. Recibe datos y devuelve cálculos deterministas.
  - `rubric.js`: 25 reglas en 6 dimensiones. Incluye para cada fallo la solución paso a paso (`comoSeArregla`).
  - `audit-engine.js`: Ejecuta la rúbrica sobre perfiles normalizados.
  - `quote-engine.js`: Calcula presupuestos y alternativas según el catálogo.
  - `resenas.js`: Cruza el texto de reseñas reales contra los datos declarados en el perfil (ej. horario incoherente).
  - `prospeccion.js`: Armado determinista de intentos de seguimiento.
- **`lib/guardrails/`**: `guard.js` evalúa los intentos y aplica linter, ventana horaria, rampa de calentamiento y supresiones.
- **`lib/db/`**: Adaptador de Postgres sobre Supabase REST API (PostgREST), sin el cliente pesado de SDK.
- **`lib/integrations/`**: Módulos que hablan con servicios externos (Places API, Workspace). Solo escriben o leen notas aisladas.
- **`app/`**: Aplicación Next.js con grupo de rutas privadas `app/(panel)/` protegidas por sesión.

---

## 💼 Reglas de Negocio e Invariantes

1. **El puntaje no lo calcula un modelo**: Proviene de `rubric.js`. Dos auditorías del mismo perfil producen el mismo número.
2. **Los precios no los inventa un modelo**: Provienen de `quote-engine.js` según las horas estimadas y tarifa base.
3. **La supresión es irreversible**: Un disparador en Postgres impide volver `opt_out` a `false`.
4. **WhatsApp nunca inicia en frío**: El primer contacto en frío es siempre por email. WhatsApp solo se habilita cuando el prospecto responde (ventana conversacional de 24 hs).
5. **Rampa de calentamiento del buzón**: Escalones semanales de 5 / 10 / 15 / 20 / 25 envíos por día para proteger la reputación del dominio.
6. **El informe se congela**: Se almacena el HTML renderizado el día del envío para evitar discrepancias si el perfil cambia después.
7. **Workspace escribe, no decide**: Sheets es un espejo nocturno de lectura/trabajo. Ningún cambio en Sheets puede desescribir una baja o autorizar un envío.

---

## ⚡ Programación de Tareas (`pg_cron`)

Las tareas no dependen del cron de Vercel (limitado a 1 ejec/día en plan Hobby). Se ejecutan desde `pg_cron` dentro de Postgres:

| Tarea | Frecuencia | Propósito |
|---|---|---|
| `prospeccion` | 11:00 UTC (8:00 AR), hábiles | Audita perfiles nuevos, redacta primer toque y evalúa guardián. |
| `seguimiento` | 13:00 UTC (10:00 AR), hábiles | Ejecuta pasos 2, 3 y 4 de la secuencia respetando intervalos. |
| `aprobaciones` | Cada 15 minutos | Envía los mensajes aprobados a mano re-evaluando el guardián. |
| `bandeja` | Cada 10 minutos | Procesa Gmail: 1º bajas definitivas, 2º rebotes, 3º respuestas. |
| `supervisor` | 22:00 UTC (19:00 AR) | Revisa métricas del día, dispara alarmas y pausa si hay anomalías. |
| `espejo` | 05:00 UTC (2:00 AR) | Vuelca Postgres a la planilla de Sheets espejo. |
| `postventa` | 1º de cada mes | Re-audita clientes activos para medir evolución de score. |

---

## 🖥️ Mapa de Rutas del Panel

```
/                    landing             pública, indexable
/informe/ejemplo     informe de muestra  pública, indexable, perfil inventado
/informe/[id]        informe de un lead  pública por enlace, noindex
/baja                darse de baja       pública, noindex
/acceso              ingreso             pública, noindex
/panel               panel principal     PRIVADA
/solicitudes         solicitudes web     PRIVADA
/aprobaciones        cola de visto bueno PRIVADA
/leads               gestión de leads    PRIVADA
/simulacro           auditoría en memoria PRIVADA
```

### Modo Simulacro (`/simulacro`)
Permite simular la corrida de la cola del día **sin enviar ningún correo y sin consumir API de Places ni Gemini**:
- Presenta el aviso claro: `⚠ SIMULACRO · ESTO NO ENVÍA NADA`.
- Resume los veredictos (`PERMITIDO`, `DIFERIDO`, `BLOQUEADO`, `APROBACION`, `INCOMPLETO`).
- Simula en memoria la acumulación de envíos para reflejar cómo la regla `cupo_diario` difiere los envíos cuando se alcanza la cuota.
- Posee un test de `PROPIEDAD CRÍTICA` que garantiza la ausencia total de llamados a `enviar()` o importaciones de `gmail.js`.

---

## 🛠️ Comandos de Desarrollo y Verificación

```bash
# Desarrollo local
npm run dev

# Ejecución de la suite completa de tests (94 tests)
npm test

# Preflight de verificación de entorno, base y guardrails
npm run verificar

# Generar refresh token de Google OAuth
npm run auth

# Compilar proyecto para producción
npm run build
```

Antes de dar por finalizado cualquier trabajo, `npm run verificar` y `npm test` deben terminar con código de salida 0.
