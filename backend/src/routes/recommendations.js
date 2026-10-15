const express = require('express');
const router = express.Router();
const axios = require('axios');
const { Op } = require('sequelize');
const { Recommendation, RecommendationTracking, TradingCalendar, Position } = require('../models');
const { calculateTradingDays, addTradingDays } = require('../services/tradingDayService');

// 股票代码 -> 新浪行情代码前缀
function getSinaPrefix(code) {
  if (code.startsWith('6')) return 'sh';
  if (code.startsWith('0') || code.startsWith('3')) return 'sz';
  if (code.startsWith('4') || code.startsWith('8') || code.startsWith('9')) return 'bj';
  return 'sh';
}

// 获取当天日期（中国时区 UTC+8）
function getTodayCN() {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return now.toISOString().split('T')[0];
}

// 获取新浪实时价格（批量）
async function fetchRealtimePrices(stockCodes) {
  if (!stockCodes.length) return {};
  try {
    const sinaCodes = stockCodes.map(code => getSinaPrefix(code) + code);
    const url = `http://hq.sinajs.cn/list=${sinaCodes.join(',')}`;
    const response = await axios.get(url, {
      headers: { Referer: 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      timeout: 8000,
      responseType: 'text',
      responseEncoding: 'binary',
    });
    const lines = response.data.split('\n').filter(l => l.trim());
    const result = {};
    for (const line of lines) {
      const match = line.match(/var hq_str_(\w+)="(.*)"/);
      if (!match) continue;
      const fields = match[2].split(',');
      if (fields.length < 32) continue;
      const code = match[1].substring(2);
      result[code] = {
        current_price: parseFloat(fields[3]) || 0,
        pre_close: parseFloat(fields[2]) || 0,
        change_percent: parseFloat(fields[2]) > 0
          ? ((parseFloat(fields[3]) - parseFloat(fields[2])) / parseFloat(fields[2]) * 100).toFixed(2)
          : '0.00',
      };
    }
    return result;
  } catch (error) {
    console.error('[实时行情] 获取失败:', error.message);
    return {};
  }
}

/**
 * 获取单只股票实时数据（当前价 + 盘中最高价）
 */
async function fetchRealtimeData(stockCode) {
  try {
    const sinaCode = getSinaPrefix(stockCode) + stockCode;
    const url = `http://hq.sinajs.cn/list=${sinaCode}`;
    const response = await axios.get(url, {
      headers: { Referer: 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      timeout: 8000,
      responseType: 'text',
      responseEncoding: 'binary',
    });
    const match = response.data.match(/var hq_str_\w+="(.*)"/);
    if (!match) return null;
    const fields = match[1].split(',');
    if (fields.length < 32) return null;
    return {
      current_price: parseFloat(fields[3]) || 0,
      high: parseFloat(fields[4]) || 0,
    };
  } catch (error) {
    console.error('[实时行情] 单只获取失败:', error.message);
    return null;
  }
}

/**
 * 获取股票历史日K线收盘价
 * @param {string} stockCode - 6位股票代码
 * @param {string} startDate - 开始日期 YYYY-MM-DD
 * @returns {Promise<Map<string, number>>} 日期 -> 收盘价 的 Map
 */
async function fetchHistoricalPrices(stockCode, startDate) {
  const sinaCode = getSinaPrefix(stockCode) + stockCode;
  // 多取一些数据，确保覆盖推荐日期
  const url = `http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaCode}&scale=240&ma=no&datalen=120`;

  try {
    const response = await axios.get(url, {
      headers: {
        Referer: 'https://finance.sina.com.cn',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      },
      timeout: 10000,
    });

    if (!Array.isArray(response.data)) {
      console.warn('K线数据格式异常:', typeof response.data);
      return new Map();
    }

    // 返回格式: [{day: "2026-09-29", open: "14.920", high: "15.300", low: "14.680", close: "15.100", volume: "18062270"}]
    const priceMap = new Map();
    for (const item of response.data) {
      if (item.day >= startDate && item.close) {
        priceMap.set(item.day, parseFloat(item.close));
      }
    }
    return priceMap;
  } catch (error) {
    console.error('获取历史K线失败:', error.message);
    return new Map();
  }
}

/**
 * 查找目标日期或之前最近的收盘价
 * @param {Map} priceMap - 日期->收盘价
 * @param {string} targetDate - 目标日期 YYYY-MM-DD
 * @returns {number|null} 收盘价或 null
 */
function findClosestPrice(priceMap, targetDate) {
  // 先精确匹配
  if (priceMap.has(targetDate)) {
    return priceMap.get(targetDate);
  }
  // 向前查找最近 10 天
  const d = new Date(targetDate);
  for (let i = 0; i < 10; i++) {
    d.setDate(d.getDate() - 1);
    const dateStr = d.toISOString().split('T')[0];
    if (priceMap.has(dateStr)) {
      return priceMap.get(dateStr);
    }
  }
  return null;
}

// GET /api/recommendations - 获取推荐列表
router.get('/', async (req, res) => {
  try {
    const { type, source, date, startDate, endDate, search, page = 1, pageSize = 50, sort = 'time_desc' } = req.query;
    const where = {};
    if (type) where.type = type;
    if (source) where.source = source;
    if (date) where.recommend_date = date;
    if (startDate && endDate) {
      where.recommend_date = { [Op.between]: [startDate, endDate] };
    }
    if (search) {
      where[Op.or] = [
        { stock_code: { [Op.like]: `%${search}%` } },
        { stock_name: { [Op.like]: `%${search}%` } },
      ];
    }

    // 排序规则
    let order;
    switch (sort) {
      case 'time_asc':
        order = [['recommend_date', 'ASC'], ['recommend_time', 'ASC']];
        break;
      default: // time_desc
        order = [['recommend_date', 'DESC'], ['recommend_time', 'DESC']];
    }

    const recommendations = await Recommendation.findAndCountAll({
      where,
      include: [{ model: RecommendationTracking, as: 'trackings' }],
      limit: parseInt(pageSize),
      offset: (parseInt(page) - 1) * parseInt(pageSize),
      order,
    });

    // 查询所有持仓中的持仓，按 stock_code 映射
    const positions = await Position.findAll({
      where: { status: 'holding' },
      attributes: ['stock_code', 'buy_date', 'buy_price', 'quantity', 'avg_cost'],
      raw: true,
    });
    const posMap = {};
    for (const p of positions) {
      if (!posMap[p.stock_code]) posMap[p.stock_code] = [];
      posMap[p.stock_code].push(p);
    }

    // 将持仓信息附加到推荐记录
    let rows = recommendations.rows.map(r => {
      const obj = r.toJSON();
      const posList = posMap[r.stock_code] || [];
      obj.position = posList[0] || null; // 取第一个持仓
      obj.position_count = posList.length;
      return obj;
    });

    // 统计每只股票在同类型下的历史推荐总次数
    if (rows.length > 0 && type) {
      const allRecs = await Recommendation.findAll({
        where: { type },
        attributes: ['stock_code'],
        raw: true,
      });
      const recCountMap = {};
      for (const r of allRecs) {
        recCountMap[r.stock_code] = (recCountMap[r.stock_code] || 0) + 1;
      }
      for (const row of rows) {
        row.recommend_count = recCountMap[row.stock_code] || 1;
      }
    } else {
      for (const row of rows) {
        row.recommend_count = 1;
      }
    }

    // 拉取实时行情，更新 current_price
    const stockCodes = [...new Set(rows.map(r => r.stock_code))];
    const priceMap = await fetchRealtimePrices(stockCodes);
    const updates = [];
    for (const row of rows) {
      const p = priceMap[row.stock_code];
      if (p && p.current_price > 0) {
        row.current_price = p.current_price;
        row.change_percent = p.change_percent;
        // 后台静默更新数据库中的 current_price
        updates.push(
          Recommendation.update(
            { current_price: p.current_price },
            { where: { id: row.id } }
          )
        );
      }
    }
    Promise.all(updates).catch(() => {}); // 不阻塞响应

    // 持仓排序：仅显示有持仓的股票，按买入日期排序
    if (sort === 'position_asc' || sort === 'position_desc') {
      rows = rows.filter(r => r.position !== null);
      rows.sort((a, b) => {
        if (sort === 'position_asc') {
          return a.position.buy_date.localeCompare(b.position.buy_date);
        } else {
          return b.position.buy_date.localeCompare(a.position.buy_date);
        }
      });
    }

    res.json({
      data: rows,
      total: recommendations.count,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/recommendations/date-stats - 获取月份推荐日期统计（早盘/午盘）
router.get('/date-stats', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: '需要 startDate 和 endDate 参数' });
    }
    const results = await Recommendation.findAll({
      attributes: [
        'recommend_date',
        'type',
        [require('sequelize').fn('COUNT', 'id'), 'count'],
      ],
      where: {
        recommend_date: { [Op.between]: [startDate, endDate] },
      },
      group: ['recommend_date', 'type'],
      raw: true,
    });
    // 转换为 { 'YYYY-MM-DD': { morning: N, afternoon: N } }
    const stats = {};
    for (const r of results) {
      const date = typeof r.recommend_date === 'string'
        ? r.recommend_date
        : r.recommend_date.toISOString().split('T')[0];
      if (!stats[date]) stats[date] = {};
      stats[date][r.type] = Number(r.count);
    }
    res.json({ data: stats });
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
    const { stock_code, stock_name, type, source, recommend_date, recommend_time, recommend_price, notes, reasons } = req.body;
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
      reasons: reasons || [],
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

// GET /api/recommendations/:id/best-return - 获取推荐后最高收益率（收盘价 + 盘中上影线最高）
router.get('/:id/best-return', async (req, res) => {
  try {
    const recommendation = await Recommendation.findByPk(req.params.id);
    if (!recommendation) {
      return res.status(404).json({ error: '推荐记录不存在' });
    }

    const recommendDateStr = typeof recommendation.recommend_date === 'string'
      ? recommendation.recommend_date
      : recommendation.recommend_date.toISOString().split('T')[0];
    const today = getTodayCN();
    const sinaCode = getSinaPrefix(recommendation.stock_code) + recommendation.stock_code;
    const url = `http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaCode}&scale=240&ma=no&datalen=120`;
    const response = await axios.get(url, {
      headers: {
        Referer: 'https://finance.sina.com.cn',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      },
      timeout: 10000,
    });

    if (!Array.isArray(response.data) || response.data.length === 0) {
      // K线为空时，也尝试用实时数据补充
      const realtimeData = await fetchRealtimeData(recommendation.stock_code);
      if (realtimeData && recommendDateStr <= today) {
        const recommendPrice = Number(recommendation.recommend_price);
        const close = realtimeData.current_price;
        const high = realtimeData.high;
        const bestClose = close ? { date: today, price: close, return_rate: ((close - recommendPrice) / recommendPrice * 100).toFixed(2) } : null;
        const bestHigh = high ? { date: today, price: high, return_rate: ((high - recommendPrice) / recommendPrice * 100).toFixed(2) } : null;
        return res.json({ data: { best_close: bestClose, best_high: bestHigh } });
      }
      return res.json({ data: { best_close: null, best_high: null } });
    }

    const recommendPrice = Number(recommendation.recommend_price);
    let bestClose = null; // 收盘价最高
    let bestHigh = null;  // 盘中上影线最高

    for (const item of response.data) {
      if (item.day <= recommendDateStr) continue;
      const close = parseFloat(item.close);
      const high = parseFloat(item.high);
      if (!close || !high) continue;

      const closeReturn = ((close - recommendPrice) / recommendPrice * 100).toFixed(2);
      const highReturn = ((high - recommendPrice) / recommendPrice * 100).toFixed(2);

      if (!bestClose || Number(closeReturn) > Number(bestClose.return_rate)) {
        bestClose = { date: item.day, price: close, return_rate: closeReturn };
      }
      if (!bestHigh || Number(highReturn) > Number(bestHigh.return_rate)) {
        bestHigh = { date: item.day, price: high, return_rate: highReturn };
      }
    }

    // 补充当天实时数据：如果 K线未收录当天，用实时数据补充
    if (recommendDateStr <= today) {
      const realtimeData = await fetchRealtimeData(recommendation.stock_code);
      if (realtimeData) {
        const close = realtimeData.current_price;
        const high = realtimeData.high;
        if (close) {
          const closeReturn = ((close - recommendPrice) / recommendPrice * 100).toFixed(2);
          if (!bestClose || Number(closeReturn) > Number(bestClose.return_rate)) {
            bestClose = { date: today, price: close, return_rate: closeReturn };
          }
        }
        if (high) {
          const highReturn = ((high - recommendPrice) / recommendPrice * 100).toFixed(2);
          if (!bestHigh || Number(highReturn) > Number(bestHigh.return_rate)) {
            bestHigh = { date: today, price: high, return_rate: highReturn };
          }
        }
      }
    }

    res.json({ data: { best_close: bestClose, best_high: bestHigh } });
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

// POST /api/recommendations/:id/calculate-returns - 自动计算收益率（使用历史收盘价）
router.post('/:id/calculate-returns', async (req, res) => {
  try {
    const recommendation = await Recommendation.findByPk(req.params.id);
    if (!recommendation) {
      return res.status(404).json({ error: '推荐记录不存在' });
    }

    const { current_price } = req.body;
    const recommendDate = recommendation.recommend_date;
    const recommendDateStr = typeof recommendDate === 'string'
      ? recommendDate
      : recommendDate.toISOString().split('T')[0];
    const today = getTodayCN();

    // 获取历史K线收盘价数据
    let priceMap = await fetchHistoricalPrices(recommendation.stock_code, recommendDateStr);
    console.log(`[收益率] 股票=${recommendation.stock_code} ${recommendation.stock_name}, 推荐日期=${recommendDateStr}, 推荐价=${recommendation.recommend_price}, K线数据=${priceMap.size}条`);

    // 先更新当前价格
    await recommendation.update({ current_price });

    // 如果当天K线尚未被新浪API收录，用前端传入的 current_price 补充
    if (current_price && !priceMap.has(today)) {
      priceMap.set(today, parseFloat(current_price));
      console.log(`[收益率] 当日K线未收录，使用实时价格 ${current_price} 补充 ${today} 收盘价`);
    }

    // 先清除旧的周期跟踪记录（3d/7d/2w/1m），避免假数据残留
    await RecommendationTracking.destroy({
      where: {
        recommendation_id: recommendation.id,
        period_type: { [Op.in]: ['3d', '7d', '2w', '1m'] },
      },
    });

    const periods = [
      { type: '3d', days: 3 },
      { type: '7d', days: 7 },
      { type: '2w', days: 10 },
      { type: '1m', days: 22 },
    ];

    const results = [];
    for (const period of periods) {
      const targetDate = await addTradingDays(recommendDate, period.days);
      if (!targetDate) continue;

      const targetDateStr = typeof targetDate === 'string'
        ? targetDate
        : targetDate.toISOString().split('T')[0];

      // 只计算目标日期已到期的周期
      if (targetDateStr > today) continue;

      // 查找目标日期的收盘价
      const checkPrice = findClosestPrice(priceMap, targetDateStr);
      if (!checkPrice) continue;

      const tradingDays = await calculateTradingDays(recommendDate, targetDate);
      const returnRate = ((checkPrice - recommendation.recommend_price) / recommendation.recommend_price * 100).toFixed(2);

      const tracking = await RecommendationTracking.create({
        recommendation_id: recommendation.id,
        period_type: period.type,
        check_date: targetDate,
        check_price: checkPrice,
        return_rate: returnRate,
        trading_days_count: tradingDays,
      });
      console.log(`[收益率] ${period.type}: 目标日期=${targetDateStr}, 收盘价=${checkPrice}, 收益率=${returnRate}%`);
      results.push(tracking);
    }

    // 当前价格已在上面更新

    res.json({
      data: results,
      message: results.length > 0
        ? `收益率计算完成（已计算 ${results.length} 个到期周期，使用历史收盘价）`
        : `已更新当前价格 ¥${current_price}，各周期目标日期均未到期，到期后自动计算`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/recommendations/:id/calculate-custom - 自定义天数收益率计算（使用历史收盘价）
router.post('/:id/calculate-custom', async (req, res) => {
  try {
    const recommendation = await Recommendation.findByPk(req.params.id);
    if (!recommendation) {
      return res.status(404).json({ error: '推荐记录不存在' });
    }

    const { custom_days, current_price } = req.body;
    if (!custom_days || custom_days <= 0) {
      return res.status(400).json({ error: '请输入有效天数' });
    }

    const recommendDateStr = typeof recommendation.recommend_date === 'string'
      ? recommendation.recommend_date
      : recommendation.recommend_date.toISOString().split('T')[0];

    // 计算从推荐日期起 N 个交易日后的目标日期
    const targetDate = await addTradingDays(recommendation.recommend_date, custom_days);
    if (!targetDate) {
      return res.status(400).json({ error: '无法计算目标日期，请检查交易日历数据' });
    }

    const targetDateStr = typeof targetDate === 'string'
      ? targetDate
      : targetDate.toISOString().split('T')[0];
    const today = getTodayCN();

    if (targetDateStr > today) {
      return res.json({
        data: null,
        message: `推荐后 ${custom_days} 个交易日的目标日期为 ${targetDateStr}，还未到期`,
        target_date: targetDateStr,
      });
    }

    // 获取历史K线收盘价
    let priceMap = await fetchHistoricalPrices(recommendation.stock_code, recommendDateStr);

    // 如果当天K线尚未被新浪API收录，用前端传入的 current_price 补充
    if (current_price && !priceMap.has(today)) {
      priceMap.set(today, parseFloat(current_price));
    }

    const checkPrice = priceMap.size > 0 ? findClosestPrice(priceMap, targetDateStr) : null;

    if (!checkPrice) {
      return res.status(500).json({ error: '无法获取目标日期的收盘价' });
    }

    const tradingDays = await calculateTradingDays(recommendation.recommend_date, targetDate);
    const returnRate = ((checkPrice - recommendation.recommend_price) / recommendation.recommend_price * 100).toFixed(2);

    // 查找已有自定义周期记录，更新或新建
    let tracking = await RecommendationTracking.findOne({
      where: {
        recommendation_id: recommendation.id,
        period_type: 'custom',
        custom_days: parseInt(custom_days),
      },
    });
    if (tracking) {
      await tracking.update({ check_date: targetDate, check_price: checkPrice, return_rate: returnRate, trading_days_count: tradingDays });
    } else {
      tracking = await RecommendationTracking.create({
        recommendation_id: recommendation.id,
        period_type: 'custom',
        custom_days: parseInt(custom_days),
        check_date: targetDate,
        check_price: checkPrice,
        return_rate: returnRate,
        trading_days_count: tradingDays,
      });
    }

    console.log(`[自定义] ${custom_days}天: 目标日期=${targetDateStr}, 收盘价=${checkPrice}, 收益率=${returnRate}%`);

    // 更新当前价格
    await recommendation.update({ current_price });

    res.json({
      data: tracking,
      message: `自定义 ${custom_days} 个交易日收益率计算完成（目标日期 ${targetDateStr} 收盘价 ¥${checkPrice}）`,
      target_date: targetDateStr,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
