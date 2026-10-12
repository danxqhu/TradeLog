/**
 * 定时任务调度器（与服务器时间对齐）
 * - 上海证券报：每天凌晨 3:00 和早上 6:00
 * - 高盛研报：每天 1:00、7:00、13:00、19:00（每6小时）
 * - 成交额快照：交易日 9:25、9:30-11:30、13:00-15:00 每分钟采集（整秒触发）
 */
const scraperService = require('./scraperService');
const gsScraperService = require('./gsScraperService');
const marketDataService = require('./marketDataService');
const { MarketSnapshot } = require('../models');

// 上海证券报抓取时间
const SCRAPE_HOURS = [3, 6];

// 高盛研报抓取时间（每6h，偏移1小时）
const GS_HOURS = [1, 7, 13, 19];

// 记录已执行过的日期+小时，防止重复
const executed = new Set();

// 获取北京时间
function getBeijingTime() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 8 * 3600000);
}

/**
 * 计算距离下一个整分钟后 1 秒的毫秒数（XX:01 触发，确保时间算对）
 * 例如：当前 14:01:30 → 等待 31秒 → 14:02:01 触发，时间算作 14:02
 */
function getMsToNextMinute() {
  const now = new Date();
  const seconds = now.getSeconds();
  const ms = now.getMilliseconds();
  // 延后 1 秒触发，确保时间算作下一分钟
  const targetMs = (60 - seconds) * 1000 - ms + 1000;
  return targetMs;
}

/**
 * 计算距离下一个10分钟整点的毫秒数
 * 例如：当前 14:07:30 → 等待 2分30秒 → 14:10:00 触发
 */
function getMsToNext10Min() {
  const now = new Date();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const ms = now.getMilliseconds();
  const next10Min = Math.ceil((minutes + 1) / 10) * 10;
  const minsToWait = next10Min - minutes;
  return (minsToWait * 60 - seconds) * 1000 - ms;
}

// 执行上海证券报抓取
async function runScrape() {
  try {
    console.log('⏰ [定时任务] 开始自动抓取上海证券报...');
    const result = await scraperService.scrapeAndSave(null);
    console.log(`⏰ [定时任务] 上证报抓取完成: 新增 ${result.created} 篇，替换 ${result.replaced} 篇`);
  } catch (err) {
    console.error('⏰ [定时任务] 上证报抓取失败:', err.message);
  }
}

// 执行高盛研报抓取
async function runGSScrape() {
  try {
    console.log('⏰ [定时任务] 开始抓取高盛研报...');
    const result = await gsScraperService.scrapeAndSaveReports({ tier: 'all' });
    console.log(`⏰ [定时任务] 高盛研报抓取完成: 新增 ${result.created} 篇`);
  } catch (err) {
    console.error('⏰ [定时任务] 高盛研报抓取失败:', err.message);
  }
}

// 刷新均量缓存（收盘后调用）
async function runAvgRefresh() {
  try {
    console.log('💹 [定时任务] 收盘后刷新均量缓存...');
    const data = await marketDataService.refreshMarketAverages();
    console.log(`💹 [定时任务] 均量缓存已更新: 最新日期 ${data.latestDate}`);
  } catch (err) {
    console.error('💹 [定时任务] 均量刷新失败:', err.message);
  }
}

// 检查是否到了抓取时间
function checkAndRun() {
  const bjTime = getBeijingTime();
  const hour = bjTime.getHours();
  const dateKey = bjTime.toISOString().slice(0, 10);
  const key = `${dateKey}-${hour}`;

  if (SCRAPE_HOURS.includes(hour) && !executed.has(key)) {
    executed.add(key);
    // 清理昨天的记录
    for (const k of executed) {
      if (!k.startsWith(dateKey)) executed.delete(k);
    }
    runScrape();
  }

  // 高盛研报检查
  const gsKey = `gs-${key}`;
  if (GS_HOURS.includes(hour) && !executed.has(gsKey)) {
    executed.add(gsKey);
    runGSScrape();
  }

  // 均量缓存刷新：交易日 15:05 后刷新一次（每10分钟检查，只会命中一次）
  const avgKey = `avg-${dateKey}`;
  const t = hour * 60 + bjTime.getMinutes();
  if (t >= 905 && marketDataService.isTradingDay(bjTime) && !executed.has(avgKey)) {
    executed.add(avgKey);
    runAvgRefresh();
  }
}

// 执行成交额快照采集
async function runSnapshotCollect() {
  try {
    const data = await marketDataService.fetchMarketData();
    const bjTime = getBeijingTime();
    const dateStr = bjTime.toISOString().split('T')[0];
    const timeStr = `${String(bjTime.getHours()).padStart(2, '0')}:${String(bjTime.getMinutes()).padStart(2, '0')}`;

    const [snapshot, created] = await MarketSnapshot.findOrCreate({
      where: {
        snapshot_date: dateStr,
        snapshot_time: timeStr,
      },
      defaults: {
        snapshot_date: dateStr,
        snapshot_time: timeStr,
        sh_turnover: Math.round(data.shanghai?.turnover || 0),
        sz_turnover: Math.round(data.shenzhen?.turnover || 0),
        bj_turnover: Math.round(data.beijing?.turnover || 0),
        total_turnover: Math.round(data.total?.turnover || 0),
        sh_index: data.shanghai?.current || 0,
        sz_index: data.shenzhen?.current || 0,
        bj_index: data.beijing?.current || 0,
      },
    });

    if (!created) {
      await snapshot.update({
        sh_turnover: Math.round(data.shanghai?.turnover || 0),
        sz_turnover: Math.round(data.shenzhen?.turnover || 0),
        bj_turnover: Math.round(data.beijing?.turnover || 0),
        total_turnover: Math.round(data.total?.turnover || 0),
        sh_index: data.shanghai?.current || 0,
        sz_index: data.shenzhen?.current || 0,
        bj_index: data.beijing?.current || 0,
      });
    }

    console.log(`📊 [成交额] ${timeStr} 采集成功: ${data.total?.turnoverYi || 0}亿`);
  } catch (err) {
    console.error('📊 [成交额] 采集失败:', err.message);
  }
}

/**
 * 根据当前市场状态决定下次检查间隔
 * - 交易时段（9:25、9:30-11:30、13:00-15:00）：每分钟
 * - 交易日非交易时段（午休、收盘后、盘前）：每30分钟
 * - 非交易日（周末、节假日）：每2小时
 * - 临近开盘（9:20-9:24）：每10秒，确保9:25准时采集
 */
function getSnapshotCheckInterval() {
  const bjTime = marketDataService.getBeijingTime();
  const day = bjTime.getDay();
  const h = bjTime.getHours();
  const m = bjTime.getMinutes();
  const t = h * 60 + m;

  // 非交易日：每2小时检查一次
  if (!marketDataService.isTradingDay(bjTime)) {
    return 2 * 60 * 60 * 1000;
  }

  // 交易时段：每分钟
  if (marketDataService.isMarketHours()) {
    return 60 * 1000;
  }

  // 临近开盘（9:20-9:24）：每10秒，确保9:25准时采集
  if (t >= 560 && t < 565) {
    return 10 * 1000;
  }

  // 交易日非交易时段（午休、盘前、收盘后）：每30分钟
  return 30 * 60 * 1000;
}

// 获取间隔描述
function getIntervalDesc(ms) {
  if (ms >= 3600000) return `${Math.round(ms / 3600000)}小时后`;
  if (ms >= 60000) return `${Math.round(ms / 60000)}分钟后`;
  return `${Math.round(ms / 1000)}秒后`;
}

// 每分钟/定期 检查是否需要采集成交额（与服务器时间对齐）
function checkSnapshot() {
  if (marketDataService.isMarketHours()) {
    runSnapshotCollect();
  }
  // 根据市场状态动态调整下次检查间隔
  const waitMs = getSnapshotCheckInterval();
  console.log(`💹 成交额下次检查: ${getIntervalDesc(waitMs)}`);
  setTimeout(checkSnapshot, waitMs);
}

// 每10分钟检查新闻抓取（与服务器时间对齐）
function checkNewsAligned() {
  checkAndRun();
  // 计算到下一个10分钟的等待时间
  const waitMs = getMsToNext10Min();
  setTimeout(checkNewsAligned, waitMs);
}

// 启动
function startScheduler() {
  const bjTime = getBeijingTime();
  console.log(`⏰ 定时任务已启动（北京时间: ${bjTime.toISOString().replace('T', ' ').slice(0, 19)}）`);
  console.log(`   📰 上海证券报：每天 ${SCRAPE_HOURS.map(h => `${h}:00`).join(', ')}`);
  console.log(`   📊 高盛研报：每天 ${GS_HOURS.map(h => `${h}:00`).join(', ')}`);
  console.log(`   💹 成交额快照：交易日 9:25、9:30-11:30、13:00-15:00 每分钟（整秒触发）`);
  
  // 启动时先执行一次
  checkAndRun();
  if (marketDataService.isMarketHours()) {
    runSnapshotCollect();
  }
  
  // 对齐时间后启动定时器
  const waitSnapshot = getSnapshotCheckInterval();
  const waitNews = getMsToNext10Min();
  
  console.log(`   ⏱️  成交额下次检查: ${getIntervalDesc(waitSnapshot)}`);
  console.log(`   ⏱️  新闻下次检查: ${getIntervalDesc(waitNews)}`);
  
  setTimeout(checkSnapshot, waitSnapshot);  // 每分钟整秒触发
  setTimeout(checkNewsAligned, waitNews);   // 每10分钟整点触发
}

module.exports = { startScheduler };
