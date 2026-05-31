create table if not exists public.igrovye_vechera (
    id uuid primary key default gen_random_uuid(),
    klub_id uuid not null references public.kluby(id) on delete cascade,
    data_igry date not null,
    vedushchii_tg_id bigint,
    sostav jsonb not null default '[]'::jsonb,
    istochnik text,
    anons_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (klub_id, data_igry)
);

create index if not exists idx_igrovye_vechera_klub_data
    on public.igrovye_vechera (klub_id, data_igry desc);
