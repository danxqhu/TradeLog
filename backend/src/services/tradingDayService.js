const { Op } = require('sequelize');
const { TradingCalendar } = require('../models');

// 计算两个日期之间的交易日数
async function calculateTradingDays(startDate, endDate) {
  const count = await TradingCalendar.count({
    where: {
      trade_date: { [Op.between]: [startDate, endDate] },
      is_trading_day: true,
    },
  });
  return count;
}

// 从某日期起加N个交易日，返回目标日期
async function addTradingDays(startDate, tradingDays) {
  const records = await TradingCalendar.findAll({
    where: {
      trade_date: { [Op.gt]: startDate },
      is_trading_day: true,
    },
    order: [['trade_date', 'ASC']],
    limit: parseInt(tradingDays),
  });

  if (records.length === 0) return null;
  return records[records.length - 1].trade_date;
}

// 获取指定日期之前N个交易日的日期
async function getTradingDaysBefore(date, count) {
  const records = await TradingCalendar.findAll({
    where: {
      trade_date: { [Op.lt]: date },
      is_trading_day: true,
    },
    order: [['trade_date', 'DESC']],
    limit: parseInt(count),
  });
  return records.map(r => r.trade_date);
}

// 检查某日期是否为交易日
async function isTradingDay(date) {
  const record = await TradingCalendar.findOne({
    where: { trade_date: date },
  });
  return record ? record.is_trading_day : false;
}

// 获取最近的交易日
async function getNearestTradingDay(date) {
  let record = await TradingCalendar.findOne({
    where: { trade_date: date, is_trading_day: true },
  });
  if (record) return record.trade_date;

  // 向前查找最近30天
  record = await TradingCalendar.findOne({
    where: {
      trade_date: { [Op.lte]: date },
      is_trading_day: true,
    },
    order: [['trade_date', 'DESC']],
  });
  return record ? record.trade_date : null;
}

module.exports = {
  calculateTradingDays,
  addTradingDays,
  getTradingDaysBefore,
  isTradingDay,
  getNearestTradingDay,
};
