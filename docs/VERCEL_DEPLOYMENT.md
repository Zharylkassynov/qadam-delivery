# Развёртывание на Vercel

Учебное демо опубликовано 19 октября 2026: **https://qadam-delivery.vercel.app**.
Проект Vercel: `zharylkasynartur-gmailcoms-projects/qadam-delivery`.
База — существующий Supabase Qadam Delivery; локальные Docker и `.env`
продолжают использоваться для разработки. Работа сайта не зависит от
локального компьютера. Приватный репозиторий `Zharylkassynov/qadam-delivery`
подключён к Vercel; Production-ветка — `main`.

## Настройки проекта

- Источник: приватный GitHub-репозиторий, ветка `main`, корень проекта `./`.
- Framework: Next.js; Node.js: 22.x.
- Install: `npm ci`; Build: `npm run build`; output: стандартный `.next`.
- `vercel.json` задаёт регион Frankfurt (`fra1`), рядом с базой Supabase,
  и Fluid Compute. Скрипты `build:cloud` и `start:cloud` на Vercel не нужны.
- Миграции и seed не запускаются при сборке или обработке HTTP-запросов.
  Облачная схема уже подготовлена; административный пароль приложению не нужен.

## Переменные окружения

Значения из `.env.vercel.example` ввести в настройках Vercel **только для
Production**. Не импортировать целиком `.env` или `.env.supabase`.

| Переменная | Значение |
| --- | --- |
| `APP_ORIGIN` | `https://qadam-delivery.vercel.app` — постоянный адрес проекта без пути. |
| `SUPABASE_PROJECT_REF` | Идентификатор существующего проекта Qadam Delivery. |
| `DATABASE_URL` | Transaction pooler, порт `6543`, пользователь `qadam_app.<project-ref>`. Хост сверить с Connect → Transaction pooler; пароль брать из локальной защищённой конфигурации. |
| `DATABASE_SSL_CA_FILE` | `config/certs/supabase-root.crt` |
| `DATABASE_POOL_MAX` | `3` |
| `DEMO_AUTH_ENABLED` | `true` для согласованного учебного демо. При `false` текущий вход отключён. |

Все значения серверные, без префикса `NEXT_PUBLIC_`. Не передавать в Vercel
`DEMO_PASSWORD`, `TEST_DATABASE_URL`, `POSTGRES_PASSWORD`, пароль владельца
базы или `QADAM_NEXT_DIST_DIR`. Пароли аккаунтов уже хешированы в базе:
изменение `DEMO_PASSWORD` в окружении **не меняет** их. Сейчас опубликовано
учебное демо с тестовыми аккаунтами и паролем из инструкции. Для реальных
заказов потребуется отдельная настройка пользовательского доступа.

## Соединения и TLS

Постоянный локальный сервер с облачной базой сохраняет session pooler на
`5432`. Vercel использует transaction pooler на `6543`: существующий `pg`
сохраняется, запросы не используют именованные prepared statements.
Каждая операция доставки выполняет транзакцию на одном выделенном клиенте.
Блокировки и защита повторного создания заказа сохраняются.

`attachDatabasePool` освобождает простаивающие соединения перед приостановкой
Vercel Function; idle timeout на Vercel — 5 секунд, локально — 30 секунд.
Публичный корневой TLS-сертификат явно включён в трассировки API-сборки.
Проверка сертификатов включена; секретов в файле сертификата нет.

## Preview

На первом этапе Preview предназначен для просмотра интерфейса без входа.
В окружении Preview не задавать `DATABASE_URL`; `DEMO_AUTH_ENABLED=false`
или не задан. Адрес берётся из точного `VERCEL_URL`. Сборка отклоняет Preview
с подключённой базой или разрешённым демовходом. Для полноценного тестового
Preview позже потребуется отдельная база и соответствующее изменение политики.

## Проверки перед публикацией

```powershell
npm run typecheck
npm test
npm run build
npm run check:build
npm run test:e2e
npm run db:cloud:transaction:check
npm run test:cloud:transaction
```

Последние две команды читают `.env.supabase`, меняют порт только в дочернем
процессе и не переписывают локальные конфигурации. Облачные E2E создают явно
помеченные тестовые доставки и ничего не удаляют. Автоматические проверки
GitHub Actions используют отдельную временную PostgreSQL, без облачных секретов.

В опубликованной версии 19 октября прошли 6 браузерных сценариев, включая
полную доставку с отдельными контекстами клиента и курьера, сохранение
после повторного входа, cookie Secure/HttpOnly и отказ постороннему Origin.
Заказ QD-0011 сохранён в Supabase со статусом DELIVERED и шестью событиями.
Проверены мобильные размеры 360 и 390 px. Проверка localhost в HTTPS-наборе
пропускается, остальные проверки выполняются по реальному публичному адресу.
Следующая ручная репетиция — тот же сценарий с двумя участниками на двух
физических устройствах; автоматические контексты её не заменяют.

Для повторяемой проверки опубликованного демо:

```powershell
$env:E2E_ORIGIN = 'https://your-project.vercel.app'
npm run test:deployed
Remove-Item Env:E2E_ORIGIN
```

Локальный сервер при этом не запускается. Команда использует существующие
демоаккаунты, создаёт помеченные `E2E` доставки и сохраняет снимки в
`test-results-deployed`. Проверка локального алиаса пропускается для HTTPS;
для публичной версии дополнительно проверяется Secure у cookie сессии.

## Документация платформ

- [Supabase: подключение и режимы pooler](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Vercel: управление пулом соединений](https://vercel.com/kb/guide/connection-pooling-with-functions)
- [Vercel: конфигурация проекта](https://vercel.com/docs/project-configuration/vercel-json)
