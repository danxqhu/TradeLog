const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { MarketAverage, ExchangeDaily } = require('../models');

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
  sz399106: '深证综指',
  bj899100: '北证全指',
};

/**
 * 从新浪财经获取实时指数行情（上证 + 深证 + 北交所）
 * @returns {Promise<{shanghai: object, shenzhen: object, beijing: object, total: object, raw: object}>}
 */
async function fetchMarketData() {
  // ★ 使用全市场指数，避免成分指数导致成交额偏低
  // sh000001: 上证指数（沪市全部股票）
  // sz399106: 深证综指（深市全部股票）—— 注意不是 sz399001 深证成指（仅500只成分股）
  // bj899050: 北证50（北交所市值最大的50只，占北交所成交额约70-80%）
  //          注：新浪 API 无北证全指，北证50是最佳可用代理
  const url = 'http://hq.sinajs.cn/list=sh000001,sz399106,bj899050';
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
  const shenzhen = result.sz399106 || {};  // 深证综指（全市场）
  const beijing = result.bj899050 || {};   // 北证50（北交所最佳代理）
  const totalTurnover = (shanghai.turnover || 0) + (shenzhen.turnover || 0) + (beijing.turnover || 0);

  return {
    shanghai,
    shenzhen,
    beijing,
    total: {
      turnover: totalTurnover,
      turnoverYi: +(totalTurnover / 1e8).toFixed(2), // 亿元
    },
    // ★ 行情数据源返回的原始业务时间戳（北京时间，优先使用）
    marketTime: shanghai.time || '',   // "09:43:05"
    marketDate: shanghai.date || '',   // "2026-10-14"
    // 机器时间仅作兆底，禁止用作主业务时间
    serverTimestamp: new Date().toISOString(),
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

// ============ 均量缓存（从数据库 market_averages 表读取） ============
// 数据来源：AKShare（上交所 + 深交所官方每日成交数据）
// 脚本位置：backend/scripts/fetch_market_averages.py
// 数据库表：market_averages

const AVG_JSON_PATH = path.join(__dirname, '../../data/market_averages.json');
const PYTHON_SCRIPT = path.join(__dirname, '../scripts/fetch_market_averages.py');
const IMPORT_SCRIPT = path.join(__dirname, '../scripts/import_averages.js');

let _avgCache = {
  data: null,       // 缓存的均量数据
  fetchDate: null,  // 上次加载的日期
  refreshing: false, // 是否正在后台刷新
};

/**
 * 从数据库加载均量数据（market_averages 表）
 */
async function _loadFromDB() {
  try {
    const latest = await MarketAverage.findOne({
      order: [['trade_date', 'DESC']],
    });
    if (!latest) return null;

    const count = await MarketAverage.count();
    const completeCount = await MarketAverage.count({ where: { data_complete: true } });
    
    // ma20/ma60 单位是亿元，转为元给前端
    return {
      ma20: latest.ma20 ? parseFloat(latest.ma20) * 1e8 : null,
      ma60: latest.ma60 ? parseFloat(latest.ma60) * 1e8 : null,
      latestDate: latest.trade_date || null,
      latestTurnover: latest.amount_yi ? parseFloat(latest.amount_yi) * 1e8 : 0,
      sseAmount: latest.sse_amount ? parseFloat(latest.sse_amount) * 1e8 : null,
      szseAmount: latest.szse_amount ? parseFloat(latest.szse_amount) * 1e8 : null,
      bseAmount: latest.bse_amount ? parseFloat(latest.bse_amount) * 1e8 : null,
      dataComplete: latest.data_complete || false,
      totalDays: count,
      completeDays: completeCount,
    };
  } catch (err) {
    console.error('💹 [均量] 读取数据库失败:', err.message);
    return null;
  }
}

/**
 * 增量刷新：查询 DB 最新日期，只抓取之后的缺失数据，合并重算均线
 */
async function _runPythonScript() {
  // 1. 查询数据库中最新日期
  let fromDate = '2026-01-01'; // 默认起始日期
  try {
    const latest = await MarketAverage.findOne({
      order: [['trade_date', 'DESC']],
      raw: true,
    });
    if (latest) fromDate = latest.trade_date;
  } catch (e) {
    // 表可能不存在，忽略
  }

  // 2. 运行 Python 脚本（增量模式）
  await new Promise((resolve, reject) => {
    console.log(`💹 [均量] 增量抓取：从 ${fromDate} 之后...`);
    const outStream = fs.createWriteStream(AVG_JSON_PATH);
    const proc = execFile('python3', [PYTHON_SCRIPT, '--from-date', fromDate], {
      timeout: 300000,
    });
    proc.stdout.pipe(outStream);
    proc.stderr.on('data', (d) => process.stderr.write(d));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Python 脚本退出码 ${code}`));
    });
    proc.on('error', reject);
  });

  // 3. 运行导入脚本（合并新旧数据 + 重算均线）
  await new Promise((resolve, reject) => {
    console.log('💹 [均量] 正在合并数据并重算均线...');
    const proc = execFile('node', [IMPORT_SCRIPT], { timeout: 30000 });
    proc.stdout.on('data', (d) => console.log(d.toString().trim()));
    proc.stderr.on('data', (d) => console.error(d.toString().trim()));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`导入脚本退出码 ${code}`));
    });
    proc.on('error', reject);
  });
}

/**
 * 获取20日/60日平均成交额（带缓存）
 * - 首次调用从数据库加载
 * - 交易日 15:05 后自动运行 Python 脚本刷新
 * - 如果缓存数据不是最新交易日，收盘后自动后台刷新
 */
async function getMarketAveragesCached() {
  const bjTime = getBeijingTime();
  const todayStr = bjTime.toISOString().split('T')[0];
  const h = bjTime.getHours();
  const m = bjTime.getMinutes();
  const t = h * 60 + m;
  const isTrading = isTradingDay(bjTime);

  let needRefresh = false;

  if (!_avgCache.data) {
    // 首次加载：从数据库读取
    _avgCache.data = await _loadFromDB();
    if (!_avgCache.data) needRefresh = true;
    else _avgCache.fetchDate = 'loaded-from-db';
  }

  if (_avgCache.fetchDate !== todayStr) {
    if (isTrading && t >= 905) {
      needRefresh = true;
    } else if (!_avgCache.data) {
      needRefresh = true;
    }
  }

  // 收盘后自动检测：如果缓存的最新日期不是今天，后台触发刷新
  // 这样即使凌晨刷新失败，收盘后也会自动重试
  if (!needRefresh && _avgCache.data && isTrading && t >= 905) {
    const latestDate = _avgCache.data.latestDate;
    if (latestDate && latestDate < todayStr && !_avgCache.refreshing) {
      console.log(`💹 [均量] 缓存数据过期（最新: ${latestDate}，今天: ${todayStr}），后台自动刷新...`);
      _avgCache.refreshing = true;
      _runPythonScript()
        .then(async () => {
          _avgCache.data = await _loadFromDB();
          _avgCache.fetchDate = todayStr;
          _avgCache.refreshing = false;
          if (_avgCache.data) {
            console.log(`💹 [均量] 后台刷新完成，最新日期: ${_avgCache.data.latestDate}`);
          }
        })
        .catch(err => {
          _avgCache.refreshing = false;
          console.error('💹 [均量] 后台刷新失败:', err.message);
        });
    }
  }

  if (needRefresh) {
    try {
      await _runPythonScript();
      _avgCache.data = await _loadFromDB();
      _avgCache.fetchDate = todayStr;
      if (_avgCache.data) {
        console.log(`💹 [均量] 缓存已更新，最新日期: ${_avgCache.data.latestDate}`);
      }
    } catch (err) {
      console.error('💹 [均量] 刷新失败:', err.message);
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
  // 强制清空缓存，从数据库重新加载
  _avgCache.data = null;
  _avgCache.fetchDate = null;
  
  // 先尝试运行 Python 脚本抓取新数据
  try {
    await _runPythonScript();
  } catch (err) {
    console.error('💹 [均量] Python 脚本失败:', err.message);
  }
  
  // 从数据库重新加载
  _avgCache.data = await _loadFromDB();
  _avgCache.fetchDate = getBeijingTime().toISOString().split('T')[0];
  
  return _avgCache.data || { ma20: null, ma60: null, latestDate: null, latestTurnover: 0 };
}

// ============ 交易所官方每日成交额刷新 ============
const EXCHANGE_PY_SCRIPT = path.join(__dirname, '../../scripts/fetch_exchange_daily.py');
const EXCHANGE_JSON_PATH = path.join(__dirname, '../../data/exchange_daily.json');
const EXCHANGE_IMPORT_SCRIPT = path.join(__dirname, '../../scripts/import_exchange_daily.js');

/**
 * 刷新交易所官方每日成交额（增量模式：先查 DB 最新日期，只抓缺失的）
 */
async function refreshExchangeDaily() {
  // 1. 查询数据库中最新日期
  let latestDate = null;
  try {
    const latest = await ExchangeDaily.findOne({
      order: [['trade_date', 'DESC']],
      raw: true,
    });
    if (latest) latestDate = latest.trade_date;
  } catch (e) {
    // 表可能不存在，忽略
  }

  // 2. 判断是否需要抓取：如果最新日期已经是今天或最近交易日，跳过
  const bjTime = getBeijingTime();
  const todayStr = bjTime.toISOString().split('T')[0];

  if (latestDate === todayStr) {
    console.log(`💹 [交易所] 已是最新（${latestDate}），无需刷新`);
    return;
  }

  // 如果最新日期是昨天（且今天是交易日），也跳过（交易所数据通常凌晨才发布）
  const fromDate = latestDate || '2026-01-01';
  console.log(`💹 [交易所] 开始增量刷新：从 ${fromDate} 之后...`);

  // 3. 运行 Python 脚本（增量模式）
  await new Promise((resolve, reject) => {
    const outStream = fs.createWriteStream(EXCHANGE_JSON_PATH);
    const proc = execFile('python3', [EXCHANGE_PY_SCRIPT, '--from-date', fromDate], { timeout: 300000 });
    proc.stdout.pipe(outStream);
    proc.stderr.on('data', (d) => process.stderr.write(d));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Python 脚本退出码 ${code}`));
    });
    proc.on('error', reject);
  });

  // 4. 检查 JSON 是否有数据
  if (!fs.existsSync(EXCHANGE_JSON_PATH)) {
    console.log('💹 [交易所] 无新数据');
    return;
  }
  const raw = fs.readFileSync(EXCHANGE_JSON_PATH, 'utf-8').trim();
  if (!raw || raw === '[]') {
    console.log('💹 [交易所] 无新数据');
    return;
  }

  // 5. 运行导入脚本写入数据库
  await new Promise((resolve, reject) => {
    const proc = execFile('node', [EXCHANGE_IMPORT_SCRIPT], { timeout: 30000 });
    proc.stdout.on('data', (d) => console.log(d.toString().trim()));
    proc.stderr.on('data', (d) => console.error(d.toString().trim()));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`导入脚本退出码 ${code}`));
    });
    proc.on('error', reject);
  });

  console.log('💹 [交易所] 刷新完成');
}

module.exports = {
  fetchMarketData,
  isMarketHours,
  isTradingDay,
  getMarketStatus,
  getBeijingTime,
  getMarketAveragesCached,
  refreshMarketAverages,
  refreshExchangeDaily,
};
