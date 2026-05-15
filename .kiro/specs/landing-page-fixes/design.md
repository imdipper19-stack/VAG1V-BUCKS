# Landing Page Fixes — Дизайн исправления багов

## Overview

На лендинге (`frontend/src/app/page.tsx`) обнаружены два бага, подрывающих доверие пользователей:

1. **Секция «Последние успешные выдачи»** показывает захардкоженные фейковые данные вместо реальных завершённых заказов из API.
2. **Секция «Пакеты для быстрой покупки»** исчезает при клике на карточку пакета из-за конфликта IntersectionObserver с React-ререндером.

Стратегия исправления:
- Баг 1: Добавить загрузку реальных заказов через `ordersApi.list({ status: 'completed', limit: 4 })` с fallback на статичные данные.
- Баг 2: Убрать класс `landing-reveal` с отдельных карточек пакетов — секция-обёртка уже анимируется, карточки внутри неё не нуждаются в отдельной reveal-анимации.

## Glossary

- **Bug_Condition (C)**: Условие, при котором проявляется баг — для Бага 1: всегда (данные никогда не загружаются); для Бага 2: клик по карточке пакета после того, как секция уже видима
- **Property (P)**: Желаемое поведение — для Бага 1: отображение реальных заказов из API; для Бага 2: секция остаётся видимой после клика
- **Preservation**: Существующее поведение, которое не должно измениться — загрузка пакетов, scroll-reveal анимация, навигация к оплате
- **`LIVE_ORDERS`**: Статичный массив fallback-данных для секции выдач в `page.tsx`
- **`ordersApi.list`**: Метод в `frontend/src/lib/api.ts` для запроса заказов с фильтрацией по статусу
- **`landing-reveal`**: CSS-класс, запускающий IntersectionObserver-анимацию появления элемента
- **`is-visible`**: CSS-класс, добавляемый IntersectionObserver при пересечении viewport — делает элемент видимым
- **`selectedPackage`**: React state, хранящий выбранный пакет V-Bucks (вызывает ререндер при изменении)

## Bug Details

### Bug Condition

#### Баг 1: Захардкоженные данные в «Последние успешные выдачи»

Баг проявляется всегда при загрузке лендинга. Секция «Последние успешные выдачи» рендерит статичный массив `LIVE_ORDERS` и никогда не обращается к API за реальными завершёнными заказами.

**Formal Specification:**
```
FUNCTION isBugCondition_LiveOrders(input)
  INPUT: input типа LandingPageLoad
  OUTPUT: boolean
  
  // Баг проявляется при каждой загрузке — API заказов не вызывается
  RETURN TRUE
END FUNCTION
```

#### Баг 2: Исчезновение секции пакетов при клике

Баг проявляется когда пользователь кликает на карточку пакета после того, как секция уже стала видимой через scroll-reveal. React выполняет ререндер карточек (из-за изменения `selectedPackage`), но IntersectionObserver уже вызвал `unobserve` на этих элементах. Новые/обновлённые DOM-элементы получают класс `landing-reveal` без `is-visible`, и остаются невидимыми.

**Formal Specification:**
```
FUNCTION isBugCondition_PackageDisappear(input)
  INPUT: input типа UserInteraction
  OUTPUT: boolean
  
  RETURN input.action = "clickPackageCard"
         AND input.sectionAlreadyRevealed = TRUE
         AND input.causesRerender = TRUE
END FUNCTION
```

### Examples

- **Баг 1, пример 1**: Пользователь открывает лендинг → видит `#VB-2418, 2 400 V-Bucks, 7 минут, Выдано` — это фейковые данные, не соответствующие реальным заказам в системе
- **Баг 1, пример 2**: В системе завершён заказ `#VB-2501` на 800 V-Bucks 3 минуты назад → лендинг всё равно показывает `#VB-2418` из захардкоженного массива
- **Баг 2, пример 1**: Пользователь прокрутил до секции пакетов (карточки появились с анимацией) → кликнул на «800 V-Bucks» → вся секция пакетов исчезает
- **Баг 2, пример 2**: Пользователь выбрал пакет 4500 → затем переключился на 2400 → секция снова исчезает (каждый клик вызывает ререндер)
- **Баг 2, edge case**: Если IntersectionObserver не поддерживается браузером — все элементы сразу получают `is-visible`, баг не проявляется

## Expected Behavior

### Preservation Requirements

**Неизменное поведение:**
- Загрузка пакетов из `pricingApi.list()` должна продолжать работать независимо от загрузки заказов
- Scroll-reveal анимация для всех остальных секций (hero, trust, FAQ, steps) должна работать как прежде
- Навигация «Перейти к оплате» должна корректно перенаправлять на `/payment?amount=...&price=...`
- Панель «К покупке выбран пакет» должна обновляться при смене выбранного пакета
- Fallback на `FALLBACK_PACKAGES` при ошибке API пакетов должен продолжать работать
- Отображение остальных секций лендинга не должно блокироваться загрузкой заказов

**Scope:**
Все взаимодействия, НЕ связанные с секцией «Последние успешные выдачи» и кликами по карточкам пакетов, должны быть полностью не затронуты исправлениями. Это включает:
- Навигацию по якорным ссылкам
- Отображение hero-секции и mockup
- FAQ аккордеон
- Footer и ссылки на документы
- Кнопку Telegram-поддержки

## Hypothesized Root Cause

### Баг 1: Захардкоженные данные

1. **Отсутствие вызова API**: В `useEffect` загружаются только пакеты через `pricingApi.list()`. Вызов `ordersApi.list()` для завершённых заказов отсутствует полностью — это не ошибка в логике, а недоработка (feature gap).

2. **Отсутствие state для live-заказов**: Нет `useState` для хранения загруженных заказов — компонент рендерит напрямую из константы `LIVE_ORDERS`.

### Баг 2: Исчезновение секции пакетов

1. **`landing-reveal` на отдельных карточках**: Каждая `<button>` карточки пакета имеет класс `landing-reveal`. IntersectionObserver наблюдает за ними, добавляет `is-visible` при пересечении viewport, затем вызывает `unobserve`.

2. **Ререндер сбрасывает CSS-классы**: При изменении `selectedPackage` React обновляет `className` карточек (добавляет/убирает `featured`). Поскольку `className` задаётся как template literal, React перезаписывает весь атрибут — `is-visible`, добавленный через DOM API (`classList.add`), теряется.

3. **Observer не перезапускается**: `useEffect` с observer зависит от `[mounted, packages.length]` — он НЕ перезапускается при изменении `selectedPackage`. Элементы, потерявшие `is-visible`, остаются невидимыми навсегда.

4. **Корневая причина**: Класс `landing-reveal` не нужен на карточках пакетов — секция `#packages` уже имеет `landing-reveal` на обёртке. Карточки внутри видимой секции должны быть видимы без отдельной reveal-анимации.

## Correctness Properties

Property 1: Bug Condition - Загрузка реальных заказов в секцию выдач

_For any_ загрузку лендинга, где API заказов доступен и возвращает завершённые заказы, исправленный компонент SHALL отобразить реальные данные из API (orderId, количество V-Bucks, относительное время завершения, статус «Выдано») в секции «Последние успешные выдачи». При ошибке API или пустом ответе SHALL отобразить fallback-данные из `LIVE_ORDERS`.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Bug Condition - Видимость секции пакетов после клика

_For any_ клик по карточке пакета, когда секция уже видима (прошла scroll-reveal), исправленный компонент SHALL сохранить видимость всех карточек пакетов и корректно выделить выбранный пакет классом `featured`.

**Validates: Requirements 2.4, 2.5**

Property 3: Preservation - Независимость загрузки пакетов и заказов

_For any_ загрузку лендинга, исправленный компонент SHALL продолжать загружать пакеты из `pricingApi.list()` независимо от результата загрузки заказов, сохраняя текущее поведение fallback на `FALLBACK_PACKAGES`.

**Validates: Requirements 3.1, 3.2, 3.3**

Property 4: Preservation - Scroll-reveal анимация и навигация

_For any_ взаимодействие, НЕ связанное с кликом по карточке пакета (прокрутка, навигация, клик «Перейти к оплате»), исправленный компонент SHALL производить тот же результат, что и оригинальный — scroll-reveal анимация работает, навигация к оплате корректна, панель выбранного пакета обновляется.

**Validates: Requirements 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

**File**: `frontend/src/app/page.tsx`

#### Баг 1: Загрузка реальных заказов

1. **Добавить импорт `ordersApi`**: Добавить `ordersApi` в импорт из `@/lib/api`

2. **Добавить state для live-заказов**:
   ```typescript
   const [liveOrders, setLiveOrders] = useState(LIVE_ORDERS);
   ```

3. **Добавить загрузку заказов в useEffect** (в существующий или новый):
   ```typescript
   ordersApi
     .list({ status: 'completed', limit: 4 })
     .then((res) => {
       if (res.success && res.data && res.data.length > 0) {
         const mapped = res.data.map((order) => [
           `#${order.orderId}`,
           `${order.vbucksAmount.toLocaleString('ru-RU')} V-Bucks`,
           formatRelativeTime(order.completedAt),
           'Выдано',
         ]);
         setLiveOrders(mapped);
       }
     })
     .catch(() => {
       // Оставляем fallback — LIVE_ORDERS
     });
   ```

4. **Добавить helper-функцию `formatRelativeTime`**: Вычисляет разницу между `now` и `completedAt`, возвращает строку вида «5 минут», «1 час», «2 дня».

5. **Заменить `LIVE_ORDERS` на `liveOrders` в JSX**: В секции `#live` заменить `LIVE_ORDERS.map(...)` на `liveOrders.map(...)`.

#### Баг 2: Убрать `landing-reveal` с карточек пакетов

1. **Удалить `landing-reveal` из className карточек**: В `<button>` внутри `landing-package-grid` убрать `landing-reveal` из template literal:
   ```typescript
   // Было:
   className={`landing-pack landing-reveal ${pkg.popular || isSelected ? 'featured' : ''}`}
   // Стало:
   className={`landing-pack ${pkg.popular || isSelected ? 'featured' : ''}`}
   ```

   Секция `#packages` уже имеет `landing-reveal` на обёртке `landing-section`, поэтому вся секция анимируется при прокрутке. Карточки внутри неё не нуждаются в отдельной анимации.

2. **Убрать `data-delay` с карточек** (опционально): Атрибут `data-delay` без `landing-reveal` не имеет эффекта, но можно оставить для чистоты.

## Testing Strategy

### Validation Approach

Стратегия тестирования следует двухфазному подходу: сначала подтвердить наличие бага на нефиксированном коде (exploratory), затем проверить корректность исправления (fix checking) и сохранение существующего поведения (preservation checking).

### Exploratory Bug Condition Checking

**Goal**: Подтвердить наличие багов на текущем коде ДО внесения исправлений. Подтвердить или опровергнуть гипотезу о корневой причине.

**Test Plan**: Написать тесты, которые проверяют текущее поведение компонента. Запустить на нефиксированном коде для наблюдения ожидаемых провалов.

**Test Cases**:
1. **Live Orders API Call**: Проверить, что при рендере компонента вызывается `ordersApi.list({ status: 'completed', limit: 4 })` (провалится на нефиксированном коде — вызов отсутствует)
2. **Live Orders Display**: Проверить, что после успешного ответа API секция отображает реальные данные (провалится — всегда показывает LIVE_ORDERS)
3. **Package Visibility After Click**: Проверить, что после клика по карточке пакета все карточки остаются видимыми (провалится — карточки теряют `is-visible`)
4. **Package Re-render Class**: Проверить, что после ререндера карточки не имеют `landing-reveal` без `is-visible` (провалится — имеют)

**Expected Counterexamples**:
- `ordersApi.list` никогда не вызывается при загрузке лендинга
- После `setSelectedPackage` карточки теряют класс `is-visible` и становятся невидимыми
- Возможные причины: отсутствие вызова API, конфликт IntersectionObserver с React-ререндером

### Fix Checking

**Goal**: Проверить, что для всех входов, где проявляется баг, исправленная функция производит ожидаемое поведение.

**Pseudocode:**
```
// Баг 1
FOR ALL pageLoad WHERE isBugCondition_LiveOrders(pageLoad) DO
  result := renderLandingPage_fixed(pageLoad)
  IF apiAvailable AND apiReturnsData THEN
    ASSERT result.liveOrdersSection.dataSource = "API"
    ASSERT result.liveOrdersSection.orders.length <= 4
    ASSERT EACH order IN result.liveOrdersSection.orders HAS (orderId, vbucks, relativeTime, status)
  ELSE
    ASSERT result.liveOrdersSection.dataSource = "fallback"
    ASSERT result.liveOrdersSection.orders = LIVE_ORDERS
  END IF
END FOR

// Баг 2
FOR ALL interaction WHERE isBugCondition_PackageDisappear(interaction) DO
  result := handlePackageClick_fixed(interaction)
  ASSERT ALL cards IN result.packageSection ARE visible
  ASSERT result.selectedCard.hasClass("featured") = TRUE
END FOR
```

### Preservation Checking

**Goal**: Проверить, что для всех входов, где баг НЕ проявляется, исправленная функция производит тот же результат, что и оригинальная.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition_LiveOrders(input) AND NOT isBugCondition_PackageDisappear(input) DO
  ASSERT renderLandingPage_original(input) = renderLandingPage_fixed(input)
END FOR
```

**Testing Approach**: Property-based тестирование рекомендуется для preservation checking, потому что:
- Автоматически генерирует множество тестовых случаев по всему домену входов
- Ловит edge cases, которые ручные unit-тесты могут пропустить
- Даёт сильные гарантии, что поведение не изменилось для всех не-багованных входов

**Test Plan**: Наблюдать поведение на нефиксированном коде для не-багованных взаимодействий (загрузка пакетов, навигация, scroll), затем написать тесты, фиксирующие это поведение.

**Test Cases**:
1. **Pricing API Preservation**: Проверить, что `pricingApi.list()` продолжает вызываться и пакеты загружаются корректно после добавления загрузки заказов
2. **Navigation Preservation**: Проверить, что клик «Перейти к оплате» корректно формирует URL с выбранным пакетом
3. **Buy Panel Update Preservation**: Проверить, что панель «К покупке выбран пакет» обновляется при смене пакета
4. **Scroll Reveal Preservation**: Проверить, что scroll-reveal анимация работает для всех остальных секций (hero, trust, FAQ)

### Unit Tests

- Тест загрузки заказов: mock `ordersApi.list`, проверить отображение реальных данных
- Тест fallback при ошибке API: mock reject `ordersApi.list`, проверить отображение `LIVE_ORDERS`
- Тест fallback при пустом ответе: mock пустой массив, проверить отображение `LIVE_ORDERS`
- Тест `formatRelativeTime`: проверить корректное форматирование для минут, часов, дней
- Тест видимости карточек: проверить отсутствие `landing-reveal` на карточках пакетов
- Тест выделения выбранного пакета: проверить наличие `featured` на выбранной карточке

### Property-Based Tests

- Генерация случайных ответов API (разное количество заказов, разные vbucksAmount, разные completedAt) — проверить корректное отображение
- Генерация случайных последовательностей кликов по пакетам — проверить, что секция всегда остаётся видимой
- Генерация случайных состояний (API доступен/недоступен, пустой/полный ответ) — проверить корректный fallback

### Integration Tests

- Полный flow: загрузка лендинга → проверка секции выдач с реальными данными → выбор пакета → переход к оплате
- Тест устойчивости: загрузка при недоступном API заказов → fallback данные → выбор пакета → секция видима → оплата работает
- Тест последовательных кликов: выбор пакета 800 → 2400 → 4500 → 12500 → все карточки видимы, панель обновляется корректно
