'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ordersApi, pricingApi, type AdminPackage } from '@/lib/api';
import { clearAdminSession, getAdminToken, getAdminUser } from '@/lib/auth';
import ProxyManagement from '@/components/admin/ProxyManagement';
import RazerAccountManagement from '@/components/admin/RazerAccountManagement';
import SettingsManagement from '@/components/admin/SettingsManagement';
import SecurityManagement from '@/components/admin/SecurityManagement';

interface Order {
  id: string;
  orderId: string;
  vbucksAmount: number;
  priceTRY: number;
  currency: string;
  status: string;
  createdAt: string;
  errorMessage?: string;
  timelineLogs?: Array<{
    tag: string;
    message: string;
    timestamp: string;
    level: string;
  }>;
}

interface AdminUser {
  id: string;
  username: string;
  email: string;
  role: string;
}

export default function AdminPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [packages, setPackages] = useState<AdminPackage[]>([]);
  const [exchangeRate, setExchangeRate] = useState<number>(1.63);
  const [selectedPackage, setSelectedPackage] = useState<number>(2400);
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [activeTab, setActiveTab] = useState<'orders' | 'proxies' | 'razer' | 'settings' | 'security'>('orders');
  const [testOrderLoading, setTestOrderLoading] = useState(false);
  const [testOrderResult, setTestOrderResult] = useState<{ buyerUrl: string; orderId: string; vbucksAmount: number } | null>(null);

  // Карта вид → себестоимость в RUB для подсчёта прибыли по существующим заказам
  const costByAmount = packages.reduce<Record<number, number>>((acc, p) => {
    acc[p.vbucksAmount] = p.costRUB;
    return acc;
  }, {});

  // Проверка авторизации
  useEffect(() => {
    const token = getAdminToken();
    const user = getAdminUser();

    if (!token || !user) {
      clearAdminSession();
      router.push('/admin/login');
      return;
    }

    setAdmin(user);
  }, [router]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !admin) return;

    const fetchData = async () => {
      try {
        const [ordersRes, pricingRes] = await Promise.all([
          ordersApi.list({ limit: 20 }),
          pricingApi.listAdmin(),
        ]);

        if (ordersRes.success) {
          setOrders(ordersRes.data);
        }

        if (pricingRes.success) {
          setPackages(pricingRes.data.packages);
          setExchangeRate(pricingRes.data.exchangeRate);
          // выставляем первый popular пакет по дефолту
          const popular = pricingRes.data.packages.find((p) => p.popular);
          if (popular) setSelectedPackage(popular.vbucksAmount);
        }
      } catch (error) {
        console.error('Failed to fetch data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [mounted, admin]);

  const handleLogout = () => {
    clearAdminSession();
    router.push('/admin/login');
  };

  const handleGenerateLink = async () => {
    const pkg = packages.find((p) => p.vbucksAmount === selectedPackage);
    if (!pkg) return;

    try {
      const response = await ordersApi.create({
        vbucksAmount: pkg.vbucksAmount,
        priceTRY: pkg.priceRUB,
      });

      if (response.success) {
        setGeneratedUrl(response.data.shortUrl);
      }
    } catch (error) {
      console.error('Failed to create order:', error);
    }
  };

  const handleCreateTestOrder = async () => {
    setTestOrderLoading(true);
    setTestOrderResult(null);
    try {
      const pkg = packages.find((p) => p.vbucksAmount === selectedPackage) || packages[0];
      const vbucksAmount = pkg?.vbucksAmount || 1000;
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'}/orders/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getAdminToken()}` },
        body: JSON.stringify({ vbucksAmount }),
      });
      const data = await response.json();
      if (data.success) {
        setTestOrderResult(data.data);
      }
    } catch (error) {
      console.error('Failed to create test order:', error);
    } finally {
      setTestOrderLoading(false);
    }
  };

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(generatedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenOrder = (order: Order) => {
    setSelectedOrder(order);
    setDrawerOpen(true);
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, { bg: string; color: string }> = {
      completed: { bg: 'rgba(34, 197, 94, 0.12)', color: '#22c55e' },
      failed: { bg: 'rgba(239, 68, 68, 0.12)', color: '#ef4444' },
      processing: { bg: 'rgba(139, 92, 246, 0.12)', color: '#8b5cf6' },
      pending: { bg: 'rgba(234, 179, 8, 0.12)', color: '#eab308' },
      awaiting_auth: { bg: 'rgba(234, 179, 8, 0.12)', color: '#eab308' },
      auth_completed: { bg: 'rgba(139, 92, 246, 0.12)', color: '#8b5cf6' },
    };

    const style = styles[status] || styles.pending;
    const labels: Record<string, string> = {
      completed: 'Завершён',
      failed: 'Ошибка',
      processing: 'В процессе',
      pending: 'Ожидает',
      awaiting_auth: 'Ожидает авторизации',
      auth_completed: 'Авторизован',
    };

    return (
      <span
        className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium"
        style={{ background: style.bg, color: style.color }}
      >
        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: style.color }} />
        {labels[status] || status}
      </span>
    );
  };

  const getTimeAgo = (date: string) => {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return 'только что';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} мин назад`;
    return `${Math.floor(seconds / 3600)} ч назад`;
  };

  // Подсчёт статистики для админки
  const completedOrders = orders.filter((o) => o.status === 'completed');
  const totalRevenue = completedOrders.reduce((sum, o) => sum + (o.priceTRY || 0), 0);
  const totalProfit = completedOrders.reduce((sum, o) => {
    const costRUB = costByAmount[o.vbucksAmount] ?? 0;
    return sum + ((o.priceTRY || 0) - costRUB);
  }, 0);

  if (!mounted || !admin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-14 h-14 relative">
          <div className="absolute inset-0 border-2 border-transparent border-t-accent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header
        className="sticky top-0 z-50 px-4 sm:px-9 py-4 flex justify-between items-center gap-3"
        style={{
          background: 'rgba(10, 10, 15, 0.9)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-9 h-9 flex-shrink-0 rounded-lg flex items-center justify-center font-extrabold text-base"
            style={{
              background: 'linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)',
            }}
          >
            V
          </div>
          <span className="font-bold text-base truncate" style={{ color: '#f4f4f5' }}>
            <span className="hidden sm:inline">Bag1V-Bucks </span>Admin
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <div className="text-sm font-medium" style={{ color: '#f4f4f5' }}>
              {admin.username}
            </div>
            <div className="text-xs" style={{ color: '#71717a' }}>
              {admin.role === 'super_admin' ? 'Администратор' : 'Оператор'}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-all hover:bg-red-500/10"
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              color: '#ef4444',
            }}
          >
            Выйти
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="border-b border-white/6">
        <nav className="flex gap-1 px-4 sm:px-9 max-w-[1400px] mx-auto">
          <button
            onClick={() => setActiveTab('orders')}
            className={`px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'orders' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            Заказы
          </button>
          <button
            onClick={() => setActiveTab('proxies')}
            className={`px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'proxies' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            Прокси
          </button>
          <button
            onClick={() => setActiveTab('razer')}
            className={`px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'razer' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            Razer
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'settings' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            Настройки
          </button>
          <button
            onClick={() => setActiveTab('security')}
            className={`px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'security' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            Безопасность
          </button>
          <Link
            href="/admin/applications"
            className="px-4 py-3 text-sm font-medium text-gray-400 hover:text-gray-300 transition-colors"
          >
            Заявки
          </Link>
          <Link
            href="/admin/partners"
            className="px-4 py-3 text-sm font-medium text-gray-400 hover:text-gray-300 transition-colors"
          >
            Партнёры
          </Link>
          <Link
            href="/admin/payouts"
            className="px-4 py-3 text-sm font-medium text-gray-400 hover:text-gray-300 transition-colors"
          >
            Выплаты
          </Link>
          <Link
            href="/admin/reviews"
            className="px-4 py-3 text-sm font-medium text-gray-400 hover:text-gray-300 transition-colors"
          >
            Отзывы
          </Link>
        </nav>
      </div>

      {/* Content */}
      <main className="p-4 sm:p-9 max-w-[1400px] mx-auto">
        {activeTab === 'proxies' ? (
          <ProxyManagement />
        ) : activeTab === 'razer' ? (
          <RazerAccountManagement />
        ) : activeTab === 'settings' ? (
          <SettingsManagement />
        ) : activeTab === 'security' ? (
          <SecurityManagement />
        ) : (
          <>
        {/* Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6 mb-6 sm:mb-9">
          {/* Заработок */}
          <div
            className="rounded-[24px] p-6 relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.15) 0%, rgba(34, 197, 94, 0.05) 100%)',
              border: '1px solid rgba(34, 197, 94, 0.2)',
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.526 1M12 20V4m0 0c0 1.11-.89 2-2 2s-2.08-.402-2.526-1M12 4V0" />
              </svg>
              <span className="text-sm uppercase tracking-widest" style={{ color: '#71717a' }}>
                Общий заработок
              </span>
            </div>
            <div className="font-mono text-3xl font-bold" style={{ color: '#22c55e' }}>
              {totalRevenue.toLocaleString('ru-RU')} ₽
            </div>
          </div>

          {/* Прибыль */}
          <div
            className="rounded-[24px] p-6 relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(139, 92, 246, 0.05) 100%)',
              border: '1px solid rgba(139, 92, 246, 0.2)',
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm6 0V6a2 2 0 012-2h2a2 2 0 012 2v6a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="text-sm uppercase tracking-widest" style={{ color: '#71717a' }}>
                Чистая прибыль
              </span>
            </div>
            <div className="font-mono text-3xl font-bold" style={{ color: '#8b5cf6' }}>
              {totalProfit.toLocaleString('ru-RU')} ₽
            </div>
          </div>

          {/* Заказов */}
          <div
            className="rounded-[24px] p-6 relative overflow-hidden"
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h0m-4 0h0" />
              </svg>
              <span className="text-sm uppercase tracking-widest" style={{ color: '#71717a' }}>
                Всего заказов
              </span>
            </div>
            <div className="font-mono text-3xl font-bold" style={{ color: '#f4f4f5' }}>
              {orders.length}
            </div>
          </div>

          {/* Завершённых */}
          <div
            className="rounded-[24px] p-6 relative overflow-hidden"
            style={{
              background: 'rgba(34, 197, 94, 0.05)',
              border: '1px solid rgba(34, 197, 94, 0.15)',
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-sm uppercase tracking-widest" style={{ color: '#71717a' }}>
                Завершено
              </span>
            </div>
            <div className="font-mono text-3xl font-bold" style={{ color: '#22c55e' }}>
              {completedOrders.length}
            </div>
          </div>
        </div>

        {/* Price List with Profit */}
        <div
          className="rounded-[24px] p-4 sm:p-8 mb-6 sm:mb-9"
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          <h2 className="text-base sm:text-lg font-semibold mb-4 sm:mb-6 flex items-center gap-3 flex-wrap">
            <svg className="w-5 h-5 sm:w-6 sm:h-6" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            Прайс-лист и прибыль
            <span className="sm:ml-auto text-xs font-normal" style={{ color: '#71717a' }}>
              Курс: 1 TRY = {exchangeRate.toFixed(2)} ₽
            </span>
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <th className="text-left py-4 px-4 text-xs uppercase tracking-widest font-medium" style={{ color: '#71717a' }}>V-Bucks</th>
                  <th className="text-left py-4 px-4 text-xs uppercase tracking-widest font-medium" style={{ color: '#71717a' }}>Цена продажи</th>
                  <th className="text-left py-4 px-4 text-xs uppercase tracking-widest font-medium" style={{ color: '#71717a' }}>Себестоимость</th>
                  <th className="text-left py-4 px-4 text-xs uppercase tracking-widest font-medium" style={{ color: '#71717a' }}>Прибыль</th>
                  <th className="text-left py-4 px-4 text-xs uppercase tracking-widest font-medium" style={{ color: '#71717a' }}>Маржа</th>
                </tr>
              </thead>
              <tbody>
                {packages.map((pkg) => (
                  <tr key={pkg.vbucksAmount} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                    <td className="py-4 px-4 font-medium">{pkg.vbucksAmount.toLocaleString('ru-RU')} V-Bucks</td>
                    <td className="py-4 px-4 font-mono font-bold" style={{ color: '#f4f4f5' }}>{pkg.priceRUB.toLocaleString('ru-RU')} ₽</td>
                    <td className="py-4 px-4 font-mono" style={{ color: '#71717a' }}>{pkg.costRUB.toLocaleString('ru-RU')} ₽</td>
                    <td
                      className="py-4 px-4 font-mono font-bold"
                      style={{ color: pkg.profitRUB >= 0 ? '#22c55e' : '#ef4444' }}
                    >
                      {pkg.profitRUB >= 0 ? '+' : ''}{pkg.profitRUB.toLocaleString('ru-RU')} ₽
                    </td>
                    <td className="py-4 px-4">
                      <span
                        className="px-3 py-1 rounded-full text-xs font-medium"
                        style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e' }}
                      >
                        {pkg.marginPercent}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Generator Section */}
        <div
          className="rounded-[24px] p-4 sm:p-8 mb-6 sm:mb-9"
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          <h2 className="text-lg font-semibold mb-7 flex items-center gap-3">
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4.828 4.828a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4.002 4.002 0 015.656 0l1.101-1.101M8 4a4 4 0 118 0" />
            </svg>
            Генератор ссылок
          </h2>
          <div className="flex gap-5 flex-wrap items-end">
            <div className="flex-1 min-w-[240px]">
              <label className="block text-xs uppercase tracking-widest mb-3" style={{ color: '#71717a' }}>
                Выберите пакет V-Bucks
              </label>
              <select
                value={selectedPackage}
                onChange={(e) => setSelectedPackage(Number(e.target.value))}
                className="w-full px-5 py-4 rounded-xl appearance-none cursor-pointer"
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  color: '#f4f4f5',
                }}
              >
                {packages.map((pkg) => (
                  <option key={pkg.vbucksAmount} value={pkg.vbucksAmount} style={{ background: '#1a1a2e', color: '#f4f4f5' }}>
                    {pkg.vbucksAmount.toLocaleString('ru-RU')} V-Bucks — {pkg.priceRUB.toLocaleString('ru-RU')} ₽
                    {' '}(+{pkg.profitRUB.toLocaleString('ru-RU')} ₽)
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={handleGenerateLink}
              className="px-7 py-4 rounded-xl font-semibold transition-all"
              style={{
                background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                color: 'white',
              }}
            >
              Сгенерировать
            </button>
          </div>

          {generatedUrl && (
            <div
              className="mt-6 flex gap-3.5 items-center p-4.5 rounded-xl"
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
              }}
            >
              <span className="flex-1 font-mono text-sm truncate" style={{ color: '#a1a1aa' }}>
                {generatedUrl}
              </span>
              <button
                onClick={handleCopyUrl}
                className="px-4.5 py-2.5 rounded-lg text-sm font-medium"
                style={{
                  background: copied ? '#22c55e' : 'rgba(255, 255, 255, 0.06)',
                  border: copied ? '1px solid #22c55e' : '1px solid rgba(255, 255, 255, 0.06)',
                  color: copied ? 'white' : '#f4f4f5',
                }}
              >
                {copied ? 'Скопировано!' : 'Копировать'}
              </button>
            </div>
          )}
        </div>

        {/* Test Order Section */}
        <div
          className="rounded-[24px] p-4 sm:p-8 mb-6 sm:mb-9"
          style={{
            background: 'rgba(234, 179, 8, 0.04)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(234, 179, 8, 0.15)',
          }}
        >
          <h2 className="text-lg font-semibold mb-2 flex items-center gap-3">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <span style={{ color: '#eab308' }}>Тестовый заказ</span>
            <span className="text-xs font-normal px-2 py-0.5 rounded-full" style={{ background: 'rgba(234,179,8,.15)', color: '#eab308' }}>
              без оплаты
            </span>
          </h2>
          <p className="text-sm mb-5" style={{ color: '#a1a1aa' }}>
            Создаёт заказ с пропущенной оплатой — сразу доступна авторизация Epic Games. Используй для проверки автовыдачи.
          </p>
          <div className="flex gap-4 flex-wrap items-center">
            <select
              value={selectedPackage}
              onChange={(e) => setSelectedPackage(Number(e.target.value))}
              className="px-4 py-3 rounded-xl appearance-none cursor-pointer text-sm"
              style={{
                background: 'rgba(255,255,255,.03)',
                border: '1px solid rgba(255,255,255,.08)',
                color: '#f4f4f5',
              }}
            >
              {packages.map((pkg) => (
                <option key={pkg.vbucksAmount} value={pkg.vbucksAmount} style={{ background: '#1a1a2e', color: '#f4f4f5' }}>
                  {pkg.vbucksAmount.toLocaleString('ru-RU')} V-Bucks
                </option>
              ))}
            </select>
            <button
              onClick={handleCreateTestOrder}
              disabled={testOrderLoading}
              className="px-6 py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-50"
              style={{ background: 'rgba(234,179,8,.2)', border: '1px solid rgba(234,179,8,.4)', color: '#eab308' }}
            >
              {testOrderLoading ? (
                'Создаём...'
              ) : (
                <span className="inline-flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M13 2L3 14h7l-1 8 11-14h-7l1-6z" />
                  </svg>
                  Создать тестовый заказ
                </span>
              )}
            </button>
          </div>

          {testOrderResult && (
            <div
              className="mt-5 p-4 rounded-xl"
              style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)' }}
            >
              <div className="text-xs uppercase tracking-widest mb-2" style={{ color: '#71717a' }}>
                Тестовый заказ создан — {testOrderResult.vbucksAmount.toLocaleString('ru-RU')} V-Bucks
              </div>
              <div className="flex gap-3 items-center">
                <span className="flex-1 font-mono text-sm truncate" style={{ color: '#a1a1aa' }}>
                  {testOrderResult.buyerUrl}
                </span>
                <button
                  onClick={() => { navigator.clipboard.writeText(testOrderResult.buyerUrl); }}
                  className="px-3 py-2 rounded-lg text-xs font-medium"
                  style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.08)', color: '#f4f4f5' }}
                >
                  Копировать
                </button>
                <a
                  href={testOrderResult.buyerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-2 rounded-lg text-xs font-medium"
                  style={{ background: 'rgba(139,92,246,.2)', border: '1px solid rgba(139,92,246,.3)', color: '#a78bfa' }}
                >
                  Открыть →
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Orders Table */}
        <div
          className="rounded-[24px] overflow-hidden"
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          <div className="px-4 sm:px-8 py-5 sm:py-7 flex justify-between items-center" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <h2 className="text-base sm:text-lg font-semibold flex items-center gap-3">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Последние заказы
            </h2>
            <span className="text-sm" style={{ color: '#71717a' }}>
              {orders.length} заказов
            </span>
          </div>

          {loading ? (
            <div className="p-8 text-center" style={{ color: '#71717a' }}>
              Загрузка...
            </div>
          ) : orders.length === 0 ? (
            <div className="p-8 text-center" style={{ color: '#71717a' }}>
              Заказов пока нет. Создайте первый заказ!
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[680px]">
              <thead>
                <tr style={{ background: 'rgba(255, 255, 255, 0.02)' }}>
                  {['Статус', 'ID', 'Пакет', 'Цена', 'Прибыль', 'Время'].map((header) => (
                    <th key={header} className="px-4 sm:px-8 py-4 sm:py-5 text-left text-xs uppercase tracking-widest font-medium" style={{ color: '#71717a' }}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const costRUB = costByAmount[order.vbucksAmount] ?? 0;
                  const profit = (order.priceTRY || 0) - costRUB;

                  return (
                    <tr
                      key={order.id}
                      onClick={() => handleOpenOrder(order)}
                      className="cursor-pointer transition-all hover:bg-white/5"
                      style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}
                    >
                      <td className="px-8 py-5">{getStatusBadge(order.status)}</td>
                      <td className="px-8 py-5">
                        <span className="font-mono text-sm" style={{ color: '#71717a' }}>#{order.orderId}</span>
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex items-center gap-3">
                          <span
                            className="w-7.5 h-7.5 rounded-lg flex items-center justify-center text-xs font-bold"
                            style={{ background: 'rgba(139, 92, 246, 0.12)', color: '#8b5cf6' }}
                          >
                            V
                          </span>
                          {order.vbucksAmount.toLocaleString()}
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <span className="font-mono font-medium">{order.priceTRY?.toLocaleString()} ₽</span>
                      </td>
                      <td className="px-8 py-5">
                        <span className="font-mono font-medium" style={{ color: profit >= 0 ? '#22c55e' : '#ef4444' }}>
                          {profit >= 0 ? '+' : ''}{profit.toLocaleString()} ₽
                        </span>
                      </td>
                      <td className="px-8 py-5">
                        <span className="font-mono text-sm" style={{ color: '#71717a' }}>
                          {getTimeAgo(order.createdAt)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </div>
        </>
        )}
      </main>

      {/* Drawer Overlay */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-[100]"
          style={{ background: 'rgba(0, 0, 0, 0.7)', backdropFilter: 'blur(10px)' }}
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Drawer */}
      <div
        className="fixed top-0 right-0 h-full w-full max-w-[560px] z-[101] flex flex-col"
        style={{
          background: '#0a0a0f',
          borderLeft: '1px solid rgba(255, 255, 255, 0.06)',
          transform: drawerOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s ease',
        }}
      >
        <div
          className="px-5 sm:px-8 py-5 sm:py-7 flex justify-between items-center"
          style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}
        >
          <h3 className="text-sm sm:text-base font-semibold truncate">Детали заказа #{selectedOrder?.orderId}</h3>
          <button
            onClick={() => setDrawerOpen(false)}
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              color: '#a1a1aa',
            }}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 sm:p-8">
          {/* Order Info */}
          <div className="mb-8">
            <h4 className="text-xs uppercase tracking-widest mb-4" style={{ color: '#71717a' }}>
              Информация
            </h4>
            <div className="space-y-3">
              <div className="flex justify-between p-3 rounded-lg" style={{ background: 'rgba(255, 255, 255, 0.02)' }}>
                <span style={{ color: '#71717a' }}>Статус</span>
                <span>{getStatusBadge(selectedOrder?.status || '')}</span>
              </div>
              <div className="flex justify-between p-3 rounded-lg" style={{ background: 'rgba(255, 255, 255, 0.02)' }}>
                <span style={{ color: '#71717a' }}>V-Bucks</span>
                <span className="font-mono">{selectedOrder?.vbucksAmount?.toLocaleString()}</span>
              </div>
              <div className="flex justify-between p-3 rounded-lg" style={{ background: 'rgba(255, 255, 255, 0.02)' }}>
                <span style={{ color: '#71717a' }}>Цена</span>
                <span className="font-mono">{selectedOrder?.priceTRY?.toLocaleString()} ₽</span>
              </div>
            </div>
          </div>

          {/* Timeline Logs */}
          {selectedOrder?.timelineLogs && selectedOrder.timelineLogs.length > 0 && (
            <div className="mb-8">
              <h4 className="text-xs uppercase tracking-widest mb-4" style={{ color: '#71717a' }}>
                Timeline
              </h4>
              <div className="space-y-2">
                {selectedOrder.timelineLogs.map((log, index) => (
                  <div
                    key={index}
                    className="p-3 rounded-lg text-sm"
                    style={{ background: 'rgba(255, 255, 255, 0.02)' }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="text-xs font-mono px-2 py-0.5 rounded"
                        style={{
                          background: log.tag.includes('[error]') ? 'rgba(239, 68, 68, 0.2)' : 'rgba(139, 92, 246, 0.2)',
                          color: log.tag.includes('[error]') ? '#ef4444' : '#8b5cf6',
                        }}
                      >
                        {log.tag}
                      </span>
                      <span className="text-xs" style={{ color: '#71717a' }}>
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <span style={{ color: '#a1a1aa' }}>{log.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Error Message */}
          {selectedOrder?.errorMessage && (
            <div className="mb-8">
              <h4 className="text-xs uppercase tracking-widest mb-4" style={{ color: '#71717a' }}>
                Ошибка
              </h4>
              <div
                className="p-4 rounded-xl text-sm"
                style={{
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#ef4444',
                }}
              >
                {selectedOrder.errorMessage}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
