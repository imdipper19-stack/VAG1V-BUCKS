'use client';

/**
 * ReviewsCarousel — публичная карусель одобренных отзывов на лендинге.
 *
 * Поведение (см. design.md §3.1):
 *   • На mount фетчим /api/reviews/public?limit=50. На ошибке остаёмся в empty
 *     state молча — лендинг не должен падать из-за отзывов.
 *   • Авто-ротация каждые 6 сек когда reviews.length >= 2 И не на паузе И не
 *     развёрнут полный текст. (Requirement 1.6, 1.7.)
 *   • Pause при hover мыши, при touch и пока юзер читает развёрнутый отзыв.
 *   • Manual prev/next: кнопки `‹`/`›` + горизонтальный swipe (Requirement 1.8).
 *   • Empty state — одна карточка с точным текстом «Здесь мог отображаться
 *     ваш отзыв» + CTA. Без ротации (Requirement 2).
 */

import { useEffect, useRef, useState } from 'react';
import { reviewsApi, type PublicReview } from '@/lib/api';

const ROTATION_MS = 6000;
const TEXT_LIMIT = 240;
const SWIPE_THRESHOLD_PX = 50;

export default function ReviewsCarousel() {
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const touchStartX = useRef<number | null>(null);

  // Fetch on mount. Тихий fallback на пустой массив если бэк недоступен.
  useEffect(() => {
    let cancelled = false;
    reviewsApi
      .listPublic(50)
      .then((res) => {
        if (cancelled) return;
        const items = Array.isArray(res?.data) ? res.data : [];
        setReviews(items);
      })
      .catch(() => {
        // graceful: остаёмся с пустым массивом → отрисуется EmptyReviewCard
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Автоматическая ротация. Стоп если: пауза, < 2 отзывов, есть развёрнутый текст.
  useEffect(() => {
    if (paused) return;
    if (reviews.length < 2) return;
    if (expandedId !== null) return;

    const id = window.setInterval(() => {
      setActiveIndex((i) => (i + 1) % reviews.length);
    }, ROTATION_MS);

    return () => window.clearInterval(id);
  }, [paused, reviews.length, expandedId]);

  const goTo = (step: number) => {
    if (reviews.length === 0) return;
    setExpandedId(null); // при ручном переключении сворачиваем раскрытый текст
    setActiveIndex((i) => (i + step + reviews.length) % reviews.length);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
    setPaused(true);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const startX = touchStartX.current;
    touchStartX.current = null;
    setPaused(false);
    if (startX === null) return;
    const endX = e.changedTouches[0]?.clientX ?? startX;
    const dx = endX - startX;
    if (Math.abs(dx) <= SWIPE_THRESHOLD_PX) return;
    goTo(dx < 0 ? 1 : -1);
  };

  // Пока грузится первый ответ — не показываем ничего, чтобы не моргнуть
  // empty state'ом, а потом replace'нуть его реальной каруселью.
  if (loading) {
    return (
      <section className="landing-section landing-reveal" id="reviews" aria-labelledby="reviews-heading">
        <SectionHead />
        <div className="reviews-carousel-stage" aria-hidden="true" />
      </section>
    );
  }

  return (
    <section className="landing-section landing-reveal" id="reviews" aria-labelledby="reviews-heading">
      <SectionHead />

      <div
        className="reviews-carousel"
        role="group"
        aria-roledescription="carousel"
        aria-label="Отзывы покупателей"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {reviews.length === 0 ? (
          <EmptyReviewCard />
        ) : (
          <>
            <ReviewCard
              review={reviews[activeIndex]}
              isExpanded={expandedId === reviews[activeIndex].id}
              onExpand={() => setExpandedId(reviews[activeIndex].id)}
              onCollapse={() => setExpandedId(null)}
            />

            {reviews.length >= 2 && (
              <>
                <button
                  type="button"
                  className="reviews-nav reviews-nav-prev"
                  onClick={() => goTo(-1)}
                  aria-label="Предыдущий отзыв"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="reviews-nav reviews-nav-next"
                  onClick={() => goTo(1)}
                  aria-label="Следующий отзыв"
                >
                  ›
                </button>

                <div className="reviews-dots" role="tablist" aria-label="Слайды">
                  {reviews.map((r, i) => (
                    <button
                      key={r.id}
                      type="button"
                      role="tab"
                      aria-selected={i === activeIndex}
                      aria-label={`Отзыв ${i + 1} из ${reviews.length}`}
                      className={`reviews-dot${i === activeIndex ? ' is-active' : ''}`}
                      onClick={() => {
                        setExpandedId(null);
                        setActiveIndex(i);
                      }}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <style jsx>{`
        .reviews-carousel-stage {
          height: 280px;
        }
        .reviews-carousel {
          position: relative;
          margin-top: 24px;
          padding: 28px 56px;
          min-height: 280px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 22px;
          background:
            radial-gradient(ellipse at top left, rgba(143, 92, 255, 0.1), transparent 55%),
            radial-gradient(ellipse at bottom right, rgba(109, 66, 232, 0.06), transparent 55%),
            rgba(255, 255, 255, 0.025);
          backdrop-filter: blur(14px);
          overflow: hidden;
        }

        .reviews-nav {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          width: 40px;
          height: 40px;
          display: grid;
          place-items: center;
          padding: 0;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 50%;
          background: rgba(13, 12, 18, 0.7);
          color: #f7f5ff;
          font-size: 22px;
          line-height: 1;
          cursor: pointer;
          transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
        }
        .reviews-nav:hover {
          transform: translateY(-50%) scale(1.06);
          border-color: rgba(143, 92, 255, 0.6);
          background: rgba(143, 92, 255, 0.18);
        }
        .reviews-nav:focus-visible {
          outline: 2px solid #8f5cff;
          outline-offset: 2px;
        }
        .reviews-nav-prev { left: 10px; }
        .reviews-nav-next { right: 10px; }

        .reviews-dots {
          position: absolute;
          bottom: 14px;
          left: 0;
          right: 0;
          display: flex;
          justify-content: center;
          gap: 8px;
        }
        .reviews-dot {
          width: 8px;
          height: 8px;
          border: 0;
          border-radius: 50%;
          padding: 0;
          background: rgba(255, 255, 255, 0.18);
          cursor: pointer;
          transition: background 0.18s ease, transform 0.18s ease;
        }
        .reviews-dot:hover { background: rgba(255, 255, 255, 0.32); }
        .reviews-dot.is-active {
          background: linear-gradient(135deg, #8f5cff, #6d42e8);
          transform: scale(1.3);
        }
        .reviews-dot:focus-visible {
          outline: 2px solid #8f5cff;
          outline-offset: 2px;
        }

        @media (max-width: 640px) {
          .reviews-carousel { padding: 22px 18px 56px; }
          .reviews-nav-prev { left: 6px; }
          .reviews-nav-next { right: 6px; }
          .reviews-nav {
            width: 36px;
            height: 36px;
            font-size: 18px;
          }
        }
      `}</style>
    </section>
  );
}

function SectionHead() {
  return (
    <div className="landing-section-head landing-reveal">
      <h2 id="reviews-heading">Отзывы покупателей</h2>
      <p>Реальные впечатления от тех, кто уже купил V-Bucks.</p>
    </div>
  );
}

interface ReviewCardProps {
  review: PublicReview;
  isExpanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}

function ReviewCard({ review, isExpanded, onExpand, onCollapse }: ReviewCardProps) {
  const isLong = review.text.length > TEXT_LIMIT;
  const displayed = !isLong || isExpanded ? review.text : review.text.slice(0, TEXT_LIMIT) + '…';
  const formattedDate = formatReviewDate(review.createdAt);

  return (
    <article className="review-card" aria-roledescription="slide">
      <header className="review-head">
        <h3 className="review-nickname">{review.nickname}</h3>
        <Stars value={review.stars} />
      </header>

      <p className="review-text">
        {displayed}
        {isLong && !isExpanded && (
          <>
            {' '}
            <button type="button" className="review-expand" onClick={onExpand}>
              …читать дальше
            </button>
          </>
        )}
        {isLong && isExpanded && (
          <>
            {' '}
            <button type="button" className="review-expand" onClick={onCollapse}>
              свернуть
            </button>
          </>
        )}
      </p>

      <footer className="review-foot">
        <time dateTime={review.createdAt}>{formattedDate}</time>
      </footer>

      <style jsx>{`
        .review-card {
          display: flex;
          flex-direction: column;
          gap: 14px;
          min-height: 224px;
          padding: 4px 6px 28px;
        }
        .review-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          flex-wrap: wrap;
        }
        .review-nickname {
          margin: 0;
          font-size: clamp(20px, 2.4vw, 26px);
          font-weight: 800;
          letter-spacing: -0.02em;
          color: #f7f5ff;
        }
        .review-text {
          margin: 0;
          color: #d8d3e6;
          font-size: 15px;
          line-height: 1.65;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .review-expand {
          border: 0;
          padding: 0;
          background: none;
          color: #b79dff;
          font: inherit;
          font-weight: 700;
          cursor: pointer;
        }
        .review-expand:hover { color: #d6c5ff; }
        .review-expand:focus-visible {
          outline: 2px solid #8f5cff;
          outline-offset: 2px;
          border-radius: 4px;
        }
        .review-foot {
          margin-top: auto;
          color: #706b80;
          font-family: var(--font-jetbrains-mono), monospace;
          font-size: 12px;
        }
      `}</style>
    </article>
  );
}

function Stars({ value }: { value: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(value)));
  return (
    <span
      className="review-stars"
      role="img"
      aria-label={`Оценка ${filled} из 5`}
    >
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} filled={i < filled} />
      ))}
      <style jsx>{`
        .review-stars {
          display: inline-flex;
          gap: 2px;
        }
      `}</style>
    </span>
  );
}

function Star({ filled }: { filled: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill={filled ? '#fbbf24' : 'rgba(255,255,255,.15)'}
    >
      <path d="M12 2.5l2.95 5.98 6.6.96-4.78 4.66 1.13 6.57L12 17.77l-5.9 3.1 1.13-6.57L2.45 9.44l6.6-.96L12 2.5z" />
    </svg>
  );
}

function EmptyReviewCard() {
  return (
    <div className="reviews-empty-card" role="status">
      <div className="reviews-empty-icon" aria-hidden="true">★</div>
      <p className="reviews-empty-headline">Здесь мог отображаться ваш отзыв</p>
      <p className="reviews-empty-cta">
        Совершите покупку и станьте первым, кто оставит отзыв.
      </p>

      <style jsx>{`
        .reviews-empty-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          min-height: 224px;
          padding: 24px 16px;
          text-align: center;
        }
        .reviews-empty-icon {
          width: 56px;
          height: 56px;
          display: grid;
          place-items: center;
          border: 1px solid rgba(143, 92, 255, 0.4);
          border-radius: 50%;
          color: #fbbf24;
          font-size: 28px;
          background: rgba(143, 92, 255, 0.1);
          box-shadow: 0 0 32px rgba(143, 92, 255, 0.25);
          animation: reviewsEmptyPulse 2.4s ease-in-out infinite;
        }
        .reviews-empty-headline {
          margin: 4px 0 0;
          font-size: clamp(20px, 2.4vw, 26px);
          font-weight: 800;
          letter-spacing: -0.02em;
          color: #f7f5ff;
        }
        .reviews-empty-cta {
          margin: 0;
          max-width: 480px;
          color: #aaa5b9;
          font-size: 14px;
          line-height: 1.6;
        }
        @keyframes reviewsEmptyPulse {
          0%, 100% {
            box-shadow: 0 0 32px rgba(143, 92, 255, 0.25);
            transform: scale(1);
          }
          50% {
            box-shadow: 0 0 44px rgba(143, 92, 255, 0.45);
            transform: scale(1.04);
          }
        }
      `}</style>
    </div>
  );
}

function formatReviewDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(d);
  } catch {
    return d.toLocaleDateString('ru-RU');
  }
}
