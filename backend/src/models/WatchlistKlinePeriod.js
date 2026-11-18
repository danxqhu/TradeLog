const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// 自选股 K 线周期缓存：按「加入后第 N 个交易日」存储开/高/收三价及各自收益率。
// 目的：把接口查到的 K 线结果落库，同一支票一天最多打一次接口，隔天回看直接读库。
const WatchlistKlinePeriod = sequelize.define('WatchlistKlinePeriod', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  analysis_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '关联自选股记录ID',
  },
  period_days: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '加入后第几个交易日（1/2/3/4 或自定义N）',
  },
  target_date: {
    type: DataTypes.DATEONLY,
    comment: '目标交易日期（未到期也有值）',
  },
  actual_date: {
    type: DataTypes.DATEONLY,
    comment: '实际取到K线的日期（目标日停牌时向前回落）',
  },
  base_price: {
    type: DataTypes.DECIMAL(10, 2),
    comment: '收益率计算基准（加入时价格快照）',
  },
  open_price: {
    type: DataTypes.DECIMAL(10, 2),
    comment: '开盘价',
  },
  high_price: {
    type: DataTypes.DECIMAL(10, 2),
    comment: '盘中最高价',
  },
  close_price: {
    type: DataTypes.DECIMAL(10, 2),
    comment: '收盘价',
  },
  open_return: {
    type: DataTypes.DECIMAL(8, 2),
    comment: '开盘价收益率%',
  },
  high_return: {
    type: DataTypes.DECIMAL(8, 2),
    comment: '盘中最高价收益率%',
  },
  close_return: {
    type: DataTypes.DECIMAL(8, 2),
    comment: '收盘价收益率%',
  },
  status: {
    type: DataTypes.ENUM('ok', 'pending', 'nodata'),
    allowNull: false,
    defaultValue: 'ok',
    comment: 'ok=已到期有数据；pending=未到期；nodata=已到期但K线缺失',
  },
}, {
  tableName: 'watchlist_kline_periods',
  indexes: [
    { unique: true, fields: ['analysis_id', 'period_days'] },
  ],
});

module.exports = WatchlistKlinePeriod;
