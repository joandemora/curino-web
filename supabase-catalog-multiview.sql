-- ============================================================
-- Curino: catalog_items multi-view + variants + product photo
-- (Catálogo Multi-vista Fase A)
-- Run this in Supabase SQL Editor AFTER the Marcas Phase 1+2+3 SQL.
-- ============================================================
-- All three columns are nullable so legacy rows (with only the existing
-- dxf_url / thumbnail_url filled) keep working unchanged. Phases B / C / D
-- of the multi-view system will start populating these.

alter table catalog_items
  add column if not exists views jsonb,
  add column if not exists variants jsonb,
  add column if not exists product_photo_url text;

-- Documented JSON shapes (no DB-level constraint — kept flexible during
-- Phase B development; can be tightened with a CHECK or jsonb_schema if
-- needed later):
--
--   views = {
--     "top":   { "dxf_url": "https://.../piece-top.dxf"   },
--     "side":  { "dxf_url": "https://.../piece-side.dxf"  },
--     "front": { "dxf_url": "https://.../piece-front.dxf" },
--     "back":  { "dxf_url": "https://.../piece-back.dxf"  }
--   }
--   -- All keys optional. Frontend resolves the default DXF as
--   --   views.top -> first non-null in [top, side, front, back] -> dxf_url
--
--   variants = [
--     {"name": "Roble natural", "color_hex": "#c9a55b", "photo_url": "..."},
--     {"name": "Negro",         "color_hex": "#222222", "photo_url": "..."}
--   ]
--   -- null or [] when the piece has no variant choice.
--
--   product_photo_url = plain text URL to a PNG/JPG of the real product
--                       photographed (separate from thumbnail_url which is
--                       a small icon for the catalog grid).
