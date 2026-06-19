-- Игрок вечера и рейтинг за вечер (городской)
alter table public.igrovye_vechera
    add column if not exists igrok_vechera_id uuid references public.igroki(id) on delete set null;

alter table public.igrovye_vechera
    add column if not exists reyting_vechera jsonb not null default '[]'::jsonb;

alter table public.igrovye_vechera
    add column if not exists zavershen_v timestamptz;

create index if not exists idx_igrovye_vechera_igrok_vechera
    on public.igrovye_vechera (igrok_vechera_id)
    where igrok_vechera_id is not null;
