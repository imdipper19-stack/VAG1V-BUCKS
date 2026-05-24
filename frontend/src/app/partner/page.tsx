'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import api from '@/lib/api';

/**
 * Partner program landing page (`/partner`).
 *
 * Public route, no authentication. Tasks 13.1–13.6.
 *
 * Visual language matches the rest of the site (oferta/privacy):
 * dark `#050507` background, purple radial highlights, glass cards.
 *
 * The page composition is intentionally linear so a candidate can scan
 * it top-to-bottom: hero → how it works → who it's for → application
 * form → cabinet login link.
 */

// `value` strings MUST match the `PartnerApplicationPlatformType` enum
// in the backend DTO `CreateApplicationDto` — they're sent verbatim.
const PLATFORM_OPTIONS = [
  { value: 'telegram', label: 'Telegram-канал' },
  { value: 'vk', label: 'VK-сообщество' },
  { value: 'twitch', label: 'Twitch' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'other', label: 'Другое' },
] as const;

type PlatformType = (typeof PLATFORM_OPTIONS)[number]['value'];

const HOW_IT_WORKS = [
  ['01', 'Подайте заявку', 'Расскажите о площадке и аудитории. Мы свяжемся с вами в Telegram в течение 1-2 рабочих дней.'],
  ['02', 'Получите промокод', 'После одобрения мы выдадим уникальный промокод и ссылку на личный кабинет партнёра.'],
  ['03', 'Делитесь с аудиторией', 'Покупатели вводят ваш промокод на оформлении заказа и получают скидку.'],
  ['04', 'Получайте процент', 'С каждой успешной покупки на ваш баланс начисляется комиссия. Выплаты — по запросу.'],
] as const;

const WHO_ITS_FOR = [
  'Владельцы Telegram-каналов о Fortnite и играх',
  'Администраторы VK-сообществ',
  'Стримеры на Twitch, YouTube, TikTok',
  'Создатели контента и обзорщики',
  'Любые площадки с активной аудиторией геймеров',
] as const;

interface FormState {
  displayName: string;
  platformType: PlatformType;
  platformUrl: string;
  audienceSize: string;
  contactTg: string;
  description: string;
}

const INITIAL_FORM: FormState = {
  displayName: '',
  platformType: 'telegram',
  platformUrl: '',
  audienceSize: '',
  contactTg: '',
  description: '',
};

type FieldErrors = Partial<Record<keyof FormState, string>>;

// Mirror of backend DTO validators (see
// `backend/src/partner/dto/create-application.dto.ts`):
//   - platformUrl: absolute http/https URL
//   - contactTg: `@` + 4-32 of [A-Za-z0-9_]
//   - description: 10..2000 chars
const URL_REGEX = /^https?:\/\/.+\..+/i;
const TG_REGEX = /^@[A-Za-z0-9_]{4,32}$/;

function validate(form: FormState): FieldErrors {
  const errors: FieldErrors = {};

  if (!form.displayName.trim()) errors.displayName = 'Это поле обязательно';
  else if (form.displayName.trim().length < 2) errors.displayName = 'Минимум 2 символа';

  if (!form.platformType) errors.platformType = 'Это поле обязательно';

  if (!form.platformUrl.trim()) {
    errors.platformUrl = 'Это поле обязательно';
  } else if (!URL_REGEX.test(form.platformUrl.trim())) {
    errors.platformUrl = 'URL должен начинаться с http:// или https://';
  }

  if (!form.audienceSize.trim()) errors.audienceSize = 'Это поле обязательно';

  if (!form.contactTg.trim()) {
    errors.contactTg = 'Это поле обязательно';
  } else if (!TG_REGEX.test(form.contactTg.trim())) {
    errors.contactTg = 'Контакт TG должен начинаться с @ и содержать 4-32 латинских символа/цифры/_';
  }

  if (!form.description.trim()) {
    errors.description = 'Это поле обязательно';
  } else if (form.description.trim().length < 10) {
    errors.description = 'Минимум 10 символов';
  } else if (form.description.trim().length > 2000) {
    errors.description = 'Максимум 2000 символов';
  }

  return errors;
}

export default function PartnerLandingPage() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleChange = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
    if (submitError) setSubmitError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;

    const fieldErrors = validate(form);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    const payload = {
      displayName: form.displayName.trim(),
      platformType: form.platformType,
      platformUrl: form.platformUrl.trim(),
      audienceSize: form.audienceSize.trim(),
      contactTg: form.contactTg.trim(),
      description: form.description.trim(),
    };

    try {
      // axios throws for non-2xx; the controller responds 201 on success.
      await api.post('/partner/applications', payload);
      setSubmitted(true);
    } catch (err) {
      // Surface the backend's localized message if available, fall back
      // to a generic notice. class-validator returns `message` as an
      // array of strings; pick the first.
      const status = (err as { response?: { status?: number } })?.response?.status;
      const data = (err as { response?: { data?: { message?: string | string[]; error?: string } } })?.response?.data;
      let message: string;
      if (status && status >= 500) {
        message = 'Произошла ошибка. Попробуйте ещё раз позже.';
      } else if (Array.isArray(data?.message)) {
        message = data!.message[0] ?? 'Не удалось отправить заявку. Проверьте поля.';
      } else if (typeof data?.message === 'string') {
        message = data.message;
      } else if (typeof data?.error === 'string') {
        message = data.error;
      } else {
        message = 'Не удалось отправить заявку. Проверьте поля и попробуйте ещё раз.';
      }
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#050507] text-[#f7f5ff]" style={{ fontFamily: 'var(--font-manrope), var(--font-inter), system-ui, sans-serif' }}>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 8%, rgba(143,92,255,0.18), transparent 36%), radial-gradient(circle at 82% 42%, rgba(39,232,244,0.07), transparent 30%), linear-gradient(180deg, #07070a 0%, #050507 52%, #08070c 100%)',
        }}
      />

      <div className="relative z-10 mx-auto w-[min(1080px,calc(100%-32px))] px-0 py-8 md:py-12">
        {/* top bar */}
        <div className="flex items-center justify-between gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[.03] px-4 py-2 text-sm text-[#aaa5b9] transition-colors hover:text-[#f7f5ff]"
          >
            ← На главную
          </Link>
          <Link
            href="/partner/login"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[.04] px-4 py-2 text-sm font-semibold text-[#cbc6d6] transition-colors hover:text-[#f7f5ff]"
          >
            Войти в кабинет партнёра →
          </Link>
        </div>

        {/* hero */}
        <section className="mt-10 md:mt-16 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(143,92,255,.24)] bg-[rgba(143,92,255,.12)] px-3 py-1.5 text-xs font-extrabold text-[#dcd3ff]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#41e59d]" style={{ boxShadow: '0 0 14px rgba(65,229,157,.9)' }} />
            Партнёрская программа Bag1V-Bucks
          </span>
          <h1 className="mx-auto mt-5 max-w-[820px] text-[clamp(44px,8vw,96px)] font-extrabold leading-[.86] tracking-[-.075em]">
            Зарабатывайте <span className="text-[#b79dff]" style={{ textShadow: '0 0 42px rgba(143,92,255,.48)' }}>с каждой продажи</span>
          </h1>
          <p className="mx-auto mt-6 max-w-[600px] text-[15px] leading-[1.65] text-[#aaa5b9]">
            Получите свой уникальный промокод. Покупатели платят меньше, вы — получаете процент с каждого
            успешно выполненного заказа. Прозрачная статистика и выплаты по запросу.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href="#apply"
              className="inline-flex items-center justify-center rounded-2xl px-6 py-3.5 text-sm font-extrabold text-[#fbfaff] transition-transform hover:-translate-y-0.5"
              style={{
                background: 'linear-gradient(135deg, #8f5cff, #6d42e8)',
                boxShadow: '0 0 28px rgba(143,92,255,.34)',
              }}
            >
              Подать заявку
            </a>
            <a
              href="#how"
              className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[.035] px-6 py-3.5 text-sm font-semibold text-[#cbc6d6] transition-colors hover:text-[#f7f5ff]"
            >
              Как это работает
            </a>
          </div>
        </section>

        {/* how it works */}
        <section id="how" className="mt-20 md:mt-28">
          <header className="mx-auto max-w-[640px] text-center">
            <h2 className="text-[clamp(28px,4vw,42px)] font-extrabold tracking-[-.045em]">Как это работает</h2>
            <p className="mt-3 text-sm leading-[1.65] text-[#aaa5b9]">
              Четыре шага от подачи заявки до первой выплаты. Без скрытых условий и сложных интеграций.
            </p>
          </header>
          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map(([num, title, description]) => (
              <div
                key={num}
                className="rounded-3xl border border-white/10 bg-white/[.025] p-6 transition-colors hover:border-[rgba(143,92,255,.28)]"
              >
                <span
                  className="font-[var(--font-jetbrains-mono),monospace] text-[11px] uppercase tracking-[.12em] text-[#b79dff]"
                  style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}
                >
                  {num}
                </span>
                <h3 className="mt-3 text-lg font-extrabold tracking-[-.03em] text-[#f7f5ff]">{title}</h3>
                <p className="mt-2 text-sm leading-[1.6] text-[#aaa5b9]">{description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* who it's for */}
        <section className="mt-20 md:mt-28">
          <div className="grid gap-8 rounded-[32px] border border-white/10 bg-white/[.025] p-8 md:p-12 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <span
                className="font-[var(--font-jetbrains-mono),monospace] text-[11px] uppercase tracking-[.12em] text-[#706b80]"
                style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}
              >
                Кому подходит
              </span>
              <h2 className="mt-3 text-[clamp(28px,4vw,42px)] font-extrabold leading-[1.05] tracking-[-.045em]">
                Аудитория, которой интересен Fortnite
              </h2>
              <p className="mt-4 text-sm leading-[1.65] text-[#aaa5b9]">
                Если у вас есть площадка с подписчиками, которым может быть интересна покупка V-Bucks —
                программа подходит. Размер аудитории не критичен; важна её вовлечённость.
              </p>
              <p className="mt-4 text-xs leading-[1.6] text-[#706b80]">
                Решение по заявке принимаем индивидуально. Условия (процент скидки и комиссии) обсуждаем
                с каждым партнёром отдельно.
              </p>
            </div>
            <ul className="grid gap-3 self-center">
              {WHO_ITS_FOR.map((item) => (
                <li
                  key={item}
                  className="flex items-start gap-3 rounded-2xl border border-white/[.07] bg-white/[.02] p-4 text-sm leading-[1.5] text-[#cbc6d6]"
                >
                  <span
                    aria-hidden
                    className="mt-1 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold text-[#fbfaff]"
                    style={{ background: 'linear-gradient(135deg, #8f5cff, #6d42e8)' }}
                  >
                    ✓
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* application form */}
        <section id="apply" className="mt-20 md:mt-28 scroll-mt-8">
          <header className="mx-auto max-w-[640px] text-center">
            <h2 className="text-[clamp(28px,4vw,42px)] font-extrabold tracking-[-.045em]">Подать заявку</h2>
            <p className="mt-3 text-sm leading-[1.65] text-[#aaa5b9]">
              Заполните форму. Мы свяжемся с вами в Telegram в течение 1-2 рабочих дней.
            </p>
          </header>

          <div className="mx-auto mt-10 max-w-[720px]">
            {submitted ? (
              <SuccessCard />
            ) : (
              <ApplicationForm
                form={form}
                errors={errors}
                submitting={submitting}
                submitError={submitError}
                onChange={handleChange}
                onSubmit={handleSubmit}
              />
            )}
          </div>
        </section>

        {/* footer link */}
        <div className="mt-20 mb-4 flex justify-center md:mt-24">
          <Link
            href="/partner/login"
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[.04] px-5 py-3 text-sm font-semibold text-[#cbc6d6] transition-colors hover:text-[#f7f5ff]"
          >
            Уже есть аккаунт партнёра? Войти в кабинет →
          </Link>
        </div>
      </div>
    </main>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Subcomponents
// ────────────────────────────────────────────────────────────────────────

function SuccessCard() {
  return (
    <div
      className="rounded-[28px] border border-[rgba(65,229,157,.28)] bg-[rgba(65,229,157,.06)] p-8 text-center md:p-12"
      role="status"
      aria-live="polite"
    >
      <div
        className="mx-auto flex h-14 w-14 items-center justify-center rounded-full text-2xl font-extrabold text-[#0a0a0a]"
        style={{ background: 'linear-gradient(135deg, #41e59d, #22c55e)', boxShadow: '0 0 32px rgba(65,229,157,.4)' }}
        aria-hidden
      >
        ✓
      </div>
      <h3 className="mt-5 text-2xl font-extrabold tracking-[-.035em] text-[#f7f5ff]">Заявка принята!</h3>
      <p className="mx-auto mt-3 max-w-[480px] text-sm leading-[1.65] text-[#aaa5b9]">
        Мы свяжемся с вами в Telegram в течение 1-2 рабочих дней. После одобрения вы получите ссылку на
        личный кабинет партнёра и свой уникальный промокод.
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[.04] px-5 py-3 text-sm font-semibold text-[#cbc6d6] transition-colors hover:text-[#f7f5ff]"
        >
          На главную
        </Link>
      </div>
    </div>
  );
}

interface ApplicationFormProps {
  form: FormState;
  errors: FieldErrors;
  submitting: boolean;
  submitError: string | null;
  onChange: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function ApplicationForm({ form, errors, submitting, submitError, onChange, onSubmit }: ApplicationFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="rounded-[28px] border border-white/10 bg-white/[.025] p-6 md:p-10"
    >
      {submitError && (
        <div
          role="alert"
          className="mb-6 rounded-2xl border border-[rgba(239,68,68,.32)] bg-[rgba(239,68,68,.08)] px-4 py-3 text-sm text-[#fecaca]"
        >
          {submitError}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <Field
          label="Имя или ник"
          name="displayName"
          error={errors.displayName}
        >
          <input
            id="displayName"
            type="text"
            autoComplete="name"
            value={form.displayName}
            onChange={(e) => onChange('displayName', e.target.value)}
            disabled={submitting}
            aria-invalid={Boolean(errors.displayName)}
            className={inputClass(errors.displayName)}
            placeholder="Иван / FortniteMaster"
            maxLength={128}
          />
        </Field>

        <Field
          label="Тип площадки"
          name="platformType"
          error={errors.platformType}
        >
          <select
            id="platformType"
            value={form.platformType}
            onChange={(e) => onChange('platformType', e.target.value as PlatformType)}
            disabled={submitting}
            aria-invalid={Boolean(errors.platformType)}
            className={inputClass(errors.platformType)}
          >
            {PLATFORM_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} className="bg-[#0a0a0f] text-[#f7f5ff]">
                {opt.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-5">
        <Field
          label="Ссылка на площадку"
          name="platformUrl"
          error={errors.platformUrl}
        >
          <input
            id="platformUrl"
            type="url"
            inputMode="url"
            autoComplete="url"
            value={form.platformUrl}
            onChange={(e) => onChange('platformUrl', e.target.value)}
            disabled={submitting}
            aria-invalid={Boolean(errors.platformUrl)}
            className={inputClass(errors.platformUrl)}
            placeholder="https://t.me/your_channel"
            maxLength={512}
          />
        </Field>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Field
          label="Размер аудитории"
          name="audienceSize"
          hint="например, 5 000 подписчиков"
          error={errors.audienceSize}
        >
          <input
            id="audienceSize"
            type="text"
            value={form.audienceSize}
            onChange={(e) => onChange('audienceSize', e.target.value)}
            disabled={submitting}
            aria-invalid={Boolean(errors.audienceSize)}
            className={inputClass(errors.audienceSize)}
            placeholder="5 000 подписчиков"
            maxLength={64}
          />
        </Field>

        <Field
          label="Контакт TG"
          name="contactTg"
          hint="ваш @username"
          error={errors.contactTg}
        >
          <input
            id="contactTg"
            type="text"
            value={form.contactTg}
            onChange={(e) => onChange('contactTg', e.target.value)}
            disabled={submitting}
            aria-invalid={Boolean(errors.contactTg)}
            className={inputClass(errors.contactTg)}
            placeholder="@your_username"
            maxLength={64}
          />
        </Field>
      </div>

      <div className="mt-5">
        <Field
          label="О вашей аудитории"
          name="description"
          hint="Тематика, гео, средний возраст…"
          error={errors.description}
        >
          <textarea
            id="description"
            value={form.description}
            onChange={(e) => onChange('description', e.target.value)}
            disabled={submitting}
            aria-invalid={Boolean(errors.description)}
            rows={5}
            className={`${inputClass(errors.description)} min-h-[120px] resize-y`}
            placeholder="Например: канал о Fortnite, аудитория 14-22 года, СНГ, активность 8% в сутки."
            maxLength={2000}
          />
        </Field>
        <div
          className="mt-1 text-right text-[11px] tabular-nums text-[#706b80]"
          style={{ fontFamily: 'var(--font-jetbrains-mono), monospace' }}
        >
          {form.description.length} / 2000
        </div>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="mt-7 inline-flex w-full items-center justify-center rounded-2xl px-6 py-4 text-sm font-extrabold text-[#fbfaff] transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
        style={{
          background: 'linear-gradient(135deg, #8f5cff, #6d42e8)',
          boxShadow: '0 0 28px rgba(143,92,255,.34)',
        }}
      >
        {submitting ? 'Отправляем…' : 'Отправить заявку'}
      </button>

      <p className="mt-4 text-center text-[11px] leading-[1.5] text-[#706b80]">
        Отправляя заявку, вы соглашаетесь с обработкой персональных данных согласно{' '}
        <Link href="/privacy" className="text-[#b79dff] hover:underline">
          политике конфиденциальности
        </Link>
        .
      </p>
    </form>
  );
}

interface FieldProps {
  label: string;
  name: keyof FormState;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}

function Field({ label, name, hint, error, children }: FieldProps) {
  return (
    <div>
      <label
        htmlFor={name}
        className="mb-2 block text-xs font-semibold uppercase tracking-[.08em] text-[#aaa5b9]"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p
          id={`${name}-error`}
          role="alert"
          className="mt-1.5 text-xs text-[#fca5a5]"
        >
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-[#706b80]">{hint}</p>
      ) : null}
    </div>
  );
}

function inputClass(hasError?: string): string {
  // Single-source-of-truth styling for inputs/selects/textareas to keep
  // the form visually coherent. Error state swaps the border colour.
  const base =
    'w-full rounded-2xl border bg-white/[.03] px-4 py-3 text-sm text-[#f7f5ff] placeholder:text-[#5a5564] outline-none transition-colors focus:bg-white/[.05] disabled:opacity-60 disabled:cursor-not-allowed';
  const border = hasError
    ? 'border-[rgba(239,68,68,.5)] focus:border-[rgba(239,68,68,.75)]'
    : 'border-white/10 focus:border-[rgba(143,92,255,.55)]';
  return `${base} ${border}`;
}
