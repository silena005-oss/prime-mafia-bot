-- Снять тестовый тариф у Pascal / Prime Mafia и открыть полный Network.
-- Запусти в Supabase → SQL Editor, если нужно без редеплоя бота.

UPDATE public.kluby
SET nastroyki = (
  COALESCE(nastroyki, '{}'::jsonb)
  - 'test'
  || jsonb_build_object(
    'tarif_status', 'oplachen',
    'tarif_id', 'network',
    'tarif_plan', 'network',
    'bez_limita_tarifa', true,
    'igry_balans', COALESCE((nastroyki->>'igry_balans')::int, 0)
  )
)
WHERE nazvaniye ~* '(pascal|паскал|prime[[:space:]]*mafia|прайм[[:space:]]*мафия)'
RETURNING id, nazvaniye, nastroyki->>'tarif_status' AS status, nastroyki->>'tarif_id' AS plan;
