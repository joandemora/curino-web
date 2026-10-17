// supabase/functions/_shared/estudio/mueble-esquema.ts
//
// Estudio Curino · MUEBLE A MEDIDA: tipos, esquema JSON para Claude y
// validación (sin dependencias de la tarifa, para que esquema.ts lo importe
// sin ciclos). El precio está en mueble.ts y el dibujo en mueble-alzado.ts.

export type AgarreMueble = 'push' | 'tirador' | 'unero' | 'ninguno';
export interface PuertasZona { n: number; arco?: boolean; radio?: number; vitrina?: boolean; agarre?: AgarreMueble; apertura?: 'abatible' | 'corredera'; material?: string }
export interface CajonesZona { alturas: number[]; agarre?: AgarreMueble; cubertero?: number; etiqueta?: string }
export interface InteriorZona {
  estantes?: number; grosor_estantes?: number; estantes_vidrio?: number; cajones?: number; baldas_extraibles?: number; cuberteros?: number; led?: boolean;
  etiquetas?: string[];          // rótulos del plano («Cajón servilletas», «Estantes para vajilla»)
}
export interface ZonaMueble {
  alto: number; tipo: 'puertas' | 'abierta' | 'cajones';
  puertas?: PuertasZona; cajones?: CajonesZona; fondo?: 'espejo' | 'madera' | 'lacado'; interior?: InteriorZona;
}
export interface CuerpoMueble { ancho: number; nombre?: string; zonas: ZonaMueble[] }
export interface Mueble {
  codigo: string; titulo: string; notas?: string; vistas?: ('lateral' | 'planta')[];
  fondo: number; montante?: number; zocalo?: number; tapa?: { tipo: 'tapa' | 'encimera'; grosor: number; material?: string };
  costados_vistos?: number; materiales?: { interior?: string; exterior?: string; encimera?: string; otros?: string };
  cuerpos: CuerpoMueble[];
}

export const MONTANTE_DEF = 1.9;
export const montanteDe = (m: Mueble) => m.montante ?? MONTANTE_DEF;
export const anchoMueble = (m: Mueble) => Math.round((m.cuerpos.reduce((s, c) => s + c.ancho, 0) + (m.cuerpos.length + 1) * montanteDe(m)) * 100) / 100;
export const altoCuerpo = (c: CuerpoMueble) => c.zonas.reduce((s, z) => s + z.alto, 0);
export const altoMueble = (m: Mueble) => Math.round(((m.zocalo ?? 0) + Math.max(...m.cuerpos.map(altoCuerpo)) + (m.tapa?.grosor ?? 0)) * 100) / 100;
export const cmTxt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');
export const nombreCuerpo = (m: Mueble, i: number) => m.cuerpos[i].nombre
  || (m.cuerpos.length === 1 ? 'Cuerpo' : m.cuerpos.length === 2 ? ['Cuerpo izquierdo', 'Cuerpo derecho'][i] : m.cuerpos.length === 3 ? ['Cuerpo izquierdo', 'Cuerpo central', 'Cuerpo derecho'][i] : `Cuerpo ${i + 1}`);

// ── Esquema para Claude ─────────────────────────────────────────────
const num = (min: number, max: number, d: string) => ({ type: 'number', minimum: min, maximum: max, description: d });
const agarre = { enum: ['push', 'tirador', 'unero', 'ninguno'], description: 'push («apertura push»), tirador, unero o ninguno. Omitir si no se dice.' };
const interior = {
  type: 'object', additionalProperties: false, description: 'Lo que hay dentro de la zona.',
  properties: {
    estantes: { type: 'integer', minimum: 1, maximum: 12 }, grosor_estantes: num(1, 6, 'cm, solo si lo dicen o se acota (p. ej. 3).'),
    estantes_vidrio: { type: 'integer', minimum: 1, maximum: 12 }, cajones: { type: 'integer', minimum: 1, maximum: 8, description: 'Cajones interiores (detrás de las puertas).' },
    baldas_extraibles: { type: 'integer', minimum: 1, maximum: 8 }, cuberteros: { type: 'integer', minimum: 1, maximum: 6 }, led: { type: 'boolean' },
    etiquetas: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 6, description: 'Rótulos tal cual («Cajón servilletas», «Balda extraíble manteles»).' }
  }
};
export const ESQUEMA_MUEBLE_JSON = {
  type: 'array', maxItems: 10,
  description: 'Muebles a medida (aparadores, vitrinas, muebles de salón y comedor) M.01, M.02… No los fuerces a armario.',
  items: {
    type: 'object', additionalProperties: false, required: ['codigo', 'titulo', 'fondo', 'cuerpos'],
    properties: {
      codigo: { type: 'string', pattern: '^M\\.\\d{2}$' }, titulo: { type: 'string', maxLength: 60, description: 'El nombre del plano o del usuario («MUEBLE COMEDOR C»).' },
      notas: { type: 'string', maxLength: 220 }, vistas: { type: 'array', uniqueItems: true, items: { enum: ['lateral', 'planta'] } },
      fondo: num(10, 120, 'Fondo total en cm.'), montante: num(1, 10, 'Grosor de los montantes entre cuerpos y en los extremos (cm). Omitir si no se dice (1,9).'),
      zocalo: num(0, 30, 'cm, si lo hay.'), costados_vistos: { type: 'integer', minimum: 1, maximum: 2 },
      tapa: { type: 'object', additionalProperties: false, required: ['tipo', 'grosor'], properties: { tipo: { enum: ['tapa', 'encimera'] }, grosor: num(1, 10, 'cm'), material: { type: 'string', maxLength: 80 } } },
      materiales: { type: 'object', additionalProperties: false, properties: { interior: { type: 'string', maxLength: 120 }, exterior: { type: 'string', maxLength: 120 }, encimera: { type: 'string', maxLength: 120 }, otros: { type: 'string', maxLength: 120 } }, description: 'Solo lo que digan el usuario o el plano, tal cual. Nunca inventes.' },
      cuerpos: {
        type: 'array', minItems: 1, maxItems: 10, description: 'De izquierda a derecha.',
        items: {
          type: 'object', additionalProperties: false, required: ['ancho', 'zonas'],
          properties: {
            ancho: num(10, 300, 'Ancho libre del cuerpo (entre montantes), cm.'), nombre: { type: 'string', maxLength: 40 },
            zonas: {
              type: 'array', minItems: 1, maxItems: 8, description: 'De ABAJO ARRIBA. La suma de altos + zócalo + tapa = alto del mueble.',
              items: {
                type: 'object', additionalProperties: false, required: ['alto', 'tipo'],
                properties: {
                  alto: num(5, 300, 'cm'), tipo: { enum: ['puertas', 'abierta', 'cajones'] },
                  puertas: { type: 'object', additionalProperties: false, required: ['n'], properties: { n: { type: 'integer', minimum: 1, maximum: 6 }, arco: { type: 'boolean' }, radio: num(5, 200, 'Radio del arco (cm), si se acota.'), vitrina: { type: 'boolean', description: 'Vitrina con cristal.' }, agarre, apertura: { enum: ['abatible', 'corredera'] }, material: { type: 'string', maxLength: 80, description: 'Solo si lo dicen.' } } },
                  cajones: { type: 'object', additionalProperties: false, required: ['alturas'], properties: { alturas: { type: 'array', items: num(5, 80, 'cm'), minItems: 1, maxItems: 8 }, agarre, cubertero: { type: 'integer', minimum: 1, maximum: 4 }, etiqueta: { type: 'string', maxLength: 40 } } },
                  fondo: { enum: ['espejo', 'madera', 'lacado'], description: 'Solo zona abierta.' },
                  interior
                }
              }
            }
          }
        }
      }
    }
  }
};

// ── Validación ──────────────────────────────────────────────────────
type Obj = Record<string, unknown>;
const esObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const esNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function validarMuebles(lista: unknown, err: (ruta: string, mensaje: string) => void): void {
  if (lista === undefined) return;
  if (!Array.isArray(lista)) return err('proyecto.muebles', 'debe ser una lista');
  if (lista.length > 10) err('proyecto.muebles', 'máximo 10');
  const codigos = new Set<string>();
  const campos = (o: Obj, ruta: string, ok: string[]) => { for (const k of Object.keys(o)) if (!ok.includes(k)) err(`${ruta}.${k}`, `campo desconocido «${k}»`); };
  const numero = (o: Obj, k: string, ruta: string, min: number, max: number, oblig = false) => {
    const v = o[k];
    if (v === undefined) { if (oblig) err(`${ruta}.${k}`, 'falta la medida'); return; }
    if (!esNum(v) || v < min || v > max) err(`${ruta}.${k}`, `debe ser un número entre ${min} y ${max}`);
  };
  const entero = (o: Obj, k: string, ruta: string, min: number, max: number) => { const v = o[k]; if (v !== undefined && (!Number.isInteger(v) || (v as number) < min || (v as number) > max)) err(`${ruta}.${k}`, `entero entre ${min} y ${max}`); };
  const opcion = (o: Obj, k: string, ruta: string, vals: readonly string[]) => { if (o[k] !== undefined && !vals.includes(o[k] as string)) err(`${ruta}.${k}`, `valor no válido; usa ${vals.join(' / ')}`); };
  const texto = (o: Obj, k: string, ruta: string, max: number) => { if (o[k] !== undefined && (typeof o[k] !== 'string' || (o[k] as string).length > max)) err(`${ruta}.${k}`, `texto de hasta ${max} caracteres`); };
  const AGARRES = ['push', 'tirador', 'unero', 'ninguno'];
  lista.forEach((m, im) => {
    const rm = `muebles[${im}]`;
    if (!esObj(m)) return err(rm, 'debe ser un objeto');
    campos(m, rm, ['codigo', 'titulo', 'notas', 'vistas', 'fondo', 'montante', 'zocalo', 'tapa', 'costados_vistos', 'materiales', 'cuerpos']);
    if (typeof m.codigo !== 'string' || !/^M\.\d{2}$/.test(m.codigo)) err(`${rm}.codigo`, 'formato M.01, M.02…');
    else if (codigos.has(m.codigo)) err(`${rm}.codigo`, `código repetido ${m.codigo}`); else codigos.add(m.codigo);
    if (typeof m.titulo !== 'string' || !m.titulo.trim()) err(`${rm}.titulo`, 'falta el texto');
    texto(m, 'titulo', rm, 60); texto(m, 'notas', rm, 220);
    if (m.vistas !== undefined && (!Array.isArray(m.vistas) || m.vistas.some((v) => v !== 'lateral' && v !== 'planta'))) err(`${rm}.vistas`, 'lista de lateral / planta');
    numero(m, 'fondo', rm, 10, 120, true); numero(m, 'montante', rm, 1, 10); numero(m, 'zocalo', rm, 0, 30); entero(m, 'costados_vistos', rm, 1, 2);
    if (m.tapa !== undefined) {
      if (!esObj(m.tapa)) err(`${rm}.tapa`, 'debe ser un objeto');
      else { campos(m.tapa, `${rm}.tapa`, ['tipo', 'grosor', 'material']); opcion(m.tapa, 'tipo', `${rm}.tapa`, ['tapa', 'encimera']); numero(m.tapa, 'grosor', `${rm}.tapa`, 1, 10, true); texto(m.tapa, 'material', `${rm}.tapa`, 80); }
    }
    if (m.materiales !== undefined) {
      if (!esObj(m.materiales)) err(`${rm}.materiales`, 'debe ser un objeto');
      else { campos(m.materiales, `${rm}.materiales`, ['interior', 'exterior', 'encimera', 'otros']); for (const k of ['interior', 'exterior', 'encimera', 'otros']) texto(m.materiales, k, `${rm}.materiales`, 120); }
    }
    if (!Array.isArray(m.cuerpos) || !m.cuerpos.length) return err(`${rm}.cuerpos`, 'falta la lista de cuerpos');
    if (m.cuerpos.length > 10) err(`${rm}.cuerpos`, 'máximo 10');
    const altos: number[] = [];
    m.cuerpos.forEach((c, ic) => {
      const rc = `${rm}.cuerpos[${ic}]`;
      if (!esObj(c)) return err(rc, 'debe ser un objeto');
      campos(c, rc, ['ancho', 'nombre', 'zonas']); numero(c, 'ancho', rc, 10, 300, true); texto(c, 'nombre', rc, 40);
      if (!Array.isArray(c.zonas) || !c.zonas.length) return err(`${rc}.zonas`, 'falta la lista de zonas (de abajo arriba)');
      let alto = 0;
      c.zonas.forEach((z, iz) => {
        const rz = `${rc}.zonas[${iz}]`;
        if (!esObj(z)) return err(rz, 'debe ser un objeto');
        campos(z, rz, ['alto', 'tipo', 'puertas', 'cajones', 'fondo', 'interior']);
        numero(z, 'alto', rz, 5, 300, true); if (esNum(z.alto)) alto += z.alto;
        opcion(z, 'tipo', rz, ['puertas', 'abierta', 'cajones']); opcion(z, 'fondo', rz, ['espejo', 'madera', 'lacado']);
        if (z.tipo === 'puertas') {
          if (!esObj(z.puertas)) err(`${rz}.puertas`, 'falta: número de puertas y su modelo');
          else { const rp = `${rz}.puertas`; campos(z.puertas, rp, ['n', 'arco', 'radio', 'vitrina', 'agarre', 'apertura', 'material']); entero(z.puertas, 'n', rp, 1, 6); if (z.puertas.n === undefined) err(`${rp}.n`, 'falta el número de puertas'); numero(z.puertas, 'radio', rp, 5, 200); opcion(z.puertas, 'agarre', rp, AGARRES); opcion(z.puertas, 'apertura', rp, ['abatible', 'corredera']); texto(z.puertas, 'material', rp, 80); }
        } else if (z.puertas !== undefined) err(`${rz}.puertas`, 'solo en zonas de tipo «puertas»');
        if (z.tipo === 'cajones') {
          if (!esObj(z.cajones) || !Array.isArray(z.cajones.alturas) || !z.cajones.alturas.length) err(`${rz}.cajones`, 'falta: alto de cada cajón');
          else {
            const rcj = `${rz}.cajones`; campos(z.cajones, rcj, ['alturas', 'agarre', 'cubertero', 'etiqueta']); opcion(z.cajones, 'agarre', rcj, AGARRES); entero(z.cajones, 'cubertero', rcj, 1, 4); texto(z.cajones, 'etiqueta', rcj, 40);
            const suma = (z.cajones.alturas as unknown[]).reduce((s: number, x) => s + (esNum(x) ? x : 0), 0);
            if (esNum(z.alto) && Math.abs(suma - z.alto) > 0.5) err(`${rcj}.alturas`, `los cajones suman ${suma} cm y la zona mide ${z.alto}`);
          }
        } else if (z.cajones !== undefined) err(`${rz}.cajones`, 'solo en zonas de tipo «cajones»');
        if (z.fondo !== undefined && z.tipo !== 'abierta') err(`${rz}.fondo`, 'solo en zonas abiertas');
        if (z.interior !== undefined) {
          if (!esObj(z.interior)) err(`${rz}.interior`, 'debe ser un objeto');
          else {
            const ri = `${rz}.interior`; const zi = z.interior;
            campos(zi, ri, ['estantes', 'grosor_estantes', 'estantes_vidrio', 'cajones', 'baldas_extraibles', 'cuberteros', 'led', 'etiquetas']);
            entero(zi, 'estantes', ri, 1, 12); numero(zi, 'grosor_estantes', ri, 1, 6); entero(zi, 'estantes_vidrio', ri, 1, 12); entero(zi, 'cajones', ri, 1, 8); entero(zi, 'baldas_extraibles', ri, 1, 8); entero(zi, 'cuberteros', ri, 1, 6);
            if (zi.etiquetas !== undefined && (!Array.isArray(zi.etiquetas) || zi.etiquetas.some((e) => typeof e !== 'string'))) err(`${ri}.etiquetas`, 'lista de textos');
          }
        }
      });
      altos.push(alto);
    });
    if (altos.length > 1 && Math.max(...altos) - Math.min(...altos) > 0.5) err(`${rm}.cuerpos`, `los cuerpos no miden lo mismo de alto (${altos.join(' / ')} cm): revisa las zonas`);
  });
}

