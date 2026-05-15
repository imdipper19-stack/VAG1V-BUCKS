'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { adminAuthApi } from '@/lib/api';
import { saveAdminSession } from '@/lib/auth';

export default function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await adminAuthApi.login(username, password);

      if (response.success) {
        // Сохраняем сессию (localStorage + cookie для middleware)
        saveAdminSession(response.data.token, response.data.admin);

        // Возвращаем на исходную страницу, если middleware сохранил её в ?redirect
        const redirect = searchParams.get('redirect') || '/admin';
        // Защита от open-redirect: разрешаем только внутренние пути
        const safeRedirect = redirect.startsWith('/') && !redirect.startsWith('//')
          ? redirect
          : '/admin';

        router.push(safeRedirect);
      } else {
        setError(response.message || 'Ошибка входа');
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Ошибка подключения');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div
        className="w-full max-w-[420px] rounded-[24px] p-10 text-center relative overflow-hidden"
        style={{
          background: 'rgba(255, 255, 255, 0.02)',
          backdropFilter: 'blur(40px)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
        {/* Logo */}
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

        <h1
          className="text-2xl font-bold mb-2"
          style={{ color: '#f4f4f5' }}
        >
          Bag1V-Bucks
        </h1>
        <p className="text-sm mb-10" style={{ color: '#71717a' }}>
          Вход в панель администратора
        </p>

        <form onSubmit={handleLogin} className="space-y-5">
          <div className="text-left">
            <label
              className="block text-xs uppercase tracking-widest mb-3"
              style={{ color: '#71717a' }}
            >
              Имя пользователя
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full px-5 py-4 rounded-xl outline-none transition-all"
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                color: '#f4f4f5',
              }}
              placeholder="admin"
            />
          </div>

          <div className="text-left">
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
              required
              className="w-full px-5 py-4 rounded-xl outline-none transition-all"
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
              className="p-4 rounded-xl text-sm text-left"
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
            className="w-full py-4 rounded-xl font-semibold text-base transition-all hover:-translate-y-0.5 disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
              color: 'white',
              boxShadow: '0 4px 20px rgba(139, 92, 246, 0.4)',
            }}
          >
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>

        <div className="mt-8 pt-8" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
          <a
            href="/buyer"
            className="text-sm transition-all hover:opacity-70"
            style={{ color: '#71717a' }}
          >
            Вернуться на главную
          </a>
        </div>
      </div>
    </div>
  );
}
