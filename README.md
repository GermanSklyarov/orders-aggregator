# orders-aggregator

Сервис забирает заказы интернет-магазина из внешней системы (API поддерживает другая команда),
принимает их обновления через вебхуки и считает статистику по клиентам.

## Стек

Node 20+, TypeScript, Fastify, PostgreSQL (`pg`), Zod, Vitest.

## Запуск

Образ внешнего API лежит рядом с этой папкой — загрузите тот, что под вашу архитектуру (`uname -m`):

```bash
docker load -i ../orders-mock-arm64.tar.gz   # arm64 / aarch64 (Mac на Apple Silicon)
docker load -i ../orders-mock-amd64.tar.gz   # x86_64
```

```bash
cp .env.example .env
docker compose up -d        # PostgreSQL (+ тестовая БД orders_test) и внешний API на :4000
npm install
npm run migrate
npm run dev                 # http://localhost:3000
```

Отправка вебхуков из внешней системы (для разработки запускается вручную, сервис должен быть запущен):

```bash
docker compose run --rm orders-api webhooks --target http://host.docker.internal:3000/webhooks/order
```

Тесты (нужен запущенный PostgreSQL):

```bash
npm test
```

## Структура

```
src/
  app.ts              Fastify-приложение, обработка ошибок
  container.ts        сборка зависимостей
  db.ts               пул соединений, миграции
  clients/            клиент внешнего API (лимиты, ретраи)
  repositories/       доступ к данным
  services/           бизнес-логика
  routes/             HTTP-слой
  utils/              деньги, время
migrations/           SQL-миграции, применяются по порядку
test/                 интеграционные тесты на реальной БД (внешний API — фейк)
```

## Соглашения

- Деньги внутри сервиса — в копейках (integer). Рубли — только на входе из внешнего API и в ответах.
- Время храним в UTC (`TIMESTAMPTZ`).
- Ошибки бизнес-логики — наследники `AppError`, в ответе `{ error: <код>, message }`.

## API сервиса

| Метод | Путь | Описание |
|---|---|---|
| POST | `/sync` | Забрать все заказы из внешнего API. Отвечает статистикой, когда всё забрано |
| POST | `/webhooks/order` | Обновление заказа (тело — `Order` внешнего API). Повтор/устаревшая версия → `200 { result: "stale" }` |
| GET | `/customers/:id/daily-totals?from=YYYY-MM-DD&to=YYYY-MM-DD` | Оплаченные (`paid`) заказы по дате создания в таймзоне клиента: `[{ date, total, gross, discount, net }]` |
| GET | `/health` | Проверка живости |

## Внешний API (`ORDERS_API_URL`)

- `GET /orders?cursor=<string>&limit=<1..100>` → `{ items: Order[], nextCursor: string | null }`. Лимит 5 rps.
- `GET /customers/:id` → `{ id, timezone }` (IANA, например `Europe/Berlin`).
- Вебхуки: `POST` на наш `/webhooks/order`, тело — `Order`. Повторная доставка возможна.

```ts
type Order = {
  id: string;
  customerId: string;
  amount: number;          // сумма заказа в рублях, до скидки
  discountPercent: number; // скидка, % (0 — без скидки)
  amountPaid: number;      // оплачено, в рублях: amount со скидкой
  status: "pending" | "paid" | "refunded";
  createdAt: string;       // ISO 8601, UTC
  updatedAt: string;       // ISO 8601, UTC
};
```

`total = gross` — сумма до скидки, `net` — сумма `amountPaid`, `discount = gross - net`.
Все суммы в рублях, расчёты в целых копейках; доли копейки отбрасываются.
Дни `from..to` включаются целиком в таймзоне клиента с учётом DST. Пустые дни
возвращаются со всеми суммами, равными нулю; `pending` и `refunded` исключаются.

Совместимость с фактическим API: денежные поля и процент могут быть строками;
старые заказы без обоих полей скидки принимаются с `discountPercent = 0`,
`amountPaid = amount`. Если присутствует только одно из новых полей, заказ
невалиден. Процент должен быть в диапазоне 0..100, оплата — от 0 до суммы заказа.
Оплата не пересчитывается из процента: источником `net` является `amountPaid`.
Новая версия заказа целиком заменяет предыдущую только при большем `updatedAt`;
проверка и запись защищены условием в PostgreSQL, включая конкурентные запросы.

Миграция `002_discounts.sql` сохраняет существующие заказы и первоначально
заполняет их как заказы без скидки. Она не может восстановить поля, ранее
отброшенные сервисом. Для достоверной исторической статистики старой БД нужен
отдельный повторный импорт из исходных данных; обычный `/sync` не обновляет
равные версии. Предусмотренный заданием финальный запуск на чистой БД решает
это для сдачи задания. Диагностика и принятые решения — в `INVESTIGATION.md`
и `SOLUTION.md`.
