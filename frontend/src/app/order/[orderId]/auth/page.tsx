'use client';

import { useEffect, useRef, useState } from 'react';
import { Logo } from '@/components/ui/Logo';
import { authApi } from '@/lib/api';

interface AuthPageProps {
  params: {
    orderId: string;
  };
}

interface DeviceStartResponse {
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  deviceCode: string;
  expiresIn: number;
  pollIntervalMs: number;
}

/**
 * Страница авторизации заказа через Epic OAuth Device Flow.
 *
 * UX:
 *   1. Бэкенд выдаёт короткий userCode (типа JXQ7R8I) и ссылку epicgames.com/activate
 *   2. Юзер открывает ссылку в новой вкладке (код подставляется автоматически)
 *   3. На Epic-странице юзер логинится и нажимает "Authorize"
 *   4. Фронт поллит /auth/device/poll каждые ~5 сек до status: 'authorized'
 *   5. Бэкенд автоматически ставит заказ в очередь — фронт переходит на /timeline
 */
export default function AuthPage({ params }: AuthPageProps) {
  const { orderId } = params;

  const [device, setDevice] = useState<DeviceStartResponse | null>(null);
  const [polling, setPolling] = useState(false);
  const [success, setSuccess] = useState<{ displayName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const pollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Получаем device code на старте
  useEffect(() => {
    let cancelled = false;
    authApi
      .deviceStart(orderId)
      .then((res) => {
        if (cancelled) return;
        if (res?.success) {
          setDevice(res.data);
          setSecondsLeft(res.data.expiresIn);
        } else {
          setError(res?.message || 'Не удалось инициализировать авторизацию');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err?.response?.data?.message || 'Не удалось загрузить данные авторизации';
        setError(msg);
      });

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  // Поллим backend пока юзер не подтвердит на Epic
  useEffect(() => {
    if (!device || success) return;

    setPolling(true);
    const intervalMs = device.pollIntervalMs ?? 5000;

    const poll = async () => {
      try {
        const res = await authApi.devicePoll(orderId, device.deviceCode);
        if (res?.success && res.data?.status === 'authorized') {
          setSuccess({ displayName: res.data.displayName });
          if (pollerRef.current) clearInterval(pollerRef.current);
          if (tickerRef.current) clearInterval(tickerRef.current);
          setTimeout(() => {
            window.location.href = `/order/${orderId}/timeline`;
          }, 1500);
        }
        // status: 'pending' — продолжаем ждать
      } catch (err: any) {
        const msg = err?.response?.data?.message || '';
        if (/expired/i.test(msg)) {
          setError('Код истёк. Обновите страницу чтобы получить новый.');
          if (pollerRef.current) clearInterval(pollerRef.current);
          if (tickerRef.current) clearInterval(tickerRef.current);
        }
        // другие ошибки игнорим — просто следующая попытка через интервал
      }
    };

    pollerRef.current = setInterval(poll, intervalMs);

    return () => {
      if (pollerRef.current) clearInterval(pollerRef.current);
    };
  }, [device, orderId, success]);

  // Тикер обратного отсчёта (~10 минут до expiry)
  useEffect(() => {
    if (!device || success) return;
    tickerRef.current = setInterval(() => {
      setSecondsLeft((prev) => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => {
      if (tickerRef.current) clearInterval(tickerRef.current);
    };
  }, [device, success]);

  const handleCopyCode = () => {
    if (!device) return;
    navigator.clipboard.writeText(device.userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
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
          /* ───────────── Успех ───────────── */
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
        ) : !device ? (
          /* ───────────── Загрузка ───────────── */
          <div className="py-12">
            {error ? (
              <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>
            ) : (
              <>
                <div className="w-10 h-10 mx-auto mb-4 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
                <p className="text-sm" style={{ color: '#a1a1aa' }}>Получаем код авторизации...</p>
              </>
            )}
          </div>
        ) : (
          /* ───────────── Основной UI ───────────── */
          <>
            <div className="text-left space-y-5">
              {/* Шаг 1 — открыть Epic */}
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
                      Откройте Epic Games
                    </h3>
                    <p className="text-xs mt-1" style={{ color: '#a1a1aa' }}>
                      Код подставится автоматически. Войдите в свой аккаунт и нажмите <b>Authorize</b>.
                    </p>
                  </div>
                </div>
                <a
                  href={device.verificationUriComplete}
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

              {/* Шаг 2 — код */}
              <div
                className="rounded-2xl p-5"
                style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <div className="flex items-start gap-3 mb-4">
                  <div
                    className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold"
                    style={{ background: 'rgba(255, 255, 255, 0.1)', color: '#a1a1aa' }}
                  >
                    2
                  </div>
                  <div>
                    <h3 className="font-semibold text-[15px]" style={{ color: '#f4f4f5' }}>
                      Если код не подставился — введите вручную
                    </h3>
                    <p className="text-xs mt-1" style={{ color: '#a1a1aa' }}>
                      Перейдите на <b style={{ color: '#a78bfa' }}>epicgames.com/activate</b> и введите этот код:
                    </p>
                  </div>
                </div>

                {/* Карточка с кодом — клик копирует */}
                <button
                  onClick={handleCopyCode}
                  className="w-full p-5 rounded-xl font-mono text-3xl font-bold tracking-[0.4em] transition-all hover:bg-white/5 active:scale-[0.98]"
                  style={{
                    background: 'rgba(0, 0, 0, 0.4)',
                    border: '2px dashed rgba(139, 92, 246, 0.4)',
                    color: '#a78bfa',
                    letterSpacing: '0.4em',
                  }}
                >
                  {device.userCode}
                </button>

                <div className="flex items-center justify-between mt-3 px-1">
                  <span className="text-xs" style={{ color: copied ? '#22c55e' : '#71717a' }}>
                    {copied ? '✓ Скопировано в буфер' : 'Нажмите чтобы скопировать'}
                  </span>
                  {secondsLeft !== null && secondsLeft > 0 && (
                    <span className="text-xs font-mono" style={{ color: '#71717a' }}>
                      Действует {formatTime(secondsLeft)}
                    </span>
                  )}
                </div>
              </div>

              {/* Статус полла */}
              <div
                className="rounded-2xl p-4 flex items-center gap-3"
                style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                {polling ? (
                  <>
                    <div className="w-4 h-4 rounded-full border-2 border-purple-500 border-t-transparent animate-spin flex-shrink-0" />
                    <span className="text-xs" style={{ color: '#a1a1aa' }}>
                      Ждём подтверждения на стороне Epic...
                    </span>
                  </>
                ) : (
                  <span className="text-xs" style={{ color: '#71717a' }}>
                    Ожидание авторизации
                  </span>
                )}
              </div>

              {error && (
                <div
                  className="p-3 rounded-lg text-xs"
                  style={{
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#ef4444',
                  }}
                >
                  {error}
                </div>
              )}
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
