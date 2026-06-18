-- Prime Mafia Ellada — настройки клуба
-- Выполнить в Supabase SQL Editor после создания клуба

update public.kluby
set nastroyki = coalesce(nastroyki, '{}'::jsonb)
    || jsonb_build_object(
        'stilizatsiya_kluba', true,
        'role_cards_scope', 'club',
        'deck', 'ellada',
        'miniapp_tema', 'ellada',
        'tema', 'ellada',
        'otkrytaya_mafiya', true,
        'znakomstvo_sek', 5
    )
where lower(nazvaniye) in (
    'prime mafia ellada',
    'prime mafia эллада',
    'прайм мафия эллада',
    'эллада',
    'ellada'
);
