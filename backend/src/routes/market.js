const express = require('express');
const router = express.Router();
const { MarketSnapshot } = require('../models');
const marketDataService = require('../services/marketDataService');

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

// 获取上一个交易日的日期（跳过周末）
function getPrevTradingDate() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1);
  }
  return d.toISOString().split('T')[0];
}

// GET /api/market/today - 获取今日所有快照 + 实时数据 + 昨日对比
router.get('/today', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
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

// POST /api/market/snapshot - 采集一次快照（仅交易时段写入数据库）
router.post('/snapshot', async (req, res) => {
  try {
    const data = await marketDataService.fetchMarketData();
    const bjTime = marketDataService.getBeijingTime();
    const dateStr = bjTime.toISOString().split('T')[0];
    const timeStr = `${String(bjTime.getHours()).padStart(2, '0')}:${String(bjTime.getMinutes()).padStart(2, '0')}`;
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

    const [snapshot, created] = await MarketSnapshot.findOrCreate({
      where: {
        snapshot_date: dateStr,
        snapshot_time: timeStr,
      },
      defaults: {
        snapshot_date: dateStr,
        snapshot_time: timeStr,
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

module.exports = router;
