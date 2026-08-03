-- Логические бэкапы (бот пишет сам раз в сутки + /backup у админа).
-- На Free-плане нет PITR — эта таблица держит последние снимки клубов/рейтинга/вечеров.

CREATE TABLE IF NOT EXISTS public.pm_logical_backups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sozdan timestamptz NOT NULL DEFAULT now(),
    istochnik text NOT NULL DEFAULT 'bot',
    meta jsonb NOT NULL DEFAULT '{}'::jsonb,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_pm_logical_backups_sozdan
    ON public.pm_logical_backups (sozdan DESC);

ALTER TABLE public.pm_logical_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pm_logical_backups FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pm_logical_backups FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.pm_logical_backups TO service_role;
