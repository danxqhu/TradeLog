const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const MarketAverage = sequelize.define('MarketAverage', {
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
  sse_amount: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: null,
    comment: '沪市A股成交额（亿元）',
  },
  szse_amount: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: null,
    comment: '深市A股成交额（亿元）',
  },
  bse_amount: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: null,
    comment: '北交所成交额（亿元）',
  },
  amount_yi: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: '全A成交额（亿元）= SSE + SZSE + BSE',
  },
  data_complete: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: '数据是否完整（三个交易所都有数据）',
  },
  ma20: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: null,
    comment: '20日滚动均量（亿元，仅计算完整数据）',
  },
  ma60: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: null,
    comment: '60日滚动均量（亿元，仅计算完整数据）',
  },
}, {
  tableName: 'market_averages',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['trade_date'] },
  ],
});

module.exports = MarketAverage;
