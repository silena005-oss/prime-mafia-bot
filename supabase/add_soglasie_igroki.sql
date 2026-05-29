-- Согласие с офертой и политикой конфиденциальности
-- Выполнить в Supabase SQL Editor один раз.

alter table igroki
    add column if not exists soglasie_offerta boolean default false,
    add column if not exists soglasie_versiya text,
    add column if not exists soglasie_data timestamptz;

comment on column igroki.soglasie_offerta is 'Пользователь принял оферту и политику конфиденциальности';
comment on column igroki.soglasie_versiya is 'Версия документов на момент согласия, например 2026-05-29';
comment on column igroki.soglasie_data is 'Дата и время принятия согласия';
