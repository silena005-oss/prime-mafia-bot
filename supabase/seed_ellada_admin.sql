-- Prime Mafia Ellada — тема + админ клуба
-- 1) Замени 'ЭЛЛАДА_НИК' на игровой ник Эллады (как в igroki.igrovoy_nik)
-- 2) Выполни в Supabase SQL Editor

-- Тема Ellada только у этого клуба (в mini app видят участники клуба)
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

-- Собственник клуба (полный доступ + тема в mini app)
with klub as (
    select id from public.kluby
    where lower(nazvaniye) in (
        'prime mafia ellada',
        'prime mafia эллада',
        'прайм мафия эллада',
        'эллада',
        'ellada'
    )
    limit 1
),
igrok as (
    select id, tg_id from public.igroki
    where lower(igrovoy_nik) = lower('ЭЛЛАДА_НИК')
       or lower(imya) = lower('ЭЛЛАДА_НИК')
    limit 1
)
update public.kluby k
set owner_tg_id = i.tg_id
from klub, igrok i
where k.id = klub.id and i.tg_id is not null;

-- Членство: vladyelets (если нужен только ведущий — замени на 'vedushchiy')
insert into public.chleny_klubov (klub_id, igrok_id, rol)
select k.id, i.id, 'vladyelets'
from public.kluby k
cross join public.igroki i
where lower(k.nazvaniye) in (
    'prime mafia ellada',
    'prime mafia эллада',
    'прайм мафия эллада',
    'эллада',
    'ellada'
)
and (
    lower(i.igrovoy_nik) = lower('ЭЛЛАДА_НИК')
    or lower(i.imya) = lower('ЭЛЛАДА_НИК')
)
and not exists (
    select 1 from public.chleny_klubov ck
    where ck.klub_id = k.id and ck.igrok_id = i.id
);
