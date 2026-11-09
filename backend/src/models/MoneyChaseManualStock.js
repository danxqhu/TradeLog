const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * 每日追资金 —— 候选股人工偏好（跨批次继承）
 * AKShare 板块成分与同花顺所见可能不同，这里记录人工加/减的票，下次跑自动带出
 */
const MoneyChaseManualStock = sequelize.define('MoneyChaseManualStock', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  symbol: {
    type: DataTypes.STRING(10),
    allowNull: false,
    comment: '股票代码',
  },
  name: {
    type: DataTypes.STRING(40),
    defaultValue: '',
    comment: '股票名称',
  },
  op_type: {
    type: DataTypes.ENUM('add', 'remove'),
    allowNull: false,
    comment: 'add=人工加入候选，remove=人工从板块成分中剔除',
  },
  sector: {
    type: DataTypes.STRING(60),
    defaultValue: '人工自选',
    comment: '归属板块（人工加入时可指定）',
  },
  note: {
    type: DataTypes.STRING(200),
    defaultValue: '',
    comment: '备注',
  },
}, {
  tableName: 'money_chase_manual_stocks',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['symbol', 'op_type'] },
  ],
});

module.exports = MoneyChaseManualStock;
