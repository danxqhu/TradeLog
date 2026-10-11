const express = require('express');
const router = express.Router();
const { Stock } = require('../models');

// GET /api/stocks - 获取股票列表
router.get('/', async (req, res) => {
  try {
    const { search, page = 1, pageSize = 20 } = req.query;
    const where = {};
    if (search) {
      const { Op } = require('sequelize');
      where[Op.or] = [
        { code: { [Op.like]: `%${search}%` } },
        { name: { [Op.like]: `%${search}%` } },
      ];
    }
    const stocks = await Stock.findAndCountAll({
      where,
      limit: parseInt(pageSize),
      offset: (parseInt(page) - 1) * parseInt(pageSize),
      order: [['code', 'ASC']],
    });
    res.json({
      data: stocks.rows,
      total: stocks.count,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/stocks/realtime - 获取实时行情（模拟数据，预留真实API接口）
router.get('/realtime', async (req, res) => {
  try {
    const { codes } = req.query;
    const stockCodes = codes ? codes.split(',') : [];

    // TODO: 接入真实行情API（AKShare/Tushare等）
    // 当前返回模拟数据
    const mockData = stockCodes.length > 0
      ? stockCodes.map(code => ({
          code,
          name: `模拟股票${code}`,
          current_price: (Math.random() * 50 + 10).toFixed(2),
          change_percent: (Math.random() * 10 - 5).toFixed(2),
          volume: Math.floor(Math.random() * 10000000),
          turnover: Math.floor(Math.random() * 500000000),
          timestamp: new Date().toISOString(),
        }))
      : [];

    res.json({ data: mockData, source: 'mock', note: '模拟数据，待接入真实API' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/stocks - 新增股票
router.post('/', async (req, res) => {
  try {
    const { code, name, market } = req.body;
    const stock = await Stock.create({ code, name, market: market || 'SH' });
    res.json({ data: stock });
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      res.status(400).json({ error: '该股票代码已存在' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// GET /api/stocks/:code - 获取单只股票详情
router.get('/:code', async (req, res) => {
  try {
    const stock = await Stock.findOne({ where: { code: req.params.code } });
    if (!stock) {
      return res.status(404).json({ error: '股票不存在' });
    }
    res.json({ data: stock });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/stocks/:code - 更新股票信息
router.put('/:code', async (req, res) => {
  try {
    const stock = await Stock.findOne({ where: { code: req.params.code } });
    if (!stock) {
      return res.status(404).json({ error: '股票不存在' });
    }
    await stock.update(req.body);
    res.json({ data: stock });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/stocks/:code - 删除股票
router.delete('/:code', async (req, res) => {
  try {
    const stock = await Stock.findOne({ where: { code: req.params.code } });
    if (!stock) {
      return res.status(404).json({ error: '股票不存在' });
    }
    await stock.destroy();
    res.json({ message: '删除成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
