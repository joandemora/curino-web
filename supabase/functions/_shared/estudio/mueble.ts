// supabase/functions/_shared/estudio/mueble.ts
//
// Estudio Curino · tercer tipo de diseño: MUEBLE A MEDIDA (aparadores,
// vitrinas, muebles de salón y comedor), además de armarios y cocinas.
//
// - Cuerpos en fila, cada uno con su ancho, y montantes entre ellos (y en los
//   extremos) de `montante` cm. Ancho total = cuerpos + montantes.
// - Cada cuerpo, en zonas de ABAJO ARRIBA con su altura: «puertas» (lisas, en
//   arco con radio, vitrina con cristal; agarre push / tirador / uñero),
//   «abierta» (hueco con fondo de espejo, madera o lacado) o «cajones» (alto de
//   cada uno, agarre, cubertero). Cualquier zona lleva interior: estantes (con
//   grosor), estantes de vidrio, cajones interiores, baldas extraíbles,
//   cuberteros, LED.
// - Zócalo, encimera o tapa superior, costados vistos, fondo. Alto total =
//   zócalo + zonas + tapa.
// - Materiales solo si los dice el usuario o el plano; si no, «a definir».
//
// Precio: elementosMueble() lo pasa a los mismos cuerpos y elementos que el
// presupuesto directo desde un plano (plano.ts) y se calcula con puntosMueble:
// el desglose es el mismo por construcción.

import { puntosMueble, type CuerpoPlano, type ElementoPlano, type MueblePlano } from './plano.ts';
import { type Mueble, type ZonaMueble, anchoMueble, altoMueble, nombreCuerpo, cmTxt } from './mueble-esquema.ts';
export * from './mueble-esquema.ts';
import { puntosLinea, type LineaDesglose } from './tarifa.ts';
import type { Partida } from './presupuesto.ts';

// ── Precio: a los mismos cuerpos y elementos que el presupuesto desde plano ──
const etiquetaDe = (z: ZonaMueble, re: RegExp) => z.interior?.etiquetas?.find((e) => re.test(e)) ?? null;
export function elementosMueble(m: Mueble): MueblePlano {
  const alto = altoMueble(m);
  const cuerpos: CuerpoPlano[] = m.cuerpos.map((c, i) => {
    const el: ElementoPlano[] = [];
    for (const z of c.zonas) {
      const p = z.puertas;
      if (z.tipo === 'puertas' && p) el.push({ tipo: 'puerta', cantidad: p.n, ancho: Math.round((c.ancho / p.n) * 100) / 100, alto: z.alto, apertura: p.apertura ?? 'abatible', arco: !!p.arco, vitrina: !!p.vitrina,
        push: p.agarre === 'push', tirador: p.agarre === 'tirador', unero: p.agarre === 'unero', ninguno: p.agarre === 'ninguno', material: p.material ?? null, seguro: true });
      if (z.tipo === 'cajones' && z.cajones) {
        el.push({ tipo: 'cajon', cantidad: z.cajones.alturas.length, detalle: z.cajones.etiqueta ?? null, push: z.cajones.agarre === 'push', tirador: z.cajones.agarre === 'tirador', unero: z.cajones.agarre === 'unero', seguro: true });
        if (z.cajones.cubertero) el.push({ tipo: 'cubertero', cantidad: z.cajones.cubertero, seguro: true });
      }
      if (z.tipo === 'abierta' && z.fondo === 'espejo') el.push({ tipo: 'fondo_espejo', cantidad: 1, ancho: c.ancho, alto: z.alto, detalle: 'Fondo de espejo', seguro: true });
      const it = z.interior;
      if (!it) continue;
      if (it.estantes) el.push({ tipo: 'estante', cantidad: it.estantes, grosor: it.grosor_estantes ?? null, detalle: etiquetaDe(z, /estante/i), seguro: true });
      if (it.estantes_vidrio) el.push({ tipo: 'estante_vidrio', cantidad: it.estantes_vidrio, seguro: true });
      if (it.cajones) el.push({ tipo: 'cajon', cantidad: it.cajones, detalle: etiquetaDe(z, /caj[oó]n/i), seguro: true });
      if (it.baldas_extraibles) el.push({ tipo: 'balda_extraible', cantidad: it.baldas_extraibles, detalle: etiquetaDe(z, /balda/i), seguro: true });
      if (it.cuberteros) el.push({ tipo: 'cubertero', cantidad: it.cuberteros, detalle: etiquetaDe(z, /cubert/i), seguro: true });
      if (it.led) el.push({ tipo: 'iluminacion', cantidad: 1, ancho: c.ancho, seguro: true });
    }
    if (i === 0 && m.zocalo) el.push({ tipo: 'zocalo', cantidad: 1, ancho: anchoMueble(m), seguro: true });
    return { nombre: nombreCuerpo(m, i), ancho: c.ancho, alto, fondo: m.fondo, elementos: el, seguro: true };
  });
  if (m.costados_vistos) cuerpos[0].elementos.push({ tipo: 'costado', cantidad: m.costados_vistos, seguro: true });
  if (m.tapa) cuerpos[0].elementos.push({ tipo: 'otro', cantidad: 1, detalle: `${m.tapa.tipo === 'encimera' ? 'Encimera' : 'Tapa superior'} ${cmTxt(m.tapa.grosor)} cm · ${cmTxt(anchoMueble(m))} × ${cmTxt(m.fondo)}`, seguro: true });
  return { nombre: m.titulo, vistas: [], ancho: anchoMueble(m), alto, fondo: m.fondo, medidas_seguras: true, materiales: m.materiales ?? {}, cuerpos, revisar: [] };
}

/** Partida del presupuesto para un mueble del diseño (dibujo debajo; desglose igual que desde plano). */
export function partidaMueble(m: Mueble, o: { version: number; puntos: Record<string, number>; precioPunto: number | null; dto: number }): Partida {
  const mp = elementosMueble(m), pp = typeof o.precioPunto === 'number' && o.precioPunto > 0 ? o.precioPunto : null;
  const pm = puntosMueble(mp, o.puntos);
  const desglose: LineaDesglose[] = pm.cuerpos.flatMap((c) => c.lineas.map((l) => {
    const pts = puntosLinea(l.puntos, l.cantidad);
    return { clave: l.clave, nombre: `${c.nombre} · ${l.nombre}`, cantidad: l.cantidad, unidad: 'ud' as const, precio: pp === null ? null : Math.round(l.puntos * pp * 100) / 100, importe: pp === null ? null : Math.round(pts * pp * 100) / 100, puntos: l.puntos, puntos_linea: pts, aviso: l.aviso };
  }));
  const total = pm.cuerpos.reduce((s, c) => s + c.puntos, 0);
  const mm = (v: number) => String(Math.round(v * 100) / 10).replace('.', ',');
  const zonaTxt = (z: ZonaMueble) => {
    const p = z.puertas, it = z.interior;
    const base = z.tipo === 'puertas' && p ? `${p.n} ${p.n === 1 ? 'puerta' : 'puertas'}${p.vitrina ? ' vitrina' : ''}${p.arco ? ' en arco' : ''}${p.apertura === 'corredera' ? ' correderas' : ''}${p.agarre === 'push' ? ' (push)' : p.agarre === 'unero' ? ' (uñero)' : ''}`
      : z.tipo === 'cajones' && z.cajones ? `${z.cajones.alturas.length} cajones${z.cajones.cubertero ? ' con cubertero' : ''}` : `hueco abierto${z.fondo ? ` con fondo de ${z.fondo}` : ''}`;
    const pl = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
    const dentro = it ? [it.estantes ? `${pl(it.estantes, 'estante', 'estantes')}${it.grosor_estantes ? ` de ${Math.round(it.grosor_estantes * 10)} mm` : ''}` : '', it.estantes_vidrio ? pl(it.estantes_vidrio, 'estante de vidrio', 'estantes de vidrio') : '', it.cajones ? pl(it.cajones, 'cajón interior', 'cajones interiores') : '', it.baldas_extraibles ? pl(it.baldas_extraibles, 'balda extraíble', 'baldas extraíbles') : '', it.cuberteros ? pl(it.cuberteros, 'cubertero', 'cuberteros') : '', it.led ? 'iluminación LED' : ''].filter(Boolean) : [];
    return `${base} (${cmTxt(z.alto)} cm)${dentro.length ? ': ' + dentro.join(', ') : ''}`;
  };
  const tecnico = [
    `Medidas: ${mm(anchoMueble(m))} x ${mm(altoMueble(m))} x ${mm(m.fondo)} mm`,
    `Distribución: ${m.cuerpos.map((c, i) => `${nombreCuerpo(m, i).toLowerCase()} de ${mm(c.ancho)} mm`).join(' + ')}${m.montante ? ` · montantes de ${mm(m.montante)} mm` : ''}`,
    ...m.cuerpos.map((c, i) => `${nombreCuerpo(m, i)} – ${cmTxt(c.ancho)} cm: ${c.zonas.map(zonaTxt).join(' · ')}.`),
    m.zocalo ? `Zócalo ${cmTxt(m.zocalo)} cm` : '', m.tapa ? `${m.tapa.tipo === 'encimera' ? 'Encimera' : 'Tapa superior'} de ${mm(m.tapa.grosor)} mm` : ''
  ].filter(Boolean).join('\n');
  const mat = m.materiales ?? {}, def = (v?: string) => (v && v.trim()) || 'a definir';
  const supuesta = m.cuerpos.some((c) => c.zonas.some((z) => z.tipo === 'puertas' && z.puertas && !z.puertas.vitrina && !z.puertas.material));
  const materiales = [`Interior: ${def(mat.interior)}`, `Exterior: ${mat.exterior?.trim() || (supuesta ? 'puertas lisas lacadas (supuesto)' : 'a definir')}`, mat.encimera || m.tapa?.material ? `Encimera: ${mat.encimera || m.tapa?.material}` : '', 'Herrajes: a definir', mat.otros ? `Otros: ${mat.otros}` : '', m.notas?.trim() ? `Notas del diseño: ${m.notas.trim()}` : ''].filter(Boolean).join('\n');
  return {
    codigo: m.codigo, version: o.version, clave: `v${o.version}:${m.codigo}`, tipo: 'mueble', dibujo: m.codigo, cantidad: 1,
    titulo: `${m.codigo} ${m.titulo}`.toUpperCase(), subtitulo: `${m.titulo.charAt(0).toUpperCase()}${m.titulo.slice(1).toLowerCase()} a medida de ${cmTxt(anchoMueble(m))} cm`, intro: '',
    tecnico, materiales, precio: pp === null ? null : Math.round(desglose.reduce((s, l) => s + (l.importe ?? 0), 0) * 100) / 100, precio_manual: false,
    dto_pct: o.dto, desglose, pendientes: pp === null ? ['Precio del punto'] : [], puntos: total, avisos: pm.avisos,
    cuerpos_puntos: pm.cuerpos.map((c) => ({ nombre: c.nombre, puntos: c.puntos }))
  };
}
