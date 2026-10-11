const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { Recommendation, RecommendationTracking, TradingCalendar } = require('../models');
const { calculateTradingDays, addTradingDays } = require('../services/tradingDayService');

// GET /api/recommendations - 获取推荐列表
router.get('/', async (req, res) => {
  try {
    const { type, source, date, startDate, endDate, page = 1, pageSize = 50 } = req.query;
    const where = {};
    if (type) where.type = type;
    if (source) where.source = source;
    if (date) where.recommend_date = date;
    if (startDate && endDate) {
      where.recommend_date = { [Op.between]: [startDate, endDate] };
    }

    const recommendations = await Recommendation.findAndCountAll({
      where,
      include: [{ model: RecommendationTracking, as: 'trackings' }],
      limit: parseInt(pageSize),
      offset: (parseInt(page) - 1) * parseInt(pageSize),
      order: [
        ['recommend_date', 'DESC'],
        ['recommend_time', 'DESC'],
      ],
    });

    res.json({
      data: recommendations.rows,
      total: recommendations.count,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/recommendations/:id - 获取推荐详情
router.get('/:id', async (req, res) => {
  try {
    const recommendation = await Recommendation.findByPk(req.params.id, {
      include: [{ model: RecommendationTracking, as: 'trackings' }],
    });
    if (!recommendation) {
      return res.status(404).json({ error: '推荐记录不存在' });
    }
    res.json({ data: recommendation });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/recommendations - 新增推荐
router.post('/', async (req, res) => {
  try {
    const { stock_code, stock_name, type, source, recommend_date, recommend_time, recommend_price, notes } = req.body;
    const recommendation = await Recommendation.create({
      stock_code,
      stock_name,
      type,
      source: source || '李享财经',
      recommend_date,
      recommend_time,
      recommend_price,
      current_price: recommend_price,
      notes,
    });
    res.json({ data: recommendation });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/recommendations/:id - 更新推荐
router.put('/:id', async (req, res) => {
  try {
    const recommendation = await Recommendation.findByPk(req.params.id);
    if (!recommendation) {
      return res.status(404).json({ error: '推荐记录不存在' });
    }
    await recommendation.update(req.body);
    res.json({ data: recommendation });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/recommendations/:id - 删除推荐
router.delete('/:id', async (req, res) => {
  try {
    const recommendation = await Recommendation.findByPk(req.params.id);
    if (!recommendation) {
      return res.status(404).json({ error: '推荐记录不存在' });
    }
    // 同时删除关联的跟踪记录
    await RecommendationTracking.destroy({ where: { recommendation_id: recommendation.id } });
    await recommendation.destroy();
    res.json({ message: '删除成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/recommendations/:id/returns - 获取各周期收益率
router.get('/:id/returns', async (req, res) => {
  try {
    const recommendation = await Recommendation.findByPk(req.params.id);
    if (!recommendation) {
      return res.status(404).json({ error: '推荐记录不存在' });
    }

    const trackings = await RecommendationTracking.findAll({
      where: { recommendation_id: recommendation.id },
      order: [['period_type', 'ASC']],
    });

    // 计算各周期的收益率
    const periods = ['3d', '7d', '2w', '1m'];
    const results = {};

    for (const period of periods) {
      const tracking = trackings.find(t => t.period_type === period);
      if (tracking) {
        results[period] = {
          check_date: tracking.check_date,
          check_price: tracking.check_price,
          return_rate: tracking.return_rate,
          trading_days: tracking.trading_days_count,
        };
      }
    }

    // 自定义天数
    const customTrackings = trackings.filter(t => t.period_type === 'custom');
    results.custom = customTrackings.map(t => ({
      custom_days: t.custom_days,
      check_date: t.check_date,
      check_price: t.check_price,
      return_rate: t.return_rate,
      trading_days: t.trading_days_count,
    }));

    res.json({ data: results, recommend_price: recommendation.recommend_price });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/recommendations/:id/track - 记录收益
router.post('/:id/track', async (req, res) => {
  try {
    const recommendation = await Recommendation.findByPk(req.params.id);
    if (!recommendation) {
      return res.status(404).json({ error: '推荐记录不存在' });
    }

    const { period_type, custom_days, check_date, check_price } = req.body;

    // 计算交易日数
    const tradingDays = await calculateTradingDays(
      recommendation.recommend_date,
      check_date
    );

    // 计算收益率
    const returnRate = ((check_price - recommendation.recommend_price) / recommendation.recommend_price * 100).toFixed(2);

    // 检查是否已存在该周期的记录
    const existing = await RecommendationTracking.findOne({
      where: {
        recommendation_id: recommendation.id,
        period_type,
        ...(period_type === 'custom' ? { custom_days } : {}),
      },
    });

    if (existing) {
      await existing.update({ check_date, check_price, return_rate: returnRate, trading_days_count: tradingDays });
      res.json({ data: existing, message: '更新成功' });
    } else {
      const tracking = await RecommendationTracking.create({
        recommendation_id: recommendation.id,
        period_type,
        custom_days: period_type === 'custom' ? custom_days : null,
        check_date,
        check_price,
        return_rate: returnRate,
        trading_days_count: tradingDays,
      });
      res.json({ data: tracking, message: '记录成功' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/recommendations/:id/calculate-returns - 自动计算收益率
router.post('/:id/calculate-returns', async (req, res) => {
  try {
    const recommendation = await Recommendation.findByPk(req.params.id);
    if (!recommendation) {
      return res.status(404).json({ error: '推荐记录不存在' });
    }

    const { current_price } = req.body;
    const recommendDate = recommendation.recommend_date;
    const periods = [
      { type: '3d', days: 3 },
      { type: '7d', days: 7 },
      { type: '2w', days: 10 },
      { type: '1m', days: 22 },
    ];

    const results = [];
    for (const period of periods) {
      const targetDate = await addTradingDays(recommendDate, period.days);
      if (targetDate) {
        const tradingDays = await calculateTradingDays(recommendDate, targetDate);
        const returnRate = ((current_price - recommendation.recommend_price) / recommendation.recommend_price * 100).toFixed(2);

        const [tracking] = await RecommendationTracking.upsert({
          recommendation_id: recommendation.id,
          period_type: period.type,
          check_date: targetDate,
          check_price: current_price,
          return_rate: returnRate,
          trading_days_count: tradingDays,
        });
        results.push(tracking);
      }
    }

    // 更新当前价格
    await recommendation.update({ current_price });

    res.json({ data: results, message: '收益率计算完成' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
