# Правила клубов (пресеты)

Каждый клуб — **отдельная папка** в `clubs/`. Бот **по названию клуба** подмешивает настройки из `preset.json`.

## Структура папки

```
clubs/my-club/
  preset.json        — логика для бота
  rules.md           — правила для ведущего
  apply_settings.sql — SQL для Supabase (опционально)
  notes.md           — заметки с игр
  cards/             — картинки ролей (опционально)
```

## preset.json

```json
{
  "slug": "my-club",
  "match_names": ["название клуба"],
  "nastroyki": {
    "znakomstvo_sek": 60,
    "perviy_hod_avto": true,
    "perviy_hod_nomer": 1,
    "posle_znakomstva_golosovanie": true
  }
}
```

### Ключи nastroyki

| Ключ | Эффект |
|------|--------|
| `znakomstvo_sek` | Секунд на представление |
| `perviy_hod_avto` | Старт без выбора первого игрока |
| `perviy_hod_nomer` | Номер места автостарта (обычно 1) |
| `posle_znakomstva_golosovanie` | После представлений — сразу голосование |
| `tip_kluba` | `paskal` / `vip` / `naila` |
| `bez_reytinga` | `true` — без рейтинга и баллов (скрывает UI в mini app) |
| `reyting_vklyuchen` | `false` — то же, что `bez_reytinga: true` |

Владелец клуба может включить/выключить рейтинг в боте: **Настройки клуба → «Включить/Выключить рейтинг»** (сохраняется в Supabase как `bez_reytinga` / `reyting_vklyuchen`).

Порядок слияния: значения из **Supabase** перекрывают пресет; пресет заполняет пробелы.

## Git-ветки по клубам (рекомендация)

Для крупных клубов с отдельными правилами и картами:

```
main
  └── club/big-family      ← preset + rules + cards
  └── club/prime-mafia-ellada
  └── club/prime-mafia-sochi
```

В `main` остаётся общий код бота; в ветке клуба — только `clubs/<slug>/` и связанные SQL/темы. Перед релизом — merge в `main` или деплой ветки клуба на отдельный инстанс (Network).

## Клубы в репозитории

| Папка | Клуб |
|-------|------|
| `big-family/` | Big Family (Антон) |
| `prime-mafia-sochi/` | Prime Mafia Sochi |
| `prime-mafia-ellada/` | Prime Mafia Ellada |

Модуль: `lib/klub-presety.js`
