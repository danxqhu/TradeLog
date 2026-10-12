/**
 * A股股票词典 —— 从新浪拉取全市场 5000+ 只股票，持久化到 JSON 文件
 * 支持手动刷新，自动从标题中识别提及的股票
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const DICT_FILE = path.join(__dirname, '../../data/stock_dict.json');

// ===== 手动维护的关键词词典（用于匹配简称变体，如"茅台"→"贵州茅台"）=====
const MANUAL_KEYWORDS = [
  { code: '600519', name: '贵州茅台', keywords: ['贵州茅台', '茅台酒', '茅台集团', '茅台'] },
  { code: '000858', name: '五粮液', keywords: ['五粮液'] },
  { code: '000568', name: '泸州老窖', keywords: ['泸州老窖'] },
  { code: '300750', name: '宁德时代', keywords: ['宁德时代'] },
  { code: '002594', name: '比亚迪', keywords: ['比亚迪'] },
  { code: '601318', name: '中国平安', keywords: ['中国平安', '平安集团'] },
  { code: '600036', name: '招商银行', keywords: ['招商银行'] },
  { code: '000001', name: '平安银行', keywords: ['平安银行'] },
  { code: '600030', name: '中信证券', keywords: ['中信证券'] },
  { code: '000333', name: '美的集团', keywords: ['美的集团'] },
  { code: '000651', name: '格力电器', keywords: ['格力电器', '格力'] },
  { code: '600276', name: '恒瑞医药', keywords: ['恒瑞医药', '恒瑞'] },
  { code: '300760', name: '迈瑞医疗', keywords: ['迈瑞医疗', '迈瑞'] },
  { code: '000002', name: '万科A', keywords: ['万科'] },
  { code: '601857', name: '中国石油', keywords: ['中国石油', '中石油'] },
  { code: '600028', name: '中国石化', keywords: ['中国石化', '中石化'] },
  { code: '601899', name: '紫金矿业', keywords: ['紫金矿业', '紫金'] },
  { code: '600900', name: '长江电力', keywords: ['长江电力'] },
  { code: '601012', name: '隆基绿能', keywords: ['隆基绿能', '隆基'] },
  { code: '002475', name: '立讯精密', keywords: ['立讯精密', '立讯'] },
  { code: '000725', name: '京东方A', keywords: ['京东方'] },
  { code: '603288', name: '海天味业', keywords: ['海天味业'] },
  { code: '600809', name: '山西汾酒', keywords: ['山西汾酒', '汾酒'] },
  { code: '601088', name: '中国神华', keywords: ['中国神华', '神华'] },
  { code: '600941', name: '中国移动', keywords: ['中国移动'] },
  { code: '601398', name: '工商银行', keywords: ['工商银行'] },
  { code: '601939', name: '建设银行', keywords: ['建设银行'] },
  { code: '601688', name: '华泰证券', keywords: ['华泰证券'] },
  { code: '600887', name: '伊利股份', keywords: ['伊利股份', '伊利'] },
  { code: '002352', name: '顺丰控股', keywords: ['顺丰控股', '顺丰'] },
  { code: '300015', name: '爱尔眼科', keywords: ['爱尔眼科'] },
  { code: '002230', name: '科大讯飞', keywords: ['科大讯飞'] },
  { code: '601633', name: '长城汽车', keywords: ['长城汽车', '长城'] },
  { code: '600585', name: '海螺水泥', keywords: ['海螺水泥', '海螺'] },
  { code: '002714', name: '牧原股份', keywords: ['牧原股份', '牧原'] },
  { code: '601888', name: '中国中免', keywords: ['中国中免', '中免'] },
  { code: '300274', name: '阳光电源', keywords: ['阳光电源'] },
  { code: '688981', name: '中芯国际', keywords: ['中芯国际'] },
  { code: '603501', name: '韦尔股份', keywords: ['韦尔股份'] },
  { code: '601766', name: '中国中车', keywords: ['中国中车', '中车'] },
];

// ===== 运行时全市场股票列表 =====
let fullStockList = []; // [{code, name}]
let stockNameMap = new Map(); // name -> {code, name}

// 6位数字股票代码正则
const CODE_REGEX = /\b([036]\d{5})\b/g;

// 构建关键词查找表（手动词典，按长度降序）
const keywordMap = [];
for (const stock of MANUAL_KEYWORDS) {
  for (const kw of stock.keywords) {
    keywordMap.push({ keyword: kw, code: stock.code, name: stock.name });
  }
}
keywordMap.sort((a, b) => b.keyword.length - a.keyword.length);

// ===== 加载/保存持久化词典 =====
function loadFromFile() {
  try {
    if (fs.existsSync(DICT_FILE)) {
      const data = JSON.parse(fs.readFileSync(DICT_FILE, 'utf-8'));
      fullStockList = data.stocks || [];
      rebuildNameMap();
      console.log(`✅ 股票词典已加载：${fullStockList.length} 只（更新于 ${data.updatedAt || '未知'}）`);
      return true;
    }
  } catch (err) {
    console.error('加载股票词典文件失败:', err.message);
  }
  return false;
}

function saveToFile() {
  try {
    const dir = path.dirname(DICT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DICT_FILE, JSON.stringify({
      updatedAt: new Date().toISOString(),
      count: fullStockList.length,
      stocks: fullStockList,
    }, null, 0), 'utf-8');
    console.log(`✅ 股票词典已保存：${fullStockList.length} 只`);
  } catch (err) {
    console.error('保存股票词典失败:', err.message);
  }
}

function rebuildNameMap() {
  stockNameMap = new Map();
  for (const s of fullStockList) {
    stockNameMap.set(s.name, s);
  }
}

// ===== 从新浪拉取全市场 A 股列表 =====
async function fetchAllStocksFromSina() {
  console.log('开始从新浪拉取全市场 A 股列表...');
  const allStocks = [];
  let page = 1;
  const pageSize = 80; // 新浪 API 每页最多返回约 100 条，用 80 留余量

  while (true) {
    const url = `http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${page}&num=${pageSize}&sort=symbol&asc=1&node=hs_a&symbol=&_s_r_a=auto`;
    let retries = 0;
    let success = false;

    while (retries < 3 && !success) {
      try {
        const resp = await axios.get(url, {
          headers: { Referer: 'https://finance.sina.com.cn' },
          timeout: 15000,
          responseType: 'text',
          transformResponse: [(data) => data],
        });

        let data;
        try {
          data = JSON.parse(resp.data);
        } catch (e) {
          console.error(`第${page}页 JSON 解析失败`);
          break;
        }

        if (!Array.isArray(data) || data.length === 0) {
          success = true; // 空页 = 真正结束
          break;
        }

        for (const item of data) {
          if (item.code && item.name) {
            allStocks.push({ code: item.code, name: item.name.trim() });
          }
        }

        success = true;
        if (page % 10 === 0) console.log(`  已拉取 ${page} 页，累计 ${allStocks.length} 只`);
        if (data.length < pageSize) return allStocks; // 最后一页
      } catch (err) {
        retries++;
        if (retries < 3) {
          await new Promise(r => setTimeout(r, 1000 * retries)); // 递增等待
        } else {
          console.error(`第${page}页失败(重试${retries}次):`, err.message);
        }
      }
    }

    if (!success) break;
    page++;
    // 每 10 页暂停 300ms 避免限流
    if (page % 10 === 0) await new Promise(r => setTimeout(r, 300));
  }

  return allStocks;
}

/**
 * 刷新股票词典：从新浪拉取全市场列表并持久化
 */
async function refreshDictionary() {
  const stocks = await fetchAllStocksFromSina();
  if (stocks.length === 0) {
    return { success: false, message: '拉取失败，未获取到任何股票' };
  }

  fullStockList = stocks;
  rebuildNameMap();
  saveToFile();

  return {
    success: true,
    count: stocks.length,
    message: `股票词典已更新：${stocks.length} 只 A 股`,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 从文本中识别提及的股票
 * @param {string} text - 标题或内容
 * @returns {Array<{code: string, name: string}>}
 */
function detectStocks(text) {
  if (!text) return [];
  const found = new Map(); // code -> {code, name}

  // 1. 手动关键词匹配（处理简称变体，如"茅台"→"贵州茅台"）
  for (const { keyword, code, name } of keywordMap) {
    if (text.includes(keyword) && !found.has(code)) {
      found.set(code, { code, name });
    }
  }

  // 2. 全市场股票名称匹配（精确匹配完整名称）
  for (const [stockName, stock] of stockNameMap) {
    if (stockName.length >= 2 && text.includes(stockName) && !found.has(stock.code)) {
      found.set(stock.code, { code: stock.code, name: stock.name });
    }
  }

  // 3. 股票代码匹配（6位数字）
  const codeMatches = text.match(CODE_REGEX);
  if (codeMatches) {
    for (const code of codeMatches) {
      if (!found.has(code)) {
        // 从全市场列表查找
        const stock = fullStockList.find(s => s.code === code);
        if (stock) {
          found.set(code, { code, name: stock.name });
        }
      }
    }
  }

  return Array.from(found.values());
}

// 启动时加载词典
loadFromFile();

module.exports = {
  detectStocks,
  refreshDictionary,
  getDictInfo: () => ({
    count: fullStockList.length,
    manualCount: MANUAL_KEYWORDS.length,
    updatedAt: fs.existsSync(DICT_FILE)
      ? JSON.parse(fs.readFileSync(DICT_FILE, 'utf-8')).updatedAt
      : null,
  }),
};
