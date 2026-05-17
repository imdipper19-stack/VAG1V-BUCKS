По'use client';

import { useEffect, useState } from 'react';
import { ordersApi } from '@/lib/api';
import { useOrderStream } from '@/lib/useOrderStream';

interface TimelinePageProps {
  params: {
    orderId: string;
  };
}

const STEPS = [
  { id: 'auth', title: 'Авторизация подтверждена', icon: '🔐' },
  { id: 'balance', title: 'Подготовка к покупке', icon: '💳' },
  { id: 'purchase', title: 'Покупка V-Bucks', icon: '🎮' },
  { id: 'delivery', title: 'Зачисление на аккаунт', icon: '✨' },
];

function getCompletedSteps(status: string, logsCount: number): number {
  if (status === 'completed') return 4;
  if (status === 'failed') return -1;
  if (status === 'processing' || status === 'auth_completed') {
    if (logsCount >= 8) return 3;
    if (logsCount >= 5) return 2;
    if (logsCount >= 3) return 1;
    return 0;
  }
  return 0;
}

export default function TimelinePage({ params }: TimelinePageProps) {
  const { orderId } = params;
  const [status, setStatus] = useState<string>('processing');
  const [vbucksAmount, setVbucksAmount] = useState<number>(0);
  const [logsCount, setLogsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [queueInfo, setQueueInfo] = useState<{ queueSize: number; position: number | null } | null>(null);

  const { currentStep, progress } = useOrderStream(orderId);

  useEffect(() => {
    if (status === 'completed' || status === 'failed') return;

    const fetchQueue = async () => {
      try {
        const res = await ordersApi.getQueuePosition(orderId);
        if (res.success) setQueueInfo(res.data);
      } catch {}
    };

    fetchQueue();
    const queueInterval = setInterval(fetchQueue, 5000);
    return () => clearInterval(queueInterval);
  }, [orderId, status]);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const response = await ordersApi.getStatus(orderId);
        if (response.success) {
          setStatus(response.data.status);
          setVbucksAmount(response.data.vbucksAmount || 0);
          setLogsCount(response.data.timelineLogs?.length || 0);
          setErrorMessage(response.data.errorMessage || null);
        }
      } catch (error) {
        console.error('Failed to fetch status:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [orderId]);

  const completedSteps = getCompletedSteps(status, logsCount);
  const isCompleted = status === 'completed';
  const isFailed = status === 'failed';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-14 h-14 relative">
          <div className="absolute inset-0 border-2 border-transparent border-t-purple-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 max-w-[480px] mx-auto flex flex-col justify-center">
      {/* Header */}
      <div className="text-center mb-10">
        <h1
          className="text-3xl font-bold mb-2"
          style={{
            background: 'linear-gradient(135deg, #f4f4f5 0%, #a1a1aa 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          {isCompleted ? 'Готово!' : isFailed ? 'Ошибка' : 'Обрабатываем заказ'}
        </h1>
        <p className="text-sm" style={{ color: '#71717a' }}>
          {isCompleted
            ? 'V-Bucks зачислены на ваш аккаунт'
            : isFailed
              ? 'Что-то пошло не так'
              : 'Это займёт несколько минут'}
        </p>

        {/* Progress bar */}
        {!isCompleted && !isFailed && (
          <div className="mt-6 mx-auto max-w-[280px]">
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div
                className="h-full rounded-full transition-all duration-1000 ease-out"
                style={{
                  width: `${progress || (completedSteps / 4) * 100}%`,
                  background: 'linear-gradient(90deg, #8b5cf6, #22c55e)',
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Queue info */}
      {!isCompleted && !isFailed && queueInfo && queueInfo.queueSize > 0 && (
        <div
          className="mb-6 flex items-center justify-center gap-6 px-5 py-3.5 rounded-2xl mx-auto"
          style={{
            background: 'rgba(234, 179, 8, 0.06)',
            border: '1px solid rgba(234, 179, 8, 0.15)',
          }}
        >
          <div className="text-center">
            <span className="block text-xs" style={{ color: '#71717a' }}>В очереди</span>
            <span className="block text-lg font-bold font-mono" style={{ color: '#eab308' }}>{queueInfo.queueSize}</span>
          </div>
          {queueInfo.position !== null && (
            <>
              <div className="w-px h-8" style={{ background: 'rgba(255,255,255,0.08)' }} />
              <div className="text-center">
                <span className="block text-xs" style={{ color: '#71717a' }}>Ваше место</span>
                <span className="block text-lg font-bold font-mono" style={{ color: queueInfo.position === 0 ? '#22c55e' : '#8b5cf6' }}>
                  {queueInfo.position === 0 ? '⚡ Сейчас' : `#${queueInfo.position}`}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Steps */}
      <div className="space-y-4">
        {STEPS.map((step, index) => {
          const isDone = index < completedSteps;
          const isActive = index === completedSteps && !isCompleted && !isFailed;
          const isWaiting = index > completedSteps;

          return (
            <div
              key={step.id}
              className="flex items-center gap-4 px-5 py-4 rounded-2xl transition-all duration-500"
              style={{
                background: isDone
                  ? 'rgba(34, 197, 94, 0.08)'
                  : isActive
                    ? 'rgba(139, 92, 246, 0.08)'
                    : 'rgba(255, 255, 255, 0.02)',
                border: isDone
                  ? '1px solid rgba(34, 197, 94, 0.2)'
                  : isActive
                    ? '1px solid rgba(139, 92, 246, 0.25)'
                    : '1px solid rgba(255, 255, 255, 0.04)',
                opacity: isWaiting ? 0.4 : 1,
              }}
            >
              {/* Icon/Spinner */}
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                style={{
                  background: isDone
                    ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                    : isActive
                      ? 'linear-gradient(135deg, #8b5cf6, #7c3aed)'
                      : 'rgba(255, 255, 255, 0.04)',
                  boxShadow: isDone
                    ? '0 4px 20px rgba(34, 197, 94, 0.4)'
                    : isActive
                      ? '0 4px 20px rgba(139, 92, 246, 0.4)'
                      : 'none',
                }}
              >
                {isDone && (
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" style={{ animation: 'drawCheck 0.4s ease-out forwards' }} />
                  </svg>
                )}
                {isActive && (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                )}
                {isWaiting && (
                  <span className="text-lg opacity-40">{step.icon}</span>
                )}
              </div>

              {/* Text */}
              <div className="flex-1">
                <span
                  className="text-sm font-medium"
                  style={{
                    color: isDone ? '#22c55e' : isActive ? '#f4f4f5' : '#71717a',
                  }}
                >
                  {step.title}
                </span>
                {isActive && (
                  <span className="block text-xs mt-0.5" style={{ color: '#a1a1aa' }}>
                    {currentStep ? `${currentStep}...` : 'Выполняется...'}
                  </span>
                )}
              </div>

              {/* Status */}
              {isDone && (
                <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
                  Готово
                </span>
              )}
              {isActive && (
                <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: 'rgba(139,92,246,0.15)', color: '#a78bfa' }}>
                  В процессе
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Success */}
      {isCompleted && (
        <div
          className="mt-8 p-8 text-center rounded-2xl"
          style={{
            background: 'rgba(34, 197, 94, 0.08)',
            border: '1px solid rgba(34, 197, 94, 0.25)',
          }}
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{
              background: 'linear-gradient(135deg, #22c55e, #16a34a)',
              boxShadow: '0 8px 40px rgba(34, 197, 94, 0.5)',
            }}
          >
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold mb-1" style={{ color: '#22c55e' }}>
            {vbucksAmount.toLocaleString('ru-RU')} V-Bucks доставлены!
          </h2>
          <p className="text-sm" style={{ color: '#a1a1aa' }}>
            Зайдите в Fortnite и проверьте баланс
          </p>
        </div>
      )}

      {/* Error */}
      {isFailed && (
        <div
          className="mt-8 p-8 text-center rounded-2xl"
          style={{
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
          }}
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ background: 'rgba(239, 68, 68, 0.2)' }}
          >
            <span className="text-3xl">⚠️</span>
          </div>
          <h2 className="text-xl font-bold mb-1" style={{ color: '#ef4444' }}>
            Произошла ошибка
          </h2>
          <p className="text-sm" style={{ color: '#a1a1aa' }}>
            Наша команда уже в курсе. Напишите в поддержку если проблема не решится.
          </p>
          <a
            href="https://t.me/BAG1BAG1"
            target="_blank"
            rel="noreferrer"
            className="inline-block mt-4 px-5 py-2.5 rounded-xl text-sm font-medium"
            style={{ background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.3)', color: '#a78bfa' }}
          >
            Написать в поддержку
          </a>
        </div>
      )}

      <style jsx>{`
        @keyframes drawCheck {
          from { stroke-dashoffset: 24; stroke-dasharray: 24; }
          to { stroke-dashoffset: 0; stroke-dasharray: 24; }
        }
      `}</style>
    </div>
  );
}
