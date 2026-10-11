const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const PositionAddRecord = sequelize.define('PositionAddRecord', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  position_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '关联持仓ID',
  },
  step_number: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '第几次加仓',
  },
  add_price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: '加仓价格',
  },
  add_quantity: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '加仓数量(股)',
  },
  add_amount: {
    type: DataTypes.DECIMAL(12, 2),
    comment: '加仓金额',
  },
  trigger_type: {
    type: DataTypes.STRING(20),
    comment: '触发条件(如：跌10%)',
  },
  drop_percent: {
    type: DataTypes.DECIMAL(8, 2),
    comment: '跌幅百分比',
  },
  add_ratio: {
    type: DataTypes.DECIMAL(8, 2),
    comment: '加仓比例%',
  },
  email_sent: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: '是否已发送邮件通知',
  },
}, {
  tableName: 'position_add_records',
});

module.exports = PositionAddRecord;
