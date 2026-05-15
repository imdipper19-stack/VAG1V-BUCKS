import { OrderStep } from '../interfaces/step-event.interface';

export const STEP_PROGRESS_MAP: Record<OrderStep, number> = {
  validating: 5,
  auth: 15,
  account_selection: 25,
  balance_check: 35,
  proxy_setup: 40,
  browser_launch: 50,
  epic_login: 60,
  region_change: 70,
  purchasing: 85,
  completed: 100,
  failed: 100,
};

export const STEP_MESSAGES_RU: Record<OrderStep, string> = {
  validating: 'Проверка данных заказа...',
  auth: 'Авторизация в Epic Games...',
  account_selection: 'Выбор аккаунта для покупки...',
  balance_check: 'Проверка баланса...',
  proxy_setup: 'Настройка соединения...',
  browser_launch: 'Запуск браузера...',
  epic_login: 'Вход в Epic Games...',
  region_change: 'Смена региона...',
  purchasing: 'Покупка V-Bucks...',
  completed: 'Заказ выполнен!',
  failed: 'Ошибка обработки заказа',
};
