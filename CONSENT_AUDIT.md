# CONSENT_AUDIT.md

Auditoría del stack de consentimiento + tracking de `curino-web` previa a
campañas de Meta/Google Ads.

Fecha: 2026-06-05. Branch: `main` (commit actual). Sin cambios — solo informe.

---

## 1. Resumen ejecutivo

Los tres síntomas reportados — **GTM 0 % consent rate / 100 % rechazadas**,
**GA4 a cero**, **banner invisible en webview de Instagram** — tienen una
**única causa raíz funcional** con varios contribuyentes:

> El proyecto está corriendo **Consent Mode v2 en modo "básico global"**
> (defaults `denied` para todo el mundo, sin `region`, sin
> `ads_data_redaction`, sin `url_passthrough`) y depende totalmente del
> **banner cliente** para promover el consent a `granted`. Cuando el banner no
> se ve, no se interactúa o no llega a tiempo, el sistema queda en `denied`
> permanente. El estado `denied` con setup básico implica **cero pings,
> cero datos modelados, cero tráfico en GA4 y rechazo de tags en GTM**.

Adicionalmente:

- **No existe Meta Pixel cliente (`fbq`) ni Edge Function de CAPI Meta en el
  repo.** La afirmación "Tenemos Meta Pixel + CAPI" implica que están
  configurados **fuera del código** (probablemente vía un tag en GTM y/o un
  Server-Side Container externo). Cualquiera de esas vías hereda el mismo
  problema: si GTM no obtiene `ad_storage = granted`, el Pixel tag no
  dispara, y el `event_id` que tendría que mandar a CAPI para dedup ni se
  genera. Por eso "CAPI no mide tráfico de Instagram": no porque CAPI esté
  roto, sino porque su entrada — el Pixel cliente — nunca llega a disparar.

- En el **webview de Instagram** no se observa nada específico que rompa el
  banner. La hipótesis más plausible es que el script `cookie-banner.js` se
  cargue con `defer` en una posición tardía del `<body>` y que GTM haya
  vencido ya el `wait_for_update:500` antes de que el banner pueda mostrarse
  y el usuario interactuar. El resultado neto es: aunque el banner aparezca,
  los tags ya dispararon en `denied`.

Los fixes son **infraestructurales** (a nivel de snippet inline y banner), no
de Meta Pixel/CAPI; estos últimos deben configurarse aparte una vez la
señal de consent fluya correctamente.

---

## 2. Hallazgos por archivo

### 2.1 Consent Mode mal configurado (causa #1)

**Archivo**: `index.html:622-627` (idéntico en las 49 páginas públicas).

```js
gtag('consent','default',{
  ad_storage:'denied',
  analytics_storage:'denied',
  ad_user_data:'denied',
  ad_personalization:'denied',
  functionality_storage:'granted',
  security_storage:'granted',
  wait_for_update:500
});
try {
  if (localStorage.getItem('curino_consent')==='granted') {
    gtag('consent','update',{
      ad_storage:'granted',
      analytics_storage:'granted',
      ad_user_data:'granted',
      ad_personalization:'granted'
    });
  }
} catch(_) {}
```

Problemas observables:

| # | Problema | Consecuencia |
|---|---|---|
| **A** | **Falta `region: [...]`** | Defaults `denied` se aplican a TODOS los países, incluido fuera del EEE donde no es legalmente necesario. Mata el consent rate global. |
| **B** | **Falta `ads_data_redaction: true`** | Cuando `ad_storage=denied`, no se envían pings de modelado a Google Ads (cookieless pings). Sin ellos no hay datos modelados — explica el 100 % rechazadas en GTM. |
| **C** | **Falta `url_passthrough: true`** | No se preserva `gclid` / `dclid` / `gad_source` en la navegación cuando el usuario rechaza cookies. Atribución rota incluso si después acepta. |
| **D** | **`wait_for_update: 500` global y bajo** | 500 ms es agresivo. Si el banner tarda (carga de fuentes, scripts previos, webview lento), GTM ya disparó tags con `denied`. |
| **E** | **`functionality_storage:'granted'` por defecto sin consent** | Funcional puede ser correcto si solo cubre sesión/preferencias propias, pero conviene revisar que ningún tag de terceros use esta categoría. |

> **Veredicto Consent Mode**: BÁSICO (sin redacción avanzada). En este modo,
> `denied` ≡ no envía nada. GA4 a cero y GTM 100 % rechazadas son coherentes.

### 2.2 GTM cargado SIEMPRE, banner cargado al final (causa #2)

**Archivo**: `index.html` (mismo patrón en las 49 páginas).

- L622-627: consent default (síncrono en `<head>`).
- L628: GTM loader (síncrono en `<head>`). Empieza a cargar `gtm.js`.
- L630: `<body>` empieza.
- L635: `main-nav.js` (síncrono).
- L793: `main-footer.js` (síncrono).
- L847: `cookie-banner.js` con `defer`.

Implicación: `gtm.js` ya empezó a procesarse mucho antes de que
`cookie-banner.js` se ejecute. Si el usuario es nuevo, el `wait_for_update`
de 500 ms expira con los defaults `denied` antes de que el banner tenga
tiempo de:

1. parsear,
2. inicializarse,
3. detectar primera visita,
4. inyectar DOM,
5. esperar interacción del usuario,
6. llamar `gtag('consent','update',{...})`.

En desktop con conexión rápida, casi nunca pasa porque el usuario tarda > 500 ms
en hacer clic. **En webview Instagram con conexión móvil lenta puede pasar
incluso para usuarios que sí aceptan**: GTM ya disparó.

### 2.3 Banner solo persiste si el usuario interactúa (causa #3)

**Archivo**: `assets/js/cookie-banner.js:442-460`.

`init()`:
1. `migrateLegacyIfNeeded()` — si solo hay `curino_consent` (v1), traduce
   a `curino_consent_v2` y aplica consent (correcto).
2. Si existe `curino_consent_v2`, aplica consent runtime (correcto, esto
   cubre a usuarios granulares que no quedan `granted` desde el snippet
   inline).
3. Si no hay nada → `show('main')`.

El `show()` (L396-415) llama a `injectStyles()` + `buildBanner()` que
inserta el modal en el DOM, y luego añade la clase `.visible` después de un
reflow.

**No hay timeout, no hay fallback automático**. Si el script `cookie-banner.js`:
- No se descarga (red lenta, bloqueo, CSP),
- Falla durante `init()` por una excepción no capturada,
- O nunca llega a llamar `applyConsent({...})`,

…el consent queda en `denied` para siempre en esa pestaña. El siguiente
hit a la web tampoco resuelve, porque sin `curino_consent_v2` en
localStorage, el snippet inline no upgradea.

> En webview de Instagram el `localStorage` está disponible (WKWebView lo
> soporta) pero el script lleva try/catch defensivo — bueno; sin embargo el
> banner falla **silenciosamente** si el load del JS no llega.

### 2.4 No hay Meta Pixel cliente ni CAPI en el repo (causa #4 — para campañas Meta)

Búsqueda exhaustiva en el repo entero (excl. `node_modules`/`.git`/`.claude`):

```
fbq             : 0 archivos
fbevents        : 0 archivos
fb_pixel        : 0 archivos
facebook.com/tr : 0 archivos
_fbp / _fbc     : 0 archivos
connect.facebook.net : 0 archivos
pixelId / fbpixel    : 0 archivos
CAPI / conversions/api / graph.facebook.com : 0 archivos
fbclid          : 0 archivos
```

Edge Functions presentes en `supabase/functions/`:

```
backfill-invoice                  magazine-relay-contact
create-checkout-session           notify-takedown
create-seller-onboarding-link     presupuesto-form-relay
get-library-dxf-url               publish-library-item
magazine-boost-checkout           stripe-webhook
magazine-checkout                 _shared
magazine-notify-boost-active
magazine-notify-published
```

Ninguna trata Meta CAPI. Único rastro Facebook en código:
`index.html:6` → `<meta name="facebook-domain-verification" …>` que es solo
verificación de propiedad de dominio para Business Manager (no Pixel).

> **Implicación**: si el Pixel está disparando en producción, es porque está
> añadido **como tag en GTM**, no en el repo. Esto es habitual y válido —
> pero significa que el Pixel hereda el estado de consent de GTM
> (`ad_storage`), y por tanto **comparte la causa #1/#2/#3**: nunca dispara
> hasta que el usuario acepta. Si el CAPI servidor está esperando recibir el
> `event_id` que generaría el Pixel cliente para dedup, **nunca recibe nada
> desde Instagram** porque el Pixel nunca llega a disparar en ese contexto.

### 2.5 Robustez en webview Instagram — no se halló código problemático específico

| Aspecto | Estado |
|---|---|
| Acceso a `localStorage` en banner | `try/catch` defensivo en lecturas y escrituras ✓ |
| Acceso a `localStorage` en `main-nav.js` / `main-footer.js` | No usan localStorage directamente ✓ |
| Detección de userAgent / webview | 0 hits — no hay rama específica para IG ✓ neutro |
| Manejo de `igsh` / `fbclid` en URL | 0 hits — los params se reciben pero no se hace nada con ellos. Sin Meta Pixel cliente que los consuma, se pierden. |
| `document.referrer` / `URLSearchParams` | 30 archivos los usan en otros contextos (sin riesgo claro para el banner) |
| CSP que pudiera bloquear el banner | `vercel.json` no define `Content-Security-Policy` headers ✓ |

> **No se observa ningún código que cause un crash JS específico en
> webview de IG**. El "banner no aparece" reportado es plausiblemente:
> a) usuarios que ya tienen `curino_consent_v2='advertising:false'` desde
> una visita anterior (el banner correctamente no se muestra y aplica
> `denied`), o
> b) carga del JS bloqueada por CSP de la propia app de Instagram al hacer
> webview (raro pero posible), o
> c) timing — el modal aparece tras el load pero el usuario ya ha cerrado /
> navegado.

---

## 3. Cobertura GTM / banner / consent default por página

Auditoría sobre todas las páginas `index.html` del repo (n=68).

### 3.1 Páginas etiquetadas (públicas): 49 / 49 ✓

Todas las páginas accesibles desde navegación pública contienen los 3
elementos (GTM, cookie-banner.js, consent default):

`/`, `/aviso-legal/`, `/armarios-vestidores/`, `/banos/`, `/checkout/`,
`/checkout/login/`, `/cocinas/`, `/comedor/`, `/configurador-2d/`,
`/configurador-armarios-vestidores/`,
`/configurador-armarios-vestidores/confirmacion/`, `/contract/`, `/cookies/`,
`/couture/`, `/cuenta/vendedor/`, `/cuenta/vendedor/dibujos/`, `/dormitorio/`,
`/encimeras/`, `/escaleras/`, `/estudio/`, `/login/`, `/maestro/`, `/marca/`,
`/materiales/`, `/mi-cuenta/`, `/mi-cuenta/revista/`, `/mi-cuenta/revista/editar/`,
`/mi-cuenta/revista/nuevo/`, `/mi-cuenta/revista/perfil/`, `/nautica/`,
`/paneles/`, `/privacidad/`, `/proyecto-a-medida/`, `/proyecto-a-medida/pago/`,
`/puertas/`, `/recuperar-contrasena/`, `/registro/`, `/registro-marca/`,
`/residencial/`, `/revista/`, `/revista/articulos/`, `/revista/entrevistas/`,
`/revista/materiales/`, `/revista/noticias/`, `/revista/proyectos/`,
`/salon/`, `/sobre-nosotros/`, `/solicitar-presupuesto/`,
`/terminos-marketplace/`.

### 3.2 Páginas no etiquetadas: 19 (esperado)

| Página | Categoría | ¿Debería tener tracking? |
|---|---|---|
| `admin/` | Admin Curino | ✗ NO (no es público) |
| `admin/armarios/` | Admin Curino | ✗ NO |
| `admin/armarios/precios/` | Admin Curino | ✗ NO |
| `admin/armarios/presupuestos/` | Admin Curino | ✗ NO |
| `admin/armarios/presupuestos/editor/` | Admin Curino | ✗ NO |
| `admin/armarios/presupuestos/preview/` | Admin Curino | ✗ NO |
| `admin/marketplace/` | Admin Curino | ✗ NO |
| `admin/marketplace/reports/` | Admin Curino | ✗ NO |
| `admin/proyectos-carpinteria/` (5 sub-rutas) | Admin Curino | ✗ NO |
| `admin/revista/generador/` (3 sub-rutas) | Admin Curino | ✗ NO |
| `admin/revista/moderacion/` | Admin Curino | ✗ NO |
| `admin/revista/publicar/` | Admin Curino | ✗ NO |
| `auth/callback/` | Página técnica OAuth Supabase (redirect intermedio tras login) | ⚠️ Discutible: hit corto, podría taggearse para medir login flow. Sin GTM no aparece en analytics. |

> Si el diagnóstico de GTM marca "páginas sin etiquetar" se refiere
> probablemente a estas 19. **Las admin no es regresión** (es by-design — no
> queremos tracking en el panel de gestión). `auth/callback/index.html` sí
> merece revisión: si el flujo de login redirige por ahí, GA4 podría estar
> contando un page-view fantasma (o ninguno, según referrer).

### 3.3 Snippet uniforme — verificado byte-a-byte

Mismo bloque de 6 líneas en las 49 páginas etiquetadas. No hay variaciones.

---

## 4. Lista priorizada de fixes (sin implementar)

Las propuestas se agrupan por síntoma. Cada fix indica **archivo:línea**,
**riesgo**, y **expectativa**. Nada de esto está aplicado todavía.

### A) Por qué el banner no aparece en webview Instagram

> Realmente: aparece tarde o no aparece para usuarios con `curino_consent_v2`
> previo + el evento de update llega cuando GTM ya disparó.

| # | Fix propuesto | Dónde | Riesgo | Expectativa |
|---|---|---|---|---|
| A1 | Mover `<script src="/assets/js/cookie-banner.js">` del final del body al final del `<head>`, **antes** del GTM loader, y quitar `defer` (o usar `async` con guard de DOM ready). El JS no toca el DOM hasta `DOMContentLoaded` — el move es seguro. | `index.html:847` y las otras 48 páginas | Bajo. El banner ya tiene guard de `readyState`. | El banner se inicializa unos cientos de ms antes; cubre más casos donde el usuario aceptó previamente y el snippet inline no pudo upgradear (granulares). |
| A2 | Añadir log opcional `console.warn('[curino-consent] banner init')` en `init()` para que en remote debugging de IG webview podamos confirmar si el script siquiera arranca. | `assets/js/cookie-banner.js:442` | Cero (solo log, fácil quitar). | Diagnóstico claro: si el log no aparece en IG webview, el JS no está cargando — entonces el problema es de red/CSP. |
| A3 | Manejar el caso de excepción durante `init()` con un fallback que aplique `analytics_storage=granted` SOLO si el sitio detecta ya un consent v2 con `performance:true` (ya está, pero a prueba de errores). | `cookie-banner.js:442-467` | Bajo. | Reduce el "ghost denied" tras crash del banner. |

### B) Por qué GA4 está a cero

> Causa raíz: Consent Mode v2 BÁSICO + defaults denied globales sin
> redacción avanzada → sin pings cookieless → sin datos modelados.

| # | Fix propuesto | Dónde | Riesgo | Expectativa |
|---|---|---|---|---|
| **B1 (crítico)** | Añadir `ads_data_redaction: true` y `url_passthrough: true` al `gtag('consent','default', {...})`. **Esto activa Consent Mode v2 AVANZADO** y permite a GA4/Ads recibir pings cookieless y modelar conversiones. | Inline script en las 49 páginas (`index.html:625` y equivalentes) | Bajo. Es la configuración recomendada por Google. | GA4 empieza a recibir tráfico de "usuarios sin consent" como datos modelados. El consent rate en GTM dejará de ser 0 %. |
| **B2 (crítico)** | Añadir `region: ['ES','PT','FR','IT','DE','NL','BE','LU','DK','SE','FI','IE','PL','CZ','AT','EE','LV','LT','SK','SI','HR','HU','RO','BG','GR','MT','CY','IS','LI','NO','GB']` al default denied. Para `region` fuera de esa lista, añadir un segundo `gtag('consent','default', {...granted})` (o invertir la lógica). | Inline script | Medio — requiere validar la lista. | Fuera del EEE/UK los usuarios entran con `granted` y se mide a la primera. Consent rate global se dispara. |
| B3 | Aumentar `wait_for_update` de 500 → 2000 ms. En basic-mode esto da más holgura al banner para promover el consent antes de que GTM dispare con denied. Solo útil mientras se sigue dependiendo del banner. | Inline script | Bajo. Solo retrasa la primera medición. | Menos disparos en denied para usuarios que aceptan rápido. |
| B4 | Asegurar que el tag de GA4 en GTM está configurado con "Consent Settings → Built-in" en `analytics_storage`. (No verificable desde repo — confirmar en GTM Console). | GTM Console (externo) | Cero (config). | Sin esto, GA4 no respeta el consent y puede disparar siempre. |
| B5 | Revisar (en GTM) si hay etiquetas con `Consent Initialization` / `Consent Mode` mal configuradas que rechacen todo automáticamente. | GTM Console (externo) | Cero. | Origen alternativo del 100 % rechazadas. |

### C) Por qué CAPI no mide tráfico de Instagram

> No es CAPI quien falla — es el Pixel cliente quien nunca dispara en
> webview IG (porque consent queda en denied), así que CAPI nunca recibe
> el `event_id` para hacer dedup ni los demás eventos cliente.

| # | Fix propuesto | Dónde | Riesgo | Expectativa |
|---|---|---|---|---|
| **C1 (crítico)** | Confirmar dónde vive realmente "el Meta Pixel cliente" (búsqueda en repo da 0 hits): ¿es un tag en GTM? ¿Server-Side Container? Sin esa info no podemos verificar el gating ni saber por qué no dispara desde IG webview. | GTM Console (externo) | Cero (inventario). | Visibilidad del setup. |
| C2 | Si el Pixel está en GTM: asegurar que su Consent Settings consume `ad_storage` (no requiera ningún consent adicional). Una vez B1/B2 estén aplicados, el Pixel disparará para usuarios con `granted` o, en modo avanzado, mandará pings de modelado. | GTM Console | Bajo. | Pixel dispara desde IG webview cuando ad_storage = granted. |
| C3 | Confirmar dónde vive la Edge Function de CAPI (no está en `supabase/functions/` de este repo). Si está en otro repo / hosting, ese repo necesita su propia auditoría de gating + dedup. | Inventario externo | Cero. | Trazabilidad del pipeline servidor. |
| C4 | Una vez Pixel y CAPI estén unificados: implementar `event_id` compartido y enviar el `_fbp` cookie + `_fbc` (de `fbclid`) al servidor para dedup. Si el repo va a tener un trigger en cliente, este es el sitio (nuevo archivo, p. ej. `assets/js/meta-tracking.js`). | A definir | Medio (nueva pieza). | Eventos IG dedupeados correctamente entre cliente y servidor. |
| C5 | Añadir captura de `fbclid` (y `igsh` para Instagram) en `URLSearchParams` y persistirlos en `localStorage` (gateado por `advertising:true`) — necesario para que CAPI pueda atribuir clicks de Instagram al usuario que acaba comprando. Hoy se pierden estos params. | Nueva pieza | Bajo. | Atribución de campañas IG completa. |

---

## 5. Conclusiones operativas (TL;DR para tomar decisiones rápidas)

1. **Antes de lanzar la campaña** los fixes B1 y B2 son **bloqueantes**.
   Sin ellos, GA4 seguirá a cero y GTM seguirá marcando rechazadas.
2. **A1** (mover el banner al `<head>`) es un fix de bajo riesgo que mejora
   el ratio de capturas tempranas en webview.
3. **C1+C3 (inventario externo)** son indispensables para saber si la
   tubería Pixel→CAPI siquiera está conectada antes de gastar en ads.
4. **No hay regresión de cobertura GTM en páginas públicas** — el reporte
   de "sin etiquetar" del diagnóstico se refiere a páginas admin y
   `auth/callback`, que es by-design.
5. **No hay rotura específica de webview Instagram en el código del repo.**
   El síntoma "el banner no aparece en IG" es probablemente timing + el
   Consent Mode básico haciendo lo que está diseñado a hacer: nada.

Cuando quieras implementar, el orden recomendado es B2 → B1 → A1 → C1/C3.
Cada uno verificable independientemente desde GTM Debug + Tag Assistant.
