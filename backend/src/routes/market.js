const express = require('express');
const router = express.Router();
const { MarketSnapshot, ExchangeDaily, MarketAverage } = require('../models');
const marketDataService = require('../services/marketDataService');

// SSE 客户端列表
const sseClients = new Set();

// 广播事件给所有 SSE 客户端
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(msg);
  }
}

// GET /api/market/events - SSE 事件流（前端监听后端采集通知）
router.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// 导出 broadcast 供 scheduler 调用
router._broadcast = broadcast;

// GET /api/market/realtime - 获取实时市场数据（不存库，纯代理）
router.get('/realtime', async (req, res) => {
  try {
    const data = await marketDataService.fetchMarketData();
    const status = marketDataService.getMarketStatus();
    res.json({ data, status });
  } catch (error) {
    console.error('获取市场数据失败:', error.message);
    res.status(500).json({ error: '获取市场数据失败: ' + error.message });
  }
});

// 获取上一个交易日的日期（跳过周末，使用北京时间）
function getPrevTradingDate() {
  const d = marketDataService.getBeijingTime();
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1);
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// GET /api/market/today - 获取今日所有快照 + 实时数据 + 昨日对比
router.get('/today', async (req, res) => {
  try {
    const bjNow = marketDataService.getBeijingTime();
    const today = `${bjNow.getFullYear()}-${String(bjNow.getMonth() + 1).padStart(2, '0')}-${String(bjNow.getDate()).padStart(2, '0')}`;
    const yesterday = getPrevTradingDate();

    const [snapshots, yesterdaySnapshots] = await Promise.all([
      MarketSnapshot.findAll({
        where: { snapshot_date: today },
        order: [['snapshot_time', 'ASC']],
        raw: true,
      }),
      MarketSnapshot.findAll({
        where: { snapshot_date: yesterday },
        order: [['snapshot_time', 'ASC']],
        raw: true,
      }),
    ]);

    // 同时返回实时数据
    let realtime = null;
    try {
      realtime = await marketDataService.fetchMarketData();
    } catch (e) {
      // 非交易时间可能获取失败，忽略
    }

    const status = marketDataService.getMarketStatus();
    res.json({
      data: snapshots,
      realtime,
      status,
      yesterday: {
        date: yesterday,
        snapshots: yesterdaySnapshots,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/market/snapshot - 手动采集一次快照（仅交易时段写入数据库）
router.post('/snapshot', async (req, res) => {
  try {
    const data = await marketDataService.fetchMarketData();
    const status = marketDataService.getMarketStatus();

    // 非交易时段：只返回实时数据，不写入数据库
    if (!marketDataService.isMarketHours()) {
      return res.json({
        data: null,
        realtime: data,
        created: false,
        saved: false,
        status,
        message: '非交易时段，不记录',
      });
    }

    // ★ 使用当前北京时间作为标签（用户看到的时间）
    const bjNow = marketDataService.getBeijingTime();
    const dateStr = `${bjNow.getFullYear()}-${String(bjNow.getMonth() + 1).padStart(2, '0')}-${String(bjNow.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(bjNow.getHours()).padStart(2, '0')}:${String(bjNow.getMinutes()).padStart(2, '0')}`;

    // ★ 行情数据源返回的原始时间戳（用于 collected_at）
    const marketDate = data.marketDate;
    const marketTime = data.marketTime;
    let collectedAt = null;
    if (marketDate && marketTime) {
      collectedAt = new Date(`${marketDate}T${marketTime}+08:00`);
    }

    const [snapshot, created] = await MarketSnapshot.findOrCreate({
      where: { snapshot_date: dateStr, snapshot_time: timeStr },
      defaults: {
        snapshot_date: dateStr,
        snapshot_time: timeStr,
        collected_at: collectedAt,
        sh_turnover: Math.round(data.shanghai?.turnover || 0),
        sz_turnover: Math.round(data.shenzhen?.turnover || 0),
        bj_turnover: Math.round(data.beijing?.turnover || 0),
        total_turnover: Math.round(data.total?.turnover || 0),
        sh_index: data.shanghai?.current || 0,
        sz_index: data.shenzhen?.current || 0,
        bj_index: data.beijing?.current || 0,
      },
    });

    if (!created) {
      await snapshot.update({
        collected_at: collectedAt,
        sh_turnover: Math.round(data.shanghai?.turnover || 0),
        sz_turnover: Math.round(data.shenzhen?.turnover || 0),
        bj_turnover: Math.round(data.beijing?.turnover || 0),
        total_turnover: Math.round(data.total?.turnover || 0),
        sh_index: data.shanghai?.current || 0,
        sz_index: data.shenzhen?.current || 0,
        bj_index: data.beijing?.current || 0,
      });
    }

    res.json({
      data: snapshot,
      realtime: data,
      created,
      saved: true,
      status,
    });
  } catch (error) {
    console.error('采集快照失败:', error.message);
    res.status(500).json({ error: '采集快照失败: ' + error.message });
  }
});

// GET /api/market/history/:date - 获取指定日期的快照记录
router.get('/history/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const snapshots = await MarketSnapshot.findAll({
      where: { snapshot_date: date },
      order: [['snapshot_time', 'ASC']],
      raw: true,
    });
    res.json({ data: snapshots });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/market/dates - 获取有记录的日期列表
router.get('/dates', async (req, res) => {
  try {
    const dates = await MarketSnapshot.findAll({
      attributes: [
        [MarketSnapshot.sequelize.fn('DISTINCT', MarketSnapshot.sequelize.col('snapshot_date')), 'date'],
      ],
      raw: true,
      order: [['snapshot_date', 'DESC']],
      limit: 30,
    });
    res.json({ data: dates.map(d => d.date) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/market/averages - 获取20日/60日平均成交额（东方财富数据，带缓存）
router.get('/averages', async (req, res) => {
  try {
    const averages = await marketDataService.getMarketAveragesCached();
    res.json({ data: averages });
  } catch (error) {
    console.error('获取平均成交额失败:', error.message);
    res.status(500).json({ error: '获取平均成交额失败: ' + error.message });
  }
});

// GET /api/market/exchange-daily - 获取沪深A股成交额（来自 AKShare，含趋势数据）
router.get('/exchange-daily', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 250;
    const records = await MarketAverage.findAll({
      order: [['trade_date', 'DESC']],
      limit,
      raw: true,
      attributes: ['trade_date', 'sse_amount', 'szse_amount', 'amount_yi', 'data_complete'],
    });
    // 按日期正序返回（便于折线图绘制）
    records.reverse();
    res.json({ data: records });
  } catch (error) {
    console.error('获取沪深A股成交额失败:', error.message);
    res.status(500).json({ error: '获取沪深A股成交额失败: ' + error.message });
  }
});

// GET /api/market/averages-trend - 获取最近 N 个交易日 ma20/ma60 趋势数据（仅完整数据）
router.get('/averages-trend', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 60;
    const records = await MarketAverage.findAll({
      where: { data_complete: true },
      order: [['trade_date', 'DESC']],
      limit,
      raw: true,
      attributes: ['trade_date', 'sse_amount', 'szse_amount', 'bse_amount', 'amount_yi', 'ma20', 'ma60', 'data_complete'],
    });
    // 按日期正序返回
    records.reverse();
    
    // 统计不完整数据数量（供前端提示）
    const incompleteCount = await MarketAverage.count({
      where: { data_complete: false },
    });
    
    res.json({ 
      data: records,
      incompleteCount: incompleteCount, // 提示有多少天数据不完整
    });
  } catch (error) {
    console.error('获取均量趋势失败:', error.message);
    res.status(500).json({ error: '获取均量趋势失败: ' + error.message });
  }
});

// POST /api/market/refresh-averages - 手动刷新均量数据 + 交易所成交额
router.post('/refresh-averages', async (req, res) => {
  try {
    console.log('💹 [手动刷新] 开始刷新均量数据...');
    const avgData = await marketDataService.refreshMarketAverages();
    console.log(`💹 [手动刷新] 均量已更新: 最新日期 ${avgData.latestDate}`);

    console.log('💹 [手动刷新] 开始刷新交易所成交额...');
    await marketDataService.refreshExchangeDaily();
    console.log('💹 [手动刷新] 交易所成交额已更新');

    // SSE 通知前端刷新
    broadcast('averages', { refreshed: true, latestDate: avgData.latestDate });

    res.json({
      success: true,
      message: '均量数据已刷新',
      latestDate: avgData.latestDate,
    });
  } catch (error) {
    console.error('手动刷新均量失败:', error.message);
    res.status(500).json({ error: '手动刷新均量失败: ' + error.message });
  }
});

module.exports = router;
