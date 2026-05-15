# Requirements Document

## Введение

Замена текущей polling-based SSE реализации на event-driven SSE для мгновенной доставки обновлений прогресса заказа. Текущая реализация опрашивает БД каждые 3 секунды и возвращает последние 5 записей timeline без структурированной информации о шагах. Новая реализация должна пушить события мгновенно при завершении каждого шага в конвейере обработки заказа, предоставляя клиенту структурированные данные о фазе, шаге и прогрессе.

## Глоссарий

- **Order_Processing_Pipeline** — сервис `OrderProcessingService`, выполняющий последовательные шаги обработки заказа (auth, razer selection, balance check, proxy, browser, epic login, region change, purchase)
- **Event_Bus** — внутрипроцессный механизм доставки событий на основе rxjs Subject, фильтрующий события по orderId
- **SSE_Endpoint** — HTTP endpoint с декоратором `@Sse`, возвращающий Observable, подписанный на Event_Bus
- **Order_Step** — один из 10 дискретных шагов обработки заказа: `validating`, `auth`, `account_selection`, `balance_check`, `proxy_setup`, `browser_launch`, `epic_login`, `region_change`, `purchasing`, `completed`/`failed`
- **Step_Event** — структурированное событие, содержащее orderId, step, status (started/completed/failed), message и timestamp
- **Terminal_Status** — финальный статус заказа (`completed`, `failed`, `refunded`), после которого поток закрывается
- **SSE_Client** — фронтенд-клиент, подключённый через EventSource к SSE_Endpoint для конкретного orderId

## Требования

### Requirement 1: Event Bus для внутрипроцессной доставки событий

**User Story:** Как разработчик, я хочу иметь централизованную шину событий на основе rxjs Subject, чтобы Order_Processing_Pipeline мог эмитить структурированные события без привязки к конкретным подписчикам.

#### Acceptance Criteria

1. THE Event_Bus SHALL предоставлять метод `emit(event: Step_Event)` для публикации событий из Order_Processing_Pipeline
2. THE Event_Bus SHALL предоставлять метод `subscribe(orderId: string): Observable<Step_Event>` для подписки на события конкретного заказа
3. WHEN Event_Bus получает событие, THE Event_Bus SHALL доставлять событие только подписчикам с совпадающим orderId
4. WHEN нет активных подписчиков для orderId, THE Event_Bus SHALL отбрасывать событие без ошибок и побочных эффектов
5. THE Step_Event SHALL содержать поля: `orderId`, `step` (Order_Step), `status` ('started' | 'completed' | 'failed'), `message`, `timestamp`, `progress` (число 0-100)

### Requirement 2: Эмиссия событий из Order Processing Pipeline

**User Story:** Как разработчик, я хочу чтобы каждый шаг конвейера обработки заказа эмитил структурированное событие при старте и завершении, чтобы SSE_Client получал мгновенные обновления прогресса.

#### Acceptance Criteria

1. WHEN Order_Processing_Pipeline начинает шаг обработки, THE Order_Processing_Pipeline SHALL эмитить Step_Event со status='started' для данного шага
2. WHEN Order_Processing_Pipeline успешно завершает шаг, THE Order_Processing_Pipeline SHALL эмитить Step_Event со status='completed' для данного шага
3. IF шаг обработки завершается с ошибкой, THEN THE Order_Processing_Pipeline SHALL эмитить Step_Event со status='failed', включая сообщение об ошибке
4. THE Order_Processing_Pipeline SHALL эмитить события для всех 10 шагов: `validating`, `auth`, `account_selection`, `balance_check`, `proxy_setup`, `browser_launch`, `epic_login`, `region_change`, `purchasing`, `completed`/`failed`
5. WHEN событие эмитируется, THE Order_Processing_Pipeline SHALL сохранять текущую функциональность обработки заказа без изменений

### Requirement 3: Event-Driven SSE Endpoint

**User Story:** Как фронтенд-разработчик, я хочу чтобы SSE endpoint мгновенно пушил события при их возникновении, чтобы пользователь видел прогресс в реальном времени без задержки polling.

#### Acceptance Criteria

1. WHEN SSE_Client подключается к endpoint `/api/orders/:orderId/stream`, THE SSE_Endpoint SHALL подписаться на Event_Bus для указанного orderId и возвращать Observable потока событий
2. WHEN Event_Bus эмитит Step_Event для подписанного orderId, THE SSE_Endpoint SHALL мгновенно доставлять событие клиенту в формате SSE MessageEvent
3. WHEN заказ достигает Terminal_Status, THE SSE_Endpoint SHALL отправить финальное событие и завершить поток
4. WHEN SSE_Client отключается, THE SSE_Endpoint SHALL отписаться от Event_Bus и освободить ресурсы
5. THE SSE_Endpoint SHALL поддерживать множественные одновременные подключения для разных orderId без взаимного влияния

### Requirement 4: Обновление фронтенд-хука useOrderStream

**User Story:** Как пользователь, я хочу видеть детальный прогресс обработки моего заказа с информацией о текущем шаге и проценте выполнения, чтобы понимать на каком этапе находится покупка.

#### Acceptance Criteria

1. WHEN SSE_Client получает Step_Event, THE useOrderStream hook SHALL обновлять состояние с информацией о текущем шаге, статусе и прогрессе
2. THE useOrderStream hook SHALL предоставлять типизированный интерфейс `OrderStepEvent` с полями: step, status, message, progress, timestamp
3. WHEN соединение разрывается, THE useOrderStream hook SHALL автоматически переподключаться с экспоненциальным backoff
4. WHEN заказ достигает Terminal_Status, THE useOrderStream hook SHALL закрыть соединение и установить финальное состояние
5. THE useOrderStream hook SHALL сохранять обратную совместимость с существующими потребителями, предоставляя как новые поля (step, progress), так и существующие (status, timelineLogs)

### Requirement 5: Управление жизненным циклом подписок

**User Story:** Как разработчик, я хочу чтобы система автоматически очищала подписки при отключении клиента или завершении заказа, чтобы предотвратить утечки памяти.

#### Acceptance Criteria

1. WHEN SSE_Client отключается (закрытие вкладки, потеря сети), THE Event_Bus SHALL автоматически удалять подписку для данного orderId
2. WHEN заказ достигает Terminal_Status, THE Event_Bus SHALL завершать Observable для данного orderId и очищать внутренние ресурсы
3. WHILE Order_Processing_Pipeline обрабатывает заказ без подключённых SSE_Client, THE Event_Bus SHALL отбрасывать события без накопления в памяти
4. THE Event_Bus SHALL корректно обрабатывать множественные одновременные подписки на один orderId без дублирования событий

### Requirement 6: Формат и сериализация Step_Event

**User Story:** Как фронтенд-разработчик, я хочу получать структурированные JSON-события с предсказуемой схемой, чтобы корректно отображать прогресс пользователю.

#### Acceptance Criteria

1. THE SSE_Endpoint SHALL сериализовать Step_Event в JSON формат при отправке клиенту
2. THE Step_Event SHALL содержать числовое поле `progress` (0-100), отражающее общий прогресс обработки заказа
3. WHEN Step_Event сериализуется, THE SSE_Endpoint SHALL включать поле `timestamp` в формате ISO 8601
4. THE Step_Event SHALL содержать человекочитаемое поле `message` на русском языке, описывающее текущее действие
5. FOR ALL valid Step_Event objects, сериализация в JSON и десериализация обратно SHALL производить эквивалентный объект (round-trip свойство)
