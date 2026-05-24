'use client';

import { useEffect, useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

/** Минимальная длина пароля — должна совпадать с MIN_PASSWORD_LENGTH в PartnerAuthService. */
const MIN_PASSWORD_LENGTH = 8;

interface InviteInfo {
  partnerId: string;
  displayName: string;
  username: string;
}

type InviteState =
  | { kind: 'loading' }
  | { kind: 'invalid'; message: string }
  | { kind: 'ready'; info: InviteInfo };

/**
 * PartnerInviteForm
 *
 * Двухфазная форма установки пароля по invite-ссылке.
 *
 * Фаза 1 — pre-flight:
 *   На монтировании читаем `?token=` и дёргаем
 *   `GET /api/partner/auth/invite-info`. Если бекенд вернул 4xx,
 *   показываем error-card; форма не появляется. Это спасает партнёра
 *   от заполнения формы под уже истёкшим/использованным токеном.
 *
 * Фаза 2 — submit:
 *   После клиентской валидации (длина ≥ 8, поля совпадают) шлём
 *   `POST /api/partner/auth/set-password`. На успех редиректим в
 *   `/partner/login?passwordSet=1` — баннер «Пароль установлен»
 *   рендерит уже LoginForm.
 */
export default function PartnerInviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [state, setState] = useState<InviteState>({ kind: 'loading' });
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ── Pre-flight: validate the invite token before showing the form ──
  useEffect(() => {
    if (!token) {
      setState({
        kind: 'invalid',
        message: 'Ссылка-приглашение недействительна или истекла. Обратитесь к менеджеру.',
      });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `${API_URL}/partner/auth/invite-info?token=${encodeURIComponent(token)}`,
          { method: 'GET', credentials: 'include' },
        );

        if (cancelled) return;

        if (response.ok) {
          const body = await response.json();
          const info = body?.data as InviteInfo | undefined;
          if (info?.partnerId && info.username && info.displayName) {
            setState({ kind: 'ready', info });
            return;
          }
        }

        setState({
          kind: 'invalid',
          message: 'Ссылка-приглашение недействительна или истекла. Обратитесь к менеджеру.',
        });
      } catch {
        if (cancelled) return;
        setState({
          kind: 'invalid',
          message: 'Не удалось проверить ссылку. Попробуйте позже или обратитесь к менеджеру.',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError('');

    if (password.length < MIN_PASSWORD_LENGTH) {
      setSubmitError(`Пароль должен содержать не менее ${MIN_PASSWORD_LENGTH} символов`);
      return;
    }
    if (password !== passwordConfirm) {
      setSubmitError('Пароли не совпадают');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`${API_URL}/partner/auth/set-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token, password }),
      });

      if (response.ok) {
        router.push('/partner/login?passwordSet=1');
        return;
      }

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
      setSubmitError(serverMessage || 'Не удалось установить пароль. Попробуйте ещё раз.');
    } catch {
      setSubmitError('Произошла ошибка. Попробуйте ещё раз.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div
        className="w-full max-w-[460px] rounded-[24px] p-10 relative overflow-hidden"
        style={{
          background: 'rgba(255, 255, 255, 0.02)',
          backdropFilter: 'blur(40px)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
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
          Установка пароля
        </h1>
        <p className="text-sm mb-8 text-center" style={{ color: '#71717a' }}>
          Партнёрский кабинет Bag1V-Bucks
        </p>

        {state.kind === 'loading' && (
          <div className="text-center py-8 text-sm" style={{ color: '#71717a' }}>
            Проверяем ссылку…
          </div>
        )}

        {state.kind === 'invalid' && (
          <>
            <div
              className="p-4 rounded-xl text-sm mb-6"
              style={{
                background: 'rgba(239, 68, 68, 0.12)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#ef4444',
              }}
            >
              {state.message}
            </div>
            <div className="text-center">
              <Link
                href="/partner"
                className="text-sm transition-all hover:opacity-70"
                style={{ color: '#71717a' }}
              >
                ← Вернуться на лендинг
              </Link>
            </div>
          </>
        )}

        {state.kind === 'ready' && (
          <>
            <div
              className="p-4 rounded-xl text-sm mb-6"
              style={{
                background: 'rgba(139, 92, 246, 0.08)',
                border: '1px solid rgba(139, 92, 246, 0.2)',
                color: '#f4f4f5',
              }}
            >
              <div className="text-xs uppercase tracking-widest mb-2" style={{ color: '#71717a' }}>
                Партнёр
              </div>
              <div className="font-semibold mb-1">{state.info.displayName}</div>
              <div className="text-sm" style={{ color: '#a1a1aa' }}>
                Логин: <span style={{ color: '#f4f4f5' }}>{state.info.username}</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  className="block text-xs uppercase tracking-widest mb-3"
                  style={{ color: '#71717a' }}
                >
                  Новый пароль
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  disabled={submitting}
                  className="w-full px-5 py-4 rounded-xl outline-none transition-all disabled:opacity-50"
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    color: '#f4f4f5',
                  }}
                  placeholder={`не менее ${MIN_PASSWORD_LENGTH} символов`}
                />
              </div>

              <div>
                <label
                  className="block text-xs uppercase tracking-widest mb-3"
                  style={{ color: '#71717a' }}
                >
                  Подтвердите пароль
                </label>
                <input
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  disabled={submitting}
                  className="w-full px-5 py-4 rounded-xl outline-none transition-all disabled:opacity-50"
                  style={{
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    color: '#f4f4f5',
                  }}
                  placeholder="повторите пароль"
                />
              </div>

              {submitError && (
                <div
                  className="p-4 rounded-xl text-sm"
                  style={{
                    background: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#ef4444',
                  }}
                >
                  {submitError}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-4 rounded-xl font-semibold text-base transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
                style={{
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                  color: 'white',
                  boxShadow: '0 4px 20px rgba(139, 92, 246, 0.4)',
                }}
              >
                {submitting ? 'Сохраняем…' : 'Установить пароль'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
