/**
 * 胡胖胖招财进宝 —— 服务层
 *
 * 职责：
 *   1. 判定项真源：config/fortune_criteria.json →（启动播种）→ fortune_criteria 表
 *      页面改过的行 is_custom=true 不被文件覆盖；权重/子项/开关以库为准。
 *   2. 加权评分：总分 = Σ(判定项得分[0-100] × 权重%)，按分档自动归类。
 *      —— 每项得分可由勾选子项自动折算（勾选分值/全部分值×100），也可人工直接覆盖分数。
 *   3. 评估记录落库（每票每日一行，可复盘对比）；股票池手动增删。
 *
 * 与「每日追资金」完全独立，不复用其表；仅在前端复盘图时共用 KlineChart 组件与追资金行情接口。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { Op } = require('sequelize');
const {
  FortuneCriterion, FortuneStock, FortuneEvaluation, Stock,
} = require('../models');
const marketDataService = require('./marketDataService');

const CONFIG_PATH = path.join(__dirname, '../../config/fortune_criteria.json');
// 复用追资金的取数/指标流水线（只读调用，不改其打分逻辑）；临时参数/结果文件放系统临时目录，避免 nodemon 误重启
const PY_SCRIPT = path.join(__dirname, '../../scripts/fetch_money_chase.py');
const SCRATCH_DIR = path.join(os.tmpdir(), 'tradelog-fortune');

// 批量扫描的内存任务态（进度节流，完成后保留一段时间供轮询）
const activeScans = new Map();
const SCAN_TTL_MS = 10 * 60 * 1000;

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (e) {
    console.error('⚠️ [招财进宝] 判定项配置缺失或无法解析:', CONFIG_PATH, e.message);
    return null;
  }
}

function bizDate(d = marketDataService.getBeijingTime()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ==================== 判定项：播种 / 读取 / 更新 ====================

/**
 * 把配置文件播种进 fortune_criteria 表
 *  - 新增 code：插入
 *  - 已存在且 is_custom=false：跟随文件更新（name/type/weight/enabled/items/description）
 *  - 已存在且 is_custom=true：只补 description，不动人工改过的权重与子项
 */
async function seedCriteria() {
  const cfg = readConfig();
  if (!cfg) return { seeded: 0, error: '配置文件缺失' };
  const version = cfg.version || '0';
  const list = cfg.criteria || [];
  let inserted = 0;
  let updated = 0;
  const failed = [];
  let sort = 0;
  for (const c of list) {
    try {
      const row = {
        code: c.code, name: c.name, type: c.type || 'manual',
        weight: Number(c.weight) || 0, enabled: c.enabled !== false,
        items: c.items || [], description: c.desc || '',
        sort_order: ++sort, source_version: version,
      };
      const existed = await FortuneCriterion.findOne({ where: { code: c.code } });
      if (!existed) {
        await FortuneCriterion.create(row);
        inserted++;
      } else if (!existed.is_custom) {
        await existed.update(row);
        updated++;
      } else {
        // 人工改过：只跟随文件更新说明文案，保留权重与子项
        await existed.update({ description: row.description, source_version: version });
      }
    } catch (e) {
      failed.push({ code: c.code, error: e.message });
      console.error(`❌ [招财进宝] 判定项播种失败 ${c.code}: ${e.message}`);
    }
  }
  return { inserted, updated, version, total: list.length, failed };
}

/** 读取判定项全文 + 分档 + 公式（供页面渲染与评分） */
async function getCriteriaDoc() {
  const cfg = readConfig() || {};
  const rows = await FortuneCriterion.findAll({ order: [['sort_order', 'ASC'], ['id', 'ASC']] });
  const criteria = rows.map(r => ({
    code: r.code, name: r.name, type: r.type,
    weight: Number(r.weight), enabled: !!r.enabled,
    items: Array.isArray(r.items) ? r.items : [],
    description: r.description, isCustom: !!r.is_custom,
  }));
  const enabled = criteria.filter(c => c.enabled);
  return {
    version: cfg.version || '',
    title: cfg.title || '胡胖胖招财进宝',
    notice: cfg.notice || '',
    formula: cfg.formula || '',
    bands: cfg.bands || [],
    criteria,
    weightSum: Number(enabled.reduce((s, c) => s + c.weight, 0).toFixed(2)),
  };
}

/** 页面更新判定项（权重/开关/名称/子项），标 is_custom=true */
async function updateCriteria(items) {
  const out = [];
  for (const it of items || []) {
    if (!it || !it.code) continue;
    let row = await FortuneCriterion.findOne({ where: { code: it.code } });
    const patch = { is_custom: true };
    if (it.name !== undefined) patch.name = it.name;
    if (it.weight !== undefined) patch.weight = Number(it.weight) || 0;
    if (it.enabled !== undefined) patch.enabled = !!it.enabled;
    if (it.type !== undefined) patch.type = it.type;
    if (Array.isArray(it.items)) patch.items = it.items;
    if (!row) {
      // 允许前端新增判定项（自定义 code）
      row = await FortuneCriterion.create({
        code: it.code, name: it.name || it.code, type: it.type || 'manual',
        weight: Number(it.weight) || 0, enabled: it.enabled !== false,
        items: it.items || [], description: it.description || '',
        sort_order: (await FortuneCriterion.count()) + 1, source_version: 'custom', is_custom: true,
      });
    } else {
      await row.update(patch);
    }
    out.push({ code: row.code, weight: Number(row.weight), enabled: row.enabled });
  }
  return out;
}

/** 恢复出厂：删掉所有人工标记，重新按文件播种 */
async function resetCriteria(code) {
  if (code) {
    const row = await FortuneCriterion.findOne({ where: { code } });
    if (row) await row.update({ is_custom: false });
  } else {
    await FortuneCriterion.update({ is_custom: false }, { where: {} });
  }
  return seedCriteria();
}

// ==================== 评分核心 ====================

/** 子项分值折算成该项 0-100 分（勾选项分值 / 全部分值 ×100，负分风险项从满分扣减） */
function deriveScore(items, checkedIds) {
  const list = Array.isArray(items) ? items : [];
  const checked = new Set(Array.isArray(checkedIds) ? checkedIds : []);
  const positive = list.filter(x => (Number(x.points) || 0) > 0);
  const positiveMax = positive.reduce((s, x) => s + Number(x.points), 0);
  if (!positiveMax) return 0;
  let sum = 0;
  for (const x of list) {
    if (!checked.has(x.id)) continue;
    sum += Number(x.points) || 0;
  }
  return Math.max(0, Math.min(100, Math.round(sum / positiveMax * 100)));
}

/** 取当前启用判定项（评分用） */
async function loadActiveCriteria() {
  const rows = await FortuneCriterion.findAll({ where: { enabled: true }, order: [['sort_order', 'ASC']] });
  return rows.map(r => ({
    code: r.code, name: r.name, type: r.type,
    weight: Number(r.weight), items: Array.isArray(r.items) ? r.items : [],
  }));
}

/** 分档归类 */
function resolveBand(total, bands) {
  const list = bands && bands.length ? bands : (readConfig() || {}).bands || [];
  const hit = list.find(b => total >= Number(b.min) && total < Number(b.max));
  if (hit) return { code: hit.code, label: hit.label, color: hit.color, advice: hit.advice };
  const last = list[list.length - 1];
  return last ? { code: last.code, label: last.label, color: last.color, advice: last.advice } : { code: '', label: '', color: '#999', advice: '' };
}

/**
 * 计算加权总分：Σ(项得分 × 权重%)。
 * input criterionScores: { [code]: { score?, checked?[] } } —— 未给 score 时用 checked 折算。
 * 返回 { total, details:[{code,name,weight,score,weighted}], weightSum }
 */
async function computeScore(criterionScores = {}, criteria = null) {
  const active = criteria || await loadActiveCriteria();
  const details = [];
  let total = 0;
  for (const c of active) {
    const inObj = criterionScores[c.code] || {};
    const score = (inObj.score === null || inObj.score === undefined || inObj.score === '')
      ? deriveScore(c.items, inObj.checked)
      : Math.max(0, Math.min(100, Number(inObj.score) || 0));
    const weighted = Number((score * c.weight / 100).toFixed(2));
    total += weighted;
    details.push({ code: c.code, name: c.name, weight: c.weight, score, weighted });
  }
  const weightSum = Number(active.reduce((s, c) => s + c.weight, 0).toFixed(2));
  return { total: Number(total.toFixed(2)), details, weightSum };
}

// ==================== 评估记录 ====================

/** 保存/更新一条评估（每票每日一行，就地覆盖），落库前算总分与分档 */
async function saveEvaluation({ symbol, name, sector, eval_date, criterion_scores, buy_point, sell_plan, note } = {}) {
  const code = String(symbol || '').trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, error: '股票代码需为 6 位数字（例如 002913）。' };
  const date = String(eval_date || bizDate()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: '评估日期格式应为 YYYY-MM-DD。' };

  const active = await loadActiveCriteria();
  const cfg = readConfig() || {};
  const { total, details, weightSum } = await computeScore(criterion_scores || {}, active);
  const band = resolveBand(total, cfg.bands);

  // 归一化每项得分明细一并存（含折算后的 score，便于复盘还原）
  const normScores = {};
  for (const d of details) {
    const inObj = (criterion_scores || {})[d.code] || {};
    normScores[d.code] = {
      score: d.score,
      checked: Array.isArray(inObj.checked) ? inObj.checked : [],
      weight: d.weight,
      weighted: d.weighted,
    };
    // 自动判定：把子项 met/detail 明细一并存，第 2 页可直接还原（JSON 字段，无需改表）
    if (inObj.auto) normScores[d.code].auto = true;
    if (Array.isArray(inObj.items)) normScores[d.code].items = inObj.items;
    if (inObj.linkage) normScores[d.code].linkage = inObj.linkage;
  }

  const fields = {
    symbol: code,
    name: name || '',
    sector: sector || '',
    eval_date: date,
    criterion_scores: normScores,
    weighted_total: total,
    band_code: band.code,
    band_label: band.label,
    buy_point: buy_point || '',
    sell_plan: sell_plan || '',
    note: note || null,
    criteria_snapshot: {
      weightSum,
      weights: active.map(c => ({ code: c.code, name: c.name, weight: c.weight })),
      band,
    },
  };

  const existed = await FortuneEvaluation.findOne({ where: { symbol: code, eval_date: date } });
  const rec = existed ? await existed.update(fields) : await FortuneEvaluation.create(fields);
  return { ok: true, data: evaluationView(rec), weightSum, band, details };
}

function evaluationView(e) {
  return {
    id: e.id, symbol: e.symbol, name: e.name, sector: e.sector,
    eval_date: e.eval_date, criterion_scores: e.criterion_scores,
    weighted_total: Number(e.weighted_total),
    band_code: e.band_code, band_label: e.band_label,
    buy_point: e.buy_point, sell_plan: e.sell_plan, note: e.note,
    criteria_snapshot: e.criteria_snapshot,
    createdAt: e.createdAt, updatedAt: e.updatedAt,
  };
}

async function listEvaluations({ symbol, date, start, end, limit = 60 } = {}) {
  const where = {};
  if (symbol) where.symbol = String(symbol).trim();
  if (date) where.eval_date = String(date).slice(0, 10);
  if (start || end) {
    where.eval_date = {};
    if (start) where.eval_date[Op.gte] = String(start).slice(0, 10);
    if (end) where.eval_date[Op.lte] = String(end).slice(0, 10);
  }
  const rows = await FortuneEvaluation.findAll({ where, order: [['eval_date', 'DESC'], ['id', 'DESC']], limit: Number(limit) || 60 });
  return rows.map(evaluationView);
}

async function getEvaluation(id) {
  const e = await FortuneEvaluation.findByPk(id);
  return e ? evaluationView(e) : null;
}

async function deleteEvaluation(id) {
  const n = await FortuneEvaluation.destroy({ where: { id } });
  return { ok: n > 0 };
}

// ==================== 股票池 ====================

async function listStocks() {
  const rows = await FortuneStock.findAll({ order: [['id', 'DESC']] });
  return rows.map(s => ({
    id: s.id, symbol: s.symbol, name: s.name, sector: s.sector, info: s.info, note: s.note,
    market: (s.info && s.info.market) || '',
  }));
}

/** 从系统股票库按代码查名称/市场（拿不到返回 null，不报错） */
async function lookupStock(code) {
  try {
    const st = await Stock.findOne({ where: { code } });
    return st ? { name: st.name, market: st.market, list_status: st.list_status } : null;
  } catch (e) {
    return null;
  }
}

async function addStock({ symbol, name, sector, info, note } = {}) {
  const code = String(symbol || '').trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, error: '股票代码需为 6 位数字。' };
  let fill = info || null;
  // 名称留空时，自动从系统股票库按代码补全（并记下市场，页面能显示“沪/深/北”）
  let resolvedName = name;
  if (!resolvedName) {
    const hit = await lookupStock(code);
    if (hit) {
      resolvedName = hit.name;
      fill = { ...(fill || {}), market: hit.market };
      if (hit.list_status === 'DELISTED') fill.stock_status = 'DELISTED';
    }
  }
  const existed = await FortuneStock.findOne({ where: { symbol: code } });
  if (existed) {
    await existed.update({
      name: resolvedName !== undefined && resolvedName !== '' ? resolvedName : existed.name,
      sector: sector !== undefined ? sector : existed.sector,
      info: fill !== undefined ? fill : existed.info,
      note: note !== undefined ? note : existed.note,
    });
    return { ok: true, updated: true, data: { symbol: existed.symbol, name: existed.name, market: (existed.info || {}).market || '' } };
  }
  const s = await FortuneStock.create({ symbol: code, name: resolvedName || '', sector: sector || '', info: fill, note: note || null });
  if (!resolvedName) return { ok: true, updated: false, notFound: true, data: { symbol: s.symbol, name: '', market: '' } };
  return { ok: true, updated: false, data: { symbol: s.symbol, name: s.name, market: (s.info || {}).market || '' } };
}

async function removeStock(symbol) {
  const code = String(symbol || '').trim();
  if (!code) return { ok: false, error: '缺少股票代码' };
  await FortuneStock.destroy({ where: { symbol: code } });
  return { ok: true };
}

// ==================== 批量自动打分（复用追资金指标流水线，零改 Python） ====================

function beijingNow() { return marketDataService.getBeijingTime(); }
function bizTime(d) { return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function beijingIso(d = beijingNow()) { return `${bizDate(d)}T${bizTime(d)}:${String(d.getSeconds()).padStart(2, '0')}+08:00`; }

function readJsonSafe(file) { try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (e) { return null; } }
function parseTailJson(text) {
  if (!text) return null;
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) { try { return JSON.parse(lines[i]); } catch (e) { /* 跳过非 JSON 行 */ } }
  return null;
}

/** 只读调用追资金 Python（不写其库）；输出大，走 --out 文件 */
function runFortunePython(args, { timeoutMs = 90000, onProgress } = {}) {
  return new Promise((resolve) => {
    let stdout = ''; let stderr = ''; let proc;
    try {
      proc = execFile('python3', [PY_SCRIPT, ...args], {
        timeout: timeoutMs, cwd: path.join(__dirname, '../..'), maxBuffer: 64 * 1024 * 1024, env: { ...process.env },
      });
    } catch (e) { resolve({ ok: false, error: `无法启动 Python 进程：${e.message}` }); return; }
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => {
      const t = d.toString(); stderr += t;
      for (const line of t.split('\n')) {
        const m = line.match(/\[PROGRESS\]\s+(\d+)\s+(\d+)\s+(.+)/);
        if (m && onProgress) { try { onProgress({ done: Number(m[1]), total: Number(m[2]), stage: m[3].trim() }); } catch (e) { /* 忽略 */ } }
      }
    });
    let settled = false; const finish = r => { if (!settled) { settled = true; resolve(r); } };
    proc.on('error', err => { if (err && err.code === 'ENOENT') finish({ ok: false, error: 'Python 脚本执行失败（环境缺少 python3 或 akshare）' }); });
    proc.on('close', code => {
      const parsed = parseTailJson(stdout);
      if (code !== 0) {
        const msg = (parsed && parsed.error) || `Python 脚本退出码 ${code}${stderr ? `：${stderr.trim().split('\n').slice(-1)[0]}` : ''}`;
        finish({ ok: false, error: msg, errorDetail: (parsed && parsed.error_detail) || stderr.slice(-500) }); return;
      }
      if (!parsed) { finish({ ok: false, error: '脚本输出无法解析为 JSON（可能被限流）', errorDetail: stdout.slice(0, 300) }); return; }
      if (parsed.ok === false) { finish({ ok: false, error: parsed.error || '脚本返回失败', errorDetail: parsed.error_detail || '' }); return; }
      finish({ ok: true, data: parsed });
    });
  });
}

const N = v => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : Number(v));

/** 道氏理论自动折算：基于 ind.dow / 20日高低 / MA30 / 量能折算 */
function autoScoreDow(ind) {
  const price = N(ind.price), dow = ind.dow || '';
  const high20 = N(ind.high20), volEst = N(ind.vol_ratio_est), maLong = N(ind.ma_long_v);
  const recentLow = N(ind.recent_low), todayNewLow = !!ind.today_new_low20;
  const items = [];
  const d1 = dow === 'UP';
  items.push({ id: 'd1', label: '上升趋势成立（HH+HL）', points: 40, met: d1, detail: `道氏分段判定=${dow || '—'}` });
  const d2 = !todayNewLow && (recentLow == null || price == null || price > recentLow * 0.97);
  items.push({ id: 'd2', label: '回调不破前低', points: 20, met: d2, detail: todayNewLow ? '当日创 20 日新低' : (recentLow != null && price != null ? `现价 ${price.toFixed(2)} vs 近 10 日低 ${recentLow.toFixed(2)}` : '数据不足') });
  const atHigh = high20 != null && price != null && price >= high20 * 0.99;
  const d3 = atHigh ? (volEst != null && volEst >= 1.1) : true;
  items.push({ id: 'd3', label: '突破有量能配合', points: 20, met: d3, detail: atHigh ? `近 20 日高位，折算量 ${volEst == null ? '—' : volEst.toFixed(2)}×（门槛 ≥1.1×）` : '未创新高，不扣分' });
  const d4 = maLong != null && price != null && price > maLong;
  items.push({ id: 'd4', label: '大周期背景向上（价>MA30）', points: 20, met: d4, detail: (maLong != null && price != null) ? `现价 ${price.toFixed(2)} vs MA30 ${maLong.toFixed(2)}` : '数据不足' });
  const posMax = 100;
  const earned = items.reduce((s, x) => s + (x.met ? x.points : 0), 0);
  return { score: Math.max(0, Math.min(100, Math.round(earned / posMax * 100))), items };
}

/** 葛兰碧八大法则自动折算：以 MA20 为参照均线，量能折算确认 */
function autoScoreGranville(ind) {
  const price = N(ind.price), maV = N(ind.ma_mid_v), maPrev = N(ind.ma_mid_prev);
  const volEst = N(ind.vol_ratio_est), high20 = N(ind.high20), pct = N(ind.today_pct);
  const bullish = pct != null ? pct > 0 : null;
  const rising = maV != null && maPrev != null && maV > maPrev;
  const falling = maV != null && maPrev != null && maV < maPrev;
  const flat = maV != null && maPrev != null && Math.abs(maV - maPrev) / maV * 100 < 0.3;
  const above = maV != null && price != null && price > maV;
  const nearMa = maV != null && price != null && price >= maV && price <= maV * 1.03;
  const atHigh = high20 != null && price != null && price >= high20 * 0.99;
  const overextend = maV != null && price != null && (price / maV - 1) > 0.08;
  const diverge = atHigh && volEst != null && volEst < 1.0;
  const g6 = !!(maV != null && price != null && price < maV && falling);
  const devPct = (maV != null && price != null) ? ((price / maV - 1) * 100).toFixed(1) : '—';
  const items = [];
  const g1 = above && rising;
  items.push({ id: 'G1', label: '站上 MA20 且均线上穿', points: 12, semantic: 'bonus', met: g1, detail: `close vs MA20 ${maV != null ? maV.toFixed(2) : '—'}（${rising ? '向上' : falling ? '向下' : '走平'}）` });
  const g2 = nearMa && bullish === true;
  items.push({ id: 'G2', label: '回踩均线不破随即回升', points: 20, semantic: 'buy_point', met: g2, detail: (maV != null && price != null) ? `现价处 MA20 上方 0~3%、当日${bullish === true ? '收阳' : bullish === false ? '收阴' : '未知'}` : '数据不足' });
  const g3 = above && rising && atHigh && volEst != null && volEst >= 1.3;
  items.push({ id: 'G3', label: '回踩后放量突破前高', points: 20, semantic: 'buy_point', met: g3, detail: atHigh ? `近 20 日高，折算量 ${volEst == null ? '—' : volEst.toFixed(2)}×（≥1.3×）` : '未创新高' });
  const g4 = maV != null && price != null && price > maV && price <= maV * 1.02 && bullish === true;
  items.push({ id: 'G4', label: '急跌远离均线后回归', points: 12, semantic: 'bonus', met: g4, detail: (maV != null && price != null) ? `现价刚收复 MA20（+${devPct}%）、当日${bullish === true ? '收阳' : '未收阳'}` : '数据不足' });
  items.push({ id: 'G5', label: '均线走平、价格缠绕', points: -10, semantic: 'risk', met: flat, detail: `MA20 斜率${flat ? '≈0（走平）' : '非走平'}` });
  items.push({ id: 'G6', label: '跌破均线且均线拐头向下', points: 0, semantic: 'veto', met: g6, detail: g6 ? `现价 ${price != null ? price.toFixed(2) : '—'} < MA20 且 MA20 转降` : '买点未失效' });
  items.push({ id: 'G7', label: '乖离过大（追高警示）', points: -10, semantic: 'risk', met: overextend, detail: (maV != null && price != null) ? `乖离 ${devPct}%（>8% 触发）` : '数据不足' });
  items.push({ id: 'G8', label: '量价背离（价新高量未跟上）', points: -10, semantic: 'risk', met: diverge, detail: atHigh ? `近 20 日新高但折算量 ${volEst == null ? '—' : volEst.toFixed(2)}×（<1.0×）` : '无背离' });
  let score;
  if (g6) score = 0;
  else {
    const posMax = 64;
    const earned = items.reduce((s, x) => s + ((x.met && x.points > 0) ? x.points : 0), 0);
    const penalty = items.reduce((s, x) => s + ((x.met && x.points < 0) ? x.points : 0), 0);
    score = Math.max(0, Math.min(100, Math.round((earned + penalty) / posMax * 100)));
  }
  return { score, items, veto: g6 };
}

/** 把一行 run_score/snapshot 结果折算成道氏+葛兰碧加权得分 */
async function scoreRow(row, ctx) {
  const { active, bands } = ctx;
  const ind = row.indicators || {};
  const dow = autoScoreDow(ind);
  const gran = autoScoreGranville(ind);
  const criterion_scores = {
    dow: { score: dow.score, auto: true, items: dow.items },
    granville: { score: gran.score, auto: true, items: gran.items, linkage: gran.veto ? { veto: true } : undefined },
  };
  const { total, details } = await computeScore(criterion_scores, active);
  const band = resolveBand(total, bands);
  return {
    symbol: row.symbol, name: row.name || '', sector: row.sector || '',
    today_pct: row.today_pct, pool_type: row.pool_type, data_as_of: row.data_as_of,
    dow_score: dow.score, granville_score: gran.score, granville_veto: gran.veto,
    weighted_total: total, band, criterion_scores, details,
    indicators: {
      price: N(ind.price), dow: ind.dow, ma_short: N(ind.ma_short_v), ma_mid: N(ind.ma_mid_v), ma_long: N(ind.ma_long_v),
      adx: N(ind.adx), vol_ratio_est: N(ind.vol_ratio_est), high20: N(ind.high20), high60: N(ind.high60), low60: N(ind.low60),
      retrace_pct: N(ind.retrace_pct), fib_near: ind.fib_near,
    },
    fib_info: row.fib_info || null,
  };
}

function normalizeScanList(symbols) {
  const out = []; const seen = new Set();
  for (const x of symbols || []) {
    const raw = (typeof x === 'string') ? x : (x && x.symbol);
    const code = String(raw || '').replace(/\D/g, '').slice(0, 6);
    if (!/^\d{6}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    out.push({ symbol: code, name: (x && x.name) || '' });
  }
  return out;
}

async function persistScanEval(s, date) {
  try {
    await saveEvaluation({ symbol: s.symbol, name: s.name, sector: s.sector, eval_date: date, criterion_scores: s.criterion_scores });
  } catch (e) { console.error('⚠️ [招财进宝] 扫描结果落库失败', s.symbol, e.message); }
}

/** 发起一次批量扫描（立即返回 scanId，后台跑，避免 HTTP 超时） */
async function startScan({ symbols, date } = {}) {
  const list = normalizeScanList(symbols);
  if (!list.length) return { ok: false, error: '请至少提供一只 6 位股票代码' };
  if (list.length > 80) return { ok: false, error: `单次最多 80 只，当前 ${list.length} 只` };
  // 同一时刻只允许一个扫描任务，避免并发抓取把行情接口打爆
  for (const v of activeScans.values()) {
    if (v.status === 'running') return { ok: false, error: `已有打分任务在运行中（${v.stage || '进行中'}），请等待完成或稍后再试。` };
  }
  const today = bizDate(beijingNow());
  const asOf = date ? String(date).slice(0, 10) : '';
  if (asOf && asOf > today) return { ok: false, error: `时间点 ${asOf} 还没到，请选今天或之前` };
  const scanId = `fc_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
  activeScans.set(scanId, { scanId, status: 'running', stage: '准备', progress: 0, total: list.length, done: 0, result: [], errors: [], startedAt: Date.now() });
  runScanJob(scanId, list, asOf, today).catch(e => { const st = activeScans.get(scanId); if (st) { st.status = 'failed'; st.error = e.message; } });
  return { ok: true, scanId, total: list.length };
}

async function runScanJob(scanId, list, asOf, today) {
  const st = activeScans.get(scanId);
  const active = await loadActiveCriteria();
  const bands = (readConfig() || {}).bands || [];
  const ctx = { active, bands };
  const results = []; const errors = [];
  const pastDate = asOf && asOf !== today;
  if (pastDate) {
    // 历史时间点：逐只 snapshot 收盘口径截断，不掺今日实时 K
    for (let i = 0; i < list.length; i++) {
      const code = list[i].symbol;
      st.done = i; st.stage = `定格打分 ${code}（${i + 1}/${list.length}）`; st.progress = Math.round(i / list.length * 100);
      const r = await runFortunePython(['--action', 'snapshot', '--symbol', code, '--as-of', asOf, '--no-chip'], { timeoutMs: 90000 });
      if (!r.ok) { errors.push({ symbol: code, error: r.error }); continue; }
      const row = (r.data && r.data.stocks && r.data.stocks[0]) || null;
      if (!row) { errors.push({ symbol: code, error: '该时间点无日线数据（非交易日或停牌）' }); continue; }
      const s = await scoreRow(row, ctx); results.push(s); await persistScanEval(s, asOf);
    }
  } else {
    // 当天/最新：一次批量 live score（1 进程，内部节流）
    st.stage = '批量取数打分';
    if (!fs.existsSync(SCRATCH_DIR)) fs.mkdirSync(SCRATCH_DIR, { recursive: true });
    const outFile = path.join(SCRATCH_DIR, `fc_${scanId}.json`);
    const symbolsArg = list.map(x => x.symbol).join(',');
    const r = await runFortunePython(['--action', 'score', '--symbols', symbolsArg, '--no-chip', '--now', beijingIso(), '--out', outFile], {
      timeoutMs: Math.max(120000, list.length * 6000),
      onProgress: ({ done, total, stage }) => { st.done = done; st.total = total || list.length; st.stage = stage; st.progress = total ? Math.min(99, Math.round(done / total * 100)) : 0; },
    });
    if (!r.ok) { st.status = 'failed'; st.error = r.error || '批量打分失败'; return; }
    const data = fs.existsSync(outFile) ? (readJsonSafe(outFile) || {}) : (r.data || {});
    for (const row of (data.stocks || [])) { const s = await scoreRow(row, ctx); results.push(s); await persistScanEval(s, asOf || today); }
    for (const sk of (data.skipped || [])) errors.push({ symbol: sk.symbol, error: sk.reason || '跳过' });
    try { fs.unlinkSync(outFile); } catch (e) { /* 清理失败无妨 */ }
  }
  results.sort((a, b) => b.weighted_total - a.weighted_total);
  st.result = results; st.errors = errors; st.done = list.length; st.progress = 100; st.status = 'done'; st.stage = '完成'; st.finishedAt = Date.now();
}

/** 轮询扫描进度与结果 */
function getScanStatus(scanId) {
  for (const [k, v] of activeScans) { if (v.finishedAt && Date.now() - v.finishedAt > SCAN_TTL_MS) activeScans.delete(k); }
  const st = activeScans.get(scanId);
  if (!st) return { ok: false, error: '扫描任务不存在或已过期，请重新发起' };
  return { ok: true, data: { scanId: st.scanId, status: st.status, stage: st.stage, progress: st.progress, total: st.total, done: st.done, result: st.result, errors: st.errors, error: st.error } };
}

/** 单票在指定时间点的自动打分（第 2 页按需/无存档时用；带 kline） */
async function scoreSingle({ symbol, date } = {}) {
  const code = String(symbol || '').trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, error: '股票代码需为 6 位数字' };
  const today = bizDate(beijingNow());
  const asOf = date ? String(date).slice(0, 10) : '';
  if (asOf && asOf > today) return { ok: false, error: `时间点 ${asOf} 还没到，请选今天或之前` };
  const active = await loadActiveCriteria();
  const bands = (readConfig() || {}).bands || [];
  const ctx = { active, bands };
  let r;
  if (asOf && asOf !== today) {
    r = await runFortunePython(['--action', 'snapshot', '--symbol', code, '--as-of', asOf, '--no-chip'], { timeoutMs: 90000 });
  } else {
    r = await runFortunePython(['--action', 'analyze', '--symbol', code, '--no-chip', '--now', beijingIso()], { timeoutMs: 60000 });
  }
  if (!r.ok) return { ok: false, error: r.error };
  const row = (r.data && r.data.stocks && r.data.stocks[0]) || null;
  if (!row) return { ok: false, error: '未取到该股数据' };
  const s = await scoreRow(row, ctx);
  s.kline = row.kline || null;
  s.minutes = row.minutes || null; s.minutes_period_min = row.minutes_period_min; s.minutes_date = row.minutes_date; s.prev_close = row.prev_close; s.spot_time = row.spot_time;
  return { ok: true, data: s };
}

/** 读某时间点已落库的评分榜单（0 外部请求，页面秒开；每票取最新一条） */
async function listEvaluationsForDate(date) {
  const d = String(date || bizDate(beijingNow())).slice(0, 10);
  const rows = await listEvaluations({ date: d, limit: 500 });
  const map = {};
  for (const r of rows) { if (!map[r.symbol] || new Date(r.updatedAt) > new Date(map[r.symbol].updatedAt)) map[r.symbol] = r; }
  return Object.values(map).sort((a, b) => Number(b.weighted_total) - Number(a.weighted_total));
}

module.exports = {
  CONFIG_PATH,
  bizDate,
  seedCriteria,
  getCriteriaDoc,
  updateCriteria,
  resetCriteria,
  computeScore,
  deriveScore,
  resolveBand,
  saveEvaluation,
  listEvaluations,
  getEvaluation,
  deleteEvaluation,
  listStocks,
  addStock,
  removeStock,
  lookupStock,
  // 批量自动打分
  startScan,
  getScanStatus,
  scoreSingle,
  listEvaluationsForDate,
  autoScoreDow,
  autoScoreGranville,
};
