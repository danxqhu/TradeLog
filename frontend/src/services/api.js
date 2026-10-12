import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 响应拦截器
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    console.error('API Error:', error.response?.data || error.message)
    return Promise.reject(error)
  }
)

// ===== 股票相关 =====
export const stockApi = {
  getList: (params) => api.get('/stocks', { params }),
  getRealtime: (codes) => api.get('/stocks/realtime', { params: { codes } }),
  create: (data) => api.post('/stocks', data),
  getByCode: (code) => api.get(`/stocks/${code}`),
  update: (code, data) => api.put(`/stocks/${code}`, data),
  delete: (code) => api.delete(`/stocks/${code}`),
}

// ===== 推荐记录 =====
export const recommendationApi = {
  getList: (params) => api.get('/recommendations', { params }),
  getById: (id) => api.get(`/recommendations/${id}`),
  create: (data) => api.post('/recommendations', data),
  update: (id, data) => api.put(`/recommendations/${id}`, data),
  delete: (id) => api.delete(`/recommendations/${id}`),
  getReturns: (id) => api.get(`/recommendations/${id}/returns`),
  trackReturn: (id, data) => api.post(`/recommendations/${id}/track`, data),
  calculateReturns: (id, data) => api.post(`/recommendations/${id}/calculate-returns`, data),
}

// ===== 量能数据 =====
export const volumeApi = {
  getList: (params) => api.get('/volume', { params }),
  getAvg30d: (stockCode, params) => api.get(`/volume/${stockCode}/avg30d`, { params }),
  getRealtime: (stockCode) => api.get(`/volume/${stockCode}/realtime`),
  create: (data) => api.post('/volume', data),
  batchCreate: (records) => api.post('/volume/batch', { records }),
}

// ===== 持仓管理 =====
export const positionApi = {
  getList: (params) => api.get('/positions', { params }),
  getById: (id) => api.get(`/positions/${id}`),
  create: (data) => api.post('/positions', data),
  update: (id, data) => api.put(`/positions/${id}`, data),
  addPosition: (id, data) => api.post(`/positions/${id}/add`, data),
  closePosition: (id, data) => api.post(`/positions/${id}/close`, data),
  getConfig: (id) => api.get(`/positions/${id}/strategy`),
  setConfig: (data) => api.post('/positions/config', data),
  checkAlert: (id, data) => api.post(`/positions/${id}/check-alert`, data),
  getStrategies: () => api.get('/positions/strategies/list'),
}

// ===== 上海证券报 =====
export const shanghaiNewsApi = {
  getList: (params) => api.get('/shanghai-news', { params }),
  getDates: () => api.get('/shanghai-news/dates'),
  getById: (id) => api.get(`/shanghai-news/${id}`),
  create: (data) => api.post('/shanghai-news', data),
  batchCreate: (records) => api.post('/shanghai-news/batch', { records }),
  update: (id, data) => api.put(`/shanghai-news/${id}`, data),
  delete: (id) => api.delete(`/shanghai-news/${id}`),
  scrape: (date) => api.post('/shanghai-news/scrape', {}, { params: date ? { date } : {} }),
  rescan: (date) => api.post('/shanghai-news/rescan', {}, { params: { date } }),
  refreshStocks: () => api.post('/shanghai-news/refresh-stocks'),
  getStockDict: () => api.get('/shanghai-news/stock-dict'),
}

// ===== 高盛研报 =====
export const researchReportApi = {
  getList: (params) => api.get('/research-reports', { params }),
  getDates: (params) => api.get('/research-reports/dates', { params }),
  getById: (id) => api.get(`/research-reports/${id}`),
  create: (data) => api.post('/research-reports', data),
  batchCreate: (records) => api.post('/research-reports/batch', { records }),
  update: (id, data) => api.put(`/research-reports/${id}`, data),
  delete: (id) => api.delete(`/research-reports/${id}`),
  scrape: (tier = 'all') => api.post('/research-reports/scrape', { tier }),
  importHistory: () => api.post('/research-reports/import-history'),
}

// ===== 交易日历 =====
export const calendarApi = {
  getCalendar: (params) => api.get('/calendar', { params }),
  getMonth: (year, month) => api.get(`/calendar/month/${year}/${month}`),
  getTradingDaysCount: (startDate, endDate) =>
    api.get('/calendar/trading-days/count', { params: { start_date: startDate, end_date: endDate } }),
  addTradingDays: (startDate, days) =>
    api.get('/calendar/trading-days/add', { params: { start_date: startDate, days } }),
  initCalendar: (year) => api.post('/calendar/init', { year }),
}

// ===== 市场实时数据 =====
export const marketApi = {
  getRealtime: () => api.get('/market/realtime'),
  getToday: () => api.get('/market/today'),
  takeSnapshot: () => api.post('/market/snapshot'),
  getHistory: (date) => api.get(`/market/history/${date}`),
  getDates: () => api.get('/market/dates'),
  getAverages: () => api.get('/market/averages'),
}

export default api
