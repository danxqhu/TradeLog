/**
 * 自选股逐分钟成交量/成交额服务 —— 采集落库 + 数据库优先读取 + 缺数回源
 *
 * 页面主口径是成交量（行情原始 volume，股）；成交额（收盘×成交量 近似）同时落库仅作参考。
 *
 * 口径与首页大盘快照一致：
 *   - node-cron 交易时段每分钟 :05 触发 collectMinute()
 *   - 09:25 集合竞价：取新浪实时行情成交额，存 09:25 一条
 *   - 9:30-11:30 / 13:00-15:00：拉新浪 1 分钟 K 线，把当日全部分钟条 upsert 入库
 *     （每次全量回填当天，宕机/请求失败缺掉的分钟会在下一分钟自动补回）
 *   - 加入自选 / 页面发现库里没数据：backfillRecentDays() 回源一次并落库
 *
 * 注意：新浪不给分钟成交额，用 收盘×成交量(股) 近似（±1%）；分钟历史仅保留约 7 个交易日，
 * 所以更要靠落库沉淀。
 */
const axios = require('axios');
const { Op } = require('sequelize');
const marketDataService = require('./marketDataService');
const { WatchlistStock, StockMinuteTurnover, sequelize } = require('../models');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function dateStrOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 市场前缀（新浪行情代码）
function getSinaSymbol(code) {
  if (code.startsWith('6') || code.startsWith('9')) return 'sh' + code;
  if (code.startsWith('0') || code.startsWith('3')) return 'sz' + code;
  return 'bj' + code;
}

// ==================== 第三方数据获取（单次请求，不重试） ====================

// 新浪分钟 K 线单次请求
async function fetchSinaMinutesKline(symbol, scale, datalen, host) {
  const urls = {
    quotes: 'https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData',
    money: 'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData',
  };
  const r = await axios.get(urls[host], {
    params: { symbol, scale, ma: 'no', datalen },
    headers: { Referer: 'https://finance.sina.com.cn', 'User-Agent': UA },
    timeout: 8000,
    responseType: 'text',
  });
  const data = JSON.parse(r.data);
  if (!Array.isArray(data) || !data.length) throw new Error('新浪分钟K线返回为空');
  return data;
}

// 新浪 5 分钟 K 线（实测覆盖最近约 7 个交易日，含昨日全天）
// 返回 { 'YYYY-MM-DD': [{ t:'HH:MM', volume, amount }] }
async function fetchSinaWideMinutes(code) {
  const bars = await fetchSinaMinutesKline(getSinaSymbol(code), 5, 330, 'money');
  const days = {};
  for (const b of bars) {
    const day = String(b.day || '').slice(0, 10);
    const t = String(b.day || '').slice(11, 16);
    if (!day || !t) continue;
    const volume = Number(b.volume) || 0;
    (days[day] = days[day] || []).push({ t, volume, amount: (Number(b.close) || 0) * volume });
  }
  return days;
}

// 新浪 1 分钟今日数据（quotes 失败退 money 5 分钟×60）
// 注意：响应里可能带昨日尾盘残段，调用方只应取最新一天覆盖
async function fetchSinaTodayBars(code) {
  const symbol = getSinaSymbol(code);
  let bars;
  let source = 'sina';
  try {
    bars = await fetchSinaMinutesKline(symbol, 1, 250, 'quotes');
  } catch (e) {
    bars = await fetchSinaMinutesKline(symbol, 5, 60, 'money');
    source = 'sina5m';
  }
  const days = {};
  for (const b of bars) {
    const day = String(b.day || '').slice(0, 10);
    if (!day) continue;
    const volume = Number(b.volume) || 0;
    (days[day] = days[day] || []).push({ t: String(b.day).slice(11, 16), volume, amount: (Number(b.close) || 0) * volume });
  }
  return { days, source };
}

// 新浪实时行情的当日成交额(元)与成交量(股)，供 09:25 竞价采集
async function fetchSinaSpotSnapshot(code) {
  const res = await axios.get(`https://hq.sinajs.cn/list=${getSinaSymbol(code)}`, {
    headers: { Referer: 'https://finance.sina.com.cn', 'User-Agent': UA },
    timeout: 8000,
    responseType: 'arraybuffer',
  });
  let text;
  try {
    text = new TextDecoder('gbk').decode(Buffer.from(res.data));
  } catch (e) {
    text = Buffer.from(res.data).toString('utf8');
  }
  const f = (text.split('"')[1] || '').split(',');
  if (f.length < 10) return { turnover: 0, volume: 0 };
  return { turnover: Number(f[9]) || 0, volume: Number(f[8]) || 0 };
}

// ==================== 落库 ====================

// rows: [{ time:'HH:MM', volume, amount, cumVolume, cumAmount }]，重复行按唯一键覆盖（行情修正后以最新为准）
async function saveDayBars(code, date, rows, source) {
  if (!rows.length) return 0;
  await StockMinuteTurnover.bulkCreate(
    rows.map(r => ({
      stock_code: code,
      snapshot_date: date,
      snapshot_time: r.time,
      minute_amount: r.amount,
      cum_amount: r.cumAmount,
      minute_volume: r.volume,
      cum_volume: r.cumVolume,
      source,
    })),
    { updateOnDuplicate: ['minute_amount', 'cum_amount', 'minute_volume', 'cum_volume', 'source', 'updated_at'] }
  );
  return rows.length;
}

// ==================== 定时采集入口（scheduler 每分钟 :05 调） ====================

async function collectMinute() {
  const bj = marketDataService.getBeijingTime();
  const wd = bj.getDay();
  if (wd === 0 || wd === 6) return;
  if (!marketDataService.isTradingDay(bj)) return;

  const t = bj.getHours() * 60 + bj.getMinutes();
  let mode = null;
  if (t === 565) mode = 'auction'; // 09:25
  else if ((t >= 570 && t <= 690) || (t >= 780 && t <= 900)) mode = 'kline'; // 9:30-11:30 / 13:00-15:00
  else return;

  const codes = (await WatchlistStock.findAll({ attributes: ['code'] })).map(r => r.code);
  if (!codes.length) return;

  const todayStr = dateStrOf(bj);
  let fail = 0;
  for (const code of codes) {
    try {
      if (mode === 'auction') {
        const spot = await fetchSinaSpotSnapshot(code);
        if (spot.volume > 0) {
          await saveDayBars(code, todayStr, [{
            time: '09:25',
            volume: Math.round(spot.volume),
            cumVolume: Math.round(spot.volume),
            amount: Math.round(spot.turnover),
            cumAmount: Math.round(spot.turnover),
          }], 'cron');
        }
      } else {
        // 全量回填当日分钟条：即使上一分钟请求失败，这一分钟也会把它补回
        const bars = await fetchSinaMinutesKline(getSinaSymbol(code), 1, 250, 'quotes');
        let cumVolume = 0;
        let cumAmount = 0;
        const rows = [];
        for (const b of bars) {
          const dt = String(b.day || '');
          if (dt.slice(0, 10) !== todayStr) continue; // 丢弃昨日尾盘残段
          const volume = Number(b.volume) || 0;
          const amount = (Number(b.close) || 0) * volume;
          cumVolume += volume;
          cumAmount += amount;
          rows.push({ time: dt.slice(11, 16), volume: Math.round(volume), cumVolume: Math.round(cumVolume), amount: Math.round(amount), cumAmount: Math.round(cumAmount) });
        }
        await saveDayBars(code, todayStr, rows, 'cron');
      }
    } catch (e) {
      fail++;
    }
    await sleep(300); // 逐只限速，防新浪封接口
  }
  if (fail) console.log(`📈 [自选分钟采集] ${todayStr} ${mode === 'auction' ? '竞价' : 'K线'}：${fail}/${codes.length} 只失败（下一分钟全量回填自动补齐）`);
}

// ==================== 补录（加入自选 / 页面缺数时回源一次并落库） ====================

// 只补最新两天（今日 1 分钟 + 昨日；更早新浪也只有 5 分钟，暂不落库）
async function backfillRecentDays(code, source = 'backfill') {
  let days = {};
  try {
    const todayRes = await fetchSinaTodayBars(code);
    const wide = await fetchSinaWideMinutes(code).catch(() => ({}));
    days = { ...wide };
    const tDate = Object.keys(todayRes.days).sort().pop();
    // 只用今日响应覆盖今天这一天，昨日保留 5 分钟全天数据（防尾盘残段污染昨日）
    if (tDate) days[tDate] = todayRes.days[tDate];
  } catch (e) {
    days = await fetchSinaWideMinutes(code);
  }
  const recent = Object.keys(days).sort().slice(-2);
  let saved = 0;
  for (const date of recent) {
    let cumVolume = 0;
    let cumAmount = 0;
    const rows = days[date]
      .sort((a, b) => a.t.localeCompare(b.t))
      .map(b => {
        cumVolume += b.volume;
        cumAmount += b.amount;
        return { time: b.t, volume: Math.round(b.volume), cumVolume: Math.round(cumVolume), amount: Math.round(b.amount), cumAmount: Math.round(cumAmount) };
      });
    saved += await saveDayBars(code, date, rows, source);
  }
  return saved;
}

// ==================== 数据库读取 ====================

// 该股票库里有哪些天（倒序，最多 60 天，供前端切日期）
async function getAvailableDates(code) {
  const rows = await StockMinuteTurnover.findAll({
    where: { stock_code: code },
    attributes: ['snapshot_date'],
    group: ['snapshot_date'],
    order: [['snapshot_date', 'DESC']],
    limit: 60,
  });
  return rows.map(r => String(r.snapshot_date).slice(0, 10));
}

// 默认展示日规则（与用户约定一致）：
//   交易日 9:15 以后 → 今日（盘中逐分钟增长，9:15 前库里的今日数据不可信）
//   交易日 9:15 以前 / 非交易日 → 最近一个有数据的前一交易日
function getDefaultTargetDate(dates) {
  const bj = marketDataService.getBeijingTime();
  const todayStr = dateStrOf(bj);
  const wd = bj.getDay();
  const isTrading = wd !== 0 && wd !== 6 && marketDataService.isTradingDay(bj);
  const mins = bj.getHours() * 60 + bj.getMinutes();
  if (isTrading && mins >= 555) return todayStr;
  return dates.find(d => d < todayStr) || dates[0] || todayStr;
}

// 从库构建时间线：指定日全量分钟行 + 前一有数据日的同刻前向填充（5 分钟粒度自动兼容）
async function timelineFromDb(code, target) {
  const dayRows = await StockMinuteTurnover.findAll({
    where: { stock_code: code, snapshot_date: target },
    order: [['snapshot_time', 'ASC']],
  });
  if (!dayRows.length) return null;

  const prevHead = await StockMinuteTurnover.findOne({
    where: { stock_code: code, snapshot_date: { [Op.lt]: target } },
    order: [['snapshot_date', 'DESC']],
    attributes: ['snapshot_date'],
  });
  let prevAgg = null;
  if (prevHead) {
    const prevDate = String(prevHead.snapshot_date).slice(0, 10);
    const pr = await StockMinuteTurnover.findAll({
      where: { stock_code: code, snapshot_date: prevDate },
      order: [['snapshot_time', 'ASC']],
    });
    prevAgg = pr.map(r => ({ t: r.snapshot_time, cum: Number(r.cum_amount), cumVol: Number(r.cum_volume) }));
  }
  // 前向填充：取对比日 <= 当前时刻的最后一根
  const prevValAt = (key) => time => {
    if (!prevAgg) return null;
    let best = null;
    for (const p of prevAgg) {
      if (p.t <= time) best = p[key]; else break;
    }
    return best;
  };
  const prevCumAt = prevValAt('cum');
  const prevCumVolAt = prevValAt('cumVol');

  const rows = dayRows.map(r => ({
    time: r.snapshot_time,
    volume: r.minute_volume == null ? null : Number(r.minute_volume),
    cum_volume: r.cum_volume == null ? null : Number(r.cum_volume),
    prev_cum_volume: prevCumVolAt(r.snapshot_time),
    amount: Number(r.minute_amount),
    cum: Number(r.cum_amount),
    prev_cum: prevCumAt(r.snapshot_time),
  }));
  return { date: target, prev_date: prevHead ? String(prevHead.snapshot_date).slice(0, 10) : null, rows };
}

module.exports = {
  collectMinute,
  backfillRecentDays,
  getAvailableDates,
  getDefaultTargetDate,
  timelineFromDb,
};
