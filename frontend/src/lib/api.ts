import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
api.interceptors.request.use(
  (config) => {
    // Add any auth headers here if needed
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

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

  initiateAuth: async (orderId: string) => {
    const response = await api.post(`/orders/${orderId}/init-auth`);
    return response.data;
  },

  checkAuth: async (orderId: string) => {
    const response = await api.get(`/orders/${orderId}/check-auth`);
    return response.data;
  },

  getStatus: async (orderId: string) => {
    const response = await api.get(`/orders/${orderId}/status`);
    return response.data;
  },
};

// Auth API
export const authApi = {
  initiate: async (orderId: string) => {
    const response = await api.post('/auth/initiate', { orderId });
    return response.data;
  },

  poll: async (orderId: string) => {
    const response = await api.post('/auth/poll', { orderId });
    return response.data;
  },

  verify: async (exchangeCode: string) => {
    const response = await api.post('/auth/verify', { exchangeCode });
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
