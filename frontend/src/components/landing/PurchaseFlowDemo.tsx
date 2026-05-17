'use client';

/**
 * PurchaseFlowDemo — анимированный демо-флоу покупки V-Bucks для лендинга.
 *
 * Что показывает:
 *   00:00  Заказ создан
 *   00:05  Оплата принята
 *   00:12  Epic Auth (Device flow)
 *   00:28  Razer Gold покупка
 *   00:47  V-Bucks выданы
 *
 * Реальная покупка занимает ~47 сек. Для лендинга проигрываем за 12 сек,
 * чтобы зритель видел весь путь от начала до конца, но не скучал.
 * Таймер на экране тикает по реальным секундам (0..47) — это не обман,
 * это маппинг (animationFraction × 47 sec).
 *
 * Цикл повторяется бесконечно: 12 сек анимация + 1.5 сек пауза с финальным
 * "Готово!" + рестарт.
 */

import { useEffect, useRef, useState } from 'react';

const ANIMATION_MS = 12_000;     // длительность одной прокрутки
const PAUSE_AFTER_MS = 1_800;    // пауза после "Готово!" перед рестартом
const REAL_DURATION_SEC = 47;    // что показываем в таймере на экране

interface FlowStep {
  id: string;
  title: string;
  description: string;
  /** При какой реальной секунде шаг становится активным */
  startsAt: number;
  Icon: React.FC<{ className?: string }>;
}

const STEPS: FlowStep[] = [
  {
    id: 'order',
    title: 'Заказ создан',
    description: 'Покупатель выбрал пакет и нажал «Купить»',
    startsAt: 0,
    Icon: CartIcon,
  },
  {
    id: 'payment',
    title: 'Оплата принята',
    description: 'СБП или карта — мгновенный webhook',
    startsAt: 5,
    Icon: CardIcon,
  },
  {
    id: 'epic',
    title: 'Epic авторизация',
    description: 'Device Auth — без пароля и логина',
    startsAt: 12,
    Icon: ShieldIcon,
  },
  {
    id: 'razer',
    title: 'Razer покупка',
    description: 'Турецкий кошелёк + 2FA автоматически',
    startsAt: 28,
    Icon: CoinIcon,
  },
  {
    id: 'done',
    title: 'V-Bucks доставлены',
    description: 'Готово к использованию в Fortnite',
    startsAt: 47,
    Icon: CheckIcon,
  },
];

export default function PurchaseFlowDemo() {
  const [progress, setProgress] = useState(0);   // 0..1 в анимационном времени
  const [paused, setPaused] = useState(false);   // финальная пауза с "Готово!"
  const startedAt = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const respectsReducedMotion = useRef(false);

  useEffect(() => {
    // Если пользователь поставил prefers-reduced-motion: reduce — сразу показываем
    // финальное состояние и больше не анимируем. Доступность.
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      respectsReducedMotion.current = true;
      setProgress(1);
      setPaused(true);
      return;
    }

    let active = true;

    const tick = (now: number) => {
      if (!active) return;
      if (!startedAt.current) startedAt.current = now;
      const elapsed = now - startedAt.current;
      const p = Math.min(elapsed / ANIMATION_MS, 1);
      setProgress(p);

      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setPaused(true);
        pauseTimer.current = setTimeout(() => {
          if (!active) return;
          setPaused(false);
          startedAt.current = 0;
          setProgress(0);
          rafRef.current = requestAnimationFrame(tick);
        }, PAUSE_AFTER_MS);
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      active = false;
      cancelAnimationFrame(rafRef.current);
      if (pauseTimer.current) clearTimeout(pauseTimer.current);
    };
  }, []);

  const realSeconds = Math.round(progress * REAL_DURATION_SEC);
  // Текущий активный шаг — последний, чей startsAt уже наступил
  const activeIdx = STEPS.reduce(
    (acc, step, i) => (realSeconds >= step.startsAt ? i : acc),
    0,
  );
  const isComplete = paused || progress >= 1;

  return (
    <section className="landing-section landing-reveal" id="demo" aria-labelledby="demo-heading">
      <div className="landing-section-head landing-reveal">
        <h2 id="demo-heading">Покупка за 47 секунд — наблюдай в реальном времени</h2>
        <p>Покупатель нажал «Купить» — наша система всё делает сама. Без VPN, без турецких карт, без аккаунтов на Razer.</p>
      </div>

      <div className="pfd-card landing-reveal">
        {/* Заголовок-метаданные */}
        <div className="pfd-header">
          <div className="pfd-header-left">
            <span className={`pfd-pulse ${isComplete ? 'pfd-pulse-done' : ''}`} aria-hidden="true" />
            <span className="pfd-status">
              {isComplete ? 'Покупка завершена' : 'Обработка заказа'}
            </span>
          </div>
          <div className="pfd-timer" aria-live="polite">
            <span className="pfd-timer-icon">
              <ClockIcon />
            </span>
            <span className="pfd-timer-value">
              00:{String(realSeconds).padStart(2, '0')}
            </span>
            <span className="pfd-timer-label">/ 00:47</span>
          </div>
        </div>

        {/* Прогресс-бар */}
        <div className="pfd-track" aria-hidden="true">
          <div
            className="pfd-track-fill"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        {/* 5 шагов */}
        <ol className="pfd-steps" role="list">
          {STEPS.map((step, i) => {
            const state = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'waiting';
            const Icon = step.Icon;
            return (
              <li key={step.id} className={`pfd-step pfd-step-${state}`} data-state={state}>
                <div className="pfd-step-time" aria-hidden="true">
                  00:{String(step.startsAt).padStart(2, '0')}
                </div>
                <div className="pfd-step-icon-wrap">
                  <div className="pfd-step-icon">
                    {state === 'done' ? (
                      <CheckIcon className="pfd-icon" />
                    ) : (
                      <Icon className="pfd-icon" />
                    )}
                  </div>
                  {/* Соединительная линия к следующему шагу */}
                  {i < STEPS.length - 1 && (
                    <div className="pfd-connector" aria-hidden="true">
                      <div
                        className="pfd-connector-fill"
                        style={{
                          // Считаем сколько % линии "залить" исходя из того, что мы между шагами i и i+1
                          width: `${connectorFill(i, realSeconds)}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
                <div className="pfd-step-text">
                  <b>{step.title}</b>
                  <span>{step.description}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <style jsx>{`
        .pfd-card {
          margin-top: 24px;
          padding: 32px 28px;
          border: 1px solid var(--line, rgba(255,255,255,.08));
          border-radius: 24px;
          background:
            radial-gradient(ellipse at top left, rgba(143,92,255,.08), transparent 60%),
            radial-gradient(ellipse at bottom right, rgba(34,197,94,.06), transparent 60%),
            linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.015));
          position: relative;
          overflow: hidden;
        }
        .pfd-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          margin-bottom: 20px;
        }
        .pfd-header-left {
          display: inline-flex;
          align-items: center;
          gap: 10px;
        }
        .pfd-pulse {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #8b5cf6;
          box-shadow: 0 0 0 0 rgba(139,92,246,.6);
          animation: pfdPulse 1.6s ease-in-out infinite;
        }
        .pfd-pulse-done {
          background: #22c55e;
          box-shadow: 0 0 0 0 rgba(34,197,94,.6);
        }
        @keyframes pfdPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(139,92,246,.5); }
          50% { box-shadow: 0 0 0 8px rgba(139,92,246,0); }
        }
        .pfd-status {
          font-size: 13px;
          font-weight: 600;
          color: #f4f4f5;
          letter-spacing: .02em;
        }
        .pfd-timer {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px;
          border: 1px solid rgba(255,255,255,.08);
          border-radius: 999px;
          background: rgba(0,0,0,.25);
          font-family: var(--font-jetbrains-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
          font-size: 14px;
          font-variant-numeric: tabular-nums;
        }
        .pfd-timer-icon {
          display: inline-flex;
          color: #a78bfa;
        }
        .pfd-timer-value {
          color: #f4f4f5;
          font-weight: 700;
        }
        .pfd-timer-label {
          color: #71717a;
          font-size: 12px;
        }
        .pfd-track {
          height: 3px;
          width: 100%;
          border-radius: 999px;
          background: rgba(255,255,255,.05);
          overflow: hidden;
          margin-bottom: 28px;
        }
        .pfd-track-fill {
          height: 100%;
          background: linear-gradient(90deg, #8b5cf6 0%, #6366f1 50%, #22c55e 100%);
          box-shadow: 0 0 12px rgba(139,92,246,.6);
          transition: width .15s linear;
        }

        .pfd-steps {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 8px;
        }
        @media (max-width: 760px) {
          .pfd-card { padding: 24px 18px; }
          .pfd-steps { grid-template-columns: 1fr; gap: 4px; }
        }

        .pfd-step {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 12px;
          padding: 8px 4px 0;
        }
        @media (max-width: 760px) {
          .pfd-step {
            flex-direction: row;
            text-align: left;
            align-items: flex-start;
            gap: 16px;
            padding: 8px 0;
          }
        }

        .pfd-step-time {
          font-family: var(--font-jetbrains-mono, ui-monospace, monospace);
          font-size: 11px;
          color: #71717a;
          letter-spacing: .08em;
          font-variant-numeric: tabular-nums;
          transition: color .3s;
        }
        .pfd-step-active .pfd-step-time { color: #a78bfa; }
        .pfd-step-done .pfd-step-time { color: #22c55e; }

        .pfd-step-icon-wrap {
          position: relative;
          width: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
        }
        @media (max-width: 760px) {
          .pfd-step-icon-wrap { width: auto; flex-shrink: 0; }
        }

        .pfd-step-icon {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255,255,255,.04);
          border: 1px solid rgba(255,255,255,.08);
          color: #71717a;
          flex-shrink: 0;
          z-index: 2;
          transition: all .35s cubic-bezier(.16,1,.3,1);
        }
        .pfd-step-active .pfd-step-icon {
          background: linear-gradient(135deg, #8b5cf6, #7c3aed);
          border-color: rgba(139,92,246,.5);
          color: #fff;
          box-shadow: 0 0 0 6px rgba(139,92,246,.15), 0 8px 28px rgba(139,92,246,.4);
          transform: scale(1.08);
          animation: pfdActiveBreathe 1.6s ease-in-out infinite;
        }
        .pfd-step-done .pfd-step-icon {
          background: linear-gradient(135deg, #22c55e, #16a34a);
          border-color: rgba(34,197,94,.4);
          color: #fff;
          box-shadow: 0 4px 18px rgba(34,197,94,.35);
        }
        @keyframes pfdActiveBreathe {
          0%, 100% { box-shadow: 0 0 0 6px rgba(139,92,246,.15), 0 8px 28px rgba(139,92,246,.4); }
          50%      { box-shadow: 0 0 0 12px rgba(139,92,246,.05), 0 12px 36px rgba(139,92,246,.55); }
        }

        .pfd-icon {
          width: 22px;
          height: 22px;
        }

        /* Соединительная линия между шагами (только на широких экранах) */
        .pfd-connector {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translateY(-50%);
          width: 100%;
          height: 2px;
          background: rgba(255,255,255,.06);
          z-index: 1;
          overflow: hidden;
          border-radius: 999px;
        }
        @media (max-width: 760px) {
          .pfd-connector { display: none; }
        }
        .pfd-connector-fill {
          height: 100%;
          background: linear-gradient(90deg, #8b5cf6, #22c55e);
          transition: width .25s linear;
          box-shadow: 0 0 8px rgba(139,92,246,.5);
        }

        .pfd-step-text {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-height: 48px;
        }
        .pfd-step-text b {
          font-size: 13px;
          font-weight: 700;
          color: #f4f4f5;
          letter-spacing: -.01em;
          transition: color .3s;
        }
        .pfd-step-text span {
          font-size: 12px;
          color: #71717a;
          line-height: 1.45;
        }
        .pfd-step-active .pfd-step-text b { color: #ffffff; }
        .pfd-step-done .pfd-step-text b { color: #22c55e; }

        /* Уважаем prefers-reduced-motion */
        @media (prefers-reduced-motion: reduce) {
          .pfd-pulse, .pfd-step-active .pfd-step-icon { animation: none; }
          .pfd-track-fill, .pfd-connector-fill, .pfd-step-icon { transition: none; }
        }
      `}</style>
    </section>
  );
}

/**
 * Сколько процентов соединительной линии между шагом i и i+1 уже залито
 * исходя из текущей realSeconds.
 */
function connectorFill(i: number, realSeconds: number): number {
  const a = STEPS[i].startsAt;
  const b = STEPS[i + 1]?.startsAt ?? REAL_DURATION_SEC;
  if (realSeconds < a) return 0;
  if (realSeconds >= b) return 100;
  return ((realSeconds - a) / (b - a)) * 100;
}

// ─────────────────── SVG line-icons (24×24, stroke-current 2px) ───────────────────

function CartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="17" cy="20" r="1.4" />
      <path d="M3 4h2l2.6 11.5a2 2 0 0 0 2 1.5h7.4a2 2 0 0 0 2-1.5L21 8H6" />
    </svg>
  );
}

function CardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2.5" />
      <line x1="2" y1="10" x2="22" y2="10" />
      <line x1="6" y1="15" x2="10" y2="15" />
    </svg>
  );
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L4 5v7c0 5 3.5 9 8 10 4.5-1 8-5 8-10V5l-8-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function CoinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 8l4 8 4-8" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </svg>
  );
}
