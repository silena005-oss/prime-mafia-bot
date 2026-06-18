-- Бонусы и подарки игроков (выбор карты, иммунитет, подарки клуба/игрока)
-- Выполнить в Supabase SQL Editor

CREATE TABLE IF NOT EXISTS igrovye_bonusy (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    igrok_id uuid NOT NULL REFERENCES igroki(id) ON DELETE CASCADE,
    klub_id uuid REFERENCES kluby(id) ON DELETE SET NULL,
    tip text NOT NULL,
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'used', 'expired', 'cancelled')),
    istochnik text NOT NULL DEFAULT 'klub'
        CHECK (istochnik IN ('klub', 'igrok', 'sistema', 'promo')),
    istochnik_igrok_id uuid REFERENCES igroki(id) ON DELETE SET NULL,
    nazvaniye text,
    opisaniye text,
    meta jsonb NOT NULL DEFAULT '{}'::jsonb,
    vecher_data date,
    kod_igry text,
    istekaet timestamptz,
    ispolzovan timestamptz,
    sozdan timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_igrovye_bonusy_igrok_status
    ON igrovye_bonusy (igrok_id, status);

CREATE INDEX IF NOT EXISTS idx_igrovye_bonusy_klub
    ON igrovye_bonusy (klub_id, status);

COMMENT ON TABLE igrovye_bonusy IS 'Бонусы игрока: выбор карты, иммунитет, подарки. Mini app — вкладка «Мои бонусы».';
COMMENT ON COLUMN igrovye_bonusy.tip IS 'vybor_karty | immunitet_golos | immunitet_noch | podarok_kosmetika | custom';
COMMENT ON COLUMN igrovye_bonusy.meta IS 'JSON: vybrannaya_rol, allowed_roles[], frame_id, vecher_id, …';
