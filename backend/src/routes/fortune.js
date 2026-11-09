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

// POST /api/fortune/scan  { symbols:[code|{symbol,name}], date? } —— 立即返回 scanId，后台跑
router.post('/scan', async (req, res) => {
  try {
    const r = await fortune.startScan({ symbols: req.body.symbols, date: req.body.date });
    if (!r.ok) return fail(res, r);
    res.json({ ok: true, data: { scanId: r.scanId, total: r.total } });
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

// GET /api/fortune/score/:symbol?date= —— 单票按需重算（会拉行情，可能耗时；页面优先读落库评估）
router.get('/score/:symbol', async (req, res) => {
  try {
    const r = await fortune.scoreSingle({ symbol: req.params.symbol, date: req.query.date });
    if (!r.ok) return fail(res, r);
    res.json({ ok: true, data: r.data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
