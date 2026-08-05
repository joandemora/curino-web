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

Excepción: `/partners/` es autocontenida (HTML+CSS+JS inline sin dependencias del sistema shared) — decisión de portabilidad. Sí usa `cookie-banner.js` como única excepción. **La ruta pública anterior `/clases/*` redirige con 301 permanente a `/partners/*`** (ver `vercel.json`).

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
│   ├── clases-proxima.js                   ← consulta clases_public (anon key)
│   ├── lista-espera.js                     ← proxy a Edge Function lista-espera-relay
│   ├── solicitar-presupuesto.js            ← form leads con adjuntos
│   ├── config.js                           ← devuelve claves públicas (Supabase anon, Google Maps)
│   └── sitemap.js                          ← genera sitemap.xml (rewrite en vercel.json)
├── checkout/                               ← página de compra multi-armario
├── configurador-armarios-vestidores/       ← configurador 3D + confirmación
├── configurador-2d/                        ← configurador marketplace 2D
├── clases/                                 ← landing venta plaza clase directo (2026-08)
├── revista/                                ← revista editorial
├── mi-cuenta/, cuenta/, login/, registro/  ← área de usuario Supabase
├── maestro/, auth/                         ← onboarding + callback
├── {cocinas,armarios-vestidores,banos,dormitorio,...}/  ← 20 páginas de sección
├── {aviso-legal,privacidad,cookies,terminos-marketplace}/  ← páginas legales
├── assets/                                 ← imágenes (webp/png/jpg), CSS shared, JS shared
├── supabase/
│   ├── config.toml                         ← registro de Edge Functions (enabled + verify_jwt)
│   ├── functions/                          ← Edge Functions Deno
│   └── migrations/YYYYMMDD_*.sql           ← migraciones vigentes (formato timestamp)
├── supabase-*.sql                          ← SQL legacy (ejecutar en SQL Editor manualmente)
├── CONSENT_AUDIT.md                        ← auditoría cobertura consent Mode v2 (junio 2026)
└── vercel.json                             ← rewrites + redirects (no crons, no builds)
```

## Backend Supabase

### Migraciones

Dos convenciones coexisten:

- `/supabase/migrations/YYYYMMDD_<snake>.sql` — **formato vigente** consumido por `supabase db push`. Todo lo nuevo (>= mayo 2026) va aquí.
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
| Clases (2026-08) | `clases`, `inscripciones`, `lista_espera` | `20260802_clases.sql` |
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
| `clases-checkout` | no | Invitado (landing pública) | Crea Stripe session para plaza en clase directo. |
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
- `_shared/clase-invoices.ts` — plaza en clase directo (2026-08).
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

Formato final `<PREFIX>-YYYY-NNNNNN` (6 dígitos). Extender esta RPC = `create or replace function assign_invoice_number` re-declarando el `case` completo con el tipo nuevo (patrón `20260526_armario_orders.sql:112-146`).

Bucket **`invoices`** privado (Fase E marketplace). Convención de rutas:
- Marketplace: `invoices/<order_id>/buyer.pdf`, `invoices/<order_id>/seller.pdf`
- Magazine paquete: `invoices/magazine/<purchase_id>.pdf`
- Magazine boost: `invoices/magazine-boost/<boost_id>.pdf`
- Armario: `invoices/armario/<order_id>.pdf`
- Clase: `invoices/clases/<inscripcion_id>.pdf`

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
- Footer legal: `SISTEMA & CURINO SLU — Este email es automático`

Funciones que envían email hoy: ver tabla de Edge Functions arriba.

## Tracking, consent y GTM

- **GTM único**: `GTM-NZR7NNTC`. El tag GA4 vive dentro del contenedor GTM — **no** se carga `gtag.js` directo en el HTML.
- **Meta Pixel y CAPI**: **no existen en el repo**. Documentado en `CONSENT_AUDIT.md §2.4` y en el commit `5c259cc`. Cualquier evento Pixel se dispara desde tags en la GTM Console (ver comentarios `Lead (Pixel via GTM)` en el código). Cuando se conecte Pixel/CAPI, la landing `/partners/` ya pushea `event_id` UUID a `dataLayer` para dedup.
- **Consent Mode v2**: bloque inline canónico en 49 páginas públicas (más `/partners/`, `/partners/gracias/` y `/partners/acceso/`). Defaults granted globales + denied en EEE+UK+CH+IS+LI+NO. Banner `cookie-banner.js` (propio, autocontenido) promueve via `gtag('consent','update')`. Bloqueantes B1/B2 documentados en `CONSENT_AUDIT.md` siguen abiertos.
- **UTMs**: hasta 2026-08 no se capturaban en ninguna página. La landing `/partners/` es la primera; guarda `{utm_source, utm_medium, utm_campaign}` en `sessionStorage.curino_curso_utms` al aterrizar y los propaga como metadata Stripe hasta la fila `inscripciones_curso`.
- **Eventos ecommerce actuales**: `add_to_cart`, `begin_checkout`, `purchase` (armarios y marketplace, sin `event_id`), `generate_lead`. En `/partners/`: `begin_checkout` y `purchase` con `event_id` e `item_id: 'curso-carpinteria'`.

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
- **`/partners/`** — landing programa Partners: curso pregrabado 24/7 (90 €), primera puerta de entrada. Autocontenida. Ruta anterior `/clases/*` redirige con 301 permanente.
- **`/revista/{seccion}/{slug}/`** — SSR revista editorial (rewrites en `vercel.json`)
- **`/admin/`** — panel interno: presupuestos (CRUD + PDF Puppeteer), moderación revista, generador IA
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
