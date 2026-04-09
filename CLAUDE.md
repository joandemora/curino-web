# Curino Configurador v24 — Resumen de cambios

## Archivo principal
`/Users/joandemora/Desktop/34curino_configurador_v24.html`

## Recursos
`/Users/joandemora/Desktop/imagenes/` — imágenes externas (swatches, textiles, tiles)

---

## Cambios realizados (sesión 8-9 abril 2026)

### 1. Extracción de imágenes base64
- Extraídas 107 imágenes base64 del HTML original (v23) a archivos en `imagenes/`
- Las imágenes usadas en JS/canvas se mantienen embebidas como base64 (necesario para evitar tainted canvas en file://)
- Las imágenes solo usadas en CSS (swatches) se referencian como archivos externos
- HTML pasó de 21MB a ~16MB

### 2. Paso 3 Puertas — Materiales Marco y Travesaño
- Eliminadas opciones "Raton Wengue" y "Castaño Cancún" (HTML, JS, imágenes base64)
- Añadido selector "Madera Natural / Lacado RAL" con grid de 30 colores RAL
- RAL aplica color sólido al marco en el canvas (tanto cerrada como abierta)
- Grano mate (p3DrawGrainMatte) aplicado al marco cuando es RAL
- Añadido selector "Con travesaño / Sin travesaño" (toggle de 2 botones)
- Sin travesaño: canvas dibuja un solo panel textil grande sin barra horizontal

### 3. Paso 3 Puertas — Panel Textil
- Título "Panel Textil" igualado en estilo a "Marco y Travesaño" (misma clase .p3l)
- Swatches textiles cambiados a grid 4 columnas con mismo tamaño que los de madera (clase .p3mg/.p3ms)
- 8 textiles con imágenes reales: Snow, Dune (ex-Beige), Ruby, Copper, Tobacco, Onyx, Sage, Midnight
- Imágenes convertidas a tiles de 200x200px para evitar costuras en repeat
- Canvas usa drawImage escalado (no createPattern) para evitar discontinuidades
- Tobacco regenerado con calidad JPEG 100% para mejor nitidez

### 4. Paso 3 Puertas — Gama de Puertas
- Selector ampliado a 3 opciones: "Sin Puertas", "Puertas Fina", "Puertas Lisas"
- "Sin Puertas": oculta toda la config de puertas, visor muestra armario abierto
- Botones CSS compactados (.p3tb: font-size .6rem, letter-spacing .06em)

### 5. Paso 3 Puertas — Vista de Puertas
- Botones "Cerradas / Abiertas" movidos al visor (overlay flotante, bottom: 8%)
- Solo visibles en paso 3 cuando gama != sinpuertas
- Eliminada sección "Vista de Puertas" del panel derecho

### 6. Paso 3 Puertas — Por módulo
- Eliminada línea "X hojas · apertura automática" de cada módulo

### 7. Swatches de madera (Paso 3)
- Wengue, Nogal, Cerezo: creados tiles rotados 90° (200x200px) con veta vertical
- Eliminada rotación CSS (p3ms-rot), se usan directamente los tiles rotados
- Roble renombrado de "Roble Vicenza" a "Roble"

### 8. Paso 1 Dimensiones — Material
- Padding de sección Material alineado con el resto (2.5rem)
- Swatches Wengue y Nogal usan los mismos tiles del paso 3 (img_001_tile.png, img_002_tile.png)

### 9. Paso 1 Dimensiones — Presets y slider
- Preset por defecto cambiado de M·150cm a L·200cm (ST.w=200, slider, label, botón activo)
- Al mover slider de ancho manualmente, se deselecciona el botón de preset activo

### 10. Lógica de módulos
- calcModules: módulos válidos en rango 43-65cm (1 puerta) o 80-130cm (2 puertas)
- Zona prohibida 66-79cm: nunca genera módulos en ese rango
- Caso especial 131-159cm: 2 módulos asimétricos ratio 2:1 (A + 2A = total/3)
- Para >=160cm: módulos mínimo 80cm, máximo 130cm, siempre iguales
- p3Hojas actualizada: ≤65cm = 1 puerta, ≥80cm = 2 puertas
- changeModules (botones +/-): salta N inválidos, soporta caso asimétrico 131-159cm
- isValidN: respeta mínimo 80cm para anchos ≥160cm

### 11. Visor canvas
- Puertas solo visibles en paso 3 (buildComposite se llama al cambiar de paso)
- Cotas con 1 decimal (toFixed(1)): "98.5 cm" en vez de "99 cm"
- Cotas usan valor real ST.w/N (no el ancho entero redondeado del módulo)
- Font-weight cotas: 400 (normal, antes 600)
- Márgenes cotas ampliados: TM=72, BM=72, LM=52 (antes 52/52/36)
- id="wardrobeWrap" añadido al div .wardrobe-img-wrap
- Precio: "Precio PVP" (antes "Precio estimado")

### 12. Modo Ambiente (eliminado)
- Se implementó y posteriormente eliminó completamente
- El visor solo tiene botones "Cerradas" y "Abiertas"
