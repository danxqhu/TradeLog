import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截器：自动附加 JWT token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截器
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    // 401 时清除 token，触发路由守卫跳转登录页
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      // 避免在登录页重复跳转
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
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
  getDateStats: (params) => api.get('/recommendations/date-stats', { params }),
  create: (data) => api.post('/recommendations', data),
  update: (id, data) => api.put(`/recommendations/${id}`, data),
  delete: (id) => api.delete(`/recommendations/${id}`),
  getReturns: (id) => api.get(`/recommendations/${id}/returns`),
  getBestReturn: (id) => api.get(`/recommendations/${id}/best-return`),
  trackReturn: (id, data) => api.post(`/recommendations/${id}/track`, data),
  calculateReturns: (id, data) => api.post(`/recommendations/${id}/calculate-returns`, data),
  calculateCustom: (id, data) => api.post(`/recommendations/${id}/calculate-custom`, data),
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
  getByCode: (stockCode) => api.get(`/positions/by-code/${stockCode}`),
  create: (data) => api.post('/positions', data),
  update: (id, data) => api.put(`/positions/${id}`, data),
  addPosition: (id, data) => api.post(`/positions/${id}/add`, data),
  closePosition: (id, data) => api.post(`/positions/${id}/close`, data),
  deletePosition: (id) => api.delete(`/positions/${id}`),
  getConfig: (id) => api.get(`/positions/${id}/strategy`),
  setConfig: (data) => api.post('/positions/config', data),
  checkAlert: (id, data) => api.post(`/positions/${id}/check-alert`, data),
  checkAlertByCode: (stockCode, data) => api.post(`/positions/by-code/${stockCode}/check-alert`, data),
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
  scrape: (date) => api.post('/shanghai-news/scrape', {}, { params: date ? { date } : {}, timeout: 180000 }),
  rescan: (date) => api.post('/shanghai-news/rescan', {}, { params: { date }, timeout: 300000 }),
  refreshStocks: () => api.post('/shanghai-news/refresh-stocks'),
  getRefreshStatus: () => api.get('/shanghai-news/refresh-status'),
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
  getAveragesTrend: (limit) => api.get('/market/averages-trend', { params: { limit } }),
  getExchangeDaily: (limit) => api.get('/market/exchange-daily', { params: { limit } }),
  refreshAverages: () => api.post('/market/refresh-averages'),
}

// ===== 每日追资金 =====
// 抓取类接口背后是 Python 脚本（每接口只调一次、不重试），耗时可达数十秒，故单独放宽 timeout
export const moneyChaseApi = {
  getSectors: (top) => api.get('/money-chase/sectors', { params: { top }, timeout: 90000 }),
  getConstituents: (sectors) => api.get('/money-chase/constituents', {
    params: { sectors: Array.isArray(sectors) ? sectors.join(',') : sectors },
    timeout: 120000,
  }),
  getManualStocks: () => api.get('/money-chase/manual-stocks'),
  // 每只票最新一条打分摘要（加入后自动打的分在这里回到②清单，只查库不请求外部接口）
  getLatestScores: (symbols) => api.get('/money-chase/stocks/latest-scores', {
    params: { symbols: (symbols || []).join(',') },
  }),
  adjustManualStocks: (data) => api.post('/money-chase/manual-stocks', data, { timeout: 30000 }),
  // 不传 symbols 时后端先建 pending 批次再后台抓取，因此本接口也是秒返回
  run: (data) => api.post('/money-chase/run', data, { timeout: 30000 }),
  listRuns: (params) => api.get('/money-chase/runs', { params }),
  getRunStatus: (id) => api.get(`/money-chase/runs/${id}/status`),
  getCandidates: (id, pool) => api.get(`/money-chase/runs/${id}/candidates`, { params: pool ? { pool } : {}, timeout: 30000 }),
  getKline: (id) => api.get(`/money-chase/candidates/${id}/kline`, { timeout: 30000 }),
  // 单只票具体分析（点股票名）：新浪日线+快照+分时各 1 次，后端有 60 秒/10 分钟缓存；分析完自动落库打分
  getStockAnalysis: (symbol, sector, force) => api.get(`/money-chase/stock/${symbol}/analysis`, {
    params: { sector, force: force ? 1 : undefined }, timeout: 100000,
  }),
  updateCandidate: (id, data) => api.put(`/money-chase/candidates/${id}`, data),
  // ===== 定格快照（录入时点的评估，不随后新增 K 线重算） =====
  // 列表与设基准/删除只查库，不请求数据源；生成快照才会请求（收盘 1 次日线，盘中日线 1 + 分时 1~2，均不重试）
  listSnapshots: (symbol) => api.get('/money-chase/snapshots', { params: { symbol } }),
  getSnapshot: (id) => api.get(`/money-chase/snapshots/${id}`, { timeout: 30000 }),
  createSnapshot: (data) => api.post('/money-chase/snapshots', data, { timeout: 90000 }),
  setSnapshotBaseline: (id) => api.put(`/money-chase/snapshots/${id}/baseline`, {}),
  deleteSnapshot: (id) => api.delete(`/money-chase/snapshots/${id}`),
  getRules: () => api.get('/money-chase/rules', { timeout: 30000 }),
  updateRules: (items) => api.put('/money-chase/rules', { items }),
  resetRule: (key) => api.post('/money-chase/rules/reset', key ? { key } : {}),
  reseedRules: () => api.post('/money-chase/rules/reseed', {}, { timeout: 30000 }),
  getEffective: () => api.get('/money-chase/rules/effective'),
  getSchedules: () => api.get('/money-chase/schedules'),
  createSchedule: (data) => api.post('/money-chase/schedules', data),
  updateSchedule: (id, data) => api.put(`/money-chase/schedules/${id}`, data),
  deleteSchedule: (id) => api.delete(`/money-chase/schedules/${id}`),
  // 同上：autoRun 先建批次行、后台抓取，立即返 runId
  triggerSchedule: (id) => api.post(`/money-chase/schedules/${id}/trigger`, {}, { timeout: 30000 }),
}

// ===== 胡胖胖招财进宝 =====
// 加权评分选股：判定项/权重/分档可配，评估记录按日存档可复盘。K 线复盘图复用追资金行情接口（moneyChaseApi.getStockAnalysis）
export const fortuneApi = {
  getCriteria: () => api.get('/fortune/criteria'),
  updateCriteria: (items) => api.put('/fortune/criteria', { items }),
  resetCriteria: (code) => api.post('/fortune/criteria/reset', code ? { code } : {}),
  preview: (criterionScores) => api.post('/fortune/preview', { criterion_scores: criterionScores }),
  evaluate: (data) => api.post('/fortune/evaluate', data),
  listEvaluations: (params) => api.get('/fortune/evaluations', { params }),
  getEvaluation: (id) => api.get(`/fortune/evaluations/${id}`),
  deleteEvaluation: (id) => api.delete(`/fortune/evaluations/${id}`),
  getStocks: () => api.get('/fortune/stocks'),
  addStock: (data) => api.post('/fortune/stocks', data),
  removeStock: (symbol) => api.delete(`/fortune/stocks/${symbol}`),
  // 批量自动打分：提交→轮询进度；榜单秒开读落库；单票按需重算
  startScan: (symbols, date) => api.post('/fortune/scan', { symbols, date }),
  getScanStatus: (scanId) => api.get(`/fortune/scan/${scanId}`),
  getLeaderboard: (date) => api.get('/fortune/leaderboard', { params: { date } }),
  getStockScore: (symbol, date) => api.get(`/fortune/score/${symbol}`, { params: date ? { date } : {} }),
}

// ===== 认证相关 =====
export const authApi = {
  login: (data) => api.post('/auth/login', data),
  register: (data) => api.post('/auth/register', data),
  getMe: () => api.get('/auth/me'),
  resetPassword: (data) => api.post('/auth/reset-password', data),
  getRegistrationStatus: () => api.get('/auth/registration-status'),
  getSecurityQuestion: (username) => api.get(`/auth/security-question/${username}`),
  toggleRegistration: (open) => api.put('/auth/registration-toggle', { open }),
}

export default api

// ===== 系统信息（公开接口，无需 token） =====
export const systemApi = {
  getVersion: () => api.get('/version'),
  getHealth: () => api.get('/health'),
}
