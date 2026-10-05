# Curino Web — Contexto técnico para Claude

## Ubicación y repositorio

- Local: `/Users/joandemora/Desktop/ESCRITORIO JOAN DE MORA/CURINO/10 - WEB/curino-web/`
- Remote: `https://github.com/joandemora/curino-web.git` · rama principal `main`
- Emisor fiscal: **SISTEMA & CURINO SLU** · CIF **ESB24788580** · Carrer de Balmes 252, 5-2, 08006 Barcelona · info@casacurino.com

## Stack

HTML/CSS/JS estático desplegado en **Vercel** (`vercel.json` con rewrites y redirects, sin build step). Backend en **Supabase Pro** (Postgres + Storage + Edge Functions Deno + pg_cron + pg_net). Pagos con **Stripe** (Checkout + Connect para el marketplace). Emails transaccionales con **Resend** (dominio `casacurino.com` verificado, remitente técnico `noreply@casacurino.com`). PDFs de factura con **pdf-lib** (nunca Puppeteer para facturas). PDFs de presupuesto con **puppeteer-core + @sparticuz/chromium-min** (solo en admin, `chromium-min` tarball remoto — ver `9f89359`).

Sin frameworks (ni React, ni build). Cada página es un HTML independiente. Los shared entre páginas son:

- `/assets/css/site-shell.css` — grid utilities + variables editoriales (`--rv-*`)
- `/assets/css/tokens.css` — palette alternativa no usada por páginas públicas (rebrand futuro)
- `/assets/js/main-nav.js` — inyecta `<div id="main-nav-mount">` con nav completo
- `/assets/js/main-footer.js` — inyecta `<div id="main-footer-mount">` con footer
- `/assets/js/cookie-banner.js` — banner de consent propio, autocontenido

`/partners/` y `/partners/gracias/` usan el sistema shared desde 2026-10 (antes eran autocontenidas); su CSS propio va inline con prefijo `pt-`/`gr-`. Desde v2 (2026-10) usan la estética de los one-pagers de Partners (negro `#161616`, verde `#12B76A`, papel `#F7F7F2`, titulares Schibsted Grotesk 800) dentro del header/footer de la web. **Sin precios en la página**: el importe solo se ve en Stripe. `/partners/acceso/` sigue autocontenida (estética antigua, solo para compradores del curso de 90 €). **La ruta pública anterior `/clases/*` redirige con 301 permanente a `/partners/*`**, y `/partners/clase` → `/partners/` (ver `vercel.json`).

## Estructura

```
curino-web/
├── index.html                              ← landing principal
├── admin/                                  ← panel interno (presupuestos, revista, generador IA)
├── api/                                    ← Vercel API routes (Node CommonJS y Edge)
│   ├── admin/                              ← endpoints internos (generate-article, quotes/, etc.)
│   ├── revista/                            ← endpoints públicos de la revista (SSR)
│   ├── webhooks/stripe.js                  ← LEGACY, NO usar (webhook real vive en Edge)
│   ├── checkout.js                         ← crea Stripe session para armarios
│   ├── stripe-session.js                   ← read-only, alimenta purchase de GA4
│   ├── clases-checkout.js                  ← proxy a Edge Function clases-checkout
│   ├── clases-proxima.js                   ← clases_public + plazas_restantes (RPC plazas_intensivo_disponibles)
│   ├── lista-espera.js                     ← proxy a Edge Function lista-espera-relay
│   ├── partners-solicitud.js               ← proxy a Edge Function partners-solicitud (form /partners)
│   ├── curso-acceso.js                     ← proxy a curso-acceso (acceso curso 90 € ya comprado)
│   ├── solicitar-presupuesto.js            ← form leads con adjuntos
│   ├── config.js                           ← devuelve claves públicas (Supabase anon, Google Maps)
│   └── sitemap.js                          ← genera sitemap.xml (rewrite en vercel.json)
├── checkout/                               ← página de compra multi-armario
├── configurador-armarios-vestidores/       ← configurador 3D + confirmación
├── configurador-2d/                        ← configurador marketplace 2D
├── partners/                               ← landing solicitud Curino Partners + /gracias + /acceso
├── revista/                                ← revista editorial
├── mi-cuenta/, cuenta/, login/, registro/  ← área de usuario Supabase
├── maestro/, auth/                         ← onboarding + callback
├── {cocinas,armarios-vestidores,banos,dormitorio,...}/  ← 20 páginas de sección
├── {aviso-legal,privacidad,cookies,terminos-marketplace}/  ← páginas legales
├── assets/                                 ← imágenes (webp/png/jpg), CSS shared, JS shared
├── supabase/
│   ├── config.toml                         ← registro de Edge Functions (enabled + verify_jwt)
│   ├── functions/                          ← Edge Functions Deno
│   └── migrations/YYYYMMDDHHMMSS_*.sql     ← migraciones vigentes (timestamp completo)
├── supabase-*.sql                          ← SQL legacy (ejecutar en SQL Editor manualmente)
├── CONSENT_AUDIT.md                        ← auditoría cobertura consent Mode v2 (junio 2026)
└── vercel.json                             ← rewrites + redirects (no crons, no builds)
```

## Backend Supabase

### Migraciones

Dos convenciones coexisten:

- `/supabase/migrations/YYYYMMDDHHMMSS_<snake>.sql` — **formato vigente** consumido por `supabase db push`. Timestamp completo obligatorio: el CLI usa la versión como PK en `supabase_migrations.schema_migrations` y colisiona si dos archivos comparten prefijo (pasó en septiembre 2026 con los prefijos `YYYYMMDD` a secas y forzó un renombrado retroactivo — ver commit chore(supabase): prefijos únicos). Si vas a crear varias en el mismo día usa `HHMMSS` real o incremental `000001`, `000002`… Todo lo nuevo va aquí.
- `/supabase-<módulo>-<fase>.sql` en la raíz — formato legacy, ejecutado a mano en el SQL Editor. Todavía es la fuente de verdad para varias tablas (`invoice_counters`, `library_items`, `magazine_articles`, `marketplace_orders`, etc. — creados antes de `supabase/migrations/`).

Las migraciones son idempotentes por diseño: `create table if not exists`, `create or replace function`, `drop policy if exists ... create policy`. Se pueden reejecutar sin daño.

### Módulos y áreas

| Área | Tablas principales | Migración origen |
|---|---|---|
| Configurador armarios (H2) | `armario_orders`, `armario_checkout_drafts` | `20260526_armario_orders.sql` |
| Formulario presupuestos | `presupuesto_solicitudes`, `presupuestos` | `20260525_presupuesto_solicitudes.sql` + `supabase-quotes.sql` |
| Marketplace (piezas 3D) | `library_items`, `purchases`, `marketplace_orders`, `seller_accounts`, `marketplace_config` | `supabase-marketplace-fase-*.sql` |
| Revista (editorial) | `magazine_articles`, `magazine_purchases`, `magazine_credits`, `magazine_boosts` | `supabase-revista-fase-g*.sql` |
| Generador IA | `ai_articles`, `ai_generator_config`, etc. | `20260519_ai_*.sql` |
| Clases / Intensivo Partners | `clases`, `inscripciones`, `lista_espera` | `20260802_clases.sql` (+ `oculta`/`titulo` en `20261008000001`, `fecha_confirmada` en `20261012000001`: con `false` la fecha es provisional — no se muestra en landing/Stripe/email/factura y no hay recordatorios) (+ RPC solo lectura `plazas_intensivo_disponibles()` en `20261006000001_…`: plazas libres de la edición activa, incluye 'agotada' → 0, NULL sin edición) |
| Curso pregrabado (retirado 2026-10) | `inscripciones_curso` | `20260805_curso.sql` |
| Solicitudes /partners (2026-10) | `partners_solicitudes` | `20261004000001_partners_solicitudes.sql` + `20261005000001_partners_solicitudes_v2.sql` (preguntas v2: `situacion_actual`, `experiencia`, `dedicacion`, `inicio`, `perfil_one_to_one`; columnas `p1_…`–`p4_…` de v1 conservadas) |
| Carpintería tipos | `carpinteria_*` | `20260522_carpinteria_init.sql` |
| Roles | `user_roles`, `is_admin()` | `supabase-user-roles.sql` |

### Edge Functions

Todas las funciones viven en `supabase/functions/<nombre>/` con `deno.json` + `index.ts` (y `.npmrc` local gitignorado). Registrar en `supabase/config.toml` con `enabled = true` y `verify_jwt = true|false`. Deployment con `supabase functions deploy <nombre>`.

| Función | JWT | Trigger | Notas |
|---|---|---|---|
| `stripe-webhook` | no | Stripe webhook | **Único punto de entrada para todos los `checkout.session.completed`**. Routing por `session.metadata.purpose`. Ver sección Stripe. |
| `create-checkout-session` | sí | Cliente autenticado (marketplace) | Crea sesión con Connect + application fee. |
| `magazine-checkout` | sí | Usuario logueado | Compra paquetes de créditos de revista. |
| `magazine-boost-checkout` | sí | Usuario logueado | Boost/promoción de artículo. |
| `clases-checkout` | no | Invitado (landing pública) | Crea Stripe session para plaza en el Intensivo Curino Partners (990 €, aforo por fila, `card` + `link` con reintento solo `card`, dirección de facturación obligatoria, NIF opcional → factura completa, **email y teléfono obligatorios y editables en Checkout**, **casilla obligatoria de condiciones** (`consent_collection.terms_of_service`) con renuncia expresa al desistimiento (art. 103 m TRLGDCU) → `inscripciones.terminos_aceptados(_at)`; **sin devoluciones** (2026-10): la lógica de `charge.refunded` y rectificativas se mantiene solo para contracargos o devoluciones excepcionales (sin `customer_email`/`customer`, que bloquean el email; el webhook usa `customer_details.email/.phone` y guarda los del formulario en `email_formulario`/`telefono_formulario`); sin renuncia al desistimiento). La fila de `clases` es la promoción; `fecha` = primera sesión; `meet_url` guarda el enlace de **Zoom**. |
| `partners-solicitud` | no | Vercel → Supabase | Formulario multipaso de `/partners/` (acciones `start`/`step`/`cta`, id + `edit_token`). Una sola casilla obligatoria: privacidad + contacto sobre la solicitud + información y ofertas de formaciones → `consentimiento_privacidad` + `consentimiento_solicitud` + `consentimiento_comercial` (con `_at` y `_origen='formulario'`). En el CRM, una sola columna «Consentimiento» (sí/no/«solo solicitud») editable por admin (RPC `crm_partners_consentimiento`, `p_campo='ambos'`). Acepta respuestas v1 y v2 (por nombre de campo); v2: cualificado = `inicio <> 'informandome'`. Aviso Resend a `PARTNERS_NOTIFY_EMAIL` (defecto `juan@casacurino.com`, marca ⭐ one-to-one) + Lead por CAPI. |
| `partners-formaciones` | no | Vercel → Supabase | `/partners/formaciones` y enlaces de emails: `info` (precios/plazas; con token HMAC `PARTNERS_LEAD_SECRET` reconoce al lead y su oferta), `checkout` (Sesión 1:1 o Intensivo; **precio de la sesión siempre en servidor**: 60 € si `oferta_sesion_enviada_at` < 3 h, si no 150 €), `baja`. |
| `partners-seguimiento` | no | pg_cron cada 5 min (`X-Cron-Secret`) | **Motor de secuencias** (2026-10): lee `partners_secuencias` / `partners_secuencia_pasos` (editables en `/admin/partners/secuencias.html`, sin tocar código). Disparador «solicitud completa sin compra» (+ `consentimiento_solicitud`, sin baja, sin supresión); plazos desde `secuencia_inicio_at` o `completada_at`; franja de envío por secuencia (def. 9:00–21:30 Madrid; fuera espera a la siguiente); un email por solicitud y secuencia por ejecución (si vencen varios, el más reciente y los anteriores «saltado: retraso»); condiciones por paso (`req_comercial`, `req_sesion_activa` = `PARTNERS_SEGUIMIENTO_SESION_ACTIVO`, `req_plazas`, `no_si_sesion_comprada`, `activa_oferta_sesion`); variable vacía → paso saltado. Estado en `partners_secuencia_estado` (único por solicitud y paso, reservado antes de enviar). La secuencia antigua se migró como «Seguimiento solicitud intensivo» (ids fijos `5e9a0001-…`). `PARTNERS_SEGUIMIENTO_ACTIVO` ya no se usa: se activa/pausa en el panel. Aviso a Juan +30 min aparte. Modo prueba `{modo:'prueba', solicitud_id, secuencia_id?, segundos_por_hora}` solo para «PRUEBA». |
| `crm-email` | sí (admin) | `/admin/partners/emails.html` | Emails del CRM de Partners: acciones `destinatarios` / `preview` / `prueba` (a joandemora@gmail.com, «[PRUEBA]») / `enviar` (exige `confirmacion` = nº de destinatarios; máx. 1000; lotes de 100 a `/emails/batch`). Desde «Juan de Mora <info@casacurino.com>», reply_to info@. Tipos: **servicio** (solo alumnos con pago activo; se envía aunque haya baja comercial, salvo baja por rebote/queja) y **comercial** (solicitud con `consentimiento_comercial` y sin baja; lleva enlace de baja + `List-Unsubscribe` one-click). Variables `{nombre} {email} {curso} {fecha_inicio} {hora} {zoom} {enlace_reserva} {plazas_restantes}`; cuerpo en texto con `**negrita**` y `[texto](url)`; `{zoom}`/`{enlace_reserva}` solos en una línea → botón verde #12B76A con el enlace en texto debajo; **una variable vacía para algún destinatario bloquea `enviar`** (fecha no confirmada = `{fecha_inicio}`/`{hora}` vacías), la vista previa y la prueba la marcan como «[{x} vacío]»; firma «Juan de Mora · Curino» automática. Cada email queda en `partners_emails`. |
| `resend-webhook` | no (firma Svix `RESEND_WEBHOOK_SECRET`, configurado 2026-10) | Resend webhook (eventos delivered, delivery_delayed, opened, clicked, bounced, complained; seguimiento de aperturas/clics activo en casacurino.com vía links.casacurino.com) | Ignora con 200 los eventos de otros remitentes (la cuenta de Resend también envía de tikout.io). Actualiza `partners_emails.estado` (entregado/retrasado/abierto/rebotado/queja) y `clicado_at` por `resend_id`; rebote permanente o queja → `partners_solicitudes.baja_at` + `motivo_baja` `rebote`/`queja`. |
| `curso-checkout`, `curso-acceso` | no | — / Vercel → Supabase | Curso pregrabado de 90 € **retirado de la venta** (2026-10). `curso-checkout` sin punto de entrada; `curso-acceso` sigue sirviendo `/partners/acceso/`. |
| `presupuesto-form-relay` | no | Vercel → Supabase | Envía email Resend tras insertar solicitud de presupuesto. |
| `lista-espera-relay` | no | Vercel → Supabase | Captura email + honeypot + rate limit para lista de espera de clases. |
| `notify-class-reminder` | no | pg_cron cada 10 min | Envía recordatorios T-24h y T-1h de clases. Auth por header `X-Cron-Secret`. |
| `magazine-notify-published` | sí (admin) | Publicación de artículo | Email al autor. |
| `magazine-notify-boost-active` | no | Fire-and-forget desde cliente | Email al autor cuando activa un boost queue. |
| `magazine-relay-contact` | no | Vercel → Supabase | Contacto público sobre un artículo. |
| `notify-takedown` | sí (admin) | Resolución de report | Email al seller de pieza retirada. |
| `backfill-invoice` | sí (secret propio) | Manual (regenerar factura) | Header `X-Backfill-Secret`. |
| `create-seller-onboarding-link` | sí | Seller nuevo | Link Stripe Connect Express. |
| `publish-library-item` | sí | Seller | Publica pieza en marketplace. |
| `get-library-dxf-url` | sí | Comprador | Signed URL de DXF tras compra verificada. |

### Módulos compartidos (`_shared/`)

- `_shared/money.ts` — `fmtEur(cents)`, formato español (2.345,67 €).
- `_shared/invoices.ts` — marketplace (buyer + auto-factura seller).
- `_shared/magazine-invoices.ts` — paquetes y boosts de revista.
- `_shared/armario-invoices.ts` — pedido de armario configurado.
- `_shared/clase-invoices.ts` — plaza en clase directo / Intensivo Partners (factura + emails con Zoom; enlace al grupo de WhatsApp vía secret `PARTNERS_WHATSAPP_GROUP_URL`).
- `_shared/crm-envio.ts` — destinatarios (`resolver`, reglas servicio/comercial), `construir`, `enviarLotes` (Resend batch + `partners_emails`), `vaciasDetalle`, `madridAUtc`. Lo usan `crm-email` y el cron de programados.
- `_shared/crm-render.ts` — render y variables de los emails del CRM (Emails, secuencias, programados): `renderCuerpo` (negrita, enlaces, botón `[[Texto]](url)` en línea propia), `layout` (servicio/comercial/secuencia), `construirVars` (incluye `enlace_plaza`, `enlace_formaciones`, `enlace_whatsapp`, plazas y precios de la sesión).
- `_shared/meta-capi.ts` — envío a Meta Conversions API (no-op sin `META_CAPI_TOKEN`) + `adConsentAllowed()` que replica el Consent Mode v2 de la web.
- `_shared/issuer.ts` — constante `ISSUER` central (2026-08). **Deuda técnica**: los 4 módulos de facturas anteriores tienen `ISSUER` duplicado inline; no se han refactorizado por riesgo.
- `_shared/cors.ts` — cabeceras CORS shared (varias funciones las redeclaran inline igualmente).

## API routes Vercel

- Runtime **edge** por defecto para lo nuevo; `stripe-session.js` y `checkout.js` siguen en Node CommonJS por legado.
- Patrón vigente: los form/checkout de páginas públicas van vía Vercel edge → Edge Function Supabase (proxy). Ejemplos: `api/solicitar-presupuesto.js` → `presupuesto-form-relay`; `api/clases-checkout.js` → `clases-checkout`.
- `api/webhooks/stripe.js` es **fósil** — Stripe apunta hoy al Edge Function `stripe-webhook`. No borrar por si acaso, pero no editar.
- Vercel Hobby: cap ~12 slots de API routes. `9f89359` y `b66c28f` documentan optimizaciones (edge runtime, chromium-min) para no rebasar el cap.

## Stripe

### Dos caminos para crear la sesión, uno para el webhook

**Crear sesión**:
- **Vercel Node API route** (`api/checkout.js`) — se usa cuando el cliente no está logueado obligatoriamente, el body es grande (multi-armario) o hay que persistir un draft antes del redirect. Se guarda `client_reference_id` (draft id) si la metadata Stripe no cabe (>500 chars por valor).
- **Supabase Edge Function** (`magazine-checkout`, `create-checkout-session`, `clases-checkout`) — cuando el producto es simple, la metadata cabe holgada, y opcionalmente hay auth Supabase.

**Recibir el webhook**: siempre `supabase/functions/stripe-webhook/index.ts`. Un único handler valida la firma probando 3 secretos (`STRIPE_WEBHOOK_SECRET_PLATFORM`, `STRIPE_WEBHOOK_SECRET_CONNECT`, `STRIPE_WEBHOOK_SECRET` legacy). El switch de `checkout.session.completed` enruta por `session.metadata.purpose`:

- `magazine_package` → `handleMagazinePackageCompleted`
- `magazine_boost` → `handleMagazineBoostCompleted`
- `armario` → `handleArmarioCompleted`
- `clase` → `handleClaseCompleted` (con **refund automático** si la plaza se agota entre checkout y webhook)
- `sesion` → `handleSesionCompleted` (Sesión 1:1: tabla `sesiones_1a1`, factura `SESION`, email con recursos de `partners-recursos/sesion/` + `SESION_RESERVA_URL`)
- `charge.refunded` (fuera del switch de purpose) → `handleChargeRefunded`: reembolso **total** de una inscripción del Intensivo → RPC `liberar_plaza_clase` (idempotente: pagada→reembolsada, −1 plaza, reabre si estaba agotada y no ha empezado) + email; **parcial** → solo `importe_reembolsado_cents`. A 2026-10 el evento **no está suscrito** todavía en el endpoint de Stripe.
- resto → `handleCheckoutCompleted` (marketplace legacy sin `purpose`)

### Idempotencia

No se usa `event.id`. Cada tabla de pedido tiene `stripe_session_id text unique not null` + `SELECT ... maybeSingle()` antes del INSERT en el handler. Doble red: si dos webhooks concurrentes pasan el SELECT, el UNIQUE hace fallar el segundo INSERT. Los handlers están escritos para dejar el pedido persistido aunque falle el email/factura posterior (try/catch aislado).

### Facturación

Serie única `invoice_counters (invoice_type, year, last_number)` con RPC `assign_invoice_number(p_type text, p_year int)`. Tipos actuales:

| type | prefijo | uso |
|---|---|---|
| `simplified` | `CURINO` | comprador marketplace |
| `auto_invoice` | `AUTO` | auto-factura al seller externo |
| `magazine` | `REVISTA` | paquetes y boosts de revista |
| `armario` | `AR` | configurador armarios |
| `clase` | `CLASE` | plaza en clase directo (2026-08) |
| `clase_rect` | `R-CLASE` | factura rectificativa de un reembolso del Intensivo (2026-10), tabla `facturas_rectificativas_clase` (una por `stripe_refund_id`) |
| `sesion` | `SESION` | Sesión 1:1 con Juan · 30 min (2026-10) |
| `sesion_rect` | `R-SESION` | rectificativa de la sesión (misma tabla `facturas_rectificativas_clase`, `serie='sesion'`) |

Formato final `<PREFIX>-YYYY-NNNNNN` (6 dígitos). Extender esta RPC = `create or replace function assign_invoice_number` re-declarando el `case` completo con el tipo nuevo (patrón `20260526_armario_orders.sql:112-146`).

Bucket **`invoices`** privado (Fase E marketplace). Convención de rutas:
- Marketplace: `invoices/<order_id>/buyer.pdf`, `invoices/<order_id>/seller.pdf`
- Magazine paquete: `invoices/magazine/<purchase_id>.pdf`
- Magazine boost: `invoices/magazine-boost/<boost_id>.pdf`
- Armario: `invoices/armario/<order_id>.pdf`
- Clase: `invoices/clases/<inscripcion_id>.pdf`
- Rectificativa de clase: `invoices/clases/<inscripcion_id>-rect-<refund_id>.pdf`

Policies: buyer lee su propia factura, admin lee todo, `service_role` bypasea RLS para subir. PDFs generados con **pdf-lib** (nunca Puppeteer para facturas — Helvetica StandardFonts con `sanitizePdfText` para caracteres fuera de WinAnsi).

## Cron

Sólo un mecanismo activo: **`pg_cron`** dentro del proyecto Supabase. Los jobs se registran con `select cron.schedule('<jobname>', '<cron_expr>', $$<sql>$$)` dentro de un `do $$ ... end $$` idempotente (`cron.unschedule` si existe, `cron.schedule` de nuevo).

Jobs activos (a fecha 2026-08):

| jobname | schedule | acción |
|---|---|---|
| `magazine-boost-queue-hourly` | `0 * * * *` | `select activate_boost_queue()` — activa boosts encolados |
| `class-reminders-frequent` | `*/10 * * * *` | `net.http_post` a `notify-class-reminder` con `X-Cron-Secret` |

Requiere GUC `app.settings.functions_url` y `app.settings.cron_secret` definidos con `alter database postgres set ...`.

Alternativa nunca usada: `vercel.json` `crons` (Vercel Cron Jobs). Prefiere `pg_cron` por continuidad.

## Emails (Resend)

Sin cliente unificado — cada función hace `fetch('https://api.resend.com/emails', {...})` con `RESEND_API_KEY` de `Deno.env`. Patrón invariable:

- `from: 'Curino <noreply@casacurino.com>'`
- `reply_to: 'info@casacurino.com'`
- HTML inline por función (sin sistema de templates; layout copipegado con Arial 600px max-width)
- `attachments` para adjuntar PDF (base64 chunked)
- Footer legal: `SISTEMA & CURINO SLU — Este email es automático` (los de Partners —secuencia, CRM, servicio, confirmaciones del Intensivo y la Sesión— llevan «SISTEMA & CURINO SLU · Aviso legal» con enlace a `/aviso-legal/`, sin dirección postal; los comerciales mantienen el enlace de baja)

Funciones que envían email hoy: ver tabla de Edge Functions arriba.

## Tracking, consent y GTM

- **GTM único**: `GTM-NZR7NNTC`. El tag GA4 vive dentro del contenedor GTM — **no** se carga `gtag.js` directo en el HTML.
- **Meta Pixel** (`31730930696551488`): **no hay `fbq` en el repo**; vive en GTM como tags del template `__cvt_5RM3Q` con consent `ad_storage`: PageView, ViewContent (`view_content`), AddToCart (`add_to_cart`), InitiateCheckout (`begin_checkout`), Purchase (`purchase`), Lead (`generate_lead`). A 2026-10 **los tags no mandan `event_id`** y no existe tag Contact (`contact`): configurar en GTM para que funcione la deduplicación con CAPI.
- **Stripe**: Edge Functions usan `sk_live` de la cuenta `acct_1TLVUbRxTOs46nbR` (verificado 2026-10). La cuenta TIKOUT (`acct_1U9pdv2NY3CaAFGx`) es otra.
- **CAPI**: server-side desde Edge Functions con `_shared/meta-capi.ts` — Lead en `partners-solicitud` y Purchase en `handleClaseCompleted`, con el mismo `event_id` que el `dataLayer`. Solo con consentimiento publicitario (el cliente manda `ad_consent` leído de `curino_consent_v2`; sin decisión se aplica el default por país `x-vercel-ip-country`). Secrets: `META_CAPI_TOKEN` (sin él no envía nada), opcionales `META_PIXEL_ID`, `META_TEST_EVENT_CODE`, `META_GRAPH_VERSION`.
- **Consent Mode v2**: bloque inline canónico en 49 páginas públicas (más `/partners/`, `/partners/gracias/` y `/partners/acceso/`). Defaults granted globales + denied en EEE+UK+CH+IS+LI+NO. Banner `cookie-banner.js` (propio, autocontenido) promueve via `gtag('consent','update')`. Bloqueantes B1/B2 documentados en `CONSENT_AUDIT.md` siguen abiertos.
- **UTMs**: la landing `/partners/` captura `utm_source/medium/campaign/content/term` + `fbclid` en `sessionStorage.curino_partners_attr` al aterrizar y los guarda en `partners_solicitudes` (y los 3 primeros como metadata Stripe hasta `inscripciones`).
- **Eventos ecommerce actuales**: `add_to_cart`, `begin_checkout`, `purchase` (armarios y marketplace, sin `event_id`), `generate_lead`. En `/partners/`: `generate_lead` (paso 0, `form_name: 'partners_solicitud'`), `begin_checkout` (ACCEDER AHORA), `contact` (WhatsApp) y en `/partners/gracias/` `purchase`, todos con `event_id` e `item_id: 'intensivo-partners'`.

## RLS — patrones vigentes

- **SELECT público con filtro por columna**: crear una vista `..._public` con solo las columnas seguras + `grant select ... to anon, authenticated`, y dejar la tabla base sin policies para anon. Ejemplo: `magazine_articles_public`, `clases_public` (nunca expone `meet_url`).
- **Sin acceso público (webhook only)**: `alter table ... enable row level security` sin crear ninguna policy. `service_role` bypasea RLS por diseño, así el único código que escribe es el webhook. Ejemplo: `presupuesto_solicitudes`, `inscripciones`.
- **Buyer lee su propio pedido**: policy con `auth.uid() = user_id` (o `auth.jwt() ->> 'email' = lower(buyer_email)` para invitados). Admin lee todo con `is_admin()` (RPC de `supabase-user-roles.sql`).

## Notas load-bearing

- **`stripe-webhook/index.ts` es el único handler de todos los pagos**. Cualquier PR que añada un nuevo tipo de venta debe: (1) añadir su rama al switch, (2) implementar `handleXCompleted` con idempotencia por SELECT + UNIQUE, (3) usar `assign_invoice_number` con tipo nuevo, (4) subir factura al bucket `invoices/<prefijo>/`.
- **`supabase/config.toml`** debe listar cada Edge Function con `enabled = true` y `verify_jwt` correcto para que el CLI la reconozca en `supabase functions deploy`.
- **`CONSENT_AUDIT.md`** (junio 2026) es la referencia obligatoria antes de tocar cualquier snippet de consent/GTM/tracking. Fix B1/B2 pendientes bloquean atribución real de GA4/Ads en EEE.
- **`.env.example`** documenta las envs de Vercel; los secretos de Edge Functions (`RESEND_API_KEY`, `CRON_SECRET`, `STRIPE_WEBHOOK_SECRET_*`) viven en el dashboard de Supabase, NO en Vercel.
- **Sin build step**: cualquier cambio HTML/JS/CSS es deploy directo. Los assets embebidos base64 del configurador viejo (`configurador-armarios-vestidores/index.html`) son heredados — no meter más base64 embebido en páginas nuevas.

## Áreas del sitio (mapa)

- **`/`** — landing marca (sin meta description ni OG, excepción histórica)
- **`/sobre-nosotros/`, `/marca/`, `/estudio/`, `/maestro/`** — páginas editoriales (usan `body.sx-page` + `site-shell.css`)
- **`/{cocinas,armarios-vestidores,banos,dormitorio,salon,comedor,puertas,escaleras,encimeras,paneles,materiales,contract,couture,nautica,residencial}/`** — 15 páginas de sección con `sys-card` grids
- **`/configurador-armarios-vestidores/`** — configurador 3D single-page (~16MB con base64)
- **`/configurador-2d/`** — configurador marketplace 2D
- **`/checkout/`** — página de compra multi-armario
- **`/partners/condiciones/`** — condiciones de contratación del Intensivo (versión definitiva, «Última actualización: octubre de 2026», indexable). Es la URL de términos del Checkout.
- **`/partners/`** — landing de **solicitud** Curino Partners (2026-10, v2): formulario multipaso (contacto + 4 preguntas: situación, experiencia, dedicación, inicio) → pantalla final con checkout del Intensivo o WhatsApp (+ WhatsApp one-to-one si quiere dedicarse a tiempo completo). Sin fechas de inicio ni menciones a grabaciones. Precio **solo en la pantalla final** del formulario (tarjeta de compra): sale de `precio_cents` de la edición abierta (o `CONFIG.PRECIO_RESERVA_CENTS`), con «~~1.650 €~~» tachado, precio grande con «IVA incluido» y etiqueta «-X %» (`CONFIG.PRECIO_SIGUIENTES_CENTS`; en `/partners/formaciones` `CONFIG.PRECIO_REFERENCIA_CENTS`, mismo bloque; el one-to-one muestra «3.990 € IVA incluido» y se contrata por WhatsApp). Etiqueta de urgencia del paso 4 con plazas reales (`plazas_restantes`; ≤5 → «Solo quedan X plazas», 0 → agotadas, >5 → «Plazas limitadas: máximo {plazas_totales} alumnos», sin edición/error → «Solo 3 plazas en octubre»). **Aforo por fila** (`clases.plazas_totales`): edición de octubre 2026 = 3, por defecto 20; ningún 20 fijo en el código. **Intensivo (2026-10): «Octubre · 4 clases en directo por Zoom», una por semana** (sin «Primera edición»); textos de plazas «Quedan X plazas» / «Queda 1 plaza» (variable de email `{quedan_plazas}`). Huecos configurables en `CONFIG`: `VSL_URL`, `RESENAS`; fotos en `assets/imagenes/partners/`, vídeos MP4 (H.264+AAC, faststart) en `assets/video/partners/` — el del hero (`video-curino-hero.mp4`) solo se crea al pulsar play (evento `video_play`), el viral (`viral-cris-armario.mp4`) con `preload="none"` + IntersectionObserver. Si los vídeos de la página superan 20 MB, moverlos a Supabase Storage (bucket público `partners-media`). Ruta anterior `/clases/*` redirige con 301 permanente; `/partners/clase` → `/partners/`.
- **`/revista/{seccion}/{slug}/`** — SSR revista editorial (rewrites en `vercel.json`)
- **`/admin/`** — panel interno: presupuestos (CRUD + PDF Puppeteer), moderación revista, generador IA
- **`/admin/partners/`** — CRM de Partners (2026-10): `contactos.html` (solicitudes con estado/notas editables y filtros), `contacto.html?id=` (ficha + historial + compras), `ventas.html` (vista `crm_partners_ventas`, totales por producto y mes), `formaciones.html` (ediciones: fecha, `fecha_confirmada`, Zoom), `alumnos.html?edicion=<id>` / `?producto=sesion` (alumnos con pago activo, marcas manuales vía RPC `crm_partners_marcar_alumno`, CSV `;` + BOM). `secuencias.html` (secuencias y pasos editables, vista previa/prueba por paso vía `crm-email` `paso_preview`/`paso_prueba`, métricas de la vista `crm_partners_secuencia_metricas`: bajas y compras atribuidas al último email de secuencia; un paso enviado no se puede borrar, solo desactivar), `emails.html` (editor + plantillas + **envíos programados** `partners_envios_programados`: «Programar» con fecha/hora de Madrid, lista con editar/cancelar mientras estén pendientes; los ejecuta el cron de `partners-seguimiento` recalculando destinatarios y, si hay variables vacías, no envía (`bloqueado`) y avisa por email a quien lo programó; `partners_email_plantillas` + segmentos `?ids=`, `?edicion=`, `?sesion=1`; ver `crm-email`); la ficha muestra el historial de `partners_emails`. Bajas: `baja_at` + `motivo_baja` (`enlace`/`rebote`/`queja`). Lectura con RLS `is_admin()`; escrituras solo por RPCs `crm_partners_actualizar_contacto` / `_edicion` / `_consentimiento`. **Borrar contactos** (decisión 2026-10, cambia la regla anterior): RPC `crm_partners_borrar_contactos(uuid[])` desde la ficha y «Borrar seleccionados», con confirmación escribiendo «BORRAR»; prohibido si tiene compras (inscripción pagada/reembolsada o sesión 1:1 — facturas por ley); borra la solicitud y su historial de `partners_emails`, guarda el hash SHA-256 del email en `partners_supresion` (la secuencia ignora solicitudes de ese email creadas antes del borrado; un formulario nuevo entra como nuevo) y registra el borrado en `partners_borrados`. **Las ventas no se pueden borrar.** `crm_estado` pasa a «compro» al pagar y a «descartado» con nota «Reembolsado» en reembolso total.
- **`/mi-cuenta/`, `/cuenta/`, `/login/`, `/registro/`, `/recuperar-contrasena/`, `/auth/`** — auth Supabase
- **`/aviso-legal/`, `/privacidad/`, `/cookies/`, `/terminos-marketplace/`** — páginas legales. **NO hay condiciones de contratación para venta directa B2C de servicios** (solo cubren el aviso LSSI y el marketplace).
- **`/solicitar-presupuesto/`, `/proyecto-a-medida/`** — formularios lead
- **`/registro-marca/`, `/couture/`** — landing marcas

## Fechas y contexto

- Tag `antes-reorganizacion` (2026-04-10) — snapshot pre-reorganización del configurador.
- Fase A-F del marketplace: mayo 2026.
- Fase G (revista, G1-G4): mayo 2026.
- Fase H (armarios, H2-H10): mayo-junio 2026.
- Consent Mode v2 avanzado + banner blindado (#165): junio 2026.
- Landing `/clases` (2026-08). Pivotada a curso pregrabado (agosto 2026). Movida a `/partners` (agosto 2026); `/clases/*` → `/partners/*` con 301 permanente.
- `/partners` pasa a landing de solicitud del Intensivo Curino Partners (octubre 2026, rama `feat/partners-solicitud`): curso de 90 € retirado de la venta, `clases-checkout` reutilizado para el Intensivo (Zoom), tabla `partners_solicitudes`, CAPI Lead/Purchase.
