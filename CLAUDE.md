# Curino Web — Contexto técnico para Claude

## Ubicación del proyecto
`/Users/joandemora/Desktop/ESCRITORIO JOAN DE MORA/CURINO/10 - WEB/curino-web/`

## Repositorio
- Remote: `https://github.com/joandemora/curino-web.git`
- Branch: `main`
- Tag: `antes-reorganizacion` (punto de restauración pre-reorganización)

## Estructura
```
curino-web/
├── index.html                              ← Landing page
├── configurador-armarios-vestidores/
│   └── index.html                          ← Configurador (rutas: ../assets/imagenes/)
├── assets/
│   └── imagenes/                           ← 130 archivos (tiles, swatches, interiores)
├── CLAUDE.md
└── README.md
```

## Archivo original (referencia)
`/Users/joandemora/Desktop/34curino_configurador_v23.html` (21MB, todo base64)

---

## Estado global del configurador (JS)

```javascript
const ST = {w:200, h:240, d:60, modules:[]};  // dimensiones y módulos
let curMatId = 'mad_wengue';                    // material seleccionado
let manualMods = false;                         // true si usuario cambió módulos con +/-

var _P3 = {                                     // estado paso 3
  gama:'molduras',      // sinpuertas | molduras | lisas
  mat:'mad_wengue',     // material marco
  marcoTipo:'madera',   // madera | ral
  marcoRal:0,           // índice RAL (0-29)
  tx:1,                 // índice textil (0=Snow, 1=Dune, 2=Ruby, ...)
  ral:0,                // índice RAL puertas lisas
  mods:[],              // [{con:true, ap:'der'}, ...] por módulo
  view:'closed',        // closed | open
  trav:true             // con/sin travesaño
};
```

## Funciones clave

| Función | Descripción |
|---------|-------------|
| `calcModules(w)` | Genera array de anchos. Zona prohibida 66-79cm. Caso 131-159cm: ratio 2:1 |
| `buildComposite()` | Renderiza canvas (interiores + cotas + puertas) |
| `p3DrawDoors(ctx, totalPx, imgH, LM, TM)` | Dibuja puertas (async Promise) |
| `p3DrawDoorShape()` | Puerta moldura cerrada (marco + travesaño + paneles textil) |
| `p3DrawDoorOpen()` | Puerta moldura abierta (perspectiva 60°) |
| `p3DrawLisaClosed()` / `p3DrawLisaOpen()` | Puertas lisas RAL |
| `p3DrawGrainMatte()` | Efecto granulado mate para superficies RAL |
| `p3Hojas(w)` | ≤65cm: 1 puerta, ≥80cm: 2 puertas |
| `goStep(n)` | Cambia de paso (1/2/3), redibuja canvas |
| `renderToViewer(canvas)` | Convierte canvas a img, escala al visor |
| `changeModules(delta)` | Botones +/-, salta N inválidos |
| `p3Gama(g)` | Toggle sinpuertas/molduras/lisas |
| `p3MarcoTipo(t)` | Toggle madera/ral para marco |
| `p3ToggleTrav(on)` | Toggle con/sin travesaño |
| `p3SetView(v)` | Toggle cerradas/abiertas |

## Reglas de módulos

| Rango ancho total | Módulos | Ancho módulo | Puertas/módulo |
|-------------------|---------|--------------|----------------|
| 60-130cm | 1 | = total | ≤65: 1p, ≥80: 2p |
| 131-159cm | 2 asimétricos | A + 2A (ratio 2:1) | pequeño: 1p, grande: 2p |
| ≥160cm | N iguales | 80-130cm | 2p siempre |

Zona prohibida: 66-79cm (ni 1 puerta cabe bien, ni 2).

## Imágenes

### Embebidas en JS (base64, para canvas)
- `INT_IMGS` + variantes por material — interiores de módulos
- `_P3_DOOR_TEX` — texturas de puertas por material
- `_P3_TEXTIL_TILES` — tiles textiles 200x200
- `_P3_BEIGE_TILE` — tile del textil Dune

### Archivos externos (para swatches CSS)
- `img_001_tile.png` a `img_003_tile.png` — madera rotada 200x200
- `img_001.jpg` a `img_006.jpg` — swatches marco/textil
- `*-scaled_tile.jpg` — textiles 200x200
- `img_001.png` a `img_003.png` — swatches madera (paso 3)

### Sin uso actual (reservadas)
- `ambiente-dormitorio.png` — foto dormitorio para modo Ambiente
- `Captura de pantalla 2026-04-09*` — texturas techo/pared/suelo

## Canvas del visor
- Márgenes para cotas: TM=72, BM=72, LM=52
- IMG_H=800 (altura imágenes interiores)
- PX_PER_CM=2.5
- Cotas: font-weight 400, 1 decimal (toFixed(1))
- Puertas solo visibles en paso 3

## CSS
- Variables: `--black:#0a0a0a`, `--mid:#888`, `--light:#ccc`, `--border:#e5e5e5`, `--bg:#f8f8f6`, `--white:#fff`
- Font: `--font:'Open Sans',system-ui,sans-serif`
- Layout: `.main` grid `3fr 2fr` (visor/panel)
- Mobile: ≤768px, grid 1 columna

---

## Changelog

### Sesión 8-9 abril 2026
- Extracción imágenes base64 a archivos
- Marco y Travesaño: eliminados Raton Wengue/Castaño, añadido RAL, travesaño opcional
- Panel Textil: 8 textiles con imágenes reales (tiles 200x200)
- Gama: Sin Puertas / Puertas Fina / Puertas Lisas
- Vista Cerradas/Abiertas movida al visor
- Lógica módulos: zona prohibida 66-79, caso 131-159 ratio 2:1, mínimo 80cm para ≥160cm
- Cotas: 1 decimal, font-weight 400, márgenes ampliados
- Preset default: L·200cm
- Modo Ambiente: implementado y eliminado

### Sesión 9-10 abril 2026
- Reorganización: configurador.html → configurador-armarios-vestidores/index.html
- Imágenes: imagenes/ → assets/imagenes/
- Rutas actualizadas en HTML
- Tag `antes-reorganizacion` creado
- README.md y CLAUDE.md actualizados
