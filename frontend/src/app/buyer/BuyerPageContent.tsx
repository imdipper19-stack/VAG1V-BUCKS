'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Logo } from '@/components/ui/Logo';
import { Button } from '@/components/ui/Button';
import { HeroLogo } from '@/components/buyer/HeroLogo';
import { ordersApi, authApi } from '@/lib/api';
import { useOrderStream } from '@/lib/useOrderStream';

interface OrderData {
  orderId: string;
  vbucksAmount: number;
  priceTRY: number;
  currency: string;
  expiresAt: string;
  status: string;
  errorMessage?: string;
}

export default function BuyerPageContent() {
  const searchParams = useSearchParams();
  const slug = searchParams.get('slug');
  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [timeLeft, setTimeLeft] = useState('');
  const [regionCode, setRegionCode] = useState('');
  const [regionCodeLoading, setRegionCodeLoading] = useState(false);
  const [regionCodeSent, setRegionCodeSent] = useState(false);
  const [queueInfo, setQueueInfo] = useState<{ queueSize: number; position: number | null } | null>(null);

  // SSE — после загрузки заказа подписываемся на live-обновления статуса
  const { lastEvent } = useOrderStream(order?.orderId);

  useEffect(() => {
    if (!lastEvent || !order) return;
    if (lastEvent.status && lastEvent.status !== order.status) {
      setOrder({ ...order, status: lastEvent.status });
    }
  }, [lastEvent, order]);

  useEffect(() => {
    if (!order?.orderId) return;
    if (order.status === 'completed' || order.status === 'failed') return;

    const fetchQueuePosition = async () => {
      try {
        const res = await ordersApi.getQueuePosition(order.orderId);
        if (res.success) {
          setQueueInfo(res.data);
        }
      } catch {}
    };

    fetchQueuePosition();
    const interval = setInterval(fetchQueuePosition, 5000);
    return () => clearInterval(interval);
  }, [order?.orderId, order?.status]);

  useEffect(() => {
    const fetchOrder = async () => {
      if (!slug) {
        setError('Ссылка недействительна — отсутствует код заказа');
        setLoading(false);
        return;
      }

      try {
        const response = await ordersApi.getBySlug(slug);
        if (response?.success && response?.data) {
          setOrder(response.data);
        } else {
          setError('Заказ не найден');
        }
      } catch (err: any) {
        console.error('Failed to fetch order:', err);
        if (err?.response?.status === 404) {
          setError('Заказ не найден или срок действия ссылки истёк');
        } else {
          setError('Ошибка загрузки заказа. Попробуйте позже.');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchOrder();
  }, [slug]);

  useEffect(() => {
    if (!order?.expiresAt) return;

    const interval = setInterval(() => {
      const now = new Date().getTime();
      const expiry = new Date(order.expiresAt).getTime();
      const diff = expiry - now;

      if (diff <= 0) {
        setTimeLeft('Истёк');
        clearInterval(interval);
        return;
      }

      const minutes = Math.floor(diff / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      setTimeLeft(`${minutes}:${seconds.toString().padStart(2, '0')}`);
    }, 1000);

    return () => clearInterval(interval);
  }, [order?.expiresAt]);

  const handleLogin = () => {
    // Navigate to auth page with real orderId
    window.location.href = `/order/${order?.orderId}/auth`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-14 h-14 relative">
          <div className="absolute inset-0 border-2 border-transparent border-t-accent rounded-full animate-spin" />
          <div className="absolute inset-2 border-2 border-transparent border-t-accent/60 rounded-full animate-spin" style={{ animationDuration: '1.5s', animationDirection: 'reverse' }} />
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <div
            className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6"
            style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
            }}
          >
            <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-2" style={{ color: '#f4f4f5' }}>
            Заказ не найден
          </h1>
          <p className="mb-6" style={{ color: '#71717a' }}>
            {error || 'Срок действия ссылки истёк или она недействительна'}
          </p>
          <a
            href="/"
            className="inline-block px-6 py-3 rounded-xl font-medium transition-all hover:-translate-y-0.5"
            style={{
              background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
              color: 'white',
            }}
          >
            На главную
          </a>
        </div>
      </div>
    );
  }

  // Check if order is expired
  const isExpired = timeLeft === 'Истёк';
  const isCompleted = order.status === 'completed';
  const isProcessing = order.status === 'processing' || order.status === 'auth_completed';
  const isPaid = order.status === 'awaiting_auth' || order.status === 'auth_completed' || isProcessing || isCompleted;
  const isPending = order.status === 'pending'; // создан, ещё не оплачен
  const needsRegionCode = order.status === 'awaiting_auth' && order.errorMessage === 'region_confirmation_required';

  const handleRegionCodeSubmit = async () => {
    if (!regionCode.trim() || !order) return;
    setRegionCodeLoading(true);
    try {
      await authApi.submitRegionCode(order.orderId, regionCode.trim());
      setRegionCodeSent(true);
    } catch (e) {
      console.error('Failed to submit region code:', e);
    } finally {
      setRegionCodeLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col px-5 max-w-[440px] mx-auto">
      {/* Header */}
      <header className="flex justify-between items-center py-4 animate-slide-down">
        <div className="flex items-center gap-3">
          <Logo size={48} />
          <span className="font-bold text-lg" style={{
            background: 'linear-gradient(135deg, #f4f4f5 0%, #a1a1aa 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}>
            Bag1V-Bucks
          </span>
        </div>

        {/* Timer */}
        {!isCompleted && (
          <div
            className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-mono"
            style={{
              background: isExpired ? 'rgba(239, 68, 68, 0.2)' : 'rgba(239, 68, 68, 0.12)',
              border: `1px solid rgba(239, 68, 68, ${isExpired ? '0.4' : '0.2'})`,
              color: '#ef4444',
            }}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{
                background: '#ef4444',
                boxShadow: '0 0 10px #ef4444',
                animation: isExpired ? 'none' : 'pulse 1.5s ease-in-out infinite',
              }}
            />
            <span>{isExpired ? 'Срок истёк' : `Истекает через ${timeLeft}`}</span>
          </div>
        )}

        {isCompleted && (
          <div
            className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium"
            style={{
              background: 'rgba(34, 197, 94, 0.12)',
              border: '1px solid rgba(34, 197, 94, 0.2)',
              color: '#22c55e',
            }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Выполнен
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col justify-center py-10">
        <div
          className="glass rounded-[24px] p-11 text-center relative overflow-hidden animate-card-entrance"
          style={{
            background: 'rgba(255, 255, 255, 0.02)',
            backdropFilter: 'blur(40px)',
            WebkitBackdropFilter: 'blur(40px)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          {/* Hero Logo */}
          <HeroLogo />

          {/* V-Bucks Amount */}
          <div
            className="font-mono text-6xl font-semibold tracking-tight mb-1.5"
            style={{
              letterSpacing: '-4px',
              background: 'linear-gradient(135deg, #f4f4f5 0%, #d4d4d8 50%, #a1a1aa 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              animation: 'amountShimmer 4s ease-in-out infinite',
            }}
          >
            {order.vbucksAmount.toLocaleString('ru-RU')}
          </div>
          <div
            className="text-sm uppercase tracking-[4px] mb-8"
            style={{ color: '#a1a1aa' }}
          >
            V-Bucks
          </div>

          {/* Divider */}
          <div
            className="h-px mb-7 relative"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.06), transparent)' }}
          >
            <div
              className="absolute top-[-2px] left-1/2 -translate-x-1/2 w-[60px] h-1"
              style={{
                background: 'linear-gradient(90deg, transparent, #8b5cf6, transparent)',
                borderRadius: '2px',
              }}
            />
          </div>

          {/* Meta Info */}
          <div className="font-mono text-sm flex flex-col gap-2.5" style={{ color: '#71717a' }}>
            <div className="flex justify-between px-6">
              <span style={{ opacity: 0.6 }}>Валюта</span>
              <span style={{ color: '#a1a1aa' }}>{order.currency}</span>
            </div>
            <div className="flex justify-between px-6">
              <span style={{ opacity: 0.6 }}>ID заказа</span>
              <span style={{ color: '#a1a1aa' }}>#{order.orderId}</span>
            </div>
            <div className="flex justify-between px-6">
              <span style={{ opacity: 0.6 }}>Статус</span>
              <span style={{
                color: isCompleted ? '#22c55e' : isProcessing ? '#8b5cf6' : isPending ? '#eab308' : '#a1a1aa',
              }}>
                {isCompleted ? 'Доставлен' : isProcessing ? 'В обработке' : isPending ? 'Ожидает оплаты' : isExpired ? 'Истёк' : 'Ожидает'}
              </span>
            </div>
            {queueInfo && queueInfo.queueSize > 0 && (
              <>
                <div className="flex justify-between px-6">
                  <span style={{ opacity: 0.6 }}>В очереди</span>
                  <span style={{ color: '#eab308' }}>{queueInfo.queueSize} чел.</span>
                </div>
                {queueInfo.position !== null && queueInfo.position > 0 && (
                  <div className="flex justify-between px-6">
                    <span style={{ opacity: 0.6 }}>Вы в очереди</span>
                    <span style={{ color: '#8b5cf6' }}>#{queueInfo.position}</span>
                  </div>
                )}
                {queueInfo.position === 0 && (
                  <div className="flex justify-between px-6">
                    <span style={{ opacity: 0.6 }}>Вы в очереди</span>
                    <span style={{ color: '#22c55e' }}>Обрабатывается сейчас</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* CTA Button — показываем только если оплачено и ещё не авторизован */}
          {!isExpired && !isCompleted && !isProcessing && isPaid && (
            <Button
              onClick={handleLogin}
              className="w-full mt-9 group"
            >
              <span className="relative z-10">Войти через Epic Games</span>
              <span
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.3) 0%, transparent 50%)',
                }}
              />
            </Button>
          )}

          {/* Ожидание оплаты */}
          {isPending && !isExpired && (
            <div
              className="mt-9 py-4 px-5 rounded-xl text-center"
              style={{
                background: 'rgba(234, 179, 8, 0.1)',
                border: '1px solid rgba(234, 179, 8, 0.2)',
                color: '#eab308',
              }}
            >
              <div className="flex items-center justify-center gap-3 mb-2">
                <div className="w-4 h-4 border-2 border-transparent border-t-current rounded-full animate-spin" />
                <span className="font-medium">Ожидаем оплату...</span>
              </div>
              <p className="text-xs opacity-70">После оплаты здесь появится кнопка авторизации Epic Games</p>
            </div>
          )}

          {/* Код подтверждения смены региона */}
          {needsRegionCode && !regionCodeSent && (
            <div
              className="mt-9 py-4 px-5 rounded-xl text-left"
              style={{
                background: 'rgba(139, 92, 246, 0.08)',
                border: '1px solid rgba(139, 92, 246, 0.25)',
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="w-4 h-4 border-2 border-transparent border-t-[#8b5cf6] rounded-full animate-spin" />
                <span className="font-medium text-sm" style={{ color: '#a78bfa' }}>
                  Смена региона на Турцию
                </span>
              </div>
              <p className="text-xs mb-4" style={{ color: '#a1a1aa' }}>
                Мы инициировали смену региона вашего аккаунта на Турцию. Epic Games отправил код подтверждения на ваш email. Введите его ниже.
              </p>
              <input
                type="text"
                value={regionCode}
                onChange={(e) => setRegionCode(e.target.value)}
                placeholder="Код из письма Epic Games"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm font-mono focus:outline-none focus:border-purple-500 mb-3"
              />
              <button
                onClick={handleRegionCodeSubmit}
                disabled={regionCodeLoading || !regionCode.trim()}
                className="w-full py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
                style={{
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                  color: 'white',
                }}
              >
                {regionCodeLoading ? 'Отправляем...' : 'Подтвердить смену региона'}
              </button>
            </div>
          )}

          {needsRegionCode && regionCodeSent && (
            <div
              className="mt-9 py-4 px-5 rounded-xl text-center"
              style={{
                background: 'rgba(34, 197, 94, 0.1)',
                border: '1px solid rgba(34, 197, 94, 0.2)',
                color: '#22c55e',
              }}
            >
              <div className="flex items-center justify-center gap-3">
                <div className="w-4 h-4 border-2 border-transparent border-t-current rounded-full animate-spin" />
                <span className="font-medium">Код принят, меняем регион...</span>
              </div>
            </div>
          )}

          {isProcessing && (
            <div
              className="mt-9 py-4 rounded-xl font-medium text-center"
              style={{
                background: 'rgba(139, 92, 246, 0.1)',
                border: '1px solid rgba(139, 92, 246, 0.2)',
                color: '#8b5cf6',
              }}
            >
              <div className="flex items-center justify-center gap-3">
                <div className="w-4 h-4 border-2 border-transparent border-t-current rounded-full animate-spin" />
                V-Bucks начисляются на ваш аккаунт...
              </div>
            </div>
          )}

          {isCompleted && (
            <div
              className="mt-9 py-4 rounded-xl font-medium text-center"
              style={{
                background: 'rgba(34, 197, 94, 0.1)',
                border: '1px solid rgba(34, 197, 94, 0.2)',
                color: '#22c55e',
              }}
            >
              ✓ V-Bucks успешно доставлены!
            </div>
          )}

          {isExpired && (
            <div
              className="mt-9 py-4 rounded-xl font-medium text-center"
              style={{
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                color: '#ef4444',
              }}
            >
              Срок действия заказа истёк
            </div>
          )}
        </div>

        {/* Timeline link */}
        {(isProcessing || isCompleted) && (
          <a
            href={`/order/${order.orderId}/timeline`}
            className="mt-6 text-center text-sm font-medium transition-all hover:opacity-80"
            style={{ color: '#8b5cf6' }}
          >
            Посмотреть детали обработки →
          </a>
        )}
      </main>
    </div>
  );
}
