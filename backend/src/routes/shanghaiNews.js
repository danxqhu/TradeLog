const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { ShanghaiNews } = require('../models');
const scraperService = require('../services/scraperService');
const { refreshDictionary, getDictInfo } = require('../services/stockDictionary');

// POST /api/shanghai-news/refresh-stocks - 从新浪拉取全市场股票词典
router.post('/refresh-stocks', async (req, res) => {
  try {
    const result = await refreshDictionary();
    res.json(result);
  } catch (error) {
    console.error('刷新股票词典失败:', error.message);
    res.status(500).json({ success: false, error: '刷新失败: ' + error.message });
  }
});

// GET /api/shanghai-news/stock-dict - 获取词典信息
router.get('/stock-dict', async (req, res) => {
  res.json(getDictInfo());
});

// POST /api/shanghai-news/scrape - 触发抓取（支持 ?date=YYYY-MM-DD）
router.post('/scrape', async (req, res) => {
  try {
    const targetDate = req.query.date || req.body?.date || null;
    const result = await scraperService.scrapeAndSave(targetDate);
    let msg = `抓取完成：新增 ${result.created} 篇`;
    if (result.replaced > 0) msg += `，替换旧数据 ${result.replaced} 篇`;
    if (result.skipped > 0) msg += `，跳过 ${result.skipped} 篇（重复）`;
    if (result.cleaned > 0) msg += `，清理无关文章 ${result.cleaned} 篇`;
    res.json({
      success: true,
      message: msg,
      ...result,
    });
  } catch (error) {
    console.error('抓取失败:', error.message);
    res.status(500).json({ error: '抓取失败: ' + error.message });
  }
});

// POST /api/shanghai-news/rescan - 重新扫描已有文章的股票识别
router.post('/rescan', async (req, res) => {
  try {
    const { date } = req.query;
    const result = await scraperService.rescanStocks(date);
    res.json({
      success: true,
      message: `扫描完成：${result.total} 篇文章，${result.updated} 篇更新了股票信息`,
      ...result,
    });
  } catch (error) {
    console.error('重新扫描失败:', error.message);
    res.status(500).json({ error: '扫描失败: ' + error.message });
  }
});

// GET /api/shanghai-news/dates - 获取有记录的日期列表
router.get('/dates', async (req, res) => {
  try {
    const dates = await ShanghaiNews.findAll({
      attributes: [
        [ShanghaiNews.sequelize.fn('DISTINCT', ShanghaiNews.sequelize.col('publish_date')), 'date'],
      ],
      raw: true,
      order: [['publish_date', 'DESC']],
    });
    res.json({ data: dates.map(d => d.date) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/shanghai-news - 获取新闻列表（支持按日期查询）
router.get('/', async (req, res) => {
  try {
    // 查询前自动清理一次脏数据（确保用户看到干净结果）
    try {
      await scraperService.cleanupNonEPaper();
    } catch (e) {
      // 清理失败不影响查询
    }

    const { date, start_date, end_date, page = 1, pageSize = 50 } = req.query;
    const where = {};
    if (date) where.publish_date = date;
    if (start_date && end_date) {
      where.publish_date = { [Op.between]: [start_date, end_date] };
    }

    const news = await ShanghaiNews.findAndCountAll({
      where,
      limit: parseInt(pageSize),
      offset: (parseInt(page) - 1) * parseInt(pageSize),
      order: [
        ['publish_date', 'DESC'],
        ['sort_order', 'ASC'],
      ],
    });

    res.json({
      data: news.rows,
      total: news.count,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/shanghai-news/:id - 获取新闻详情
router.get('/:id', async (req, res) => {
  try {
    const news = await ShanghaiNews.findByPk(req.params.id);
    if (!news) {
      return res.status(404).json({ error: '新闻不存在' });
    }
    res.json({ data: news });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/shanghai-news - 新增新闻记录
router.post('/', async (req, res) => {
  try {
    const [record, created] = await ShanghaiNews.findOrCreate({
      where: {
        publish_date: req.body.publish_date,
        title: req.body.title,
      },
      defaults: req.body,
    });
    res.json({ data: record, created });
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      res.json({ data: null, created: false, message: '已存在' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// POST /api/shanghai-news/batch - 批量新增
router.post('/batch', async (req, res) => {
  try {
    const { records } = req.body;
    const created = await ShanghaiNews.bulkCreate(records, {
      ignoreDuplicates: true,
    });
    res.json({ data: created, count: created.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/shanghai-news/:id - 更新新闻
router.put('/:id', async (req, res) => {
  try {
    const news = await ShanghaiNews.findByPk(req.params.id);
    if (!news) {
      return res.status(404).json({ error: '新闻不存在' });
    }
    await news.update(req.body);
    res.json({ data: news });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/shanghai-news/:id - 删除新闻
router.delete('/:id', async (req, res) => {
  try {
    const news = await ShanghaiNews.findByPk(req.params.id);
    if (!news) {
      return res.status(404).json({ error: '新闻不存在' });
    }
    await news.destroy();
    res.json({ message: '删除成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
