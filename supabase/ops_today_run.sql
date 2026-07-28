-- =============================================================================
-- SAFE ops pack for Prime_Mafia PRODUCTION
-- Adds missing columns, then creates indexes/RPC/jobs only when columns exist.
-- Run the WHOLE file in Supabase SQL Editor.
-- =============================================================================

-- --- A. Ensure columns the bot already writes --------------------------------
ALTER TABLE public.bally
  ADD COLUMN IF NOT EXISTS sportivniy boolean NOT NULL DEFAULT false;

ALTER TABLE public.bally
  ADD COLUMN IF NOT EXISTS data_igry date;

-- --- B. Helper: create index only if all listed columns exist ----------------
CREATE OR REPLACE FUNCTION public._pm_create_index_if_cols(
  p_index_name text,
  p_table text,
  p_ddl text,
  p_cols text[]
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  missing int;
BEGIN
  SELECT COUNT(*) INTO missing
  FROM unnest(p_cols) AS c(col)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = p_table
      AND column_name = c.col
  );
  IF missing > 0 THEN
    RAISE NOTICE 'skip index % — missing column(s) on %', p_index_name, p_table;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = p_index_name) THEN
    RETURN;
  END IF;
  EXECUTE p_ddl;
END;
$$;

SELECT public._pm_create_index_if_cols(
  'igroki_tg_id_uq', 'igroki',
  'CREATE UNIQUE INDEX igroki_tg_id_uq ON public.igroki (tg_id)',
  ARRAY['tg_id']
);

SELECT public._pm_create_index_if_cols(
  'chleny_klubov_igrok_rol_klub_idx', 'chleny_klubov',
  'CREATE INDEX chleny_klubov_igrok_rol_klub_idx ON public.chleny_klubov (igrok_id, rol, klub_id)',
  ARRAY['igrok_id', 'rol', 'klub_id']
);

SELECT public._pm_create_index_if_cols(
  'chleny_klubov_klub_igrok_uq', 'chleny_klubov',
  'CREATE UNIQUE INDEX chleny_klubov_klub_igrok_uq ON public.chleny_klubov (klub_id, igrok_id)',
  ARRAY['klub_id', 'igrok_id']
);

SELECT public._pm_create_index_if_cols(
  'kluby_owner_tg_id_idx', 'kluby',
  'CREATE INDEX kluby_owner_tg_id_idx ON public.kluby (owner_tg_id)',
  ARRAY['owner_tg_id']
);

SELECT public._pm_create_index_if_cols(
  'bally_klub_sport_igrok_idx', 'bally',
  'CREATE INDEX bally_klub_sport_igrok_idx ON public.bally (klub_id, sportivniy, igrok_id)',
  ARRAY['klub_id', 'sportivniy', 'igrok_id']
);

SELECT public._pm_create_index_if_cols(
  'bally_igrok_klub_data_idx', 'bally',
  'CREATE INDEX bally_igrok_klub_data_idx ON public.bally (igrok_id, klub_id, data_igry DESC)',
  ARRAY['igrok_id', 'klub_id', 'data_igry']
);

SELECT public._pm_create_index_if_cols(
  'bally_klub_data_sport_idx', 'bally',
  'CREATE INDEX bally_klub_data_sport_idx ON public.bally (klub_id, data_igry, sportivniy)',
  ARRAY['klub_id', 'data_igry', 'sportivniy']
);

SELECT public._pm_create_index_if_cols(
  'aktivnye_igry_klub_done_updated_idx', 'aktivnye_igry',
  'CREATE INDEX aktivnye_igry_klub_done_updated_idx ON public.aktivnye_igry (klub_id, zavershena, obnovlena_v)',
  ARRAY['klub_id', 'zavershena', 'obnovlena_v']
);

SELECT public._pm_create_index_if_cols(
  'anonsy_klub_status_data_idx', 'anonsy',
  'CREATE INDEX anonsy_klub_status_data_idx ON public.anonsy (klub_id, status, data_igry)',
  ARRAY['klub_id', 'status', 'data_igry']
);

SELECT public._pm_create_index_if_cols(
  'zapisi_na_anons_anons_status_idx', 'zapisi_na_anons',
  'CREATE INDEX zapisi_na_anons_anons_status_idx ON public.zapisi_na_anons (anons_id, status)',
  ARRAY['anons_id', 'status']
);

-- --- C. Rating top RPC (uses sportivniy; data_igry not required) --------------
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

-- --- D. Durable broadcast jobs -----------------------------------------------
CREATE TABLE IF NOT EXISTS public.rassylka_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tip text NOT NULL,
  klub_id uuid,
  chat_id bigint,
  tekst text NOT NULL,
  poluchateli jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  ok int NOT NULL DEFAULT 0,
  fail int NOT NULL DEFAULT 0,
  blocked int NOT NULL DEFAULT 0,
  total int NOT NULL DEFAULT 0,
  cursor_idx int NOT NULL DEFAULT 0,
  oshibka text,
  sozdan timestamptz NOT NULL DEFAULT now(),
  nachat timestamptz,
  zavershen timestamptz
);

CREATE INDEX IF NOT EXISTS rassylka_jobs_status_sozdan_idx
  ON public.rassylka_jobs (status, sozdan);

ALTER TABLE public.rassylka_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rassylka_jobs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rassylka_jobs FROM PUBLIC, anon, authenticated;

-- cleanup helper (optional; keep if useful for later migrations)
DROP FUNCTION IF EXISTS public._pm_create_index_if_cols(text, text, text, text[]);

-- --- E. Verification ---------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public') AS policies_left,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bally' AND column_name = 'sportivniy'
  ) AS bally_has_sportivniy,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bally' AND column_name = 'data_igry'
  ) AS bally_has_data_igry,
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'top_reytinga_kluba'
  ) AS has_top_rpc,
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'rassylka_jobs'
  ) AS has_rassylka_jobs;
