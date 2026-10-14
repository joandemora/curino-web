// supabase/functions/_shared/estudio/aceptados.ts
//
// Estudio Curino · varios presupuestos aceptados por proyecto y numeración
// (sin dependencias: se prueba en Node).
//
// - relevantes(): por proyecto, todos sus aceptados o, si no tiene ninguno, el
//   último modificado. Con un solo aceptado es lo mismo que la vista
//   estudio_presupuesto_principal, así que las métricas históricas no cambian.
// - agregado(): un «presupuesto» por proyecto para metricasProyecto(): estado
//   aceptado si hay alguno, importe y comisión = suma de los aceptados,
//   aceptado_at = el primero.
// - Numeración: «Z2606941-A», «-B»… «-Z», «-AA», «-AB»… Un número sin letra
//   cuenta como la A. La letra es la siguiente libre del proyecto.

// deno-lint-ignore no-explicit-any
type Any = any;

const porProyecto = (pres: Any[]) => {
  const m = new Map<string, Any[]>();
  for (const p of pres) m.set(p.proyecto_id, [...(m.get(p.proyecto_id) ?? []), p]);
  return m;
};
const ultimo = (ps: Any[]) => [...ps].sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))[0];

/** Por proyecto: sus aceptados o, si no hay, el último modificado. */
export function relevantes(pres: Any[]): Any[] {
  const out: Any[] = [];
  for (const ps of porProyecto(pres).values()) {
    const ac = ps.filter((p) => p.estado === 'aceptado');
    if (ac.length) out.push(...ac); else out.push(ultimo(ps));
  }
  return out;
}

/** Un presupuesto «resumen» por proyecto (para metricasProyecto). */
export function agregado(ps: Any[]): Any | null {
  if (!ps.length) return null;
  const ac = ps.filter((p) => p.estado === 'aceptado');
  if (!ac.length) return ultimo(ps);
  if (ac.length === 1) return ac[0];
  const suma = (k: string) => Math.round(ac.reduce((s, p) => s + Number(p[k] ?? 0), 0) * 100) / 100;
  const primero = [...ac].sort((a, b) => String(a.aceptado_at ?? '').localeCompare(String(b.aceptado_at ?? '')))[0];
  return {
    ...primero, estado: 'aceptado', importe: suma('importe'), pvp: suma('pvp'), comision_importe: suma('comision_importe'),
    aceptado_at: primero.aceptado_at, updated_at: ultimo(ac).updated_at, aceptados: ac.length
  };
}

/** Mapa proyecto → presupuesto resumen. */
export function agregadosPorProyecto(pres: Any[]): Map<string, Any> {
  const out = new Map<string, Any>();
  for (const [pid, ps] of porProyecto(pres)) out.set(pid, agregado(ps));
  return out;
}

// ── Numeración ──────────────────────────────────────────────────────
/**
 * «Z2606941-B» → { base: 'Z2606941', letra: 'B' }; sin letra → 'A'. Admite los
 * formatos del histórico: «Z2606922D» (sin guion), «Z2506953-1» y
 * «Z2506954 PAGO A CUENTA» (base Z2506954, letra A).
 */
export function partirNumero(n: string): { base: string; letra: string } {
  const t = String(n || '').trim();
  const z = t.match(/^([A-Z]*\d+)(?:-?([A-Z]{1,2}))?(?![A-Z0-9])/i);
  if (z) return { base: z[1], letra: (z[2] ?? 'A').toUpperCase() };
  const m = t.match(/^(.*\S)-([A-Z]{1,2})$/i);
  return m ? { base: m[1], letra: m[2].toUpperCase() } : { base: t, letra: 'A' };
}
const aIndice = (l: string) => l.length === 1 ? l.charCodeAt(0) - 64 : 26 * (l.charCodeAt(0) - 64) + (l.charCodeAt(1) - 64);
const aLetra = (i: number) => i <= 26 ? String.fromCharCode(64 + i) : String.fromCharCode(64 + Math.floor((i - 1) / 26)) + String.fromCharCode(65 + ((i - 1) % 26));

/** Siguiente letra libre: A…Z, AA, AB… (después de la más alta usada). */
export function siguienteLetra(usadas: string[]): string {
  const max = usadas.reduce((m, l) => Math.max(m, aIndice(l.toUpperCase())), 0);
  return aLetra(max + 1);
}

/** Número para un presupuesto nuevo del proyecto: misma base que los suyos y la siguiente letra; si no tiene, la base dada. */
export function numeroEnProyecto(numeros: string[], baseNueva: string): { numero: string; base: string; nuevaBase: boolean } {
  const conBase = numeros.map((n) => String(n || '').trim()).filter(Boolean).map(partirNumero);
  if (!conBase.length) return { numero: `${baseNueva}-A`, base: baseNueva, nuevaBase: true };
  // La base del proyecto: la del primero (los números se crean en orden)
  const base = conBase[0].base;
  const letras = conBase.filter((x) => x.base.toUpperCase() === base.toUpperCase()).map((x) => x.letra);
  return { numero: `${base}-${siguienteLetra(letras)}`, base, nuevaBase: false };
}

/** Siguiente número de la serie: «Z2606941» → «Z2606942» (conserva ceros y prefijo). */
export function incrementarSerie(s: string): string {
  const m = String(s || '').match(/^(.*?)(\d+)$/);
  if (!m) return s;
  return m[1] + String(Number(m[2]) + 1).padStart(m[2].length, '0');
}
