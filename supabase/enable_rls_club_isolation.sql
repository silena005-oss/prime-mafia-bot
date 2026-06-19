-- =============================================================================
-- RLS: изоляция клубов по klub_id
-- =============================================================================
-- Бот использует SUPABASE_KEY = service_role (обходит RLS). Эта миграция закрывает
-- прямой доступ через anon/authenticated ключ — чужие клубы не видят чужие данные.
--
-- Выполнить в Supabase → SQL Editor ПЕРЕД подключением сторонних клубов.
-- После миграции: убедиться, что в Railway только service_role, не anon.
-- =============================================================================

-- Справочник городов — публичное чтение (регистрация, создание клуба)
ALTER TABLE IF EXISTS public.goroda ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS goroda_public_read ON public.goroda;
CREATE POLICY goroda_public_read ON public.goroda
    FOR SELECT TO anon, authenticated
    USING (true);

-- ---------------------------------------------------------------------------
-- Клубные таблицы: RLS включён, политик для anon/authenticated нет → доступ запрещён
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.kluby ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.chleny_klubov ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bally ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.anonsy ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.zapisi_na_anons ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.igrovye_vechera ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.igrovye_bonusy ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.klub_ankety ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.aktivnye_igry ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.nastroyki_app ENABLE ROW LEVEL SECURITY;

-- Профиль игрока — глобальный, но не должен утекать через anon
ALTER TABLE IF EXISTS public.igroki ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Дополнительно: отзываем права anon/authenticated на чувствительные таблицы
-- (RLS + revoke = двойной замок; goroda остаётся читаемым)
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.kluby FROM anon, authenticated;
REVOKE ALL ON public.chleny_klubov FROM anon, authenticated;
REVOKE ALL ON public.bally FROM anon, authenticated;
REVOKE ALL ON public.anonsy FROM anon, authenticated;
REVOKE ALL ON public.zapisi_na_anons FROM anon, authenticated;
REVOKE ALL ON public.igrovye_vechera FROM anon, authenticated;
REVOKE ALL ON public.igrovye_bonusy FROM anon, authenticated;
REVOKE ALL ON public.klub_ankety FROM anon, authenticated;
REVOKE ALL ON public.aktivnye_igry FROM anon, authenticated;
REVOKE ALL ON public.nastroyki_app FROM anon, authenticated;
REVOKE ALL ON public.igroki FROM anon, authenticated;

GRANT SELECT ON public.goroda TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Заготовка для будущего: политики через JWT с tg_id (mini app → Supabase напрямую)
-- Раскомментировать после настройки custom JWT / Edge Function auth.
-- ---------------------------------------------------------------------------
/*
CREATE OR REPLACE FUNCTION public.pm_tg_id()
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::json->>'tg_id', '')::bigint;
$$;

CREATE OR REPLACE FUNCTION public.pm_moi_kluby_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT k.id FROM kluby k WHERE k.owner_tg_id = public.pm_tg_id()
  UNION
  SELECT ck.klub_id FROM chleny_klubov ck
  JOIN igroki i ON i.id = ck.igrok_id
  WHERE i.tg_id = public.pm_tg_id();
$$;

CREATE POLICY bally_club_read ON public.bally
    FOR SELECT TO authenticated
    USING (klub_id IN (SELECT public.pm_moi_kluby_ids()));
*/

COMMENT ON TABLE public.kluby IS 'RLS: доступ только service_role (бот). Anon/authenticated — запрещён.';
