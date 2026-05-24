'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';

import { reviewsApi, type ReviewEligibility } from '@/lib/api';

interface Props {
  /**
   * The human-readable orderId (e.g. `VB-2024-XXXXXX`) — matches the URL
   * parameter on the timeline page. The backend
   * {@link import('@/lib/api').reviewsApi} helpers translate it to the
   * UUID server-side, so we pass it through untouched.
   */
  orderId: string;
}

/**
 * State machine for the review submission card.
 *
 * - `loading`           — eligibility request is in flight.
 * - `eligible`          — server says the buyer can submit a review;
 *                         render CTA / form.
 * - `already_reviewed`  — server says a review already exists for this
 *                         order. Render «Спасибо…» panel, no form
 *                         (Requirement 3.3).
 * - `hidden`            — eligibility says no, with reason
 *                         `not_completed` / `window_expired` / unknown
 *                         OR the request itself errored. Render
 *                         nothing (Requirement 3.2 / 3.4).
 * - `submitted`         — the buyer just submitted; show the success
 *                         panel.
 */
type Phase =
  | { kind: 'loading' }
  | { kind: 'eligible' }
  | { kind: 'already_reviewed' }
  | { kind: 'hidden' }
  | { kind: 'submitted' };

interface FieldErrors {
  nickname?: string;
  stars?: string;
  text?: string;
  /** Form-level error (rate limit, network, etc). */
  _form?: string;
}

const NICKNAME_MIN = 2;
const NICKNAME_MAX = 64;
const TEXT_MIN = 10;
const TEXT_MAX = 1000;
const STARS_MIN = 0;
const STARS_MAX = 5;

const ACCENT = '#8f5cff';
const ACCENT_DEEP = '#6d42e8';
const STAR_GOLD = '#fbbf24';
const STAR_EMPTY = 'rgba(255, 255, 255, 0.18)';
const ERROR_RED = '#ef4444';
const TEXT_MUTED = '#a1a1aa';
const TEXT_DIM = '#71717a';

// ---------------------------------------------------------------------
// Validation — mirrors backend `CreateReviewDto` (Requirement 5).
// ---------------------------------------------------------------------

function validate(input: {
  nickname: string;
  stars: number | null;
  text: string;
}): FieldErrors {
  const errs: FieldErrors = {};

  const nick = input.nickname.trim();
  if (nick.length < NICKNAME_MIN) {
    errs.nickname = `Ник должен быть не короче ${NICKNAME_MIN} символов`;
  } else if (nick.length > NICKNAME_MAX) {
    errs.nickname = `Ник не длиннее ${NICKNAME_MAX} символов`;
  }

  if (
    input.stars === null ||
    !Number.isInteger(input.stars) ||
    input.stars < STARS_MIN ||
    input.stars > STARS_MAX
  ) {
    errs.stars = 'Выберите оценку';
  }

  const txt = input.text.trim();
  if (txt.length < TEXT_MIN) {
    errs.text = `Отзыв должен быть не короче ${TEXT_MIN} символов`;
  } else if (txt.length > TEXT_MAX) {
    errs.text = `Отзыв не длиннее ${TEXT_MAX} символов`;
  }

  return errs;
}

// ---------------------------------------------------------------------
// StarSelector — 6 buttons for values 0..5.
// ---------------------------------------------------------------------

interface StarSelectorProps {
  value: number | null;
  onChange: (v: number) => void;
  /** Optional id so an external <label> can point at the group. */
  id?: string;
  invalid?: boolean;
}

/**
 * Star selector with hover preview, click-to-lock, and full keyboard
 * support per task §12.2:
 *
 *   - 6 buttons for ratings 0..5 (rating 0 is a strikethrough star —
 *     «Без оценки»).
 *   - Hovering button #N highlights stars 1..N (button #0 unhighlights).
 *   - Clicking locks the selection.
 *   - ArrowLeft / ArrowRight move the rating ±1 on the selected button.
 *   - Home / End jump to 0 / 5.
 *   - Enter / Space activate (default browser button behaviour).
 *   - Each button exposes `aria-pressed` and `aria-label="N звёзд"`.
 */
function StarSelector({ value, onChange, id, invalid }: StarSelectorProps) {
  const [hover, setHover] = useState<number | null>(null);

  /** Effective rating shown on screen — hover wins over locked value. */
  const displayed = hover ?? value ?? -1;

  // Refs to focus a button after arrow-key navigation.
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKey = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, current: number) => {
      let next: number | null = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        next = Math.min(STARS_MAX, current + 1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        next = Math.max(STARS_MIN, current - 1);
      } else if (event.key === 'Home') {
        next = STARS_MIN;
      } else if (event.key === 'End') {
        next = STARS_MAX;
      }

      if (next !== null) {
        event.preventDefault();
        onChange(next);
        buttonRefs.current[next]?.focus();
      }
    },
    [onChange],
  );

  const buttons = useMemo(
    () => Array.from({ length: STARS_MAX - STARS_MIN + 1 }, (_, i) => i + STARS_MIN),
    [],
  );

  return (
    <div
      id={id}
      role="radiogroup"
      aria-label="Оценка"
      className="flex items-center gap-1.5"
      onMouseLeave={() => setHover(null)}
    >
      {buttons.map((n) => {
        const isFilled = n >= 1 && n <= displayed;
        const isSelected = value === n;
        const isZero = n === 0;

        return (
          <button
            key={n}
            ref={(el) => {
              buttonRefs.current[n] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-pressed={isSelected}
            aria-label={`${n} ${pluralStars(n)}`}
            tabIndex={
              // Roving tabindex: only the selected (or default-0) button is in
              // the tab sequence so Tab lands on the group once.
              value === null ? (n === 0 ? 0 : -1) : isSelected ? 0 : -1
            }
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(n)}
            onBlur={() => setHover(null)}
            onClick={() => onChange(n)}
            onKeyDown={(e) => handleKey(e, n)}
            className="relative inline-flex items-center justify-center rounded-md outline-none transition-transform"
            style={{
              width: isZero ? 28 : 32,
              height: 32,
              color: isFilled ? STAR_GOLD : STAR_EMPTY,
              transform: isSelected ? 'scale(1.1)' : 'scale(1)',
              filter: isFilled ? 'drop-shadow(0 0 6px rgba(251,191,36,.45))' : 'none',
              border: isSelected
                ? `1px solid ${invalid ? ERROR_RED : ACCENT}`
                : '1px solid transparent',
              background: isSelected
                ? `${invalid ? 'rgba(239,68,68,0.08)' : 'rgba(143,92,255,0.10)'}`
                : 'transparent',
              cursor: 'pointer',
            }}
          >
            {isZero ? <StrikedStarIcon /> : <StarIcon filled={isFilled} />}
          </button>
        );
      })}

      {/* Live label, e.g. "Оценка: 3 из 5". Helps non-sighted users
         confirm their selection without polling aria-pressed. */}
      <span
        aria-live="polite"
        className="ml-2 text-xs"
        style={{ color: TEXT_DIM, minWidth: 90 }}
      >
        {displayed >= 0 ? `${displayed} из ${STARS_MAX}` : 'Не выбрано'}
      </span>
    </div>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinejoin="round"
    >
      <path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.8L6.6 19.7l1-6L3.2 9.4l6.1-.9L12 3z" />
    </svg>
  );
}

function StrikedStarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6-5.4-2.8L6.6 19.7l1-6L3.2 9.4l6.1-.9L12 3z" />
      <path d="M5 19l14-14" />
    </svg>
  );
}

function pluralStars(n: number): string {
  // Russian plural rules for «звезда».
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'звёзд';
  if (mod10 === 1) return 'звезда';
  if (mod10 >= 2 && mod10 <= 4) return 'звезды';
  return 'звёзд';
}

// ---------------------------------------------------------------------
// ReviewSubmissionCard — main entry point.
// ---------------------------------------------------------------------

export default function ReviewSubmissionCard({ orderId }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [expanded, setExpanded] = useState(false);

  // Form state.
  const [nickname, setNickname] = useState('');
  const [stars, setStars] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const nicknameId = useId();
  const starsId = useId();
  const textId = useId();

  // -------------------------------------------------------------------
  // Eligibility on mount.
  // -------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await reviewsApi.checkEligibility(orderId);
        if (cancelled) return;

        const data: ReviewEligibility | undefined = res?.data;
        if (!data) {
          setPhase({ kind: 'hidden' });
          return;
        }

        if (data.alreadyReviewed) {
          setPhase({ kind: 'already_reviewed' });
        } else if (data.canSubmit) {
          setPhase({ kind: 'eligible' });
        } else {
          // not_completed | window_expired | anything else
          // → render nothing per Requirement 3.2 / 3.4.
          setPhase({ kind: 'hidden' });
        }
      } catch {
        // Network / 5xx — fail closed: hide the card rather than show
        // a confusing form that would just re-fail on submit.
        if (!cancelled) setPhase({ kind: 'hidden' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  // -------------------------------------------------------------------
  // Submit handler.
  // -------------------------------------------------------------------
  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (submitting) return;

      const errs = validate({ nickname, stars, text });
      if (Object.keys(errs).length > 0) {
        setErrors(errs);
        return;
      }
      setErrors({});
      setSubmitting(true);

      try {
        await reviewsApi.submit(orderId, {
          nickname: nickname.trim(),
          stars: stars ?? 0,
          text: text.trim(),
        });
        setPhase({ kind: 'submitted' });
      } catch (err) {
        const status: number | undefined =
          (err as { response?: { status?: number } })?.response?.status;
        const message: string | undefined =
          (err as { response?: { data?: { message?: string } } })?.response?.data
            ?.message;

        if (status === 429) {
          setErrors({
            _form: 'Вы отправили слишком много заявок. Попробуйте позже.',
          });
        } else if (status === 409) {
          // Race-condition: someone else (or another tab) already
          // submitted. Switch the card to «already_reviewed».
          setPhase({ kind: 'already_reviewed' });
        } else if (status === 400) {
          // Server-side validation rejection — surface the localised
          // message verbatim. Most common cases here are window
          // expired or order not completed reaching the submit path.
          setErrors({
            _form: message ?? 'Не удалось отправить отзыв. Попробуйте ещё раз.',
          });
        } else {
          setErrors({
            _form: message ?? 'Не удалось отправить отзыв. Попробуйте ещё раз.',
          });
        }
      } finally {
        setSubmitting(false);
      }
    },
    [nickname, stars, text, orderId, submitting],
  );

  // -------------------------------------------------------------------
  // Render branches.
  // -------------------------------------------------------------------

  // Loading: render nothing to avoid layout flash. The eligibility
  // check is fast and most users won't notice the brief gap.
  if (phase.kind === 'loading' || phase.kind === 'hidden') {
    return null;
  }

  if (phase.kind === 'already_reviewed') {
    return (
      <GlassCard>
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{
              background: 'rgba(143, 92, 255, 0.12)',
              border: '1px solid rgba(143, 92, 255, 0.25)',
              color: ACCENT,
            }}
          >
            <CheckIcon />
          </div>
          <div>
            <p className="text-sm font-medium" style={{ color: '#f4f4f5' }}>
              Спасибо, вы уже оставили отзыв
            </p>
            <p className="text-xs mt-1" style={{ color: TEXT_DIM }}>
              Он отправлен на модерацию. Появится на главной после одобрения.
            </p>
          </div>
        </div>
      </GlassCard>
    );
  }

  if (phase.kind === 'submitted') {
    return (
      <GlassCard>
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{
              background: 'linear-gradient(135deg, #22c55e, #16a34a)',
              boxShadow: '0 4px 18px rgba(34,197,94,0.35)',
              color: '#fff',
            }}
          >
            <CheckIcon />
          </div>
          <div>
            <p className="text-sm font-medium" style={{ color: '#f4f4f5' }}>
              Отзыв отправлен на модерацию
            </p>
            <p className="text-xs mt-1" style={{ color: TEXT_DIM }}>
              Спасибо за ваш отклик. Опубликуем после короткой проверки.
            </p>
          </div>
        </div>
      </GlassCard>
    );
  }

  // phase.kind === 'eligible' — collapsed CTA or expanded form.
  if (!expanded) {
    return (
      <GlassCard>
        <div className="flex items-center gap-4">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{
              background: 'rgba(143, 92, 255, 0.12)',
              border: '1px solid rgba(143, 92, 255, 0.25)',
              color: ACCENT,
            }}
          >
            <StarIcon filled={false} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium" style={{ color: '#f4f4f5' }}>
              Поделитесь впечатлением
            </p>
            <p className="text-xs mt-0.5" style={{ color: TEXT_DIM }}>
              Ваш отзыв увидят будущие покупатели на главной.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
            style={{
              background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_DEEP})`,
              color: '#fff',
              boxShadow: '0 4px 18px rgba(143,92,255,0.35)',
            }}
          >
            Оставить отзыв
          </button>
        </div>
      </GlassCard>
    );
  }

  // Expanded form.
  return (
    <GlassCard>
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <div>
          <h3 className="text-base font-semibold" style={{ color: '#f4f4f5' }}>
            Ваш отзыв
          </h3>
          <p className="text-xs mt-0.5" style={{ color: TEXT_DIM }}>
            Поможет нам и будущим покупателям. Спасибо.
          </p>
        </div>

        {/* Nickname */}
        <div>
          <label
            htmlFor={nicknameId}
            className="block text-xs font-medium mb-1.5"
            style={{ color: TEXT_MUTED }}
          >
            Ваш ник
          </label>
          <input
            id={nicknameId}
            type="text"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={NICKNAME_MAX}
            disabled={submitting}
            aria-invalid={Boolean(errors.nickname)}
            aria-describedby={errors.nickname ? `${nicknameId}-err` : undefined}
            placeholder="Например, FortniteMaster"
            className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none transition-all"
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: `1px solid ${
                errors.nickname ? ERROR_RED : 'rgba(255, 255, 255, 0.08)'
              }`,
              color: '#f4f4f5',
            }}
          />
          {errors.nickname && (
            <p
              id={`${nicknameId}-err`}
              className="text-xs mt-1.5"
              style={{ color: ERROR_RED }}
            >
              {errors.nickname}
            </p>
          )}
        </div>

        {/* Stars */}
        <div>
          <span
            id={`${starsId}-label`}
            className="block text-xs font-medium mb-2"
            style={{ color: TEXT_MUTED }}
          >
            Оценка
          </span>
          <StarSelector
            id={starsId}
            value={stars}
            onChange={setStars}
            invalid={Boolean(errors.stars)}
          />
          {errors.stars && (
            <p className="text-xs mt-1.5" style={{ color: ERROR_RED }}>
              {errors.stars}
            </p>
          )}
        </div>

        {/* Text */}
        <div>
          <label
            htmlFor={textId}
            className="block text-xs font-medium mb-1.5"
            style={{ color: TEXT_MUTED }}
          >
            Отзыв
          </label>
          <textarea
            id={textId}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={TEXT_MAX}
            rows={4}
            disabled={submitting}
            aria-invalid={Boolean(errors.text)}
            aria-describedby={`${textId}-count${errors.text ? ` ${textId}-err` : ''}`}
            placeholder="Расскажите, как прошла покупка"
            className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none transition-all resize-y"
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: `1px solid ${
                errors.text ? ERROR_RED : 'rgba(255, 255, 255, 0.08)'
              }`,
              color: '#f4f4f5',
              minHeight: 88,
            }}
          />
          <div className="flex items-center justify-between mt-1.5">
            {errors.text ? (
              <p
                id={`${textId}-err`}
                className="text-xs"
                style={{ color: ERROR_RED }}
              >
                {errors.text}
              </p>
            ) : (
              <span />
            )}
            <span
              id={`${textId}-count`}
              className="text-xs tabular-nums"
              style={{
                color:
                  text.length > TEXT_MAX * 0.9 ? STAR_GOLD : TEXT_DIM,
              }}
            >
              {text.length} / {TEXT_MAX}
            </span>
          </div>
        </div>

        {/* Form-level error */}
        {errors._form && (
          <div
            role="alert"
            className="px-3.5 py-2.5 rounded-xl text-xs"
            style={{
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              color: ERROR_RED,
            }}
          >
            {errors._form}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              if (submitting) return;
              setExpanded(false);
              setErrors({});
            }}
            disabled={submitting}
            className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              color: TEXT_MUTED,
              opacity: submitting ? 0.5 : 1,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-xl text-sm font-medium transition-all inline-flex items-center gap-2"
            style={{
              background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT_DEEP})`,
              color: '#fff',
              boxShadow: '0 4px 18px rgba(143,92,255,0.35)',
              opacity: submitting ? 0.7 : 1,
              cursor: submitting ? 'wait' : 'pointer',
            }}
          >
            {submitting && (
              <span
                className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin"
                aria-hidden
              />
            )}
            {submitting ? 'Отправка…' : 'Отправить отзыв'}
          </button>
        </div>
      </form>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------
// GlassCard — shared shell so every phase looks consistent.
// ---------------------------------------------------------------------

function GlassCard({ children }: { children: React.ReactNode }) {
  return (
    <section
      className="mt-8 rounded-2xl p-5 backdrop-blur"
      style={{
        background: 'rgba(255, 255, 255, 0.025)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow:
          '0 1px 0 rgba(255,255,255,0.04) inset, 0 12px 40px rgba(0,0,0,0.35)',
      }}
    >
      {children}
    </section>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
