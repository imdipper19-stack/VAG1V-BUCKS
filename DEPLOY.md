# Deploy Bag1V-Bucks на сервер

Конфигурация целевого сервера: **Ubuntu 24.04, 4 vCPU / 8 GB RAM** (например VPS в Хельсинки).

## Что внутри стека

| Сервис | Порт | RAM лимит | Назначение |
|---|---|---|---|
| postgres | 5433 | 512 MB | TypeORM хранилище (orders, razer_accounts, proxies, ...) |
| redis | 6379 | 128 MB | BullMQ очередь заказов |
| backend | 3001 | 2 GB | NestJS API + BrowserPool с 3 Chromium-инстансами |
| frontend | 3002 | 512 MB | Next.js |
| nginx | 80/443 | 128 MB | Reverse proxy + Let's Encrypt SSL |

Итого ~3.3 GB памяти, остаётся ~4.7 GB запаса для пиков и кешей.

## Первый деплой

```bash
# 1. Поставить Docker и Docker Compose v2
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin

# 2. Склонировать репо
git clone https://github.com/<your-org>/Bag1V-Bucks.git /opt/bag1v-bucks
cd /opt/bag1v-bucks

# 3. Создать .env (скопируй из примера и заполни секреты)
cp backend/.env.example backend/.env
nano backend/.env
# Минимум что нужно отредактировать:
#   JWT_SECRET=...        (node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
#   WEBHOOK_SECRET=...    (то же)
#   ADMIN_DEFAULT_PASSWORD=... (что-то стойкое)
#   ANTILAV_API_KEY=...   (если нужны платежи)
#   ANTILAV_SHOP_ID=...

# 4. Конфиг nginx (если нужен SSL — сначала certbot, потом эта команда)
mkdir -p nginx
# поместить туда default.conf — пример ниже

# 5. Запуск
docker compose --profile production up -d --build
```

## Минимальный nginx конфиг (для теста без SSL)

`nginx/default.conf`:
```nginx
upstream backend  { server backend:3001;  }
upstream frontend { server frontend:3002; }

server {
  listen 80 default_server;
  server_name _;

  location /api/ {
    proxy_pass http://backend;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_read_timeout 300s;
  }

  location / {
    proxy_pass http://frontend;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

## Обновление на сервере

```bash
cd /opt/bag1v-bucks
git pull
docker compose --profile production up -d --build
docker compose logs -f backend   # смотрим что встало без ошибок
```

## Проверка после деплоя

```bash
# 1. Health endpoint
curl http://localhost:3001/api/health
# должен вернуть { "status": "ok", "checks": { "postgres": { "ok": true }, "redis": { "ok": true } } }

# 2. BrowserPool warmed up
docker compose logs backend | grep "Pool warmed up"
# должен быть: "Pool warmed up (3 browsers ready)"

# 3. Device auth flow работает
curl -X POST http://localhost:3001/api/api-purchase/auth/start
# должен вернуть { "userCode": "XXXXXXXX", ... }
```

## Памятка о ресурсах

- **Каждый параллельный заказ = ~400 MB RAM, ~1.2 vCPU в пиках.** При `ORDER_CONCURRENCY=3` это ~1.2 GB и ~3.5 vCPU. Если заказы начинают идти медленнее 60 сек — значит CPU упёрся, снизь до 2.
- **`/dev/shm` 64 MB по умолчанию убивает Chromium** (Cloudflare-проверки крашат страницу). У нас в compose `shm_size: 2gb` явно — НЕ убирай.
- **Без TR-прокси Epic возвращает `geo_locked_purchasing`.** Сервер в Хельсинки → нужно добавить минимум 3 рабочих TR-прокси через `POST /api/proxies` (они LRU-ротируются между параллельными заказами).
- **Razer-аккаунты с балансом ≥ требуемого TRY** должны быть в `razer_accounts` таблице. Без них `selectAccountForPurchase` вернёт null и заказ упадёт с ошибкой "No available Razer account".

## Откат

```bash
cd /opt/bag1v-bucks
git checkout <previous-commit>
docker compose --profile production up -d --build
```

## Troubleshooting

| Симптом | Причина | Что делать |
|---|---|---|
| `Page crashed` в логах при покупке | мало `/dev/shm` | `shm_size: 2gb` в compose |
| `geo_locked_purchasing` | нет TR-прокси | добавить через админку |
| `No available Razer account` | пул пустой / cooldown | долить балансы / `markSuccess` сбросит cooldown |
| `OOMKilled` контейнера | пик при `ORDER_CONCURRENCY > 3` | снизить до 2 или поставить mem_limit повыше |
| Health 503 | postgres или redis не отвечают | `docker compose ps`, `docker compose logs postgres redis` |
