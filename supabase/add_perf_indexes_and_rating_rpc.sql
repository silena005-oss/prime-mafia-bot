-- Performance indexes + club rating top RPC for miniapp /state.
-- Run in Supabase SQL Editor. Safe to re-run.

-- Prod may miss this column (code already writes sportivniy)
ALTER TABLE public.bally
  ADD COLUMN IF NOT EXISTS sportivniy boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS igroki_tg_id_uq
  ON public.igroki (tg_id);

CREATE INDEX IF NOT EXISTS chleny_klubov_igrok_rol_klub_idx
  ON public.chleny_klubov (igrok_id, rol, klub_id);

CREATE UNIQUE INDEX IF NOT EXISTS chleny_klubov_klub_igrok_uq
  ON public.chleny_klubov (klub_id, igrok_id);

CREATE INDEX IF NOT EXISTS kluby_owner_tg_id_idx
  ON public.kluby (owner_tg_id);

CREATE INDEX IF NOT EXISTS bally_klub_sport_igrok_idx
  ON public.bally (klub_id, sportivniy, igrok_id);

CREATE INDEX IF NOT EXISTS bally_igrok_klub_data_idx
  ON public.bally (igrok_id, klub_id, data_igry DESC);

CREATE INDEX IF NOT EXISTS bally_klub_data_sport_idx
  ON public.bally (klub_id, data_igry, sportivniy);

CREATE INDEX IF NOT EXISTS aktivnye_igry_klub_done_updated_idx
  ON public.aktivnye_igry (klub_id, zavershena, obnovlena_v);

CREATE INDEX IF NOT EXISTS anonsy_klub_status_data_idx
  ON public.anonsy (klub_id, status, data_igry);

CREATE INDEX IF NOT EXISTS zapisi_na_anons_anons_status_idx
  ON public.zapisi_na_anons (anons_id, status);

CREATE OR REPLACE FUNCTION public.top_reytinga_kluba(
  p_klub uuid,
  p_sport boolean DEFAULT false,
  p_limit int DEFAULT 10
)
RETURNS TABLE (
  igrok_id uuid,
  pts bigint,
  games bigint,
  imya text,
  igrovoy_nik text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    b.igrok_id,
    COALESCE(SUM(b.bally_vsego), 0)::bigint AS pts,
    COUNT(*)::bigint AS games,
    MAX(i.imya)::text AS imya,
    MAX(i.igrovoy_nik)::text AS igrovoy_nik
  FROM public.bally b
  LEFT JOIN public.igroki i ON i.id = b.igrok_id
  WHERE b.klub_id = p_klub
    AND COALESCE(b.sportivniy, false) = COALESCE(p_sport, false)
  GROUP BY b.igrok_id
  ORDER BY pts DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
$$;

REVOKE ALL ON FUNCTION public.top_reytinga_kluba(uuid, boolean, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.top_reytinga_kluba(uuid, boolean, int) TO service_role;
