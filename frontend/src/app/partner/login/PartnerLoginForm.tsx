'use client';

import { useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

/**
 * PartnerLoginForm
 *
 * Клиентская форма входа в кабинет партнёра. Отделена от
 * `page.tsx`, потому что использует `useSearchParams()` — App Router
 * требует Suspense-обёртку вокруг таких компонентов.
 *
 * Поведение:
 *   - `POST /api/partner/auth/login` с `credentials: 'include'`,
 *     чтобы бекенд мог поставить httpOnly cookie `partner_token`,
 *     который потом проверяет `cabinet/layout.tsx`.
 *   - 401 → выводим точный текст ошибки от бекенда
 *     (`Неверный логин или пароль` / `Учётная запись отключена`,
 *     Requirement 11.4 / 11.6); если поле message пустое, падаем
 *     в общий русский текст.
 *   - 200 → `router.push('/partner/cabinet')` плюс `router.refresh()`,
 *     чтобы серверный layout кабинета пересчитался уже с cookie.
 *   - `?passwordSet=1` в URL → зелёный баннер «Пароль установлен»
 *     для пользователей, пришедших с `/partner/invite`.
 */
export default function PartnerLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const passwordSet = searchParams.get('passwordSet') === '1';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch(`${API_URL}/partner/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });

      if (response.ok) {
        // Серверный layout `/partner/cabinet` читает cookie на каждом
        // запросе, поэтому достаточно push + refresh.
        router.push('/partner/cabinet');
        router.refresh();
        return;
      }

      // Пытаемся достать русское сообщение из тела ответа.
      // NestJS отдаёт `{ message: '...' }` или `{ message: ['...'] }`.
      let serverMessage = '';
      try {
        const data = await response.json();
        if (Array.isArray(data?.message)) {
          serverMessage = data.message.join(' ');
        } else if (typeof data?.message === 'string') {
          serverMessage = data.message;
        }
      } catch {
        /* тело не JSON — игнорируем */
      }

      if (response.status === 401) {
        setError(serverMessage || 'Неверный логин или пароль');
      } else {
        setError(serverMessage || 'Произошла ошибка. Попробуйте ещё раз.');
      }
    } catch {
      // Сетевая ошибка / CORS / сервер недоступен.
      setError('Произошла ошибка. Попробуйте ещё раз.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div
        className="w-full max-w-[420px] rounded-[24px] p-10 relative overflow-hidden"
        style={{
          background: 'rgba(255, 255, 255, 0.02)',
          backdropFilter: 'blur(40px)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
        {/* Logo / brand */}
        <div className="flex justify-center mb-8">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)',
              boxShadow: '0 8px 40px rgba(139, 92, 246, 0.5)',
            }}
          >
            <span className="text-3xl font-extrabold text-white">V</span>
          </div>
        </div>

        <h1 className="text-2xl font-bold mb-2 text-center" style={{ color: '#f4f4f5' }}>
          Кабинет партнёра
        </h1>
        <p className="text-sm mb-8 text-center" style={{ color: '#71717a' }}>
          Вход для одобренных партнёров
        </p>

        {passwordSet && (
          <div
            className="p-4 rounded-xl text-sm mb-6"
            style={{
              background: 'rgba(34, 197, 94, 0.12)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              color: '#22c55e',
            }}
          >
            Пароль установлен. Войдите с новыми данными.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              className="block text-xs uppercase tracking-widest mb-3"
              style={{ color: '#71717a' }}
            >
              Логин
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              disabled={loading}
              className="w-full px-5 py-4 rounded-xl outline-none transition-all disabled:opacity-50"
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                color: '#f4f4f5',
              }}
              placeholder="ваш логин"
            />
          </div>

          <div>
            <label
              className="block text-xs uppercase tracking-widest mb-3"
              style={{ color: '#71717a' }}
            >
              Пароль
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              disabled={loading}
              className="w-full px-5 py-4 rounded-xl outline-none transition-all disabled:opacity-50"
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                color: '#f4f4f5',
              }}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div
              className="p-4 rounded-xl text-sm"
              style={{
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#ef4444',
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 rounded-xl font-semibold text-base transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
            style={{
              background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
              color: 'white',
              boxShadow: '0 4px 20px rgba(139, 92, 246, 0.4)',
            }}
          >
            {loading ? 'Вход…' : 'Войти'}
          </button>
        </form>

        <p className="text-xs text-center mt-6" style={{ color: '#71717a' }}>
          Не помните пароль? Запросите ссылку у поддержки.
        </p>

        <div
          className="mt-8 pt-6 flex items-center justify-between text-sm"
          style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}
        >
          <Link
            href="/partner"
            className="transition-all hover:opacity-70"
            style={{ color: '#71717a' }}
          >
            ← Назад на лендинг
          </Link>
          <Link
            href="/"
            className="transition-all hover:opacity-70"
            style={{ color: '#71717a' }}
          >
            На главную
          </Link>
        </div>
      </div>
    </div>
  );
}
