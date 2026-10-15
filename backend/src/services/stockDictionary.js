/**
 * A股股票词典 —— 数据库为唯一数据源，内存缓存加速查询
 * 功能：
 *   1. 启动时从 DB 加载全市场上市股票到内存（name 简称 + full_name 全称）
 *   2. detectStocks() 用内存缓存快速匹配新闻中的股票
 *   3. syncDictionary() 增量同步：AKShare 拉取 → 对比 DB → 新增/更新/标记退市
 *
 * 核心原则：
 *   - 股票记录物理永不删除，退市只 UPDATE 状态标记
 *   - 匹配候选词只能来自 Stock 表，禁止硬编码任何股票名单
 */
const { Op } = require('sequelize');
const { Stock } = require('../models');
const { execFile } = require('child_process');
const path = require('path');

// Python 脚本路径（AKShare 拉取全市场 A 股）
const FETCH_STOCKS_SCRIPT = path.join(__dirname, '../../scripts/fetch_stocks.py');

// 安全阈值：AKShare 返回数量低于此值则判定接口异常，终止同步防止误标记退市
const MIN_SAFE_COUNT = 5400;

// ===== 内存缓存 =====
let stockNameMap = new Map(); // name/full_name -> {code, name}
let stockCodeMap = new Map(); // code -> {code, name}
let loaded = false;

// 6位数字股票代码正则
const CODE_REGEX = /\b([036]\d{5})\b/g;

// ===== 从 DB 加载到内存（仅加载 LISTED 股票，包含 full_name）=====
async function loadFromDB() {
  try {
    const stocks = await Stock.findAll({
      attributes: ['code', 'name', 'full_name'],
      where: { list_status: 'LISTED' },
      raw: true,
    });
    stockNameMap = new Map();
    stockCodeMap = new Map();
    for (const s of stocks) {
      // 全称和简称都映射到同一个 code，长词优先
      if (s.full_name) {
        stockNameMap.set(s.full_name, { code: s.code, name: s.name });
      }
      stockNameMap.set(s.name, { code: s.code, name: s.name });
      stockCodeMap.set(s.code, { code: s.code, name: s.name });
    }
    loaded = true;
    console.log(`✅ 股票词典已从数据库加载：${stocks.length} 只（仅上市股票，含全称+简称）`);
    return stocks.length;
  } catch (err) {
    console.error('从数据库加载股票词典失败:', err.message);
    return 0;
  }
}

// ===== 同步进度追踪（供前端轮询显示）=====
let syncProgress = { percent: 0, stage: '' };

function getSyncProgress() {
  return { ...syncProgress };
}

// ===== 通过 AKShare (Python) 拉取全市场 A 股列表 =====
function fetchAllStocksFromSina() {
  return new Promise((resolve) => {
    console.log('开始通过 AKShare 拉取全市场 A 股列表...');
    syncProgress = { percent: 0, stage: '正在从 AKShare 拉取全市场 A 股...' };
    let stdout = '';
    const proc = execFile('python3', [FETCH_STOCKS_SCRIPT], { timeout: 180000 });
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => {
      const text = d.toString();
      console.log(`  [AKShare] ${text.trim()}`);
      // 解析 tqdm 进度条："Please wait for a moment:  50%|..."
      const match = text.match(/(\d+)%/);
      if (match) {
        syncProgress.percent = parseInt(match[1]);
        syncProgress.stage = `正在拉取股票列表... ${match[1]}%`;
      }
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        console.error('[股票词典] AKShare 脚本失败，退出码:', code);
        return resolve([]);
      }
      try {
        const stocks = JSON.parse(stdout.trim());
        console.log(`[股票词典] AKShare 返回: ${stocks.length} 只`);
        syncProgress = { percent: 40, stage: `拉取完成，共 ${stocks.length} 只，正在对比数据库...` };
        resolve(stocks);
      } catch (e) {
        console.error('[股票词典] JSON 解析失败:', e.message);
        resolve([]);
      }
    });
    proc.on('error', (err) => {
      console.error('[股票词典] Python 进程启动失败:', err.message);
      resolve([]);
    });
  });
}

/**
 * 增量同步股票词典：AKShare 拉取 → 对比 DB → 新增/更新/标记退市
 * 核心原则：永不 DELETE，退市只标记状态
 */
async function syncDictionary() {
  console.log('[股票词典] 开始增量同步...');
  syncProgress = { percent: 0, stage: '开始增量同步...' };

  // 1. 拉取 AKShare 最新 A 股列表
  const latestStocks = await fetchAllStocksFromSina();
  if (latestStocks.length === 0) {
    syncProgress = { percent: 100, stage: '同步结束（API 不可用）' };
    // 外部 API 不可用，刷新内存缓存后返回
    const dbCount = await loadFromDB();
    if (dbCount > 0) {
      return { success: true, count: dbCount, message: `外部 API 不可用，已用 DB 现有数据刷新内存（${dbCount} 只）` };
    }
    return { success: false, message: '拉取失败，外部 API 不可用且 DB 无数据' };
  }

  // 2. 安全阈值校验：防止接口异常导致误标记退市
  if (latestStocks.length < MIN_SAFE_COUNT) {
    syncProgress = { percent: 100, stage: '同步终止（接口异常）' };
    console.error(`[股票词典] ⚠️ AKShare 返回 ${latestStocks.length} 只，低于安全阈值 ${MIN_SAFE_COUNT}，终止本次同步！`);
    return {
      success: false,
      message: `接口异常：AKShare 仅返回 ${latestStocks.length} 只（阈值 ${MIN_SAFE_COUNT}），已终止同步，防止误标记退市`,
    };
  }

  console.log(`[股票词典] AKShare 返回: ${latestStocks.length} 只`);
  syncProgress = { percent: 40, stage: `拉取完成 ${latestStocks.length} 只，正在对比数据库...` };

  // 3. 构建线上市集合 Map: code -> {code, name, market}
  const onlineMap = new Map();
  for (const s of latestStocks) {
    let market = 'SH';
    if (s.code.startsWith('0') || s.code.startsWith('3')) market = 'SZ';
    else if (s.code.startsWith('4') || s.code.startsWith('8') || s.code.startsWith('9')) market = 'BJ';
    onlineMap.set(s.code, { code: s.code, name: s.name, market });
  }
  const onlineCodes = new Set(onlineMap.keys());

  // 4. 查询 DB 全部股票
  const dbStocks = await Stock.findAll({ raw: true });
  const dbCodeSet = new Set(dbStocks.map(s => s.code));
  syncProgress = { percent: 50, stage: '对比完成，正在写入新增股票...' };

  const now = new Date();
  let inserted = 0;
  let updated = 0;
  let delisted = 0;

  // 5. 新增股票：线上有，库里没有
  const toInsert = [];
  for (const [code, info] of onlineMap) {
    if (!dbCodeSet.has(code)) {
      toInsert.push({
        code: info.code,
        name: info.name,
        market: info.market,
        list_status: 'LISTED',
        sync_date: now,
      });
    }
  }
  if (toInsert.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < toInsert.length; i += batchSize) {
      await Stock.bulkCreate(toInsert.slice(i, i + batchSize));
    }
    inserted = toInsert.length;
    console.log(`[股票词典] 新增 ${inserted} 只股票`);
  }
  syncProgress = { percent: 65, stage: `新增 ${inserted} 只，正在更新已有股票...` };

  // 6. 两边都存在的股票：更新名称 + sync_date，状态保持 LISTED
  const toUpdate = [];
  for (const dbStock of dbStocks) {
    if (onlineCodes.has(dbStock.code)) {
      const online = onlineMap.get(dbStock.code);
      const updates = { sync_date: now };
      // 名称有变化才更新
      if (dbStock.name !== online.name) {
        updates.name = online.name;
      }
      // 如果之前是退市状态，重新上市
      if (dbStock.list_status === 'DELISTED') {
        updates.list_status = 'LISTED';
        updates.delist_date = null;
      }
      // 只有确实需要更新的字段才执行
      if (Object.keys(updates).length > 0) {
        toUpdate.push({ code: dbStock.code, updates });
      }
    }
  }
  // 批量更新（逐条 update，Sequelize 不支持批量不同条件的 update）
  for (const item of toUpdate) {
    await Stock.update(item.updates, { where: { code: item.code } });
    updated++;
  }
  if (updated > 0) {
    console.log(`[股票词典] 更新 ${updated} 只股票（名称/状态/同步时间）`);
  }
  syncProgress = { percent: 80, stage: `更新 ${updated} 只，正在检查退市股票...` };

  // 7. 退市股票：库里有，线上列表找不到 → 标记 DELISTED
  const toDelist = [];
  for (const dbStock of dbStocks) {
    if (!onlineCodes.has(dbStock.code) && dbStock.list_status === 'LISTED') {
      toDelist.push(dbStock.code);
    }
  }
  if (toDelist.length > 0) {
    const todayStr = now.toISOString().slice(0, 10);
    await Stock.update(
      { list_status: 'DELISTED', delist_date: todayStr, sync_date: now },
      { where: { code: { [Op.in]: toDelist } } },
    );
    delisted = toDelist.length;
    console.log(`[股票词典] 标记退市 ${delisted} 只: ${toDelist.join(', ')}`);
  }
  syncProgress = { percent: 90, stage: `标记退市 ${delisted} 只，正在刷新缓存...` };

  // 8. 刷新内存缓存
  await loadFromDB();

  const listedCount = await Stock.count({ where: { list_status: 'LISTED' } });
  const delistedCount = await Stock.count({ where: { list_status: 'DELISTED' } });
  console.log(`[股票词典] 同步完成: 上市 ${listedCount} 只, 退市 ${delistedCount} 只 (新增${inserted} 更新${updated} 退市${delisted})`);
  syncProgress = { percent: 100, stage: `同步完成！上市 ${listedCount} 只，退市 ${delistedCount} 只` };

  return {
    success: true,
    count: listedCount,
    delistedCount,
    inserted,
    updated,
    delisted,
    message: `同步完成：上市 ${listedCount} 只，退市 ${delistedCount} 只（本次新增 ${inserted}，更新 ${updated}，标记退市 ${delisted}）`,
  };
}

/**
 * 从文本中识别提及的股票
 * 规则：
 *   - 候选词只能来自 Stock 表的 name/full_name，不在库内的词汇一律忽略
 *   - 长词优先匹配，防止短词误命中
 *   - 结果自动去重
 * @param {string} text - 标题或正文
 * @returns {Array<{code: string, name: string}>}
 */
function detectStocks(text) {
  if (!text) return [];
  const found = new Map(); // code -> {code, name}

  // 1. 股票名称匹配（全称 + 简称，长词优先防止短词误命中）
  const sortedNames = Array.from(stockNameMap.entries())
    .sort((a, b) => b[0].length - a[0].length);

  for (const [stockName, stock] of sortedNames) {
    if (stockName.length >= 2 && text.includes(stockName) && !found.has(stock.code)) {
      found.set(stock.code, { code: stock.code, name: stock.name });
    }
  }

  // 2. 股票代码匹配（6位数字，只匹配 Stock 表中存在的代码）
  const codeMatches = text.match(CODE_REGEX);
  if (codeMatches) {
    for (const code of codeMatches) {
      if (!found.has(code)) {
        const stock = stockCodeMap.get(code);
        if (stock) {
          found.set(code, { code, name: stock.name });
        }
      }
    }
  }

  return Array.from(found.values());
}

// 启动时从 DB 加载
loadFromDB();

module.exports = {
  detectStocks,
  syncDictionary,
  refreshDictionary: syncDictionary, // 兼容旧调用名
  loadFromDB,
  getSyncProgress,
  getDictInfo: async () => {
    try {
      const listedCount = await Stock.count({ where: { list_status: 'LISTED' } });
      const delistedCount = await Stock.count({ where: { list_status: 'DELISTED' } });
      return { count: listedCount, delistedCount, loaded };
    } catch (e) {
      return { count: 0, delistedCount: 0, loaded: false };
    }
  },
};
