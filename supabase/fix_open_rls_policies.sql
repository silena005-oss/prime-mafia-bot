-- =============================================================================
-- Полный замок: скрыть ВСЁ от anon / authenticated / PUBLIC
-- =============================================================================
-- Бот → только SUPABASE_KEY = service_role (обходит RLS).
-- Mini app → только через бот, не напрямую в Supabase.
-- Публичные политики не нужны.
--
-- Supabase → SQL Editor → Run
-- Ожидание: Policies — у всех таблиц RLS ON и «No policies»
-- =============================================================================

-- 1) Снять ВСЕ политики в public
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format(
            'DROP POLICY IF EXISTS %I ON %I.%I',
            r.policyname, r.schemaname, r.tablename
        );
        RAISE NOTICE 'Dropped % on %', r.policyname, r.tablename;
    END LOOP;
END $$;

-- 2) RLS + FORCE на всех таблицах public
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.tablename);
        RAISE NOTICE 'RLS forced on %', r.tablename;
    END LOOP;
END $$;

-- 3) Забрать права у PUBLIC / anon / authenticated
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format(
            'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',
            r.tablename
        );
    END LOOP;

    FOR r IN
        SELECT sequence_name AS seq
        FROM information_schema.sequences
        WHERE sequence_schema = 'public'
    LOOP
        EXECUTE format(
            'REVOKE ALL ON SEQUENCE public.%I FROM PUBLIC, anon, authenticated',
            r.seq
        );
    END LOOP;
END $$;

COMMENT ON SCHEMA public IS 'Prime Mafia: данные только через бот (service_role). Anon — закрыт.';
