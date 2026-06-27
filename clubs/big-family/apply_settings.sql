-- Big Family — настройки клуба в Supabase
-- Выполнить после создания клуба с названием Big Family / Биг Фэмили

update public.kluby
set nastroyki = (coalesce(nastroyki, '{}'::jsonb)
    || jsonb_build_object(
        'club_preset', 'big-family',
        'znakomstvo_sek', 60,
        'perviy_hod_avto', true,
        'perviy_hod_nomer', 1,
        'posle_znakomstva_golosovanie', true,
        'tip_kluba', 'paskal',
        'max_foly', 4
    )) - 'bez_reytinga'
where lower(nazvaniye) in (
    'big family',
    'big family mafia',
    'биг фэмили',
    'биг фемили',
    'бигфэмили'
);
