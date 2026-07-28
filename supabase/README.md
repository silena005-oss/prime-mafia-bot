# Supabase — структура и изоляция данных по клубам

Prime Mafia — **одна база**, но данные каждого клуба **разделены по `klub_id`**.

## Принцип

| Данные | Привязка | Кто видит |
|--------|----------|-----------|
| Клуб | `kluby.id` | Собственник, ведущие, члены |
| Игроки клуба | `chleny_klubov.klub_id` | Только этот клуб |
| Рейтинг / баллы | `bally.klub_id` | Отдельный рейтинг на клуб |
| Анонсы | `anonsy.klub_id` | Клуб + город |
| Бонусы / подарки | `igrovye_bonusy.klub_id` | Игрок + клуб |
| **Анкета клуба** | `klub_ankety.klub_id` (1:1) | Админ PM + Supabase |
| Игровые вечера | `igrovye_vechera.klub_id` | Клуб |
| Настройки правил | `kluby.nastroyki` jsonb | Клуб |
| **Код регистрации** | `kluby.nastroyki.kod_registracii` | Только по коду/ссылке от ведущего — публичного списка клубов нет |

Игрок (`igroki`) — **глобальный** (один TG = один профиль), но членство и статистика — **по клубам** через `chleny_klubov` и `bally.klub_id`.

**Приватность клубов:** новый игрок не видит каталог клубов. Ведущий выдаёт код (`AB12CD`) или ссылку `t.me/бот?start=club_AB12CD`.

## Миграции (порядок)

1. Базовые таблицы (уже в проекте)
2. `add_igroki_profile.sql`
3. `add_otpis_priglasheniy.sql`
4. `add_igrovye_bonusy.sql`
5. `add_klub_ankety.sql`
6. `add_vecher_reyting.sql` — игрок вечера, рейтинг за вечер
7. **`enable_rls_club_isolation.sql`** — RLS, изоляция клубов (**обязательно до гостевых клубов**)
8. **`add_perf_indexes_and_rating_rpc.sql`** — индексы + RPC `top_reytinga_kluba` для топа рейтинга miniapp
9. **`ops_today_run.sql`** — perf + `rassylka_jobs` + verify (запускать целиком сегодня)

## Где смотреть анкеты клубов

1. **Telegram (админ):** команда `/ankety` → список клубов → карточка с ответами
2. **Telegram:** после заполнения анкеты копия уходит `ADMIN_TG_ID`
3. **Supabase:** Table Editor → `klub_ankety` (колонки `otvety`, `tekst_svodka`)
4. **Папка clubs/:** пресеты правил (`preset.json`, `rules.md`) — код, не анкета

## RLS — замок перед гостями

**Рекомендуется сейчас:** выполнить **`fix_open_rls_policies.sql`** в SQL Editor —  
снимет все `Allow all` / публичные политики, включит RLS на всех таблицах, отзовёт права у `anon`.  
Бот с `service_role` не сломается. Mini app в Supabase напрямую не ходит.

Проверка: Database → Policies — везде RLS enabled и **No policies**.

Альтернатива/дополнение: `enable_rls_club_isolation.sql` (точечный список таблиц + опционально чтение `goroda`).

Для будущего прямого доступа mini app → Supabase в `enable_rls_club_isolation.sql` есть закомментированные политики через JWT `tg_id`.
