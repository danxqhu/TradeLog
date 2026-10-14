/**
 * 上海证券报电子报抓取服务（Node.js 版）
 * 直接在后端运行，前端点击按钮即可触发
 */
const axios = require('axios');
const cheerio = require('cheerio');
const { Op } = require('sequelize');
const { execFile } = require('child_process');
const path = require('path');
const { ShanghaiNews, NewsStock } = require('../models');
const { detectStocks } = require('./stockDictionary');

// Python 流水线脚本路径
const PIPELINE_SCRIPT = path.join(__dirname, '../../scripts/news_stock_pipeline.py');

const EPAPER_URL = 'http://paper.cnstock.com';
const CHANNEL_URL = 'https://www.cnstock.com/channel/10232';
const BASE_URL = 'https://www.cnstock.com';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

// ===== 抓取进度 SSE 推送（与 market.js 同一模式） =====
const scrapeProgress = {
  stage: '', percent: 0, current: 0, total: 0, message: '',
};
const progressClients = new Set();

function broadcastProgress(event, data) {
  Object.assign(scrapeProgress, data);
  const msg = `event: ${event}\ndata: ${JSON.stringify(scrapeProgress)}\n\n`;
  for (const client of progressClients) {
    client.write(msg);
  }
}

// 安全请求
async function safeGet(url, timeout = 15000) {
  try {
    const resp = await axios.get(url, {
      headers: HEADERS,
      timeout,
      responseType: 'text',
      // 处理编码
      transformResponse: [(data) => data],
    });
    return resp.data;
  } catch (err) {
    console.error(`请求失败: ${url} - ${err.message}`);
    return null;
  }
}

// 标题关键词过滤（信息披露/公告/简报类）
const TITLE_KEYWORDS = [
  '公告', '报告书', '说明书', '决议', '核查意见', '激励对象名单',
  '权益变动', '上接', '下转', '股东会', '产销快报', '销售情况简报',
  '营业收入简报', '运输生产情况简报', '自查报告', '简报',
  '提示性公告', '发售公告', '上市公告书', '减持', '分红',
];

// 判断标题是否应被过滤
function shouldFilterTitle(title) {
  if (!title) return false;
  // 关键词过滤
  if (TITLE_KEYWORDS.some(kw => title.includes(kw))) return true;
  // 纯公司名标题
  if (/^[^，。！？、\s]+股份有限公司$/.test(title)) return true;
  if (/^[^，。！？、\s]+有限公司$/.test(title) && title.length < 20) return true;
  // 版面概览文本误入（如 "7版 广告"、"8版 广告"）
  if (/^[A-Z]?\d+版\s+/.test(title)) return true;
  return false;
}

// 从电子报抓取文章列表（支持指定日期）
async function scrapeEPaper(targetDate) {
  // 根据日期构建 URL：今天用首页，过去日期用 html/YYYY-MM/DD/node_3.htm
  let url;
  if (targetDate) {
    const [y, m, d] = targetDate.split('-');
    url = `${EPAPER_URL}/html/${y}-${m}/${d}/node_3.htm`;
  } else {
    url = EPAPER_URL + '/';
  }

  const html = await safeGet(url);
  if (!html) return [];

  const $ = cheerio.load(html);

  // 自动检测页面日期
  const dateMatch = html.match(/(\d{1,2})月(\d{1,2})日/);
  let pageDate;
  if (dateMatch) {
    const year = new Date().getFullYear();
    const month = String(dateMatch[1]).padStart(2, '0');
    const day = String(dateMatch[2]).padStart(2, '0');
    pageDate = `${year}-${month}-${day}`;
  } else if (targetDate) {
    pageDate = targetDate;
  } else {
    pageDate = new Date().toISOString().slice(0, 10);
  }

  // 计算日期路径
  const dt = new Date(pageDate);
  const datePath = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`;

  // 从版面导航区提取版名映射（支持 A1：封面 和 8：信息披露 两种格式）
  const sectionNames = {};
  $('li, h2, h3, div').each((_, el) => {
    const text = $(el).text().trim();
    const m = text.match(/^(\d+版\s+)?([A-Z]?\d+)[：:．]\s*(.+)/);
    if (m) {
      const id = m[2];
      const name = m[3].replace(/\s*\u00a0/g, '').trim();
      sectionNames[id] = name;
    }
  });

  // 同时从 paper-list 版头提取版名（补充导航区可能缺少的数字版面名称）
  // 版头格式如 "2版 要闻"、"A1版 基金周刊"
  const headerSectionPattern = /^([A-Z]?\d+)版\s+(.+)/;
  $('div.paper-list li').each((_, el) => {
    const text = $(el).text().trim();
    const m = text.match(headerSectionPattern);
    if (m && !sectionNames[m[1]]) {
      sectionNames[m[1]] = m[2].replace(/\s+/g, '').trim();
    }
  });

  // ===== 两遍扫描解析 =====
  // 关键发现：HTML 中版面概览出现在该版文章之后
  // 如 "2版 要闻" 出现在第1版文章之后，且第1版（封面）没有概览头
  // 规则：header(N) 和 header(N+1) 之间的文章属于 header(N) 的版面
  //       第一个版头之前的文章属于第 1 版（封面）
  //       最后一个版头之后的文章属于最后一个版头的版面
  const sectionPattern = /^([A-Z]?\d+)版\s+(.+)/;

  // 第一遍：收集所有 li 元素
  const items = [];
  $('div.paper-list li').each((_, el) => {
    const text = $(el).text().trim();
    if (!text || text.length < 2) return;
    const href = $(el).find('a').attr('href') || '';
    const m = text.match(sectionPattern);
    items.push({
      text, href,
      isHeader: !!m,
      sectionId: m ? m[1] : null,
      sectionName: m ? m[2].replace(/\s+/g, '').trim() : null,
    });
  });

  // 第二遍：正向扫描 + 缓冲分配
  const articles = [];
  let buffer = [];       // 暂存当前版面的文章
  let globalOrder = 0;   // 全局顺序计数器（报纸从上到下的原始位置）

  // 推断初始版面（第一个版头之前的文章属于哪个版面）
  // 规则：如果第一个版头是 "A2"，且导航中有 A1，则前面文章属于 A1
  //       如果第一个版头是 "2"，则前面文章属于 "1"
  let flushSection = '1';
  const firstHeader = items.find(it => it.isHeader);
  if (firstHeader) {
    const firstId = firstHeader.sectionId;
    if (/^[A-Z]/.test(firstId)) {
      // 字母版头（如 A2），检查导航中是否有前一个字母版（A1）
      const letter = firstId.charAt(0);
      const num = parseInt(firstId.substring(1));
      if (num > 1) {
        const prevId = letter + (num - 1);
        if (sectionNames[prevId]) {
          flushSection = prevId;
        }
      }
    } else {
      // 数字版头（如 2），前一个版面是数字减1
      const num = parseInt(firstId);
      if (num > 1) flushSection = String(num - 1);
    }
  }

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];

    if (item.isHeader) {
      // 遇到新版头：把缓冲区文章写入（用 flushSection 标注）
      const flushName = sectionNames[flushSection] || '';
      const shouldSkip = flushName.includes('信息披露') || flushName.includes('广告');
      if (!shouldSkip) {
        for (const b of buffer) {
          articles.push({ ...b, _sectionId: flushSection });
        }
      }
      buffer = [];
      flushSection = item.sectionId; // 下一批文章属于当前版头
      continue;
    }

    // 过滤过长文本
    if (item.text.length > 60) continue;
    // 标题关键词过滤
    if (shouldFilterTitle(item.text)) continue;

    // 获取链接
    let articleUrl = '';
    if (item.href.startsWith('http')) {
      articleUrl = item.href;
    } else if (item.href.startsWith('/')) {
      articleUrl = EPAPER_URL + item.href;
    } else if (item.href.startsWith('content_')) {
      articleUrl = `${EPAPER_URL}/html/${datePath}/${item.href}`;
    }

    buffer.push({
      publish_date: pageDate,
      title: item.text,
      content: '',
      url: articleUrl,
      source: '上海证券报',
      mentioned_stocks: detectStocks(item.text),
      _order: ++globalOrder, // 记录报纸从上到下的原始顺序
    });
  }

  // 处理最后一批文章（最后一个版头之后的文章）
  const lastFlushName = sectionNames[flushSection] || '';
  const lastShouldSkip = lastFlushName.includes('信息披露') || lastFlushName.includes('广告');
  if (!lastShouldSkip) {
    for (const b of buffer) {
      articles.push({ ...b, _sectionId: flushSection });
    }
  }

  // 构建最终结果，添加版面显示名和 sort_order
  const finalArticles = articles.map(a => {
    let sectionDisplay = a._sectionId || '';
    const displayName = sectionNames[a._sectionId] || '';
    if (displayName) {
      sectionDisplay = `${a._sectionId}：${displayName}`;
    }
    const { _sectionId, _order, ...rest } = a;
    return { ...rest, section: sectionDisplay, sort_order: _order };
  });

  console.log(`电子报抓取到 ${finalArticles.length} 篇文章 (${pageDate})`);
  return finalArticles;
}

// 从证券频道抓取补充文章
async function scrapeChannel() {
  const html = await safeGet(CHANNEL_URL);
  if (!html) return [];

  const $ = cheerio.load(html);
  const articles = [];
  const seen = new Set();
  const today = new Date().toISOString().slice(0, 10);

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    let title = $(el).text().trim();

    if (!href || !href.includes('/commonDetail/')) return;

    // 清理标题
    title = title.replace(/(券商|新股|A股|期货|债券|金融|产经|股市)\S*\d+.*?(前|小时前|天前|分钟)/g, '').trim();
    title = title.replace(/[·•]\S+$/, '').trim();
    title = title.replace(/(券商|A股|新股|期货|债券|金融|产经|股市)$/, '').trim();

    if (title.length < 5 || title.length > 60) return;

    const fullUrl = href.startsWith('http') ? href : BASE_URL + href;
    if (seen.has(fullUrl)) return;
    seen.add(fullUrl);

    articles.push({
      publish_date: today,
      section: '',
      title,
      content: '',
      url: fullUrl,
      source: '上海证券报',
      mentioned_stocks: detectStocks(title),
    });
  });

  console.log(`证券频道抓取到 ${articles.length} 篇文章`);
  return articles;
}

// 存入数据库（去重）
async function saveToDB(articles) {
  let created = 0;
  let skipped = 0;

  for (const article of articles) {
    try {
      const [record, isCreated] = await ShanghaiNews.findOrCreate({
        where: {
          publish_date: article.publish_date,
          title: article.title,
        },
        defaults: article,
      });
      if (isCreated) created++;
      else skipped++;
    } catch (err) {
      // 唯一约束冲突则跳过
      if (err.name === 'SequelizeUniqueConstraintError') {
        skipped++;
      } else {
        console.error('保存失败:', article.title, err.message);
      }
    }
  }

  return { created, skipped };
}

// 自动清理：删除 90 天前的数据
async function cleanupOldData(days = 90) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const deleted = await ShanghaiNews.destroy({
    where: {
      publish_date: { [Op.lt]: cutoffStr },
    },
  });

  if (deleted > 0) {
    console.log(`已清理 ${deleted} 条 ${days} 天前的旧数据`);
  }
  return deleted;
}

// 主入口：执行抓取并存库（仅抓取电子报内容）
async function scrapeAndSave(targetDate) {
  console.log(`开始抓取上海证券报电子报${targetDate ? ` (${targetDate})` : ' (最新)'}...`);

  // 重置进度
  broadcastProgress('progress', {
    stage: '正在清理旧数据...', percent: 5, current: 0, total: 0, message: '',
  });

  // 1. 先清理旧数据（确保数据库干净）
  await cleanupOldData(90);
  const cleanResult = await cleanupNonEPaper();

  // 2. 抓取电子报
  broadcastProgress('progress', { stage: '正在抓取文章列表...', percent: 15 });
  const epaperArticles = await scrapeEPaper(targetDate);

  broadcastProgress('progress', {
    stage: '正在保存到数据库...', percent: 30,
    message: `抓取到 ${epaperArticles.length} 篇文章`,
  });

  // 3. 删除该日期的旧数据（重新抓取时用新数据完全替换，修复版面标签等）
  const scrapeDate = epaperArticles[0]?.publish_date || targetDate;
  let replaced = 0;
  if (scrapeDate) {
    replaced = await ShanghaiNews.destroy({
      where: { publish_date: scrapeDate },
    });
    if (replaced > 0) {
      console.log(`已删除 ${scrapeDate} 旧数据 ${replaced} 篇，准备写入新数据`);
    }
  }

  // 4. 存库
  const { created, skipped } = await saveToDB(epaperArticles);

  // 5. 再次清理（防止新抓取混入的数据）
  const cleanResult2 = await cleanupNonEPaper();
  const totalCleaned = cleanResult.deleted + cleanResult2.deleted;

  // 6. 自动抓取文章正文（body 字段）
  let bodyResult = { fetched: 0, failed: 0 };
  try {
    // 先查询 body 为空的文章数量
    const pendingCount = await ShanghaiNews.count({
      where: {
        publish_date: scrapeDate,
        body: null,
        url: { [Op.ne]: null },
      },
    });
    broadcastProgress('progress', {
      stage: '正在抓取文章正文...', percent: 40,
      current: 0, total: pendingCount,
      message: pendingCount > 0 ? `共 ${pendingCount} 篇需要抓取正文` : '所有文章已有正文',
    });

    if (pendingCount > 0) {
      bodyResult = await fetchBodies(scrapeDate, (bodyProgress) => {
        const pct = 40 + Math.round((bodyProgress.current / Math.max(bodyProgress.total, 1)) * 55);
        broadcastProgress('progress', {
          stage: '正在抓取文章正文...',
          percent: pct,
          current: bodyProgress.current,
          total: bodyProgress.total,
          message: `正在抓取第 ${bodyProgress.current}/${bodyProgress.total} 篇...`,
        });
      });
    }
    console.log(`正文抓取完成：成功 ${bodyResult.fetched}，失败 ${bodyResult.failed}`);
  } catch (bodyErr) {
    console.error('正文抓取失败（不影响整体流程）:', bodyErr.message);
  }

  // 7. 返回结果
  const result = {
    total: epaperArticles.length,
    created,
    skipped,
    cleaned: totalCleaned,
    replaced,
    bodyFetched: bodyResult.fetched,
    bodyFailed: bodyResult.failed,
    date: scrapeDate || new Date().toISOString().slice(0, 10),
  };

  // 通知完成
  broadcastProgress('done', {
    stage: '抓取完成', percent: 100, current: 0, total: 0,
    message: `新增 ${created} 篇，正文 ${bodyResult.fetched} 篇`,
  });

  console.log('抓取完成:', result);
  return result;
}

// 重新扫描已有文章，使用 Python jieba 匹配（title + body 合并分词）
// 匹配结果双写同步：mentioned_stocks JSON + news_stock 关联表
async function rescanStocks(date) {
  console.log(`开始 jieba 股票匹配${date ? ` (日期: ${date})` : ' (全部文章)'}...`);

  return new Promise((resolve, reject) => {
    const args = [PIPELINE_SCRIPT, '--match'];
    if (date) args.push('--date', date);

    let stdout = '';
    let stderr = '';
    const proc = execFile('python3', args, {
      timeout: 300000,
      env: { ...process.env },
      cwd: path.join(__dirname, '../..'),
    });

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      const line = d.toString().trim();
      if (line) console.log(`  [jieba] ${line}`);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.error('[rescanStocks] Python 脚本失败，退出码:', code);
        return reject(new Error(`Python 脚本失败: ${stderr.slice(-200)}`));
      }
      try {
        const result = JSON.parse(stdout.trim());
        const matchResult = result.match || {};
        console.log(`jieba 匹配完成：${matchResult.total || 0} 篇文章，${matchResult.updated || 0} 篇已更新`);
        resolve({
          total: matchResult.total || 0,
          updated: matchResult.updated || 0,
          details: matchResult.details || [],
        });
      } catch (e) {
        console.error('[rescanStocks] JSON 解析失败:', e.message);
        reject(new Error('Python 脚本输出解析失败'));
      }
    });

    proc.on('error', (err) => {
      console.error('[rescanStocks] Python 进程启动失败:', err.message);
      reject(err);
    });
  });
}

// 抓取文章正文（只处理 body 为空的记录，调用 Python 脚本）
// onProgress: 可选回调 (progress) => void，实时推送每篇文章的抓取进度
async function fetchBodies(date, onProgress) {
  console.log(`开始抓取文章正文${date ? ` (日期: ${date})` : ''}...`);

  return new Promise((resolve, reject) => {
    const args = [PIPELINE_SCRIPT, '--fetch'];
    if (date) args.push('--date', date);

    let stdout = '';
    let stderrBuf = ''; // 行缓冲，用于解析多行 stderr
    let bodyTotal = 0;
    let bodyCurrent = 0;
    const proc = execFile('python3', args, {
      timeout: 600000,
      env: { ...process.env },
      cwd: path.join(__dirname, '../..'),
    });

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => {
      const raw = d.toString();
      stderrBuf += raw;

      // 按行解析（一个 chunk 可能包含多行）
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop(); // 最后一段可能不完整，留到下次

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        console.log(`  [fetch] ${trimmed}`);

        // 解析总数：📝 开始抓取正文（共 N 篇 body 为空的文章）...
        const totalMatch = trimmed.match(/共 (\d+) 篇/);
        if (totalMatch) {
          bodyTotal = parseInt(totalMatch[1]);
          if (onProgress) onProgress({ current: 0, total: bodyTotal });
        }

        // 解析每篇进度：[N/TOTAL] news_id=...
        const progressMatch = trimmed.match(/^\[(\d+)\/(\d+)\]/);
        if (progressMatch) {
          bodyCurrent = parseInt(progressMatch[1]);
          bodyTotal = parseInt(progressMatch[2]);
          if (onProgress) onProgress({ current: bodyCurrent, total: bodyTotal });
        }
      }
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.error('[fetchBodies] Python 脚本失败，退出码:', code);
        return reject(new Error(`Python 脚本失败: ${stderrBuf.slice(-200)}`));
      }
      try {
        const result = JSON.parse(stdout.trim());
        const fetchResult = result.fetch || {};
        console.log(`正文抓取完成：成功 ${fetchResult.fetched || 0}，失败 ${fetchResult.failed || 0}`);
        resolve({
          fetched: fetchResult.fetched || 0,
          failed: fetchResult.failed || 0,
        });
      } catch (e) {
        console.error('[fetchBodies] JSON 解析失败:', e.message);
        reject(new Error('Python 脚本输出解析失败'));
      }
    });

    proc.on('error', (err) => {
      console.error('[fetchBodies] Python 进程启动失败:', err.message);
      reject(err);
    });
  });
}

// 完整流水线：先抓取正文，再运行 jieba 匹配
async function runPipeline(date) {
  console.log(`\u{1f680} 开始完整流水线${date ? ` (日期: ${date})` : ''}...`);

  return new Promise((resolve, reject) => {
    const args = [PIPELINE_SCRIPT, '--fetch', '--match'];
    if (date) args.push('--date', date);

    let stdout = '';
    let stderr = '';
    const proc = execFile('python3', args, {
      timeout: 600000,
      env: { ...process.env },
      cwd: path.join(__dirname, '../..'),
    });

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      const line = d.toString().trim();
      if (line) console.log(`  [pipeline] ${line}`);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`流水线脚本失败: ${stderr.slice(-200)}`));
      }
      try {
        const result = JSON.parse(stdout.trim());
        console.log('流水线完成:', JSON.stringify(result));
        resolve(result);
      } catch (e) {
        reject(new Error('流水线输出解析失败'));
      }
    });

    proc.on('error', (err) => reject(err));
  });
}

// 清理不符合条件的文章（非电子报 + 信息披露/广告/公告/简报 + 版面概览误入）
async function cleanupNonEPaper() {
  const all = await ShanghaiNews.findAll({ raw: true });
  const toDelete = all.filter(a => {
    // 非电子报文章
    if ((!a.section || a.section.trim() === '') && (!a.url || !a.url.includes('paper.cnstock'))) {
      return true;
    }
    // 信息披露或广告版面
    if (a.section && (a.section.includes('信息披露') || a.section.includes('广告'))) {
      return true;
    }
    // 标题过滤（使用统一的过滤函数）
    if (shouldFilterTitle(a.title)) {
      return true;
    }
    // 标题含"广告"
    if (a.title && a.title.includes('广告')) {
      return true;
    }
    return false;
  });

  if (toDelete.length === 0) return { deleted: 0, message: '没有需要清理的文章' };

  const ids = toDelete.map(a => a.id);
  const deleted = await ShanghaiNews.destroy({ where: { id: ids } });
  console.log(`已清理 ${deleted} 篇（非报纸/信息披露/广告/公告/简报）`);
  return { deleted, message: `已清理 ${deleted} 篇（非报纸/信息披露/广告/公告/简报）` };
}

module.exports = {
  scrapeAndSave,
  scrapeEPaper,
  scrapeChannel,
  saveToDB,
  cleanupOldData,
  rescanStocks,
  fetchBodies,
  runPipeline,
  cleanupNonEPaper,
  progressClients,
  broadcastProgress,
};
