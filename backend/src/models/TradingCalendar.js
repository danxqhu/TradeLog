const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const TradingCalendar = sequelize.define('TradingCalendar', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  trade_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    unique: true,
    comment: '日期',
  },
  is_trading_day: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: '是否交易日',
  },
  market: {
    type: DataTypes.ENUM('SH', 'SZ', 'ALL'),
    defaultValue: 'ALL',
    comment: '市场',
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '年份',
  },
  month: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '月份',
  },
  day_of_week: {
    type: DataTypes.INTEGER,
    comment: '星期几(0=周日,6=周六)',
  },
  holiday_name: {
    type: DataTypes.STRING(50),
    comment: '节假日名称(如有)',
  },
}, {
  tableName: 'trading_calendar',
  indexes: [
    { fields: ['trade_date'] },
    { fields: ['year', 'month'] },
    { fields: ['is_trading_day'] },
  ],
});

module.exports = TradingCalendar;
