// supabase/functions/estudio-papelera/index.ts
//
// Estudio Curino · purga diaria de la papelera (todos los proyectos): borra
// definitivamente lo que lleva más de 30 días (sus archivos del bucket
// «estudio» y la entrada de estudio_papelera). La llama pg_cron
// 'estudio-papelera-purgar' cada día; auth propia por X-Cron-Secret.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { purgar } from '../_shared/estudio-papelera.ts'

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) return json({ error: 'unauthorized' }, 401);
  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  // De 200 en 200 hasta vaciar lo caducado (con un tope por si algo falla en bucle)
  let total = 0;
  for (let i = 0; i < 50; i++) {
    const n = await purgar(supa);
    total += n;
    if (n < 200) break;
  }
  console.log(`estudio-papelera: ${total} elementos borrados definitivamente`);
  return json({ ok: true, borrados: total });
});
