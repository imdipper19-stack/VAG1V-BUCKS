import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor — attach admin JWT token if available
api.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('admin_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor — handle 401 by clearing token
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      // Token expired or invalid — redirect to login
      const isAdminRoute = window.location.pathname.startsWith('/admin');
      if (isAdminRoute && !window.location.pathname.includes('/login')) {
        // Чистим и localStorage, и cookie. Импорт inline чтобы не было циклической зависимости.
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_user');
        document.cookie = 'admin_token=; Path=/; Max-Age=0; SameSite=Lax';
        window.location.href = '/admin/login';
      }
    }
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

// Pricing API
export interface PublicPackage {
  vbucksAmount: number;
  priceRUB: number;
  popular: boolean;
}

export interface AdminPackage extends PublicPackage {
  wholesaleTRY: number;
  costRUB: number;
  profitRUB: number;
  marginPercent: number;
}

export const pricingApi = {
  list: async (): Promise<{ success: boolean; data: { packages: PublicPackage[]; currency: string } }> => {
    const response = await api.get('/pricing');
    return response.data;
  },

  listAdmin: async (): Promise<{
    success: boolean;
    data: { packages: AdminPackage[]; exchangeRate: number; currency: string };
  }> => {
    const response = await api.get('/pricing/admin');
    return response.data;
  },
};

// Orders API
export const ordersApi = {
  create: async (data: { vbucksAmount: number; priceTRY: number; sellerId?: string; webhookUrl?: string }) => {
    const response = await api.post('/orders', data);
    return response.data;
  },

  getBySlug: async (slug: string) => {
    const response = await api.get(`/orders/by-slug/${slug}`);
    return response.data;
  },

  getById: async (orderId: string) => {
    const response = await api.get(`/orders/by-id/${orderId}`);
    return response.data;
  },

  list: async (filters?: { status?: string; sellerId?: string; limit?: number }) => {
    const response = await api.get('/orders', { params: filters });
    return response.data;
  },

  getStatus: async (orderId: string) => {
    const response = await api.get(`/orders/${orderId}/status`);
    return response.data;
  },

  getQueueInfo: async () => {
    const response = await api.get('/orders/queue-info');
    return response.data;
  },

  getQueuePosition: async (orderId: string) => {
    const response = await api.get(`/orders/${orderId}/queue-position`);
    return response.data;
  },
};

// Auth API (Epic Games Authorization Code)
export const authApi = {
  getLoginUrl: async () => {
    const response = await api.get('/auth/login-url');
    return response.data;
  },

  submitCode: async (orderId: string, code: string) => {
    const response = await api.post('/auth/submit-code', { orderId, code });
    return response.data;
  },

  submitRegionCode: async (orderId: string, code: string) => {
    const response = await api.post('/auth/region-code', { orderId, code });
    return response.data;
  },

  /**
   * Начинает Epic Device Authorization Flow.
   * Возвращает короткий userCode (типа JXQ7R8I) и URL для активации.
   */
  deviceStart: async (orderId: string) => {
    const response = await api.post('/auth/device/start', { orderId });
    return response.data;
  },

  /**
   * Поллится фронтом каждые ~5 сек.
   * status: 'pending' пока юзер не подтвердил, 'authorized' когда токены получены
   * (бэкенд автоматически ставит заказ в очередь).
   */
  devicePoll: async (orderId: string, deviceCode: string) => {
    const response = await api.post('/auth/device/poll', { orderId, deviceCode });
    return response.data;
  },
};

// Admin Auth API
export const adminAuthApi = {
  login: async (username: string, password: string) => {
    const response = await api.post('/admin/auth/login', { username, password });
    return response.data;
  },

  verify: async (token: string) => {
    const response = await api.post('/admin/auth/verify', { token });
    return response.data;
  },

  me: async () => {
    const response = await api.get('/admin/auth/me');
    return response.data;
  },
};

// Payments API
export const paymentsApi = {
  createInvoice: async (data: { orderId: string; amount: number; currency?: string }) => {
    const response = await api.post('/payments/create-invoice', data);
    return response.data;
  },

  getInvoice: async (invoiceId: string) => {
    const response = await api.get(`/payments/invoice/${invoiceId}`);
    return response.data;
  },

  getMethods: async () => {
    const response = await api.get('/payments/methods');
    return response.data;
  },
};

// Webhooks API
export const webhooksApi = {
  test: async (webhookUrl: string) => {
    const response = await api.post('/webhooks/test', { webhookUrl });
    return response.data;
  },

  trigger: async (orderId: string) => {
    const response = await api.post('/webhooks/trigger', { orderId });
    return response.data;
  },
};

export default api;
