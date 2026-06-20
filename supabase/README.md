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

## Где смотреть анкеты клубов

1. **Telegram (админ):** команда `/ankety` → список клубов → карточка с ответами
2. **Telegram:** после заполнения анкеты копия уходит `ADMIN_TG_ID`
3. **Supabase:** Table Editor → `klub_ankety` (колонки `otvety`, `tekst_svodka`)
4. **Папка clubs/:** пресеты правил (`preset.json`, `rules.md`) — код, не анкета

## RLS — замок перед гостями

**Сейчас:** таблицы могут быть открыты для anon/authenticated — это нормальный этап разработки.

**Перед чужими клубами:** выполнить `enable_rls_club_isolation.sql`:

- RLS включён на всех клубных таблицах
- `anon` / `authenticated` — **нет доступа** (политик нет = deny)
- `goroda` — публичное чтение (регистрация)
- Бот на Railway — **service_role** key (обходит RLS, фильтрация по `klub_id` в коде)

Проверка: в Supabase → Authentication → Policies — на `kluby`, `bally` и т.д. RLS = enabled.

Для будущего прямого доступа mini app → Supabase в файле миграции есть закомментированные политики через JWT `tg_id`.
