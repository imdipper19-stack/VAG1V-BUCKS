'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import api from '@/lib/api';

/** Стилизованная иконка cookie (line-style, наследует currentColor). */
function CookieIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ verticalAlign: '-2px', display: 'inline-block' }}
    >
      <path d="M21 12a9 9 0 1 1-9-9 5 5 0 0 0 5 5 5 5 0 0 0 5 5z" />
      <circle cx="9" cy="10" r="0.6" fill="currentColor" />
      <circle cx="14" cy="14" r="0.6" fill="currentColor" />
      <circle cx="9" cy="16" r="0.6" fill="currentColor" />
    </svg>
  );
}

interface RazerAccount {
  id: string;
  username: string;
  email?: string;
  balanceVbucks: number;
  balanceTRY: number;
  status: 'active' | 'inactive' | 'low_balance' | 'cooldown' | 'banned';
  trustLevel?: string;
  ordersProcessed: number;
  ordersSuccessful: number;
  ordersFailed: number;
  consecutiveSuccesses?: number;
  captchaCount?: number;
  minBalanceThreshold: number;
  lastUsedAt: number;
  cooldownUntil?: number;
  sessionCookies?: string;
  createdAt: string;
}

interface AccountStats {
  total: number;
  active: number;
  lowBalance: number;
  cooldown: number;
  totalBalanceTRY: number;
  successRate: number;
  trustedCount: number;
}

export default function RazerAccountManagement() {
  const [accounts, setAccounts] = useState<RazerAccount[]>([]);
  const [stats, setStats] = useState<AccountStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [cookieFormId, setCookieFormId] = useState<string | null>(null);
  const [cookieInput, setCookieInput] = useState('');
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [balanceInputs, setBalanceInputs] = useState<Record<string, string>>({});
  const [newAccount, setNewAccount] = useState({
    username: '',
    password: '',
    email: '',
    totpSecret: '',
    minBalanceThreshold: '1000',
  });

  const showMsg = (msg: string, isError = false) => {
    if (isError) { setError(msg); setTimeout(() => setError(''), 4000); }
    else { setSuccess(msg); setTimeout(() => setSuccess(''), 4000); }
  };

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await api.get('/razer-accounts');
      if (res.data.success) setAccounts(res.data.data);
    } catch (e) {
      console.error('Failed to fetch accounts:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get('/razer-accounts/stats');
      if (res.data.success) setStats(res.data.data);
    } catch (e) {
      console.error('Failed to fetch stats:', e);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
    fetchStats();

    // Авто-полл каждые 30 секунд: подтягивает свежие балансы из БД
    // (бэкенд их обновляет cron'ом каждые 30 минут + после createAccount/saveCookies/orderSuccess).
    // Без этого страница показывает данные на момент открытия.
    const interval = setInterval(() => {
      fetchAccounts();
      fetchStats();
    }, 30_000);

    // Также рефрешим когда вкладка возвращается в фокус — типичный кейс:
    // юзер вернулся в админку через час после Razer-обновлений.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchAccounts();
        fetchStats();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchAccounts, fetchStats]);

  const handleAddAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccount.email || !newAccount.password) {
      showMsg('Email и пароль обязательны', true);
      return;
    }
    try {
      const res = await api.post('/razer-accounts', {
        username: newAccount.username || newAccount.email,
        password: newAccount.password,
        email: newAccount.email,
        totpSecret: newAccount.totpSecret || undefined,
        minBalanceThreshold: parseInt(newAccount.minBalanceThreshold) || 1000,
      });
      if (res.data.success) {
        // Если переданы куки — сохраняем их сразу
        if (cookieInput.trim()) {
          try { JSON.parse(cookieInput); } catch {
            showMsg('Аккаунт добавлен, но куки в неверном формате', true);
            setShowAddForm(false);
            setNewAccount({ username: '', password: '', email: '', totpSecret: '', minBalanceThreshold: '1000' });
            setCookieInput('');
            fetchAccounts();
            fetchStats();
            return;
          }
          await api.put(`/razer-accounts/${res.data.data.id}/cookies`, { cookies: cookieInput });
        }
        showMsg('Аккаунт добавлен');
        setShowAddForm(false);
        setNewAccount({ username: '', password: '', email: '', totpSecret: '', minBalanceThreshold: '1000' });
        setCookieInput('');
        fetchAccounts();
        fetchStats();
      }
    } catch (e: any) {
      showMsg(e?.response?.data?.message || 'Ошибка добавления аккаунта', true);
    }
  };

  const handleSaveCookies = async (id: string) => {
    if (!cookieInput.trim()) { showMsg('Вставьте куки', true); return; }
    try { JSON.parse(cookieInput); } catch {
      showMsg('Неверный формат — нужен JSON массив из браузерного расширения', true);
      return;
    }
    try {
      const res = await api.put(`/razer-accounts/${id}/cookies`, { cookies: cookieInput });
      if (res.data.success) {
        showMsg('Куки сохранены');
        setCookieFormId(null);
        setCookieInput('');
        fetchAccounts();
      }
    } catch { showMsg('Ошибка сохранения кук', true); }
  };

  const handleValidateCookies = async (id: string) => {
    setValidatingId(id);
    try {
      const res = await api.post(`/razer-accounts/${id}/validate-cookies`);
      const result = res.data.data;
      if (result.valid) {
        const balanceStr = result.balance !== undefined
          ? ` · Баланс: ${result.balance.toLocaleString()} ${result.currency || 'Gold'}`
          : '';
        showMsg(`✓ Куки валидны${result.username ? ` · ${result.username}` : ''}${balanceStr}`);
        fetchAccounts(); // обновляем список чтобы показать новый баланс
      } else {
        showMsg(`✗ Куки недействительны: ${result.error}`, true);
      }
    } catch (e: any) {
      showMsg('Ошибка проверки кук', true);
    } finally {
      setValidatingId(null);
    }
  };

  const handleUpdateBalance = async (id: string) => {
    const val = balanceInputs[id];
    if (!val || isNaN(Number(val))) { showMsg('Введите корректный баланс', true); return; }
    try {
      // Обновляем balanceTRY через PUT /razer-accounts/:id
      await api.put(`/razer-accounts/${id}`, { balanceTRY: parseFloat(val) });
      showMsg('Баланс TRY обновлён');
      setBalanceInputs(prev => ({ ...prev, [id]: '' }));
      fetchAccounts();
      fetchStats();
    } catch { showMsg('Ошибка обновления баланса', true); }
  };

  const handleDeleteAccount = async (id: string) => {
    if (!confirm('Удалить аккаунт?')) return;
    try {
      await api.delete(`/razer-accounts/${id}`);
      showMsg('Аккаунт удалён');
      fetchAccounts();
      fetchStats();
    } catch { showMsg('Ошибка удаления', true); }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return '#22c55e';
      case 'low_balance': return '#f59e0b';
      case 'cooldown': return '#8b5cf6';
      case 'banned': return '#ef4444';
      default: return '#a1a1aa';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active': return 'Активен';
      case 'inactive': return 'Неактивен';
      case 'low_balance': return 'Малый баланс';
      case 'cooldown': return 'Cooldown';
      case 'banned': return 'Заблокирован';
      default: return status;
    }
  };

  const getTrustLabel = (trust?: string) => {
    switch (trust) {
      case 'trusted': return 'Trusted';
      case 'ready':   return 'Ready';
      case 'warming': return 'Warming';
      case 'new':     return 'New';
      default:        return '';
    }
  };

  if (loading) return <div className="text-center py-8 text-gray-400">Загрузка...</div>;

  return (
    <div className="space-y-6">
      {error && <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)', color: '#ef4444' }}>{error}</div>}
      {success && <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.3)', color: '#22c55e' }}>{success}</div>}

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="glass rounded-xl p-4"><div className="text-sm text-gray-500">Всего</div><div className="text-2xl font-bold">{stats.total}</div></div>
          <div className="glass rounded-xl p-4"><div className="text-sm" style={{ color: '#22c55e' }}>Активных</div><div className="text-2xl font-bold">{stats.active}</div></div>
          <div className="glass rounded-xl p-4"><div className="text-sm" style={{ color: '#f59e0b' }}>Малый баланс</div><div className="text-2xl font-bold">{stats.lowBalance}</div></div>
          <div className="glass rounded-xl p-4"><div className="text-sm text-gray-500">Баланс TRY</div><div className="text-2xl font-bold">{(stats.totalBalanceTRY ?? 0).toLocaleString()} ₺</div></div>
        </div>
      )}

      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">Razer Аккаунты</h2>
        <Button onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? 'Отмена' : '+ Добавить аккаунт'}
        </Button>
      </div>

      {showAddForm && (
        <div className="glass rounded-xl p-6">
          <h3 className="font-semibold mb-4">Новый Razer-аккаунт</h3>

          <form onSubmit={handleAddAccount} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm mb-2">Email <span className="text-red-400">*</span></label>
                <input
                  type="email"
                  value={newAccount.email}
                  onChange={(e) => setNewAccount({ ...newAccount, email: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-purple-500"
                  placeholder="email@razer.com"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">Email от Razer ID — нужен для автологина на checkout</p>
              </div>
              <div>
                <label className="block text-sm mb-2">Пароль <span className="text-red-400">*</span></label>
                <input
                  type="password"
                  value={newAccount.password}
                  onChange={(e) => setNewAccount({ ...newAccount, password: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-purple-500"
                  placeholder="••••••••"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">Используется ботом для входа в Razer</p>
              </div>
              <div>
                <label className="block text-sm mb-2">Имя для отображения</label>
                <input
                  type="text"
                  value={newAccount.username}
                  onChange={(e) => setNewAccount({ ...newAccount, username: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-purple-500"
                  placeholder="Razer #1 (опционально)"
                />
              </div>
              <div>
                <label className="block text-sm mb-2">Мин. баланс TRY для алертов</label>
                <input
                  type="number"
                  value={newAccount.minBalanceThreshold}
                  onChange={(e) => setNewAccount({ ...newAccount, minBalanceThreshold: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-purple-500"
                  placeholder="1000"
                  min="0"
                />
              </div>
            </div>

            {/* TOTP Secret для 2FA */}
            <div className="rounded-lg border border-amber-500/30 p-4" style={{ background: 'rgba(245,158,11,.05)' }}>
              <label className="block text-sm font-medium mb-2 inline-flex items-center gap-1.5" style={{ color: '#f59e0b' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                TOTP Secret (если включена 2FA на Razer)
              </label>
              <input
                type="text"
                value={newAccount.totpSecret}
                onChange={(e) => setNewAccount({ ...newAccount, totpSecret: e.target.value })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 font-mono text-sm focus:outline-none focus:border-amber-500"
                placeholder="JBSWY3DPEHPK3PXP (16-32 символа)"
              />
              <p className="text-xs text-gray-500 mt-2">
                Если на Razer-аккаунте включена 2FA, добавь TOTP secret чтобы бот мог сам генерировать коды.
                Получить можно в Razer ID → Security → 2FA → "Show secret key" / "Can't scan QR?".
                Без TOTP бот не сможет логиниться когда куки протухнут.
              </p>
            </div>

            {/* Куки опционально — для ускорения первого входа */}
            <details className="rounded-lg border border-white/10 p-3" style={{ background: 'rgba(255,255,255,.02)' }}>
              <summary className="cursor-pointer text-sm text-gray-400 hover:text-white inline-flex items-center gap-1.5">
                <CookieIcon /> Добавить куки сессии (опционально, ускоряет первый вход)
              </summary>
              <div className="mt-3 space-y-2">
                <p className="text-xs text-gray-500">
                  Войди в <a href="https://gold.razer.com" target="_blank" rel="noreferrer" className="text-purple-400 underline">gold.razer.com</a>,
                  экспортируй куки через расширение <b>EditThisCookie V3</b> или <b>Cookie-Editor</b> и вставь сюда.
                  Если оставить пустым — бот будет логиниться по email/паролю каждый раз.
                </p>
                <textarea
                  value={cookieInput}
                  onChange={(e) => setCookieInput(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-purple-500 resize-none"
                  rows={5}
                  placeholder='[{"name":"session","value":"...","domain":".razer.com",...}]'
                />
              </div>
            </details>

            <Button type="submit">Добавить аккаунт</Button>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {accounts.length === 0 ? (
          <div className="text-center py-8 text-gray-500">Нет аккаунтов. Добавьте первый.</div>
        ) : (
          accounts.map((account) => (
            <div key={account.id} className="glass rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getStatusColor(account.status) }} />
                  <div>
                    <div className="font-semibold">{account.username}</div>
                    <div className="text-sm text-gray-500">{account.email || 'Без email'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {account.sessionCookies && (
                    <span className="text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1" style={{ background: 'rgba(34,197,94,.15)', color: '#22c55e' }}><CookieIcon size={11} /> куки</span>
                  )}
                  {account.trustLevel && (
                    <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(139,92,246,.15)', color: '#a78bfa' }}>{getTrustLabel(account.trustLevel)}</span>
                  )}
                  <span className="text-xs px-3 py-1 rounded-full" style={{ background: `${getStatusColor(account.status)}20`, color: getStatusColor(account.status) }}>
                    {getStatusLabel(account.status)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,.02)' }}><div className="text-xs text-gray-500 mb-1">Баланс TRY</div><div className="font-semibold text-sm">{(account.balanceTRY ?? 0).toLocaleString()} ₺</div></div>
                <div className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,.02)' }}><div className="text-xs text-gray-500 mb-1">Заказы</div><div className="font-semibold text-sm">{account.ordersProcessed ?? 0}</div></div>
                <div className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,.02)' }}><div className="text-xs text-gray-500 mb-1">Успешных</div><div className="font-semibold text-sm" style={{ color: '#22c55e' }}>{account.ordersSuccessful ?? 0}</div></div>
                <div className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,.02)' }}><div className="text-xs text-gray-500 mb-1">Ошибок</div><div className="font-semibold text-sm" style={{ color: '#ef4444' }}>{account.ordersFailed ?? 0}</div></div>
              </div>

              {cookieFormId === account.id && (
                <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(139,92,246,.06)', border: '1px solid rgba(139,92,246,.2)' }}>
                  <div className="text-sm font-medium inline-flex items-center gap-1.5" style={{ color: '#a78bfa' }}><CookieIcon /> Вставьте куки из браузера</div>
                  <p className="text-xs text-gray-500">
                    Войдите в <a href="https://gold.razer.com" target="_blank" rel="noreferrer" className="underline">gold.razer.com</a> вручную,
                    затем экспортируйте куки через расширение <b>Cookie-Editor</b> (Export → JSON) и вставьте сюда.
                  </p>
                  <textarea
                    value={cookieInput}
                    onChange={(e) => setCookieInput(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-purple-500 resize-none"
                    rows={5}
                    placeholder='[{"name":"session","value":"...","domain":".razer.com",...}]'
                  />
                  <div className="flex gap-2 flex-wrap">
                    <Button onClick={() => handleSaveCookies(account.id)} className="text-sm px-4 py-2">Сохранить куки</Button>
                    {account.sessionCookies && (
                      <Button onClick={() => handleValidateCookies(account.id)} className="text-sm px-4 py-2" disabled={validatingId === account.id}>
                        {validatingId === account.id ? 'Проверяем...' : 'Проверить куки'}
                      </Button>
                    )}
                    <button onClick={() => { setCookieFormId(null); setCookieInput(''); }} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white">Отмена</button>
                  </div>
                </div>
              )}

              <div className="flex gap-2 items-center flex-wrap">
                <input
                  type="number"
                  placeholder="Баланс в TRY (лиры)"
                  value={balanceInputs[account.id] || ''}
                  onChange={(e) => setBalanceInputs(prev => ({ ...prev, [account.id]: e.target.value }))}
                  className="flex-1 min-w-[140px] bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                />
                <Button className="text-sm px-3 py-2" onClick={() => handleUpdateBalance(account.id)}>Обновить баланс ₺</Button>
                <button
                  onClick={() => { setCookieFormId(cookieFormId === account.id ? null : account.id); setCookieInput(''); }}
                  className="px-3 py-2 rounded-lg text-sm font-medium transition-all"
                  style={{ background: 'rgba(139,92,246,.15)', border: '1px solid rgba(139,92,246,.3)', color: '#a78bfa' }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <CookieIcon /> {account.sessionCookies ? 'Обновить куки' : 'Добавить куки'}
                  </span>
                </button>
                {account.sessionCookies && cookieFormId !== account.id && (
                  <button
                    onClick={() => handleValidateCookies(account.id)}
                    disabled={validatingId === account.id}
                    className="px-3 py-2 rounded-lg text-sm font-medium transition-all"
                    style={{ background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.25)', color: '#22c55e' }}
                  >
                    {validatingId === account.id ? 'Проверяем...' : 'Проверить куки'}
                  </button>
                )}
                <button
                  onClick={() => handleDeleteAccount(account.id)}
                  className="px-3 py-2 rounded-lg text-sm font-medium"
                  style={{ background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.3)', color: '#ef4444' }}
                >
                  Удалить
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
