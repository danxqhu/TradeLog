/**
 * 每日追资金 —— 服务层
 *
 * 职责：
 *   1. 规则真源管理：config/money_chase_rules.json →（启动播种）→ money_chase_rules 表
 *      页面改过的行 is_custom=true 不被文件覆盖；Python 只吃后端下发的「生效参数」
 *   2. 调度 Python 脚本：sectors / constituents / score / analyze / snapshot 五种动作
 *      —— 一律后台异步执行，HTTP 立即返回，绝不阻塞等待（避免请求超时）
 *   3. 结果入库 + 人工勾选/备注/淘汰的分数复算
 *      —— 单票分析（analyze）也会落一行打分记录，人工加入的票不跑批次就能直接在分析页勾选保存
 *   4. 定格快照（snapshot）：按选定时间点截断历史 K 线跑同一套判定，结果固定存档不随后续走势变
 *      —— 与「当前最新评估」分开：快照回答“当初为什么看上它”，最新评估回答“现在变成什么样”
 *      —— 多份并存：盘中一份 / 收盘一份 / 后续手动生成的都留着；同一时间点默认不自动覆盖（需人工确认），
 *         基准由人工自由切换，新生成的一份不会静默挤掉录入基准
 *
 * 健壮性约定（与产品要求一致）：
 *   - 脚本内部每个接口只调用 1 次，不做自动重试；本层同样不自动重跑失败批次
 *   - 失败信息（中文）落库到 money_chase_runs.error_msg，前端弹窗展示，人工决定何时重试
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { Op } = require('sequelize');
const {
  sequelize,
  MoneyChaseRun,
  MoneyChaseCandidate,
  MoneyChaseRule,
  MoneyChaseSchedule,
  MoneyChaseManualStock,
  MoneyChaseSnapshot,
} = require('../models');
const marketDataService = require('./marketDataService');

const RULES_CONFIG_PATH = path.join(__dirname, '../../config/money_chase_rules.json');
const PY_SCRIPT = path.join(__dirname, '../../scripts/fetch_money_chase.py');
const DATA_DIR = path.join(__dirname, '../../data');
// 下发给 Python 的临时参数/结果文件放系统临时目录，绝不放 backend/data：
// dev 模式的 nodemon 盯着 backend 整个目录，一写 data/mc_*.json 就重启后端，
// 正在跑的 HTTP 请求与子进程 Python 会被拦腰打断（表现为“接口又失败了/批次没结果”）。
const SCRATCH_DIR = path.join(os.tmpdir(), 'tradelog-money-chase');

// 运行中任务的内存态（进度节流，避免每只票一次 DB 写）
const activeRuns = new Map();

// ==================== 通用工具 ====================

function beijingNow() {
  return marketDataService.getBeijingTime();
}

function bizDate(d = beijingNow()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function bizTime(d = beijingNow()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** ISO 带 +08:00，供 Python 判定盘中/收盘（禁止用机器本地时区猜测） */
function beijingIso(d = beijingNow()) {
  return `${bizDate(d)}T${bizTime(d)}:${String(d.getSeconds()).padStart(2, '0')}+08:00`;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return null;
  }
}

/** 从 stdout 尾部取最后一个可解析 JSON（容忍第三方库偶发打印） */
function parseTailJson(text) {
  if (!text) return null;
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.startsWith('{') && !line.startsWith('[')) continue;
    try {
      return JSON.parse(line);
    } catch (e) { /* 继续向前找 */ }
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function parseValue(raw, fallback = null) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const n = Number(raw);
  if (!Number.isNaN(n) && String(raw).trim() !== '') return n;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return raw;
  }
}

// ==================== 规则：播种 / 读取 / 更新 ====================

/**
 * 规则表列宽跟随模型
 * Sequelize 的 sync() 只会 CREATE TABLE IF NOT EXISTS，不会改已存在表的列宽；
 * 旧库里 code 是 VARCHAR(20)，而参数名（max_candidates_per_run / single_call_timeout_sec 等）长到这个以上
 * 会直接报 Data too long，把整轮播种拦腰打断（页面只剩几条规则就是这个原因）。
 */
async function alignRuleColumns() {
  try {
    const [res] = await sequelize.query(
      `SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'money_chase_rules' AND COLUMN_NAME = 'code' LIMIT 1`,
    );
    const len = res && res.length ? Number(res[0].len) : 0;
    if (len && len < 60) {
      await sequelize.query("ALTER TABLE money_chase_rules MODIFY COLUMN code VARCHAR(60) NULL COMMENT '规则编号（A_R1 / B_S3 等），param 类为参数名'");
      console.log(`🔧 [追资金] money_chase_rules.code 列宽 ${len} → 60（否则长参数名会被 MySQL 报错截断播种）`);
    }
  } catch (e) {
    console.error('⚠️ [追资金] 规则表列宽对齐失败（播种可能报 Data too long）:', e.message);
  }
}

/**
 * 把配置文件播种进规则表
 *  - 新增键：直接插入
 *  - 已存在且 is_custom=false：跟随文件更新（label/description/payload/default_value/value）
 *  - 已存在且 is_custom=true：只更新文案，不动 value（保留人工调整）
 *  - 逐条 try/catch：一条写失败不影响其余规则（失败清单会回给启动日志与接口）
 */
async function seedRules() {
  const cfg = readJsonSafe(RULES_CONFIG_PATH);
  if (!cfg) {
    console.error('⚠️ [追资金] 规则配置文件缺失或无法解析:', RULES_CONFIG_PATH);
    return { seeded: 0, error: '配置文件缺失' };
  }
  ensureDataDir();
  await alignRuleColumns();
  const version = cfg.version || '0';
  const rows = [];
  let sort = 0;

  for (const [key, p] of Object.entries(cfg.params || {})) {
    rows.push({
      key: `param:${key}`, category: 'param', code: key, pool: null,
      label: p.label || key, value: String(p.value), default_value: String(p.value),
      unit: p.unit || '', group_name: p.group || '', description: p.desc || '',
      payload: p.options ? { options: p.options } : null,
      mode: null, enabled: true, points: 0, sort_order: ++sort, source_version: version,
    });
  }
  for (const s of cfg.score_items || []) {
    rows.push({
      key: `score:${s.code}`, category: 'score', code: s.code, pool: s.pool,
      label: s.label, value: null, default_value: null, unit: '', group_name: `${s.pool} 池打分项`,
      description: `${s.formula}。${s.explain || ''}`, payload: s,
      mode: 'auto', enabled: s.enabled !== false, points: s.points || 1,
      sort_order: ++sort, source_version: version,
    });
  }
  for (const r of cfg.redlines || []) {
    rows.push({
      key: `redline:${r.code}`, category: 'redline', code: r.code, pool: r.pool,
      label: r.label, value: null, default_value: null, unit: '',
      group_name: `${r.pool} 池红线（触发任意一条直接淘汰）`,
      description: `判定：${r.detect}${r.manual_confirm ? '；脚本命中或人工确认均直接淘汰' : ''}`,
      payload: r, mode: r.mode, enabled: r.enabled !== false, points: 0,
      sort_order: ++sort, source_version: version,
    });
  }
  for (const m of cfg.manual_checks || []) {
    rows.push({
      key: `manual:${m.code}`, category: 'manual', code: m.code, pool: m.pool,
      label: m.label, value: null, default_value: null, unit: '',
      group_name: `${m.pool} 池人工复核项`, description: m.reason || '', payload: m,
      mode: 'manual', enabled: true, points: m.points || 1,
      sort_order: ++sort, source_version: version,
    });
  }
  for (const [pk, pv] of Object.entries(cfg.pools || {})) {
    rows.push({
      key: `pool:${pk}`, category: 'pool', code: pk, pool: pk,
      label: pv.name, value: null, default_value: null, unit: '', group_name: '池子定义',
      description: `准入：${pv.entry}　持仓：${pv.hold_rule}`, payload: pv,
      mode: null, enabled: true, points: 0, sort_order: ++sort, source_version: version,
    });
  }
  for (const o of cfg.kline_overlays || []) {
    rows.push({
      key: `overlay:${o.code}`, category: 'overlay', code: o.code, pool: o.pool,
      label: o.label, value: null, default_value: null, unit: '', group_name: 'K 线标注',
      description: o.desc || '', payload: o, mode: null, enabled: true, points: 0,
      sort_order: ++sort, source_version: version,
    });
  }
  const textRows = [
    ['text:positioning', '定位与数据基础', Object.values(cfg.positioning || {})],
    ['text:score_formula', '总分公式', [cfg.score_formula]],
    ['text:notice', '真源说明', [cfg.notice]],
    ['text:display', '展示规则', cfg.display_rules || []],
    ['text:boundary', '能力边界', cfg.boundary || []],
  ];
  for (const [key, label, arr] of textRows) {
    rows.push({
      key, category: 'text', code: key.split(':')[1], pool: null, label,
      value: null, default_value: null, unit: '', group_name: '总则',
      description: (arr || []).filter(Boolean).join('\n'), payload: { items: arr },
      mode: null, enabled: true, points: 0, sort_order: ++sort, source_version: version,
    });
  }

  let inserted = 0;
  let updated = 0;
  const failed = [];
  for (const row of rows) {
    try {
      const existed = await MoneyChaseRule.findOne({ where: { key: row.key } });
      if (!existed) {
        await MoneyChaseRule.create(row);
        inserted++;
      } else {
        const patch = {
          label: row.label, description: row.description, payload: row.payload,
          default_value: row.default_value, group_name: row.group_name,
          mode: row.mode, pool: row.pool, sort_order: row.sort_order, source_version: version,
        };
        // 人工没改过的值才跟随文件
        if (!existed.is_custom) {
          patch.value = row.value;
          patch.enabled = row.enabled;
          patch.points = row.points;
        }
        const changed = Object.entries(patch).some(([k, v]) => {
          const cur = existed[k];
          return JSON.stringify(cur) !== JSON.stringify(v);
        });
        if (changed) {
          await existed.update(patch);
          updated++;
        }
      }
    } catch (e) {
      // 不能因为一条规则写不进去就放弃整份清单（以前会静默截断，页面只剩几条、红线全空）
      failed.push({ key: row.key, error: e.message });
      console.error(`❌ [追资金] 规则项写入失败 ${row.key}: ${e.message}`);
    }
  }
  if (failed.length) {
    console.error(`⚠️  [追资金] 本次有 ${failed.length} 条规则没进表（页面会缺项，脚本对这部分按出厂默认值跑）：${failed.map(f => f.key).join('、')}`);
  }
  return { inserted, updated, version, total: rows.length, failed };
}

/** 读取整份规则（按分类分组，供页面全文展示） */
async function getRulesDoc() {
  const rows = await MoneyChaseRule.findAll({ order: [['sort_order', 'ASC']] });
  const fileVersion = (readJsonSafe(RULES_CONFIG_PATH) || {}).version || '';
  const groups = {};
  for (const r of rows) {
    const g = r.group_name || r.category;
    if (!groups[g]) groups[g] = [];
    groups[g].push({
      id: r.id, key: r.key, category: r.category, code: r.code, pool: r.pool,
      label: r.label, value: r.value, defaultValue: r.default_value, unit: r.unit,
      description: r.description, payload: r.payload, mode: r.mode,
      enabled: r.enabled, points: r.points, isCustom: r.is_custom,
    });
  }
  return {
    fileVersion,
    dbVersion: rows[0] ? rows[0].source_version : '',
    groups,
    flat: rows.map(r => ({
      key: r.key, category: r.category, code: r.code, pool: r.pool, label: r.label,
      value: r.value, defaultValue: r.default_value, unit: r.unit, mode: r.mode,
      enabled: r.enabled, points: r.points, isCustom: r.is_custom, description: r.description,
    })),
  };
}

/** 生效参数（拍平给 Python）+ 启用开关表 */
async function getEffectiveParams() {
  const rows = await MoneyChaseRule.findAll({ where: { category: { [Op.in]: ['param', 'score', 'redline', 'manual'] } } });
  const params = {};
  const enabled = {};
  for (const r of rows) {
    if (r.category === 'param') params[r.code] = parseValue(r.value);
    else enabled[r.code] = r.enabled;
  }
  return { params, enabled };
}

/** 页面需要的几个展示阈值（高亮分数线、人工加分上限） */
async function getHighlightThresholds() {
  const { params } = await getEffectiveParams();
  return {
    A: Number(params.highlight_a_total) || 7,
    B: Number(params.highlight_b_total) || 6,
    manualPer: Number(params.manual_score_per_item) || 1,
    manualMax: Number(params.manual_score_max) || 4,
  };
}

async function updateRules(items) {
  const out = [];
  for (const it of items || []) {
    if (!it || !it.key) continue;
    const row = await MoneyChaseRule.findOne({ where: { key: it.key } });
    if (!row) continue;
    const patch = { is_custom: true };
    if (it.value !== undefined) patch.value = typeof it.value === 'string' ? it.value : JSON.stringify(it.value);
    if (it.enabled !== undefined) patch.enabled = !!it.enabled;
    if (it.points !== undefined) patch.points = Number(it.points) || 0;
    await row.update(patch);
    out.push({ key: row.key, value: row.value, enabled: row.enabled, points: row.points });
  }
  return out;
}

async function resetRules(key) {
  const where = key ? { key } : { is_custom: true };
  const rows = await MoneyChaseRule.findAll({ where });
  let n = 0;
  for (const r of rows) {
    await r.update({ value: r.default_value, is_custom: false });
    n++;
  }
  return n;
}

// ==================== Python 调度 ====================

function writeParamFiles(runId, params, enabled) {
  if (!fs.existsSync(SCRATCH_DIR)) fs.mkdirSync(SCRATCH_DIR, { recursive: true });
  const paramsFile = path.join(SCRATCH_DIR, `mc_params_${runId}.json`);
  const rulesFile = path.join(SCRATCH_DIR, `mc_rules_${runId}.json`);
  fs.writeFileSync(paramsFile, JSON.stringify(params || {}), 'utf-8');
  fs.writeFileSync(rulesFile, JSON.stringify(enabled || {}), 'utf-8');
  return { paramsFile, rulesFile };
}

/**
 * 通用执行器：不重试、不循环。失败只把中文原因返回给调用方。
 * @returns {Promise<{ok:boolean, data?:any, error?:string, errorDetail?:string, exitCode?:number}>}
 */
function runPython(args, { timeoutMs, onProgress, tag = '追资金' } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let proc;
    try {
      proc = execFile('python3', [PY_SCRIPT, ...args], {
        timeout: timeoutMs || 60000,
        cwd: path.join(__dirname, '../..'),
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env },
      });
    } catch (e) {
      resolve({ ok: false, error: `无法启动 Python 进程：${e.message}`, errorDetail: e.message });
      return;
    }

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => {
      const text = d.toString();
      stderr += text;
      for (const line of text.split('\n')) {
        const m = line.match(/\[PROGRESS\]\s+(\d+)\s+(\d+)\s+(.+)/);
        if (m && onProgress) {
          try { onProgress({ done: Number(m[1]), total: Number(m[2]), stage: m[3].trim() }); } catch (e) { /* 忽略进度回调异常 */ }
        } else if (line.trim()) {
          console.log(`  [${tag}] ${line.trim()}`);
        }
      }
    });

    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; resolve(r); } };

    proc.on('error', (err) => {
      // ENOENT 才是环境缺 python3；超时/被杀等交给 close 分支给准确文案
      if (err && err.code === 'ENOENT') {
        finish({ ok: false, error: 'Python 脚本执行失败（环境缺少 python3 或 akshare）', errorDetail: err.message });
        return;
      }
      console.error(`  [${tag}] Python 进程异常:`, err.message);
    });

    proc.on('close', (code, signal) => {
      const parsed = parseTailJson(stdout);
      if (code !== 0) {
        let msg;
        if (code === null && signal) {
          msg = `本次接口调用超过 ${Math.round((timeoutMs || 60000) / 1000)} 秒未返回，已中止（按约定不做重试）。你可以稍后点「重试」，或换个板块。`;
        } else if (parsed && parsed.error) {
          msg = parsed.error;
        } else {
          msg = `Python 脚本退出码 ${code}${stderr ? `：${stderr.trim().split('\n').slice(-1)[0]}` : ''}`;
        }
        finish({
          ok: false,
          error: msg,
          errorDetail: (parsed && parsed.error_detail) || stderr.slice(-800),
          data: parsed,
        });
        return;
      }
      if (!parsed) {
        finish({ ok: false, error: '脚本输出无法解析为 JSON（可能接口被限流返回了非 JSON 内容）', errorDetail: stdout.slice(0, 400) });
        return;
      }
      if (parsed.ok === false) {
        finish({ ok: false, error: parsed.error || '脚本返回失败', errorDetail: parsed.error_detail || '' });
        return;
      }
      finish({ ok: true, data: parsed });
    });
  });
}

/** 板块资金流排行（TopN） */
async function fetchSectors(top) {
  const { params } = await getEffectiveParams();
  const args = ['--action', 'sectors', '--now', beijingIso()];
  const timeout = Math.max(30000, (Number(params.single_call_timeout_sec) || 20) * 3000);
  const r = await runPython(args, { timeoutMs: timeout });
  if (!r.ok) return r;
  const limit = Number(top) || Number(params.sector_display_count) || 5;
  return { ok: true, data: { ...r.data, sectors: (r.data.sectors || []).slice(0, limit) } };
}

/** 板块成分股（含实时字段，已按涨幅降序 + 应用过滤开关） */
async function fetchConstituents(sectors) {
  const list = (sectors || []).map(s => (typeof s === 'string' ? s : s.name)).filter(Boolean);
  if (!list.length) return { ok: false, error: '未选择板块' };
  const { params } = await getEffectiveParams();
  const args = ['--action', 'constituents', '--sectors', list.join(','), '--now', beijingIso()];
  // 上限 90s：必须在 Cloudflare 代理（免费计划约 100s）断开之前返回中文错误，
  // 否则前端只能拿到 52x 而看不到“哪个接口超时”
  const timeout = Math.min(90000, Math.max(60000, (Number(params.single_call_timeout_sec) || 20) * 6000));
  return runPython(args, { timeoutMs: timeout });
}

/** 合并人工加/减偏好，得到最终候选清单 */
async function applyStockPrefs(pairs) {
  const prefs = await MoneyChaseManualStock.findAll();
  const removed = new Set(prefs.filter(p => p.op_type === 'remove').map(p => p.symbol));
  const added = prefs.filter(p => p.op_type === 'add').map(p => ({ symbol: p.symbol, name: p.name, sector: p.sector }));
  const merged = (pairs || []).filter(p => !removed.has(p.symbol));
  const seen = new Set(merged.map(p => p.symbol));
  for (const a of added) {
    // remove 优先于 add：同一只票历史上被人工加入过、后来又被剔除时，不再补回清单
    if (removed.has(a.symbol) || seen.has(a.symbol)) continue;
    merged.push({ symbol: a.symbol, name: a.name, sector: a.sector || '人工自选', source: 'manual_add' });
    seen.add(a.symbol);
  }
  return { merged, removed: [...removed], added };
}

// ==================== 批次运行 ====================

/** 同一时刻只允许一个批次（避免并发抓取把外部接口打爆） */
async function guardNoActiveRun() {
  const busy = await MoneyChaseRun.findOne({
    where: { status: { [Op.in]: ['running', 'pending'] } },
    order: [['id', 'DESC']],
  });
  if (!busy) return null;
  return { ok: false, error: `已有筛选任务在运行中（批次 #${busy.id}，${busy.stage || '进行中'}），请等待完成或稍后再试。` };
}

/**
 * 真正把 Python 打分任务跑起来：不阻塞调用方，进度与结果在后台写库
 * run 行必须已存在（由 startRun 或 startRunWithPrefetch 建好）
 */
async function launchScore(run, { sectors, symbols, params, enabled, scheduleId = null }) {
  const { paramsFile, rulesFile } = writeParamFiles(run.id, params, enabled);
  const args = ['--action', 'score', '--now', beijingIso(), '--params-file', paramsFile, '--rules-file', rulesFile];
  if (sectors && sectors.length) args.push('--sectors', sectors.map(s => (typeof s === 'string' ? s : s.name)).join(','));
  if (symbols && symbols.length) args.push('--symbols', symbols.join(','));
  const outFile = path.join(SCRATCH_DIR, `mc_result_${run.id}.json`);
  args.push('--out', outFile);

  activeRuns.set(run.id, { runId: run.id, lastDbWrite: 0, stage: '准备参数', progress: 0 });

  const timeoutMs = Math.max(60000, (Number(params.run_timeout_sec) || 900) * 1000);
  runPython(args, {
    timeoutMs,
    onProgress: ({ done, total, stage }) => {
      const st = activeRuns.get(run.id);
      if (!st) return;
      st.stage = stage;
      st.progress = total ? Math.min(99, Math.round(done / total * 100)) : 0;
      const nowMs = Date.now();
      if (nowMs - st.lastDbWrite > 1500 || done === total) {
        st.lastDbWrite = nowMs;
        MoneyChaseRun.update({ stage, progress: st.progress }, { where: { id: run.id } }).catch(() => {});
      }
    },
  }).then(async (r) => {
    try {
      if (!r.ok) {
        await MoneyChaseRun.update({
          status: 'failed',
          stage: '失败',
          error_msg: r.error,
          error_detail: r.errorDetail || '',
        }, { where: { id: run.id } });
        if (scheduleId) await MoneyChaseSchedule.update({ last_status: 'failed' }, { where: { id: scheduleId } }).catch(() => {});
        console.error(`❌ [追资金] 批次 #${run.id} 失败:`, r.error);
        return;
      }
      const result = fs.existsSync(outFile) ? readJsonSafe(outFile) : (r.data || {});
      const imported = await importResult(run, result);
      await MoneyChaseRun.update({
        status: (result.stats && result.stats.failed > 0) ? 'partial' : 'completed',
        stage: '完成',
        progress: 100,
      }, { where: { id: run.id } });
      if (scheduleId) await MoneyChaseSchedule.update({ last_status: 'completed' }, { where: { id: scheduleId } }).catch(() => {});
      console.log(`✅ [追资金] 批次 #${run.id} 完成：候选 ${imported.candidateTotal}，成功 ${imported.success}，红线淘汰 ${imported.eliminated}，跳过 ${imported.skipped}`);
    } catch (e) {
      await MoneyChaseRun.update({ status: 'failed', stage: '入库失败', error_msg: `结果入库失败：${e.message}`, error_detail: String(e).slice(0, 500) }, { where: { id: run.id } });
      if (scheduleId) await MoneyChaseSchedule.update({ last_status: 'failed' }, { where: { id: scheduleId } }).catch(() => {});
      console.error(`❌ [追资金] 批次 #${run.id} 入库失败:`, e.message);
    } finally {
      activeRuns.delete(run.id);
      [paramsFile, rulesFile, outFile].forEach(f => { try { fs.unlinkSync(f); } catch (e) { /* 临时文件清理失败无妨 */ } });
    }
  }).catch(e => {
    activeRuns.delete(run.id);
    console.error(`❌ [追资金] 批次 #${run.id} 后台任务异常:`, e.message);
  });

  return { ok: true, runId: run.id, candidateTotal: (symbols || []).length };
}

/** 候选清单已确定（页面确认过成分股）时直接开跑 */
async function startRun({ sectors, symbols, triggeredBy = 'manual', scheduleId = null, sectorSource = 'auto_top' } = {}) {
  const busy = await guardNoActiveRun();
  if (busy) return busy;

  const { params, enabled } = await getEffectiveParams();
  const now = beijingNow();
  const run = await MoneyChaseRun.create({
    trade_date: bizDate(now),
    run_time: bizTime(now),
    triggered_by: triggeredBy,
    schedule_id: scheduleId,
    sectors: sectors || null,
    sector_source: sectorSource,
    status: 'running',
    stage: '准备参数',
    progress: 0,
    params_snapshot: { params, enabled },
  });

  return launchScore(run, { sectors, symbols, params, enabled, scheduleId });
}

/**
 * 先建 pending 批次行，再在后台抓板块/成分股，最后接着打分
 * 目的：HTTP 立即拿到 runId，不用在请求里等 1-2 分钟外部接口（避开反向代理/Cloudflare 超时）
 * 前置环节失败也落在这的行上（status:'failed' + 中文原因），页面批次列表与弹窗都能看到
 */
async function startRunWithPrefetch({ names = [], topN = null, sectorSource = 'auto_top', triggeredBy = 'manual', scheduleId = null } = {}) {
  const busy = await guardNoActiveRun();
  if (busy) return busy;

  const list = (names || []).filter(Boolean);
  const now = beijingNow();
  const run = await MoneyChaseRun.create({
    trade_date: bizDate(now),
    run_time: bizTime(now),
    triggered_by: triggeredBy,
    schedule_id: scheduleId,
    sectors: list.length ? list.map(name => ({ name })) : null,
    sector_source: list.length ? 'fixed' : sectorSource,
    status: 'pending',
    stage: list.length ? '抓取板块成分股' : '抓取板块资金流',
    progress: 0,
  });

  prepareAndScore(run, { names: list, topN, scheduleId }).catch(async e => {
    await MoneyChaseRun.update({
      status: 'failed',
      stage: '前置抓取异常',
      error_msg: `前置抓取异常：${e.message}`,
      error_detail: String(e).slice(0, 500),
    }, { where: { id: run.id } }).catch(() => {});
    if (scheduleId) await MoneyChaseSchedule.update({ last_status: 'failed' }, { where: { id: scheduleId } }).catch(() => {});
  });

  return { ok: true, runId: run.id, pending: true };
}

/** 后台链路：（必要时）取板块排行 → 成分股 → 合并人工加减 → 复用同一行 run 进入打分 */
async function prepareAndScore(run, { names = [], topN = null, scheduleId = null } = {}) {
  const markFailed = async (stage, info = {}) => {
    await MoneyChaseRun.update({
      status: 'failed',
      stage,
      error_msg: info.error || `${stage}失败`,
      error_detail: info.errorDetail || '',
    }, { where: { id: run.id } });
    if (scheduleId) await MoneyChaseSchedule.update({ last_status: 'failed' }, { where: { id: scheduleId } }).catch(() => {});
    console.error(`❌ [追资金] 批次 #${run.id} ${stage}：${info.error || ''}`);
    return { ok: false, error: info.error || `${stage}失败`, runId: run.id };
  };

  let chosen = (names || []).filter(Boolean);
  if (!chosen.length) {
    const { params } = await getEffectiveParams();
    const n = Number(topN) || Number(params.top_sectors) || 3;
    const r = await fetchSectors(n);
    if (!r.ok) return markFailed('板块资金流抓取失败', r);
    chosen = (r.data.sectors || []).slice(0, n).map(s => s.name).filter(Boolean);
    if (!chosen.length) return markFailed('板块资金流抓取失败', { error: '未取到任何板块名（数据源可能限流或字段变更）' });
  }

  await MoneyChaseRun.update({
    stage: '抓取板块成分股',
    sectors: chosen.map(name => ({ name })),
    sector_source: names && names.length ? 'fixed' : 'auto_top',
  }, { where: { id: run.id } });

  const c = await fetchConstituents(chosen);
  if (!c.ok) return markFailed('板块成分股抓取失败', c);

  const boards = (c.data && c.data.boards) || [];
  const okBoards = boards.filter(b => b && b.stocks && b.stocks.length);
  const boardErrors = boards.filter(b => b && b.error).map(b => `${b.sector}：${b.error}`);
  if (!okBoards.length) {
    return markFailed('板块成分股抓取失败', {
      error: boardErrors.join('；') || '所选板块均无成分股数据',
      errorDetail: (c.data && c.data.unmatched ? JSON.stringify(c.data.unmatched) : ''),
    });
  }
  if (boardErrors.length) console.warn(`⚠️ [追资金] 批次 #${run.id} 部分板块取不到成分股: ${boardErrors.join('；')}`);

  const pairs = [];
  const seen = new Set();
  for (const b of okBoards) {
    for (const s of b.stocks) {
      if (seen.has(s.symbol)) continue;
      seen.add(s.symbol);
      pairs.push({ symbol: s.symbol, name: s.name, sector: b.sector });
    }
  }
  const { merged } = await applyStockPrefs(pairs);
  if (!merged.length) return markFailed('候选清单为空', { error: '板块成分股经人工剔除后无剩余股票' });

  const symbols = merged.map(p => `${p.symbol}:${p.sector}`);
  const { params, enabled } = await getEffectiveParams();
  await MoneyChaseRun.update({
    status: 'running',
    stage: '准备参数',
    params_snapshot: { params, enabled },
  }, { where: { id: run.id } });
  const started = await launchScore(run, {
    sectors: chosen.map(name => ({ name })),
    symbols,
    params,
    enabled,
    scheduleId,
  });
  if (scheduleId) {
    await MoneyChaseSchedule.update({ last_run_at: beijingIso(), last_run_id: run.id, last_status: 'running' }, { where: { id: scheduleId } }).catch(() => {});
  }
  console.log(`💰 [追资金] 批次 #${run.id} 前置完成：板块 ${chosen.join('/')}，候选 ${symbols.length} 只`);
  return started;
}

/** 人工复核项与建议持仓文案（批次打分与单票分析共用一份，避免两处口径漂移） */
async function loadRuleCtx() {
  const rules = await MoneyChaseRule.findAll({ where: { category: ['manual', 'pool'] }, order: [['sort_order', 'ASC']] });
  const manualByPool = {};
  const holdByPool = {};
  for (const r of rules) {
    if (r.category === 'manual') {
      if (!manualByPool[r.pool]) manualByPool[r.pool] = [];
      if (r.enabled) manualByPool[r.pool].push({ code: r.code, label: r.label, reason: (r.payload || {}).reason || '', checked: false });
    } else if (r.category === 'pool') {
      holdByPool[r.code] = (r.payload || {}).hold_rule || '';
    }
  }
  return { manualByPool, holdByPool };
}

/** 脚本输出行 → candidates 表字段（批次与单票分析用同一份映射） */
function candidateFields(runId, s, ctx, meta = {}) {
  const { manualByPool, holdByPool } = ctx;
  return {
    run_id: runId,
    symbol: s.symbol,
    name: s.name || '',
    sector: s.sector || '',
    pool_type: s.pool_type,
    today_pct: s.today_pct,
    auto_score: s.auto_score,
    max_auto_score: s.max_auto_score,
    manual_score: 0,
    total_score: s.auto_score,
    score_detail: s.score_detail,
    red_lines: s.red_lines || [],
    eliminated: !!s.eliminated,
    elim_source: s.eliminated ? 'auto' : null,
    manual_checks: manualByPool[s.pool_type] || [],
    suggest_hold: holdByPool[s.pool_type] || s.suggest_hold || '',
    weakest_gap: (s.score_detail || []).filter(x => !x.met).map(x => x.detail)[0] || s.weakest_gap || '',
    dow_trend: s.dow_trend,
    retrace: s.retrace,
    fib_info: s.fib_info,
    indicators: { ...(s.indicators || {}), warnings: s.warnings || [], vol_scale: meta.vol_scale },
    chip: s.chip,
    fund_flow: s.fund_flow,
    kline: s.kline,
    data_as_of: s.data_as_of,
    remark: { resist: '', stop_profit: '', buy_plan: '', note: '' },
    picked: false,
    source: (s.sector === '人工自选') ? 'manual_add' : 'sector',
  };
}

/** 把脚本结果写入数据库 */
async function importResult(run, result) {
  const stocks = Array.isArray(result.stocks) ? result.stocks : [];
  const meta = result.meta || {};
  const { params } = await getEffectiveParams();
  const ctx = await loadRuleCtx();

  const rows = stocks.map(s => candidateFields(run.id, s, ctx, meta));

  if (rows.length) {
    await MoneyChaseCandidate.bulkCreate(rows, { ignoreDuplicates: true });
  }

  const skipList = [...(result.skipped || []), ...(result.errors || []).map(e => ({ symbol: e.symbol, name: e.name, reason: e.error }))];
  await MoneyChaseRun.update({
    trade_date: meta.trade_date || run.trade_date,
    run_time: meta.run_time || run.run_time,
    data_as_of: meta.data_as_of,
    intraday: !!meta.intraday,
    elapsed_trading_min: meta.elapsed_trading_min || 0,
    vol_scale: meta.vol_scale == null ? 1 : meta.vol_scale,
    sectors: meta.sectors || run.sectors,
    candidate_total: (result.stats || {}).candidate_total || rows.length,
    success_count: (result.stats || {}).success || rows.length,
    skip_count: (result.stats || {}).skipped || skipList.length,
    fail_count: (result.stats || {}).failed || 0,
    eliminated_count: (result.stats || {}).eliminated || 0,
    skip_list: skipList.slice(0, 200),
    params_snapshot: { ...(run.params_snapshot || {}), effective: params, metaWarnings: meta.warnings || [] },
  }, { where: { id: run.id } });

  return {
    candidateTotal: (result.stats || {}).candidate_total || rows.length,
    success: rows.length,
    eliminated: (result.stats || {}).eliminated || 0,
    skipped: skipList.length,
  };
}

async function getRunStatus(id) {
  const run = await MoneyChaseRun.findByPk(id);
  if (!run) return null;
  const st = activeRuns.get(Number(id));
  return {
    id: run.id,
    status: run.status,
    stage: st ? st.stage : run.stage,
    progress: st ? st.progress : run.progress,
    trade_date: run.trade_date,
    run_time: run.run_time,
    // manual_input = 单票分析自动建的批次行，前端据此区分“自动打分记录”与“板块筛选批次”
    sector_source: run.sector_source,
    data_as_of: run.data_as_of,
    intraday: run.intraday,
    vol_scale: run.vol_scale,
    elapsed_trading_min: run.elapsed_trading_min,
    error_msg: run.error_msg,
    error_detail: run.error_detail,
    stats: {
      candidate_total: run.candidate_total,
      success: run.success_count,
      eliminated: run.eliminated_count,
      skipped: run.skip_count,
      failed: run.fail_count,
    },
    sectors: run.sectors,
    skip_list: run.skip_list,
    // 非致命预警（如板块资金流限流后按数据缺失计），页面批次摘要里列出
    warnings: (run.params_snapshot && run.params_snapshot.metaWarnings) || [],
  };
}

async function listRuns({ date, limit = 30 } = {}) {
  const where = {};
  if (date) where.trade_date = date;
  const rows = await MoneyChaseRun.findAll({ where, order: [['id', 'DESC']], limit: Number(limit) || 30 });
  return rows.map(r => ({
    id: r.id, trade_date: r.trade_date, run_time: r.run_time, triggered_by: r.triggered_by,
    status: r.status, stage: r.stage, progress: r.progress, sectors: r.sectors, sector_source: r.sector_source,
    candidate_total: r.candidate_total, success_count: r.success_count, eliminated_count: r.eliminated_count,
    skip_count: r.skip_count, fail_count: r.fail_count, data_as_of: r.data_as_of, intraday: r.intraday,
    vol_scale: r.vol_scale, elapsed_trading_min: r.elapsed_trading_min, error_msg: r.error_msg,
    createdAt: r.createdAt,
  }));
}

async function getCandidates(runId, { pool } = {}) {
  const where = { run_id: runId };
  if (pool) where.pool_type = pool;
  const rows = await MoneyChaseCandidate.findAll({ where, order: [['today_pct', 'DESC']] });
  const params = (await getEffectiveParams()).params;
  const highlight = { A: Number(params.highlight_a_total) || 7, B: Number(params.highlight_b_total) || 6 };
  return rows.map(c => ({
    id: c.id, symbol: c.symbol, name: c.name, sector: c.sector, pool_type: c.pool_type,
    today_pct: c.today_pct == null ? null : Number(c.today_pct),
    auto_score: c.auto_score, max_auto_score: c.max_auto_score,
    manual_score: c.manual_score, total_score: c.total_score,
    qualified: !c.eliminated && c.total_score >= (highlight[c.pool_type] || 99),
    score_detail: c.score_detail, red_lines: c.red_lines || [], eliminated: c.eliminated,
    elim_source: c.elim_source, manual_checks: c.manual_checks || [], suggest_hold: c.suggest_hold,
    weakest_gap: c.weakest_gap, dow_trend: c.dow_trend,
    retrace: c.retrace == null ? null : Number(c.retrace),
    fib_info: c.fib_info, indicators: c.indicators, chip: c.chip, fund_flow: c.fund_flow,
    data_as_of: c.data_as_of, remark: c.remark, picked: c.picked, source: c.source,
  }));
}

/** K 线大图数据（单独取，避免列表接口过重） */
async function getCandidateKline(id) {
  const c = await MoneyChaseCandidate.findByPk(id);
  if (!c) return null;
  return {
    id: c.id, symbol: c.symbol, name: c.name, sector: c.sector, pool_type: c.pool_type,
    run_id: c.run_id, data_as_of: c.data_as_of, kline: c.kline, fib_info: c.fib_info,
    indicators: c.indicators, red_lines: c.red_lines, score_detail: c.score_detail,
    chip: c.chip, fund_flow: c.fund_flow, today_pct: c.today_pct,
  };
}

/** 人工勾选换算成人分（与 updateCandidate 共用，避免两处算法不一致） */
function calcManualScore(list, params) {
  const per = Number(params.manual_score_per_item) || 1;
  const cap = Number(params.manual_score_max) || 4;
  const n = (Array.isArray(list) ? list : []).filter(x => x && x.checked).length;
  return Math.min(cap, n * per);
}

/**
 * 人工勾选 / 备注 / 手动淘汰 / 选中
 * 返回体里带回最新的人工态，前端直接覆盖本地状态，不必重拉整个候选列表
 */
async function updateCandidate(id, { manualChecks, remark, eliminated, elimSource, picked } = {}) {
  const c = await MoneyChaseCandidate.findByPk(id);
  if (!c) return { ok: false, error: '候选记录不存在' };

  const patch = {};
  if (Array.isArray(manualChecks) || manualChecks === null) {
    const { params, enabled } = await getEffectiveParams();
    const list = Array.isArray(manualChecks) ? manualChecks : (c.manual_checks || []);
    const allowedCodes = Object.entries(enabled).filter(([k, v]) => k.startsWith('A_M') || k.startsWith('B_M')).filter(([, v]) => v).map(([k]) => k);
    const checked = list.filter(x => x && x.checked && (allowedCodes.length === 0 || allowedCodes.includes(x.code)));
    patch.manual_score = calcManualScore(checked, params);
    patch.manual_checks = list.map(x => ({ ...x, checked: !!(x && x.checked) }));
    patch.total_score = (c.auto_score || 0) + patch.manual_score;
  }
  if (eliminated !== undefined) {
    patch.eliminated = !!eliminated;
    patch.elim_source = eliminated ? (elimSource || 'manual') : null;
  }
  if (remark !== undefined) patch.remark = remark;
  if (picked !== undefined) patch.picked = !!picked;

  await c.update(patch);
  return {
    ok: true,
    data: { id: c.id, manual_score: c.manual_score, total_score: c.total_score, eliminated: c.eliminated, elim_source: c.elim_source, picked: c.picked, manual_checks: c.manual_checks, remark: c.remark },
  };
}

/** 页面增删候选股（跨批次继承） */
async function adjustManualStocks({ add = [], remove = [], unreject = [] } = {}) {
  for (const s of add) {
    if (!s || !s.symbol) continue;
    await MoneyChaseManualStock.upsert({
      symbol: s.symbol, name: s.name || '', op_type: 'add', sector: s.sector || '人工自选', note: s.note || '',
    });
    await MoneyChaseManualStock.destroy({ where: { symbol: s.symbol, op_type: 'remove' } });
  }
  for (const s of remove) {
    const symbol = typeof s === 'string' ? s : s && s.symbol;
    if (!symbol) continue;
    await MoneyChaseManualStock.upsert({ symbol, name: (s && s.name) || '', op_type: 'remove', sector: (s && s.sector) || '', note: '' });
    // 故意不删 add 行：人工加入的票被误剔除后，点「恢复」只删 remove 行就能回到清单，
    // 否则 add 记录丢失，恢复后这只票再也不在候选里（remove 优先于 add，见 applyStockPrefs）。
  }
  for (const s of unreject) {
    const symbol = typeof s === 'string' ? s : s && s.symbol;
    if (symbol) await MoneyChaseManualStock.destroy({ where: { symbol, op_type: 'remove' } });
  }
  return getManualStocks();
}

async function getManualStocks() {
  const rows = await MoneyChaseManualStock.findAll({ order: [['id', 'DESC']] });
  return rows.map(r => ({ id: r.id, symbol: r.symbol, name: r.name, op_type: r.op_type, sector: r.sector, note: r.note }));
}

// ==================== 定时配置 ====================

async function ensureDefaultSchedules() {
  const count = await MoneyChaseSchedule.count();
  if (count > 0) return { created: 0 };
  const cfg = readJsonSafe(RULES_CONFIG_PATH) || {};
  const list = cfg.schedules_default || [];
  for (const s of list) {
    await MoneyChaseSchedule.create({
      time_hm: s.time_hm, label: s.label || '', sector_source: s.sector_source || 'auto_top',
      top_n: s.top_n || 3, enabled: s.enabled !== false, trading_day_only: true,
    });
  }
  return { created: list.length };
}

async function listSchedules() {
  const rows = await MoneyChaseSchedule.findAll({ order: [['time_hm', 'ASC']] });
  return rows.map(r => ({
    id: r.id, time_hm: r.time_hm, label: r.label, sector_source: r.sector_source, top_n: r.top_n,
    fixed_sectors: r.fixed_sectors, enabled: r.enabled, trading_day_only: r.trading_day_only,
    last_run_at: r.last_run_at, last_run_id: r.last_run_id, last_status: r.last_status,
  }));
}

async function createSchedule(data) {
  if (!/^\d{2}:\d{2}$/.test(data.time_hm || '')) return { ok: false, error: '时间格式应为 HH:MM' };
  const existed = await MoneyChaseSchedule.findOne({ where: { time_hm: data.time_hm } });
  if (existed) return { ok: false, error: `${data.time_hm} 已存在配置，请直接修改那一条` };
  const row = await MoneyChaseSchedule.create({
    time_hm: data.time_hm, label: data.label || '', sector_source: data.sector_source || 'auto_top',
    top_n: data.top_n || 3, fixed_sectors: data.fixed_sectors || null,
    enabled: data.enabled !== false, trading_day_only: data.trading_day_only !== false,
  });
  return { ok: true, data: row };
}

async function updateSchedule(id, data) {
  const row = await MoneyChaseSchedule.findByPk(id);
  if (!row) return { ok: false, error: '配置不存在' };
  const patch = {};
  ['time_hm', 'label', 'sector_source', 'top_n', 'fixed_sectors', 'enabled', 'trading_day_only'].forEach(k => {
    if (data[k] !== undefined) patch[k] = data[k];
  });
  if (patch.time_hm && !/^\d{2}:\d{2}$/.test(patch.time_hm)) return { ok: false, error: '时间格式应为 HH:MM' };
  await row.update(patch);
  return { ok: true, data: row };
}

async function deleteSchedule(id) {
  const n = await MoneyChaseSchedule.destroy({ where: { id } });
  return { ok: n > 0 };
}

/**
 * 服务重启会打断内存里的批次，库里可能残留 running/pending 行；
 * 这些行会永久阻塞新批次（同一时刻只允许一个），因此启动时统一标为中断
 */
async function cleanupStaleRuns() {
  const cleaned = await MoneyChaseRun.update(
    {
      status: 'failed',
      stage: '服务重启中断',
      error_msg: '后端重启导致本次运行中断，请直接重新发起筛选（脚本不会自动重试）。',
      error_detail: '',
    },
    { where: { status: { [Op.in]: ['running', 'pending'] } } }
  );
  if (cleaned) console.log(`💰 [追资金] 已标记 ${cleaned} 条未完成批次为“服务重启中断”`);
  await MoneyChaseSchedule.update({ last_status: 'failed' }, { where: { last_status: 'running' } }).catch(() => {});
  return { cleaned };
}

/**
 * 定时节点自动跑完整链路：（可选）板块资金流 → 成分股 → 合并人工加减 → 打分入库
 * 与页面一致：接口只调 1 次、不重试，任一前置环节失败就在批次行留痕
 * 调用后立即返回 runId（抓取在后台走），不阻塞 cron 线程
 */
async function autoRun(schedule = {}) {
  const { params } = await getEffectiveParams();
  const topN = Number(schedule.top_n) || Number(params.top_sectors) || 3;
  const fixed = schedule.sector_source === 'fixed' ? (schedule.fixed_sectors || []) : [];
  const r = await startRunWithPrefetch({
    names: fixed,
    topN,
    sectorSource: fixed.length ? 'fixed' : 'auto_top',
    triggeredBy: 'cron',
    scheduleId: schedule.id || null,
  });
  if (r.ok) {
    console.log(`⏰ [追资金] 定时节点 ${schedule.time_hm || ''} 已启动批次 #${r.runId}（${fixed.length ? `固定板块${fixed.join('/')}` : `自动 Top${topN}`}）`);
  } else {
    console.warn(`⏰ [追资金] 定时节点 ${schedule.time_hm || ''} 未启动：${r.error}`);
  }
  return r;
}

/** 单只票详情分析的内存缓存（symbol -> {at, data}）：反复点同一只票不重复请求数据源 */
const analyzeCache = new Map();

/** 当日「单票分析」专用批次行的创建去重（同一交易日只建一次，避免并发分析插出多行） */
const singleRunPromises = new Map();

/**
 * 单票分析也要有一行可保存的记录，但没有批次可用 —— 就自动建一个当日专用批次行挂着
 * sector_source='manual_input' 是它的专属标记（板块筛选只用 auto_top/fixed），
 * 创建即 completed，不会触发前端轮询，也不会被 guardNoActiveRun 当成“有任务在跑”而阻塞正常批次。
 */
async function ensureSingleRun(tradeDate, now) {
  const hit = singleRunPromises.get(tradeDate);
  if (hit) return hit;
  const p = (async () => {
    const found = await MoneyChaseRun.findOne({ where: { trade_date: tradeDate, sector_source: 'manual_input' }, order: [['id', 'ASC']] });
    if (found) return found;
    return MoneyChaseRun.create({
      trade_date: tradeDate,
      run_time: bizTime(now),
      triggered_by: 'manual',
      sector_source: 'manual_input',
      status: 'completed',
      stage: '单票具体分析（加入候选/点股票名时自动打分）',
      progress: 100,
      params_snapshot: { note: '本批次行由单票分析自动创建，不来自板块筛选' },
    });
  })();
  singleRunPromises.set(tradeDate, p);
  try {
    return await p;
  } catch (e) {
    singleRunPromises.delete(tradeDate);
    throw e;
  }
}

/** 把人工勾选按 code 合并到新的复核项列表上（规则改了名/加了项也不会丢已勾的） */
function mergeChecksByCode(baseList, priorList) {
  const priorMap = {};
  for (const p of (Array.isArray(priorList) ? priorList : [])) {
    if (p && p.code) priorMap[p.code] = !!p.checked;
  }
  return (Array.isArray(baseList) ? baseList : []).map(x => ({
    ...x, checked: priorMap[x.code] === undefined ? !!x.checked : priorMap[x.code],
  }));
}

/** 同一只票当天的其它打分行（批次行或上一次分析行），用于把人工勾选/备注/选中带过来，不让重算洗掉 */
async function findTodayPriorCandidate(runId, symbol, tradeDate) {
  const runs = await MoneyChaseRun.findAll({
    where: { trade_date: tradeDate }, attributes: ['id'], order: [['id', 'DESC']], limit: 30,
  });
  const ids = runs.map(r => r.id).filter(id => Number(id) !== Number(runId));
  if (!ids.length) return null;
  return MoneyChaseCandidate.findOne({ where: { symbol, run_id: { [Op.in]: ids } }, order: [['id', 'DESC']] });
}

/**
 * 单票分析结果落库：人工加入的票不跑批次也有一行自己的打分记录，
 * 分析页的勾选/备注/选中/淘汰直接写这一行（一只票一天一行，重复分析就地更新）。
 * 失败只记日志，不影响分析结果展示（查看不应因落库问题报错）。
 */
async function saveAnalyzeResult(row, meta, now) {
  try {
    const tradeDate = meta.trade_date || bizDate(now);
    const run = await ensureSingleRun(tradeDate, now);
    const ctx = await loadRuleCtx();
    const { params } = await getEffectiveParams();
    const fields = candidateFields(run.id, row, ctx, meta);

    const prior = await findTodayPriorCandidate(run.id, row.symbol, tradeDate);
    let c = await MoneyChaseCandidate.findOne({ where: { run_id: run.id, symbol: row.symbol } });
    if (c) {
      // 脚本负责重新算分，人负责勾选：已有的人工态优先保留（当天更晚改过的批次行会覆盖过来）
      const keepFrom = (prior && prior.updatedAt && c.updatedAt && prior.updatedAt > c.updatedAt) ? prior : c;
      const merged = mergeChecksByCode(fields.manual_checks, keepFrom.manual_checks);
      const manualScore = calcManualScore(merged, params);
      await c.update({
        ...fields,
        manual_checks: merged,
        manual_score: manualScore,
        total_score: (fields.auto_score || 0) + manualScore,
        remark: keepFrom.remark || fields.remark,
        picked: !!keepFrom.picked,
        eliminated: fields.eliminated || (!!keepFrom.eliminated),
        elim_source: fields.eliminated ? 'auto' : (keepFrom.elim_source || null),
      });
    } else {
      if (prior) {
        fields.manual_checks = mergeChecksByCode(fields.manual_checks, prior.manual_checks);
        fields.manual_score = calcManualScore(fields.manual_checks, params);
        fields.total_score = (fields.auto_score || 0) + fields.manual_score;
        fields.remark = prior.remark || fields.remark;
        fields.picked = !!prior.picked;
        if (prior.elim_source === 'manual') {
          fields.eliminated = true;
          fields.elim_source = 'manual';
        }
      }
      c = await MoneyChaseCandidate.create(fields);
    }

    const [total, elim] = await Promise.all([
      MoneyChaseCandidate.count({ where: { run_id: run.id } }),
      MoneyChaseCandidate.count({ where: { run_id: run.id, eliminated: true } }),
    ]);
    await MoneyChaseRun.update({
      status: 'completed',
      stage: `单票具体分析（已自动打分 ${total} 只）`,
      progress: 100,
      candidate_total: total,
      success_count: total,
      eliminated_count: elim,
      data_as_of: meta.data_as_of || row.data_as_of || null,
      intraday: !!meta.intraday,
      elapsed_trading_min: meta.elapsed_trading_min || 0,
      vol_scale: meta.vol_scale == null ? 1 : meta.vol_scale,
    }, { where: { id: run.id } });
    return c;
  } catch (e) {
    console.error('⚠️ [追资金] 单票分析结果落库失败（不影响页面展示）:', e.message);
    return null;
  }
}

/**
 * 加入候选清单后自动打分（后台跑，HTTP 不等）
 * 一次只跑加入的那几只，每只 3 次新浪请求 + 只间 1.5 秒间隔，不重试；结果进当日单票分析批次
 */
function queueAutoAnalyze(items = []) {
  const list = [];
  const seen = new Set();
  for (const s of (Array.isArray(items) ? items : [])) {
    const code = String((s && s.symbol) || '').trim();
    if (!/^\d{6}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    list.push({ symbol: code, name: (s && s.name) || '', sector: (s && s.sector) || '人工自选' });
  }
  const queued = list.slice(0, 10);
  if (list.length > queued.length) {
    console.warn(`⚠️ [追资金] 本次加入 ${list.length} 只，只对前 ${queued.length} 只自动打分（避免一次打太多请求）`);
  }
  if (!queued.length) return { queued: 0 };

  (async () => {
    for (const s of queued) {
      try {
        const r = await analyzeStock(s.symbol, { sector: s.sector });
        if (r.ok) {
          const st = r.data.stock || {};
          console.log(`✅ [追资金] 加入即自动打分 ${s.symbol} ${s.name}：${st.pool_type} 池 自动 ${st.auto_score}/${st.max_auto_score}${(st.red_lines || []).length ? `，触发红线 ${(st.red_lines || []).map(x => x.code).join('/')}` : ''}`);
        } else {
          console.warn(`⚠️ [追资金] 加入后自动打分失败 ${s.symbol}：${r.error}（不重试，可到分析页手动点「重新分析」）`);
        }
      } catch (e) {
        console.error(`⚠️ [追资金] 加入后自动打分异常 ${s.symbol}:`, e.message);
      }
      await new Promise(r => setTimeout(r, 1500));
    }
  })();

  return { queued: queued.length, symbols: queued.map(s => s.symbol) };
}

/** 每只票当日最新一条打分摘要（② 候选清单用，只查库不请求外部接口） */
async function latestScores(symbols = []) {
  const list = [];
  const seen = new Set();
  for (const s of (Array.isArray(symbols) ? symbols : [])) {
    const code = String(s || '').trim();
    if (!/^\d{6}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    list.push(code);
  }
  if (!list.length) return {};
  const rows = await MoneyChaseCandidate.findAll({
    where: { symbol: { [Op.in]: list } }, order: [['id', 'DESC']], limit: 2000,
  });
  const out = {};
  for (const r of rows) {
    if (out[r.symbol]) continue;
    out[r.symbol] = {
      id: r.id, run_id: r.run_id, pool_type: r.pool_type,
      auto_score: r.auto_score, max_auto_score: r.max_auto_score,
      manual_score: r.manual_score, total_score: r.total_score,
      eliminated: !!r.eliminated, elim_source: r.elim_source, picked: !!r.picked,
      weakest_gap: r.weakest_gap, data_as_of: r.data_as_of, updatedAt: r.updatedAt,
    };
  }
  return out;
}

/**
 * 给单票分析结果补上「人工复核勾选 / 备注 / 选中」状态（只查数据库，不再请求外部接口）
 * 优先用本次分析落库的那一行（candidate_id），没有则退回该票最新一条记录。
 */
async function withCandidateContext(code, data) {
  const pool = (data.stock || {}).pool_type || 'A';
  const rules = await MoneyChaseRule.findAll({ where: { category: 'manual', pool }, order: [['sort_order', 'ASC']] });
  let c = data.candidate_id ? await MoneyChaseCandidate.findByPk(data.candidate_id) : null;
  if (!c) c = await MoneyChaseCandidate.findOne({ where: { symbol: code }, order: [['id', 'DESC']] });
  const saved = {};
  for (const m of (c && Array.isArray(c.manual_checks) ? c.manual_checks : [])) {
    if (m && m.code) saved[m.code] = !!m.checked;
  }
  const manualChecks = rules.filter(r => r.enabled).map(r => ({
    code: r.code, label: r.label, reason: (r.payload || {}).reason || '', checked: !!saved[r.code],
  }));
  // 基准快照一次带给分析页（只摘要，K 线与分时走 /snapshots/:id 取，避免响应体翻倍）
  const [baseSnap, snapCount] = await Promise.all([
    MoneyChaseSnapshot.findOne({ where: { symbol: code, is_baseline: true }, order: [['id', 'DESC']] }),
    MoneyChaseSnapshot.count({ where: { symbol: code } }),
  ]);
  return {
    ...data,
    manual_checks: manualChecks,
    baseline_snapshot: baseSnap ? snapshotSummary(baseSnap) : null,
    snapshot_count: snapCount,
    candidate: c ? {
      id: c.id, run_id: c.run_id, sector: c.sector, pool_type: c.pool_type,
      auto_score: c.auto_score, max_auto_score: c.max_auto_score,
      manual_score: c.manual_score, total_score: c.total_score,
      eliminated: !!c.eliminated, elim_source: c.elim_source, picked: !!c.picked,
      remark: c.remark || null, data_as_of: c.data_as_of,
      suggest_hold: c.suggest_hold, weakest_gap: c.weakest_gap,
      // 这行是单票分析自动建的批次（还是板块筛选跑出来的），页面文案跟着变
      is_single: !!data.single_run_id && Number(c.run_id) === Number(data.single_run_id),
    } : null,
  };
}

/**
 * 单只票具体分析（页面点股票名 / 加入候选清单时自动跑）
 * 走脚本 `--action analyze`：复用批次打分同一条流水线，判定口径与批次完全一致，
 * 数据源默认新浪（日线 1 次 + 快照 1 次 + 分时 1 次，均不重试），不碰东财被限流的接口。
 * 不依赖批次：分析完自动写一行打分记录（当日单票分析批次），勾选/备注/选中当场就能保存。
 */
async function analyzeStock(symbol, { sector = '', force = false } = {}) {
  const code = String(symbol || '').trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, error: '股票代码需为 6 位数字（例如 002913）。' };

  const now = beijingNow();
  const mins = now.hour * 60 + now.minute;
  // 9:30-11:30 / 13:00-15:00 才算盘中（缓存只留 1 分钟），其余时间留 10 分钟，避免反复打数据源
  const intraday = (mins >= 570 && mins <= 690) || (mins >= 780 && mins <= 900);
  const ttlSec = intraday ? 60 : 600;
  const hit = analyzeCache.get(code);
  if (!force && hit && Date.now() - hit.at < ttlSec * 1000) {
    const cachedData = { ...hit.data, cached: true, age_sec: Math.round((Date.now() - hit.at) / 1000) };
    const withCtx = await withCandidateContext(code, cachedData);
    return { ok: true, data: await attachBaselineSnapshot(code, withCtx) };
  }

  const { params, enabled } = await getEffectiveParams();
  const { paramsFile, rulesFile } = writeParamFiles(`a_${code}`, params, enabled);
  const args = [
    '--action', 'analyze', '--symbol', code,
    '--sector', String(sector || '人工自选').slice(0, 40),
    '--source', params.kline_source || 'sina',
    '--now', beijingIso(), '--params-file', paramsFile, '--rules-file', rulesFile,
  ];

  // 3 次外部请求 + 指标计算，给 90 秒（必须早于反向代理/Cloudflare 的超时）
  const r = await runPython(args, { timeoutMs: Math.min(90000, (Number(params.single_call_timeout_sec) || 20) * 4000), tag: '追资金-单票' });
  for (const f of [paramsFile, rulesFile]) { try { fs.unlinkSync(f); } catch (e) { /* 临时文件删失败不影响结果 */ } }

  if (!r.ok) {
    return { ok: false, error: `单票分析失败：${r.error}`, errorDetail: r.errorDetail || '' };
  }

  const payload = r.data || {};
  const row = (payload.stocks || [])[0] || null;
  if (!row) {
    const sk = (payload.skipped || [])[0];
    const er = (payload.errors || [])[0];
    return {
      ok: false,
      error: sk ? `${code} 未能分析：${sk.reason}` : (er ? `${code} 接口失败：${er.error}` : `${code} 未返回分析结果（可能代码不存在或长期停牌）`),
      errorDetail: (er && er.raw) || '',
    };
  }

  const meta = payload.meta || {};
  const base = {
    stock: row,
    meta,
    warnings: meta.warnings || [],
    data_source: meta.data_source || {},
    analyzed_at: beijingIso(),
    cache_sec: ttlSec,
    cached: false,
    age_sec: 0,
  };
  // 不跑批次也有一行自己的打分记录，分析页的勾选/备注当场能存（落库失败不影响展示）
  const saved = await saveAnalyzeResult(row, meta, now);
  if (saved) {
    base.candidate_id = saved.id;
    base.single_run_id = saved.run_id;
  }
  analyzeCache.set(code, { at: Date.now(), data: base });
  return { ok: true, data: await attachBaselineSnapshot(code, await withCandidateContext(code, base)) };
}

// ============================================================ 定格快照（录入基准评估）

/** 快照摘要（列表与分析页用；K 线与分时体积大，走 /snapshots/:id 单独取） */
function snapshotSummary(s) {
  if (!s) return null;
  return {
    id: s.id, symbol: s.symbol, name: s.name, sector: s.sector,
    snapshot_date: s.snapshot_date, snapshot_time: s.snapshot_time || '',
    kind: s.kind, actual_time: s.actual_time || '', minute_scale: s.minute_scale,
    pool_type: s.pool_type, dow_trend: s.dow_trend, today_pct: s.today_pct,
    auto_score: s.auto_score, max_auto_score: s.max_auto_score,
    manual_score: s.manual_score, total_score: s.total_score,
    eliminated: !!s.eliminated, elim_source: s.elim_source,
    red_lines: s.red_lines || [], score_detail: s.score_detail || [],
    manual_checks: s.manual_checks || [], remark: s.remark || null, human_from: s.human_from || '',
    weakest_gap: s.weakest_gap, suggest_hold: s.suggest_hold, retrace: s.retrace,
    indicators: s.indicators || {}, fib_info: s.fib_info || null, chip: s.chip || null,
    fund_flow: s.fund_flow || null, data_as_of: s.data_as_of,
    source: s.source, is_baseline: !!s.is_baseline,
    meta: s.meta || {}, updated_at: s.updatedAt, created_at: s.createdAt,
  };
}

/**
 * 把一次脚本输出固化成定格快照行（不随后续新增 K 线重算）
 * 同一 symbol + 快照日 + 快照时刻只留一份（盘中/收盘由时刻是否为空区分）；
 * 但该时间点已有存档时默认**原样保留不覆盖** —— 快照是回溯用的东西，不能被下一次重算悄悄改掉，
 * 只有上层拿到人工确认（opts.overwrite=true）才重写。
 * opts.setBaseline：true=抢基准 / false=不动 / 'auto'（默认）= 该票还没有任何基准时才顶上，
 * 避免新生成的一份把录入基准挤掉（多份并存、基准人工自由切换）。
 * → { rec, existed, skipped, isBaseline }（isBaseline= 这一份当前是不是基准，覆盖基准旧存档时仍为 true）；写库失败返回 null
 */
async function writeSnapshot(row, meta = {}, opts = {}) {
  try {
    const code = String(opts.symbol || row.symbol || '').trim();
    const cand = opts.candidate || null;
    const snapMeta = meta.snapshot || {};
    const time = opts.kind === 'intraday' ? String(opts.snapshot_time || meta.run_time || bizTime()).slice(0, 5) : '';
    const kind = time ? 'intraday' : 'close';
    const manualScore = cand ? Number(cand.manual_score || 0) : 0;
    const fields = {
      symbol: code,
      name: opts.name || row.name || (cand && cand.name) || '',
      sector: opts.sector || row.sector || (cand && cand.sector) || '人工自选',
      snapshot_date: opts.snapshot_date || meta.trade_date || bizDate(),
      snapshot_time: time,
      kind,
      actual_time: kind === 'intraday' ? (snapMeta.actual_time || time) : '',
      minute_scale: snapMeta.minute_scale || null,
      pool_type: row.pool_type || (cand && cand.pool_type) || null,
      dow_trend: row.dow_trend || null,
      today_pct: row.today_pct == null ? 0 : row.today_pct,
      auto_score: row.auto_score || 0,
      max_auto_score: row.max_auto_score || 0,
      manual_score: manualScore,
      total_score: (row.auto_score || 0) + manualScore,
      eliminated: !!row.eliminated || !!(cand && cand.eliminated),
      elim_source: row.eliminated ? 'auto' : ((cand && cand.elim_source) || null),
      score_detail: row.score_detail || [],
      red_lines: row.red_lines || [],
      manual_checks: (cand && cand.manual_checks) || [],
      remark: (cand && cand.remark) || null,
      human_from: cand ? `candidate#${cand.id}` : (opts.human_from || '无人工态（当时还没勾选）'),
      weakest_gap: row.weakest_gap || '',
      suggest_hold: row.suggest_hold || '',
      retrace: row.retrace == null ? null : row.retrace,
      indicators: { ...(row.indicators || {}), warnings: row.warnings || [] },
      fib_info: row.fib_info || null,
      chip: row.chip || null,
      fund_flow: row.fund_flow || null,
      kline: row.kline || null,
      minutes: row.minutes || null,
      data_as_of: row.data_as_of || meta.data_as_of || null,
      meta: {
        intraday: !!meta.intraday,
        vol_scale: meta.vol_scale,
        elapsed_trading_min: meta.elapsed_trading_min,
        data_source: meta.data_source || null,
        warnings: meta.warnings || [],
        snapshot: snapMeta,
        // 快照不请求板块资金流与筹码，页面上要能说清当时缺了什么
        skipped_inputs: opts.skipped_inputs || [],
      },
      source: opts.source || 'manual',
      from_candidate_id: cand ? cand.id : null,
    };
    const had = await MoneyChaseSnapshot.findOne({
      where: { symbol: code, snapshot_date: fields.snapshot_date, snapshot_time: time },
    });
    if (had && opts.overwrite !== true) return { rec: had, existed: true, skipped: true, isBaseline: !!had.is_baseline };
    const rec = had ? await had.update(fields) : await MoneyChaseSnapshot.create(fields);
    const hasBase = await MoneyChaseSnapshot.count({ where: { symbol: code, is_baseline: true } });
    const wantBase = opts.setBaseline === true || (opts.setBaseline !== false && !hasBase);
    if (wantBase) await setSnapshotBaseline(rec);
    console.log(`📌 [追资金] 定格快照 ${code} ${fields.snapshot_date}${time ? ` ${time}（盘中，${fields.minute_scale || '?'} 分钟分时还原）` : ' 收盘定型'}：${fields.pool_type} 池 自动 ${fields.auto_score}/${fields.max_auto_score}${fields.eliminated ? ' 已淘汰' : ''}${had ? '（人工确认覆盖重生成）' : ''}${rec.is_baseline ? ' · 当前基准' : ' · 非基准（基准仍是原先那份）'}`);
    return { rec, existed: !!had, skipped: false, isBaseline: !!rec.is_baseline };
  } catch (e) {
    console.error('⚠️ [追资金] 定格快照写入失败（不影响其他功能）:', e.message);
    return null;
  }
}

/** 基准只能有一条：把该票其他快照的 is_baseline 清掉 */
async function setSnapshotBaseline(rec) {
  await MoneyChaseSnapshot.update({ is_baseline: false }, {
    where: { symbol: rec.symbol, id: { [Op.ne]: rec.id } },
  });
  if (!rec.is_baseline) await rec.update({ is_baseline: true });
  return rec;
}

/** 录入即定格：该票还没基准时，把刚才那次分析结果直接存成基准快照（不额外请求接口）；已有基准就不碰 */
async function ensureEnterSnapshot(code, row, meta, candidate) {
  try {
    const hit = await MoneyChaseSnapshot.findOne({ where: { symbol: code, is_baseline: true }, order: [['id', 'DESC']] });
    if (hit) return hit;
    const r = await writeSnapshot(row, meta, {
      symbol: code,
      name: row.name,
      sector: row.sector,
      snapshot_date: meta.trade_date || bizDate(),
      kind: meta.intraday ? 'intraday' : 'close',
      snapshot_time: meta.intraday ? (meta.run_time || bizTime()) : '',
      source: 'auto_enter',
      candidate,
      human_from: '录入当下',
      skipped_inputs: ['板块资金流（录入自动快照不请求）', '筹码分布（东财接口，不请求）'],
    });
    return r ? r.rec : null;
  } catch (e) {
    return null;
  }
}

/**
 * 页面拿不到基准快照时，用本次分析结果补一份（还是 0 额外请求）
 * 人工态从上下文里拼：勾选取 withCandidateContext 的 enabled 清单，备注取候选行
 */
async function attachBaselineSnapshot(code, data) {
  try {
    if (data.baseline_snapshot || !data.stock) return data;
    const c = data.candidate;
    const human = c ? {
      id: c.id, name: data.stock.name || '', sector: c.sector, pool_type: c.pool_type,
      manual_score: c.manual_score, eliminated: c.eliminated, elim_source: c.elim_source,
      manual_checks: data.manual_checks || [], remark: c.remark || null,
    } : null;
    const snap = await ensureEnterSnapshot(code, data.stock, data.meta || {}, human);
    if (snap) {
      data.baseline_snapshot = snapshotSummary(snap);
      data.snapshot_count = (data.snapshot_count || 0) + 1;
    }
    return data;
  } catch (e) {
    return data;
  }
}

/**
 * 按选定时间点生成定格快照
 * 收盘口径 = 1 次请求（新浪日线，只取到该日）；盘中口径 = 2 次（日线 1 + 分时 1~2），均不重试
 * 盘中分时只覆盖最近约 7 个交易日，超出范围脚本直接回中文错误（不静默降级成收盘口径）
 * 多份并存策略：该时间点已有存档时先查库拦截（连接口都不请求），回 conflict 让上层问人工；
 * 只有人工确认（overwrite=true）才覆盖重生成；默认不抢基准（setBaseline=true 才抢，没基准时顶上）
 */
async function createSnapshot({ symbol, as_of_date, as_of_time, sector, name, setBaseline = false, overwrite = false } = {}) {
  const code = String(symbol || '').trim();
  if (!/^\d{6}$/.test(code)) return { ok: false, error: '股票代码需为 6 位数字（例如 002913）。' };
  const date = String(as_of_date || bizDate()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: '快照日期格式需为 YYYY-MM-DD。' };
  if (date > bizDate()) return { ok: false, error: `快照日期 ${date} 还没到，请选今天（${bizDate()}）或之前的交易日。` };
  let time = String(as_of_time || '').trim();
  if (time === '15:00') time = '';
  if (time) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      return { ok: false, error: '快照时刻格式需为 HH:MM（例如 10:00）；要收盘口径就不填时刻。' };
    }
    if (time < '09:30' || time > '15:00') return { ok: false, error: '盘中快照的时刻要落在 9:30～15:00 之间（集合竞价前没有可比 K 线）。' };
  }

  // 同一时间点重生成：先查本地库（不花请求），默认不覆盖旧存档，把决定权交给人工
  const dup = await MoneyChaseSnapshot.findOne({ where: { symbol: code, snapshot_date: date, snapshot_time: time } });
  if (dup && !overwrite) {
    return {
      ok: false,
      conflict: true,
      error: `${date}${time ? ` ${time}（盘中）` : ' 收盘'}这个时间点已经有定格快照了${dup.is_baseline ? '，而且它就是当前基准那份' : ''}。快照是用来回溯当初选股逻辑的，默认不自动覆盖；确定要用最新数据重算并覆盖它吗？`,
      data: snapshotSummary(dup),
    };
  }

  const cand = await MoneyChaseCandidate.findOne({ where: { symbol: code }, order: [['id', 'DESC']] });
  const { params, enabled } = await getEffectiveParams();
  const { paramsFile, rulesFile } = writeParamFiles(`s_${code}_${date.replace(/-/g, '')}_${time.replace(':', '') || 'cl'}`, params, enabled);
  const args = [
    '--action', 'snapshot', '--symbol', code,
    '--name', String(name || (cand && cand.name) || '').slice(0, 40),
    '--sector', String(sector || (cand && cand.sector) || '人工自选').slice(0, 40),
    '--as-of', date,
    '--source', params.kline_source || 'sina',
    '--now', beijingIso(), '--params-file', paramsFile, '--rules-file', rulesFile,
  ];
  if (time) args.push('--as-of-time', time);

  const r = await runPython(args, { timeoutMs: Math.min(90000, (Number(params.single_call_timeout_sec) || 20) * 4500), tag: '追资金-定格快照' });
  for (const f of [paramsFile, rulesFile]) { try { fs.unlinkSync(f); } catch (e) { /* 临时文件删失败不影响结果 */ } }

  if (!r.ok) {
    return { ok: false, error: `生成快照失败：${r.error}`, errorDetail: r.errorDetail || '' };
  }
  const payload = r.data || {};
  const row = (payload.stocks || [])[0] || null;
  if (!row) {
    const sk = (payload.skipped || [])[0];
    const er = (payload.errors || [])[0];
    return {
      ok: false,
      error: sk ? `${code} 未能生成快照：${sk.reason}` : (er ? `${code} 接口失败：${er.error}` : `${code} 未返回快照结果（可能代码不存在或长期停牌）`),
      errorDetail: (er && er.raw) || '',
    };
  }
  const meta = payload.meta || {};
  const out = await writeSnapshot(row, meta, {
    symbol: code,
    name: row.name || (cand && cand.name) || '',
    sector: row.sector || (cand && cand.sector) || '人工自选',
    snapshot_date: date,
    snapshot_time: time,
    kind: time ? 'intraday' : 'close',
    source: 'manual',
    candidate: cand,
    skipped_inputs: ['板块资金流（快照不请求）', '筹码分布（不请求）'],
    setBaseline: setBaseline === true ? true : 'auto',
    overwrite: true,   // 上面已经把“要不要覆盖”问过人工了，这里才允许写同一时间点
  });
  if (!out || !out.rec) return { ok: false, error: '快照已算出但写库失败（多半是快照表列宽或建表问题），请看后端日志。' };
  return { ok: true, data: snapshotSummary(out.rec), replaced: out.existed, is_baseline: out.isBaseline };
}

/** 某只票的全部快照（摘要，时间倒序） */
async function listSnapshots(symbol) {
  const code = String(symbol || '').trim();
  const rows = await MoneyChaseSnapshot.findAll({ where: { symbol: code }, order: [['snapshot_date', 'DESC'], ['snapshot_time', 'DESC'], ['id', 'DESC']] });
  return rows.map(snapshotSummary);
}

/** 快照全文（含 K 线与分时，页面切图时用） */
async function getSnapshot(id) {
  const s = await MoneyChaseSnapshot.findByPk(id);
  if (!s) return null;
  return {
    ...snapshotSummary(s),
    kline: s.kline || null,
    minutes: s.minutes || null,
  };
}

async function setBaselineSnapshot(id) {
  const s = await MoneyChaseSnapshot.findByPk(id);
  if (!s) return null;
  await setSnapshotBaseline(s);
  return snapshotSummary(s);
}

async function deleteSnapshot(id) {
  const s = await MoneyChaseSnapshot.findByPk(id);
  if (!s) return { ok: false, error: '快照不存在（可能已被删除）' };
  const wasBaseline = !!s.is_baseline;
  await s.destroy();
  // 删掉基准后把最新一条顶上，避免分析页没得对比
  if (wasBaseline) {
    const next = await MoneyChaseSnapshot.findOne({ where: { symbol: s.symbol }, order: [['snapshot_date', 'DESC'], ['snapshot_time', 'DESC'], ['id', 'DESC']] });
    if (next) await setSnapshotBaseline(next);
  }
  return { ok: true };
}

module.exports = {
  RULES_CONFIG_PATH,
  seedRules,
  getRulesDoc,
  getEffectiveParams,
  getHighlightThresholds,
  updateRules,
  resetRules,
  fetchSectors,
  fetchConstituents,
  applyStockPrefs,
  startRun,
  startRunWithPrefetch,
  cleanupStaleRuns,
  getRunStatus,
  listRuns,
  getCandidates,
  getCandidateKline,
  updateCandidate,
  adjustManualStocks,
  getManualStocks,
  analyzeStock,
  queueAutoAnalyze,
  latestScores,
  createSnapshot,
  listSnapshots,
  getSnapshot,
  setBaselineSnapshot,
  deleteSnapshot,
  ensureDefaultSchedules,
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  autoRun,
  beijingIso,
};
