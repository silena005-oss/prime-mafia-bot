# Smoke checklist после деплоя (сегодня)

## 1. SQL в Supabase (обязательно)

1. Открой SQL Editor → вставь **весь** файл `supabase/ops_today_run.sql`.
2. Run.
3. В Results должно быть примерно:
   - `policies_left` — маленькое число или 0 (после lockdown)
   - `bally_has_sportivniy` = true
   - `has_top_rpc` = true
   - `has_rassylka_jobs` = true

Если снова ошибка — скопируй текст ошибки целиком.

## 2. Railway / miniapp

После деплоя `main`:

1. Открыть miniapp из Telegram.
2. Network: `/api/miniapp/state` — иногда `cached: true` при частом poll.
3. Static `app.js` / `styles.css` — заголовок `Content-Encoding: gzip` (если клиент шлёт Accept-Encoding).
4. Логотип клуба отображается (не битая картинка).
5. Стол не «мигает» целиком каждые 12с при неизменном составе.

## 3. Рассылка

1. Запустить рассылку анонса (Start+).
2. Бот сразу отвечает «запущена».
3. Итог приходит отдельным сообщением.
4. В Table Editor → `rassylka_jobs` появляется строка `done`.

## 4. Фазы игры (минимум)

В активной игре из miniapp:
- ночные шаги недоступны днём;
- `vote_set` недоступен вне голосования.
