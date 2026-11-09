/**
 * 每日追资金 —— 路由
 *
 * 约定：
 *   - 业务失败（接口限流、板块取不到、已有任务在跑）一律 HTTP 200 + { ok:false, error:"中文说明" }
 *     前端拿到就弹窗展示，人工决定何时重试；只有意外异常才 500
 *   - 所有耗时抓取都走后台异步批次，HTTP 立即返回 runId，前端轮询 /runs/:id/status
 */
const express = require('express');
const router = express.Router();
const moneyChase = require('../services/moneyChaseService');
const { reloadMoneyChaseSchedules } = require('../services/scheduler');

function fail(res, r, extra = {}) {
  return res.json({ ok: false, error: r.error || '执行失败', errorDetail: r.errorDetail || '', ...extra });
}

/** 板块 → 成分股 → 合并人工加减偏好（页面确认清单与"整板块直接跑"共用） */
async function resolveCandidates(sectors) {
  const r = await moneyChase.fetchConstituents(sectors);
  if (!r.ok) return r;
  const boards = (r.data && r.data.boards) || [];
  const flat = [];
  for (const b of boards) {
    for (const s of (b.stocks || [])) {
      flat.push({
        symbol: s.symbol, name: s.name, sector: b.sector,
        today_pct: s.today_pct, price: s.price, amount_yi: s.amount_yi,
        turnover: s.turnover, vol_ratio: s.vol_ratio, board: s.board, is_st: s.is_st,
      });
    }
  }
  const { merged, removed, added } = await moneyChase.applyStockPrefs(flat);
  return {
    ok: true,
    data: {
      ...r.data,
      stocks: flat,
      finalSymbols: merged.map(m => `${m.symbol}:${m.sector || '人工自选'}`),
      finalCount: merged.length,
      removedSymbols: removed,
      manualAdded: added,
    },
  };
}

// ==================== 板块资金流 ====================

// GET /api/money-chase/sectors?top=5 —— 行业板块资金流排行（今日 + 5 日）
router.get('/sectors', async (req, res) => {
  try {
    const r = await moneyChase.fetchSectors(req.query.top);
    if (!r.ok) return fail(res, r);
    res.json({ ok: true, data: r.data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/money-chase/constituents?sectors=机器人,军工 —— 板块成分股（涨幅降序）+ 人工加减后的最终清单
router.get('/constituents', async (req, res) => {
  try {
    const sectors = String(req.query.sectors || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!sectors.length) return res.json({ ok: false, error: '请先选择板块' });
    const r = await resolveCandidates(sectors);
    if (!r.ok) return fail(res, r);
    res.json({ ok: true, data: r.data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 人工加/减股票（跨批次继承） ====================

// GET /api/money-chase/manual-stocks
router.get('/manual-stocks', async (req, res) => {
  try {
    res.json({ data: await moneyChase.getManualStocks() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/money-chase/stocks/latest-scores?symbols=002913,600519 —— 每只票最新一条打分摘要（② 清单小字用，只查库）
router.get('/stocks/latest-scores', async (req, res) => {
  try {
    const symbols = String(req.query.symbols || '').split(',').map(s => s.trim()).filter(Boolean);
    res.json({ ok: true, data: await moneyChase.latestScores(symbols) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/money-chase/manual-stocks  { add:[{symbol,name,sector,note}], remove:[{symbol}], unreject:[{symbol}] }
// 加入后后台自动跑一遍单票分析（新浪 3 次请求、不重试）：不必再回页面点“开始筛选打分”就有分数
router.post('/manual-stocks', async (req, res) => {
  try {
    const list = await moneyChase.adjustManualStocks(req.body || {});
    const auto = Array.isArray(req.body.add) ? moneyChase.queueAutoAnalyze(req.body.add) : { queued: 0 };
    res.json({ ok: true, data: list, autoScored: auto });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 筛选批次 ====================

// POST /api/money-chase/run  { sectors:[名称], symbols:["600000:机器人"] } —— 不传 symbols 则后台先抓板块成分股（HTTP 不等）
router.post('/run', async (req, res) => {
  try {
    const sectors = Array.isArray(req.body.sectors)
      ? req.body.sectors.map(s => (typeof s === 'string' ? s : s.name)).filter(Boolean)
      : [];
    const symbols = Array.isArray(req.body.symbols) ? req.body.symbols.filter(Boolean) : [];

    if (!sectors.length && !symbols.length) {
      return res.json({ ok: false, error: '请先选择板块或候选股票' });
    }

    if (!symbols.length) {
      // 整板块直接跑：建 pending 批次后后台抓取，立即返回 runId 给前端轮询
      const r = await moneyChase.startRunWithPrefetch({
        names: sectors,
        sectorSource: 'fixed',
        triggeredBy: req.body.triggeredBy === 'cron' ? 'cron' : 'manual',
      });
      if (!r.ok) return fail(res, r);
      return res.json({ ok: true, data: { runId: r.runId, pending: true, note: '将先抓取板块成分股，进度在批次里实时刷新' } });
    }

    const r = await moneyChase.startRun({
      sectors: sectors.map(name => ({ name })),
      symbols,
      triggeredBy: req.body.triggeredBy === 'cron' ? 'cron' : 'manual',
      sectorSource: req.body.sectorSource || 'auto_top',
    });
    if (!r.ok) return fail(res, r);
    res.json({ ok: true, data: { runId: r.runId, candidateTotal: r.candidateTotal } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/money-chase/runs?date=2026-11-09&limit=30 —— 批次列表
router.get('/runs', async (req, res) => {
  try {
    const data = await moneyChase.listRuns({ date: req.query.date, limit: req.query.limit });
    res.json({ data, today: moneyChase.beijingIso().slice(0, 10) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/money-chase/runs/:id/status —— 进度轮询
router.get('/runs/:id/status', async (req, res) => {
  try {
    const data = await moneyChase.getRunStatus(req.params.id);
    if (!data) return res.json({ ok: false, error: '批次不存在' });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/money-chase/runs/:id/candidates?pool=A|B
router.get('/runs/:id/candidates', async (req, res) => {
  try {
    const data = await moneyChase.getCandidates(req.params.id, { pool: req.query.pool });
    res.json({ ok: true, data, highlight: await moneyChase.getHighlightThresholds() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/money-chase/candidates/:id/kline —— K 线大图 + 标注 + 指标明细
router.get('/candidates/:id/kline', async (req, res) => {
  try {
    const data = await moneyChase.getCandidateKline(req.params.id);
    if (!data) return res.json({ ok: false, error: '候选记录不存在' });
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/money-chase/stock/:symbol/analysis?sector=&force=1 —— 单只票具体分析（点股票名进入）
// 走脚本 --action analyze：新浪日线 + 新浪快照 + 新浪分时，各 1 次不重试；判定口径与批次打分完全一致
// 分析完自动落一行打分记录（当日单票分析批次），人工勾选/备注当场可保存
router.get('/stock/:symbol/analysis', async (req, res) => {
  try {
    const force = req.query.force === '1' || req.query.force === 'true';
    const r = await moneyChase.analyzeStock(req.params.symbol, { sector: req.query.sector, force });
    if (!r.ok) return fail(res, r);
    res.json({ ok: true, data: r.data, highlight: await moneyChase.getHighlightThresholds() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/money-chase/candidates/:id —— 人工勾选 / 备注 / 淘汰 / 选中
router.put('/candidates/:id', async (req, res) => {
  try {
    const r = await moneyChase.updateCandidate(req.params.id, {
      manualChecks: req.body.manual_checks || req.body.manualChecks,
      remark: req.body.remark,
      eliminated: req.body.eliminated,
      elimSource: req.body.elim_source || req.body.elimSource,
      picked: req.body.picked,
    });
    if (!r.ok) return fail(res, r);
    res.json({ ok: true, data: r.data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 定格快照（录入基准评估，与最新评估分开） ====================

// GET /api/money-chase/snapshots?symbol=002913 —— 该票全部快照摘要（时间倒序，带基准标记）
router.get('/snapshots', async (req, res) => {
  try {
    res.json({ ok: true, data: await moneyChase.listSnapshots(req.query.symbol) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/money-chase/snapshots { symbol, as_of_date, as_of_time?, overwrite?, set_baseline? } —— 按选定时间点生成定格快照
// 不传 as_of_time = 当日收盘定型口径（只请求 1 次日线）；传了 = 盘中口径，用分时还原当时临时 K（日线 1 + 分时 1~2）
// 均不重试；选定时刻超出新浪分时可取范围（约最近 7 个交易日）时直接回中文错误，不静默降级成收盘口径
// 多份并存：该时间点已有旧存档时先查库直接回 {conflict:true}（连接口都不请求），人工确认后带 overwrite=true 重发才覆盖；
// 默认不会抢基准（基准由人工调），只有该票原本没基准时才顶上
router.post('/snapshots', async (req, res) => {
  try {
    const r = await moneyChase.createSnapshot({
      symbol: req.body.symbol,
      as_of_date: req.body.as_of_date || req.body.date,
      as_of_time: req.body.as_of_time || req.body.time,
      sector: req.body.sector,
      name: req.body.name,
      overwrite: req.body.overwrite === true,
      setBaseline: req.body.set_baseline === true || req.body.setBaseline === true,
    });
    if (r.conflict) return res.json({ ok: false, conflict: true, error: r.error, data: r.data });
    if (!r.ok) return fail(res, r);
    res.json({ ok: true, data: r.data, replaced: r.replaced, is_baseline: r.is_baseline });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/money-chase/snapshots/:id —— 快照全文（含当时口径的 K 线与分时点）
router.get('/snapshots/:id', async (req, res) => {
  try {
    const s = await moneyChase.getSnapshot(req.params.id);
    if (!s) return res.status(404).json({ error: '快照不存在（可能已被删除）' });
    res.json({ ok: true, data: s });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/money-chase/snapshots/:id/baseline —— 把这份设为基准（页面默认展示它）
router.put('/snapshots/:id/baseline', async (req, res) => {
  try {
    const s = await moneyChase.setBaselineSnapshot(req.params.id);
    if (!s) return res.status(404).json({ error: '快照不存在（可能已被删除）' });
    res.json({ ok: true, data: s });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/money-chase/snapshots/:id —— 删掉一份快照（删的是基准时自动顶上最新一份）
router.delete('/snapshots/:id', async (req, res) => {
  try {
    const r = await moneyChase.deleteSnapshot(req.params.id);
    if (!r.ok) return fail(res, r);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 规则总表（页面全文展示 + 可编辑） ====================

// GET /api/money-chase/rules —— 规则全文（按分组），含文件版本与人工改动的键
router.get('/rules', async (req, res) => {
  try {
    res.json({ ok: true, data: await moneyChase.getRulesDoc() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/money-chase/rules  { items:[{key,value,enabled,points}] }
router.put('/rules', async (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) return res.json({ ok: false, error: '没有需要保存的规则项' });
    const data = await moneyChase.updateRules(items);
    res.json({ ok: true, data, count: data.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/money-chase/rules/reset  { key? } —— 恢复出厂值（不传 key 则重置全部被改过的项）
router.post('/rules/reset', async (req, res) => {
  try {
    const n = await moneyChase.resetRules(req.body.key);
    res.json({ ok: true, count: n });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/money-chase/rules/reseed —— 改了 config/money_chase_rules.json 后手动同步（人工改过的值不被覆盖）
router.post('/rules/reseed', async (req, res) => {
  try {
    const data = await moneyChase.seedRules();
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/money-chase/rules/effective —— 当前真正下发给脚本的参数与开关（排查"改了没生效"）
router.get('/rules/effective', async (req, res) => {
  try {
    res.json({ ok: true, data: await moneyChase.getEffectiveParams() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== 定时节点 ====================

// GET /api/money-chase/schedules
router.get('/schedules', async (req, res) => {
  try {
    res.json({ data: await moneyChase.listSchedules() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/money-chase/schedules  { time_hm, label, sector_source, top_n, fixed_sectors, enabled, trading_day_only }
router.post('/schedules', async (req, res) => {
  try {
    const r = await moneyChase.createSchedule(req.body || {});
    if (!r.ok) return fail(res, r);
    reloadMoneyChaseSchedules();
    res.json({ ok: true, data: r.data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/money-chase/schedules/:id
router.put('/schedules/:id', async (req, res) => {
  try {
    const r = await moneyChase.updateSchedule(req.params.id, req.body || {});
    if (!r.ok) return fail(res, r);
    reloadMoneyChaseSchedules();
    res.json({ ok: true, data: r.data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/money-chase/schedules/:id
router.delete('/schedules/:id', async (req, res) => {
  try {
    const r = await moneyChase.deleteSchedule(req.params.id);
    reloadMoneyChaseSchedules();
    res.json({ ok: r.ok, error: r.ok ? undefined : '配置不存在' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/money-chase/schedules/:id/trigger —— 按该配置立即跑一次（验证配置用）
router.post('/schedules/:id/trigger', async (req, res) => {
  try {
    const list = await moneyChase.listSchedules();
    const item = list.find(s => String(s.id) === String(req.params.id));
    if (!item) return res.json({ ok: false, error: '配置不存在' });
    const r = await moneyChase.autoRun(item);
    if (!r.ok) return fail(res, r, { runId: r.runId });
    res.json({ ok: true, data: { runId: r.runId } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
