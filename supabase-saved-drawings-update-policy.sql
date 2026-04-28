-- ============================================================
-- Curino: Add UPDATE policy to saved_drawings
-- Run this in Supabase SQL Editor
-- ============================================================

create policy "Users update own drawings"
  on saved_drawings for update using (auth.uid() = user_id);
