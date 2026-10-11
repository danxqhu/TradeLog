const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Position = sequelize.define('Position', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  stock_code: {
    type: DataTypes.STRING(10),
    allowNull: false,
    comment: '股票代码',
  },
  stock_name: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '股票名称',
  },
  buy_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: '买入日期',
  },
  buy_price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: '买入价格',
  },
  quantity: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '买入数量(股)',
  },
  current_price: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    comment: '当前价格',
  },
  total_cost: {
    type: DataTypes.DECIMAL(12, 2),
    comment: '总成本',
  },
  avg_cost: {
    type: DataTypes.DECIMAL(10, 2),
    comment: '平均成本',
  },
  profit_loss: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    comment: '盈亏金额',
  },
  profit_loss_percent: {
    type: DataTypes.DECIMAL(8, 2),
    defaultValue: 0,
    comment: '盈亏比例%',
  },
  status: {
    type: DataTypes.ENUM('holding', 'closed'),
    defaultValue: 'holding',
    comment: '状态：持有/已清',
  },
  close_date: {
    type: DataTypes.DATEONLY,
    comment: '清仓日期',
  },
}, {
  tableName: 'positions',
  indexes: [
    { fields: ['stock_code'] },
  ],
});

module.exports = Position;
