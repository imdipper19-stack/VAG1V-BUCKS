'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import api from '@/lib/api';

interface Proxy {
  id: string;
  host: string;
  port: number;
  username?: string;
  type: 'HTTP' | 'HTTPS' | 'SOCKS5';
  status: 'active' | 'inactive' | 'failed';
  successCount: number;
  failureCount: number;
  latency?: number;
  isDefault: boolean;
  createdAt: string;
}

interface ProxyStats {
  total: number;
  active: number;
  inactive: number;
  failed: number;
  avgLatency: number;
}

export default function ProxyManagement() {
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [stats, setStats] = useState<ProxyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [newProxy, setNewProxy] = useState({
    host: '',
    port: '',
    username: '',
    password: '',
    type: 'HTTP' as 'HTTP' | 'HTTPS' | 'SOCKS5',
  });

  const showMsg = (msg: string, isError = false) => {
    if (isError) { setError(msg); setTimeout(() => setError(''), 3000); }
    else { setSuccess(msg); setTimeout(() => setSuccess(''), 3000); }
  };

  const fetchProxies = useCallback(async () => {
    try {
      const res = await api.get('/proxies');
      if (res.data.success) setProxies(res.data.data);
    } catch (e) {
      console.error('Failed to fetch proxies:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get('/proxies/stats');
      if (res.data.success) setStats(res.data.data);
    } catch (e) {
      console.error('Failed to fetch proxy stats:', e);
    }
  }, []);

  useEffect(() => {
    fetchProxies();
    fetchStats();
  }, [fetchProxies, fetchStats]);

  const handleAddProxy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProxy.host || !newProxy.port) {
      showMsg('Хост и порт обязательны', true);
      return;
    }
    try {
      const res = await api.post('/proxies', {
        host: newProxy.host,
        port: parseInt(newProxy.port),
        username: newProxy.username || undefined,
        password: newProxy.password || undefined,
        type: newProxy.type,
      });
      if (res.data.success) {
        showMsg('Прокси добавлен');
        setShowAddForm(false);
        setNewProxy({ host: '', port: '', username: '', password: '', type: 'HTTP' });
        fetchProxies();
        fetchStats();
      }
    } catch (e: any) {
      showMsg(e?.response?.data?.message || 'Ошибка добавления прокси', true);
    }
  };

  const handleTestProxy = async (id: string) => {
    setTestingId(id);
    try {
      const res = await api.post(`/proxies/${id}/test`);
      const result = res.data.data;
      setTestResult(prev => ({
        ...prev,
        [id]: result.success
          ? { ok: true, msg: `✓ ${result.latency}ms${result.ip ? ` · IP: ${result.ip}` : ''}` }
          : { ok: false, msg: `✗ ${result.error || 'Ошибка'}` },
      }));
      fetchProxies();
    } catch (e: any) {
      setTestResult(prev => ({ ...prev, [id]: { ok: false, msg: '✗ Недоступен' } }));
    } finally {
      setTestingId(null);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await api.post(`/proxies/${id}/set-default`);
      showMsg('Прокси по умолчанию установлен');
      fetchProxies();
    } catch (e: any) {
      showMsg('Ошибка', true);
    }
  };

  const handleDeleteProxy = async (id: string) => {
    if (!confirm('Удалить прокси?')) return;
    try {
      await api.delete(`/proxies/${id}`);
      showMsg('Прокси удалён');
      fetchProxies();
      fetchStats();
    } catch (e: any) {
      showMsg('Ошибка удаления', true);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return '#22c55e';
      case 'failed': return '#ef4444';
      default: return '#a1a1aa';
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-gray-400">Загрузка...</div>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.3)', color: '#ef4444' }}>
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.3)', color: '#22c55e' }}>
          {success}
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="glass rounded-xl p-4">
            <div className="text-sm text-gray-500">Всего</div>
            <div className="text-2xl font-bold">{stats.total}</div>
          </div>
          <div className="glass rounded-xl p-4">
            <div className="text-sm" style={{ color: '#22c55e' }}>Активных</div>
            <div className="text-2xl font-bold">{stats.active}</div>
          </div>
          <div className="glass rounded-xl p-4">
            <div className="text-sm" style={{ color: '#ef4444' }}>Ошибок</div>
            <div className="text-2xl font-bold">{stats.failed}</div>
          </div>
          <div className="glass rounded-xl p-4">
            <div className="text-sm text-gray-500">Средний пинг</div>
            <div className="text-2xl font-bold">{stats.avgLatency}ms</div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">Прокси</h2>
        <Button onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? 'Отмена' : '+ Добавить прокси'}
        </Button>
      </div>

      {showAddForm && (
        <div className="glass rounded-xl p-6">
          <h3 className="font-semibold mb-4">Новый прокси</h3>
          <form onSubmit={handleAddProxy} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm mb-2">Хост *</label>
                <input
                  type="text"
                  value={newProxy.host}
                  onChange={(e) => setNewProxy({ ...newProxy, host: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-purple-500"
                  placeholder="192.168.1.1 или proxy.example.com"
                  required
                />
              </div>
              <div>
                <label className="block text-sm mb-2">Порт *</label>
                <input
                  type="number"
                  value={newProxy.port}
                  onChange={(e) => setNewProxy({ ...newProxy, port: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-purple-500"
                  placeholder="8080"
                  required
                />
              </div>
              <div>
                <label className="block text-sm mb-2">Логин (опционально)</label>
                <input
                  type="text"
                  value={newProxy.username}
                  onChange={(e) => setNewProxy({ ...newProxy, username: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-purple-500"
                  placeholder="user"
                />
              </div>
              <div>
                <label className="block text-sm mb-2">Пароль (опционально)</label>
                <input
                  type="password"
                  value={newProxy.password}
                  onChange={(e) => setNewProxy({ ...newProxy, password: e.target.value })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-purple-500"
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="block text-sm mb-2">Тип</label>
                <select
                  value={newProxy.type}
                  onChange={(e) => setNewProxy({ ...newProxy, type: e.target.value as any })}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-purple-500"
                >
                  <option value="HTTP">HTTP</option>
                  <option value="HTTPS">HTTPS</option>
                  <option value="SOCKS5">SOCKS5</option>
                </select>
              </div>
            </div>
            <Button type="submit">Добавить прокси</Button>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {proxies.length === 0 ? (
          <div className="text-center py-8 text-gray-500">Нет прокси. Добавьте первый.</div>
        ) : (
          proxies.map((proxy) => (
            <div key={proxy.id} className="glass rounded-xl p-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: getStatusColor(proxy.status) }} />
                  <div>
                    <div className="font-semibold font-mono text-sm">
                      {proxy.type}://{proxy.host}:{proxy.port}
                      {proxy.username && <span className="text-gray-500"> ({proxy.username})</span>}
                      {proxy.isDefault && <span className="ml-2 text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(139,92,246,.2)', color: '#a78bfa' }}>по умолчанию</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      ✓ {proxy.successCount} · ✗ {proxy.failureCount}
                      {proxy.latency ? ` · ${proxy.latency}ms` : ''}
                    </div>
                    {testResult[proxy.id] && (
                      <div className="text-xs mt-1 font-mono" style={{ color: testResult[proxy.id].ok ? '#22c55e' : '#ef4444' }}>
                        {testResult[proxy.id].msg}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    onClick={() => handleTestProxy(proxy.id)}
                    className="text-sm px-3 py-2"
                    disabled={testingId === proxy.id}
                  >
                    {testingId === proxy.id ? 'Тест...' : 'Тест'}
                  </Button>
                  {!proxy.isDefault && (
                    <Button onClick={() => handleSetDefault(proxy.id)} className="text-sm px-3 py-2">
                      По умолчанию
                    </Button>
                  )}
                  <button
                    onClick={() => handleDeleteProxy(proxy.id)}
                    className="px-3 py-2 rounded-lg text-sm font-medium"
                    style={{ background: 'rgba(239,68,68,.15)', border: '1px solid rgba(239,68,68,.3)', color: '#ef4444' }}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
