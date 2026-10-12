const axios = require('axios');

// 获取北京时间
function getBeijingTime() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 8 * 3600000);
}

// 中国A股节假日（非交易日）列表，包含周末和法定节假日
// 格式: 'YYYY-MM-DD'
// 注意：需要每年年底更新下一年的节假日
const HOLIDAYS = new Set([
  // 2024年
  '2024-01-01', // 元旦
  '2024-02-09', '2024-02-10', '2024-02-11', '2024-02-12', '2024-02-13', '2024-02-14', '2024-02-15', '2024-02-16', '2024-02-17', // 春节
  '2024-04-04', '2024-04-05', '2024-04-06', // 清明节
  '2024-05-01', '2024-05-02', '2024-05-03', '2024-05-04', '2024-05-05', // 劳动节
  '2024-06-08', '2024-06-09', '2024-06-10', // 端午节
  '2024-09-15', '2024-09-16', '2024-09-17', // 中秋节
  '2024-10-01', '2024-10-02', '2024-10-03', '2024-10-04', '2024-10-05', '2024-10-06', '2024-10-07', // 国庆节
  // 2025年
  '2025-01-01', // 元旦
  '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31', '2025-02-01', '2025-02-02', '2025-02-03', '2025-02-04', // 春节
  '2025-04-04', '2025-04-05', '2025-04-06', // 清明节
  '2025-05-01', '2025-05-02', '2025-05-03', '2025-05-04', '2025-05-05', // 劳动节
  '2025-05-31', '2025-06-01', '2025-06-02', // 端午节
  '2025-10-01', '2025-10-02', '2025-10-03', '2025-10-04', '2025-10-05', '2025-10-06', '2025-10-07', // 国庆节
  // 2026年
  '2026-01-01', '2026-01-02', '2026-01-03', // 元旦
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23', // 春节
  '2026-04-04', '2026-04-05', '2026-04-06', '2026-04-07', // 清明节
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05', // 劳动节
  '2026-06-19', '2026-06-20', '2026-06-21', // 端午节
  '2026-09-25', '2026-09-26', '2026-09-27', // 中秋节
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', // 国庆节
]);

// 指数代码 -> 名称映射（新浪接口返回 GBK 编码，中文会乱码，直接硬编码）
const INDEX_NAMES = {
  sh000001: '上证指数',
  sz399001: '深证成指',
  bj899050: '北证50',
};

/**
 * 从新浪财经获取实时指数行情（上证 + 深证 + 北交所）
 * @returns {Promise<{shanghai: object, shenzhen: object, beijing: object, total: object, raw: object}>}
 */
async function fetchMarketData() {
  const url = 'http://hq.sinajs.cn/list=sh000001,sz399001,bj899050';
  const response = await axios.get(url, {
    headers: {
      Referer: 'https://finance.sina.com.cn',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    },
    timeout: 8000,
    responseType: 'text',
    responseEncoding: 'binary',
  });

  const lines = response.data.split('\n').filter(l => l.trim());
  const result = {};

  for (const line of lines) {
    const match = line.match(/var hq_str_(\w+)="(.*)"/);
    if (!match) continue;

    const code = match[1];
    const fields = match[2].split(',');
    if (fields.length < 32) continue;

    result[code] = {
      name: INDEX_NAMES[code] || code,
      code,
      current: parseFloat(fields[3]) || 0,       // 当前点位
      open: parseFloat(fields[1]) || 0,           // 开盘
      preClose: parseFloat(fields[2]) || 0,       // 昨收
      change: parseFloat(fields[3]) - parseFloat(fields[2]), // 涨跌额
      changePercent: parseFloat(fields[2]) > 0
        ? ((parseFloat(fields[3]) - parseFloat(fields[2])) / parseFloat(fields[2]) * 100)
        : 0,
      volume: parseInt(fields[8]) || 0,           // 成交量（手）
      turnover: parseFloat(fields[9]) || 0,       // 成交额（元）
      date: fields[30] || '',
      time: fields[31] || '',
    };
  }

  const shanghai = result.sh000001 || {};
  const shenzhen = result.sz399001 || {};
  const beijing = result.bj899050 || {};
  const totalTurnover = (shanghai.turnover || 0) + (shenzhen.turnover || 0) + (beijing.turnover || 0);

  return {
    shanghai,
    shenzhen,
    beijing,
    total: {
      turnover: totalTurnover,
      turnoverYi: +(totalTurnover / 1e8).toFixed(2), // 亿元
    },
    timestamp: new Date().toISOString(),
    marketTime: shanghai.time || '',
    marketDate: shanghai.date || '',
  };
}

/**
 * 判断指定日期是否为交易日
 * @param {Date|string} date - 日期对象或 'YYYY-MM-DD' 格式字符串
 * @returns {boolean}
 */
function isTradingDay(date) {
  // 如果没有传入参数，使用北京时间
  const d = date 
    ? (typeof date === 'string' ? new Date(date) : date)
    : getBeijingTime();
  const day = d.getDay();
  
  // 周末不是交易日
  if (day === 0 || day === 6) return false;
  
  // 检查是否在节假日列表中
  const dateStr = d.toISOString().split('T')[0];
  if (HOLIDAYS.has(dateStr)) return false;
  
  return true;
}

/**
 * 判断当前是否在交易时段（包含集合竞价）
 * 采集时间：9:25（集合竞价）、9:30-11:30（上午盘）、13:00-15:00（下午盘）
 */
function isMarketHours() {
  const bjTime = getBeijingTime();
  
  // 先检查是否为交易日
  if (!isTradingDay(bjTime)) return false;

  const h = bjTime.getHours();
  const m = bjTime.getMinutes();
  const t = h * 60 + m;

  // 9:25 采集一次（集合竞价结果）
  if (t === 565) return true;
  // 9:30 - 11:30（上午盘）
  if (t >= 570 && t <= 690) return true;
  // 13:00 - 15:00（下午盘）
  if (t >= 780 && t <= 900) return true;

  return false;
}

/**
 * 获取当前市场状态描述
 */
function getMarketStatus() {
  const bjTime = getBeijingTime();
  
  // 非交易日
  if (!isTradingDay(bjTime)) return 'closed';

  const h = bjTime.getHours();
  const m = bjTime.getMinutes();
  const t = h * 60 + m;

  if (t < 565) return 'pre-market';        // 9:25 前
  if (t < 570) return 'call-auction';       // 9:25-9:30 集合竞价
  if (t <= 690) return 'morning';           // 9:30-11:30
  if (t < 780) return 'noon-break';         // 11:30-13:00
  if (t <= 900) return 'afternoon';         // 13:00-15:00
  return 'closed';                          // 15:00 以后
}

/**
 * 从东方财富获取指数历史日K数据（含成交额）
 * @param {string} secid - 指数代码，如 '1.000001'（上证）
 * @param {number} limit - 获取天数
 * @returns {Promise<Array<{date: string, turnover: number}>>}
 */
async function fetchIndexHistory(secid, limit = 120) {
  // 使用 HTTP 协议（HTTPS 容易被拒）
  const url = 'http://push2his.eastmoney.com/api/qt/stock/kline/get';
  const params = {
    secid,
    fields1: 'f1,f2,f3,f4,f5,f6',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
    klt: '101',   // 日K
    fqt: '1',     // 前复权
    lmt: String(limit),
    end: '20500101',
    ut: 'fa5fd1943c7b386f172d6893dbfba10b',
  };

  try {
    const response = await axios.get(url, {
      params,
      timeout: 15000,
      headers: {
        Referer: 'https://quote.eastmoney.com',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: '*/*',
      },
    });

    const klines = response.data?.data?.klines;
    if (!klines || !Array.isArray(klines)) return [];

    return klines.map(line => {
      const parts = line.split(',');
      return {
        date: parts[0],
        turnover: parseFloat(parts[6]) || 0,  // 成交额（元）
      };
    }).filter(d => d.date && d.turnover > 0);
  } catch (err) {
    console.error(`获取指数 ${secid} 历史数据失败:`, err.message);
    return [];
  }
}

/**
 * 获取最近20日和60日A股全市场平均成交额（原始请求，不缓存）
 * 数据来源：东方财富（上证指数 + 深证成指 + 北证50）
 * @returns {Promise<object>}
 */
async function _fetchMarketAveragesRaw() {
  // 并行获取三大指数近 150 个交易日数据
  const [shData, szData, bjData] = await Promise.all([
    fetchIndexHistory('1.000001', 150),  // 上证指数（沪市全部股票）
    fetchIndexHistory('0.399001', 150),  // 深证成指（深市代表）
    fetchIndexHistory('0.899050', 150),  // 北证50（北交所）
  ]);

  // 按日期合并：每日总成交额 = 上证 + 深证 + 北证
  const dailyMap = new Map();

  for (const d of shData) {
    dailyMap.set(d.date, (dailyMap.get(d.date) || 0) + d.turnover);
  }
  for (const d of szData) {
    dailyMap.set(d.date, (dailyMap.get(d.date) || 0) + d.turnover);
  }
  for (const d of bjData) {
    dailyMap.set(d.date, (dailyMap.get(d.date) || 0) + d.turnover);
  }

  // 按日期降序（最新在前）
  const dailyTotals = Array.from(dailyMap.entries())
    .map(([date, turnover]) => ({ date, turnover }))
    .sort((a, b) => b.date.localeCompare(a.date));

  // 计算均线
  const calcMA = (n) => {
    if (dailyTotals.length < n) return null;
    const sum = dailyTotals.slice(0, n).reduce((s, d) => s + d.turnover, 0);
    return sum / n;
  };

  const ma20 = calcMA(20);
  const ma60 = calcMA(60);

  return {
    ma20,
    ma60,
    latestDate: dailyTotals[0]?.date || null,
    latestTurnover: dailyTotals[0]?.turnover || 0,
    totalDays: dailyTotals.length,
    ma20Date: dailyTotals[Math.min(19, dailyTotals.length - 1)]?.date || null,
    ma60Date: dailyTotals[Math.min(59, dailyTotals.length - 1)]?.date || null,
  };
}

// ============ 均量缓存 ============
// 缓存逻辑：
// - 交易日 15:05 后：请求一次，缓存到当天结束
// - 交易日 15:05 前：用上一个交易日的缓存
// - 非交易日：始终用缓存（数据不会变）
let _avgCache = {
  data: null,       // 缓存的均量数据
  fetchDate: null,  // 上次请求的日期 (YYYY-MM-DD)
  fetchTime: 0,     // 上次请求的时间戳
};

/**
 * 获取20日/60日平均成交额（带缓存）
 * - 交易日 15:05 后首次访问会触发请求，之后用缓存
 * - 其他时间直接返回缓存
 * @returns {Promise<object>}
 */
async function getMarketAveragesCached() {
  const bjTime = getBeijingTime();
  const todayStr = bjTime.toISOString().split('T')[0];
  const h = bjTime.getHours();
  const m = bjTime.getMinutes();
  const t = h * 60 + m;
  const isTrading = isTradingDay(bjTime);

  // 判断缓存是否有效
  let needRefresh = false;

  if (!_avgCache.data) {
    // 从未加载过，必须请求
    needRefresh = true;
  } else if (_avgCache.fetchDate === todayStr) {
    // 今天已经请求过了，缓存有效
    needRefresh = false;
  } else if (isTrading && t >= 905) {
    // 交易日 15:05 后（t=905），且今天还没请求过 → 需要刷新
    needRefresh = true;
  } else {
    // 非交易日 或 交易日盘中/盘前 → 用缓存
    needRefresh = false;
  }

  if (needRefresh) {
    try {
      console.log('💹 [均量] 正在从东方财富获取最新数据...');
      _avgCache.data = await _fetchMarketAveragesRaw();
      _avgCache.fetchDate = todayStr;
      _avgCache.fetchTime = Date.now();
      console.log(`💹 [均量] 缓存已更新，最新日期: ${_avgCache.data.latestDate}`);
    } catch (err) {
      console.error('💹 [均量] 获取失败，使用旧缓存:', err.message);
      // 如果请求失败但有旧缓存，继续用旧缓存
      if (!_avgCache.data) {
        _avgCache.data = { ma20: null, ma60: null, latestDate: null, latestTurnover: 0 };
      }
    }
  }

  return _avgCache.data;
}

/**
 * 强制刷新均量缓存（供定时任务调用）
 */
async function refreshMarketAverages() {
  _avgCache.fetchDate = null; // 清除日期标记，强制刷新
  return getMarketAveragesCached();
}

module.exports = {
  fetchMarketData,
  isMarketHours,
  isTradingDay,
  getMarketStatus,
  getBeijingTime,
  getMarketAveragesCached,
  refreshMarketAverages,
};
