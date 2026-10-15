// supabase/functions/estudio-ia/papelera.ts
//
// Estudio Curino · papelera (30 días). Borrar un presupuesto, un diseño o un
// documento guarda la copia de sus filas (y de las que caen con él) en
// estudio_papelera, borra las filas y deja sus archivos en el almacenamiento.
// Restaurar vuelve a insertar las filas con los mismos ids. Lo caducado se
// purga (archivos + fila) al listar la papelera o al mandar algo a ella.

// deno-lint-ignore no-explicit-any
type Any = any;

/** Orden de restauración (los padres antes que los hijos). */
const ORDEN = ['estudio_disenos', 'estudio_versiones', 'estudio_mensajes', 'estudio_archivos', 'estudio_presupuestos', 'estudio_ficheros', 'estudio_documentos', 'estudio_cobros'];
export const DIAS_PAPELERA = 30;

export interface EntradaPapelera {
  tipo: 'presupuesto' | 'diseno' | 'documento' | 'fichero';
  user_id: string; proyecto_id: string | null; nombre: string; borrado_por: string;
  filas: Record<string, Any[]>; enlaces?: Record<string, Any>; paths: (string | null | undefined)[];
}

export async function aPapelera(supa: Any, e: EntradaPapelera): Promise<void> {
  const { error } = await supa.from('estudio_papelera').insert({
    tipo: e.tipo, user_id: e.user_id, proyecto_id: e.proyecto_id, nombre: e.nombre.slice(0, 200), borrado_por: e.borrado_por,
    filas: e.filas, enlaces: e.enlaces ?? {}, paths: [...new Set(e.paths.filter(Boolean))]
  });
  if (error) throw error;
  await purgar(supa, e.user_id).catch((err) => console.error('estudio: purgar papelera', err));
}

/** Borra definitivamente lo caducado (archivos y fila) de un usuario o de todos. */
export async function purgar(supa: Any, userId?: string): Promise<number> {
  let q = supa.from('estudio_papelera').select('id, paths').lt('caduca_at', new Date().toISOString()).limit(200);
  if (userId) q = q.eq('user_id', userId);
  const { data } = await q;
  for (const f of data ?? []) {
    const paths: string[] = f.paths ?? [];
    for (let i = 0; i < paths.length; i += 100) await supa.storage.from('estudio').remove(paths.slice(i, i + 100));
    await supa.from('estudio_papelera').delete().eq('id', f.id);
  }
  return (data ?? []).length;
}

/** Vuelve a insertar las filas guardadas y quita la entrada de la papelera. */
export async function restaurar(supa: Any, entrada: Any): Promise<void> {
  const filas = entrada.filas ?? {};
  const hechas: { tabla: string; ids: string[] }[] = [];
  try {
    for (const tabla of ORDEN) {
      const rows = filas[tabla];
      if (!rows?.length) continue;
      const { error } = await supa.from(tabla).insert(rows);
      if (error) throw new Error(mensajeConflicto(tabla, error));
      hechas.push({ tabla, ids: rows.map((r: Any) => r.id).filter(Boolean) });
    }
  } catch (err) {
    // Deshace lo insertado (de hijos a padres) para no dejar una restauración a medias
    for (const h of hechas.reverse()) if (h.ids.length) await supa.from(h.tabla).delete().in('id', h.ids);
    throw err;
  }
  // Relaciones que se perdieron al borrar: presupuestos de proveedor que sustituía esta factura
  const sust = entrada.enlaces?.sustituido_por;
  if (sust?.factura && sust.ids?.length) await supa.from('estudio_ficheros').update({ sustituido_por: sust.factura }).in('id', sust.ids).is('sustituido_por', null);
  await supa.from('estudio_papelera').delete().eq('id', entrada.id);
}

function mensajeConflicto(tabla: string, error: Any): string {
  const dup = String(error?.code) === '23505';
  if (dup && tabla === 'estudio_versiones') return 'No se puede restaurar: el proyecto ya tiene otra versión con el mismo número.';
  if (dup) return 'No se puede restaurar: ya existe un elemento igual.';
  if (String(error?.code) === '23503') return 'No se puede restaurar: el proyecto o un elemento del que depende ya no existe.';
  return `No se puede restaurar (${tabla}): ${error?.message ?? 'error'}`;
}
