'use client';

/**
 * Admin · Partners list page (Task 17.2, Requirement 6.1, 7.1).
 *
 * Lists every Partner with the key fields the admin needs at a glance
 * (login, promo code, rates, status, balance, total earned) and
 * exposes a "Создать вручную" workflow that mirrors the application
 * approve flow — same DTO shape on the backend, same shape of result
 * (partner + promo code + invite link) so the success modal can be
 * reused as-is from the applications page.
 *
 * Auth: relies on the shared axios `api` client which auto-attaches
 * `admin_token`. A 401 redirects to /admin/login via the interceptor.
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { clearAdminSession, getAdminToken, getAdminUser } from '@/lib/auth';

// ─── types mirrored from backend ────────────────────────────────────────

type PartnerStatus = 'active' | 'disabled';

interface PartnerListItem {
  id: string;
  username: string;
  displayName: string;
  contactTg: string;
  discountRate: number | string;
  commissionRate: number | string;
  status: PartnerStatus;
  createdAt: string;
  currentPromoCode: string | null;
  partnerBalance: number;
  totalEarned: number;
}

interface CreatePartnerResult {
  partner: { id: string; username: string; displayName: string };
  promoCode: string;
  inviteToken: string;
  inviteLink: string;
}

// ─── helpers ────────────────────────────────────────────────────────────

function formatRate(rate: number | string): string {
  const n = typeof rate === 'number' ? rate : Number(rate);
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

function formatRub(amount: number): string {
  return `${amount.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

function extractApiError(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: { message?: string | string[] } } })
    ?.response?.data;
  if (Array.isArray(data?.message)) return data.message[0] ?? fallback;
  if (typeof data?.message === 'string') return data.message;
  return fallback;
}

// ─── component ──────────────────────────────────────────────────────────

export default function AdminPartnersPage() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);

  const [partners, setPartners] = useState<PartnerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createResult, setCreateResult] = useState<CreatePartnerResult | null>(
    null,
  );

  useEffect(() => {
    const token = getAdminToken();
    const user = getAdminUser();
    if (!token || !user) {
      clearAdminSession();
      router.push('/admin/login');
      return;
    }
    setAuthReady(true);
  }, [router]);

  const fetchPartners = useMemo(
    () => async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await api.get('/admin/partners');
        setPartners(response.data?.data ?? []);
      } catch (err) {
        setError(extractApiError(err, 'Не удалось загрузить партнёров'));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (authReady) void fetchPartners();
  }, [authReady, fetchPartners]);

  const handleCreated = (result: CreatePartnerResult) => {
    setCreateOpen(false);
    setCreateResult(result);
    void fetchPartners();
  };

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 border-2 border-transparent border-t-purple-400 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AdminHeader active="partners" />

      <main className="p-4 sm:p-9 max-w-[1400px] mx-auto">
        <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold" style={{ color: '#f4f4f5' }}>
            Партнёры
          </h1>
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="text-sm transition-colors hover:text-white"
              style={{ color: '#71717a' }}
            >
              ← К панели
            </Link>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{
                background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
                color: 'white',
                boxShadow: '0 4px 20px rgba(139,92,246,.4)',
              }}
            >
              + Создать вручную
            </button>
          </div>
        </div>

        {error && (
          <div
            className="p-4 rounded-xl mb-5 text-sm"
            style={{
              background: 'rgba(239,68,68,.12)',
              border: '1px solid rgba(239,68,68,.3)',
              color: '#fecaca',
            }}
          >
            {error}
          </div>
        )}

        <div
          className="rounded-[24px] overflow-hidden"
          style={{
            background: 'rgba(255,255,255,.03)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,.06)',
          }}
        >
          {loading ? (
            <div className="p-8 text-center" style={{ color: '#71717a' }}>
              Загрузка…
            </div>
          ) : partners.length === 0 ? (
            <div className="p-8 text-center" style={{ color: '#71717a' }}>
              Партнёров пока нет. Создайте первого вручную или одобрите заявку.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px]">
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,.02)' }}>
                    {[
                      'Имя',
                      'Логин',
                      'Промокод',
                      '% скидки',
                      '% комиссии',
                      'Статус',
                      'Баланс',
                      'Заработано',
                      'Действия',
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-5 py-4 text-left text-xs uppercase tracking-widest font-medium"
                        style={{ color: '#71717a' }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {partners.map((p) => (
                    <tr
                      key={p.id}
                      className="transition-colors hover:bg-white/5"
                      style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}
                    >
                      <td className="px-5 py-4 text-sm font-medium" style={{ color: '#f4f4f5' }}>
                        {p.displayName}
                        <div className="text-xs mt-0.5" style={{ color: '#71717a' }}>
                          {p.contactTg}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm font-mono" style={{ color: '#a1a1aa' }}>
                        {p.username}
                      </td>
                      <td className="px-5 py-4">
                        {p.currentPromoCode ? (
                          <span
                            className="inline-block font-mono text-xs font-bold tracking-wider px-2.5 py-1 rounded-md"
                            style={{
                              background: 'rgba(139,92,246,.12)',
                              border: '1px solid rgba(139,92,246,.25)',
                              color: '#c4b5fd',
                            }}
                          >
                            {p.currentPromoCode}
                          </span>
                        ) : (
                          <span className="text-xs" style={{ color: '#71717a' }}>
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-sm font-mono" style={{ color: '#cbd5e1' }}>
                        {formatRate(p.discountRate)}
                      </td>
                      <td className="px-5 py-4 text-sm font-mono" style={{ color: '#cbd5e1' }}>
                        {formatRate(p.commissionRate)}
                      </td>
                      <td className="px-5 py-4">
                        <PartnerStatusBadge status={p.status} />
                      </td>
                      <td className="px-5 py-4 text-sm font-mono" style={{ color: '#22c55e' }}>
                        {formatRub(Number(p.partnerBalance) || 0)}
                      </td>
                      <td className="px-5 py-4 text-sm font-mono" style={{ color: '#a1a1aa' }}>
                        {formatRub(Number(p.totalEarned) || 0)}
                      </td>
                      <td className="px-5 py-4">
                        <Link
                          href={`/admin/partners/${p.id}`}
                          className="text-sm font-medium transition-colors"
                          style={{ color: '#a78bfa' }}
                        >
                          Подробнее →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {createOpen && (
        <CreatePartnerModal
          onClose={() => setCreateOpen(false)}
          onSuccess={handleCreated}
        />
      )}
      {createResult && (
        <CreateResultModal
          result={createResult}
          onClose={() => setCreateResult(null)}
        />
      )}
    </div>
  );
}

// ─── shared header ──────────────────────────────────────────────────────

function AdminHeader({
  active,
}: {
  active: 'applications' | 'partners' | 'payouts';
}) {
  const items = [
    { key: 'applications', label: 'Заявки', href: '/admin/applications' },
    { key: 'partners', label: 'Партнёры', href: '/admin/partners' },
    { key: 'payouts', label: 'Выплаты', href: '/admin/payouts' },
  ] as const;
  return (
    <header
      className="sticky top-0 z-40 px-4 sm:px-9 py-4 flex justify-between items-center gap-3"
      style={{
        background: 'rgba(10,10,15,.9)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,.06)',
      }}
    >
      <Link href="/admin" className="flex items-center gap-3 min-w-0">
        <div
          className="w-9 h-9 flex-shrink-0 rounded-lg flex items-center justify-center font-extrabold text-base"
          style={{ background: 'linear-gradient(135deg,#8b5cf6,#a78bfa)' }}
        >
          V
        </div>
        <span className="font-bold text-base truncate" style={{ color: '#f4f4f5' }}>
          <span className="hidden sm:inline">Bag1V-Bucks </span>Admin
        </span>
      </Link>
      <nav className="flex items-center gap-1 text-sm">
        {items.map((item) => {
          const isActive = item.key === active;
          return (
            <Link
              key={item.key}
              href={item.href}
              className="px-3 py-2 rounded-lg transition-colors"
              style={
                isActive
                  ? { color: '#a78bfa', background: 'rgba(139,92,246,.1)' }
                  : { color: '#a1a1aa' }
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

// ─── status badge ───────────────────────────────────────────────────────

function PartnerStatusBadge({ status }: { status: PartnerStatus }) {
  const styles: Record<PartnerStatus, { bg: string; color: string; label: string }> = {
    active: {
      bg: 'rgba(34,197,94,.12)',
      color: '#22c55e',
      label: 'Активен',
    },
    disabled: {
      bg: 'rgba(113,113,122,.18)',
      color: '#a1a1aa',
      label: 'Отключён',
    },
  };
  const s = styles[status];
  return (
    <span
      className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap"
      style={{ background: s.bg, color: s.color }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: s.color }}
      />
      {s.label}
    </span>
  );
}

// ─── create modal ───────────────────────────────────────────────────────

function CreatePartnerModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (result: CreatePartnerResult) => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [contactTg, setContactTg] = useState('');
  // Inputs hold percentages (0-100). We divide by 100 before posting
  // since the backend DTO expects fractions in [0..1].
  const [discountRate, setDiscountRate] = useState('5');
  const [commissionRate, setCommissionRate] = useState('10');
  const [username, setUsername] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dRate = Number(discountRate);
  const cRate = Number(commissionRate);
  const ratesValid =
    Number.isFinite(dRate) &&
    Number.isFinite(cRate) &&
    dRate >= 0 &&
    cRate >= 0 &&
    dRate <= 100 &&
    cRate <= 100;
  const sumExceeds = ratesValid && dRate + cRate > 100;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!displayName.trim()) {
      setErr('Укажите имя партнёра');
      return;
    }
    if (!/^@[A-Za-z0-9_]{4,32}$/.test(contactTg.trim())) {
      setErr('Контакт TG должен начинаться с @ и содержать 4-32 латинских символа/цифры/_');
      return;
    }
    if (!ratesValid) {
      setErr('Проценты должны быть в диапазоне 0..100');
      return;
    }
    if (sumExceeds) {
      setErr('Сумма скидки и комиссии не должна превышать 100%');
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        displayName: displayName.trim(),
        contactTg: contactTg.trim(),
        discountRate: dRate / 100,
        commissionRate: cRate / 100,
      };
      if (username.trim()) body.username = username.trim();
      if (promoCode.trim()) body.promoCode = promoCode.trim().toUpperCase();
      const response = await api.post('/admin/partners', body);
      onSuccess(response.data?.data as CreatePartnerResult);
    } catch (e2) {
      setErr(extractApiError(e2, 'Не удалось создать партнёра'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ModalShell title="Создать партнёра вручную" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="Имя / ник"
            value={displayName}
            onChange={setDisplayName}
            placeholder="FortniteMaster"
          />
          <TextField
            label="Контакт TG"
            value={contactTg}
            onChange={setContactTg}
            placeholder="@username"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <NumberRateField
            label="% скидки покупателю"
            value={discountRate}
            onChange={setDiscountRate}
            placeholder="5"
          />
          <NumberRateField
            label="% комиссии партнёру"
            value={commissionRate}
            onChange={setCommissionRate}
            placeholder="10"
          />
        </div>

        <div
          className="text-xs leading-relaxed"
          style={{ color: sumExceeds ? '#fca5a5' : '#71717a' }}
        >
          Сумма скидки и комиссии не должна превышать 100%.
          {ratesValid && (
            <span className="ml-1">
              Сейчас: {(dRate + cRate).toFixed(1)}%
            </span>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="Логин (опционально)"
            value={username}
            onChange={setUsername}
            placeholder="auto-derived"
          />
          <TextField
            label="Промокод (опционально)"
            value={promoCode}
            onChange={(v) => setPromoCode(v.toUpperCase())}
            placeholder="auto-generated"
          />
        </div>

        {err && (
          <div
            className="p-3 rounded-lg text-sm"
            style={{
              background: 'rgba(239,68,68,.12)',
              border: '1px solid rgba(239,68,68,.3)',
              color: '#fecaca',
            }}
          >
            {err}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
            style={{
              background: 'rgba(255,255,255,.04)',
              border: '1px solid rgba(255,255,255,.08)',
              color: '#cbd5e1',
            }}
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={submitting || !ratesValid || sumExceeds}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
              color: 'white',
              boxShadow: '0 4px 20px rgba(139,92,246,.4)',
            }}
          >
            {submitting ? 'Создаём…' : 'Создать партнёра'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ─── result modal ───────────────────────────────────────────────────────

function CreateResultModal({
  result,
  onClose,
}: {
  result: CreatePartnerResult;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  const handleCopy = async (text: string, kind: 'link' | 'code') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      /* ignore */
    }
  };

  return (
    <ModalShell title="Партнёр создан" onClose={onClose}>
      <div className="space-y-5">
        <div
          className="rounded-xl p-4"
          style={{
            background: 'rgba(34,197,94,.08)',
            border: '1px solid rgba(34,197,94,.25)',
          }}
        >
          <div className="text-xs uppercase tracking-widest mb-1" style={{ color: '#22c55e' }}>
            Партнёр
          </div>
          <div className="font-semibold" style={{ color: '#f4f4f5' }}>
            {result.partner.displayName}
          </div>
          <div className="text-xs mt-1" style={{ color: '#71717a' }}>
            Логин: <span className="font-mono">{result.partner.username}</span>
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-widest mb-2" style={{ color: '#71717a' }}>
            Промокод
          </div>
          <div className="flex items-center gap-2">
            <span
              className="flex-1 font-mono text-lg font-bold tracking-wider px-4 py-3 rounded-xl"
              style={{
                background: 'rgba(139,92,246,.1)',
                border: '1px solid rgba(139,92,246,.25)',
                color: '#c4b5fd',
              }}
            >
              {result.promoCode}
            </span>
            <button
              type="button"
              onClick={() => handleCopy(result.promoCode, 'code')}
              className="px-3 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap"
              style={{
                background:
                  copied === 'code' ? '#22c55e' : 'rgba(255,255,255,.06)',
                border:
                  copied === 'code'
                    ? '1px solid #22c55e'
                    : '1px solid rgba(255,255,255,.08)',
                color: copied === 'code' ? 'white' : '#f4f4f5',
              }}
            >
              {copied === 'code' ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-widest mb-2" style={{ color: '#71717a' }}>
            Invite-ссылка для партнёра
          </div>
          <div className="flex items-center gap-2">
            <span
              className="flex-1 font-mono text-xs px-4 py-3 rounded-xl truncate"
              style={{
                background: 'rgba(255,255,255,.03)',
                border: '1px solid rgba(255,255,255,.08)',
                color: '#a1a1aa',
              }}
            >
              {result.inviteLink}
            </span>
            <button
              type="button"
              onClick={() => handleCopy(result.inviteLink, 'link')}
              className="px-3 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap"
              style={{
                background:
                  copied === 'link' ? '#22c55e' : 'rgba(255,255,255,.06)',
                border:
                  copied === 'link'
                    ? '1px solid #22c55e'
                    : '1px solid rgba(255,255,255,.08)',
                color: copied === 'link' ? 'white' : '#f4f4f5',
              }}
            >
              {copied === 'link' ? 'Скопировано' : 'Скопировать ссылку'}
            </button>
          </div>
          <p className="text-xs mt-2" style={{ color: '#71717a' }}>
            Отправьте ссылку партнёру в Telegram — он установит пароль и войдёт в кабинет.
          </p>
        </div>

        <div className="flex justify-end pt-2">
          <Link
            href={`/admin/partners/${result.partner.id}`}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center"
            style={{
              background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
              color: 'white',
            }}
            onClick={onClose}
          >
            Открыть профиль партнёра →
          </Link>
        </div>
      </div>
    </ModalShell>
  );
}

// ─── small reusable bits ────────────────────────────────────────────────

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[560px] rounded-[24px] p-6 sm:p-8 max-h-[90vh] overflow-y-auto"
        style={{
          background: 'rgba(20,20,30,.95)',
          border: '1px solid rgba(255,255,255,.08)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold" style={{ color: '#f4f4f5' }}>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-white/5"
            style={{ color: '#a1a1aa' }}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function NumberRateField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label
        className="block text-xs uppercase tracking-widest mb-2"
        style={{ color: '#71717a' }}
      >
        {label}
      </label>
      <input
        type="number"
        step="0.5"
        min="0"
        max="100"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-3 rounded-xl outline-none transition-all"
        style={{
          background: 'rgba(255,255,255,.03)',
          border: '1px solid rgba(255,255,255,.08)',
          color: '#f4f4f5',
        }}
      />
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label
        className="block text-xs uppercase tracking-widest mb-2"
        style={{ color: '#71717a' }}
      >
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-3 rounded-xl outline-none transition-all"
        style={{
          background: 'rgba(255,255,255,.03)',
          border: '1px solid rgba(255,255,255,.08)',
          color: '#f4f4f5',
        }}
      />
    </div>
  );
}
