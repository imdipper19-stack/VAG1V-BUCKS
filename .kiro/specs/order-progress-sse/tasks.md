# План реализации: Order Progress SSE

## Обзор

Замена polling-based SSE на event-driven архитектуру. Реализация идёт снизу вверх: сначала интерфейсы и Event Bus, затем интеграция в pipeline, затем обновление контроллера, и наконец фронтенд.

## Задачи

- [x] 1. Создать интерфейсы и константы
  - [x] 1.1 Создать файл `backend/src/queue/interfaces/step-event.interface.ts` с типами `OrderStep`, `StepStatus`, `StepEvent`
    - Определить union type `OrderStep` с 11 значениями: validating, auth, account_selection, balance_check, proxy_setup, browser_launch, epic_login, region_change, purchasing, completed, failed
    - Определить union type `StepStatus`: 'started' | 'completed' | 'failed'
    - Определить интерфейс `StepEvent` с полями: orderId, step, status, message, timestamp, progress
    - _Requirements: 1.5, 6.2, 6.3, 6.4_

  - [x] 1.2 Создать файл `backend/src/queue/constants/step-progress.ts` с маппингом шагов к прогрессу и сообщениями
    - Экспортировать `STEP_PROGRESS_MAP: Record<OrderStep, number>` с значениями от 5 до 100
    - Экспортировать `STEP_MESSAGES_RU: Record<OrderStep, string>` с русскоязычными описаниями каждого шага
    - _Requirements: 6.2, 6.4_

- [x] 2. Реализовать OrderEventBus
  - [x] 2.1 Создать файл `backend/src/queue/order-event-bus.service.ts`
    - Класс с декоратором `@Injectable()`
    - Приватное поле `subject = new Subject<StepEvent>()`
    - Метод `emit(event: StepEvent): void` — вызывает `this.subject.next(event)`
    - Метод `subscribe(orderId: string): Observable<StepEvent>` — возвращает `this.subject.asObservable().pipe(filter(e => e.orderId === orderId))`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [ ]* 2.2 Написать property-тесты для OrderEventBus
    - Установить `fast-check` в devDependencies бэкенда
    - **Property 1: Фильтрация событий по orderId**
    - **Validates: Requirements 1.3, 3.5**
    - **Property 2: Безопасность эмиссии без подписчиков**
    - **Validates: Requirements 1.4, 5.3**
    - **Property 3: Множественные подписчики получают по одной копии**
    - **Validates: Requirements 5.4**

- [x] 3. Интегрировать OrderEventBus в OrderProcessingService
  - [x] 3.1 Добавить инъекцию `OrderEventBus` в конструктор `OrderProcessingService`
    - Добавить `private readonly orderEventBus: OrderEventBus` в конструктор
    - Создать приватный метод `emitStep(orderId: string, step: OrderStep, status: StepStatus, message?: string): void`
    - Метод формирует StepEvent с timestamp (ISO 8601) и progress из STEP_PROGRESS_MAP
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.2 Добавить вызовы `emitStep()` в метод `processOrder()`
    - Добавить `emitStep(orderId, 'validating', 'started')` в начале processOrder
    - Добавить `emitStep(orderId, 'validating', 'completed')` после проверки epicAccessToken
    - Добавить пары started/completed для: auth, account_selection, balance_check, proxy_setup, browser_launch, epic_login, region_change, purchasing
    - Добавить `emitStep(orderId, 'completed', 'completed')` в handleSuccess
    - Добавить `emitStep(orderId, 'failed', 'failed', error.message)` в catch и handleFailure
    - Не менять существующую логику обработки — только добавить emit-вызовы между шагами
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 3.3 Написать property-тесты для emitStep
    - **Property 5: Структурная валидность StepEvent**
    - **Validates: Requirements 6.2, 6.3, 6.4**
    - **Property 4: Round-trip сериализации StepEvent**
    - **Validates: Requirements 6.5**

- [x] 4. Checkpoint — убедиться что бэкенд компилируется
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Обновить QueueModule и OrdersController
  - [x] 5.1 Зарегистрировать `OrderEventBus` в `QueueModule`
    - Добавить `OrderEventBus` в массив `providers`
    - Добавить `OrderEventBus` в массив `exports`
    - _Requirements: 1.1_

  - [x] 5.2 Заменить polling SSE на event-driven в `OrdersController`
    - Добавить инъекцию `OrderEventBus` в конструктор контроллера (импортировать QueueModule в OrdersModule или передать через exports)
    - Заменить тело метода `streamOrderStatus()`: подписаться на `orderEventBus.subscribe(orderId)`
    - Использовать `pipe(map(...))` для преобразования StepEvent в MessageEvent с JSON.stringify
    - Использовать `takeWhile()` с `inclusive: true` для завершения потока при terminal step (completed/failed)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 6. Обновить фронтенд-хук useOrderStream
  - [x] 6.1 Добавить интерфейс `OrderStepEvent` и обновить хук
    - Добавить интерфейс `OrderStepEvent` с полями: orderId, step, status, message, timestamp, progress
    - Добавить функцию `mapToLegacy(event: OrderStepEvent): OrderStreamEvent` для обратной совместимости
    - Добавить состояния `currentStep`, `progress`, `stepHistory` в возвращаемый объект хука
    - Обновить парсинг `onmessage` для нового формата StepEvent
    - Сохранить обратную совместимость: маппить StepEvent в legacy OrderStreamEvent
    - Добавить экспоненциальный backoff при переподключении (начальная задержка 1с, макс 30с)
    - Закрывать EventSource при terminal step (completed/failed)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 6.2 Написать property-тест для mapToLegacy
    - **Property 6: Полнота маппинга в legacy-формат**
    - **Validates: Requirements 4.5**

- [x] 7. Финальный checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Примечания

- Задачи с `*` — опциональные (property-тесты), можно пропустить для быстрого MVP
- Каждая задача ссылается на конкретные требования для трассируемости
- Property-тесты используют библиотеку `fast-check` с минимум 100 итерациями
- Существующая логика `OrderProcessingService` не меняется — только добавляются emit-вызовы
