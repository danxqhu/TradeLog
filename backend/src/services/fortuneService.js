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
const { Op, fn, col } = require('sequelize');
const {
  FortuneCriterion, FortuneStock, FortuneEvaluation, Stock, SystemConfig,
} = require('../models');
const marketDataService = require('./marketDataService');

const CONFIG_PATH = path.join(__dirname, '../../config/fortune_criteria.json');
// 衰竭止盈（W）阈值/模式/新开仓参数的页面覆盖值存这里；文件默认只作首次基准，恢复出厂一并清除
const SELL_CONFIG_KEY = 'fortune_sell_config';
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

/** 读取判定项全文 + 分档 + 公式（供页面渲染与评分）；衰竭 W 组单独放 sellCriteria，不混进买入 criteria */
async function getCriteriaDoc() {
  const cfg = readConfig() || {};
  const rows = await FortuneCriterion.findAll({ order: [['sort_order', 'ASC'], ['id', 'ASC']] });
  const mapRow = r => ({
    code: r.code, name: r.name, type: r.type,
    weight: Number(r.weight), enabled: !!r.enabled,
    items: Array.isArray(r.items) ? r.items : [],
    description: r.description, isCustom: !!r.is_custom,
  });
  const criteria = rows.filter(r => r.type !== 'sell_auto' && r.type !== 'reversal_auto').map(mapRow);
  const sellCriteria = rows.filter(r => r.type === 'sell_auto').map(mapRow);
  const reversalCriteria = rows.filter(r => r.type === 'reversal_auto').map(mapRow);
  const enabled = criteria.filter(c => c.enabled);
  const sellCfg = await getEffectiveSellConfig();
  return {
    version: cfg.version || '',
    title: cfg.title || '胡胖胖招财进宝',
    notice: cfg.notice || '',
    formula: cfg.formula || '',
    bands: cfg.bands || [],
    criteria,
    // 模块阈值（窗口/倍数/容差）：买入侧唯一真源在配置文件，只读展示给页面，调它需要改文件 + 重启后端
    moduleParams: cfg.module_params || {},
    weightSum: Number(enabled.reduce((s, c) => s + c.weight, 0).toFixed(2)),
    // ---- 衰竭止盈（W）体系 ----
    sellCriteria,
    sellBands: sellCfg.sellBands,
    sellParams: sellCfg.sellParams,
    sellScoring: sellCfg.sellScoring,
    openValue: sellCfg.openValue,
    // ---- 超跌反转（B）体系：独立成分，不参与买入/衰竭加权 ----
    reversalCriteria,
    reversalBands: sellCfg.reversalBands,
    reversalParams: sellCfg.reversalParams,
    reversalScoring: sellCfg.reversalScoring,
    chip: sellCfg.chip,
    // 文件默认值：供配置页展示与「恢复默认」
    sellDefaults: {
      sellParams: cfg.sell_params || {},
      sellScoring: cfg.sell_scoring || { mode: 'A' },
      openValue: cfg.open_value || {},
      sellBands: cfg.sell_bands || [],
      reversalParams: cfg.reversal_params || {},
      reversalScoring: cfg.reversal_scoring || { mode: 'accumulate' },
      reversalBands: cfg.reversal_bands || [],
      chip: (cfg.open_value || {}).chip || {},
    },
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

/** 恢复出厂：删掉所有人工标记（含衰竭配置覆盖），重新按文件播种 */
async function resetCriteria(code) {
  if (code) {
    const row = await FortuneCriterion.findOne({ where: { code } });
    if (row) await row.update({ is_custom: false });
  } else {
    await FortuneCriterion.update({ is_custom: false }, { where: {} });
    await resetSellConfig();
  }
  return seedCriteria();
}

// ==================== 衰竭止盈（W）配置：文件默认 ← SystemConfig 覆盖 ====================

/** 生效的卖出/反转侧配置：阈值、归一模式、综合分参数、等级分档、筹码限流（页面可改，覆盖值存 SystemConfig） */
async function getEffectiveSellConfig() {
  const cfg = readConfig() || {};
  const base = {
    sellParams: cfg.sell_params || {},
    sellScoring: cfg.sell_scoring || { mode: 'A' },
    openValue: cfg.open_value || {},
    sellBands: cfg.sell_bands || [],
    reversalParams: cfg.reversal_params || {},
    reversalScoring: cfg.reversal_scoring || { mode: 'accumulate' },
    reversalBands: cfg.reversal_bands || [],
    chip: (cfg.open_value || {}).chip || {},
  };
  try {
    const row = await SystemConfig.findOne({ where: { key: SELL_CONFIG_KEY } });
    if (row && row.value) {
      const ov = JSON.parse(row.value) || {};
      const openValue = { ...base.openValue, ...(ov.openValue || {}) };
      // chip 限流参数既可直接存也可嵌在 openValue 里，两种写法都收
      const chip = { ...base.chip, ...(openValue.chip || {}), ...(ov.chip || {}) };
      return {
        sellParams: { ...base.sellParams, ...(ov.sellParams || {}) },
        sellScoring: { ...base.sellScoring, ...(ov.sellScoring || {}) },
        openValue: { ...openValue, chip },
        sellBands: (Array.isArray(ov.sellBands) && ov.sellBands.length) ? ov.sellBands : base.sellBands,
        reversalParams: { ...base.reversalParams, ...(ov.reversalParams || {}) },
        reversalScoring: { ...base.reversalScoring, ...(ov.reversalScoring || {}) },
        reversalBands: (Array.isArray(ov.reversalBands) && ov.reversalBands.length) ? ov.reversalBands : base.reversalBands,
        chip,
      };
    }
  } catch (e) {
    console.error('⚠️ [招财进宝] 衰竭/反转配置覆盖读取失败（用文件默认）:', e.message);
  }
  return base;
}

/** 页面保存衰竭/反转配置（只存与文件默认的差异覆盖） */
async function saveSellConfig(patch = {}) {
  let override = {};
  const cur = await SystemConfig.findOne({ where: { key: SELL_CONFIG_KEY } });
  try { if (cur && cur.value) override = JSON.parse(cur.value) || {}; } catch (e) { override = {}; }
  for (const k of ['sellParams', 'sellScoring', 'openValue', 'sellBands', 'reversalParams', 'reversalScoring', 'reversalBands', 'chip']) {
    if (patch[k] !== undefined) override[k] = patch[k];
  }
  const value = JSON.stringify(override);
  if (cur) await cur.update({ value }); else await SystemConfig.create({ key: SELL_CONFIG_KEY, value });
  return getEffectiveSellConfig();
}

/** 清除覆盖，回到文件默认 */
async function resetSellConfig() {
  try { await SystemConfig.destroy({ where: { key: SELL_CONFIG_KEY } }); } catch (e) { /* 表未就绪时不阻断播种 */ }
  return getEffectiveSellConfig();
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

/** 取当前启用判定项（评分用）；衰竭 W 组（sell_auto）与反转 B 组（reversal_auto）都不参与买入加权 */
async function loadActiveCriteria() {
  const rows = await FortuneCriterion.findAll({
    where: { enabled: true, type: { [Op.notIn]: ['sell_auto', 'reversal_auto'] } },
    order: [['sort_order', 'ASC']],
  });
  return rows.map(r => ({
    code: r.code, name: r.name, type: r.type,
    weight: Number(r.weight), items: Array.isArray(r.items) ? r.items : [],
  }));
}

/** 取全部判定项（含关闭的）：关闭的自动模块（如 M8 蜡烛线）仍要详情页展示提示，
 * 只是不进总分（computeScore 只走 enabled 集合）；同样排除 sell_auto / reversal_auto */
async function loadAllCriteria() {
  const rows = await FortuneCriterion.findAll({ where: { type: { [Op.notIn]: ['sell_auto', 'reversal_auto'] } }, order: [['sort_order', 'ASC'], ['id', 'ASC']] });
  return rows.map(r => ({
    code: r.code, name: r.name, type: r.type, auto: r.type === 'auto',
    weight: Number(r.weight), enabled: !!r.enabled, items: Array.isArray(r.items) ? r.items : [],
  }));
}

/** 取衰竭 W 组（含关闭的）：开关与子项分值以库为准，同表不同族（type=sell_auto） */
async function loadSellCriteria() {
  const rows = await FortuneCriterion.findAll({ where: { type: 'sell_auto' }, order: [['sort_order', 'ASC'], ['id', 'ASC']] });
  return rows.map(r => ({
    code: r.code, name: r.name, type: r.type, auto: true,
    weight: Number(r.weight), enabled: !!r.enabled, items: Array.isArray(r.items) ? r.items : [],
  }));
}

/** 取超跌反转 B 组（含关闭的）：type=reversal_auto，独立成一套分，不参与买入/衰竭加权 */
async function loadReversalCriteria() {
  const rows = await FortuneCriterion.findAll({ where: { type: 'reversal_auto' }, order: [['sort_order', 'ASC'], ['id', 'ASC']] });
  const cfg = readConfig() || {};
  const fileGroup = {};
  for (const c of cfg.criteria || []) if (c.type === 'reversal_auto') fileGroup[c.code] = c;
  return rows.map(r => ({
    code: r.code, name: r.name, type: r.type, auto: true,
    weight: Number(r.weight), enabled: !!r.enabled, items: Array.isArray(r.items) ? r.items : [],
    // 组内互斥（如 B5 单根/组合取一）与计分模式是静态结构，真源在配置文件，不进库
    exclusive: !!(fileGroup[r.code] && fileGroup[r.code].exclusive),
    scoringModel: (fileGroup[r.code] || {}).scoring_model || 'accumulate',
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
 * 计算加权总分（v2.0 归一化）：总分 = Σ(模块分 × 权重) ÷ Σ(实际参与项的权重)，封顶 100。
 * —— 得 0 分照样参与；score 为 null / unavailable（脚本未返回该模块）的项不计分，
 *    且其权重从分母剔除，所以关掉一个模块不需要手工重新分配其余权重。
 * input criterionScores: { [code]: { score?|checked?[], unavailable? } } —— 未给 score 时用 checked 折算。
 * 返回 { total, details:[{code,name,weight,score,weighted,contribution,available}], weightSum, usedWeight }
 */
async function computeScore(criterionScores = {}, criteria = null) {
  const active = criteria || await loadActiveCriteria();
  const details = [];
  let raw = 0;
  let usedWeight = 0;
  for (const c of active) {
    const inObj = criterionScores[c.code] || {};
    const missing = inObj.score === null || inObj.unavailable === true;
    if (missing) {
      details.push({
        code: c.code, name: c.name, weight: c.weight, score: null,
        weighted: 0, contribution: 0, available: false,
        note: inObj.note || '本次未取到该模块判定，权重已从总分分母剔除',
      });
      continue;
    }
    const score = (inObj.score === undefined || inObj.score === '')
      ? deriveScore(c.items, inObj.checked)
      : Math.max(0, Math.min(100, Number(inObj.score) || 0));
    raw += score * c.weight;
    usedWeight += c.weight;
    details.push({
      code: c.code, name: c.name, weight: c.weight, score,
      weighted: Number((score * c.weight / 100).toFixed(2)),
      contribution: 0, available: true,
    });
  }
  const weightSum = Number(active.reduce((s, c) => s + c.weight, 0).toFixed(2));
  // 归一化分母只算实际参与项；权重和=100 时与旧口径（score×weight%）结果完全一致
  for (const d of details) {
    if (d.available) d.contribution = Number((d.score * d.weight / (usedWeight || 1)).toFixed(2));
  }
  const total = usedWeight > 0 ? raw / usedWeight : 0;
  return { total: Number(Math.min(100, total).toFixed(2)), details, weightSum, usedWeight: Number(usedWeight.toFixed(2)) };
}

// ==================== 评估记录 ====================

/**
 * 保存/更新一条评估（每票每日一行，就地覆盖），落库前算总分与分档
 * meta: {pool_type, trend_label, ma_state_label, data_quality, modules_missing} —— 只存进 criteria_snapshot（JSON），
 *       不改表结构；榜单/第 2 页读档时靠它还原 A/B 趋势标签等不参与总分的展示项。
 * reversal/composite/runStage: 超跌反转 B 分、S_A/S_B 双综合分、本次属粗筛还是精选（同样只存 JSON）。
 * keepHistory: 精选覆盖同日同票记录时，把旧的粗筛 snapshot+criterion_scores 压进 pre_filter_history（最近 3 份），
 *              让粗筛/精选两份口径独立可复盘对比。
 */
async function saveEvaluation({ symbol, name, sector, eval_date, criterion_scores, buy_point, sell_plan, note, meta, sell, reversal, composite, runStage, keepHistory } = {}) {
  const code = String(symbol || '').trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, error: '股票代码需为 6 位数字（例如 002913）。' };
  const date = String(eval_date || bizDate()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: '评估日期格式应为 YYYY-MM-DD。' };

  const active = await loadActiveCriteria();
  const cfg = readConfig() || {};
  const { total, details, weightSum, usedWeight } = await computeScore(criterion_scores || {}, active);
  const band = resolveBand(total, cfg.bands);
  // 未传 sell/reversal/composite（如人工保存）时保留旧记录里的衰竭/反转口径，不被清空
  const existed0 = await FortuneEvaluation.findOne({ where: { symbol: code, eval_date: date } });
  const prevSnap = existed0 ? (existed0.criteria_snapshot || {}) : {};
  const sellCfgSnap = (sell || reversal) ? await getEffectiveSellConfig() : null;

  // 归一化每项得分明细一并存（含折算后的 score，便于复盘还原）。
  // 除参与总分的 active 项外，已算出但开关关闭的模块（如蜡烛线）也要存，第 2 页才能只展示不计分
  const normScores = {};
  const scoreCodes = new Set(details.map(d => d.code));
  for (const c of Object.keys(criterion_scores || {})) scoreCodes.add(c);
  for (const codeKey of scoreCodes) {
    const d = details.find(x => x.code === codeKey) || null;
    const inObj = (criterion_scores || {})[codeKey] || {};
    const available = d ? d.available !== false : inObj.unavailable !== true;
    normScores[codeKey] = {
      score: d ? d.score : (inObj.score === undefined ? null : inObj.score),
      checked: Array.isArray(inObj.checked) ? inObj.checked : [],
      weight: d ? d.weight : (Number(inObj.weight) || 0),
      weighted: d ? d.weighted : 0,
      contribution: d ? d.contribution : 0,
      available,
      counted: !!d && available,   // 本次是否真的计入总分（开关关着 = false，仅展示提示）
    };
    if (d && d.note) normScores[codeKey].note = d.note;
    // 自动判定：子项 met/detail 明细 + 命中档位 + 原始数值一并存，第 2 页直接还原（JSON 字段，无需改表）
    if (inObj.auto) normScores[codeKey].auto = true;
    if (Array.isArray(inObj.items)) normScores[codeKey].items = inObj.items;
    if (inObj.state) normScores[codeKey].state = inObj.state;
    if (inObj.facts) normScores[codeKey].facts = inObj.facts;
    if (inObj.state_label) normScores[codeKey].state_label = inObj.state_label;
    if (inObj.note) normScores[codeKey].note = inObj.note;
    if (inObj.linkage) normScores[codeKey].linkage = inObj.linkage;
  }

  // 衰竭 W 组明细并入 criterion_scores（counted 恒 false：不进买入总分，仅供详情页/复盘还原）
  if (sell && Array.isArray(sell.groups)) {
    for (const g of sell.groups) {
      normScores[g.code] = {
        sell: true, auto: true, name: g.name, score: g.earned, groupMax: g.groupMax,
        enabled: !!g.enabled, available: !!g.available, applicable: !!g.applicable,
        counted: false, items: g.items, facts: g.facts, note: g.note || '',
      };
    }
  }

  // 反转 B 组明细同样并入（reversal:true，既不参买入加权也不参衰竭加权）
  if (reversal && Array.isArray(reversal.groups)) {
    for (const g of reversal.groups) {
      normScores[g.code] = {
        reversal: true, auto: true, name: g.name, score: g.earned, groupMax: g.groupMax,
        enabled: !!g.enabled, applicable: !!g.applicable, exclusive: !!g.exclusive,
        counted: false, items: g.items, facts: g.facts, note: g.note || '',
      };
    }
  }

  // 精选轮覆盖粗筛记录：把旧的粗筛口径整份压进历史（保留最近 3 份），粗筛/精选两份快照各自可复盘对比
  const prevHistory = Array.isArray(prevSnap.pre_filter_history) ? prevSnap.pre_filter_history : [];
  const keepPreFilter = !!keepHistory && runStage === 'select' && prevSnap.run_stage === 'pre_filter';
  const history = keepPreFilter
    ? prevHistory.concat([{
      saved_at: existed0 ? existed0.updatedAt : null,
      run_stage: prevSnap.run_stage,
      weighted_total: existed0 && existed0.weighted_total != null ? Number(existed0.weighted_total) : null,
      band: prevSnap.band || null,
      sell_summary: prevSnap.sell_summary || null,
      reversal_summary: prevSnap.reversal_summary || null,
      composite: prevSnap.composite || null,
      criterion_scores: existed0 ? existed0.criterion_scores : null,
    }]).slice(-3)
    : prevHistory;

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
      usedWeight,
      weights: active.map(c => ({ code: c.code, name: c.name, weight: c.weight })),
      band,
      ...(meta || {}),
      run_stage: runStage || prevSnap.run_stage || 'pre_filter',
      sell_summary: sell ? {
        total: sell.total, band: sell.band, mode: sell.mode, raw: sell.raw, maxPoints: sell.maxPoints,
        hitCount: sell.hitCount, unavailable: !!sell.unavailable, note: sell.note || '',
      } : (prevSnap.sell_summary || null),
      reversal_summary: reversal ? {
        total: reversal.total, band: reversal.band, mode: reversal.mode, raw: reversal.raw,
        maxPoints: reversal.maxPoints, hitCount: reversal.hitCount, enabledCount: reversal.enabledCount,
        oversold: reversal.oversold, drawdown_pct: reversal.drawdown_pct, dist_to_low_pct: reversal.dist_to_low_pct,
        gate_note: reversal.gate_note || '',
        degraded: !!reversal.degraded, unavailable: !!reversal.unavailable, note: reversal.note || '',
        chip: reversal.chip || null,
        groups: reversal.groups.map(g => ({
          code: g.code, enabled: !!g.enabled, applicable: !!g.applicable, earned: g.earned, groupMax: g.groupMax,
          items: g.items.map(it => ({ id: it.id, met: !!it.met, earned: it.earned })),
        })),
      } : (prevSnap.reversal_summary || null),
      // S_A / S_B（旧记录只有 open_value 时不强行兑新字段，页面按「未判定」展示）
      composite: composite !== undefined ? (composite || null) : (prevSnap.composite || null),
      sell_config_snapshot: sell ? {
        mode: sell.mode,
        groups: sell.groups.map(g => ({ code: g.code, enabled: !!g.enabled, applicable: !!g.applicable, earned: g.earned, groupMax: g.groupMax })),
        sellParams: (sellCfgSnap && sellCfgSnap.sellParams) || {},
        sellBands: (sellCfgSnap && sellCfgSnap.sellBands) || [],
        openValue: (sellCfgSnap && sellCfgSnap.openValue) || {},
      } : (prevSnap.sell_config_snapshot || null),
      reversal_config_snapshot: reversal ? {
        mode: reversal.mode,
        groups: reversal.groups.map(g => ({ code: g.code, name: g.name, enabled: !!g.enabled, exclusive: !!g.exclusive, earned: g.earned, groupMax: g.groupMax })),
        reversalParams: (sellCfgSnap && sellCfgSnap.reversalParams) || {},
        reversalBands: (sellCfgSnap && sellCfgSnap.reversalBands) || [],
        chip: (sellCfgSnap && sellCfgSnap.chip) || {},
      } : (prevSnap.reversal_config_snapshot || null),
      pre_filter_history: history,
    },
  };

  const rec = existed0 ? await existed0.update(fields) : await FortuneEvaluation.create(fields);
  return { ok: true, data: evaluationView(rec), weightSum, band, details };
}

function evaluationView(e) {
  const snap = e.criteria_snapshot || {};
  return {
    id: e.id, symbol: e.symbol, name: e.name, sector: e.sector,
    eval_date: e.eval_date, criterion_scores: e.criterion_scores,
    weighted_total: Number(e.weighted_total),
    band_code: e.band_code, band_label: e.band_label,
    buy_point: e.buy_point, sell_plan: e.sell_plan, note: e.note,
    criteria_snapshot: snap,
    // 展示用（不参与打分）：读档也能看到 A/B 趋势标签、均线排列、数据口径
    pool_type: snap.pool_type || '', trend_label: snap.trend_label || '',
    ma_state_label: snap.ma_state_label || '', data_quality: snap.data_quality || '',
    used_weight: snap.usedWeight == null ? null : Number(snap.usedWeight),
    // 衰竭（W）/ 反转（B）/ 两套综合分 / 本次属粗筛还是精选：榜单与详情页读档直接排序，0 额外请求
    sell_summary: snap.sell_summary || null,
    exhaustion_total: (snap.sell_summary && snap.sell_summary.total != null) ? Number(snap.sell_summary.total) : null,
    exhaustion_band: (snap.sell_summary && snap.sell_summary.band) || null,
    reversal_summary: snap.reversal_summary || null,
    reversal_total: (snap.reversal_summary && snap.reversal_summary.total != null) ? Number(snap.reversal_summary.total) : null,
    reversal_band: (snap.reversal_summary && snap.reversal_summary.band) || null,
    composite: snap.composite || null,
    S_A: (snap.composite && snap.composite.S_A) || null,
    S_B: (snap.composite && snap.composite.S_B) || null,
    run_stage: snap.run_stage || '',
    pre_filter_history: Array.isArray(snap.pre_filter_history) ? snap.pre_filter_history : [],
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

/** 有评分记录的日期清单（迷你日历圆点用）：每票每日一行，按 eval_date 分组计数即当日只数 */
async function listEvaluationDates({ start, end, limit = 500 } = {}) {
  const where = {};
  if (start || end) {
    where.eval_date = {};
    if (start) where.eval_date[Op.gte] = String(start).slice(0, 10);
    if (end) where.eval_date[Op.lte] = String(end).slice(0, 10);
  }
  const rows = await FortuneEvaluation.findAll({
    attributes: ['eval_date', [fn('COUNT', col('id')), 'count']],
    where, group: ['eval_date'], order: [['eval_date', 'DESC']], limit: Number(limit) || 500, raw: true,
  });
  return rows.map(r => ({ date: String(r.eval_date).slice(0, 10), count: Number(r.count) }));
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

/**
 * 展示名一律以本地股票库为准（按代码查）：实时行情带回的证券简称会带 XD / N / ST 等临时标记、还可能被截断（如「XD长飞光」），
 * 只用作股票库里也查不到时的兜底。跟行情接口打交道一律传代码，不依赖名称。
 */
async function resolveStockName(code, fallback = '') {
  const c = String(code || '').trim();
  if (c) {
    const hit = await lookupStock(c);
    if (hit && hit.name) return hit.name;
    const pool = await FortuneStock.findOne({ where: { symbol: c } });
    if (pool && pool.name) return pool.name;
  }
  return fallback || '';
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

/** 清空股票池（新的一天重来）；不影响已落库的评估/榜单 */
async function clearStocks() {
  const n = await FortuneStock.destroy({ where: {} });
  return { ok: true, removed: n };
}

/**
 * 批量加入股票池（带板块）。逐条复用 addStock（名称留空自动从股票库补全）。
 * items: [{symbol, name?, sector?}]。返回汇总 + 成功加入的清单（供前端直接发起批量打分）。
 */
async function addStocks(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return { ok: false, error: '没有可加入的股票' };
  if (list.length > 200) return { ok: false, error: `单次最多 200 只，当前 ${list.length} 只` };
  const added = []; const updated = []; const notFound = []; const invalid = [];
  for (const it of list) {
    const code = String((it && (it.symbol || it.code)) || '').replace(/\D/g, '').slice(0, 6);
    if (!/^\d{6}$/.test(code)) { invalid.push({ input: (it && (it.symbol || it.code)) || '', error: '代码非 6 位数字' }); continue; }
    const r = await addStock({ symbol: code, name: (it && it.name) || '', sector: (it && it.sector) || '' });
    if (!r.ok) { invalid.push({ input: code, error: r.error }); continue; }
    const row = { symbol: code, name: r.data.name || '', sector: (it && it.sector) || '' };
    if (r.updated) updated.push(row); else added.push(row);
    if (r.notFound) notFound.push(code);
  }
  const stocks = [...added, ...updated];
  return { ok: true, data: { added: added.length, updated: updated.length, notFound, invalid, stocks } };
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

/**
 * 把配置里的 module_params（买入阈值）+ 生效 sell_params（衰竭阈值）写成临时参数文件下发给 Python。
 * 买入侧 fp_compute 未开且无衰竭参数时不下发；fp_sell_compute 只在本服务调用里开启（追资金自己调用不带 → 零开销）。
 */
function writeFortuneParamsFile(tag, cfg, sellCfg) {
  const params = { ...((cfg && cfg.module_params) || {}) };
  if (sellCfg && sellCfg.sellParams && Object.keys(sellCfg.sellParams).length) {
    Object.assign(params, sellCfg.sellParams);
    params.fp_sell_compute = true;
  }
  if (!params.fp_compute && !params.fp_sell_compute) return '';
  try {
    if (!fs.existsSync(SCRATCH_DIR)) fs.mkdirSync(SCRATCH_DIR, { recursive: true });
    const file = path.join(SCRATCH_DIR, `fp_${tag}_${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(params), 'utf-8');
    return file;
  } catch (e) {
    console.error('⚠️ [招财进宝] 阈值参数文件写入失败（Python 将退回内置默认）:', e.message);
    return '';
  }
}

/** 有参数文件才追加 --params-file（空串会被 argparse 当成文件路径读，反而报噪声警告） */
function withParamsFile(args, paramsFile) {
  return paramsFile ? [...args, '--params-file', paramsFile] : args;
}

function unlinkQuiet(file) {
  if (!file) return;
  try { fs.unlinkSync(file); } catch (e) { /* 临时文件清理失败无妨 */ }
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

// 把 kline 拆成有序列数组；不足 30 根视为不可用（降级）。bars[i]=[开,收,低,高,量,额,换手,涨跌幅]
function klSeries(kline) {
  if (!kline || !Array.isArray(kline.bars) || kline.bars.length < 30) return null;
  const b = kline.bars;
  const col = i => b.map(r => N(r[i]));
  const ma = kline.ma || {};
  const macd = kline.macd || {};
  const arr = x => (Array.isArray(x) ? x.map(N) : null);
  return {
    n: b.length, O: col(0), C: col(1), L: col(2), H: col(3), V: col(4), P: col(7),
    ma20: arr(ma.ma20), ma30: arr(ma.ma30), dif: arr(macd.dif), dates: Array.isArray(kline.dates) ? kline.dates : null,
  };
}
function maxOf(a) { const f = (a || []).filter(x => x != null); return f.length ? Math.max(...f) : null; }
function minOf(a) { const f = (a || []).filter(x => x != null); return f.length ? Math.min(...f) : null; }
function avgOf(a) { const f = (a || []).filter(x => x != null); return f.length ? f.reduce((s, x) => s + x, 0) / f.length : null; }
// 末尾 dir 方向连续步数（dir=+1 递增 / -1 递减），从 index end 往前数
function consecTrend(arr, end, dir) {
  let cnt = 0;
  for (let i = end; i >= 1; i--) {
    const a = arr[i], b = arr[i - 1];
    if (a == null || b == null) break;
    if (dir > 0 ? a > b : a < b) cnt++; else break;
  }
  return cnt;
}
// 最近 k 步里 dir 方向占比（宽松：允许噪声，返回 up 次数与总次数）
function stepsCount(arr, end, k, dir) {
  let up = 0, tot = 0; const start = Math.max(1, end - k + 1);
  for (let i = start; i <= end; i++) {
    if (arr[i] == null || arr[i - 1] == null) continue;
    tot++; if (dir > 0 ? arr[i] > arr[i - 1] : arr[i] < arr[i - 1]) up++;
  }
  return { up, tot };
}
const f2 = v => (v == null ? '—' : Number(v).toFixed(2));
const f0 = v => (v == null ? '—' : Math.round(Number(v)).toLocaleString());
const numOr = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

/** 指数移动平均（B3 底背离在取不到流水线 DIF 时用于 JS 自行补算 MACD 12/26/9） */
function emaSeries(arr, period) {
  const k = 2 / (period + 1); let e = null;
  return (arr || []).map(v => { if (v == null) return e; e = e == null ? v : v * k + e * (1 - k); return e; });
}
/** DIF = EMA12 − EMA26（与 Python calc_macd 同口径） */
function macdDifSeries(C) { const e12 = emaSeries(C, 12); const e26 = emaSeries(C, 26); return e12.map((v, i) => (v == null || e26[i] == null ? null : v - e26[i])); }
/** 最小二乘线性斜率（按「每根 % 变化」归一，便于不同价位/不同窗口比较） */
function linSlope(arr) {
  const a = (arr || []).filter(x => x != null);
  if (a.length < 4) return null;
  const k = a.length; let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < k; i++) { sx += i; sy += a[i]; sxy += i * a[i]; sxx += i * i; }
  const den = k * sxx - sx * sx;
  const mean = sy / k;
  if (!den || !mean) return null;
  const slope = (k * sxy - sx * sy) / den;
  return { slope, pctPerBar: slope / mean * 100 };
}
/** 总体标准差（B6 布林带在 JS 侧自算，流水线不输出 BOLL） */
function stdDev(arr) {
  const a = (arr || []).filter(x => x != null);
  if (a.length < 4) return null;
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length);
}

/** 道氏理论：基于连续 60 根日线序列精确判定 HH+HL / 回调 / 突破量能 / MA30 多头背景（满分100） */
function autoScoreDow(kline, ind, cfg) {
  const items = [];
  const s = klSeries(kline);
  let degraded = false;
  if (s) {
    const n = s.n, price = s.C[n - 1];
    // D1 三段高低点依次抬升
    const win = Math.min((Number(cfg && cfg.dow_window) || 60), n);
    const seg = Math.floor(win / 3), i0 = n - win;
    const hSeg = [0, 1, 2].map(k => maxOf(s.H.slice(i0 + k * seg, i0 + (k + 1) * seg)));
    const lSeg = [0, 1, 2].map(k => minOf(s.L.slice(i0 + k * seg, i0 + (k + 1) * seg)));
    const okH = hSeg.every(x => x != null) && hSeg[2] > hSeg[1] && hSeg[1] > hSeg[0];
    const okL = lSeg.every(x => x != null) && lSeg[2] > lSeg[1] && lSeg[1] > lSeg[0];
    const d1 = okH && okL;
    items.push({ id: 'd1', label: '上升趋势成立（HH+HL）', points: 40, met: d1, detail: `三段高点 ${hSeg.map(f2).join(' → ')}；三段低点 ${lSeg.map(f2).join(' → ')}` });
    // D2 近 20 根最后一波回调有效低点未破
    const l20L = s.L.slice(n - 20), l20C = s.C.slice(n - 20);
    let pk = 0, pv = -Infinity;
    for (let i = 0; i < l20C.length; i++) { if (l20C[i] != null && l20C[i] > pv) { pv = l20C[i]; pk = i; } }
    const after = l20L.slice(pk); const swingLow = minOf(after.length ? after : l20L);
    const d2 = swingLow != null && price != null && price > swingLow;
    items.push({ id: 'd2', label: '回调不破有效前低', points: 20, met: d2, detail: swingLow != null ? `现价 ${f2(price)} vs 回调有效低 ${f2(swingLow)}` : '数据不足' });
    // D3 突破阶段高点需放量；未突破不扣分
    const stageHigh = maxOf(s.H.slice(n - Math.min(60, n)));
    const atBreak = stageHigh != null && price != null && price >= stageHigh * 0.99;
    let d3, d3detail;
    if (atBreak) {
      const avg20V = avgOf(s.V.slice(n - 21, n - 1)), todayV = s.V[n - 1];
      d3 = avg20V != null && todayV != null && todayV >= avg20V * 1.1;
      d3detail = `突破阶段高 ${f2(stageHigh)}，当日量 ${f0(todayV)} vs 20日均量 ${f0(avg20V)}（需≥1.1×）`;
    } else { d3 = true; d3detail = `现价 ${f2(price)} 未处于突破位（阶段高 ${f2(stageHigh)}），不扣分`; }
    items.push({ id: 'd3', label: '突破有量能配合', points: 20, met: d3, detail: d3detail });
    // D4 收盘>MA30 且 MA30 向上
    const m = s.ma30 ? s.ma30[n - 1] : null, mp = s.ma30 ? s.ma30[n - 2] : null;
    const d4 = price != null && m != null && mp != null && price > m && m > mp;
    items.push({ id: 'd4', label: '大周期背景向上（价>MA30且MA30向上）', points: 20, met: d4, detail: (price != null && m != null) ? `收盘 ${f2(price)} vs MA30 ${f2(m)}（${m > mp ? '向上' : '走平/向下'}）` : '数据不足' });
  } else {
    degraded = true;
    const price = N(ind.price), dow = ind.dow || '';
    const high20 = N(ind.high20), volEst = N(ind.vol_ratio_est), maLong = N(ind.ma_long_v), maLongPrev = N(ind.ma_long_prev);
    const recentLow = N(ind.recent_low), todayNewLow = !!ind.today_new_low20;
    items.push({ id: 'd1', label: '上升趋势成立（HH+HL）', points: 40, met: dow === 'UP', degraded: true, detail: `道氏分段判定=${dow || '—'}【数据降级近似判定】` });
    const d2 = !todayNewLow && (recentLow == null || price == null || price > recentLow * 0.97);
    items.push({ id: 'd2', label: '回调不破有效前低', points: 20, met: d2, degraded: true, detail: todayNewLow ? '当日创 20 日新低' : (recentLow != null && price != null ? `现价 ${f2(price)} vs 近 10 日低 ${f2(recentLow)}` : '数据不足') + '【数据降级近似判定】' });
    const atHigh = high20 != null && price != null && price >= high20 * 0.99;
    const d3 = atHigh ? (volEst != null && volEst >= 1.1) : true;
    items.push({ id: 'd3', label: '突破有量能配合', points: 20, met: d3, degraded: true, detail: (atHigh ? `近 20 日高位，折算量 ${volEst == null ? '—' : volEst.toFixed(2)}×（≥1.1×）` : '未创新高，不扣分') + '【数据降级近似判定】' });
    const d4 = maLong != null && price != null && maLongPrev != null && price > maLong && maLong > maLongPrev;
    items.push({ id: 'd4', label: '大周期背景向上（价>MA30且MA30向上）', points: 20, met: d4, degraded: true, detail: (maLong != null && price != null) ? `现价 ${f2(price)} vs MA30 ${f2(maLong)}（${maLong > maLongPrev ? '向上' : '走平/向下'}）【数据降级近似判定】` : '数据不足' });
  }
  const earned = items.reduce((sum, x) => sum + (x.met ? x.points : 0), 0);
  return { score: Math.max(0, Math.min(100, Math.round(earned))), items, degraded };
}

/** 葛兰碧八大法则：基于连续 120 根日线序列精确判定 B1~B4 正向买点（累加封顶100）→ 扣 S1~S4+乖离+背离（下限0） */
function autoScoreGranville(kline, ind, cfg) {
  const items = [];
  const s = klSeries(kline);
  let degraded = false;
  let positive = 0, deduction = 0;
  const push = (id, label, type, points, met, detail) => {
    items.push({ id, label, type, points, met, detail, degraded });
    if (met) { if (points > 0) positive += points; else deduction += points; }
  };

  if (s) {
    const n = s.n;
    const price = s.C[n - 1], open = s.O[n - 1], prev = s.C[n - 2], prevLow = s.L[n - 2];
    const todayVol = s.V[n - 1], prevVol = s.V[n - 2], pct = s.P[n - 1];
    const ma = s.ma20;
    const maL = ma ? ma[n - 1] : null, maP = ma ? ma[n - 2] : null, maP2 = ma ? ma[n - 3] : null;
    const bullish = (open != null && price != null) ? price > open : (pct != null ? pct > 0 : null);
    const bearish = bullish == null ? null : !bullish;
    const maUp = maL != null && maP != null && maL > maP;
    const maDown = maL != null && maP != null && maL < maP;
    const minLow5 = minOf(s.L.slice(n - 5));
    const maxHigh5 = maxOf(s.H.slice(n - 5));
    const avg5V = avgOf(s.V.slice(n - 6, n - 1)); // 前 5 日均量（不含今日）

    // B1 底部拐点启动
    const declineRun = ma ? consecTrend(ma, n - 2, -1) : 0;
    const b1 = declineRun >= 10 && maL != null && maP != null && maL >= maP
      && price != null && open != null && price > maL && price > open
      && todayVol != null && avg5V != null && todayVol > avg5V;
    push('B1', '底部拐点启动买点', 'buy_point', 25, b1, `MA20 前段连降 ${declineRun} 根；收盘 ${f2(price)} vs MA20 ${f2(maL)}，量 ${f0(todayVol)} vs 5日均量 ${f0(avg5V)}`);

    // B2 趋势回踩支撑（放宽：不再卡死 0~3%）
    const riseSteps = ma ? stepsCount(ma, n - 1, 10, +1) : { up: 0, tot: 0 };
    const b2 = riseSteps.up >= 8 && minLow5 != null && maL != null && minLow5 >= maL * 0.97 && minLow5 <= maL * 1.05
      && bullish === true;
    push('B2', '趋势中途回踩支撑买点', 'buy_point', 25, b2, `MA20 近10根 ${riseSteps.up}/10 上行；近5低 ${f2(minLow5)} vs MA20 ${f2(maL)}（不破×0.97），当日${bullish === true ? '收阳' : '未收阳'}`);

    // B3 远离后回落守均线
    let farDev = 0, peakIdx = -1;
    if (ma) { for (let i = n - 20; i < n; i++) { if (i < 1) continue; const c = s.C[i], m = ma[i]; if (c != null && m != null) { const dv = c / m - 1; if (dv > farDev) { farDev = dv; peakIdx = i; } } } }
    const b3 = farDev > 0.06 && minLow5 != null && maL != null && minLow5 >= maL * 0.97 && bullish === true && peakIdx >= 0 && peakIdx < n - 1;
    push('B3', '远离均线后良性回调加仓点', 'buy_point', 25, b3, `近20根最大乖离 ${(farDev * 100).toFixed(1)}%（>6%）；回调低 ${f2(minLow5)} vs MA20 ${f2(maL)}，当日${bullish === true ? '收阳' : '未收阳'}`);

    // B4 假跌破洗盘
    const b4 = maUp && prevLow != null && maP != null && prevLow < maP
      && price != null && maL != null && price > maL
      && prevVol != null && avg5V != null && prevVol <= avg5V
      && todayVol != null && prevVol != null && todayVol >= prevVol;
    push('B4', '假跌破洗盘买点', 'buy_point', 25, b4, `昨低 ${f2(prevLow)} 下穿 MA20 ${f2(maP)}，今收 ${f2(price)} 收回 ${f2(maL)}；昨量 ${f0(prevVol)} 今量 ${f0(todayVol)}`);

    // S1 均线拐头破位
    const s1 = maDown && maP != null && maP2 != null && maP >= maP2 && price != null && maL != null && price < maL;
    push('S1', '均线拐头破位否决', 'risk', -30, s1, `MA20 ${f2(maP)}→${f2(maL)} 拐头向下 + 收盘 ${f2(price)} 跌破`);

    // S2 反弹承压
    const s2 = maDown && price != null && maL != null && price < maL && maxHigh5 != null && maxHigh5 >= maL * 0.99 && bearish === true;
    push('S2', '反弹承压回落', 'risk', -20, s2, `MA20 向下，近5高 ${f2(maxHigh5)} 触及 MA20 ${f2(maL)} 受阻，当日${bearish === true ? '收阴' : '未收阴'}`);

    // S3 弱势中继反弹
    const fallRun = ma ? consecTrend(ma, n - 1, -1) : 0;
    const s3 = fallRun >= 3 && maxHigh5 != null && maL != null && maxHigh5 < maL * 0.97;
    push('S3', '弱势中继反弹', 'risk', -15, s3, `MA20 连降 ${fallRun} 根，近5高 ${f2(maxHigh5)} 够不到 MA20 ${f2(maL)}`);

    // S4 假突破诱多
    const s4 = maL != null && maP2 != null && maL < maP2 && prev != null && maP != null && prev >= maP && price != null && price < maL;
    push('S4', '假突破诱多', 'risk', -20, s4, `MA20 向下，昨收 ${f2(prev)} 站上 ${f2(maP)}，今收 ${f2(price)} 跌回 ${f2(maL)}`);

    // EXT 乖离过大
    const devPct = (maL != null && price != null) ? (price / maL - 1) : null;
    const ext = devPct != null && devPct > 0.08;
    push('EXT', '乖离过大（追高警示）', 'risk', -15, ext, `乖离 ${devPct == null ? '—' : (devPct * 100).toFixed(1)}%（>8% 触发）`);

    // DVG 量价背离
    const maxC20 = maxOf(s.C.slice(n - 20));
    const atNewHigh = maxC20 != null && price != null && price >= maxC20 * 0.99;
    const dvg = atNewHigh && todayVol != null && avg5V != null && todayVol < avg5V * 0.8;
    push('DVG', '量价背离', 'risk', -15, dvg, atNewHigh ? `收盘创近20高 ${f2(price)}，但量 ${f0(todayVol)} < 5日均量80%(${f0(avg5V != null ? avg5V * 0.8 : null)})` : '未创阶段新高，无背离');

    const score = Math.max(0, Math.min(100, positive + deduction));
    return { score: Math.round(score), items, veto: false, degraded: false, positive, deduction };
  }

  // 降级：kline 不可用，用 indicators 近似
  degraded = true;
  const price = N(ind.price), maV = N(ind.ma_mid_v), maPrev = N(ind.ma_mid_prev);
  const volEst = N(ind.vol_ratio_est), high20 = N(ind.high20), pct = N(ind.today_pct);
  const bullish = pct != null ? pct > 0 : null;
  const rising = maV != null && maPrev != null && maV > maPrev;
  const falling = maV != null && maPrev != null && maV < maPrev;
  const flat = maV != null && maPrev != null && Math.abs(maV - maPrev) / maV * 100 < 0.3;
  const above = maV != null && price != null && price > maV;
  const atHigh = high20 != null && price != null && price >= high20 * 0.99;
  const overextend = maV != null && price != null && (price / maV - 1) > 0.08;
  const diverge = atHigh && volEst != null && volEst < 1.0;
  const nearMa = maV != null && price != null && price >= maV * 0.97 && price <= maV * 1.05;
  const pushD = (id, label, type, points, met, detail) => push(id, label, type, points, met, detail + '【数据降级近似判定】');
  const s1d = falling && above === false;
  pushD('B1', '底部拐点启动买点', 'buy_point', 25, (flat || rising) && above && bullish === true && volEst != null && volEst >= 1, 'MA20 走平/上拐+阳线站上');
  pushD('B2', '趋势中途回踩支撑买点', 'buy_point', 25, rising && nearMa && bullish === true, '价近 MA20 不破且收阳');
  pushD('B3', '远离均线后良性回调加仓点', 'buy_point', 25, rising && nearMa && bullish === true && !atHigh, '远离后回落守 MA20');
  pushD('B4', '假跌破洗盘买点', 'buy_point', 25, rising && above && bullish === true && volEst != null && volEst >= 1, '昨破今收回（近似）');
  pushD('S1', '均线拐头破位否决', 'risk', -30, s1d, 'MA20 向下 + 价跌破');
  pushD('S2', '反弹承压回落', 'risk', -20, false, '序列不足，近似难判');
  pushD('S3', '弱势中继反弹', 'risk', -15, falling && price != null && maV != null && price < maV * 0.95, '弱势反抽');
  pushD('S4', '假突破诱多', 'risk', -20, false, '序列不足，近似难判');
  pushD('EXT', '乖离过大（追高警示）', 'risk', -15, overextend, '乖离>8%');
  pushD('DVG', '量价背离', 'risk', -15, diverge, '新高量不足');
  const score = Math.max(0, Math.min(100, positive + deduction));
  return { score: Math.round(score), items, veto: s1d, degraded: true, positive, deduction };
}

/**
 * 把脚本 fortune_modules 交回的「事实 + 命中」按配置分值折算成模块 0~100 分（本函数不看阈值、只看分值）
 *  - accumulate（M3 量价 / M4 均线）：命中项分值求和，风险项负分，下限 0、封顶 100
 *  - tier（M5 DMI / M6 斐波那契 / M7 箱体 / M8 蜡烛）：只命中一个档位，取该档 points 作模块分
 *  - 脚本没返回该模块 / 档位为 null（数据不足）→ score=null + unavailable，computeScore 会把它连权重一起从分母剔除
 */
function foldFortuneModule(mod, criterion) {
  const cfgItems = (criterion && Array.isArray(criterion.items)) ? criterion.items : [];
  const srcById = {};
  for (const it of ((mod && Array.isArray(mod.items)) ? mod.items : [])) srcById[it.id] = it;
  if (!mod || typeof mod !== 'object') {
    return {
      score: null, unavailable: true, items: cfgItems.map(it => ({ ...it, met: false })),
      note: '本次未取到该模块判定（脚本未返回 fortune_modules），权重已从总分分母剔除',
    };
  }
  const facts = mod.facts || null;
  const stateLabel = mod.state_label || null;
  if (mod.model === 'tier') {
    const state = mod.state || null;
    if (!state) {
      return {
        score: null, unavailable: true, items: cfgItems.map(it => ({ ...it, met: false })), facts,
        note: mod.note || '日线序列不足/数据缺失，无法判定该模块，权重已从总分分母剔除',
      };
    }
    const hit = cfgItems.find(it => it.id === state) || {};
    const items = cfgItems.map(it => ({
      id: it.id, label: it.label || it.id, type: 'tier', points: Number(it.points) || 0,
      met: it.id === state, detail: it.id === state ? (srcById[state] && srcById[state].detail) || '' : (it.desc || ''),
      degraded: !!it.degraded,
    }));
    return { score: Math.max(0, Math.min(100, Number(hit.points) || 0)), items, state, facts, state_label: stateLabel };
  }
  // accumulate
  let sum = 0;
  const items = cfgItems.map(it => {
    const src = srcById[it.id] || {};
    const points = Number(it.points) || 0;
    const met = !!src.met;
    if (met) sum += points;
    return {
      id: it.id, label: it.label || it.id, type: it.type || (points < 0 ? 'risk' : 'buy_point'),
      points, met, detail: src.detail || it.desc || '', degraded: !!it.degraded,
    };
  });
  return { score: Math.max(0, Math.min(100, Math.round(sum))), items, facts, state_label: stateLabel };
}

/** 衰竭等级分档（sell_bands：低/轻/中/重度衰竭） */
function resolveSellBand(total, sellBands) {
  if (total == null) return null;
  const list = sellBands && sellBands.length ? sellBands : (readConfig() || {}).sell_bands || [];
  const hit = list.find(b => total >= Number(b.min) && total < Number(b.max));
  const last = list[list.length - 1];
  const h = hit || last;
  return h ? { code: h.code, label: h.label, color: h.color, icon: h.icon || '', advice: h.advice || '' } : null;
}

/**
 * 把脚本 sell_modules 交回的 W1～W8「事实+命中」按库中分值折算衰竭总分 0～100（Python 不算分，分值/开关在配置与库）
 *  - 子项命中即得满分；w1_1 按 Python level 取 tiers 分档（封顶 item.points）
 *  - 关闭的组不计分也不计入模式 A 分母；applicable=false（无清晰波段/箱体结构、非高位）的组不生效不计分
 *  - 模式 A（推荐）：raw ÷ 启用且适用子项满分 ×100；模式 B：直接累加封顶 100
 *  - sellMods 整体缺失（fp_sell_compute 未下发或日线不足）→ total=null，页面按「未判定」展示
 */
function foldSellModules(sellMods, sellCriteria, sellCfg) {
  const mode = String(((sellCfg || {}).sellScoring || {}).mode || 'A').toUpperCase() === 'B' ? 'B' : 'A';
  const bands = (sellCfg || {}).sellBands || [];
  const groups = [];
  let raw = 0; let maxPoints = 0; let hitCount = 0;
  let anyAvailableGroup = false;
  for (const c of sellCriteria || []) {
    const cfgItems = Array.isArray(c.items) ? c.items : [];
    const src = sellMods && sellMods[c.code];
    const available = !!sellMods && !!src;
    if (available) anyAvailableGroup = true;
    const applicable = available && src.applicable !== false;
    const srcById = {};
    for (const it of (available && Array.isArray(src.items) ? src.items : [])) srcById[it.id] = it;
    let earned = 0;
    let groupMax = 0;
    const items = cfgItems.map(it => {
      const s = srcById[it.id] || {};
      const points = Number(it.points) || 0;
      const met = !!(applicable && c.enabled && s.met);
      const isTiered = Array.isArray(it.tiers) && it.tiers.length;
      let pt = 0;
      if (met) {
        if (isTiered) {
          const lv = Math.max(0, Math.min(Number(s.level) || 0, it.tiers.length));
          pt = Math.min(points, Number(it.tiers[lv - 1]) || 0);
        } else pt = points;
      }
      if (c.enabled && applicable) groupMax += points;
      earned += pt;
      if (met && pt > 0) hitCount++;
      return {
        id: it.id, label: it.label || it.id, points,
        tiers: isTiered ? it.tiers : undefined,
        level: isTiered ? Number(s.level) || 0 : undefined,
        met, earned: pt, detail: s.detail || it.desc || '',
      };
    });
    if (c.enabled && applicable) maxPoints += groupMax;
    raw += earned;
    groups.push({
      code: c.code, name: c.name, enabled: !!c.enabled,
      available, applicable, note: (src && src.note) || (available ? '' : (sellMods ? '本次未取到该组判定' : '本次未返回 sell_modules（未开启衰竭判定或日线不足）')),
      earned, groupMax, items, facts: (src && src.facts) || null,
    });
  }
  if (!sellMods || !anyAvailableGroup) {
    return { total: null, mode, raw: null, maxPoints: 0, hitCount: 0, unavailable: true, band: null, groups,
      note: '本次未取到衰竭判定（脚本未返回 sell_modules 或日线不足）' };
  }
  let total;
  if (mode === 'A') total = maxPoints > 0 ? Math.min(100, Math.round(raw / maxPoints * 100)) : 0;
  else total = Math.min(100, raw);
  return { total, mode, raw, maxPoints, hitCount, unavailable: false, band: resolveSellBand(total, bands), groups, note: '' };
}

/** 反转分级分档（reversal_bands：无信号 / 初步止跌观察 / 具备反转条件 / 共振候选） */
function resolveReversalBand(total, bands) {
  if (total == null) return null;
  const list = bands && bands.length ? bands : (readConfig() || {}).reversal_bands || [];
  const hit = list.find(b => total >= Number(b.min) && total < Number(b.max));
  const last = list[list.length - 1];
  const h = hit || last;
  return h ? { code: h.code, label: h.label, color: h.color, icon: h.icon || '', advice: h.advice || '' } : null;
}

/**
 * B7 筹码事实：只用精选轮 --with-chip 拉回的真实接口数据（东财 stock_cyq_em），绝不做日线近似估算
 *  chipStage：pre_filter 粗筛（本轮不请求）/ select 精选 / single 单票手动重算 / history 历史时间点（口径不匹配，不请求）
 *  取不到数据一律不计分，但按场景给不同标注，避免把「没请求」写成「接口失败」
 */
function chipReversalFact(chip, rp, chipStage) {
  const pMax = numOr(rp.bp_chip_profit_max, 20);
  const upMax = numOr(rp.bp_chip_pressure_max, 12);
  const rawProfit = chip && chip.profit_ratio != null ? Number(chip.profit_ratio) : null;
  const pressure = chip && chip.pressure_dist_pct != null ? Number(chip.pressure_dist_pct) : null;
  const profit = Number.isFinite(rawProfit) ? (rawProfit <= 1 ? rawProfit * 100 : rawProfit) : null; // 接口偶发小数占比，统一成百分数
  const upper = chip && chip.cost_90_upper != null ? Number(chip.cost_90_upper) : null;
  if (profit != null && pressure != null) {
    const met = profit <= pMax && pressure <= upMax;
    return {
      met, ok: true, source: 'real_api',
      facts: {
        profit_pct: Number(profit.toFixed(2)), pressure_dist_pct: pressure, cost_90_upper: Number.isFinite(upper) ? upper : null,
        as_of: chip.as_of || '', api: chip.source || '东方财富 stock_cyq_em',
      },
      detail: `获利比例 ${profit.toFixed(1)}%（需≤${pMax}%）｜90% 成本上沿 ${f2(upper)} 距现价 ${pressure.toFixed(1)}%（需≤${upMax}%）｜${chip.as_of || '—'}【真实筹码接口】`,
    };
  }
  let reason;
  if (chipStage === 'history') reason = '历史时间点不请求实时筹码（接口只有最新数据，口径不匹配），该项不计分';
  else if (chipStage === 'pre_filter') reason = '粗筛未拉取筹码，该项不计分';
  else if (!chip) reason = '该股道氏判定为趋势池（A 池），流水线按口径不请求筹码接口，该项不计分';
  else reason = '筹码接口获取失败，该项不计分';
  return { met: false, ok: false, source: chip ? 'failed' : 'none', facts: null, detail: reason };
}

/**
 * B1 乖离档位文案：lv=0 时不写「达 未达轻度 档」这种读不懂的话，而是说清到底是正乖离（在均线上方）还是负乖离不够
 */
function b1Detail(bias, lv, refN, maV, price, p) {
  const head = `收盘 ${f2(price)} vs MA${refN} ${f2(maV)}：乖离 ${bias == null ? '—' : `${bias.toFixed(2)}%`}`;
  if (bias == null) return `${head}（缺参考均线数值，无法判定）`;
  if (lv === 0) return bias >= 0 ? `${head}（收盘在均线上方，不存在超跌负乖离）` : `${head}（负乖离未达轻度门槛 ${numOr(p.bp_bias_light, -5)}%）`;
  return `${head}（达 ${['', '轻度超跌', '明显超跌', '深度超跌'][lv]} 档）`;
}

/**
 * 超跌反转买入分 B（B1～B7）：Node 侧按连续 120 根日线序列 + 真实筹码判定，命中子项分值累加封顶 100
 *  - 整组前置：现价距 60 日高回撤 ≥ bp_drawdown_min_pct%（默认 15%），否则视为「没有清晰底部结构、只是中途小反弹」，B1～B7 全不计分
 *  - 分值与开关取库中 reversal_auto 组（配置页可改），阈值取 rp（reversal_params，可被 SystemConfig 覆盖）
 *  - tier 子项按 level 取一档（B1 6/12/18）；exclusive 组内互斥取最高一档（B5 单根 6 / 组合 14）
 *  - 取不到序列时降级：只按 indicators 近似 B1/B2_2/B4_1/B7，其余标注「序列不足无法判定」
 *  - 输出与 autoScoreDow / foldSellModules 同风格：{ total, band, groups:[{code,items:[{id,label,points,met,earned,detail,theory,facts}]}], ... }
 */
function autoScoreReversal(kline, ind, chip, rp, reversalCriteria, chipStage = 'pre_filter', revBands = null) {
  const p = rp || {};
  const jd = {};     // item_id -> { met, level, detail, facts }：纯判定结果，不含开关/分值
  const pre = {};    // group code -> { applicable, note }：数据是否够判、前置条件是否成立
  const dd = v => (v == null ? '—' : Number(v).toFixed(4)); // DIF 数值展示（4 位小数）
  let degraded = false;
  const chipFact = chipReversalFact(chip, p, chipStage);
  jd.b7_1 = { met: chipFact.met, detail: chipFact.detail, facts: chipFact.facts };
  pre.b7 = { applicable: true, note: '' };
  let oversold = null;
  let drawdown = null;
  let distLow = null;
  let gateNote = '';   // 未达超跌前置时的具体数值说明（回撤 % / 门槛 %），给整组 note 与页面黄底提示用
  const s = klSeries(kline);

  if (s) {
    const n = s.n;
    const price = s.C[n - 1]; const open = s.O[n - 1];
    const todayVol = s.V[n - 1]; const pct = s.P[n - 1];
    const bullish = (open != null && price != null) ? price > open : (pct != null ? pct > 0 : null);
    const refN = numOr(p.bp_ma_bias_ref, 20);
    const maRef = refN === 30 ? s.ma30 : s.ma20;
    const w60 = Math.min(60, n);
    const high60 = maxOf(s.H.slice(n - w60));
    const low60 = minOf(s.L.slice(n - w60));
    drawdown = high60 != null && price != null ? (high60 - price) / high60 * 100 : null;
    distLow = low60 != null && price != null ? (price - low60) / low60 * 100 : null;
    const ddMin = numOr(p.bp_drawdown_min_pct, 15);
    oversold = drawdown != null && drawdown >= ddMin;
    gateNote = oversold ? '' : `非超跌状态：现价 ${f2(price)} 距 ${w60} 日高 ${f2(high60)} 只回撤 ${drawdown == null ? '—' : drawdown.toFixed(1)}%（需 ≥${ddMin}%），视为上升趋势中的中途回调，B1～B7 全部不计分`;

    // ---- B1 超跌乖离（三档取一）----
    const maV = maRef ? maRef[n - 1] : null;
    const bias = maV != null && price != null ? (price / maV - 1) * 100 : null;
    const lv = bias == null ? 0 : bias <= numOr(p.bp_bias_severe, -12) ? 3 : bias <= numOr(p.bp_bias_mid, -8) ? 2 : bias <= numOr(p.bp_bias_light, -5) ? 1 : 0;
    jd.b1_1 = {
      met: lv > 0, level: lv, facts: { bias_pct: bias == null ? null : Number(bias.toFixed(2)), [`ma${refN}`]: maV },
      detail: b1Detail(bias, lv, refN, maV, price, p),
    };
    pre.b1 = { applicable: bias != null, note: bias == null ? '缺参考均线数值，无法计算乖离' : '' };

    // ---- B2 下跌动能衰竭（斜率放缓 8 + 不再创新低 10，可叠加）----
    const sw = numOr(p.bp_slope_window, 10);
    const shrinkRatio = numOr(p.bp_slope_shrink_ratio, 0.7);
    const prevSl = n >= sw * 2 ? linSlope(s.C.slice(n - sw * 2, n - sw)) : null;
    const curSl = n >= sw ? linSlope(s.C.slice(n - sw)) : null;
    let b21 = false; let b21d;
    if (!prevSl || !curSl) b21d = `序列不足 ${sw * 2} 根，无法比较前后两段斜率`;
    else if (prevSl.slope >= 0) b21d = `前段斜率 ${prevSl.pctPerBar.toFixed(2)}%/根 非下跌段，谈不上「杀跌放缓」`;
    else {
      b21 = curSl.slope > prevSl.slope * shrinkRatio;
      const narrowed = prevSl.slope ? (1 - curSl.slope / prevSl.slope) * 100 : 0;
      const narrowedTxt = narrowed >= 0 ? `放缓 ${narrowed.toFixed(0)}%，需≥${((1 - shrinkRatio) * 100).toFixed(0)}%` : `反而扩大 ${(-narrowed).toFixed(0)}%（需≥${((1 - shrinkRatio) * 100).toFixed(0)}%）`;
      b21d = `近 ${sw} 根斜率 ${curSl.pctPerBar.toFixed(2)}%/根 vs 前段 ${prevSl.pctPerBar.toFixed(2)}%/根（${narrowedTxt}；转平/上拐亦算）`;
    }
    jd.b2_1 = { met: b21, facts: { slope_now: curSl ? Number(curSl.pctPerBar.toFixed(3)) : null, slope_prev: prevSl ? Number(prevSl.pctPerBar.toFixed(3)) : null }, detail: b21d };
    const flatB = numOr(p.bp_flat_bars, 2);
    const lowW = numOr(p.bp_low_window, 20);
    const priorLow = n >= flatB + lowW ? minOf(s.L.slice(n - flatB - lowW, n - flatB)) : null;
    const recentLow = minOf(s.L.slice(n - flatB));
    const b22 = priorLow != null && recentLow != null && recentLow > priorLow;
    jd.b2_2 = {
      met: b22, facts: { recent_low: recentLow, stage_low: priorLow },
      detail: priorLow == null ? '序列不足，无法取阶段低点' : `近 ${flatB} 根最低 ${f2(recentLow)} vs 前 ${lowW} 根阶段低 ${f2(priorLow)}（${b22 ? '不再击穿' : '仍在创新低'}）`,
    };
    pre.b2 = { applicable: !!(curSl || priorLow != null), note: curSl || priorLow != null ? '' : '日线序列过短，B2 无法判定' };

    // ---- B3 MACD 底背离（两个最低阶段低点比较，极值需两侧确认）----
    const dif = s.dif && s.dif.filter(x => x != null).length >= 30 ? s.dif : macdDifSeries(s.C);
    const look = Math.min(numOr(p.bp_div_lookback, 60), n);
    const wsc = numOr(p.bp_div_swing_window, 3);
    const dt = i => (s.dates && s.dates[i]) || `第 ${i + 1} 根`;
    const swingLows = [];
    for (let i = Math.max(n - look, wsc); i <= n - 1 - wsc; i++) {
      const v = s.L[i];
      if (v == null) continue;
      const seg = s.L.slice(i - wsc, i + wsc + 1).filter(x => x != null);
      if (seg.length !== wsc * 2 + 1) continue;
      if (v === Math.min(...seg) && seg.filter(x => x === v).length === 1) swingLows.push(i);
    }
    if (swingLows.length < 2) {
      pre.b3 = { applicable: false, note: `${look} 根窗口内没有两个可比的阶段低点（±${wsc} 根确认），无底部背离结构` };
      jd.b3_1 = { met: false, detail: pre.b3.note };
    } else {
      const byVal = swingLows.slice().sort((a, b) => s.L[a] - s.L[b]);
      const earlier = Math.min(byVal[0], byVal[1]);
      const later = Math.max(byVal[0], byVal[1]);
      const pA = s.L[earlier]; const pB = s.L[later];
      const dA = dif ? dif[earlier] : null; const dB = dif ? dif[later] : null;
      const madeNewLow = pB != null && pA != null && pB < pA;
      const met = madeNewLow && dA != null && dB != null && dB > dA;
      jd.b3_1 = {
        met, facts: { low1_date: dt(earlier), low1_price: pA, low1_dif: dA, low2_date: dt(later), low2_price: pB, low2_dif: dB },
        detail: `低点① ${dt(earlier)} 价 ${f2(pA)} / DIF ${dd(dA)}；低点② ${dt(later)} 价 ${f2(pB)} / DIF ${dd(dB)} → ${!madeNewLow ? '后一低点未创新低，不构成背离' : met ? '价创新低而 DIF 拾高，底背离成立' : 'DIF 同步走低，无背离'}`,
      };
      pre.b3 = { applicable: true, note: '' };
    }

    // ---- B4 低位放量异动（前置：长期缩量阴跌）----
    const mav20 = avgOf(s.V.slice(Math.max(0, n - 21), n - 1)); // 20 日均量（不含今日）
    const sd = numOr(p.bp_shrink_days, 5);
    const preV = s.V.slice(n - 1 - sd, n - 1);
    const shrinkAvg = avgOf(preV);
    const bearCnt = (() => { let c = 0; for (let i = n - 1 - sd; i <= n - 2; i++) { const o = s.O[i]; const c2 = s.C[i]; if (o == null || c2 == null) continue; if (c2 < o) c++; } return c; })();
    const shrinkOk = shrinkAvg != null && mav20 != null && shrinkAvg < mav20 * numOr(p.bp_shrink_vol_ratio, 0.7);
    const bearOk = bearCnt >= numOr(p.bp_shrink_bear_min, 3);
    const gate4 = shrinkOk && bearOk;
    const prevLow5 = minOf(s.L.slice(n - 1 - sd, n - 1));
    const noNewLow = prevLow5 == null || (s.L[n - 1] != null && s.L[n - 1] > prevLow5);
    const mildOk = gate4 && todayVol != null && mav20 != null && todayVol >= mav20 * numOr(p.bp_vol_mild_ratio, 1.2) && noNewLow;
    jd.b4_1 = {
      met: mildOk,
      facts: { shrink_avg: Math.round(shrinkAvg || 0), mav20: Math.round(mav20 || 0), today_vol: todayVol == null ? null : Math.round(todayVol), bear_bars: bearCnt },
      detail: !gate4 ? `前置未成立：近 ${sd} 根均量 ${f0(shrinkAvg)} vs MAV20 ${f0(mav20)}×${numOr(p.bp_shrink_vol_ratio, 0.7)}${shrinkOk ? '' : '（不算缩量阴跌）'}，收阴 ${bearCnt}/${sd} 根${bearOk ? '' : `（需≥${numOr(p.bp_shrink_bear_min, 3)}）`}`
        : `温和放量：当日量 ${f0(todayVol)} vs MAV20 ${f0(mav20)}（需≥${numOr(p.bp_vol_mild_ratio, 1.2)}×）且${noNewLow ? '未再创新低' : '仍在创新低'}`,
    };
    const breakHigh = maxOf(s.H.slice(n - 1 - numOr(p.bp_break_lookback, 5), n - 1));
    const breakOk = gate4 && todayVol != null && mav20 != null && todayVol >= mav20 * numOr(p.bp_vol_break_ratio, 1.5)
      && bullish === true && price != null && breakHigh != null && price > breakHigh;
    jd.b4_2 = {
      met: breakOk, facts: { break_high: breakHigh, need_ratio: numOr(p.bp_vol_break_ratio, 1.5) },
      detail: !gate4 ? '前置缩量阴跌未成立，本项不计分'
        : `量 ${f0(todayVol)} vs MAV20 ${f0(mav20)}（需≥${numOr(p.bp_vol_break_ratio, 1.5)}×）｜当日${bullish === true ? '收阳' : '未收阳'}｜收盘 ${f2(price)} vs 近 ${numOr(p.bp_break_lookback, 5)} 根高点 ${f2(breakHigh)}`,
    };
    pre.b4 = { applicable: gate4, note: gate4 ? '' : '前置「长期缩量阴跌」未成立，B4 两项均不计分' };

    // ---- B5 底部看涨 K 线组合（阶段低位才计分；单根 6 / 组合 14 互斥）----
    const rng = i => (s.H[i] != null && s.L[i] != null ? s.H[i] - s.L[i] : null);
    const bod = i => (s.O[i] != null && s.C[i] != null ? Math.abs(s.C[i] - s.O[i]) : null);
    const r1 = rng(n - 1); const b1v = bod(n - 1);
    let hammer = false;
    if (r1 != null && r1 > 0 && b1v != null) {
      const bodyEff = Math.max(b1v, r1 * 0.02);
      const lower = Math.min(s.O[n - 1], s.C[n - 1]) - s.L[n - 1];
      const upper = s.H[n - 1] - Math.max(s.O[n - 1], s.C[n - 1]);
      hammer = lower >= bodyEff * numOr(p.bp_candle_shadow_body_ratio, 2) && upper <= bodyEff * numOr(p.bp_candle_upper_body_ratio, 0.3);
    }
    const engulf = !!(s.O[n - 2] != null && s.C[n - 2] != null && price != null && open != null
      && s.C[n - 2] < s.O[n - 2] && price > open && price >= s.O[n - 2] && open <= s.C[n - 2]);
    const fractal = !!(s.L[n - 3] != null && s.L[n - 2] != null && s.L[n - 1] != null && s.C[n - 2] != null
      && s.L[n - 2] < s.L[n - 3] && s.L[n - 1] > s.L[n - 2] && price > s.C[n - 2]);
    const singleNames = [];
    if (fractal) singleNames.push('底分型');
    if (hammer) singleNames.push('锤子线');
    if (engulf) singleNames.push('看涨吞没');
    const r3 = rng(n - 3); const b3v = bod(n - 3); const r2 = rng(n - 2); const b2v = bod(n - 2);
    let morning = false;
    if (r3 && b3v != null && s.O[n - 3] != null && s.C[n - 3] != null && b2v != null && r2 != null && price != null && open != null) {
      const bar1Bear = s.C[n - 3] < s.O[n - 3] && b3v >= r3 * numOr(p.bp_morning_body_min, 0.5);
      const bar2Small = r2 > 0 && b2v <= r2 * numOr(p.bp_candle_star_body_max, 0.3) && s.C[n - 2] < s.C[n - 3];
      const bar3Bull = price > open && price >= s.C[n - 3] + (s.O[n - 3] - s.C[n - 3]) * numOr(p.bp_candle_body_pos_min, 0.6);
      morning = bar1Bear && bar2Small && bar3Bull;
    }
    const combo = morning || singleNames.length >= 2;
    const lowZonePct = numOr(p.bp_low_zone_pct, 15);
    const inLowZone = distLow != null && distLow <= lowZonePct;
    const gate5 = inLowZone;
    jd.b5_1 = {
      met: gate5 && singleNames.length === 1 && !combo,
      facts: { forms: singleNames.concat(morning ? ['启明星'] : []), dist_to_low_pct: distLow == null ? null : Number(distLow.toFixed(2)) },
      detail: !gate5 ? `前置未成立：现价距 60 日低 ${distLow == null ? '—' : `${distLow.toFixed(1)}%`} > ${lowZonePct}%，不在阶段低位`
        : `单根底部信号：${singleNames.join('、') || '无'}（命中 ${singleNames.length} 个）${morning ? '；另有启明星组合 → 升级计组合分' : ''}`,
    };
    jd.b5_2 = {
      met: gate5 && combo,
      facts: { morning_star: morning, form_count: singleNames.length },
      detail: !gate5 ? '前置阶段低位未成立，本项不计分'
        : combo ? `${morning ? '启明星三根组合确认' : `同时命中 ${singleNames.length} 个形态（${singleNames.join('、')}）`}，按组合计 14 分（与单根 6 分互斥）` : '未形成组合确认',
    };
    pre.b5 = { applicable: gate5, note: gate5 ? '' : '现价不在阶段低位（距 60 日低 > bp_low_zone_pct%），高位出现的反弹形态一律不计分' };

    // ---- B6 布林下轨支撑（触轨 + 当日不创新低 + 收盘回轨上，三条件同时）----
    const bper = numOr(p.bp_boll_period, 20);
    const bk = numOr(p.bp_boll_k, 2);
    const tailC = s.C.slice(n - Math.min(bper, n)).filter(x => x != null);
    const mid = avgOf(tailC);
    const sdv = stdDev(tailC);
    const lowerBand = mid != null && sdv != null ? mid - bk * sdv : null;
    const tol = numOr(p.bp_boll_tolerance_pct, 1) / 100;
    const touchBars = numOr(p.bp_boll_touch_bars, 3);
    const touched = lowerBand != null && s.L.slice(n - touchBars).some(x => x != null && x <= lowerBand * (1 + tol));
    const notLower = s.L[n - 1] != null && s.L[n - 2] != null && s.L[n - 1] >= s.L[n - 2];
    const backAbove = lowerBand != null && price != null && price > lowerBand;
    const b6 = touched && notLower && backAbove;
    jd.b6_1 = {
      met: b6, facts: { boll_mid: mid == null ? null : Number(mid.toFixed(3)), boll_lower: lowerBand == null ? null : Number(lowerBand.toFixed(3)), boll_std: sdv == null ? null : Number(sdv.toFixed(4)) },
      detail: lowerBand == null ? '序列不足，无法计算布林带'
        : `MA${bper} ${f2(mid)} − ${bk}σ ${f2(sdv)} = 下轨 ${f2(lowerBand)}｜近 ${touchBars} 根最低${touched ? '曾触及下轨（含 ±1% 容差）' : '未触及下轨'}｜当日最低 ${f2(s.L[n - 1])} ${notLower ? '不低于' : '低于'}昨低 ${f2(s.L[n - 2])}｜收盘 ${f2(price)} ${backAbove ? '站回' : '仍在'}下轨${backAbove ? '上方' : '下方'}`,
    };
    pre.b6 = { applicable: lowerBand != null, note: lowerBand == null ? '日线序列不足，无法计算布林带' : '' };
  } else {
    // 降级：没有连续序列，只按 indicators 近似可得项，其余明确标注无法判定
    degraded = true;
    const price = N(ind.price);
    const refV = N(ind.ma_mid_v);
    const high60 = N(ind.high60);
    const low60v = N(ind.low60);
    drawdown = high60 != null && price != null ? (high60 - price) / high60 * 100 : null;
    distLow = N(ind.dist_to_low_pct);
    if (distLow == null && low60v != null && price != null) distLow = (price - low60v) / low60v * 100;
    const ddMin = numOr(p.bp_drawdown_min_pct, 15);
    oversold = drawdown != null && drawdown >= ddMin;
    gateNote = oversold ? '' : `非超跌状态（60 日回撤 ${drawdown == null ? '—' : drawdown.toFixed(1)}%，需 ≥${ddMin}%），B1～B7 全部不计分`;
    const bias = refV != null && price != null ? (price / refV - 1) * 100 : null;
    const lv = bias == null ? 0 : bias <= numOr(p.bp_bias_severe, -12) ? 3 : bias <= numOr(p.bp_bias_mid, -8) ? 2 : bias <= numOr(p.bp_bias_light, -5) ? 1 : 0;
    jd.b1_1 = { met: lv > 0, level: lv, degraded: true, facts: { bias_pct: bias == null ? null : Number(bias.toFixed(2)) }, detail: `${b1Detail(bias, lv, 20, refV, price, p)}【数据降级近似判定】` };
    pre.b1 = { applicable: bias != null, note: bias == null ? '缺 MA20 数值' : '' };
    const noNewLow = !ind.today_new_low20 && (N(ind.recent_low) == null || price == null || price > N(ind.recent_low));
    jd.b2_1 = { met: false, degraded: true, detail: '降级口径无连续收盘价列，无法比较前后段斜率【数据降级近似判定】' };
    jd.b2_2 = { met: oversold && noNewLow, degraded: true, facts: { stage_low: N(ind.recent_low) }, detail: `${noNewLow ? '当日未创 20 日新低' : '当日仍创 20 日新低'}，现价 ${f2(price)} vs 近 10 日低 ${f2(N(ind.recent_low))}【数据降级近似判定】` };
    pre.b2 = { applicable: true, note: '斜率项需连续序列，降级只近似「不再创新低」【数据降级近似判定】' };
    jd.b3_1 = { met: false, degraded: true, detail: '降级口径无 MACD 序列，无法确认两段阶段低点背离，本项不计分【数据降级近似判定】' };
    pre.b3 = { applicable: false, note: '日线序列不足，B3 底背离无法判定' };
    const vr = N(ind.vol_ratio_est);
    const mild = vr != null && vr >= numOr(p.bp_vol_mild_ratio, 1.2) && noNewLow;
    jd.b4_1 = { met: false, degraded: true, facts: { vol_ratio: vr }, detail: `降级无法确认「长期缩量阴跌」前置（折算量 ${vr == null ? '—' : `${vr.toFixed(2)}×`}），本项不计分【数据降级近似判定】` };
    jd.b4_2 = { met: false, degraded: true, detail: '降级无法确认放量阳线突破前置，本项不计分【数据降级近似判定】' };
    pre.b4 = { applicable: false, note: '日线序列不足，B4 前置「缩量阴跌后放量」无法判定' };
    jd.b5_1 = { met: false, degraded: true, detail: '降级口径无逐根 K 线形态，本项不计分【数据降级近似判定】' };
    jd.b5_2 = { met: false, degraded: true, detail: '降级口径无逐根 K 线形态，本项不计分【数据降级近似判定】' };
    pre.b5 = { applicable: false, note: `现价距 60 日低 ${distLow == null ? '—' : `${distLow.toFixed(1)}%`}（需≤${numOr(p.bp_low_zone_pct, 15)}%），阶段低位前置不成立，降级也不判定 K 线形态` };
    jd.b6_1 = { met: false, degraded: true, detail: '降级口径无连续列，无法计算布林带下轨【数据降级近似判定】' };
    pre.b6 = { applicable: false, note: '日线序列不足，B6 无法判定' };
  }

  // ---- 按库中开关/分值折算：累加封顶 100，exclusive 组取组内最高一档 ----
  const groups = [];
  let raw = 0; let maxPoints = 0; let hitCount = 0; let enabledCount = 0;
  // 底层判定照实算，只是未达到整组前置时不计分：页面要能看出「结构成立但被前置拦住」，而不是「结构没成立」
  const gateReason = gateNote || `未达超跌前置（60 日回撤需 ≥${numOr(p.bp_drawdown_min_pct, 15)}%）`;
  for (const c of reversalCriteria || []) {
    const pr = pre[c.code] || { applicable: false, note: '本次无可用判定' };
    const applicable = oversold === true && pr.applicable !== false;
    const noteParts = [];
    if (oversold !== true) noteParts.push(gateReason);
    if (pr.applicable === false) noteParts.push(pr.note || '日线数据不足，本组本次无法判定');
    if (c.enabled) enabledCount++;
    const cfgItems = Array.isArray(c.items) ? c.items : [];
    let earned = 0; let groupMax = 0;
    const items = cfgItems.map(it => {
      const j = jd[it.id] || {};
      const points = Number(it.points) || 0;
      const isTiered = Array.isArray(it.tiers) && it.tiers.length;
      const met = !!(c.enabled && applicable && j.met);
      const hit = !!j.met;   // 只看结构判定本身是否成立，不受开关 / 整组前置影响
      let pt = 0;
      if (met) pt = isTiered ? Math.min(points, Number(it.tiers[Math.max(0, Math.min(Number(j.level) || 0, it.tiers.length)) - 1]) || 0) : points;
      groupMax += c.exclusive ? 0 : points;
      earned += pt;
      if (met && pt > 0) hitCount++;
      const blocked = hit && !met;   // 命中但不计分（整组前置不成立或该组已关闭）
      return {
        id: it.id, label: it.label || it.id, points, theory: it.theory || '',
        tiers: isTiered ? it.tiers : undefined, level: isTiered ? Number(j.level) || 0 : undefined,
        met, hit, blocked, earned: pt, degraded: !!j.degraded,
        detail: (blocked && j.detail)
          ? `${j.detail}　→ 本项判定成立，但${c.enabled ? '因整组前置未达而不计分' : '因该组开关已关闭而不计分'}`
          : (j.detail || (applicable ? it.desc || '' : pr.note || it.desc || '')),
        facts: j.facts || null,
      };
    });
    if (c.exclusive) groupMax = cfgItems.reduce((m, it) => Math.max(m, Number(it.points) || 0), 0);
    if (c.enabled) maxPoints += groupMax;
    raw += earned;
    groups.push({
      code: c.code, name: c.name, enabled: !!c.enabled, applicable,
      exclusive: !!c.exclusive, earned, groupMax, items,
      facts: items.reduce((acc, x) => (x.facts ? Object.assign(acc, { [x.id]: x.facts }) : acc), {}),
      note: applicable ? '' : noteParts.join('；'),
    });
  }
  const total = enabledCount ? Math.min(100, raw) : null;
  const band = resolveReversalBand(total, revBands);
  return {
    total, mode: 'accumulate', raw: enabledCount ? raw : null, maxPoints, hitCount, enabledCount,
    band, groups, oversold, drawdown_pct: drawdown == null ? null : Number(drawdown.toFixed(2)),
    dist_to_low_pct: distLow == null ? null : Number(distLow.toFixed(2)),
    gate_note: oversold === true ? '' : gateReason,
    degraded, unavailable: !enabledCount,
    chip: { stage: chipStage, source: chipFact.source, ok: !!chipFact.ok, detail: chipFact.detail, facts: chipFact.facts },
    note: enabledCount ? '' : 'B 反转组整组关闭（配置页「反转打分 B」打开后生效），B_score 与 S_B 记为未判定',
  };
}

/**
 * 新开仓综合分（两套并行、惩罚公式完全一致）：raw = 基础分×wA − 衰竭分×wB
 *  - 基础分取 A 买入分 → S_A（趋势池降序）；取 B 反转分 → S_B（反转池降序）
 *  - raw 钳位到 [-100×wB, 100×wA]（默认 [-20,80]）后加 100×wB（默认 +20），保留 1 位小数 → 输出恒定 0～100
 *  - 衰竭分越高扣分越多，惩罚已在公式内，不再需要旧的高位争议压制（veto）与硬拦截分流池
 *  - 任一入参为 null（衰竭未判定 / B 组关闭）→ 返回 null，页面按「未判定」展示
 */
function computeComposite(baseTotal, exhaustTotal, ov = {}) {
  if (ov.enabled === false || baseTotal == null || exhaustTotal == null) return null;
  const wA = numOr(ov.wA, 0.8) > 0 ? numOr(ov.wA, 0.8) : 0.8;
  const wB = numOr(ov.wB, 0.2) >= 0 ? numOr(ov.wB, 0.2) : 0.2;
  const base = Math.max(0, Math.min(100, Number(baseTotal) || 0));
  const exh = Math.max(0, Math.min(100, Number(exhaustTotal) || 0));
  const raw = base * wA - exh * wB;
  const score = Math.max(-100 * wB, Math.min(100 * wA, raw)) + 100 * wB;
  return { score: Number(score.toFixed(1)), raw: Number(raw.toFixed(1)), wA, wB };
}

/** 把一行 run_score/snapshot 结果折算成多模块加权得分（M1/M2 仍在 JS 判，M3~M8 取脚本 fortune_modules 事实）*/
async function scoreRow(row, ctx, opts = {}) {
  const { active, bands, all } = ctx;
  const ind = row.indicators || {};
  const kline = row.kline || null;
  const cfg = readConfig() || {};
  const dow = autoScoreDow(kline, ind, cfg);
  const gran = autoScoreGranville(kline, ind, cfg);
  const degraded = !!(dow.degraded || gran.degraded);
  const criterion_scores = {
    dow: { score: dow.score, auto: true, items: dow.items },
    granville: { score: gran.score, auto: true, items: gran.items },
  };
  const module_scores = { dow: dow.score, granville: gran.score };
  const mods = row.fortune_modules || null;
  // M1/M2 不搬进 Python：保证与历史评估记录口径可比；其余自动模块按脚本命中的事实 × 配置分值折算
  const list = (all && all.length) ? all : active;
  let missingModules = 0;
  for (const c of list) {
    if (c.type !== 'auto' || c.code === 'dow' || c.code === 'granville' || c.code === 'manual') continue;
    const folded = foldFortuneModule(mods && mods[c.code], c);
    folded.auto = true;
    folded.counted = active.some(x => x.code === c.code);
    // 关闭的模块不在 computeScore 的 details 里，顺手把名称/权重带上，详情页才能显示「权重 8%（未计入）」而不是 0%
    folded.name = c.name;
    folded.weight = c.weight;
    folded.enabled = !!c.enabled;
    criterion_scores[c.code] = folded;
    module_scores[c.code] = folded.score;
    if (folded.unavailable) missingModules++;
  }
  const { total, details, weightSum, usedWeight } = await computeScore(criterion_scores, active);
  const band = resolveBand(total, bands);
  // 衰竭止盈（W）：同一行流水线交回的 sell_modules 折算，不额外请求行情；两套综合分只服务榜单排序
  const sellRows = (ctx.sell && ctx.sell.criteria) || [];
  const sellCfg = (ctx.sell && ctx.sell.cfg) || {};
  const sell = foldSellModules(row.sell_modules || null, sellRows, sellCfg);
  // 超跌反转（B）：Node 侧按同一行 kline 序列判定，B7 只看精选轮/单票重算拉回的真实筹码
  const revRows = (ctx.reversal && ctx.reversal.criteria) || [];
  const revParams = (ctx.reversal && ctx.reversal.params) || sellCfg.reversalParams || {};
  const revBands = (ctx.reversal && ctx.reversal.bands) || sellCfg.reversalBands || [];
  const chipStage = opts.chipStage || ctx.chipStage || 'pre_filter';
  const reversal = autoScoreReversal(kline, ind, row.chip || null, revParams, revRows, chipStage, revBands);
  const ovCfg = sellCfg.openValue || {};
  const S_A = computeComposite(total, sell.total, ovCfg);
  const S_B = computeComposite(reversal.total, sell.total, ovCfg);
  return {
    symbol: row.symbol, name: row.name || '', sector: row.sector || '',
    today_pct: row.today_pct, pool_type: row.pool_type, data_as_of: row.data_as_of,
    // 趋势标签独立于总分（A/B 池来自道氏分段判定），不用总分反推
    trend_label: row.pool_type === 'A' ? 'A 趋势池' : (row.pool_type === 'B' ? 'B 超跌反弹池' : ''),
    dow_score: dow.score, granville_score: gran.score, module_scores,
    ma_state_label: (criterion_scores.ma && criterion_scores.ma.state_label) || '',
    modules_missing: missingModules,
    data_quality: degraded ? 'approximated' : 'sequence',
    weighted_total: total, band, criterion_scores, details,
    weight_sum: weightSum, used_weight: usedWeight,
    exhaustion: sell, reversal,
    // 三个基础分 + 两套综合分：A=weighted_total、B=reversal.total、W=sell.total（null 即「未判定」）
    A_score: total, B_score: reversal.total, W_score: sell.total, S_A, S_B,
    composite: { S_A, S_B, wA: ovCfg.wA, wB: ovCfg.wB, enabled: ovCfg.enabled !== false },
    run_stage: chipStage,
    chip: reversal.chip || null,
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
    out.push({ symbol: code, name: (x && x.name) || '', sector: (x && x.sector) || '' });
  }
  return out;
}

async function persistScanEval(s, date, opts = {}) {
  try {
    // 名称：一律按代码取本地股票库（覆盖行情管道的实时简称）；板块缺失时从股票池补齐，避免落库只剩代码或临时简称
    s.name = await resolveStockName(s.symbol, s.name);
    if (!s.sector) {
      const pool = await FortuneStock.findOne({ where: { symbol: s.symbol } });
      if (pool) s.sector = pool.sector || '';
    }
    await saveEvaluation({
      symbol: s.symbol, name: s.name, sector: s.sector, eval_date: date, criterion_scores: s.criterion_scores,
      sell: s.exhaustion || null, reversal: s.reversal || null,
      composite: s.composite || null,
      runStage: opts.runStage || s.run_stage || 'pre_filter',
      keepHistory: !!opts.keepHistory,
      meta: {
        pool_type: s.pool_type || '', trend_label: s.trend_label || '',
        ma_state_label: s.ma_state_label || '', data_quality: s.data_quality || '',
        modules_missing: s.modules_missing || 0,
        chip_stage: (s.reversal && s.reversal.chip && s.reversal.chip.stage) || s.run_stage || 'pre_filter',
        chip_source: (s.reversal && s.reversal.chip && s.reversal.chip.source) || '',
      },
    });
  } catch (e) { console.error('⚠️ [招财进宝] 扫描结果落库失败', s.symbol, e.message); }
}

const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));

/** 精选轮拿不到筹码时，就地把粗筛结果里的 B7 改成失败标注（B7 本来就没分，只改来源与文案，不改其余得分） */
function markChipUnavailable(s, detail) {
  const rev = s && s.reversal;
  if (!rev) return s;
  rev.chip = { ...(rev.chip || {}), stage: 'select', source: 'failed', ok: false, detail };
  for (const g of rev.groups || []) {
    if (g.code !== 'b7') continue;
    g.note = detail;
    for (const it of g.items || []) if (it.id === 'b7_1') { it.met = false; it.earned = 0; it.detail = detail; }
  }
  if (s.chip) s.chip = rev.chip;
  return s;
}

/**
 * 精选筹码轮：Node 侧串行（并发恒为 1）逐只 --with-chip 拉真实筹码补全 B7，每只之间间隔 chip_request_interval（另加 0～300ms 抖动）
 *  - 单只超时/报错/无返回 → 该行 B7 记 0 并标注，整批不中断
 *  - 成功后重折并覆盖同日同票记录，keepHistory 把旧的粗筛快照压进 pre_filter_history
 */
async function runChipSelect(st, targets, ctx, paramsFile, chipCfg, dateForEval) {
  const interval = Math.max(0, numOr(chipCfg.chip_request_interval, 1000));
  const timeoutMs = Math.max(5000, numOr(chipCfg.chip_timeout, 60000));
  const list = targets || [];
  // 单独发起的精选轮从 0% 起算；粗筛后自动衔接的精选轮接在 91% 之后，避免进度条倒回去
  const isStandalone = (st.kind || 'scan') === 'select';
  const base = isStandalone ? 0 : 91;
  const span = 100 - base;
  st.chipTotal = list.length; st.chipDone = 0;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const code = item.symbol;
    if (isStandalone) st.done = i;
    st.stage = `精选筹码 ${code}（${i + 1}/${list.length}）`;
    st.progress = list.length > 1 ? base + Math.round(i / list.length * span) : Math.min(99, base + Math.round(span * 0.6));
    let r = { ok: false, error: '未发起请求' };
    try {
      r = await runFortunePython(
        withParamsFile(['--action', 'analyze', '--symbol', code, '--with-chip', '--now', beijingIso()], paramsFile),
        { timeoutMs }
      );
    } catch (e) { r = { ok: false, error: e.message }; }
    const row = r.ok && r.data && r.data.stocks && r.data.stocks[0];
    const pos = st.result.findIndex(x => x.symbol === code);
    if (row) {
      try {
        const s = await scoreRow(row, ctx, { chipStage: 'select' });
        if (pos >= 0) { if (!s.sector && st.result[pos].sector) s.sector = st.result[pos].sector; if (!s.name && st.result[pos].name) s.name = st.result[pos].name; }
        if (!s.sector && item.sector) s.sector = item.sector;
        if (!s.name && item.name) s.name = item.name;
        if (pos >= 0) st.result[pos] = s; else st.result.push(s);
        await persistScanEval(s, dateForEval, { keepHistory: true, runStage: 'select' });
        st.chipDone++;
      } catch (e) {
        if (pos >= 0) markChipUnavailable(st.result[pos], `筹码轮重算失败，该项不计分：${e.message}`);
        st.errors.push({ symbol: code, error: `精选筹码重算失败：${e.message}` });
      }
    } else {
      if (pos >= 0) markChipUnavailable(st.result[pos], `筹码接口获取失败（${r.error || '无返回'}），该项不计分`);
      st.errors.push({ symbol: code, error: `筹码接口获取失败：${r.error || '无返回'}（B7 已记 0，其余指标不变）` });
    }
    if (i < list.length - 1) await sleep(interval + Math.floor(Math.random() * 300));
  }
  st.progress = 100;
}

/** 扫描共用上下文：A 买入组 + W 衰竭组 + B 反转组的配置与生效阈值 */
async function buildScanCtx(sellCfg) {
  const cfg = readConfig() || {};
  return {
    active: await loadActiveCriteria(),
    all: await loadAllCriteria(),
    bands: cfg.bands || [],
    sell: { criteria: await loadSellCriteria(), cfg: sellCfg },
    reversal: { criteria: await loadReversalCriteria(), params: sellCfg.reversalParams || {}, bands: sellCfg.reversalBands || [] },
  };
}

/** 发起一次批量扫描（立即返回 scanId，后台跑，避免 HTTP 超时；select=true 时只跑精选筹码轮） */
async function startScan({ symbols, date, select } = {}) {
  const list = normalizeScanList(symbols);
  if (!list.length) return { ok: false, error: '请至少提供一只 6 位股票代码' };
  const sellCfg = await getEffectiveSellConfig();
  const chipCfg = (sellCfg && sellCfg.chip) || {};
  const cap = select ? Math.max(1, numOr(chipCfg.select_max_chip, 10)) : Math.max(1, numOr(chipCfg.batch_max_pre_filter, 100));
  if (list.length > cap) return { ok: false, error: select ? `精选筹码轮单次最多 ${cap} 只，当前 ${list.length} 只` : `粗筛单次最多 ${cap} 只，当前 ${list.length} 只` };
  // 同一时刻只允许一个扫描任务，避免并发抓取把行情接口打爆
  for (const v of activeScans.values()) {
    if (v.status === 'running') return { ok: false, error: `已有打分任务在运行中（${v.stage || '进行中'}），请等待完成或稍后再试。` };
  }
  const today = bizDate(beijingNow());
  const asOf = date ? String(date).slice(0, 10) : '';
  if (asOf && asOf > today) return { ok: false, error: `时间点 ${asOf} 还没到，请选今天或之前` };
  const scanId = `fc_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
  activeScans.set(scanId, { scanId, status: 'running', stage: '准备', progress: 0, total: list.length, done: 0, result: [], errors: [], startedAt: Date.now(), kind: select ? 'select' : 'scan' });
  const runner = select ? runSelectJob : runScanJob;
  runner(scanId, list, asOf, today).catch(e => { const st = activeScans.get(scanId); if (st) { st.status = 'failed'; st.error = e.message; } });
  return { ok: true, scanId, total: list.length, stage: select ? 'select' : 'pre_filter' };
}

/**
 * 批量扫描后台任务：一个阈值参数文件贯穿整批（含逐只历史 snapshot），跑完清理
 *  阶段 1 粗筛：≤batch_max_pre_filter 只、一律 --no-chip（B7 跳过计 0）
 *  阶段 2 精选：enable_chip 且 B 组已开启时，取粗筛 S_B 靠前 ≤select_max_chip 只串行 --with-chip 补 B7
 */
async function runScanJob(scanId, list, asOf, today) {
  const st = activeScans.get(scanId);
  const cfg = readConfig() || {};
  const sellCfg = await getEffectiveSellConfig();
  const paramsFile = writeFortuneParamsFile(`scan_${scanId}`, cfg, sellCfg);
  const ctx = await buildScanCtx(sellCfg);
  const results = []; const errors = [];
  const pastDate = asOf && asOf !== today;
  try {
    if (pastDate) {
      // 历史时间点：逐只 snapshot 收盘口径截断，不掺今日实时 K（也不请求实时筹码）
      for (let i = 0; i < list.length; i++) {
        const code = list[i].symbol;
        st.done = i; st.stage = `定格打分（粗筛）${code}（${i + 1}/${list.length}）`; st.progress = Math.round(i / list.length * 100);
        const args = withParamsFile(['--action', 'snapshot', '--symbol', code, '--as-of', asOf, '--no-chip'], paramsFile);
        const r = await runFortunePython(args, { timeoutMs: 90000 });
        if (!r.ok) { errors.push({ symbol: code, error: r.error }); continue; }
        const row = (r.data && r.data.stocks && r.data.stocks[0]) || null;
        if (!row) { errors.push({ symbol: code, error: '该时间点无日线数据（非交易日或停牌）' }); continue; }
        const s = await scoreRow(row, ctx, { chipStage: 'history' });
        // 定格 snapshot 不返名称/板块：用本批清单（股票池带名称）就地补回，落库与榜单结果都拿得到名字
        if (list[i].sector) s.sector = list[i].sector;
        if (!s.name && list[i].name) s.name = list[i].name;
        results.push(s); await persistScanEval(s, asOf, { runStage: 'history' });
      }
    } else {
      // 当天/最新：一次批量 live score（1 进程，内部节流）
      st.stage = '粗筛：批量取数打分';
      if (!fs.existsSync(SCRATCH_DIR)) fs.mkdirSync(SCRATCH_DIR, { recursive: true });
      const outFile = path.join(SCRATCH_DIR, `fc_${scanId}.json`);
      const symbolsArg = list.map(x => x.symbol).join(',');
      const args = withParamsFile(['--action', 'score', '--symbols', symbolsArg, '--no-chip', '--now', beijingIso(), '--out', outFile], paramsFile);
      const r = await runFortunePython(args, {
        timeoutMs: Math.max(120000, list.length * 6000),
        onProgress: ({ done, total, stage }) => { st.done = done; st.total = total || list.length; st.stage = `粗筛：${stage}`; st.progress = total ? Math.min(90, Math.round(done / total * 90)) : 0; },
      });
      if (!r.ok) { st.status = 'failed'; st.error = r.error || '批量打分失败'; return; }
      const data = fs.existsSync(outFile) ? (readJsonSafe(outFile) || {}) : (r.data || {});
      for (const row of (data.stocks || [])) { const s = await scoreRow(row, ctx, { chipStage: 'pre_filter' }); const meta = list.find(x => x.symbol === s.symbol); if (meta?.sector) s.sector = meta.sector; if (!s.name && meta?.name) s.name = meta.name; results.push(s); await persistScanEval(s, asOf || today, { runStage: 'pre_filter' }); }
      for (const sk of (data.skipped || [])) errors.push({ symbol: sk.symbol, error: sk.reason || '跳过' });
      try { fs.unlinkSync(outFile); } catch (e) { /* 清理失败无妨 */ }
      st.progress = 90;
    }
    // 粗筛榜单：B 开启时按 S_B 降序（同时保留 A 分、S_A 字段给前端自己切换排序），否则按买入总分
    const sortBySB = x => (x.S_B && x.S_B.score != null ? Number(x.S_B.score) : -1);
    const sortByA = x => Number(x.weighted_total == null ? -1 : x.weighted_total);
    results.sort((a, b) => (sortBySB(b) - sortBySB(a)) || (sortByA(b) - sortByA(a)));
    st.result = results; st.errors = errors;

    // 阶段 2：精选筹码轮（只处今天口径；历史时间点不拉实时筹码，口径不匹配）
    const chipCfg = sellCfg.chip || {};
    const revEnabled = (ctx.reversal.criteria || []).some(c => c.enabled);
    if (!pastDate && chipCfg.enable_chip !== false && revEnabled && results.length) {
      const maxSel = Math.max(1, numOr(chipCfg.select_max_chip, 10));
      const targets = results.slice(0, maxSel).map(x => ({ symbol: x.symbol, name: x.name, sector: x.sector }));
      st.stage = `精选筹码 0/${targets.length}`; st.progress = 91;
      await runChipSelect(st, targets, ctx, paramsFile, chipCfg, asOf || today);
      st.chipFinished = true;
    } else {
      st.chipSkipped = pastDate ? '历史时间点不请求实时筹码' : (chipCfg.enable_chip === false ? '未开启筹码接口（enable_chip=false）' : (!revEnabled ? 'B 反转组整组关闭，无需精选' : '粗筛无可用标的'));
    }
    st.done = list.length; st.progress = 100; st.status = 'done'; st.stage = '完成'; st.finishedAt = Date.now();
  } finally {
    unlinkQuiet(paramsFile);
  }
}

/**
 * 只做精选筹码轮（榜单勾选 / 详情页「补筹码重算」发起）：不走粗筛批量，逐只 --with-chip
 * 旧记录若是粗筛口径，落库时 keepHistory 会把它的快照压进 pre_filter_history
 */
async function runSelectJob(scanId, list, asOf, today) {
  const st = activeScans.get(scanId);
  const cfg = readConfig() || {};
  const sellCfg = await getEffectiveSellConfig();
  const paramsFile = writeFortuneParamsFile(`sel_${scanId}`, cfg, sellCfg);
  const ctx = await buildScanCtx(sellCfg);
  try {
    st.stage = `精选筹码 0/${list.length}`;
    await runChipSelect(st, list, ctx, paramsFile, sellCfg.chip || {}, asOf || today);
    st.result.sort((a, b) => (b.S_B && b.S_B.score != null ? Number(b.S_B.score) : -1) - (a.S_B && a.S_B.score != null ? Number(a.S_B.score) : -1));
    st.done = list.length; st.progress = 100; st.status = 'done'; st.stage = '完成'; st.finishedAt = Date.now();
  } finally {
    unlinkQuiet(paramsFile);
  }
}

/** 轮询扫描进度与结果（stage 文案区分粗筛/精选，前端进度条直接用语义） */
function getScanStatus(scanId) {
  for (const [k, v] of activeScans) { if (v.finishedAt && Date.now() - v.finishedAt > SCAN_TTL_MS) activeScans.delete(k); }
  const st = activeScans.get(scanId);
  if (!st) return { ok: false, error: '扫描任务不存在或已过期，请重新发起' };
  return {
    ok: true,
    data: {
      scanId: st.scanId, kind: st.kind || 'scan', status: st.status, stage: st.stage, progress: st.progress,
      total: st.total, done: st.done, result: st.result, errors: st.errors, error: st.error,
      chip_total: st.chipTotal || 0, chip_done: st.chipDone || 0, chip_skipped: st.chipSkipped || '',
    },
  };
}

/**
 * 单票在指定时间点的自动打分（第 2 页按需/无存档时用；带 kline）
 *  withChip=true（详情页「重算（含真实筹码）」）：走 --with-chip 拉真实筹码补 B7；
 *  历史时间点一律不请求实时筹码（接口只有最新数据，与 --as-of 口径不匹配）
 */
async function scoreSingle({ symbol, date, withChip } = {}) {
  const code = String(symbol || '').trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, error: '股票代码需为 6 位数字' };
  const today = bizDate(beijingNow());
  const asOf = date ? String(date).slice(0, 10) : '';
  if (asOf && asOf > today) return { ok: false, error: `时间点 ${asOf} 还没到，请选今天或之前` };
  const cfg = readConfig() || {};
  const sellCfg = await getEffectiveSellConfig();
  const chipTimeout = Math.max(5000, numOr((sellCfg.chip || {}).chip_timeout, 60000));
  const paramsFile = writeFortuneParamsFile(`single_${code}_${asOf || 'now'}`, cfg, sellCfg);
  const ctx = await buildScanCtx(sellCfg);
  const pastDate = asOf && asOf !== today;
  const wantChip = !!withChip && !pastDate;
  let r;
  try {
    if (pastDate) {
      r = await runFortunePython(withParamsFile(['--action', 'snapshot', '--symbol', code, '--as-of', asOf, '--no-chip'], paramsFile), { timeoutMs: 90000 });
    } else {
      r = await runFortunePython(withParamsFile(['--action', 'analyze', '--symbol', code, wantChip ? '--with-chip' : '--no-chip', '--now', beijingIso()], paramsFile), { timeoutMs: wantChip ? chipTimeout : 60000 });
    }
  } finally {
    unlinkQuiet(paramsFile);
  }
  if (!r.ok) return { ok: false, error: r.error };
  const row = (r.data && r.data.stocks && r.data.stocks[0]) || null;
  if (!row) return { ok: false, error: '未取到该股数据' };
  const s = await scoreRow(row, ctx, { chipStage: pastDate ? 'history' : (wantChip ? 'single' : 'pre_filter') });
  // 行情管道不返板块、名称只用实时简称：板块从股票池补齐，名称按代码回到本地股票库取标准名
  if (!s.sector) {
    const pool = await FortuneStock.findOne({ where: { symbol: code } });
    if (pool) s.sector = pool.sector || '';
  }
  s.name = await resolveStockName(code, s.name);
  s.kline = row.kline || null;
  s.minutes = row.minutes || null; s.minutes_period_min = row.minutes_period_min; s.minutes_date = row.minutes_date; s.prev_close = row.prev_close; s.spot_time = row.spot_time;
  // 单票打分也落库（每票每日一行就地更新），榜单/第 2 页下次直接读、与批量口径一致；含筹码轮保留旧的粗筛快照
  await persistScanEval(s, asOf || today, { runStage: pastDate ? 'history' : (wantChip ? 'select' : 'pre_filter'), keepHistory: wantChip });
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
  foldFortuneModule,
  getEffectiveSellConfig,
  saveSellConfig,
  resetSellConfig,
  loadSellCriteria,
  foldSellModules,
  loadReversalCriteria,
  autoScoreReversal,
  resolveReversalBand,
  computeComposite,
  resolveSellBand,
  saveEvaluation,
  listEvaluations,
  getEvaluation,
  deleteEvaluation,
  listStocks,
  addStock,
  addStocks,
  removeStock,
  clearStocks,
  lookupStock,
  // 批量自动打分
  startScan,
  getScanStatus,
  scoreSingle,
  listEvaluationsForDate,
  listEvaluationDates,
  autoScoreDow,
  autoScoreGranville,
};