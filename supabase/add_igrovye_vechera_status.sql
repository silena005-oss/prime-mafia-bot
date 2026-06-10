alter table public.igrovye_vechera
    add column if not exists status text not null default 'active',
    add column if not exists zavershen_v timestamptz;

create index if not exists idx_igrovye_vechera_status
    on public.igrovye_vechera (klub_id, data_igry desc, status);
