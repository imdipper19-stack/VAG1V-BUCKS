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
  const [userCode, setUserCode] = useState<string>('');
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initiateAuth = async () => {
      try {
        const response = await authApi.initiate(orderId);
        if (response.success && response.data?.userCode) {
          setUserCode(response.data.userCode);
        } else {
          setError(response.message || 'Не удалось получить код авторизации');
        }
      } catch (error: any) {
        console.error('Failed to initiate auth:', error);
        setError(error?.response?.data?.message || error?.message || 'Ошибка подключения к серверу');
      } finally {
        setLoading(false);
      }
    };

    initiateAuth();
  }, [orderId]);

  useEffect(() => {
    if (!userCode || authenticated) return;

    const pollAuth = async () => {
      setChecking(true);
      setError(null);

      try {
        const response = await authApi.poll(orderId);

        if (response.data?.authenticated) {
          setAuthenticated(true);
          setTimeout(() => {
            window.location.href = `/order/${orderId}/timeline`;
          }, 1500);
        } else if (response.data?.error === 'expired') {
          setError('Код истёк. Обновите страницу для нового кода.');
        } else if (response.data?.error === 'pending') {
          // Нормально - пользователь ещё не подтвердил
        }
      } catch (error: any) {
        console.error('Auth poll failed:', error);
        setError(error?.response?.data?.message || 'Ошибка проверки авторизации');
      } finally {
        setChecking(false);
      }
    };

    // Опрос каждые 5 секунд
    const interval = setInterval(pollAuth, 5000);

    // Сразу проверим
    pollAuth();

    return () => clearInterval(interval);
  }, [userCode, authenticated, orderId]);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Форматируем код как XXXX-XXXX
  const formatCode = (code: string) => {
    const cleanCode = code.replace(/-/g, '').substring(0, 8);
    const part1 = cleanCode.substring(0, 4);
    const part2 = cleanCode.substring(4, 8);

    return (
      <div className="flex justify-center gap-2 flex-wrap">
        <div className="flex gap-1">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={`a-${i}`}
              className="w-[52px] h-[72px] flex items-center justify-center font-mono text-[28px] font-semibold rounded-xl"
              style={{
                background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.03) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                boxShadow: '0 4px 15px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
                animation: `charPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) backwards`,
                animationDelay: `${0.1 + i * 0.05}s`,
                textShadow: '0 0 30px rgba(139, 92, 246, 0.5)',
              }}
            >
              {part1[i] || ''}
            </div>
          ))}
        </div>

        <div
          className="flex items-center justify-center text-2xl font-bold"
          style={{ color: 'rgba(139, 92, 246, 0.5)' }}
        >
          -
        </div>

        <div className="flex gap-1">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={`b-${i}`}
              className="w-[52px] h-[72px] flex items-center justify-center font-mono text-[28px] font-semibold rounded-xl"
              style={{
                background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.03) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                boxShadow: '0 4px 15px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
                animation: `charPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) backwards`,
                animationDelay: `${0.3 + i * 0.05}s`,
                textShadow: '0 0 30px rgba(139, 92, 246, 0.5)',
              }}
            >
              {part2[i] || ''}
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div
        className="glass rounded-[24px] p-13 text-center max-w-[520px] w-full relative overflow-hidden animate-auth-entrance"
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

        <div
          className="text-xs uppercase tracking-[4px] mb-9"
          style={{ color: '#71717a' }}
        >
          Код подтверждения Epic Games
        </div>

        {/* Error Message */}
        {error ? (
          <div
            className="mb-8 p-6 rounded-xl text-left"
            style={{
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#ef4444',
            }}
          >
            <div className="font-semibold mb-2">Ошибка</div>
            <div className="text-sm opacity-80">{error}</div>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 rounded-lg text-sm"
              style={{
                background: 'rgba(239, 68, 68, 0.2)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
              }}
            >
              Обновить страницу
            </button>
          </div>
        ) : (
          <div className="mb-8">
            {loading ? (
              <div className="flex justify-center gap-2">
                {[...Array(8)].map((_, i) => (
                  <div
                    key={i}
                    className="w-[52px] h-[72px] rounded-xl animate-pulse"
                    style={{ background: 'rgba(139, 92, 246, 0.2)' }}
                  />
                ))}
              </div>
            ) : (
              formatCode(userCode)
            )}
          </div>
        )}

        {!error && (
          <>
            <button
              onClick={handleCopyCode}
              className="inline-flex items-center gap-2.5 px-7 py-4 rounded-xl transition-all duration-300 hover:-translate-y-0.5"
              style={{
                background: copied ? '#22c55e' : 'rgba(255, 255, 255, 0.03)',
                border: copied ? '1px solid #22c55e' : '1px solid rgba(255, 255, 255, 0.06)',
                color: copied ? 'white' : '#a1a1aa',
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2"
                className="w-[18px] h-[18px]"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              <span className="font-medium">
                {copied ? 'Скопировано!' : 'Копировать код'}
              </span>
            </button>

            <div className="mt-10 pt-9" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <p className="text-sm mb-4" style={{ color: '#71717a' }}>
                Перейдите на сайт и введите код
              </p>
              <a
                href="https://www.epicgames.com/activate"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-5 py-3 rounded-lg font-mono text-sm transition-all duration-300 hover:scale-105"
                style={{
                  background: 'rgba(139, 92, 246, 0.12)',
                  color: '#8b5cf6',
                  border: '1px solid rgba(139, 92, 246, 0.2)',
                }}
              >
                www.epicgames.com/activate
              </a>
            </div>

            {!authenticated && (
              <div className="mt-13 flex flex-col items-center gap-6">
                <div className="w-14 h-14 relative">
                  <div className="absolute inset-0 border-2 border-transparent border-t-accent rounded-full animate-spin" />
                  <div className="absolute inset-2 border-2 border-transparent border-t-accent/60 rounded-full animate-spin" style={{ animationDuration: '1.5s', animationDirection: 'reverse' }} />
                  <div className="absolute inset-4 border-2 border-transparent border-t-accent/30 rounded-full animate-spin" style={{ animationDuration: '2s' }} />
                </div>

                <span
                  className="text-sm"
                  style={{
                    color: '#a1a1aa',
                    animation: 'textPulse 2s ease-in-out infinite',
                  }}
                >
                  {checking ? 'Проверяем авторизацию...' : 'Ожидаем подтверждения...'}
                </span>
              </div>
            )}
          </>
        )}

        {authenticated && (
          <div className="mt-13 flex flex-col items-center gap-4 animate-success-pop">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                boxShadow: '0 8px 40px rgba(34, 197, 94, 0.5)',
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="3"
                className="w-7 h-7 text-white"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <span className="text-success font-medium">Авторизация успешна!</span>
          </div>
        )}
      </div>
    </div>
  );
}
