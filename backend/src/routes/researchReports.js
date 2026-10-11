const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { ResearchReport } = require('../models');

// GET /api/research-reports - 获取研报列表
router.get('/', async (req, res) => {
  try {
    const { source, start_date, end_date, page = 1, pageSize = 20 } = req.query;
    const where = {};
    if (source) where.source = source;
    if (start_date && end_date) {
      where.publish_date = { [Op.between]: [start_date, end_date] };
    }

    const reports = await ResearchReport.findAndCountAll({
      where,
      limit: parseInt(pageSize),
      offset: (parseInt(page) - 1) * parseInt(pageSize),
      order: [['publish_date', 'DESC']],
    });

    res.json({
      data: reports.rows,
      total: reports.count,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/research-reports/:id - 获取研报详情
router.get('/:id', async (req, res) => {
  try {
    const report = await ResearchReport.findByPk(req.params.id);
    if (!report) {
      return res.status(404).json({ error: '研报不存在' });
    }
    res.json({ data: report });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/research-reports - 新增研报
router.post('/', async (req, res) => {
  try {
    const report = await ResearchReport.create(req.body);
    res.json({ data: report });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/research-reports/batch - 批量新增
router.post('/batch', async (req, res) => {
  try {
    const { records } = req.body;
    const created = await ResearchReport.bulkCreate(records);
    res.json({ data: created, count: created.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/research-reports/:id - 更新研报
router.put('/:id', async (req, res) => {
  try {
    const report = await ResearchReport.findByPk(req.params.id);
    if (!report) {
      return res.status(404).json({ error: '研报不存在' });
    }
    await report.update(req.body);
    res.json({ data: report });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/research-reports/:id - 删除研报
router.delete('/:id', async (req, res) => {
  try {
    const report = await ResearchReport.findByPk(req.params.id);
    if (!report) {
      return res.status(404).json({ error: '研报不存在' });
    }
    await report.destroy();
    res.json({ message: '删除成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
