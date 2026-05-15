'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ordersApi } from '@/lib/api';
import { useOrderStream } from '@/lib/useOrderStream';
import { HeroLogo } from '@/components/buyer/HeroLogo';
import { Button } from '@/components/ui/Button';

interface OrderData {
  orderId: string;
  vbucksAmount: number;
  priceTRY: number;
  currency: string;
  expiresAt: string;
  status: string;
}

export default function OrderPage() {
  const params = useParams();
  const orderId = params.orderId as string;
  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState('');

  // SSE — live-обновления статуса. Подписываемся только после того, как загрузили заказ.
  const { lastEvent } = useOrderStream(order ? orderId : null);

  // Применяем live-обновления к локальному стейту
  useEffect(() => {
    if (!lastEvent || !order) return;
    if (lastEvent.status && lastEvent.status !== order.status) {
      setOrder(prev => prev ? { ...prev, status: lastEvent.status } : prev);
    }
  }, [lastEvent, order]);

  useEffect(() => {
    const fetchOrder = async () => {
      try {
        const response = await ordersApi.getById(orderId);
        if (response?.success && response?.data) {
          setOrder(response.data);
        }
      } catch (error: any) {
        console.error('Failed to fetch order:', error);
      } finally {
        setLoading(false);
      }
    };

    if (orderId) {
      fetchOrder();
    }
  }, [orderId]);

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

  if (!order) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2" style={{ color: '#f4f4f5' }}>Заказ не найден</h1>
          <p className="mb-4" style={{ color: '#71717a' }}>Срок действия ссылки истёк или она недействительна</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 rounded-xl font-medium"
            style={{
              background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
              color: 'white',
            }}
          >
            Обновить страницу
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col px-5 max-w-[440px] mx-auto">
      {/* Header */}
      <header className="flex justify-between items-center py-4 animate-slide-down">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 relative" style={{ filter: 'drop-shadow(0 0 15px rgba(139, 92, 246, 0.5))' }}>
            <svg viewBox="0 0 100 100" fill="none">
              <defs>
                <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#8b5cf6" />
                  <stop offset="50%" stopColor="#a78bfa" />
                  <stop offset="100%" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
              <polygon points="50,3 90,25 90,75 50,97 10,75 10,25" fill="url(#logoGrad)" opacity="0.9" />
              <polygon points="50,10 82,29 82,71 50,90 18,71 18,29" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
            </svg>
            <div
              className="absolute inset-0 flex items-center justify-center font-extrabold text-xl"
              style={{ color: 'white', textShadow: '0 0 20px rgba(139, 92, 246, 0.8)' }}
            >
              V
            </div>
          </div>
          <span
            className="font-bold text-lg"
            style={{
              background: 'linear-gradient(135deg, #f4f4f5 0%, #a1a1aa 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Bag1V-Bucks
          </span>
        </div>

        {/* Timer */}
        <div
          className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-mono"
          style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            color: '#ef4444',
          }}
        >
          <span
            className="w-2 h-2 rounded-full"
            style={{
              background: '#ef4444',
              boxShadow: '0 0 10px #ef4444',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          />
          <span>Истекает через {timeLeft}</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col justify-center py-10">
        <div
          className="rounded-[24px] p-11 text-center relative overflow-hidden animate-card-entrance"
          style={{
            background: 'rgba(255, 255, 255, 0.02)',
            backdropFilter: 'blur(40px)',
            WebkitBackdropFilter: 'blur(40px)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          {/* Top gradient line */}
          <div
            className="absolute top-0 left-0 right-0 h-px"
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(139, 92, 246, 0.5), transparent)',
            }}
          />

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
          </div>

          {/* CTA Button */}
          <Button
            onClick={handleLogin}
            className="w-full mt-9 group"
          >
            <span className="relative z-10">Войти через Epic Games</span>
            {/* Shine effect */}
            <span
              className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
              style={{
                background: 'linear-gradient(135deg, rgba(255,255,255,0.3) 0%, transparent 50%)',
              }}
            />
          </Button>
        </div>
      </main>
    </div>
  );
}
