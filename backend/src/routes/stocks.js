const express = require('express');
const router = express.Router();
const axios = require('axios');
const { Stock } = require('../models');

// 股票代码 -> 新浪行情代码前缀映射
function getSinaPrefix(code) {
  if (code.startsWith('6')) return 'sh';
  if (code.startsWith('0') || code.startsWith('3')) return 'sz';
  if (code.startsWith('4') || code.startsWith('8') || code.startsWith('9')) return 'bj';
  return 'sh';
}

// GET /api/stocks/realtime - 获取实时行情（新浪财经）
router.get('/realtime', async (req, res) => {
  try {
    const { codes } = req.query;
    const stockCodes = codes ? codes.split(',').map(c => c.trim()) : [];
    if (stockCodes.length === 0) {
      return res.json({ data: [], source: 'sina' });
    }

    // 构造新浪行情代码列表
    const sinaCodes = stockCodes.map(code => getSinaPrefix(code) + code);
    const url = `http://hq.sinajs.cn/list=${sinaCodes.join(',')}`;

    const response = await axios.get(url, {
      headers: {
        Referer: 'https://finance.sina.com.cn',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      },
      timeout: 8000,
      responseType: 'text',
      responseEncoding: 'binary',
    });

    // 解析新浪行情数据
    // 格式: var hq_str_sh603138="名称,开盘价,昨收,当前价,最高,最低,...,日期,时间";
    const lines = response.data.split('\n').filter(l => l.trim());
    const resultMap = {};

    for (const line of lines) {
      const match = line.match(/var hq_str_(\w+)="(.*)"/);
      if (!match) continue;
      const sinaCode = match[1];
      const fields = match[2].split(',');
      if (fields.length < 32) continue;

      // 提取6位股票代码（去掉前缀）
      const code = sinaCode.substring(2);
      resultMap[code] = {
        code,
        name: fields[0],
        open: parseFloat(fields[1]) || 0,
        pre_close: parseFloat(fields[2]) || 0,
        current_price: parseFloat(fields[3]) || 0,
        high: parseFloat(fields[4]) || 0,
        low: parseFloat(fields[5]) || 0,
        volume: parseInt(fields[8]) || 0,        // 成交量（股）
        turnover: parseFloat(fields[9]) || 0,    // 成交额（元）
        date: fields[30],
        time: fields[31],
        change: parseFloat(fields[3]) - parseFloat(fields[2]),
        change_percent: parseFloat(fields[2]) > 0
          ? ((parseFloat(fields[3]) - parseFloat(fields[2])) / parseFloat(fields[2]) * 100).toFixed(2)
          : '0.00',
        timestamp: new Date().toISOString(),
      };
    }

    // 按请求顺序返回结果
    const data = stockCodes.map(code => resultMap[code]).filter(Boolean);
    res.json({ data, source: 'sina' });
  } catch (error) {
    console.error('获取实时行情失败:', error.message);
    res.status(500).json({ error: '获取实时行情失败: ' + error.message });
  }
});

// GET /api/stocks - 获取股票列表（默认仅上市股票，支持 ?status=DELISTED 查看退市）
router.get('/', async (req, res) => {
  try {
    const { search, page = 1, pageSize = 20, status = 'LISTED' } = req.query;
    const where = {};
    // 状态过滤：默认只查 LISTED，传 status=ALL 查全部，status=DELISTED 查退市
    if (status === 'ALL') {
      // 不过滤状态
    } else if (status === 'DELISTED') {
      where.list_status = 'DELISTED';
    } else {
      where.list_status = 'LISTED';
    }
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

// DELETE /api/stocks/:code - 删除股票（软删除：标记为退市，不物理删除）
router.delete('/:code', async (req, res) => {
  try {
    const stock = await Stock.findOne({ where: { code: req.params.code } });
    if (!stock) {
      return res.status(404).json({ error: '股票不存在' });
    }
    // 软删除：标记退市而非物理删除
    await stock.update({
      list_status: 'DELISTED',
      delist_date: new Date().toISOString().slice(0, 10),
      sync_date: new Date(),
    });
    res.json({ message: '已标记为退市', data: stock });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
