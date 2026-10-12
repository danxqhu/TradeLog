const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { ResearchReport } = require('../models');
const gsScraperService = require('../services/gsScraperService');

// GET /api/research-reports/dates - 获取有数据的日期列表
router.get('/dates', async (req, res) => {
  try {
    const { label } = req.query;
    const where = {};
    if (label) where.label = label;
    
    const results = await ResearchReport.findAll({
      where,
      attributes: [[require('sequelize').fn('DISTINCT', require('sequelize').col('publish_date')), 'date']],
      raw: true,
      order: [['publish_date', 'DESC']],
    });
    res.json({ data: results.map(r => r.date) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/research-reports - 获取研报列表
router.get('/', async (req, res) => {
  try {
    const { source, label, analyst, date, start_date, end_date, page = 1, pageSize = 20 } = req.query;
    const where = {};
    if (source) where.source = source;
    if (label) where.label = label;
    if (analyst) where.analyst = { [Op.like]: `%${analyst}%` };
    if (date) where.publish_date = date;
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

// POST /api/research-reports/scrape - 触发抓取
router.post('/scrape', async (req, res) => {
  try {
    const { tier = 'all' } = req.body;
    console.log(`[API] 手动触发高盛研报抓取 (tier=${tier})`);
    const result = await gsScraperService.scrapeAndSaveReports({ tier });
    res.json({
      success: true,
      message: `抓取完成：新增 ${result.created} 篇，重复 ${result.skipped} 篇，过滤 ${result.ignored} 篇`,
      ...result,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/research-reports/import-history - 导入历史数据
router.post('/import-history', async (req, res) => {
  try {
    console.log('[API] 导入高盛研报历史数据...');
    const result = await gsScraperService.importHistoricalData();
    res.json({
      success: true,
      message: `历史数据导入完成：新增 ${result.created} 篇，跳过 ${result.skipped} 篇`,
      ...result,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
