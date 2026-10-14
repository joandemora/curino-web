// supabase/functions/_shared/estudio/cocina-tarifa.ts
//
// Estudio Curino · tarifa de COCINAS «Cocinas – Proveedor 1» (transcripción
// del PDF «TARIFA DE COCINAS RESUMIDA 13-06-2025», 6 páginas). Solo lectura:
// es la base a la que vuelve «Restablecer». Importes en € de coste tal cual
// vienen en el PDF (null = «*» o casilla vacía: no hay precio). La tarifa se
// usa en PUNTOS: cada importe → puntos redondeando al alza sin decimales
// (39,64 € → 40 pt), también los montajes de cajones (10 → 10, 15 → 15).
// Lo dudoso del PDF está en REVISAR_COCINA (no se ha rellenado nada a ojo).

export const PROVEEDOR_COCINA = 'Cocinas – Proveedor 1';
export const FECHA_TARIFA_COCINA = '2025-05-29';
/** Fecha que figura en cada hoja del PDF. */
export const FECHAS_HOJAS = { modulos: '2025-05-29', encimeras: '2025-06-09', herrajes: '2025-06-09', cajones: '2025-06-09', tableros: '2025-05-29', puertas: '2025-06-03' };

/** € → puntos: al alza, sin decimales (29,00 → 29; 39,64 → 40). */
export function puntosDeEur(eur: number): number {
  return Math.ceil(Math.round(eur * 100) / 100 - 1e-9);
}

// ── p1 · Módulos (cuerpos). Columnas del PDF, tal cual ─────────────────
// medida_a / blanco16_a: «MEDIDA» + «PRECIO» (Blanco grueso 16);
// medida_b / blanco16_b: «MEDIDA» (NOVEDAD) + Blanco grueso 16;
// gris_plomo16 y blanco_plus18 (hidrófugo): últimas columnas (ver REVISAR_COCINA[0]).
// Medidas «alto x ancho» en cm (esquineros «alto x 93 x 93»).
export interface FilaModuloCocina {
  descripcion: string;
  medida_a: string | null; blanco16_a: number | null;
  medida_b: string | null; blanco16_b: number | null;
  gris_plomo16: number | null; blanco_plus18: number | null;
  nota?: string;
}
export const MODULOS_COCINA: FilaModuloCocina[] = [
  { descripcion: "MÓDULO BAJO", medida_a: "70x30", blanco16_a: 29, medida_b: "80x30", blanco16_b: 32.16, gris_plomo16: 35.48, blanco_plus18: 32.47 },
  { descripcion: "MÓDULO BAJO", medida_a: "70x35", blanco16_a: 31.37, medida_b: "80x35", blanco16_b: 34.06, gris_plomo16: 37.52, blanco_plus18: 34.02 },
  { descripcion: "MÓDULO BAJO", medida_a: "70x40", blanco16_a: 32.59, medida_b: "80x40", blanco16_b: 35.92, gris_plomo16: 39.9, blanco_plus18: 35.7 },
  { descripcion: "MÓDULO BAJO", medida_a: "70x45", blanco16_a: 34.35, medida_b: "80x45", blanco16_b: 37.73, gris_plomo16: null, blanco_plus18: 37.71 },
  { descripcion: "MÓDULO BAJO", medida_a: "70x50", blanco16_a: 36.16, medida_b: "80x50", blanco16_b: 39.62, gris_plomo16: 43.61, blanco_plus18: 40.12 },
  { descripcion: "MÓDULO BAJO", medida_a: "70x60", blanco16_a: 39.64, medida_b: "80x60", blanco16_b: 43.29, gris_plomo16: 47.63, blanco_plus18: 42.82 },
  { descripcion: "MÓDULO BAJO", medida_a: "70x70", blanco16_a: 43.22, medida_b: "80x70", blanco16_b: 47.07, gris_plomo16: 51.74, blanco_plus18: 47.05 },
  { descripcion: "MÓDULO BAJO", medida_a: "70x80", blanco16_a: 46.78, medida_b: "80x80", blanco16_b: 50.75, gris_plomo16: 55.77, blanco_plus18: 51.36 },
  { descripcion: "MÓDULO BAJO", medida_a: "70x90", blanco16_a: 50.35, medida_b: "80x90", blanco16_b: 54.49, gris_plomo16: 59.87, blanco_plus18: 54.55 },
  { descripcion: "MÓDULO BAJO", medida_a: "70x100", blanco16_a: 53.86, medida_b: "80x100", blanco16_b: 58.17, gris_plomo16: 63.88, blanco_plus18: 58.55 },
  { descripcion: "HORNO", medida_a: "70x60", blanco16_a: 32.38, medida_b: "80x60", blanco16_b: 35.11, gris_plomo16: 38.37, blanco_plus18: 42.91 },
  { descripcion: "FREGADERO", medida_a: "70x60", blanco16_a: 31.47, medida_b: "80x60", blanco16_b: 34.48, gris_plomo16: 38, blanco_plus18: 35.39 },
  { descripcion: "FREGADERO", medida_a: "70x80", blanco16_a: 35.97, medida_b: "80x80", blanco16_b: 39, gris_plomo16: 42.98, blanco_plus18: 40.44 },
  { descripcion: "FREGADERO", medida_a: "70x90", blanco16_a: 38.25, medida_b: "80x90", blanco16_b: 41.39, gris_plomo16: 45.63, blanco_plus18: 42.44 },
  { descripcion: "FREGADERO", medida_a: "70x100", blanco16_a: 40.51, medida_b: "80x100", blanco16_b: 43.54, gris_plomo16: 47.98, blanco_plus18: 44.6 },
  { descripcion: "FREGADERO", medida_a: "70x120", blanco16_a: 44.99, medida_b: "80x120", blanco16_b: 47.86, gris_plomo16: 52.75, blanco_plus18: null },
  { descripcion: "ESQUINERO BAJO", medida_a: "70x93x93", blanco16_a: 110.87, medida_b: "80x93x93", blanco16_b: 124.14, gris_plomo16: 133.82, blanco_plus18: 118.6 },
  { descripcion: "MODULO ALTO", medida_a: "70x30", blanco16_a: 22.74, medida_b: "80x30", blanco16_b: 23.99, gris_plomo16: 26.79, blanco_plus18: null },
  { descripcion: "MODULO ALTO", medida_a: "70x35", blanco16_a: 23.42, medida_b: "80x35", blanco16_b: 25.66, gris_plomo16: 28.7, blanco_plus18: null },
  { descripcion: "MODULO ALTO", medida_a: "70x40", blanco16_a: 24.97, medida_b: "80x40", blanco16_b: 27.33, gris_plomo16: 30.57, blanco_plus18: null },
  { descripcion: "MODULO ALTO", medida_a: "70x45", blanco16_a: 26.49, medida_b: "80x45", blanco16_b: 28.94, gris_plomo16: null, blanco_plus18: null },
  { descripcion: "MODULO ALTO", medida_a: "70x50", blanco16_a: 28.05, medida_b: "80x50", blanco16_b: 30.8, gris_plomo16: 34.48, blanco_plus18: null },
  { descripcion: "MODULO ALTO", medida_a: "70x60", blanco16_a: 31.12, medida_b: "80x60", blanco16_b: 33.83, gris_plomo16: 37.88, blanco_plus18: null },
  { descripcion: "MODULO ALTO", medida_a: "70x70", blanco16_a: 34.17, medida_b: "80x70", blanco16_b: 37.04, gris_plomo16: 41.57, blanco_plus18: null },
  { descripcion: "MODULO ALTO", medida_a: "70x80", blanco16_a: 37.24, medida_b: "80x80", blanco16_b: 40.26, gris_plomo16: 45.13, blanco_plus18: null },
  { descripcion: "MODULO ALTO", medida_a: "70x90", blanco16_a: 40.3, medida_b: "80x90", blanco16_b: 43.5, gris_plomo16: 48.85, blanco_plus18: null },
  { descripcion: "MODULO ALTO", medida_a: "70x100", blanco16_a: 43.4, medida_b: "80x100", blanco16_b: 46.84, gris_plomo16: 52.6, blanco_plus18: null },
  { descripcion: "MODULO ALTO", medida_a: "90x30", blanco16_a: 26.26, medida_b: null, blanco16_b: null, gris_plomo16: 29.1, blanco_plus18: 26.74 },
  { descripcion: "MODULO ALTO", medida_a: "90x35", blanco16_a: 27.92, medida_b: null, blanco16_b: null, gris_plomo16: 31.01, blanco_plus18: 28.43 },
  { descripcion: "MODULO ALTO", medida_a: "90x40", blanco16_a: 29.58, medida_b: null, blanco16_b: null, gris_plomo16: 32.9, blanco_plus18: 30.42 },
  { descripcion: "MODULO ALTO", medida_a: "90x45", blanco16_a: 31.21, medida_b: null, blanco16_b: null, gris_plomo16: null, blanco_plus18: 32.83 },
  { descripcion: "MODULO ALTO", medida_a: "90x50", blanco16_a: 32.84, medida_b: null, blanco16_b: null, gris_plomo16: 36.64, blanco_plus18: 34.59 },
  { descripcion: "MODULO ALTO", medida_a: "90x60", blanco16_a: 36.17, medida_b: null, blanco16_b: null, gris_plomo16: 40.34, blanco_plus18: 39.01 },
  { descripcion: "MODULO ALTO", medida_a: "90x70", blanco16_a: 39.46, medida_b: null, blanco16_b: null, gris_plomo16: null, blanco_plus18: 41.73 },
  { descripcion: "MODULO ALTO", medida_a: "90x80", blanco16_a: 42.76, medida_b: null, blanco16_b: null, gris_plomo16: null, blanco_plus18: 46.06 },
  { descripcion: "MODULO ALTO", medida_a: "90x90", blanco16_a: 46.05, medida_b: null, blanco16_b: null, gris_plomo16: null, blanco_plus18: 49.57 },
  { descripcion: "MODULO ALTO", medida_a: "90x100", blanco16_a: 49.36, medida_b: null, blanco16_b: null, gris_plomo16: null, blanco_plus18: 51.96 },
  { descripcion: "ESQUINERO ALTO", medida_a: "70x63x63", blanco16_a: 69.5, medida_b: "80x63x63", blanco16_b: 76.87, gris_plomo16: 86.4, blanco_plus18: null },
  { descripcion: "ESQUINERO ALTO", medida_a: "90x63x63", blanco16_a: 78.12, medida_b: null, blanco16_b: null, gris_plomo16: 86.99, blanco_plus18: 85.07 },
  { descripcion: "COLUMNA UNIV.", medida_a: "220x60", blanco16_a: 106.34, medida_b: null, blanco16_b: null, gris_plomo16: 118.43, blanco_plus18: null },
  { descripcion: "COLUMNA H+M", medida_a: null, blanco16_a: null, medida_b: null, blanco16_b: null, gris_plomo16: null, blanco_plus18: 140.7 },
  { descripcion: "COLUMNA UNIV.", medida_a: "230x60", blanco16_a: 82.46, medida_b: "230x40", blanco16_b: 89.82, gris_plomo16: 122.47, blanco_plus18: 140.7 },
  { descripcion: "SOBRENEVERA", medida_a: "35x60", blanco16_a: 16.68, medida_b: null, blanco16_b: null, gris_plomo16: 18.59, blanco_plus18: null },
  { descripcion: "SOBRENEVERA", medida_a: "45x60", blanco16_a: 22.34, medida_b: null, blanco16_b: null, gris_plomo16: 25.01, blanco_plus18: 20.04 },
  { descripcion: "TRANSVERSAL", medida_a: "45x90", blanco16_a: 29.32, medida_b: null, blanco16_b: null, gris_plomo16: 33.13, blanco_plus18: 37.9 },
  { descripcion: "LATERAL BAJO", medida_a: "366x58", blanco16_a: 37.03, medida_b: null, blanco16_b: null, gris_plomo16: 41.45, blanco_plus18: 42.18, nota: "Blanco Plus: medida 244 x 58" },
  { descripcion: "LATERAL ALTO", medida_a: "366x33", blanco16_a: 21.95, medida_b: null, blanco16_b: null, gris_plomo16: 24.8, blanco_plus18: 24.08, nota: "Blanco Plus: medida 244 x 33" },
  { descripcion: "COLUMNA UNIV.", medida_a: "230x40", blanco16_a: null, medida_b: null, blanco16_b: null, gris_plomo16: 98.22, blanco_plus18: null },
];

// ── p2 · Encimeras de compacto (precio por placa) ──────────────────────
export type NucleoEncimera = 'negro' | 'al_tono' | 'blanco';
export interface Encimera { nucleo: NucleoEncimera; ref: string; eur: number; largo: number; ancho: number; grueso: number }   // mm
export const ENCIMERAS_COCINA: Encimera[] = [
  { nucleo: 'negro', ref: "BLACK -OXI GOLD", eur: 411.65, largo: 4200, ancho: 810, grueso: 12 },
  { nucleo: 'negro', ref: "OXIDO 0793 NN", eur: 503.66, largo: 4100, ancho: 650, grueso: 12 },
  { nucleo: 'negro', ref: "PIZARRA AZABACHE 0080 SX", eur: 322.86, largo: 4100, ancho: 650, grueso: 12 },
  { nucleo: 'negro', ref: "MARQUINA 0599 FH", eur: 240.86, largo: 4100, ancho: 650, grueso: 12 },
  { nucleo: 'negro', ref: "E0585FH CASTILLO", eur: 240.86, largo: 4100, ancho: 650, grueso: 12 },
  { nucleo: 'negro', ref: "E0026FH PRADO", eur: 240.86, largo: 4100, ancho: 650, grueso: 12 },
  { nucleo: 'negro', ref: "E0077SX CARBON", eur: 322.86, largo: 4100, ancho: 650, grueso: 12 },
  { nucleo: 'negro', ref: "ROBLE KOFFEE P. REGISTRO", eur: 442.79, largo: 4200, ancho: 700, grueso: 12 },
  { nucleo: 'negro', ref: "ROBLE ROYAL P. REGISTRO", eur: 442.79, largo: 4200, ancho: 700, grueso: 12 },
  { nucleo: 'al_tono', ref: "CREMA SAHARA", eur: 419.89, largo: 4200, ancho: 655, grueso: 12 },
  { nucleo: 'al_tono', ref: "E0833FH REZZATO N/GRIS", eur: 450.97, largo: 4100, ancho: 650, grueso: 12 },
  { nucleo: 'al_tono', ref: "MINERAL BEIGE", eur: 677.85, largo: 4200, ancho: 700, grueso: 10 },
  { nucleo: 'al_tono', ref: "ROBLE NATURAL", eur: 677.85, largo: 4200, ancho: 700, grueso: 10 },
  { nucleo: 'blanco', ref: "COMPACTO CALACATA", eur: 584.4, largo: 4200, ancho: 810, grueso: 12 },
  { nucleo: 'blanco', ref: "COMPACTO BASALTO 0581 *", eur: 561.28, largo: 4100, ancho: 650, grueso: 12 },
  { nucleo: 'blanco', ref: "BLANCO SM ANTIHUELLA", eur: 447.64, largo: 4200, ancho: 655, grueso: 12 },
  { nucleo: 'blanco', ref: "CALACATA V DORADA N/BLANCO", eur: 354.55, largo: 3660, ancho: 700, grueso: 10 },
  { nucleo: 'blanco', ref: "BLANCA N/BLANCO", eur: 354.55, largo: 3660, ancho: 700, grueso: 10 },
  { nucleo: 'blanco', ref: "E0834 FH PAROS N/BLANCO", eur: 450.97, largo: 4100, ancho: 650, grueso: 12 },
  { nucleo: 'blanco', ref: "E0835 FH TASOS N/BLANCO", eur: 450.97, largo: 4100, ancho: 650, grueso: 12 },
];

// ── p2 · Herrajes, cestos y cubos, sistemas de alzamiento (Aventos) ───
export interface HerrajeCocina { codigo: string; articulo: string; eur: number | null }
export const HERRAJES_COCINA: HerrajeCocina[] = [
  { codigo: '00817', articulo: "CARRO EXTRAÍBLE PORTA-BOTELLAS M-40", eur: 78.49 },
  { codigo: '00818', articulo: "COLUMNA EXTRAÍBLE M-30", eur: 291.74 },
  { codigo: '00803', articulo: "KIT CESTO BAJO FREGADERO M-60", eur: 156.52 },
  { codigo: '00804', articulo: "KIT CESTO BAJO FREGADERO M-80", eur: 168.92 },
  { codigo: '00805', articulo: "KIT CESTO BAJO FREGADERO M-90", eur: 175.87 },
  { codigo: '00800', articulo: "KIT CUBOS RECICLAJE M-60", eur: 191.28 },
  { codigo: '00801', articulo: "KIT CUBOS RECICLAJE M-80", eur: 255.19 },
  { codigo: '00802', articulo: "KIT CUBOS RECICLAJE M-90", eur: 255.19 },
  { codigo: '00834', articulo: "CUBO BASURA EXTRAÍBLE (35 LITROS) M-30", eur: 197.12 },
  { codigo: '00835', articulo: "CUBO BASURA EXTRAÍBLE (35 LITROS) M-40", eur: null },
  { codigo: '00836', articulo: "2 CUBOS BASURA EXTRAÍBLE (35+35 LITROS) M-45", eur: 239.6 },
  { codigo: '00837', articulo: "2 CUBOS BASURA EXTRAÍBLE (35+35 LITROS) M-50", eur: 170.94 },
  { codigo: '05269', articulo: "AVENTOS HF PLEGABLE (50-60-70 ANCHO)", eur: 79.92 },
  { codigo: '05268', articulo: "AVENTOS HF PLEGABLE (80-90-100 ANCHO)", eur: 89.65 },
  { codigo: '05280', articulo: "AVENTOS HK ABATIBLE (50-60-70 ANCHO)", eur: 44.31 },
  { codigo: '05281', articulo: "AVENTOS HK ABATIBLE (80-90-100 ANCHO)", eur: 45.99 },
];

// ── p2 · Cajones ───────────────────────────────────────────────────────
/** Advänced (blanco y antracita): kit de guía por altura (mm) y fondo (mm). */
export const CAJON_ADVANCED = {
  kits: [
    { altura: 87, fondo: 300, eur: 31.64 },
    { altura: 87, fondo: 350, eur: 32.79 },
    { altura: 87, fondo: 400, eur: 34.11 },
    { altura: 87, fondo: 450, eur: 35 },
    { altura: 87, fondo: 500, eur: 25.6 },
    { altura: 117, fondo: 300, eur: 34.15 },
    { altura: 117, fondo: 350, eur: 35.44 },
    { altura: 117, fondo: 400, eur: 37.24 },
    { altura: 117, fondo: 450, eur: 39.02 },
    { altura: 117, fondo: 500, eur: 29.55 },
    { altura: 167, fondo: 350, eur: 42.27 },
    { altura: 167, fondo: 400, eur: 43.26 },
    { altura: 167, fondo: 450, eur: 45.81 },
    { altura: 167, fondo: 500, eur: 35.16 },
    { altura: 183, fondo: 500, eur: 38.37 },
  ],
  base_trasera: { blanco: 11.8, antracita: 12.85 },
  montaje: 10   // cargo montaje (neto) por cajón
};
/** Legrabox antracita: kit de guía fondo 500 por altura M / C / F. */
export const CAJON_LEGRABOX = {
  kits: [
    { altura: 'M', mm: 90.5, fondo: 500, eur: 49.54 },
    { altura: 'C', mm: 177, fondo: 500, eur: 63.37 },
    { altura: 'F', mm: 241, fondo: 500, eur: 92.17 },
  ],
  base_trasera: { antracita: 12.85 },
  montaje: 15   // cargo montaje (neto) por cajón
};

// ── p3 · Tableros por grupo (€/m²) y «servicio cocina a cocina» ───────
export interface TableroCocina { grupo: number | null; descripcion: string; calidad: string; grueso: number | null; largo: number | null; ancho: number | null; eur_m2: number | null; eur_m2_mas10: number | null; eur_m2_paquete20: number | null }
export const TABLEROS_COCINA: TableroCocina[] = [
  { grupo: 1, descripcion: "MELAMINA ( CATALOGO VIRREY )", calidad: "X", grueso: 19, largo: null, ancho: null, eur_m2: null, eur_m2_mas10: null, eur_m2_paquete20: null },
  { grupo: 3, descripcion: "PET 168 HG NEGRO BRILLO/base dm", calidad: "PET", grueso: 18, largo: 2800, ancho: 1220, eur_m2: 28.11, eur_m2_mas10: 19.68, eur_m2_paquete20: 18.13 },
  { grupo: 3, descripcion: "PET 1955 SM NEGRO/base dm", calidad: "PET", grueso: 18, largo: 2800, ancho: 1220, eur_m2: 28.11, eur_m2_mas10: 19.68, eur_m2_paquete20: 18.13 },
  { grupo: 3, descripcion: "PET 1956 SM ANTRACHITE/base dm", calidad: "PET", grueso: 18, largo: 2800, ancho: 1220, eur_m2: 28.11, eur_m2_mas10: 19.68, eur_m2_paquete20: 18.13 },
  { grupo: 3, descripcion: "PET 2277 SM LIGHT GREY/base dm", calidad: "PET", grueso: 18, largo: 2800, ancho: 1220, eur_m2: 28.11, eur_m2_mas10: 19.68, eur_m2_paquete20: 18.13 },
  { grupo: 3, descripcion: "PET 312 SM BLANCO/base dm", calidad: "PET", grueso: 18, largo: 2800, ancho: 1220, eur_m2: 28.11, eur_m2_mas10: 19.68, eur_m2_paquete20: 18.13 },
  { grupo: 3, descripcion: "PET 539 HG BLANCO BRILLO/base dm", calidad: "PET", grueso: 18, largo: 2800, ancho: 1220, eur_m2: 28.11, eur_m2_mas10: 19.68, eur_m2_paquete20: 18.13 },
  { grupo: 3, descripcion: "PET 3259 SM KASMIR/base dm", calidad: "PET", grueso: 18, largo: 2800, ancho: 1220, eur_m2: 28.11, eur_m2_mas10: 19.68, eur_m2_paquete20: 18.13 },
  { grupo: 3, descripcion: "BLANCO 3091 BRILLO SBB", calidad: "HPL 1.0", grueso: 20, largo: 3050, ancho: 1300, eur_m2: 37.04, eur_m2_mas10: 25.93, eur_m2_paquete20: 23.89 },
  { grupo: 3, descripcion: "AMARO BLANCO SAB305", calidad: "HPL 1.0", grueso: 20.3, largo: 3050, ancho: 1300, eur_m2: 35.92, eur_m2_mas10: 25.14, eur_m2_paquete20: 23.17 },
  { grupo: 3, descripcion: "ROBLE ROYAL C003", calidad: "PORO REGISTRO", grueso: 19, largo: 3050, ancho: 2070, eur_m2: 42.21, eur_m2_mas10: null, eur_m2_paquete20: null },
  { grupo: 3, descripcion: "ROBLE KOFFEE C005", calidad: "PORO REGISTRO", grueso: 19, largo: 3050, ancho: 2070, eur_m2: 42.21, eur_m2_mas10: null, eur_m2_paquete20: null },
  { grupo: 6, descripcion: "BLANCO NIEVE SBN", calidad: "HPL 0,7", grueso: 20, largo: 3600, ancho: 1400, eur_m2: 57.42, eur_m2_mas10: 40.19, eur_m2_paquete20: 37.04 },
  { grupo: 6, descripcion: "ARTICO CRISTAL SAC", calidad: "LACADO BRI", grueso: 18, largo: 2750, ancho: 1220, eur_m2: 43.04, eur_m2_mas10: 30.13, eur_m2_paquete20: 27.76 },
  { grupo: 6, descripcion: "BLANCO CRISTAL SBCA", calidad: "LACADO BRI", grueso: 18, largo: 2750, ancho: 1220, eur_m2: 43.04, eur_m2_mas10: 30.13, eur_m2_paquete20: 27.76 },
  { grupo: 6, descripcion: "NEGRO CRISTAL SNC", calidad: "LACADO BRI", grueso: 18, largo: 2750, ancho: 1220, eur_m2: 43.04, eur_m2_mas10: 30.13, eur_m2_paquete20: 27.76 },
  { grupo: 6, descripcion: "ANTRACITA CRISTAL SGC", calidad: "LACADO BRI", grueso: 18, largo: 2750, ancho: 1220, eur_m2: 44.51, eur_m2_mas10: 31.16, eur_m2_paquete20: 28.71 },
  { grupo: 6, descripcion: "AZUL INDIGO CRISTAL SAIC", calidad: "LACADO BRI", grueso: 18, largo: 2750, ancho: 1220, eur_m2: 44.51, eur_m2_mas10: 31.16, eur_m2_paquete20: 28.71 },
  { grupo: 6, descripcion: "SUPERSOFT BLANCO SSB", calidad: "LACADO MAT", grueso: 18, largo: 2750, ancho: 1220, eur_m2: 46.7, eur_m2_mas10: 32.69, eur_m2_paquete20: 30.12 },
  { grupo: 6, descripcion: "SUPERSOFT CASHMERE SSC", calidad: "LACADO MAT", grueso: 18, largo: 2750, ancho: 1220, eur_m2: 46.7, eur_m2_mas10: 32.69, eur_m2_paquete20: 30.12 },
  { grupo: 6, descripcion: "SUPERSOFT AGAVE SSA", calidad: "LACADO MAT", grueso: 18, largo: 2750, ancho: 1220, eur_m2: 46.7, eur_m2_mas10: 32.69, eur_m2_paquete20: 30.12 },
  { grupo: 6, descripcion: "SUPERSOFT COTTO SSCO", calidad: "LACADO MAT", grueso: 18, largo: 2750, ancho: 1220, eur_m2: 46.7, eur_m2_mas10: 32.69, eur_m2_paquete20: 30.12 },
  { grupo: 7, descripcion: "ALEVE 4539", calidad: "HPL 0,9", grueso: 20, largo: 3050, ancho: 1300, eur_m2: 70.76, eur_m2_mas10: 49.53, eur_m2_paquete20: 45.64 },
  { grupo: 7, descripcion: "ALEVE 4573", calidad: "HPL 0,9", grueso: 20, largo: 3050, ancho: 1300, eur_m2: 70.76, eur_m2_mas10: 49.53, eur_m2_paquete20: 45.64 },
  { grupo: 7, descripcion: "ALEVE 4574", calidad: "HPL 0,9", grueso: 20, largo: 3050, ancho: 1300, eur_m2: 70.76, eur_m2_mas10: 49.53, eur_m2_paquete20: 45.64 },
  { grupo: 7, descripcion: "ALEVE 4611", calidad: "HPL 0,9", grueso: 20, largo: 3050, ancho: 1300, eur_m2: 70.76, eur_m2_mas10: 49.53, eur_m2_paquete20: 45.64 },
  { grupo: 7, descripcion: "ALEVE 4584 ROBLE WAFER", calidad: "HPL 0,9", grueso: 20, largo: 3050, ancho: 1300, eur_m2: 70.76, eur_m2_mas10: 49.53, eur_m2_paquete20: 45.64 },
  { grupo: 7, descripcion: "ALEVE 4625 NOGAL SINFONIA", calidad: "HPL 0,9", grueso: 20, largo: 3050, ancho: 1300, eur_m2: 70.76, eur_m2_mas10: 49.53, eur_m2_paquete20: 45.64 },
  { grupo: 7, descripcion: "ALEVE 4626 NOGAL EVOLO", calidad: "HPL 0,9", grueso: 20, largo: 3050, ancho: 1300, eur_m2: 70.76, eur_m2_mas10: 49.53, eur_m2_paquete20: 45.64 },
  { grupo: 7, descripcion: "ALEVE 4627 ROBLE WALDWEG", calidad: "HPL 0,9", grueso: 20, largo: 3050, ancho: 1300, eur_m2: 70.76, eur_m2_mas10: 49.53, eur_m2_paquete20: 45.64 },
  { grupo: 7, descripcion: "ALEVE 4631 ROBLE TAGES", calidad: "HPL 0,9", grueso: 20, largo: 3050, ancho: 1300, eur_m2: 70.76, eur_m2_mas10: 49.53, eur_m2_paquete20: 45.64 },
  { grupo: 7, descripcion: "GRAFITO METAL SGM", calidad: "LACADO MAT", grueso: 18, largo: 2750, ancho: 1220, eur_m2: 51.35, eur_m2_mas10: 35.95, eur_m2_paquete20: 33.12 },
  { grupo: 13, descripcion: "SUPERSOFT METAL PLUS CHAMPAGNE", calidad: "LACADO MAT", grueso: 18, largo: 2750, ancho: 1220, eur_m2: 60.84, eur_m2_mas10: 42.59, eur_m2_paquete20: 39.24 },
  { grupo: 13, descripcion: "FENIX BLANCO ALASKA 0030 SFBA", calidad: "FENIX HPL", grueso: 20, largo: 3050, ancho: 1300, eur_m2: 93.18, eur_m2_mas10: 65.23, eur_m2_paquete20: 60.1 },
  { grupo: 13, descripcion: "FENIX GRIS LONDRA 0718 SFL", calidad: "FENIX HPL", grueso: 20, largo: 3050, ancho: 1300, eur_m2: 93.18, eur_m2_mas10: 65.23, eur_m2_paquete20: 60.1 },
  { grupo: 13, descripcion: "FENIX STROMBOLI 0768 SFS", calidad: "FENIX HPL", grueso: 20, largo: 3050, ancho: 1300, eur_m2: 93.18, eur_m2_mas10: 65.23, eur_m2_paquete20: 60.1 },
  { grupo: 13, descripcion: "FENIX GRIS EFESO 0725 SFG", calidad: "FENIX HPL", grueso: 20, largo: 3050, ancho: 1300, eur_m2: 93.18, eur_m2_mas10: 65.23, eur_m2_paquete20: 60.1 },
  { grupo: 13, descripcion: "FENIX VERDE COMODORO 0750 SFV", calidad: "FENIX HPL", grueso: 20, largo: 3050, ancho: 1300, eur_m2: 93.18, eur_m2_mas10: 65.23, eur_m2_paquete20: 60.1 },
  { grupo: 13, descripcion: "FENIX NEGRO 0720 SFN", calidad: "FENIX HPL", grueso: 20, largo: 3050, ancho: 1300, eur_m2: 93.18, eur_m2_mas10: 65.23, eur_m2_paquete20: 60.1 },
  { grupo: 13, descripcion: "FENIX BLANCO KOS 0032 SFB", calidad: "FENIX HPL", grueso: 20, largo: 3050, ancho: 1300, eur_m2: 93.18, eur_m2_mas10: 65.23, eur_m2_paquete20: 60.1 },
  { grupo: null, descripcion: "KER BLOOM VARIOS", calidad: "HPL 0,7", grueso: 20, largo: 3050, ancho: 1300, eur_m2: 70.76, eur_m2_mas10: 49.53, eur_m2_paquete20: 45.64 },
  { grupo: null, descripcion: "FENIX VARIOS", calidad: "FENIX HPL", grueso: 20, largo: 3050, ancho: 1300, eur_m2: 93.18, eur_m2_mas10: 65.23, eur_m2_paquete20: 60.1 },
  { grupo: null, descripcion: "ALEVE VARIOS", calidad: "HPL 0,9", grueso: 20, largo: 3050, ancho: 1300, eur_m2: 70.76, eur_m2_mas10: 49.53, eur_m2_paquete20: 45.64 },
];
/** Qué grupo de puerta corresponde a cada línea (grueso en mm). */
export const SERVICIO_COCINA: { grupo: number; linea: string; acabado: '4 cantos' | 'uñero'; grueso: string }[] = [
  { grupo: 3, linea: "SYNCRON", acabado: '4 cantos', grueso: '18' },
  { grupo: 7, linea: "FINGERPULL SYNCRON", acabado: 'uñero', grueso: '22' },
  { grupo: 6, linea: "PET", acabado: '4 cantos', grueso: '19-22' },
  { grupo: 12, linea: "PET", acabado: 'uñero', grueso: '22' },
  { grupo: 6, linea: "LUXE / ZENIT", acabado: '4 cantos', grueso: '18' },
  { grupo: 12, linea: "FINGERPULL LUXE / ZENIT", acabado: 'uñero', grueso: '22' },
  { grupo: 14, linea: "PET / SYNCRON PREMIUM", acabado: 'uñero', grueso: '22' },
  { grupo: 10, linea: "COSTADOS PET PREMIUM", acabado: '4 cantos', grueso: '18-22' },
  { grupo: 7, linea: "COSTADOS SYNCRON PREMIUM", acabado: '4 cantos', grueso: '22' },
];

// ── p4–6 · Puertas: € por alto (cm) × ancho (cm) y grupo ──────────────
// No hay ancho 80 en el PDF; alto 10 solo en 60 / 70 / 90; grupos 12 y 14
// (uñero) sin precio a 270. null = sin precio.
export const ALTOS_PUERTA = [10, 14, 17.5, 28, 35, 45, 56, 70, 80, 90, 110, 130, 160, 200, 240, 270];
export const ANCHOS_PUERTA = [30, 35, 40, 45, 50, 60, 70, 90];
export const GRUPOS_PUERTA = [1, 3, 6, 7, 13, 10, 12, 14] as const;
export const GRUPOS_UNERO = [12, 14];
export const PUERTAS_COCINA: Record<number, (number | null)[][]> = {
  1: [
    [null, null, null, null, null, 15.16, 15.98, 16.74],   // 10
    [12.73, 13.14, 13.54, 13.94, 14.35, 15.16, 15.98, 16.74],   // 14
    [13.48, 13.97, 14.41, 14.87, 15.35, 16.28, 17.2, 18.62],   // 17,5
    [15, 15.51, 16.44, 17.03, 17.59, 18.65, 19.69, 21.77],   // 28
    [17.96, 19.37, 19.74, 20.89, 21.86, 23.24, 24.9, 27.32],   // 35
    [18.7, 19.89, 20.92, 21.54, 23.51, 25.09, 26.65, 31.26],   // 45
    [20.31, 21.18, 22.51, 23.56, 24.24, 25.63, 29.73, 34.94],   // 56
    [23.56, 24.9, 25.63, 26.65, 27.68, 29.72, 31.79, 38.75],   // 70
    [24.83, 25.95, 27.1, 29.71, 30.71, 31.59, 36.83, 42.75],   // 80
    [26.11, 27.32, 29.76, 31.26, 31.71, 34.94, 38.87, 48.25],   // 90
    [29.38, 31.55, 33.58, 35.89, 37.67, 41.63, 45.78, 55.75],   // 110
    [32.65, 35.78, 37.39, 40.5, 43.61, 48.33, 52.68, 63.24],   // 130
    [43.24, 47.43, 50.86, 55.04, 58.19, 63.84, 70.04, 82.31],   // 160
    [53.8, 59.06, 64.33, 69.57, 72.76, 79.35, 87.39, 101.4],   // 200
    [60.52, 64.07, 68.05, 76.31, 81.56, 91.19, 98.09, 116.45],   // 240
    [66.55, 70.46, 74.86, 83.93, 89.71, 100.31, 107.89, 128.1],   // 270
  ],
  3: [
    [null, null, null, null, null, 15.01, 16.48, 18.43],   // 10
    [11.63, 12.25, 12.86, 13.3, 13.98, 15.01, 16.48, 18.43],   // 14
    [12.36, 13.07, 13.76, 14.47, 15.13, 19.41, 22.64, 25.86],   // 17,5
    [14.69, 15.7, 16.8, 17.85, 19.57, 21.72, 25.41, 28.36],   // 28
    [16.25, 17.51, 18.77, 20.05, 21.31, 23.87, 27.81, 31.47],   // 35
    [18.43, 20.05, 21.65, 23.25, 24.88, 28.04, 32.75, 37.63],   // 45
    [20.07, 21.95, 23.87, 25.77, 27.56, 31.4, 36.62, 42.78],   // 56
    [21.79, 23.96, 26.23, 28.38, 30.58, 35.09, 41.11, 48.3],   // 70
    [23.9, 26.41, 28.95, 31.47, 33.97, 42.69, 45.59, 53.93],   // 80
    [25.8, 28.61, 31.4, 34.2, 37.03, 42.69, 50.1, 59.58],   // 90
    [33.74, 37.81, 41.82, 45.87, 49.9, 57.93, 67.93, 82.17],   // 110
    [33.74, 37.81, 41.82, 45.87, 49.9, 57.93, 67.93, 82.17],   // 130
    [44.18, 50.26, 52.19, 57.11, 67.82, 82.74, 96.5, 104.53],   // 160
    [54.02, 68.57, 74.37, 90.18, 98.03, 104.23, 119.34, 129.46],   // 200
    [63.13, 75.85, 82.54, 129.14, 101.74, 113.78, 129.14, 151.68],   // 240
    [75.85, 82.54, 101.74, 113.78, 122.23, 129.14, 151.68, 161.3],   // 270
  ],
  6: [
    [null, null, null, null, null, 23.92, 25.64, 32.52],   // 10
    [14.42, 16.18, 17.85, 19.46, 21.13, 23.92, 27.01, 32.52],   // 14
    [16.39, 18.4, 20.3, 22.16, 23.96, 27.35, 31.79, 34.33],   // 17,5
    [20.51, 22.89, 25.25, 27.49, 29.66, 34.17, 36.35, 45.16],   // 28
    [24.58, 26.94, 29.69, 32.3, 34.88, 39.76, 47.22, 52.32],   // 35
    [28.54, 32.3, 34.86, 37.95, 40.88, 45.27, 50.26, 60.84],   // 45
    [33.14, 36.83, 40.6, 44.31, 47.88, 54.73, 58.8, 72.01],   // 56
    [37.42, 41.79, 45.98, 50.01, 53.88, 61.43, 67.66, 83.91],   // 70
    [39.41, 46.78, 49.58, 54.29, 61.46, 66.15, 74.21, 90.23],   // 80
    [46.24, 52.32, 55.78, 60.84, 65.71, 75.12, 80.77, 103.32],   // 90
    [62.53, 70.27, 77.84, 85.37, 92.65, 107, 115.06, 149.92],   // 110
    [62.53, 70.27, 77.82, 85.37, 92.65, 107, 115.06, 149.92],   // 130
    [84.14, 94.85, 105.54, 115.98, 126.39, 146.83, 157.89, 194.32],   // 160
    [94.85, 109.55, 113.89, 143.37, 157.89, 165.55, 180.82, 228.89],   // 200
    [107.74, 124.72, 135.11, 156.4, 163.43, 187.98, 197.25, 264.75],   // 240
    [124.72, 135.11, 156.08, 163.43, 187.98, 197.25, 228.7, 288.6],   // 270
  ],
  7: [
    [null, null, null, null, null, 19.56, 21.09, 24.33],   // 10
    [16.11, 17.07, 18.02, 18.96, 19.91, 21.82, 23.78, 27.49],   // 14
    [17.4, 18.51, 19.64, 20.76, 21.87, 24.09, 26.33, 30.8],   // 17,5
    [20.62, 22.13, 23.67, 25.2, 26.73, 29.8, 39.6, 38.98],   // 28
    [22.87, 24.69, 26.51, 28.31, 30.13, 33.78, 37.44, 44.71],   // 35
    [26.11, 28.29, 30.53, 32.78, 35.02, 39.47, 43.91, 52.84],   // 45
    [29.62, 32.31, 34.98, 37.69, 40.36, 45.73, 51.11, 61.84],   // 56
    [36.76, 40.02, 43.29, 46.53, 49.8, 92.95, 62.84, 75.89],   // 70
    [39.98, 43.67, 47.31, 48.89, 51, 62.02, 69.38, 84.07],   // 80
    [43.18, 47.29, 51.36, 55.47, 59.53, 67.71, 75.89, 92.22],   // 90
    [52.27, 59.04, 64.44, 69.89, 71.24, 86.15, 97, 118.69],   // 110
    [56.07, 61.8, 67.53, 73.27, 79, 92.71, 101.93, 124.87],   // 130
    [68.29, 75.6, 82.89, 90.2, 97.49, 112.11, 126.71, 155.91],   // 160
    [81.87, 90.69, 99.95, 109, 118.04, 136.11, 154.22, 190.38],   // 200
    [91.47, 101.73, 111.93, 122.29, 132.55, 153.11, 173.62, 214.69],   // 240
    [102.73, 114.44, 126.15, 137.87, 149.58, 173, 196.42, 266.73],   // 270
  ],
  13: [
    [null, null, null, null, null, 27.9, 29.67, 31.22],   // 10
    [22.53, 23.42, 24.3, 25.2, 26.09, 27.9, 29.67, 31.22],   // 14
    [24.64, 25.82, 25.83, 28.14, 29.3, 31.63, 33.97, 37.61],   // 17,5
    [26.77, 28.19, 29.63, 31.12, 32.52, 35.38, 38.27, 44.01],   // 28
    [33.98, 36.12, 38.01, 40.02, 42.02, 46.06, 50.08, 58.12],   // 35
    [37.55, 40.02, 42.48, 44.96, 47.42, 52.36, 57.3, 67.17],   // 45
    [41.48, 44.44, 47.41, 50.38, 53.35, 59.3, 68.13, 82.79],   // 56
    [46.46, 50.08, 53.68, 57.29, 60.91, 68.13, 75.36, 92.46],   // 70
    [50.03, 54.1, 58.16, 62.23, 66.3, 74.44, 82.57, 99.43],   // 80
    [53.59, 58.12, 62.63, 67.17, 71.7, 82.78, 89.8, 113.85],   // 90
    [61.26, 67.78, 74.24, 80.62, 86.91, 100.34, 108.31, 139.54],   // 110
    [68.92, 77.44, 85.83, 94.06, 102.11, 117.9, 126.8, 165.23],   // 130
    [86.76, 99.09, 105.69, 126.04, 138.06, 150.17, 163.03, 209.11],   // 160
    [104.57, 120.74, 125.53, 158, 173.99, 182.45, 199.28, 253],   // 200
    [118.71, 137.45, 144.24, 172.35, 180.13, 207.14, 217.39, 291.78],   // 240
    [130.58, 151.17, 163.76, 189.57, 198.15, 227.84, 239.12, 320.94],   // 270
  ],
  10: [
    [null, null, null, null, null, 17.96, 19.61, 22.89],   // 10
    [14.69, 15.77, 16.83, 17.91, 18.97, 21.12, 23.26, 27.55],   // 14
    [16.35, 17.67, 18.99, 20.31, 21.63, 24.27, 26.92, 33.55],   // 17,5
    [20.47, 22.42, 24.36, 26.31, 28.25, 32.14, 36.04, 43.82],   // 28
    [23.36, 25.75, 29.3, 30.52, 32.9, 37.67, 44.2, 51.97],   // 35
    [27.9, 30.5, 33.5, 36.52, 39.52, 45.54, 51.55, 63.59],   // 45
    [32.04, 35.73, 39.43, 43.12, 46.81, 54.2, 61.6, 76.38],   // 56
    [39.98, 44.56, 49.13, 53.69, 58.27, 67.41, 76.54, 94.83],   // 70
    [44.12, 49.31, 54.51, 59.7, 64.9, 75.28, 85.67, 106.45],   // 80
    [48.25, 54.07, 59.89, 65.7, 71.52, 83.16, 94.8, 118.07],   // 90
    [61.62, 69.47, 77.31, 85.15, 93, 108.69, 124.38, 156.01],   // 110
    [64.76, 73.08, 81.41, 89.71, 98.04, 114.67, 131.31, 164.59],   // 130
    [80.45, 91.14, 101.83, 112.53, 123.22, 144.6, 165.99, 208.76],   // 160
    [97.87, 111.21, 124.54, 137.87, 151.19, 177.85, 204.5, 257.83],   // 200
    [110.18, 125.37, 140.56, 156.02, 170.94, 201.32, 231.71, 292.47],   // 240
    [124.63, 142, 159.39, 176.76, 194.15, 228.9, 263.65, 333.16],   // 270
  ],
  12: [
    [null, null, null, null, null, 40.88, 45.48, 54.63],   // 10
    [29.51, 31.38, 33.1, 34.79, 36.26, 40.88, 45.48, 54.63],   // 14
    [32.22, 34.32, 36.4, 38.15, 39.96, 45.17, 51.51, 58.59],   // 17,5
    [36.57, 39.66, 42.61, 45.61, 48.48, 54.43, 61.82, 72.11],   // 28
    [40.68, 43.8, 46.99, 50.2, 53.39, 59.62, 67.63, 78.61],   // 35
    [41.83, 45.26, 48.76, 52.15, 55.61, 62.51, 71.04, 83.04],   // 45
    [43.07, 46.8, 50.56, 55.61, 58.05, 65.59, 74.58, 87.17],   // 56
    [46.93, 50.69, 54.46, 57.98, 62.12, 70.24, 87.25, 106.35],   // 70
    [56.92, 62.64, 67.46, 72.36, 77.3, 87.04, 110.27, 129.62],   // 80
    [58.43, 63.34, 68.16, 73.02, 78, 87.73, 111.73, 131.37],   // 90
    [71.22, 78.2, 83.45, 88.72, 97.99, 109.77, 139.8, 164.36],   // 110
    [79.74, 88.11, 93.69, 101.38, 111.81, 124.48, 158.52, 186.37],   // 130
    [126.09, 132.73, 145.2, 157.57, 169.98, 194.89, 248.18, 280.72],   // 160
    [126.09, 132.73, 145.2, 157.57, 169.98, 194.89, 248.18, 280.72],   // 200
    [160.73, 169.17, 185.03, 200.83, 216.66, 248.84, 316.86, 344.48],   // 240
    [null, null, null, null, null, null, null, null],   // 270
  ],
  14: [
    [null, null, null, null, null, 38.84, 42.46, 52.26],   // 10
    [25.34, 27.61, 29.84, 32.1, 34.34, 38.84, 42.46, 52.26],   // 14
    [25.34, 27.61, 29.84, 32.1, 34.34, 38.84, 42.46, 52.26],   // 17,5
    [34.85, 38.5, 42.18, 40.74, 49.6, 56.91, 64.28, 78.94],   // 28
    [34.85, 38.5, 42.18, 40.74, 49.6, 56.91, 64.28, 78.94],   // 35
    [41.81, 46.46, 51.19, 55.87, 60.6, 69.95, 79.34, 98.12],   // 45
    [41.81, 46.46, 51.19, 55.87, 60.6, 69.95, 79.34, 98.12],   // 56
    [46.65, 52.05, 57.48, 62.94, 68.37, 79.24, 90.09, 111.83],   // 70
    [51.15, 57.25, 63.35, 69.76, 75.63, 87.83, 100.06, 124.55],   // 80
    [55.79, 62.57, 69.41, 76.22, 83.06, 96.68, 110.33, 137.63],   // 90
    [73.43, 82.91, 92.39, 101.93, 111.41, 130.38, 149.4, 187.33],   // 110
    [73.43, 82.91, 92.39, 101.93, 111.41, 130.38, 149.4, 187.33],   // 130
    [168.86, 168.86, 168.86, 210.62, 210.62, 210.62, 219.1, 229.4],   // 160
    [168.86, 168.86, 168.86, 210.62, 210.62, 210.62, 219.1, 229.4],   // 200
    [190.9, 190.9, 190.9, 238.82, 238.82, 238.82, 262.69, 262.69],   // 240
    [null, null, null, null, null, null, null, null],   // 270
  ],
};

/** Dudas de la transcripción: valores tal cual del PDF, pendientes de que Joan los confirme. */
export const REVISAR_COCINA: string[] = [
  'Módulos: en las filas con dos medidas (70 y 80 de alto), las columnas «Gris plomo 16» y «Blanco Plus 18 hidrófugo» se han asignado al alto de la 2.ª medida (80, «Novedad»); en las filas con una medida, a esa medida. Revisar.',
  'Columna univ.: la fila 230 x 60 trae Gris plomo 122,47 y Blanco Plus 140,7 junto a la medida 230 x 40, pero la última fila (230 x 40) da Gris plomo 98,22. Revisar a qué medida va cada precio.',
  'Columna H+M: sin medida en el PDF; solo Blanco Plus 140,70. Revisar medida.',
  'Columna univ. 230 x 60 Blanco 16 (82,46) es más barata que 220 x 60 (106,34). Revisar.',
  'Laterales: el Blanco Plus viene a 244 x 58 y 244 x 33 (no 366).',
  'Puertas G7: 70 x 60 = 92,95 (más que 70 x 70 = 62,84 y 80 x 60 = 62,02); 28 x 70 = 39,60 > 28 x 90 = 38,98 y > 35 x 70 = 37,44. Revisar.',
  'Puertas G3: 240 x 45 = 129,14 (más que 240 x 50 = 101,74 y 270 x 45 = 113,78). Revisar.',
  'Puertas G14: 28 x 45 y 35 x 45 = 40,74, menos que 28 x 40 / 35 x 40 = 42,18. Revisar.',
  'Puertas G6: 130 x 40 = 77,82 y 110 x 40 = 77,84 (casi iguales, el más alto más barato). Revisar.',
  'Tableros: grupo 1 (melamina catálogo Virrey) sin precio; «Ker Bloom / Fenix / Aleve varios» sin grupo.'
];
