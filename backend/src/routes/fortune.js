/**
 * 胡胖胖招财进宝 —— 路由
 *
 * 约定与追资金一致：业务失败返回 HTTP 200 + { ok:false, error:'中文说明' }，意外异常才 500。
 */
const express = require('express');
const router = express.Router();
const fortune = require('../services/fortuneService');

function fail(res, r, extra = {}) {
  return res.json({ ok: false, error: r.error || '执行失败', ...extra });
}

// ==================== 判定项 ====================

// GET /api/fortune/criteria —— 判定项全文 + 权重 + 分档 + 公式
router.get('/criteria', async (req, res) => {
  try {
    res.json({ ok: true, data: await fortune.getCriteriaDoc() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/fortune/criteria  { items:[{code,name,weight,enabled,type,items}] }
router.put('/criteria', async (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) return res.json({ ok: false, error: '没有需要保存的判定项' });
    const data = await fortune.updateCriteria(items);
    res.json({ ok: true, data, doc: await fortune.getCriteriaDoc() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/fortune/criteria/reset  { code? } —— 恢复出厂并重播种
router.post('/criteria/reset', async (req, res) => {
  try {
    const result = await fortune.resetCriteria(req.body.code);
    res.json({ ok: true, data: result, doc: await fortune.getCriteriaDoc() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 衰竭止盈（W）/ 超跌反转（B）配置：阈值/归一模式/综合分参数/等级分档/筹码限流 ====================

// PUT /api/fortune/sell-config  { sellParams?, sellScoring?, openValue?, sellBands?, reversalParams?, reversalScoring?, reversalBands?, chip? } —— 写 SystemConfig 覆盖
router.put('/sell-config', async (req, res) => {
  try {
    const body = req.body || {};
    const patch = {};
    for (const k of ['sellParams', 'sellScoring', 'openValue', 'reversalParams', 'reversalScoring', 'chip']) {
      if (body[k] !== undefined) {
        if (body[k] === null || typeof body[k] !== 'object' || Array.isArray(body[k])) {
          return res.json({ ok: false, error: `${k} 需为对象` });
        }
        patch[k] = body[k];
      }
    }
    for (const k of ['sellBands', 'reversalBands']) {
      if (body[k] !== undefined) {
        if (!Array.isArray(body[k]) || !body[k].length) {
          return res.json({ ok: false, error: `${k} 需为非空数组` });
        }
        patch[k] = body[k];
      }
    }
    if (!Object.keys(patch).length) return res.json({ ok: false, error: '没有需要保存的配置项' });
    const data = await fortune.saveSellConfig(patch);
    res.json({ ok: true, data, doc: await fortune.getCriteriaDoc() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/fortune/sell-config/reset —— 清除覆盖（含反转阈值/筹码参数），回到 fortune_criteria.json 默认
router.post('/sell-config/reset', async (req, res) => {
  try {
    const data = await fortune.resetSellConfig();
    res.json({ ok: true, data, doc: await fortune.getCriteriaDoc() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 评分预览（不落库，页面实时算总分/分档用） ====================

// POST /api/fortune/preview  { criterion_scores:{code:{score|checked}} }
router.post('/preview', async (req, res) => {
  try {
    const active = await fortune.getCriteriaDoc();
    const result = await fortune.computeScore(req.body.criterion_scores || {}, active.criteria.filter(c => c.enabled));
    const band = fortune.resolveBand(result.total, active.bands);
    res.json({ ok: true, data: { ...result, band } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 评估记录 ====================

// POST /api/fortune/evaluate { symbol,name,sector,eval_date,criterion_scores,buy_point,sell_plan,note }
router.post('/evaluate', async (req, res) => {
  try {
    const r = await fortune.saveEvaluation(req.body || {});
    if (!r.ok) return fail(res, r);
    res.json({ ok: true, data: r.data, band: r.band, weightSum: r.weightSum, details: r.details });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/fortune/evaluations?symbol=&date=&start=&end= —— 复盘列表
router.get('/evaluations', async (req, res) => {
  try {
    const data = await fortune.listEvaluations({
      symbol: req.query.symbol, date: req.query.date,
      start: req.query.start, end: req.query.end, limit: req.query.limit,
    });
    res.json({ ok: true, data, today: fortune.bizDate() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/fortune/evaluations/:id
router.get('/evaluations/:id', async (req, res) => {
  try {
    const data = await fortune.getEvaluation(req.params.id);
    if (!data) return res.json({ ok: false, error: '评估记录不存在' });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/fortune/evaluations/:id
router.delete('/evaluations/:id', async (req, res) => {
  try {
    const r = await fortune.deleteEvaluation(req.params.id);
    if (!r.ok) return fail(res, { error: '评估记录不存在（可能已删除）' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/fortune/evaluation-dates?start=&end= —— 有评分记录的日期清单（日历圆点：只数随增删实时变）
router.get('/evaluation-dates', async (req, res) => {
  try {
    const data = await fortune.listEvaluationDates({ start: req.query.start, end: req.query.end });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 股票池 ====================

// GET /api/fortune/stocks
router.get('/stocks', async (req, res) => {
  try {
    res.json({ ok: true, data: await fortune.listStocks() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/fortune/stocks  { symbol,name,sector,info,note } —— 手动录入（重复代码就地更新）
router.post('/stocks', async (req, res) => {
  try {
    const r = await fortune.addStock(req.body || {});
    if (!r.ok) return fail(res, r);
    res.json({ ok: true, updated: r.updated, notFound: r.notFound, data: r.data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/fortune/stocks/clear —— 清空股票池（新的一天重来，不影响已存评估）
router.post('/stocks/clear', async (req, res) => {
  try {
    const r = await fortune.clearStocks();
    res.json({ ok: true, data: r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/fortune/stocks/batch  { items: [{symbol,name?,sector?}] } —— 批量加入股票池
router.post('/stocks/batch', async (req, res) => {
  try {
    const r = await fortune.addStocks(req.body.items);
    if (!r.ok) return fail(res, r);
    res.json({ ok: true, data: r.data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/fortune/stocks/:symbol
router.delete('/stocks/:symbol', async (req, res) => {
  try {
    const r = await fortune.removeStock(req.params.symbol);
    if (!r.ok) return fail(res, r);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 批量自动打分 ====================

/**
 * POST /api/fortune/scan  { symbols:[code|{symbol,name}], date?, select? }
 *  默认走两级：粗筛（≤chip.batch_max_pre_filter，不请求筹码）→ 精选筹码轮（≤chip.select_max_chip，串行 --with-chip）
 *  select=true 时只跑精选轮（榜单勾选/详情页「补筹码重算」）；上限校验交给服务层按生效配置判定
 */
router.post('/scan', async (req, res) => {
  try {
    const r = await fortune.startScan({ symbols: req.body.symbols, date: req.body.date, select: !!req.body.select });
    if (!r.ok) return fail(res, r);
    res.json({ ok: true, data: { scanId: r.scanId, total: r.total, stage: r.stage, kind: r.stage } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/fortune/scan/select  { symbols, date? } —— 单独发起精选筹码轮（B7 用真实接口补分）
router.post('/scan/select', async (req, res) => {
  try {
    const r = await fortune.startScan({ symbols: req.body.symbols, date: req.body.date, select: true });
    if (!r.ok) return fail(res, r);
    res.json({ ok: true, data: { scanId: r.scanId, total: r.total, stage: r.stage, kind: 'select' } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/fortune/scan/:scanId —— 轮询进度与排序结果
router.get('/scan/:scanId', async (req, res) => {
  try {
    const r = fortune.getScanStatus(req.params.scanId);
    if (!r.ok) return fail(res, r);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/fortune/leaderboard?date= —— 读已落库榜单（0 外部请求，页面秒开）
router.get('/leaderboard', async (req, res) => {
  try {
    const data = await fortune.listEvaluationsForDate(req.query.date);
    res.json({ ok: true, data, today: fortune.bizDate() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/fortune/score/:symbol?date=&with_chip=1 —— 单票按需重算（会拉行情，可能耗时；页面优先读落库评估）
//  with_chip=1/true：额外请求真实筹码接口补 B7（历史时间点后端会强制忽略）
router.get('/score/:symbol', async (req, res) => {
  try {
    const q = String(req.query.with_chip || '').toLowerCase();
    const withChip = q === '1' || q === 'true' || q === 'yes';
    const r = await fortune.scoreSingle({ symbol: req.params.symbol, date: req.query.date, withChip });
    if (!r.ok) return fail(res, r);
    res.json({ ok: true, data: r.data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
