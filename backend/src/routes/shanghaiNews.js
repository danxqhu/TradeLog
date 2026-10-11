const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { ShanghaiNews } = require('../models');

// GET /api/shanghai-news - 获取上海证券报新闻列表
router.get('/', async (req, res) => {
  try {
    const { date, start_date, end_date, page = 1, pageSize = 20 } = req.query;
    const where = {};
    if (date) where.publish_date = date;
    if (start_date && end_date) {
      where.publish_date = { [Op.between]: [start_date, end_date] };
    }

    const news = await ShanghaiNews.findAndCountAll({
      where,
      limit: parseInt(pageSize),
      offset: (parseInt(page) - 1) * parseInt(pageSize),
      order: [['publish_date', 'DESC']],
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
    const news = await ShanghaiNews.create(req.body);
    res.json({ data: news });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/shanghai-news/batch - 批量新增
router.post('/batch', async (req, res) => {
  try {
    const { records } = req.body;
    const created = await ShanghaiNews.bulkCreate(records);
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
