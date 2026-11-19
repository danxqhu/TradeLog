const express = require('express');
const router = express.Router();
const { WatchlistStock, Stock } = require('../models');
const turnoverService = require('../services/watchlistTurnoverService');

// 自选股分钟成交额：数据读取一律数据库优先（stock_minute_turnovers 表，
// 由 scheduler 交易时段每分钟 :05 采集落库），库里缺当天数据才回源新浪一次并补落库

// GET /api/watchlist - 自选股列表
router.get('/', async (req, res) => {
  try {
    const rows = await WatchlistStock.findAll({ order: [['created_at', 'DESC']] });
    res.json({ data: rows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/watchlist { code } - 从全量股票库检索并加入自选（名称/市场自动回填）
router.post('/', async (req, res) => {
  try {
    const code = String(req.body.code || '').trim();
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: '请输入 6 位股票代码' });
    const exists = await WatchlistStock.findOne({ where: { code } });
    if (exists) return res.status(400).json({ error: '该股票已在自选列表中' });
    const stock = await Stock.findOne({ where: { code } });
    if (!stock) return res.status(404).json({ error: '股票库中未找到该代码' });
    const row = await WatchlistStock.create({ code, name: stock.name, market: stock.market });
    res.json({ data: row });
    // 响应后再回源一次补录今日+昨日入库（只此一次，不重试）；失败不影响添加结果，页面打开时还会再尝试
    turnoverService.backfillRecentDays(code, 'backfill').catch(e => {
      console.log(`📈 [自选补录] ${code} 补录失败: ${e.message}`);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/watchlist/:code - 移除自选（历史分钟数据保留在库里，重新加回不用重采）
router.delete('/:code', async (req, res) => {
  try {
    const n = await WatchlistStock.destroy({ where: { code: req.params.code } });
    if (!n) return res.status(404).json({ error: '自选列表中不存在该代码' });
    res.json({ message: '已删除' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/watchlist/:code/timeline?date=YYYY-MM-DD - 逐分钟成交额时间线（读库；缺数回源一次）
router.get('/:code/timeline', async (req, res) => {
  const code = String(req.params.code || '').trim();
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: '请输入 6 位股票代码' });
  try {
    let dates = await turnoverService.getAvailableDates(code);
    const reqDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? String(req.query.date) : null;
    const target = reqDate || turnoverService.getDefaultTargetDate(dates);

    let timeline = await turnoverService.timelineFromDb(code, target);
    let notice = null;
    if (!timeline) {
      // 库里没有这一天 → 回源新浪补录一次（新浪分钟数据只保留最近约 7 个交易日，更早的天补不到）
      try {
        await turnoverService.backfillRecentDays(code, 'page');
        timeline = await turnoverService.timelineFromDb(code, target);
        dates = await turnoverService.getAvailableDates(code);
      } catch (e) {
        return res.status(502).json({ error: `库中无 ${target} 数据，回源新浪也失败: ${e.message}` });
      }
      if (!timeline) notice = `${target} 库中没有历史分钟数据（新浪仅保留最近约 7 个交易日的分钟线，更早的以每日采集落库为准）`;
    }

    const stock = await Stock.findOne({ where: { code } });
    const market = stock ? stock.market : (code.startsWith('6') || code.startsWith('9') ? 'SH' : code.startsWith('4') || code.startsWith('8') ? 'BJ' : 'SZ');
    res.json({
      data: {
        code,
        name: stock ? stock.name : code,
        market,
        dates,
        notice,
        ...(timeline || { date: target, prev_date: null, rows: [] }),
      },
    });
  } catch (error) {
    console.error('获取自选股分钟时间线失败:', error.message);
    res.status(500).json({ error: '获取分钟数据失败: ' + error.message });
  }
});

module.exports = router;
