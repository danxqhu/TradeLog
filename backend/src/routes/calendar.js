const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { TradingCalendar } = require('../models');

// GET /api/calendar - 获取交易日历
router.get('/', async (req, res) => {
  try {
    const { year, month, is_trading_day } = req.query;
    const where = {};
    if (year) where.year = parseInt(year);
    if (month) where.month = parseInt(month);
    if (is_trading_day !== undefined) where.is_trading_day = is_trading_day === 'true';

    const calendar = await TradingCalendar.findAll({
      where,
      order: [['trade_date', 'ASC']],
    });

    res.json({ data: calendar });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/calendar/month/:year/:month - 获取某月日历
router.get('/month/:year/:month', async (req, res) => {
  try {
    const { year, month } = req.params;
    const calendar = await TradingCalendar.findAll({
      where: { year: parseInt(year), month: parseInt(month) },
      order: [['trade_date', 'ASC']],
    });
    res.json({ data: calendar, year: parseInt(year), month: parseInt(month) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/calendar/trading-days/count - 计算两个日期之间的交易日数
router.get('/trading-days/count', async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    if (!start_date || !end_date) {
      return res.status(400).json({ error: '请提供start_date和end_date' });
    }

    const count = await TradingCalendar.count({
      where: {
        trade_date: { [Op.between]: [start_date, end_date] },
        is_trading_day: true,
      },
    });

    res.json({ data: { start_date, end_date, trading_days: count } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/calendar/trading-days/add - 从某日期加N个交易日
router.get('/trading-days/add', async (req, res) => {
  try {
    const { start_date, days } = req.query;
    if (!start_date || !days) {
      return res.status(400).json({ error: '请提供start_date和days' });
    }

    const tradingDays = await TradingCalendar.findAll({
      where: {
        trade_date: { [Op.gt]: start_date },
        is_trading_day: true,
      },
      order: [['trade_date', 'ASC']],
      limit: parseInt(days),
    });

    const targetDate = tradingDays.length > 0 ? tradingDays[tradingDays.length - 1].trade_date : null;
    res.json({ data: { start_date, add_days: parseInt(days), target_date: targetDate } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/calendar/init - 初始化交易日历（生成某年数据）
router.post('/init', async (req, res) => {
  try {
    const { year } = req.body;
    if (!year) {
      return res.status(400).json({ error: '请提供year' });
    }

    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    // 检查是否已存在
    const existing = await TradingCalendar.count({ where: { year: parseInt(year) } });
    if (existing > 0) {
      return res.json({ message: `${year}年交易日历已存在`, count: existing });
    }

    // 生成日期（排除周末，节假日需手动标注）
    const records = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      const isTradingDay = dayOfWeek !== 0 && dayOfWeek !== 6;
      records.push({
        trade_date: d.toISOString().split('T')[0],
        is_trading_day: isTradingDay,
        market: 'ALL',
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        day_of_week: dayOfWeek,
      });
    }

    const created = await TradingCalendar.bulkCreate(records);
    res.json({ message: `${year}年交易日历初始化完成`, count: created.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/calendar/:id - 更新日历（标注节假日等）
router.put('/:id', async (req, res) => {
  try {
    const calendar = await TradingCalendar.findByPk(req.params.id);
    if (!calendar) {
      return res.status(404).json({ error: '记录不存在' });
    }
    await calendar.update(req.body);
    res.json({ data: calendar });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
