/**
 * 高盛研报自动分类器
 * 根据分析师、标题、正文内容自动判定报告类型并打标签
 * 
 * 分类规则：
 * - core: 刘劲津/付思团队独立大中华大盘股票策略（核心目标）
 * - core_theme: 刘劲津团队主题型策略（AI/科技等）
 * - apac_view: 慕天辉亚太策略附带中国观点
 * - macro_view: 宏观团队顺带提及股市
 * - gsam_view: GSAM资管买方观点
 * - interview: 媒体专访/路演发言
 * - ignore: 直接丢弃
 */

// 配置词库
const CONFIG = {
  // 核心分析师：刘劲津团队
  core_analysts: ['刘劲津', 'kinger lau', '付思', 'si fu'],
  // 亚太策略分析师
  apac_analysts: ['慕天辉', 'timothy moe'],
  // 宏观分析师
  macro_analysts: ['闪辉', 'hui shan', '迪安竹', 'andrew tilton', '王立升'],
  // GSAM资管
  gsam_analysts: ['gsam', '高盛资产管理', 'christine pu', 'nathan lin'],
  // 大盘关键词
  market_keywords: [
    'msci中国', '沪深300', 'a股', 'h股', '大中华股票策略',
    '中国股市', '中国股票', '中国股市展望', '超配', '增持', '低配',
    'china equit', 'china stock', 'china market', 'greater china',
    'csi 300', 'msci china', 'overweight', 'underweight',
  ],
  // 专访关键词
  interview_words: ['专访', '媒体会', '采访', '路演', '交流会', '论坛', '峰会'],
  // 主题策略关键词
  theme_keywords: ['ai硬科技', 'ai板块', '人工智能', '科技主题', '数字经济'],
  // 过滤词（行业/个股类）
  filter_words: ['个股', '财报', '互联网', '医药', '新能源', '半导体', '消费'],
};

/**
 * 高盛研报自动分类
 * @param {string} title - 标题
 * @param {string} content - 正文/摘要
 * @param {string} extractedAnalyst - 提取到的分析师名字
 * @returns {{ label: string, confidence: number, reason: string, analyst: string, reportType: string }}
 */
function classifyReport(title, content = '', extractedAnalyst = '') {
  const fullText = `${title} ${content} ${extractedAnalyst}`.toLowerCase();

  // 命中检测
  const hitCore = CONFIG.core_analysts.some(x => fullText.includes(x));
  const hitApac = CONFIG.apac_analysts.some(x => fullText.includes(x));
  const hitMacro = CONFIG.macro_analysts.some(x => fullText.includes(x));
  const hitGsam = CONFIG.gsam_analysts.some(x => fullText.includes(x));
  const hitMarket = CONFIG.market_keywords.some(x => fullText.includes(x));
  const hitInterview = CONFIG.interview_words.some(x => fullText.includes(x));
  const hitTheme = CONFIG.theme_keywords.some(x => fullText.includes(x));

  // 推断分析师名称
  let analyst = extractedAnalyst;
  if (!analyst) {
    if (hitCore) analyst = '刘劲津 Kinger Lau';
    else if (hitApac) analyst = '慕天辉 Timothy Moe';
    else if (hitMacro) analyst = '闪辉 Hui Shan';
  }

  // === 判定逻辑 ===
  if (hitCore) {
    if (hitInterview) {
      return {
        label: 'interview', confidence: 0.85, analyst,
        reportType: '专访观点',
        reason: '刘劲津团队，但属于媒体专访/路演，非正式策略研报',
      };
    }
    if (hitTheme && hitMarket) {
      return {
        label: 'core_theme', confidence: 0.8, analyst,
        reportType: '主题策略',
        reason: '刘劲津团队，主题型大盘策略',
      };
    }
    if (hitMarket) {
      return {
        label: 'core', confidence: 0.92, analyst,
        reportType: '年度旗舰', // 默认，后续可根据日期/关键词细分
        reason: '✅ 目标：刘劲津团队大中华大盘股票策略研报',
      };
    }
    return {
      label: 'ignore', confidence: 0.7, analyst,
      reportType: '',
      reason: '刘劲津名字，但无大盘股市观点，跳过',
    };
  }

  if (hitApac) {
    return {
      label: 'apac_view', confidence: 0.8, analyst,
      reportType: '亚太策略附带观点',
      reason: '慕天辉亚太策略，附带中国观点',
    };
  }

  if (hitMacro) {
    return {
      label: 'macro_view', confidence: 0.8, analyst,
      reportType: '宏观附带股市观点',
      reason: '宏观团队，顺带提及股市',
    };
  }

  if (hitGsam) {
    return {
      label: 'gsam_view', confidence: 0.85, analyst: 'GSAM',
      reportType: '买方资管观点',
      reason: 'GSAM资管买方观点，不是GIR卖方研报',
    };
  }

  // 没有命中任何分析师，但命中大盘关键词 → 可能是高盛研报但未识别分析师
  if (hitMarket) {
    return {
      label: 'core', confidence: 0.5, analyst: '高盛研究部',
      reportType: '策略笔记',
      reason: '未识别分析师，但包含大盘关键词，待人工复核',
    };
  }

  return {
    label: 'ignore', confidence: 0.6, analyst: '',
    reportType: '',
    reason: '没有命中目标分析师或关键词，丢弃',
  };
}

/**
 * 细分报告类型（根据标题和日期模式）
 * @param {string} title 
 * @param {string} publishDate 
 * @param {string} baseType - classifyReport 返回的 reportType
 */
function refineReportType(title, publishDate, baseType) {
  const t = title.toLowerCase();
  const month = publishDate ? parseInt(publishDate.split('-')[1]) : 0;

  // 年度旗舰：通常在 12月 或 1月 发布，标题含"展望/outlook"
  if ((month === 12 || month === 1) && (t.includes('展望') || t.includes('outlook') || t.includes('前瞻'))) {
    return '年度旗舰';
  }
  // 中期更新：3-5月 或 8-10月
  if ((month >= 3 && month <= 5) || (month >= 8 && month <= 10)) {
    if (t.includes('更新') || t.includes('update') || t.includes('策略')) {
      return '中期更新';
    }
  }
  // 策略笔记：短小、快速评价
  if (t.includes('note') || t.includes('速评') || t.includes('策略更新')) {
    return '策略笔记';
  }
  return baseType;
}

/**
 * 从文本中提取指数目标价
 */
function extractTargets(text) {
  const result = { msci_china_target: null, csi300_target: null };
  if (!text) return result;

  // MSCI中国目标价
  const msciMatch = text.match(/MSCI中国[^\d]{0,20}(\d{2,4})/i)
    || text.match(/msci\s*china[^\d]{0,20}(\d{2,4})/i);
  if (msciMatch) result.msci_china_target = msciMatch[1];

  // 沪深300目标价
  const csiMatch = text.match(/沪深300[^\d]{0,20}(\d{3,5})/i)
    || text.match(/csi\s*300[^\d]{0,20}(\d{3,5})/i);
  if (csiMatch) result.csi300_target = csiMatch[1];

  return result;
}

module.exports = { classifyReport, refineReportType, extractTargets, CONFIG };
