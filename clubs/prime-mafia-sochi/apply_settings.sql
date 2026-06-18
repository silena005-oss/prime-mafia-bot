-- Prime Mafia Sochi test settings.
-- Run after the club exists in public.kluby.
-- Adjust the WHERE clause if the club is stored under another name during testing.

update public.kluby
set nastroyki = coalesce(nastroyki, '{}'::jsonb)
    || jsonb_build_object(
        'znakomstvo_sek', 5,
        'otkrytaya_mafiya', true,
        'perviy_hod_auto_enabled', true,
        'stilizatsiya_kluba', true,
        'role_cards_scope', 'club',
        'tema', 'sochi',
        'miniapp_tema', 'sochi'
    )
where lower(nazvaniye) in (
    'prime mafia sochi',
    'prime mafia сочи',
    'прайм мафия сочи',
    'паскаль мафия'
);
