-- Отписка игрока от рассылки приглашений на игры (команда /stop или «стоп»)
ALTER TABLE igroki
ADD COLUMN IF NOT EXISTS otpis_priglasheniy boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN igroki.otpis_priglasheniy IS 'true = не слать приглашения на игры от клубов';
