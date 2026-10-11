const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { VolumeHistory } = require('../models');

// GET /api/volume - 获取量能历史列表
router.get('/', async (req, res) => {
  try {
    const { stock_code, start_date, end_date, page = 1, pageSize = 30 } = req.query;
    const where = {};
    if (stock_code) where.stock_code = stock_code;
    if (start_date && end_date) {
      where.trade_date = { [Op.between]: [start_date, end_date] };
    } else if (start_date) {
      where.trade_date = { [Op.gte]: start_date };
    }

    const volumes = await VolumeHistory.findAndCountAll({
      where,
      limit: parseInt(pageSize),
      offset: (parseInt(page) - 1) * parseInt(pageSize),
      order: [['trade_date', 'DESC']],
    });

    res.json({
      data: volumes.rows,
      total: volumes.count,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/volume/:stock_code/avg30d - 获取30日平均量能
router.get('/:stock_code/avg30d', async (req, res) => {
  try {
    const { stock_code } = req.params;
    const { date } = req.query;

    // 获取指定日期之前30个交易日的数据
    const where = { stock_code };
    if (date) {
      where.trade_date = { [Op.lte]: date };
    }

    const records = await VolumeHistory.findAll({
      where,
      order: [['trade_date', 'DESC']],
      limit: 30,
    });

    if (records.length === 0) {
      return res.json({
        data: {
          stock_code,
          avg_volume_30d: 0,
          avg_turnover_30d: 0,
          record_count: 0,
          note: '暂无数据',
        },
      });
    }

    const totalVolume = records.reduce((sum, r) => sum + Number(r.volume), 0);
    const totalTurnover = records.reduce((sum, r) => sum + (Number(r.turnover) || 0), 0);

    res.json({
      data: {
        stock_code,
        avg_volume_30d: Math.round(totalVolume / records.length),
        avg_turnover_30d: Math.round(totalTurnover / records.length),
        record_count: records.length,
        latest_date: records[0].trade_date,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/volume/:stock_code/realtime - 实时放量缩量（模拟数据）
router.get('/:stock_code/realtime', async (req, res) => {
  try {
    const { stock_code } = req.params;

    // 获取30日均量
    const historyRecords = await VolumeHistory.findAll({
      where: { stock_code },
      order: [['trade_date', 'DESC']],
      limit: 30,
    });

    const avgVolume = historyRecords.length > 0
      ? historyRecords.reduce((sum, r) => sum + Number(r.volume), 0) / historyRecords.length
      : 10000000; // 默认值

    // TODO: 接入实时行情API获取当前成交量
    // 当前使用模拟数据
    const currentVolume = Math.floor(Math.random() * 20000000);
    const volumeRatio = (currentVolume / avgVolume).toFixed(2);
    const isVolumeUp = currentVolume > avgVolume;

    res.json({
      data: {
        stock_code,
        current_volume: currentVolume,
        avg_volume_30d: Math.round(avgVolume),
        volume_ratio: volumeRatio,
        is_volume_up: isVolumeUp,
        status: isVolumeUp ? '放量' : '缩量',
        timestamp: new Date().toISOString(),
        source: 'mock',
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/volume - 新增量能记录
router.post('/', async (req, res) => {
  try {
    const record = await VolumeHistory.create(req.body);
    res.json({ data: record });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/volume/batch - 批量新增量能记录
router.post('/batch', async (req, res) => {
  try {
    const { records } = req.body;
    const created = await VolumeHistory.bulkCreate(records);
    res.json({ data: created, count: created.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
