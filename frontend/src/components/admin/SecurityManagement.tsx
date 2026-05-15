'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/Button';
import api from '@/lib/api';

interface ActivityLog {
  id: string;
  adminUsername: string;
  action: string;
  ipAddress: string;
  createdAt: string;
}

interface Session {
  id: string;
  ip: string;
  lastLoginAt: string;
  username: string;
}

interface Backup {
  filename: string;
  size: number;
  createdAt: string;
}

export default function SecurityManagement() {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [ipWhitelist, setIpWhitelist] = useState<string[]>([]);
  const [newIp, setNewIp] = useState('');
  const [loading, setLoading] = useState(true);
  const [backupLoading, setBackupLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [statusMsg, setStatusMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const adminId = typeof window !== 'undefined'
    ? JSON.parse(localStorage.getItem('admin_user') || '{}')?.id || ''
    : '';

  const showStatus = (text: string, ok = true) => {
    setStatusMsg({ text, ok });
    setTimeout(() => setStatusMsg(null), 3500);
  };

  const fetchLogs = useCallback(async () => {
    try {
      const res = await api.get('/security/activity-logs');
      if (res.data.success) setLogs(res.data.data);
    } catch (e) {
      console.error('Failed to fetch logs:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchIpWhitelist = useCallback(async () => {
    try {
      const res = await api.get('/security/ip-whitelist');
      if (res.data.success) setIpWhitelist(res.data.data.ips || []);
    } catch (e) {
      console.error('Failed to fetch IP whitelist:', e);
    }
  }, []);

  const fetchBackups = useCallback(async () => {
    try {
      const res = await api.get('/security/backups');
      if (res.data.success) setBackups(res.data.data);
    } catch (e) {
      console.error('Failed to fetch backups:', e);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    fetchIpWhitelist();
    fetchBackups();
  }, [fetchLogs, fetchIpWhitelist, fetchBackups]);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      showStatus('Пароли не совпадают', false);
      return;
    }
    if (passwordForm.newPassword.length < 8) {
      showStatus('Новый пароль должен быть не менее 8 символов', false);
      return;
    }
    try {
      const res = await api.post('/security/change-password', {
        adminId,
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      if (res.data.success) {
        showStatus('Пароль успешно изменён');
        setShowPasswordChange(false);
        setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      }
    } catch (e: any) {
      showStatus(e?.response?.data?.message || 'Ошибка смены пароля', false);
    }
  };

  const handleSaveIpWhitelist = async () => {
    try {
      const filtered = ipWhitelist.filter(ip => ip.trim());
      const res = await api.put('/security/ip-whitelist', { ips: filtered });
      if (res.data.success) showStatus('IP whitelist сохранён');
    } catch (e: any) {
      showStatus(e?.response?.data?.message || 'Ошибка сохранения', false);
    }
  };

  const handleShowSessions = async () => {
    setSessionsLoading(true);
    try {
      const res = await api.get(`/security/sessions/${adminId || 'all'}`);
      if (res.data.success) {
        setSessions(res.data.data);
        setShowSessions(true);
      }
    } catch (e: any) {
      showStatus('Ошибка загрузки сессий', false);
    } finally {
      setSessionsLoading(false);
    }
  };

  const handleRevokeAllSessions = async () => {
    if (!confirm('Отозвать все активные сессии? Вы будете разлогинены.')) return;
    try {
      const res = await api.post(`/security/sessions/${adminId}/revoke-all`);
      if (res.data.success) {
        showStatus('Все сессии отозваны');
        setSessions([]);
        setShowSessions(false);
      }
    } catch (e: any) {
      showStatus('Ошибка отзыва сессий', false);
    }
  };

  const handleCreateBackup = async () => {
    setBackupLoading(true);
    try {
      const res = await api.post('/security/backup');
      if (res.data.success) {
        showStatus(res.data.data.message);
        fetchBackups();
      }
    } catch (e: any) {
      showStatus(e?.response?.data?.message || 'Ошибка создания бэкапа', false);
    } finally {
      setBackupLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-gray-400">Загрузка...</div>;
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">Безопасность</h2>

      {/* Status message */}
      {statusMsg && (
        <div
          className="rounded-xl px-4 py-3 text-sm font-medium"
          style={{
            background: statusMsg.ok ? 'rgba(34,197,94,.12)' : 'rgba(239,68,68,.12)',
            border: `1px solid ${statusMsg.ok ? 'rgba(34,197,94,.3)' : 'rgba(239,68,68,.3)'}`,
            color: statusMsg.ok ? '#22c55e' : '#ef4444',
          }}
        >
          {statusMsg.text}
        </div>
      )}

      {/* Activity Logs */}
      <div className="glass rounded-xl p-6">
        <h3 className="font-semibold mb-4">Логи активности</h3>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {logs.length === 0 ? (
            <div className="text-gray-500 text-center py-4 text-sm">Нет записей</div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="p-3 rounded-lg text-sm" style={{ background: 'rgba(255,255,255,.02)' }}>
                <div className="flex justify-between items-center mb-1">
                  <span className="font-semibold">{log.adminUsername}</span>
                  <span className="text-gray-500 text-xs">{new Date(log.createdAt).toLocaleString('ru-RU')}</span>
                </div>
                <div className="text-gray-400">{log.action}</div>
                <div className="text-gray-500 text-xs">{log.ipAddress}</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Password Change */}
      <div className="glass rounded-xl p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold">Смена пароля</h3>
          <Button onClick={() => setShowPasswordChange(!showPasswordChange)}>
            {showPasswordChange ? 'Отмена' : 'Изменить пароль'}
          </Button>
        </div>
        {showPasswordChange && (
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-sm mb-2">Текущий пароль</label>
              <input
                type="password"
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-purple-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm mb-2">Новый пароль</label>
              <input
                type="password"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-purple-500"
                required
                minLength={8}
              />
            </div>
            <div>
              <label className="block text-sm mb-2">Подтвердите новый пароль</label>
              <input
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-purple-500"
                required
              />
            </div>
            <Button type="submit">Изменить пароль</Button>
          </form>
        )}
      </div>

      {/* IP Whitelist */}
      <div className="glass rounded-xl p-6">
        <h3 className="font-semibold mb-4">IP Whitelist</h3>
        <div className="space-y-2 mb-4">
          {ipWhitelist.map((ip, index) => (
            <div key={index} className="flex gap-2">
              <input
                type="text"
                value={ip}
                onChange={(e) => {
                  const updated = [...ipWhitelist];
                  updated[index] = e.target.value;
                  setIpWhitelist(updated);
                }}
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-purple-500 text-sm"
                placeholder="IP адрес (например, 192.168.1.1)"
              />
              <Button
                onClick={() => setIpWhitelist(ipWhitelist.filter((_, i) => i !== index))}
                className="text-sm px-3 py-1"
                style={{ background: 'rgba(239,68,68,.2)', border: '1px solid rgba(239,68,68,.3)', color: '#ef4444' }}
              >
                Удалить
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <input
              type="text"
              value={newIp}
              onChange={(e) => setNewIp(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (setIpWhitelist([...ipWhitelist, newIp.trim()]), setNewIp(''))}
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 focus:outline-none focus:border-purple-500 text-sm"
              placeholder="Новый IP адрес"
            />
            <Button
              onClick={() => { if (newIp.trim()) { setIpWhitelist([...ipWhitelist, newIp.trim()]); setNewIp(''); } }}
              className="text-sm px-3 py-1"
            >
              Добавить
            </Button>
          </div>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Оставьте пустым, чтобы разрешить доступ со всех IP адресов
        </p>
        <Button onClick={handleSaveIpWhitelist}>Сохранить</Button>
      </div>

      {/* Session Management */}
      <div className="glass rounded-xl p-6">
        <h3 className="font-semibold mb-4">Управление сессиями</h3>
        <p className="text-sm text-gray-500 mb-4">Управляйте активными сессиями администратора</p>

        {showSessions && sessions.length > 0 && (
          <div className="mb-4 space-y-2">
            {sessions.map((s) => (
              <div key={s.id} className="flex justify-between items-center p-3 rounded-lg text-sm" style={{ background: 'rgba(255,255,255,.03)' }}>
                <div>
                  <span className="font-medium">{s.username}</span>
                  <span className="text-gray-500 ml-2">{s.ip}</span>
                </div>
                <span className="text-gray-500 text-xs">{new Date(s.lastLoginAt).toLocaleString('ru-RU')}</span>
              </div>
            ))}
          </div>
        )}

        {showSessions && sessions.length === 0 && (
          <div className="mb-4 text-sm text-gray-500">Нет активных сессий</div>
        )}

        <div className="flex gap-2">
          <Button onClick={handleShowSessions} className="text-sm px-3 py-1" disabled={sessionsLoading}>
            {sessionsLoading ? 'Загрузка...' : 'Показать сессии'}
          </Button>
          <Button
            onClick={handleRevokeAllSessions}
            className="text-sm px-3 py-1"
            style={{ background: 'rgba(239,68,68,.2)', border: '1px solid rgba(239,68,68,.3)', color: '#ef4444' }}
          >
            Отозвать все сессии
          </Button>
        </div>
      </div>

      {/* Database Backup */}
      <div className="glass rounded-xl p-6">
        <h3 className="font-semibold mb-2">Бэкап базы данных</h3>
        <p className="text-sm text-gray-500 mb-4">
          Создайте резервную копию базы данных перед важными изменениями
        </p>

        {backups.length > 0 && (
          <div className="mb-4 space-y-1 max-h-40 overflow-y-auto">
            {backups.map((b) => (
              <div key={b.filename} className="flex justify-between items-center text-xs p-2 rounded-lg" style={{ background: 'rgba(255,255,255,.02)' }}>
                <span className="text-gray-300 font-mono">{b.filename}</span>
                <span className="text-gray-500">{(b.size / 1024).toFixed(1)} KB · {new Date(b.createdAt).toLocaleString('ru-RU')}</span>
              </div>
            ))}
          </div>
        )}

        <Button onClick={handleCreateBackup} disabled={backupLoading}>
          {backupLoading ? 'Создаём бэкап...' : 'Создать бэкап'}
        </Button>
      </div>
    </div>
  );
}
