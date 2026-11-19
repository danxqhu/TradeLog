const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// 自选股列表（从全量 A 股库 stocks 表挑选，添加时回填名称与市场）
const WatchlistStock = sequelize.define('WatchlistStock', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  code: {
    type: DataTypes.STRING(10),
    allowNull: false,
    unique: true,
    comment: '股票代码',
  },
  name: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '股票名称（简称）',
  },
  market: {
    type: DataTypes.ENUM('SH', 'SZ', 'BJ'),
    defaultValue: 'SH',
    comment: '市场：上海/深圳/北京',
  },
}, {
  tableName: 'watchlist_stocks',
});

module.exports = WatchlistStock;
