const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * 交易所官方每日A股成交额
 * 数据来源：上交所 + 深交所 + 北交所 官网
 * 仅统计A股：主板A + 科创板(SSE) + 主板A股 + 创业板A股(SZSE) + 北交所(BSE)
 * 剔除B股、基金、债券等非A股产品
 */
const ExchangeDaily = sequelize.define('ExchangeDaily', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  trade_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    unique: true,
    comment: '交易日期',
  },
  // 上交所（亿元）
  sse_main_a: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: null,
    comment: '上交所-主板A（亿元）',
  },
  sse_star: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: null,
    comment: '上交所-科创板（亿元）',
  },
  sse_total: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: null,
    comment: '上交所A股合计 = 主板A + 科创板（亿元）',
  },
  // 深交所（亿元）
  szse_main_a: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: null,
    comment: '深交所-主板A股（亿元）',
  },
  szse_gem: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: null,
    comment: '深交所-创业板A股（亿元）',
  },
  szse_total: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: null,
    comment: '深交所A股合计 = 主板A股 + 创业板A股（亿元）',
  },
  // 北交所（亿元）
  bse_total: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: null,
    comment: '北交所成交额（亿元）',
  },
  // 全A合计
  total_amount: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: null,
    comment: '全A成交额合计 = 上交所 + 深交所 + 北交所（亿元）',
  },
  // 滚动均线
  ma20: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: null,
    comment: '20日滚动均量（亿元）',
  },
  ma60: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: null,
    comment: '60日滚动均量（亿元）',
  },
  data_complete: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: '数据完整性：true=沪深两所均成功，false=部分数据源失败',
  },
}, {
  tableName: 'exchange_dailies',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['trade_date'] },
  ],
});

module.exports = ExchangeDaily;
