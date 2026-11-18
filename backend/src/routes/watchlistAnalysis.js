const express = require('express');
const router = express.Router();
const axios = require('axios');
const { Op } = require('sequelize');
const { WatchlistAnalysis, WatchlistKlinePeriod, Position, FortuneStock, FortuneEvaluation, MoneyChaseCandidate, MoneyChaseSnapshot } = require('../models');
const { addTradingDays } = require('../services/tradingDayService');

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

// 格式化 DATEONLY 字段为 YYYY-MM-DD
function fmtDate(v) {
  if (!v) return null;
  return typeof v === 'string' ? v : new Date(v).toISOString().split('T')[0];
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
    console.error('[自选股-实时行情] 获取失败:', error.message);
    return {};
  }
}

/**
 * 获取股票历史日K线（含开盘/最高/最低/收盘），日期 -> OHLC
 */
async function fetchOhlcMap(stockCode, startDate) {
  const sinaCode = getSinaPrefix(stockCode) + stockCode;
  const url = `http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${sinaCode}&scale=240&ma=no&datalen=120`;
  try {
    const response = await axios.get(url, {
      headers: {
        Referer: 'https://finance.sina.com.cn',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      },
      timeout: 10000,
    });
    if (!Array.isArray(response.data)) return new Map();
    const map = new Map();
    for (const item of response.data) {
      if (item.day >= startDate) {
        map.set(item.day, {
          open: parseFloat(item.open) || 0,
          high: parseFloat(item.high) || 0,
          low: parseFloat(item.low) || 0,
          close: parseFloat(item.close) || 0,
        });
      }
    }
    return map;
  } catch (error) {
    console.error('[自选股-OHLC] 获取失败:', error.message);
    return new Map();
  }
}

/**
 * 查找目标日期或之前最近的 K线（含 OHLC），向前回落至多 12 天
 */
function findClosestBar(ohlcMap, targetDate) {
  if (ohlcMap.has(targetDate)) return { date: targetDate, bar: ohlcMap.get(targetDate) };
  const d = new Date(targetDate);
  for (let i = 0; i < 12; i++) {
    d.setDate(d.getDate() - 1);
    const dateStr = d.toISOString().split('T')[0];
    if (ohlcMap.has(dateStr)) return { date: dateStr, bar: ohlcMap.get(dateStr) };
  }
  return null;
}

// 相对基准价的收益率（%），保留两位字符串
function retVs(price, base) {
  if (!price || !base) return null;
  return ((price - base) / base * 100).toFixed(2);
}

// 三价字段中文名（与详情页表头一致）
const KLINE_FIELD_NAMES = { open: '开盘价', high: '盘中最高价', close: '收盘价' };

// 不是真实板块名的占位值（人工自选/手动加入等）
const SECTOR_PLACEHOLDERS = new Set(['', '人工自选', '手动选择', '手动加入', '未知', 'null', 'None']);

// 按股票代码批量查真实板块（优先追资金板块成分，其次评估记录，最后股票池）
async function fetchSectorMap(codes) {
  const map = {};
  if (!codes.length) return map;
  const fill = (rows, keyField) => {
    for (const r of rows) {
      const v = r.sector;
      if (!v || SECTOR_PLACEHOLDERS.has(v)) continue;
      if (!map[r[keyField]]) map[r[keyField]] = v;
    }
  };
  try {
    const [candidates, evaluations, pool] = await Promise.all([
      MoneyChaseCandidate.findAll({ where: { symbol: { [Op.in]: codes } }, attributes: ['symbol', 'sector'], order: [['id', 'DESC']], raw: true }),
      FortuneEvaluation.findAll({ where: { symbol: { [Op.in]: codes } }, attributes: ['symbol', 'sector'], order: [['id', 'DESC']], raw: true }),
      FortuneStock.findAll({ where: { symbol: { [Op.in]: codes } }, attributes: ['symbol', 'sector'], raw: true }),
    ]);
    fill(candidates, 'symbol');
    fill(evaluations, 'symbol');
    fill(pool, 'symbol');
  } catch (error) {
    console.error('[自选股-板块] 查询失败:', error.message);
  }
  return map;
}

// GET /api/watchlist-analysis/sector-options - 板块候选（仅读库，供添加/编辑表单选择）
router.get('/sector-options', async (req, res) => {
  try {
    const counts = {};
    const bump = rows => {
      for (const r of rows) {
        const v = (r.sector || '').trim();
        if (!v || SECTOR_PLACEHOLDERS.has(v)) continue;
        counts[v] = (counts[v] || 0) + Number(r.n || 1);
      }
    };
    const [cand, snap, pool, own] = await Promise.all([
      MoneyChaseCandidate.findAll({ attributes: ['sector', [require('sequelize').fn('COUNT', 'id'), 'n']], group: ['sector'], raw: true }),
      MoneyChaseSnapshot.findAll({ attributes: ['sector', [require('sequelize').fn('COUNT', 'id'), 'n']], group: ['sector'], raw: true }),
      FortuneStock.findAll({ attributes: ['sector', [require('sequelize').fn('COUNT', 'id'), 'n']], group: ['sector'], raw: true }),
      WatchlistAnalysis.findAll({ attributes: ['sector', [require('sequelize').fn('COUNT', 'id'), 'n']], group: ['sector'], raw: true }),
    ]);
    bump(cand);
    bump(snap);
    bump(pool);
    bump(own);
    const list = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b, 'zh-CN'));
    res.json({ data: list });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/watchlist-analysis - 获取自选股列表
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

    let order;
    switch (sort) {
      case 'time_asc':
        order = [['recommend_date', 'ASC'], ['recommend_time', 'ASC']];
        break;
      default:
        order = [['recommend_date', 'DESC'], ['recommend_time', 'DESC']];
    }

    const results = await WatchlistAnalysis.findAndCountAll({
      where,
      limit: parseInt(pageSize),
      offset: (parseInt(page) - 1) * parseInt(pageSize),
      order,
    });

    // 持仓映射
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

    let rows = results.rows.map(r => {
      const obj = r.toJSON();
      const posList = posMap[r.stock_code] || [];
      obj.position = posList[0] || null;
      obj.position_count = posList.length;
      return obj;
    });

    // 同类型下历史加入次数
    if (rows.length > 0 && type) {
      const allRecs = await WatchlistAnalysis.findAll({ where: { type }, attributes: ['stock_code'], raw: true });
      const recCountMap = {};
      for (const r of allRecs) recCountMap[r.stock_code] = (recCountMap[r.stock_code] || 0) + 1;
      for (const row of rows) row.recommend_count = recCountMap[row.stock_code] || 1;
    } else {
      for (const row of rows) row.recommend_count = 1;
    }

    // 实时行情更新现价
    const stockCodes = [...new Set(rows.map(r => r.stock_code))];
    const priceMap = await fetchRealtimePrices(stockCodes);
    const updates = [];
    for (const row of rows) {
      const p = priceMap[row.stock_code];
      if (p && p.current_price > 0) {
        row.current_price = p.current_price;
        row.change_percent = p.change_percent;
        updates.push(WatchlistAnalysis.update({ current_price: p.current_price }, { where: { id: row.id } }));
      }
    }
    Promise.all(updates).catch(() => {});

    // 仅看持仓：过滤并按买入日期排序
    if (sort === 'position_asc' || sort === 'position_desc') {
      rows = rows.filter(r => r.position !== null);
      rows.sort((a, b) => sort === 'position_asc'
        ? a.position.buy_date.localeCompare(b.position.buy_date)
        : b.position.buy_date.localeCompare(a.position.buy_date));
    }

    // 板块回填
    const sectorMap = await fetchSectorMap([...new Set(rows.map(r => r.stock_code))]);

    // 最高收益：从已落库的周期缓存里取（不拉接口），在全部周期 × 三价中选收益率最高的一格
    const bestCellMap = {};
    const ids = rows.map(r => r.id);
    if (ids.length > 0) {
      const periodRows = await WatchlistKlinePeriod.findAll({
        where: { analysis_id: { [Op.in]: ids }, status: 'ok' },
        raw: true,
      });
      for (const pr of periodRows) {
        const cells = [
          ['open', pr.open_return, pr.open_price],
          ['high', pr.high_return, pr.high_price],
          ['close', pr.close_return, pr.close_price],
        ];
        for (const [field, ret, price] of cells) {
          if (ret === null || ret === undefined) continue;
          const cur = bestCellMap[pr.analysis_id];
          if (!cur || Number(ret) > Number(cur.return_rate)) {
            bestCellMap[pr.analysis_id] = {
              period_days: pr.period_days,
              field,
              field_name: KLINE_FIELD_NAMES[field],
              price,
              return_rate: ret,
              date: fmtDate(pr.actual_date),
            };
          }
        }
      }
    }
    for (const row of rows) {
      // 板块：人工填写优先，为空时从真实板块数据回填并落库（下次直接用）
      if (!row.sector) {
        const derived = sectorMap[row.stock_code] || '';
        row.sector = derived;
        if (derived) {
          WatchlistAnalysis.update({ sector: derived }, { where: { id: row.id } }).catch(() => {});
        }
      }
      row.best_cell = bestCellMap[row.id] || null;
    }

    res.json({ data: rows, total: results.count, page: parseInt(page), pageSize: parseInt(pageSize) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/watchlist-analysis/date-stats - 月份日期统计（自选股/统计）
router.get('/date-stats', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: '需要 startDate 和 endDate 参数' });
    }
    const results = await WatchlistAnalysis.findAll({
      attributes: ['recommend_date', 'type', [require('sequelize').fn('COUNT', 'id'), 'count']],
      where: { recommend_date: { [Op.between]: [startDate, endDate] } },
      group: ['recommend_date', 'type'],
      raw: true,
    });
    const stats = {};
    for (const r of results) {
      const date = fmtDate(r.recommend_date);
      if (!stats[date]) stats[date] = {};
      stats[date][r.type] = Number(r.count);
    }
    res.json({ data: stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/watchlist-analysis/:id - 获取详情
router.get('/:id', async (req, res) => {
  try {
    const analysis = await WatchlistAnalysis.findByPk(req.params.id);
    if (!analysis) {
      return res.status(404).json({ error: '自选股记录不存在' });
    }
    const detail = analysis.toJSON();
    // 板块未人工填写时，从真实板块数据回填（不落库，避免读接口写数据）
    if (!detail.sector) {
      detail.sector = (await fetchSectorMap([detail.stock_code]))[detail.stock_code] || '';
    }
    res.json({ data: detail });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/watchlist-analysis - 新增自选股
router.post('/', async (req, res) => {
  try {
    const { stock_code, stock_name, type, source, recommend_date, recommend_time, recommend_price, notes, reasons, sector } = req.body;
    const analysis = await WatchlistAnalysis.create({
      stock_code,
      stock_name,
      type,
      source: source || '自选股',
      recommend_date,
      recommend_time,
      recommend_price,
      current_price: recommend_price,
      notes,
      reasons: reasons || [],
      sector: (sector || '').trim(),
    });
    // 未填板块时，从真实板块数据自动回填一次（追资金板块成分 → 评估记录 → 股票池）
    if (!analysis.sector) {
      const derived = (await fetchSectorMap([stock_code]))[stock_code] || '';
      if (derived) await analysis.update({ sector: derived });
    }
    res.json({ data: analysis });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/watchlist-analysis/:id - 更新（加入价变动时清空K线缓存，下次读取重算）
router.put('/:id', async (req, res) => {
  try {
    const analysis = await WatchlistAnalysis.findByPk(req.params.id);
    if (!analysis) {
      return res.status(404).json({ error: '自选股记录不存在' });
    }
    const priceChanged = req.body.recommend_price !== undefined
      && Number(req.body.recommend_price) !== Number(analysis.recommend_price);
    await analysis.update(req.body);
    if (priceChanged) {
      await WatchlistKlinePeriod.destroy({ where: { analysis_id: analysis.id } });
      await analysis.update({ kline_refreshed_date: null });
    }
    res.json({ data: analysis });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/watchlist-analysis/:id - 删除（连带删除K线周期缓存）
router.delete('/:id', async (req, res) => {
  try {
    const analysis = await WatchlistAnalysis.findByPk(req.params.id);
    if (!analysis) {
      return res.status(404).json({ error: '自选股记录不存在' });
    }
    await WatchlistKlinePeriod.destroy({ where: { analysis_id: analysis.id } });
    await analysis.destroy();
    res.json({ message: '删除成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/watchlist-analysis/:id/kline-stats - 自选股详情收益率统计（按天缓存，落库）
 * 查询参数：
 *   days=1,2,3,4[,N]  需要展示的交易日周期（默认 1,2,3,4，始终包含 1-4）
 *   force=1           强制刷新（忽略当天缓存，重新拉一次接口）
 * 历史周期（目标日 < 今天）同一天最多打一次接口，隔天回看直接读库；
 * 但若存在目标日 = 今天的周期（即今天是交易日、当日日线仍在实时变动），
 * 则每次进入都重新拉取刷新，保证开盘后能拿到当天的开/高/低/收。
 */
router.get('/:id/kline-stats', async (req, res) => {
  try {
    const analysis = await WatchlistAnalysis.findByPk(req.params.id);
    if (!analysis) {
      return res.status(404).json({ error: '自选股记录不存在' });
    }

    const recommendDateStr = fmtDate(analysis.recommend_date);
    const base = Number(analysis.recommend_price);
    const today = getTodayCN();
    const force = req.query.force === '1';

    // 解析请求周期，始终并入默认 1-4
    let reqDays = String(req.query.days || '1,2,3,4')
      .split(',')
      .map(d => parseInt(d))
      .filter(d => Number.isInteger(d) && d > 0);
    if (!reqDays.length) reqDays = [1, 2, 3, 4];
    const allDays = [...new Set([...reqDays, 1, 2, 3, 4])].sort((a, b) => a - b);

    let periods = await WatchlistKlinePeriod.findAll({ where: { analysis_id: analysis.id } });
    const periodByDay = {};
    for (const p of periods) periodByDay[p.period_days] = p;

    // 是否存在"目标日 = 今天"的周期：只有今天是交易日才会算出这样的目标日，
    // 此时当日日线是"进行中的实时日K"，盘中开/高/低/收持续变化，不能沿用当天早前的缓存。
    const hasLiveTodayTarget = periods.some(p => fmtDate(p.target_date) === today);

    // 缓存命中：非强制 + 今天已刷新 + 所有请求周期均已存在 + 没有需要实时刷新的"今天"周期 -> 直接读库，不打接口
    const cacheFresh = !force
      && !!analysis.kline_refreshed_date
      && fmtDate(analysis.kline_refreshed_date) === today
      && allDays.every(d => periodByDay[d])
      && !hasLiveTodayTarget;

    if (!cacheFresh) {
      const ohlcMap = await fetchOhlcMap(analysis.stock_code, recommendDateStr);

      for (const d of allDays) {
        const targetDate = await addTradingDays(analysis.recommend_date, d);
        if (!targetDate) {
          await WatchlistKlinePeriod.upsert({
            analysis_id: analysis.id, period_days: d,
            target_date: null, base_price: base, status: 'nodata',
            open_price: null, high_price: null, close_price: null,
            open_return: null, high_return: null, close_return: null, actual_date: null,
          });
          continue;
        }
        const targetDateStr = fmtDate(targetDate);
        let payload;
        if (targetDateStr > today) {
          payload = { target_date: targetDateStr, status: 'pending', base_price: base };
        } else if (targetDateStr === today) {
          // 目标日=今天：只精确匹配今天的 K 线。
          // 开盘前或未生成当日日线时，绝不回落借用昨天数据（否则会把昨天 OHLC 标成今天）。
          // 等当日完整日线出现（新浪 scale=240 盘中为实时聚合、收盘后定型）后再纳入。
          if (ohlcMap.has(targetDateStr)) {
            const bar = ohlcMap.get(targetDateStr);
            const { open, high, close } = bar;
            payload = {
              target_date: targetDateStr, actual_date: targetDateStr, status: 'ok', base_price: base,
              open_price: open, high_price: high, close_price: close,
              open_return: retVs(open, base), high_return: retVs(high, base), close_return: retVs(close, base),
            };
          } else {
            payload = { target_date: targetDateStr, status: 'pending', base_price: base };
          }
        } else {
          const found = findClosestBar(ohlcMap, targetDateStr);
          if (!found) {
            payload = { target_date: targetDateStr, status: 'nodata', base_price: base };
          } else {
            const { open, high, close } = found.bar;
            payload = {
              target_date: targetDateStr, actual_date: found.date, status: 'ok', base_price: base,
              open_price: open, high_price: high, close_price: close,
              open_return: retVs(open, base), high_return: retVs(high, base), close_return: retVs(close, base),
            };
          }
        }
        await WatchlistKlinePeriod.upsert({
          analysis_id: analysis.id, period_days: d,
          target_date: payload.target_date || null,
          actual_date: payload.actual_date || null,
          base_price: payload.base_price ?? base,
          open_price: payload.open_price ?? null,
          high_price: payload.high_price ?? null,
          close_price: payload.close_price ?? null,
          open_return: payload.open_return ?? null,
          high_return: payload.high_return ?? null,
          close_return: payload.close_return ?? null,
          status: payload.status,
        });
      }

      // 区间极值：加入日后所有K线的最高收盘价 / 最高上影线
      let bestClose = null;
      let bestHigh = null;
      for (const [date, bar] of ohlcMap) {
        if (date <= recommendDateStr) continue;
        const closeRet = bar.close ? retVs(bar.close, base) : null;
        const highRet = bar.high ? retVs(bar.high, base) : null;
        if (closeRet !== null && (!bestClose || Number(closeRet) > Number(bestClose.return_rate))) {
          bestClose = { date, price: bar.close, return_rate: closeRet };
        }
        if (highRet !== null && (!bestHigh || Number(highRet) > Number(bestHigh.return_rate))) {
          bestHigh = { date, price: bar.high, return_rate: highRet };
        }
      }

      await analysis.update({
        best_close_date: bestClose ? bestClose.date : null,
        best_close_price: bestClose ? bestClose.price : null,
        best_close_return: bestClose ? bestClose.return_rate : null,
        best_high_date: bestHigh ? bestHigh.date : null,
        best_high_price: bestHigh ? bestHigh.price : null,
        best_high_return: bestHigh ? bestHigh.return_rate : null,
        kline_refreshed_date: today,
      });

      periods = await WatchlistKlinePeriod.findAll({ where: { analysis_id: analysis.id } });
      await analysis.reload();
    }

    // 组装响应
    const map = {};
    for (const p of periods) {
      if (p.status === 'ok') {
        map[p.period_days] = {
          target_date: fmtDate(p.target_date),
          actual_date: fmtDate(p.actual_date),
          due: true,
          available: true,
          open: { price: p.open_price == null ? null : Number(p.open_price), return_rate: p.open_return == null ? null : String(p.open_return) },
          high: { price: p.high_price == null ? null : Number(p.high_price), return_rate: p.high_return == null ? null : String(p.high_return) },
          close: { price: p.close_price == null ? null : Number(p.close_price), return_rate: p.close_return == null ? null : String(p.close_return) },
        };
      } else {
        map[p.period_days] = {
          target_date: fmtDate(p.target_date),
          due: p.status === 'pending',
          available: false,
        };
      }
    }

    const best = {
      best_close: analysis.best_close_price != null
        ? { date: fmtDate(analysis.best_close_date), price: Number(analysis.best_close_price), return_rate: analysis.best_close_return == null ? null : String(analysis.best_close_return) }
        : null,
      best_high: analysis.best_high_price != null
        ? { date: fmtDate(analysis.best_high_date), price: Number(analysis.best_high_price), return_rate: analysis.best_high_return == null ? null : String(analysis.best_high_return) }
        : null,
    };

    res.json({ data: map, recommend_price: base, best, refreshed_date: fmtDate(analysis.kline_refreshed_date) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
