# Manual SQL migrations

Эта папка содержит SQL-скрипты, которые **нельзя** применить через TypeORM
`synchronize: true` и которые надо запускать на VPS вручную **до** рестарта
бекенда.

## Когда нужно

Сегодня проект работает с `synchronize: true` — TypeORM сам синхронизирует
схему из entity-метаданных. Этого хватает для добавления новых таблиц и
колонок, но не для:
- расширения PostgreSQL ENUM-типов;
- изменений с потерей данных, требующих ручной проверки.

Любую такую миграцию я кладу сюда отдельным файлом с пояснением и инструкцией
по запуску.

## Перед каждым деплоем

1. Сделать бекап БД на VPS:
   ```bash
   docker exec <postgres_container> pg_dump -U postgres -d bag1vbucks \
     | gzip > /backups/bag1vbucks-$(date +%F-%H%M).sql.gz
   ```
2. Подтянуть код: `git pull`.
3. Если в этой папке появился новый `.sql` файл — запустить его согласно
   инструкции внутри файла.
4. Перезапустить бекенд: `docker compose up -d --build backend`.

## Список миграций

### `01-widen-admin-activity-log-action.sql`
Конвертирует колонку `admin_activity_logs.action` из ENUM в `varchar(64)`.
Нужна для фичи order-reviews — без неё бекенд не запустится с
`AdminActivityType.REVIEW_APPROVE` / `REVIEW_REJECT`.

**Запуск:**
```bash
docker exec -i <postgres_container> psql -U postgres -d bag1vbucks \
  < backend/src/database/migrations/manual-sql/01-widen-admin-activity-log-action.sql
```

**Идемпотентна:** безопасно запускать несколько раз.
