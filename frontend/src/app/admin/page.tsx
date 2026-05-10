'use client';

import { useEffect, useState, useRef } from 'react';
import { ordersApi } from '@/lib/api';

interface Order {
  id: string;
  orderId: string;
  vbucksAmount: number;
  priceTRY: number;
  currency: string;
  status: string;
  createdAt: string;
  errorMessage?: string;
}

const V_BUCKS_PACKAGES = [
  { value: '1000', label: '1,000 V-Bucks', price: 129 },
  { value: '2800', label: '2,800 V-Bucks', price: 299 },
  { value: '5000', label: '5,000 V-Bucks', price: 499 },
  { value: '13500', label: '13,500 V-Bucks', price: 1299 },
];

export default function AdminPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedPackage, setSelectedPackage] = useState('2800');
  const [generatedUrl, setGeneratedUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    
    const fetchOrders = async () => {
      try {
        const response = await ordersApi.list({ limit: 20 });
        if (response.success) {
          setOrders(response.data);
        }
      } catch (error) {
        console.error('Failed to fetch orders:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
  }, [mounted]);

  const handleGenerateLink = async () => {
    const pkg = V_BUCKS_PACKAGES.find(p => p.value === selectedPackage);
    if (!pkg) return;

    try {
      const response = await ordersApi.create({
        vbucksAmount: parseInt(selectedPackage),
        priceTRY: pkg.price,
      });

      if (response.success) {
        setGeneratedUrl(response.data.shortUrl);
      }
    } catch (error) {
      console.error('Failed to create order:', error);
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
    };

    const style = styles[status] || styles.pending;
    const labels: Record<string, string> = {
      completed: 'Завершён',
      failed: 'Ошибка',
      processing: 'В процессе',
      pending: 'Ожидает',
    };

    return (
      <span
        className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium"
        style={{ background: style.bg, color: style.color }}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: style.color }} />
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

  // Показываем загрузку пока не mounted
  if (!mounted) {
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
        className="sticky top-0 z-50 px-9 py-4 flex justify-between items-center"
        style={{
          background: 'rgba(10, 10, 15, 0.9)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center font-extrabold text-base"
            style={{
              background: 'linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)',
            }}
          >
            V
          </div>
          <span className="font-bold text-base" style={{ color: '#f4f4f5' }}>
            Bag1V-Bucks Admin
          </span>
        </div>
      </header>

      {/* Content */}
      <main className="p-9 max-w-[1400px] mx-auto">
        {/* Balance Cards */}
        <div className="grid gap-6 mb-9" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
          {[
            { label: 'Razer Gold (TRY)', value: '124,850', symbol: '₺', color: '#22c55e' },
            { label: 'Razer Gold (USD)', value: '892', symbol: '$', color: '#22c55e' },
            { label: 'PayPal Balance', value: '2,340', symbol: '$', color: '#8b5cf6' },
          ].map((card, i) => (
            <div
              key={card.label}
              className="rounded-[24px] p-8 relative overflow-hidden"
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
              }}
            >
              <div className="flex items-center gap-2.5 mb-3.5">
                <span className="text-lg">💰</span>
                <span className="text-xs uppercase tracking-widest" style={{ color: '#71717a' }}>
                  {card.label}
                </span>
              </div>
              <div className="font-mono text-4xl font-semibold" style={{ color: card.color }}>
                {card.value} <small style={{ opacity: 0.5 }}>{card.symbol}</small>
              </div>
            </div>
          ))}
        </div>

        {/* Generator Section */}
        <div
          className="rounded-[24px] p-8 mb-9"
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          <h2 className="text-lg font-semibold mb-7">Генератор ссылок</h2>
          <div className="flex gap-5 flex-wrap items-end">
            <div className="flex-1 min-w-[240px]">
              <label className="block text-xs uppercase tracking-widest mb-3" style={{ color: '#71717a' }}>
                Выберите пакет V-Bucks
              </label>
              <select
                value={selectedPackage}
                onChange={(e) => setSelectedPackage(e.target.value)}
                className="w-full px-5 py-4 rounded-xl appearance-none cursor-pointer"
                style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  color: '#f4f4f5',
                }}
              >
                {V_BUCKS_PACKAGES.map((pkg) => (
                  <option key={pkg.value} value={pkg.value}>
                    {pkg.label} — {pkg.price} ₺
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

        {/* Orders Table */}
        <div
          className="rounded-[24px] overflow-hidden"
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          <div className="px-8 py-7 flex justify-between items-center" style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <h2 className="text-lg font-semibold">Последние заказы</h2>
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
            <table className="w-full">
              <thead>
                <tr style={{ background: 'rgba(255, 255, 255, 0.02)' }}>
                  {['Статус', 'ID', 'Пакет', 'Цена', 'Время'].map((header) => (
                    <th key={header} className="px-8 py-5 text-left text-xs uppercase tracking-widest font-medium" style={{ color: '#71717a' }}>
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    onClick={() => handleOpenOrder(order)}
                    className="cursor-pointer transition-all"
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
                        {order.vbucksAmount.toLocaleString()} V-Bucks
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <span className="font-mono font-medium">{order.priceTRY} ₺</span>
                    </td>
                    <td className="px-8 py-5">
                      <span className="font-mono text-sm" style={{ color: '#71717a' }}>
                        {getTimeAgo(order.createdAt)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
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
          className="px-8 py-7 flex justify-between items-center"
          style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.06)' }}
        >
          <h3 className="text-base font-semibold">Детали заказа #{selectedOrder?.orderId}</h3>
          <button
            onClick={() => setDrawerOpen(false)}
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              color: '#a1a1aa',
            }}
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          <div className="mb-8">
            <h4 className="text-xs uppercase tracking-widest mb-4" style={{ color: '#71717a' }}>
              Webhook Response
            </h4>
            <pre
              className="p-5.5 rounded-xl font-mono text-xs overflow-x-auto whitespace-pre"
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                color: '#a1a1aa',
              }}
            >
              {JSON.stringify({
                status: selectedOrder?.status,
                order_id: selectedOrder?.orderId,
                amount: selectedOrder?.priceTRY,
                currency: selectedOrder?.currency,
                vbucks_delivered: selectedOrder?.vbucksAmount,
              }, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
