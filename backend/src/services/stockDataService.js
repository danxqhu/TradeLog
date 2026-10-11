/**
 * 股票数据服务 - 预留真实API接口
 *
 * 当前使用模拟数据，后续可接入以下API：
 * - AKShare: https://akshare.akfamily.xyz/
 * - Tushare: https://tushare.pro/
 * - 东方财富API
 * - 新浪财经API
 */

// 获取实时行情（模拟数据）
async function getRealtimeQuote(stockCode) {
  // TODO: 接入真实API
  return {
    code: stockCode,
    name: `模拟${stockCode}`,
    current_price: (Math.random() * 50 + 10).toFixed(2),
    open: (Math.random() * 50 + 10).toFixed(2),
    high: (Math.random() * 50 + 15).toFixed(2),
    low: (Math.random() * 50 + 5).toFixed(2),
    close: (Math.random() * 50 + 10).toFixed(2),
    volume: Math.floor(Math.random() * 10000000),
    turnover: Math.floor(Math.random() * 500000000),
    change: (Math.random() * 4 - 2).toFixed(2),
    change_percent: (Math.random() * 8 - 4).toFixed(2),
    timestamp: new Date().toISOString(),
    source: 'mock',
  };
}

// 获取历史K线数据（模拟数据）
async function getHistoryKline(stockCode, startDate, endDate) {
  // TODO: 接入真实API
  const records = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue; // 跳过周末

    records.push({
      date: d.toISOString().split('T')[0],
      open: (Math.random() * 50 + 10).toFixed(2),
      high: (Math.random() * 50 + 15).toFixed(2),
      low: (Math.random() * 50 + 5).toFixed(2),
      close: (Math.random() * 50 + 10).toFixed(2),
      volume: Math.floor(Math.random() * 10000000),
      turnover: Math.floor(Math.random() * 500000000),
    });
  }

  return records;
}

// 获取实时成交额排行（模拟数据）
async function getTurnoverRanking(limit = 20) {
  // TODO: 接入真实API
  const mockStocks = [
    { code: '600519', name: '贵州茅台' },
    { code: '000858', name: '五粮液' },
    { code: '601318', name: '中国平安' },
    { code: '000001', name: '平安银行' },
    { code: '600036', name: '招商银行' },
    { code: '002594', name: '比亚迪' },
    { code: '300750', name: '宁德时代' },
    { code: '601012', name: '隆基绿能' },
    { code: '600276', name: '恒瑞医药' },
    { code: '002475', name: '立讯精密' },
  ];

  return mockStocks.slice(0, limit).map(stock => ({
    ...stock,
    turnover: Math.floor(Math.random() * 10000000000),
    change_percent: (Math.random() * 10 - 5).toFixed(2),
    current_price: (Math.random() * 200 + 10).toFixed(2),
  })).sort((a, b) => b.turnover - a.turnover);
}

// 获取量能数据（模拟数据）
async function getVolumeData(stockCode, days = 30) {
  // TODO: 接入真实API
  const records = [];
  const today = new Date();

  for (let i = days; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dayOfWeek = d.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    records.push({
      date: d.toISOString().split('T')[0],
      volume: Math.floor(Math.random() * 20000000 + 5000000),
      turnover: Math.floor(Math.random() * 500000000 + 100000000),
    });
  }

  return records;
}

module.exports = {
  getRealtimeQuote,
  getHistoryKline,
  getTurnoverRanking,
  getVolumeData,
};
