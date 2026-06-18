-- Профиль игрока: день рождения и аватар для mini app
-- Выполнить в Supabase SQL Editor

ALTER TABLE igroki
    ADD COLUMN IF NOT EXISTS den_rozhdeniya date,
    ADD COLUMN IF NOT EXISTS avatar_file_id text,
    ADD COLUMN IF NOT EXISTS pozdravlen_dr_god smallint;

COMMENT ON COLUMN igroki.den_rozhdeniya IS 'Дата рождения (год можно условный — для поздравления важны день и месяц)';
COMMENT ON COLUMN igroki.avatar_file_id IS 'Telegram file_id фото профиля для mini app';
COMMENT ON COLUMN igroki.pozdravlen_dr_god IS 'Год последнего автопоздравления с ДР';
