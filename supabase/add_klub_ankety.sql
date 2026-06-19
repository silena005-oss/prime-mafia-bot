-- Анкета клуба при создании (wizard в боте)
-- Одна запись на клуб; ответы в JSON + готовая текстовая сводка для админа

CREATE TABLE IF NOT EXISTS klub_ankety (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    klub_id uuid NOT NULL UNIQUE REFERENCES kluby(id) ON DELETE CASCADE,
    owner_tg_id bigint NOT NULL,
    otvety jsonb NOT NULL DEFAULT '{}'::jsonb,
    tekst_svodka text,
    status text NOT NULL DEFAULT 'completed'
        CHECK (status IN ('draft', 'completed', 'skipped')),
    sozdan timestamptz NOT NULL DEFAULT now(),
    obnovlen timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_klub_ankety_owner ON klub_ankety (owner_tg_id);
CREATE INDEX IF NOT EXISTS idx_klub_ankety_sozdan ON klub_ankety (sozdan DESC);

COMMENT ON TABLE klub_ankety IS 'Анкеты клубов: контакты, формат игр, бюджет. Просмотр: /ankety в боте (админ) или Supabase Table Editor';
COMMENT ON COLUMN klub_ankety.otvety IS 'JSON: igry_v_nedelyu, byudzhet, komanda, pravila_bally, …';
COMMENT ON COLUMN klub_ankety.tekst_svodka IS 'Готовый текст для Telegram / CRM';
