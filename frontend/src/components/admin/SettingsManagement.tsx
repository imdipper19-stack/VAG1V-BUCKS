'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';

export default function SettingsManagement() {
  const [exchangeRate, setExchangeRate] = useState(1.63);
  const [orderLimits, setOrderLimits] = useState({ maxDaily: 100, maxPerUser: 5 });
  const [telegram, setTelegram] = useState({ botToken: '', chatId: '', enabled: false });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const [rateRes, limitsRes, telegramRes] = await Promise.all([
        fetch('/api/settings/exchange-rate'),
        fetch('/api/settings/order-limits'),
        fetch('/api/settings/telegram'),
      ]);

      if (rateRes.ok) {
        const rateData = await rateRes.json();
        if (rateData.success) setExchangeRate(rateData.data.rate);
      }

      if (limitsRes.ok) {
        const limitsData = await limitsRes.json();
        if (limitsData.success) setOrderLimits(limitsData.data);
      }

      if (telegramRes.ok) {
        const telegramData = await telegramRes.json();
        if (telegramData.success) setTelegram(telegramData.data);
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveExchangeRate = async () => {
    try {
      const response = await fetch('/api/settings/exchange-rate', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate: exchangeRate }),
      });
      if (response.ok) {
        alert('Курс валют обновлен');
      }
    } catch (error) {
      console.error('Failed to update exchange rate:', error);
    }
  };

  const handleSaveOrderLimits = async () => {
    try {
      const response = await fetch('/api/settings/order-limits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderLimits),
      });
      if (response.ok) {
        alert('Лимиты заказов обновлены');
      }
    } catch (error) {
      console.error('Failed to update order limits:', error);
    }
  };

  const handleSaveTelegram = async () => {
    try {
      const response = await fetch('/api/settings/telegram', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(telegram),
      });
      if (response.ok) {
        alert('Настройки Telegram обновлены');
      }
    } catch (error) {
      console.error('Failed to update telegram config:', error);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Загрузка...</div>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Настройки</h2>

      {/* Exchange Rate */}
      <div className="glass rounded-xl p-6">
        <h3 className="font-semibold mb-4">Курс валют (TRY к RUB)</h3>
        <div className="flex gap-4">
          <input
            type="number"
            step="0.01"
            value={exchangeRate}
            onChange={(e) => setExchangeRate(parseFloat(e.target.value))}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-purple-500"
          />
          <Button onClick={handleSaveExchangeRate}>Сохранить</Button>
        </div>
      </div>

      {/* Order Limits */}
      <div className="glass rounded-xl p-6">
        <h3 className="font-semibold mb-4">Лимиты заказов</h3>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm mb-2">Максимум заказов в день</label>
            <input
              type="number"
              value={orderLimits.maxDaily}
              onChange={(e) => setOrderLimits({ ...orderLimits, maxDaily: parseInt(e.target.value) })}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="block text-sm mb-2">Максимум заказов на пользователя</label>
            <input
              type="number"
              value={orderLimits.maxPerUser}
              onChange={(e) => setOrderLimits({ ...orderLimits, maxPerUser: parseInt(e.target.value) })}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-purple-500"
            />
          </div>
        </div>
        <Button onClick={handleSaveOrderLimits}>Сохранить</Button>
      </div>

      {/* Telegram */}
      <div className="glass rounded-xl p-6">
        <h3 className="font-semibold mb-4">Telegram уведомления</h3>
        <div className="space-y-4 mb-4">
          <div>
            <label className="block text-sm mb-2">Bot Token</label>
            <input
              type="text"
              value={telegram.botToken}
              onChange={(e) => setTelegram({ ...telegram, botToken: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-purple-500"
              placeholder="Введите bot token от BotFather"
            />
          </div>
          <div>
            <label className="block text-sm mb-2">Chat ID</label>
            <input
              type="text"
              value={telegram.chatId}
              onChange={(e) => setTelegram({ ...telegram, chatId: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-purple-500"
              placeholder="Введите chat ID для уведомлений"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="telegram-enabled"
              checked={telegram.enabled}
              onChange={(e) => setTelegram({ ...telegram, enabled: e.target.checked })}
              className="w-4 h-4"
            />
            <label htmlFor="telegram-enabled" className="text-sm">
              Включить уведомления
            </label>
          </div>
        </div>
        <Button onClick={handleSaveTelegram}>Сохранить</Button>
      </div>

      {/* Database Backup */}
      <div className="glass rounded-xl p-6">
        <h3 className="font-semibold mb-4">Бэкап базы данных</h3>
        <p className="text-sm text-gray-500 mb-4">
          Создайте резервную копию базы данных перед важными изменениями
        </p>
        <Button onClick={() => alert('Бэкап будет добавлен позже')}>Создать бэкап</Button>
      </div>
    </div>
  );
}
