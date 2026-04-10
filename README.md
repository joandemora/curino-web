# Curino Web

Web, configurador y ecommerce de **Curino** — mobiliario a medida.

## Estructura del proyecto

```
curino-web/
├── index.html                              ← Landing page
├── configurador-armarios-vestidores/
│   └── index.html                          ← Configurador 3D (16MB, single-page)
├── assets/
│   └── imagenes/                           ← Imágenes externas (130 archivos)
│       ├── *-scaled.jpg                    ← Textiles originales (2560x1829)
│       ├── *-scaled_tile.jpg               ← Textiles tiles (200x200)
│       ├── img_*_tile.png                  ← Madera tiles rotados (200x200)
│       ├── img_*.jpg                       ← Swatches CSS
│       └── img_*.png                       ← Interiores + swatches
├── CLAUDE.md                               ← Changelog técnico
└── README.md
```

## Páginas

### Landing (`/`)
- Presentación de la marca Curino
- Links al configurador
- Diseño responsive

### Configurador (`/configurador-armarios-vestidores/`)
- **Paso 1 — Dimensiones**: ancho (60-600cm), alto (240-300cm), fondo, presets S/M/L/XL/XXL, material
- **Paso 2 — Interior**: configuración por módulo (estantes, cajonera, perchero, zapatero)
- **Paso 3 — Puertas**: gama (Sin Puertas / Puertas Fina / Puertas Lisas), marco, textiles, RAL
- Visor canvas en tiempo real con cotas
- Precio PVP dinámico
- Single-page HTML con CSS y JS inline, imágenes base64 embebidas para canvas

## Stack técnico
- HTML/CSS/JS vanilla (sin frameworks)
- Canvas 2D para renderizado del armario
- Imágenes base64 embebidas en JS (necesario para canvas en file://)
- Google Fonts (Open Sans)
- Responsive (media queries ≤768px)

## Desarrollo
```bash
# Abrir en navegador (funciona con file://)
open configurador-armarios-vestidores/index.html

# O servir con cualquier servidor local
python3 -m http.server 8000
```

## Próximos pasos
- [ ] Separar CSS y JS del HTML del configurador en archivos externos
- [ ] Añadir página de producto/catálogo
- [ ] Integrar formulario de presupuesto con backend
- [ ] Añadir más tipos de mueble al configurador (cocinas, baños)
- [ ] Optimizar imágenes: servir desde CDN en vez de base64
- [ ] Añadir modo Ambiente con foto de habitación real
- [ ] Tests automatizados para la lógica de módulos
