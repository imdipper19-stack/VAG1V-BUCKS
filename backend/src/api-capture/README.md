# API Capture — Перехват запросов при покупке V-Bucks

## Цель

Записать ВСЕ HTTP-запросы которые делает браузер при покупке V-Bucks через Epic Store + Razer Gold.
На основе этой записи мы создадим прямой API-модуль (без Playwright).

## Как пользоваться

### 1. Подготовка

```bash
cd backend
npx ts-node src/api-capture/capture.ts
```

### 2. Что происходит

1. Открывается браузер (НЕ headless — ты видишь экран)
2. Ты вручную проходишь полный flow покупки V-Bucks
3. Утилита записывает ВСЕ network-запросы в файл
4. После покупки нажимаешь Ctrl+C — запись сохраняется

### 3. Какие запросы нас интересуют

- `store.epicgames.com` — каталог и покупка
- `payment-website-pci.ol.epicgames.com` — checkout и оплата  
- `*.razer.com` / `gold.razer.com` — подтверждение Razer Gold
- `ecommerceintegration-public-service-ecomprod*.ol.epicgames.com` — ecom API

### 4. Результат

Файл `captured-requests.json` с массивом всех запросов:
- URL, method, headers, body (request)
- Status, headers, body (response)

Из него мы извлечём точную последовательность API-вызовов для покупки.
