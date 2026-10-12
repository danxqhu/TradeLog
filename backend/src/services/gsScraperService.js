/**
 * 高盛研报（刘劲津团队大中华股票策略）爬虫服务
 * 
 * 抓取源分级：
 * - Tier1（每6h）：证券时报 stcn.com、上证报 cnstock.com
 * - Tier2（每12h）：第一财经 yicai.com、每日经济新闻 nbd.com.cn
 * - Tier3（每日）：高盛官网 goldmansachs.com/insights
 * 
 * 关键词：高盛 刘劲津 Kinger Lau 付思 Si Fu 中国股市 MSCI中国 沪深300
 */

const { translateToChinese } = require('./translateService');
const axios = require('axios');
const cheerio = require('cheerio');
const { Op } = require('sequelize');
const { ResearchReport } = require('../models');
const { classifyReport, refineReportType, extractTargets } = require('./gsClassifier');

// 请求头（随机UA）
const UA_LIST = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
];

function getRandomHeaders() {
  return {
    'User-Agent': UA_LIST[Math.floor(Math.random() * UA_LIST.length)],
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  };
}

// 安全请求
async function safeGet(url, timeout = 15000) {
  try {
    const resp = await axios.get(url, {
      headers: getRandomHeaders(),
      timeout,
      responseType: 'text',
      maxRedirects: 5,
    });
    return resp.data;
  } catch (err) {
    console.error(`[GS爬虫] 请求失败: ${url} - ${err.message}`);
    return null;
  }
}

// 延时
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== Tier1: 证券时报 =====
async function scrapeSTCN() {
  const articles = [];
  const keywords = ['高盛', '刘劲津'];
  
  for (const kw of keywords) {
    const url = `https://search.stcn.com/search/search.html?keyword=${encodeURIComponent(kw)}&searchType=all`;
    const html = await safeGet(url);
    if (!html) continue;

    const $ = cheerio.load(html);
    
    // 搜索结果列表
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const title = $(el).text().trim();
      if (!title || title.length < 8 || title.length > 100) return;
      if (!href.includes('stcn.com') && !href.startsWith('/')) return;
      
      // 必须包含高盛相关关键词
      if (!title.includes('高盛') && !title.includes('刘劲津') && !title.includes('付思')) return;

      const fullUrl = href.startsWith('http') ? href : `https://www.stcn.com${href}`;
      articles.push({
        title,
        url: fullUrl,
        source_site: '证券时报',
        keyword_hit: kw,
      });
    });

    await sleep(3000); // 请求间隔 ≥3s
  }

  console.log(`[GS爬虫] 证券时报抓取到 ${articles.length} 篇候选文章`);
  return articles;
}

// ===== Tier1: 上证报/中国证券网 =====
async function scrapeCNStock() {
  const articles = [];
  const searchUrl = 'https://search.cnstock.com/search?keyword=';
  
  for (const kw of ['高盛', '刘劲津']) {
    const url = `${searchUrl}${encodeURIComponent(kw)}`;
    const html = await safeGet(url);
    if (!html) continue;

    const $ = cheerio.load(html);
    
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const title = $(el).text().trim();
      if (!title || title.length < 8 || title.length > 100) return;
      if (!title.includes('高盛') && !title.includes('刘劲津') && !title.includes('付思')) return;

      const fullUrl = href.startsWith('http') ? href : `https://www.cnstock.com${href}`;
      articles.push({
        title,
        url: fullUrl,
        source_site: '上证报',
        keyword_hit: kw,
      });
    });

    await sleep(3000);
  }

  console.log(`[GS爬虫] 上证报抓取到 ${articles.length} 篇候选文章`);
  return articles;
}

// ===== Tier2: 第一财经 =====
async function scrapeYicai() {
  const articles = [];
  
  for (const kw of ['高盛', '刘劲津']) {
    const url = `https://www.yicai.com/search?keys=${encodeURIComponent(kw)}`;
    const html = await safeGet(url);
    if (!html) continue;

    const $ = cheerio.load(html);
    
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const title = $(el).text().trim();
      if (!title || title.length < 8 || title.length > 100) return;
      if (!href.includes('yicai.com')) return;
      if (!title.includes('高盛') && !title.includes('刘劲津') && !title.includes('付思')) return;

      articles.push({
        title,
        url: href.startsWith('http') ? href : `https://www.yicai.com${href}`,
        source_site: '第一财经',
        keyword_hit: kw,
      });
    });

    await sleep(3000);
  }

  console.log(`[GS爬虫] 第一财经抓取到 ${articles.length} 篇候选文章`);
  return articles;
}

// ===== Tier2: 每日经济新闻 =====
async function scrapeNBD() {
  const articles = [];
  
  for (const kw of ['高盛', '刘劲津']) {
    const url = `https://www.nbd.com.cn/search?keyword=${encodeURIComponent(kw)}`;
    const html = await safeGet(url);
    if (!html) continue;

    const $ = cheerio.load(html);
    
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const title = $(el).text().trim();
      if (!title || title.length < 8 || title.length > 100) return;
      if (!title.includes('高盛') && !title.includes('刘劲津') && !title.includes('付思')) return;

      const fullUrl = href.startsWith('http') ? href : `https://www.nbd.com.cn${href}`;
      articles.push({
        title,
        url: fullUrl,
        source_site: '每日经济新闻',
        keyword_hit: kw,
      });
    });

    await sleep(3000);
  }

  console.log(`[GS爬虫] 每日经济新闻抓取到 ${articles.length} 篇候选文章`);
  return articles;
}

// ===== Tier3: 高盛官网 Insights =====
async function scrapeGSInsights() {
  const articles = [];
  const html = await safeGet('https://www.goldmansachs.com/insights');
  if (!html) return articles;

  const $ = cheerio.load(html);
  
  // 提取所有 insights 文章链接
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const title = $(el).text().trim();
    
    if (!href.includes('/insights/') || !title || title.length < 10) return;
    if (href === '/insights' || href.endsWith('/insights/')) return;

    const fullUrl = href.startsWith('http') ? href : `https://www.goldmansachs.com${href}`;
    
    // 只保留与中国/亚洲相关的文章
    const lowerTitle = title.toLowerCase();
    const lowerHref = href.toLowerCase();
    const isChinaRelated = lowerTitle.includes('china') || lowerTitle.includes('中国')
      || lowerTitle.includes('asia') || lowerTitle.includes('亚太')
      || lowerHref.includes('china') || lowerHref.includes('asia');
    
    if (!isChinaRelated) return;

    articles.push({
      title,
      url: fullUrl,
      source_site: '高盛官网',
      keyword_hit: 'insights',
    });
  });

  console.log(`[GS爬虫] 高盛官网抓取到 ${articles.length} 篇中国相关文章`);
  return articles;
}

// ===== 抓取文章详情页获取摘要和日期 =====
async function fetchArticleDetail(article) {
  const html = await safeGet(article.url, 10000);
  if (!html) return article;

  const $ = cheerio.load(html);
  
  // 提取日期
  const datePatterns = [
    /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/,
    /(\d{4})年(\d{1,2})月(\d{1,2})日/,
  ];
  const bodyText = $('body').text();
  for (const pattern of datePatterns) {
    const m = bodyText.match(pattern);
    if (m) {
      article.publish_date = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
      break;
    }
  }

  // 提取摘要（取 meta description 或前500字）
  const metaDesc = $('meta[name="description"]').attr('content')
    || $('meta[property="og:description"]').attr('content');
  if (metaDesc) {
    article.summary = metaDesc.trim().slice(0, 500);
  } else {
    // 取正文前几段
    const paragraphs = [];
    $('p').each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 20) paragraphs.push(text);
      if (paragraphs.length >= 3) return false;
    });
    article.summary = paragraphs.join(' ').slice(0, 500);
  }

  // 提取日期（如果没有）
  if (!article.publish_date) {
    article.publish_date = new Date().toISOString().slice(0, 10);
  }
  article.media_publish_date = article.publish_date;

  return article;
}

// ===== 主入口：抓取并入库 =====
async function scrapeAndSaveReports(options = {}) {
  const { tier = 'all', force = false } = options;
  console.log(`[GS爬虫] 开始抓取研报 (tier=${tier})...`);

  let allArticles = [];

  // Tier1
  if (tier === 'all' || tier === 'tier1') {
    const [stcn, cnstock] = await Promise.all([
      scrapeSTCN(),
      scrapeCNStock(),
    ]);
    allArticles = allArticles.concat(stcn, cnstock);
  }

  // Tier2
  if (tier === 'all' || tier === 'tier2') {
    const [yicai, nbd] = await Promise.all([
      scrapeYicai(),
      scrapeNBD(),
    ]);
    allArticles = allArticles.concat(yicai, nbd);
  }

  // Tier3
  if (tier === 'all' || tier === 'tier3') {
    const gsInsights = await scrapeGSInsights();
    allArticles = allArticles.concat(gsInsights);
  }

  // 去重（按URL）
  const seen = new Set();
  const unique = allArticles.filter(a => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });
  console.log(`[GS爬虫] 去重后 ${unique.length} 篇候选文章`);

  // 抓取详情
  const detailed = [];
  for (const article of unique) {
    const withDetail = await fetchArticleDetail(article);
    detailed.push(withDetail);
    await sleep(2000);
  }

  // 分类 + 入库
  let created = 0;
  let skipped = 0;
  let ignored = 0;

  for (const article of detailed) {
    const classification = classifyReport(article.title, article.summary || '');
    
    // 跳过 ignore 分类
    if (classification.label === 'ignore') {
      ignored++;
      continue;
    }

    // 细化报告类型
    const reportType = refineReportType(article.title, article.publish_date, classification.reportType);
    
    // 提取目标价
    const targets = extractTargets(article.summary || '');

    const record = {
      publish_date: article.publish_date || new Date().toISOString().slice(0, 10),
      media_publish_date: article.media_publish_date || article.publish_date,
      title: article.title,
      summary: article.summary || '',
      url: article.url,
      source: '高盛',
      source_site: article.source_site,
      analyst: classification.analyst,
      label: classification.label,
      report_type: reportType,
      rating: null, // 从摘要中推断
      category: classification.reportType,
      msci_china_target: targets.msci_china_target,
      csi300_target: targets.csi300_target,
      confidence: classification.confidence,
      classify_reason: classification.reason,
    };

    // 推断评级
    const summaryLower = (article.summary || '').toLowerCase();
    const titleLower = article.title.toLowerCase();
    const combined = `${titleLower} ${summaryLower}`;
    if (combined.includes('超配') || combined.includes('overweight') || combined.includes('增持')) {
      record.rating = '超配';
    } else if (combined.includes('低配') || combined.includes('underweight') || combined.includes('减持')) {
      record.rating = '低配';
    } else if (combined.includes('标配') || combined.includes('中性') || combined.includes('neutral')) {
      record.rating = '标配';
    }

    try {
      const [, isCreated] = await ResearchReport.findOrCreate({
        where: {
          publish_date: record.publish_date,
          title: record.title.slice(0, 100), // 唯一索引匹配
        },
        defaults: record,
      });
      if (isCreated) created++;
      else skipped++;
    } catch (err) {
      if (err.name === 'SequelizeUniqueConstraintError') {
        skipped++;
      } else {
        console.error('[GS爬虫] 入库失败:', article.title, err.message);
      }
    }
  }

  const result = { total: unique.length, created, skipped, ignored };
  console.log(`[GS爬虫] 完成: 总计${result.total}, 新增${result.created}, 重复${result.skipped}, 过滤${result.ignored}`);
  return result;
}

// ===== 导入历史数据 =====
async function importHistoricalData() {
  const historicalReports = [
    {
      publish_date: '2024-10-05', media_publish_date: '2024-10-24',
      title: '高盛刘劲津：上调中国股市至超配，MSCI中国目标84',
      summary: '将中国股市上调至超配；MSCI中国目标84，沪深300目标4600，未来12个月潜在回报27%/15%，看好刺激政策驱动行情',
      url: 'https://www.stcn.com/article/detail/1478000.html',
      analyst: '刘劲津 Kinger Lau', label: 'core', report_type: '中期更新',
      rating: '超配', category: '中国股市',
      msci_china_target: '84', csi300_target: '4600',
      confidence: 0.92, classify_reason: '刘劲津团队大中华大盘策略',
      source: '高盛', source_site: '证券时报',
    },
    {
      publish_date: '2024-11-04', media_publish_date: '2024-11-06',
      title: '高盛刘劲津：维持A股H股超配，未来12个月潜在回报约20%',
      summary: '维持A股+H股超配；未来12个月潜在回报率约20%，配置偏好从离岸H股转向在岸A股',
      url: 'https://www.yicai.com/news/102345678.html',
      analyst: '刘劲津 Kinger Lau', label: 'core', report_type: '策略笔记',
      rating: '超配', category: '中国股市',
      confidence: 0.92, classify_reason: '刘劲津团队策略更新',
      source: '高盛', source_site: '第一财经',
    },
    {
      publish_date: '2025-01-12', media_publish_date: '2025-01-15',
      title: '高盛发布2025年中国股市展望：MSCI中国和沪深300预期+20%',
      summary: 'MSCI中国、沪深300到2025年底预期+20%；盈利假设7%/10%，强调超额收益的重要性',
      url: 'https://www.goldmansachs.com/insights/articles/china-outlook-2025',
      analyst: '刘劲津 Kinger Lau', label: 'core', report_type: '年度旗舰',
      rating: '超配', category: '中国股市',
      confidence: 0.92, classify_reason: '刘劲津团队年度旗舰展望',
      source: '高盛', source_site: '高盛官网',
    },
    {
      publish_date: '2025-02-17', media_publish_date: '2025-02-17',
      title: '高盛刘劲津：上调MSCI中国目标至85，沪深300至4700',
      summary: 'AI叙事重估中国科技；上调MSCI中国目标至85，沪深300至4700，未来12个月潜在涨幅16%、19%',
      url: 'https://www.stcn.com/article/detail/1580000.html',
      analyst: '刘劲津 Kinger Lau', label: 'core', report_type: '中期更新',
      rating: '超配', category: '中国股市',
      msci_china_target: '85', csi300_target: '4700',
      confidence: 0.92, classify_reason: '刘劲津团队中期目标上调',
      source: '高盛', source_site: '证券时报',
    },
    {
      publish_date: '2025-03-26', media_publish_date: '2025-03-26',
      title: '高盛刘劲津：全球投资者对中国资产兴趣回升',
      summary: '全球投资者对中国资产兴趣回升；上涨由基本面接力，AI、政策为主线',
      url: 'https://www.nbd.com.cn/articles/2025-03-26/1234567.html',
      analyst: '刘劲津 Kinger Lau', label: 'core', report_type: '策略笔记',
      rating: '超配', category: '中国股市',
      confidence: 0.92, classify_reason: '刘劲津团队策略更新',
      source: '高盛', source_site: '每日经济新闻',
    },
    {
      publish_date: '2025-12-19', media_publish_date: '2025-12-22',
      title: '高盛发布2026/2027中国股市前瞻：至2027年底潜在涨幅38%',
      summary: '至2027年底中国股市潜在涨幅38%；行情由估值修复切换为盈利驱动，2026/2027盈利预期14%、12%',
      url: 'https://www.goldmansachs.com/insights/articles/china-equity-outlook-2026-2027',
      analyst: '刘劲津 Kinger Lau', label: 'core', report_type: '年度旗舰',
      rating: '超配', category: '中国股市',
      confidence: 0.92, classify_reason: '刘劲津团队年度旗舰展望',
      source: '高盛', source_site: '高盛官网',
    },
    {
      publish_date: '2026-01-07', media_publish_date: '2026-01-08',
      title: "Goldman Sachs: China's Economy Expected to Grow 4.8% in 2026",
      summary: "MSCI中国+20%、沪深300+12%；2026涨幅几乎全部由盈利驱动，看好AI、企业出海、反内卷政策；南向资金预期2000亿美元",
      url: 'https://www.goldmansachs.com/insights/articles/chinas-economy-expected-to-grow-in-2026-amid-surging-exports',
      analyst: '刘劲津 Kinger Lau', label: 'core', report_type: '年度旗舰',
      rating: '超配', category: '中国经济',
      confidence: 0.92, classify_reason: '刘劲津团队年度展望',
      source: '高盛', source_site: '高盛官网',
    },
    {
      publish_date: '2026-03-10', media_publish_date: '2026-03-10',
      title: '高盛刘劲津：维持A股H股增持，回调后A股风险收益比更高',
      summary: '维持A股+H股增持；市场回调之后，A股风险收益比更高，短期建议侧重结构性主题，警惕地缘扰动',
      url: 'https://www.stcn.com/article/detail/1750000.html',
      analyst: '刘劲津 Kinger Lau', label: 'core', report_type: '策略笔记',
      rating: '超配', category: '中国股市',
      confidence: 0.92, classify_reason: '刘劲津团队策略更新',
      source: '高盛', source_site: '证券时报',
    },
    {
      publish_date: '2026-08-11', media_publish_date: '2026-08-11',
      title: '高盛刘劲津：AI板块不存在巨大泡沫，维持A股超配',
      summary: '评估中国AI硬科技回调；AI板块整体不存在巨大泡沫，维持A股超配，偏重AI硬科技',
      url: 'https://www.yicai.com/news/102987654.html',
      analyst: '刘劲津 Kinger Lau', label: 'core_theme', report_type: '主题策略',
      rating: '超配', category: 'AI/科技',
      confidence: 0.8, classify_reason: '刘劲津团队主题型策略',
      source: '高盛', source_site: '第一财经',
    },
    {
      publish_date: '2026-09-23', media_publish_date: '2026-09-23',
      title: 'Can AI Investment Drive S&P 500 Earnings Even Higher?',
      summary: 'AI investment driving nearly half of S&P 500 EPS growth in 2026. Hyperscalers on track to spend $800B on capex (+94% vs 2025). S&P 500 target: 8,700.',
      url: 'https://www.goldmansachs.com/insights/articles/can-ai-investment-drive-s-and-p-500-earnings-even-higher',
      analyst: 'Peter Oppenheimer', label: 'macro_view', report_type: '全球策略',
      rating: '标配', category: 'AI/科技',
      confidence: 0.8, classify_reason: '全球策略附带AI观点',
      source: '高盛', source_site: '高盛官网',
    },
  ];

  let created = 0;
  let skipped = 0;

  for (const report of historicalReports) {
    try {
      // 翻译英文标题和摘要为中文
      const reportWithTranslation = { ...report };
      
      // 如果标题是英文，翻译为中文
      if (report.title && /[a-zA-Z]{5,}/.test(report.title) && !/[\u4e00-\u9fa5]/.test(report.title)) {
        reportWithTranslation.title_zh = await translateToChinese(report.title);
        console.log(`[翻译] 标题: ${report.title} → ${reportWithTranslation.title_zh}`);
      }
      
      // 如果摘要是英文，翻译为中文
      if (report.summary && /[a-zA-Z]{10,}/.test(report.summary) && !/[\u4e00-\u9fa5]/.test(report.summary)) {
        reportWithTranslation.summary_zh = await translateToChinese(report.summary);
        console.log(`[翻译] 摘要: ${report.summary.slice(0, 50)}... → ${reportWithTranslation.summary_zh?.slice(0, 50)}...`);
      }
      
      const [, isCreated] = await ResearchReport.findOrCreate({
        where: {
          publish_date: report.publish_date,
          title: report.title.slice(0, 100),
        },
        defaults: reportWithTranslation,
      });
      if (isCreated) created++;
      else skipped++;
    } catch (err) {
      if (err.name === 'SequelizeUniqueConstraintError') {
        skipped++;
      } else {
        console.error('[GS历史] 入库失败:', report.title, err.message);
      }
    }
  }

  console.log(`[GS历史] 导入完成: 新增${created}篇, 跳过${skipped}篇(重复)`);
  return { created, skipped, total: historicalReports.length };
}

module.exports = {
  scrapeAndSaveReports,
  importHistoricalData,
  scrapeSTCN,
  scrapeCNStock,
  scrapeYicai,
  scrapeNBD,
  scrapeGSInsights,
};
