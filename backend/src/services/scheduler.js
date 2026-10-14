/**
 * 定时任务调度器 —— 基于 node-cron，显式指定 Asia/Shanghai 时区
 *
 * 任务清单：
 *   1. 成交额快照：交易时段每分钟 :05 秒触发（数据源：新浪财经实时行情）
 *   2. 上海证券报：每天 3:00、6:00
 *   3. 高盛研报：每天 7:00
 *   4. 均量 + 沪深A股成交额刷新：交易日 1:00 + 15:10（数据源：AKShare）
 *      刷新 market_averages 表，前端“历史平均成交额”“均量趋势”“沪深A股成交额”三个卡片同步更新
 *   5. ~~股票词典增量同步~~ 已改为手动触发，不再自动执行
 *   6. ~~交易所官网成交额抓取~~ 已废弃，卡片4改用 AKShare 数据，不再直接抓交易所官网
 *
 * 规则：
 *   - 禁止 setInterval / setTimeout 做分钟级轮询（防时间漂移）
 *   - 所有 cron 表达式显式指定 timezone: 'Asia/Shanghai'
 *   - Docker 容器通过挂载宿主机 /etc/localtime + TZ=Asia/Shanghai 对齐时钟
 */
const cron = require('node-cron');
const scraperService = require('./scraperService');
const gsScraperService = require('./gsScraperService');
const marketDataService = require('./marketDataService');
const stockDictionary = require('./stockDictionary');
const { MarketSnapshot } = require('../models');
const marketRoute = require('../routes/market');

const TZ = 'Asia/Shanghai';

// ==================== 工具函数 ====================

/**
 * 获取北京时间（用于日志打印、业务判断）
 * 注意：仅用于日志/判断，入库时间用行情原始时间戳
 */
function getBeijingTime() {
  return marketDataService.getBeijingTime();
}

/**
 * 判断当前北京时间是否处于 A 股交易时段
 * 采集窗口：9:25、9:30-11:30、13:00-15:00
 */
function isTradingWindow() {
  const bj = getBeijingTime();
  const day = bj.getDay();
  if (day === 0 || day === 6) return false; // 周末
  if (!marketDataService.isTradingDay(bj)) return false; // 节假日

  const h = bj.getHours();
  const m = bj.getMinutes();
  const t = h * 60 + m;

  if (t === 565) return true;            // 9:25
  if (t >= 570 && t <= 690) return true; // 9:30-11:30
  if (t >= 780 && t <= 900) return true; // 13:00-15:00
  return false;
}

// ==================== 任务定义 ====================

/**
 * 任务 1：成交额快照采集（交易时段每分钟 :01 秒）
 */
async function collectSnapshot() {
  if (!isTradingWindow()) return;

  try {
    const data = await marketDataService.fetchMarketData();

    // ★ 使用当前北京时间作为标签（用户看到的时间）
    const bjNow = marketDataService.getBeijingTime();
    const dateStr = `${bjNow.getFullYear()}-${String(bjNow.getMonth() + 1).padStart(2, '0')}-${String(bjNow.getDate()).padStart(2, '0')}`;
    const timeStr = `${String(bjNow.getHours()).padStart(2, '0')}:${String(bjNow.getMinutes()).padStart(2, '0')}`;

    // ★ 行情数据源返回的原始时间戳（用于 collected_at，记录数据实际来自哪个时刻）
    const marketDate = data.marketDate;   // "2026-10-14"
    const marketTime = data.marketTime;   // "09:43:05"
    let collectedAt = null;
    if (marketDate && marketTime) {
      const bjTimeStr = `${marketDate}T${marketTime}+08:00`;
      collectedAt = new Date(bjTimeStr); // 北京时间 → UTC
    }

    const [snapshot, created] = await MarketSnapshot.findOrCreate({
      where: { snapshot_date: dateStr, snapshot_time: timeStr },
      defaults: {
        snapshot_date: dateStr,
        snapshot_time: timeStr,
        collected_at: collectedAt,
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
        collected_at: collectedAt,
        sh_turnover: Math.round(data.shanghai?.turnover || 0),
        sz_turnover: Math.round(data.shenzhen?.turnover || 0),
        bj_turnover: Math.round(data.beijing?.turnover || 0),
        total_turnover: Math.round(data.total?.turnover || 0),
        sh_index: data.shanghai?.current || 0,
        sz_index: data.shenzhen?.current || 0,
        bj_index: data.beijing?.current || 0,
      });
    }

    const turnoverYi = data.total?.turnoverYi || 0;
    console.log(`📊 [成交额] ${timeStr} 采集${created ? '新增' : '更新'}: 全市场${turnoverYi}亿 (UTC:${collectedAt.toISOString()})`);

    // SSE 通知前端立即刷新
    marketRoute._broadcast('snapshot', { time: timeStr, total: turnoverYi });
  } catch (err) {
    console.error('📊 [成交额] 采集失败:', err.message);
  }
}

/**
 * 任务 2：上海证券报抓取
 */
async function runScrape() {
  try {
    console.log('⏰ [定时任务] 开始自动抓取上海证券报...');
    const result = await scraperService.scrapeAndSave(null);
    console.log(`⏰ [定时任务] 上证报抓取完成: 新增 ${result.created} 篇，替换 ${result.replaced} 篇`);
  } catch (err) {
    console.error('⏰ [定时任务] 上证报抓取失败:', err.message);
  }
}

/**
 * 任务 3：高盛研报抓取
 */
async function runGSScrape() {
  try {
    console.log('⏰ [定时任务] 开始抓取高盛研报...');
    const result = await gsScraperService.scrapeAndSaveReports({ tier: 'all' });
    console.log(`⏰ [定时任务] 高盛研报抓取完成: 新增 ${result.created} 篇`);
  } catch (err) {
    console.error('⏰ [定时任务] 高盛研报抓取失败:', err.message);
  }
}

/**
 * 任务 4：均量 + 交易所成交额刷新
 */
async function runAvgRefresh() {
  try {
    console.log('💹 [定时任务] 刷新均量缓存...');
    const data = await marketDataService.refreshMarketAverages();
    console.log(`💹 [定时任务] 均量缓存已更新: 最新日期 ${data.latestDate}`);
  } catch (err) {
    console.error('💹 [定时任务] 均量刷新失败:', err.message);
  }
}

// ==================== 启动调度器 ====================

function startScheduler() {
  const bjTime = getBeijingTime();
  console.log(`⏰ 定时任务已启动（node-cron, 时区: ${TZ}）`);
  console.log(`   当前北京时间: ${bjTime.toISOString().replace('T', ' ').slice(0, 19)}`);

  // ---- 成交额快照：仅在交易时段 :05 秒触发（每分钟） ----
  // 交易窗口：9:25、9:30-11:30、13:00-15:00（周一至周五）
  // 拆分为多条 cron，非交易时段不触发，避免 missed execution 警告
  const snapshotCrons = [
    '25,30-59 9 * * 1-5',  // 9:25 + 9:30-9:59
    '* 10-11 * * 1-5',     // 10:00-11:59（isTradingWindow 精确过滤到 11:30）
    '* 13-14 * * 1-5',     // 13:00-14:59
    '0 15 * * 1-5',        // 15:00 收盘
  ];
  snapshotCrons.forEach(expr => {
    cron.schedule(expr, () => collectSnapshot(), { timezone: TZ });
  });
  console.log('   💹 成交额快照：交易时段 9:25/9:30-11:30/13:00-15:00（每分钟 :05 秒）');

  // ---- 上海证券报：每天 3:00、6:00 ----
  cron.schedule('0 3,6 * * *', () => runScrape(), { timezone: TZ });
  console.log('   📰 上海证券报：每天 3:00, 6:00');

  // ---- 高盛研报：每天 7:00 ----
  cron.schedule('0 7 * * *', () => runGSScrape(), { timezone: TZ });
  console.log('   📊 高盛研报：每天 7:00');

  // ---- 均量刷新：交易日 1:00 + 15:10:05 ----
  cron.schedule('0 1 * * *', () => {
    if (marketDataService.isTradingDay(getBeijingTime())) {
      runAvgRefresh();
    }
  }, { timezone: TZ });

  // 收盘后 10 分钟抓取，确保 AKShare 数据已更新
  cron.schedule('5 10 15 * * *', async () => {
    if (marketDataService.isTradingDay(getBeijingTime())) {
      await runAvgRefresh();
      // SSE 通知前端刷新均量数据 + 趋势图 + 沪深成交额
      marketRoute._broadcast('averages', { refreshed: true });
    }
  }, { timezone: TZ });
  console.log('   💹 均量刷新：交易日 1:00 + 15:10:05');


}

module.exports = { startScheduler };
