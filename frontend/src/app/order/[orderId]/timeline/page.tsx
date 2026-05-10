'use client';

import { useEffect, useState } from 'react';
import { ordersApi } from '@/lib/api';

interface TimelineLog {
  timestamp: string;
  tag: string;
  message: string;
  status?: 'success' | 'error' | 'info';
}

interface OrderStatus {
  orderId: string;
  status: string;
  timelineLogs: TimelineLog[];
  completedAt?: string;
  errorMessage?: string;
}

interface TimelinePageProps {
  params: {
    orderId: string;
  };
}

export default function TimelinePage({ params }: TimelinePageProps) {
  const { orderId } = params;
  const [orderStatus, setOrderStatus] = useState<OrderStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await ordersApi.getStatus(orderId);
        if (response.success) {
          setOrderStatus(response.data);
        }
      } catch (error) {
        console.error('Failed to fetch status:', error);
        // Mock data for demo
        setOrderStatus({
          orderId,
          status: 'processing',
          timelineLogs: [
            { timestamp: new Date(Date.now() - 240000).toISOString(), tag: '[auth]', message: 'device code verified', status: 'success' },
            { timestamp: new Date(Date.now() - 240000).toISOString(), tag: '[auth]', message: 'session established', status: 'success' },
            { timestamp: new Date(Date.now() - 180000).toISOString(), tag: '[pay]', message: 'razer-tr-04 balance check... ok', status: 'success' },
            { timestamp: new Date(Date.now() - 180000).toISOString(), tag: '[pay]', message: 'sufficient funds verified', status: 'success' },
            { timestamp: new Date(Date.now() - 120000).toISOString(), tag: '[pay]', message: '3DS bypassed... success', status: 'success' },
            { timestamp: new Date(Date.now() - 120000).toISOString(), tag: '[pay]', message: 'transaction authorized', status: 'success' },
            { timestamp: new Date(Date.now() - 60000).toISOString(), tag: '[epic]', message: 'initiating purchase...', status: 'success' },
            { timestamp: new Date(Date.now() - 60000).toISOString(), tag: '[epic]', message: 'payment processed... confirmed', status: 'success' },
            { timestamp: new Date(Date.now() - 30000).toISOString(), tag: '[delivery]', message: 'crediting account...', status: 'success' },
            { timestamp: new Date(Date.now() - 30000).toISOString(), tag: '[delivery]', message: '2800 V-Bucks delivered', status: 'success' },
          ],
        });
      } finally {
        setLoading(false);
      }
    };

    // Initial fetch
    fetchStatus();

    // Poll every 5 seconds
    const interval = setInterval(fetchStatus, 5000);

    return () => clearInterval(interval);
  }, [orderId]);

  const getStatusClass = (stepIndex: number) => {
    if (!orderStatus) return 'waiting';

    const completedSteps = Math.min(orderStatus.timelineLogs.length, 5);
    if (stepIndex < completedSteps) return 'completed';
    if (stepIndex === completedSteps) return 'active';
    return 'waiting';
  };

  const getStepTime = (index: number): string => {
    if (!orderStatus?.timelineLogs.length) return '';

    const relevantLogs = orderStatus.timelineLogs.filter((_, i) => {
      const logIndex = i;
      return logIndex < (index + 1) * 2 && logIndex >= index * 2;
    });

    if (relevantLogs.length > 0) {
      const firstLog = relevantLogs[0];
      const time = new Date(firstLog.timestamp);
      return time.toLocaleTimeString('ru-RU', { minute: '2-digit', second: '2-digit' });
    }

    return '';
  };

  const steps = [
    { title: 'Подтверждение авторизации', tag: '[auth]' },
    { title: 'Проверка баланса Razer', tag: '[pay]' },
    { title: 'Обход 3D Secure', tag: '[pay]' },
    { title: 'Оплата в Epic Games', tag: '[epic]' },
    { title: 'Зачисление V-Bucks', tag: '[delivery]' },
  ];

  const isCompleted = orderStatus?.status === 'completed';

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

  return (
    <div className="min-h-screen p-6 max-w-[540px] mx-auto">
      {/* Header */}
      <div className="text-center mb-13 animate-slide-down">
        <h1
          className="text-[32px] font-bold mb-2.5"
          style={{
            background: 'linear-gradient(135deg, #f4f4f5 0%, #a1a1aa 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          Обработка заказа
        </h1>
        <p className="text-sm" style={{ color: '#71717a' }}>
          Автоматическая доставка V-Bucks
        </p>
      </div>

      {/* Timeline */}
      <div className="timeline flex flex-col gap-0 relative">
        {steps.map((step, index) => {
          const statusClass = getStatusClass(index);
          const stepTime = getStepTime(index);
          const logs = orderStatus?.timelineLogs.filter((_, i) => {
            const logIndex = i;
            return logIndex < (index + 1) * 2 && logIndex >= index * 2;
          }) || [];

          return (
            <div
              key={index}
              className={`timeline-item ${statusClass}`}
              style={{
                display: 'flex',
                gap: '24px',
                padding: '22px 0',
                opacity: statusClass === 'waiting' ? 0.5 : 1,
                transform: statusClass === 'waiting' ? 'none' : 'translateX(0)',
                transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              {/* Marker */}
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center relative z-10 flex-shrink-0"
                style={{
                  background: statusClass === 'waiting'
                    ? 'rgba(255, 255, 255, 0.03)'
                    : statusClass === 'active'
                      ? 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)'
                      : 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                  border: statusClass === 'waiting' ? '2px solid rgba(255, 255, 255, 0.06)' : 'none',
                  boxShadow: statusClass === 'active'
                    ? '0 0 40px rgba(139, 92, 246, 0.5), 0 0 80px rgba(139, 92, 246, 0.3)'
                    : statusClass === 'completed'
                      ? '0 4px 25px rgba(34, 197, 94, 0.4)'
                      : 'none',
                }}
              >
                {statusClass === 'active' && (
                  <div
                    className="absolute inset-[-6px] rounded-full"
                    style={{
                      border: '2px solid #8b5cf6',
                      animation: 'ringPulse 1.5s ease-out infinite',
                    }}
                  />
                )}
                {statusClass === 'completed' && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="3"
                    className="w-4 h-4 text-white"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </div>

              {/* Content */}
              <div className="flex-1 pt-1">
                <div className="flex justify-between items-center mb-2.5">
                  <span
                    className="text-[15px] font-medium"
                    style={{
                      color: statusClass === 'waiting' ? '#71717a' : '#f4f4f5',
                    }}
                  >
                    {step.title}
                  </span>
                  {stepTime && (
                    <span
                      className="font-mono text-xs px-3 py-1 rounded-full"
                      style={{
                        background: 'rgba(34, 197, 94, 0.12)',
                        color: '#22c55e',
                      }}
                    >
                      {stepTime}
                    </span>
                  )}
                </div>

                {/* Logs */}
                <div
                  className="font-mono text-xs overflow-hidden transition-all duration-500"
                  style={{
                    maxHeight: statusClass === 'completed' ? '120px' : '0',
                    opacity: statusClass === 'completed' ? 1 : 0,
                    padding: statusClass === 'completed' ? '14px 18px' : '0 18px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: '10px',
                    borderLeft: '3px solid #8b5cf6',
                    color: '#71717a',
                  }}
                >
                  {logs.map((log, i) => (
                    <div
                      key={i}
                      className="py-1 flex gap-2.5"
                      style={{
                        animation: `logSlide 0.4s ease backwards`,
                        animationDelay: `${i * 0.1}s`,
                      }}
                    >
                      <span style={{ color: '#8b5cf6' }}>{log.tag}</span>
                      <span>{log.message}</span>
                      {log.status === 'success' && (
                        <span style={{ color: '#22c55e' }}>ok</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Success Banner */}
      {isCompleted && (
        <div
          className="mt-12 p-10 text-center rounded-[24px] animate-success-pop"
          style={{
            background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.12) 0%, rgba(22, 163, 74, 0.08) 100%)',
            border: '1px solid rgba(34, 197, 94, 0.3)',
          }}
        >
          {/* Success Icon */}
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"
            style={{
              background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
              boxShadow: '0 8px 40px rgba(34, 197, 94, 0.5), 0 0 80px rgba(34, 197, 94, 0.2)',
              animation: 'successGlow 2s ease-in-out infinite',
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="2.5"
              className="w-10 h-10 text-white"
              style={{ animation: 'checkBounce 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.3s both' }}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>

          <h2 className="text-2xl font-bold mb-2">Заказ выполнен!</h2>
          <p className="text-sm" style={{ color: '#a1a1aa' }}>
            2 800 V-Bucks успешно зачислены на ваш аккаунт Epic Games
          </p>
        </div>
      )}

      {/* Error Banner */}
      {orderStatus?.errorMessage && (
        <div
          className="mt-12 p-10 text-center rounded-[24px]"
          style={{
            background: 'rgba(239, 68, 68, 0.12)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
          }}
        >
          <h2 className="text-2xl font-bold mb-2" style={{ color: '#ef4444' }}>
            Произошла ошибка
          </h2>
          <p className="text-sm" style={{ color: '#a1a1aa' }}>
            {orderStatus.errorMessage}
          </p>
        </div>
      )}
    </div>
  );
}
