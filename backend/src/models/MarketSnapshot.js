const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const MarketSnapshot = sequelize.define('MarketSnapshot', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  snapshot_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: '快照日期',
  },
  snapshot_time: {
    type: DataTypes.STRING(10),
    allowNull: false,
    comment: '快照时间 HH:MM',
  },
  sh_turnover: {
    type: DataTypes.BIGINT,
    defaultValue: 0,
    comment: '沪市成交额（元）',
  },
  sz_turnover: {
    type: DataTypes.BIGINT,
    defaultValue: 0,
    comment: '深市成交额（元）',
  },
  bj_turnover: {
    type: DataTypes.BIGINT,
    defaultValue: 0,
    comment: '北交所成交额（元）',
  },
  total_turnover: {
    type: DataTypes.BIGINT,
    defaultValue: 0,
    comment: 'A股全市场成交额（元）',
  },
  sh_index: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    comment: '上证指数点位',
  },
  sz_index: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    comment: '深证成指点位',
  },
  bj_index: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    comment: '北证50点位',
  },
  collected_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: '行情原始时间戳（UTC）—— 数据源返回的真实时间，非机器时间',
  },
}, {
  tableName: 'market_snapshots',
  timestamps: true,
  indexes: [
    { fields: ['snapshot_date'] },
    { unique: true, fields: ['snapshot_date', 'snapshot_time'] },
  ],
});

module.exports = MarketSnapshot;
