const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const VolumeHistory = sequelize.define('VolumeHistory', {
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
    comment: '股票名称',
  },
  trade_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: '交易日期',
  },
  volume: {
    type: DataTypes.BIGINT,
    allowNull: false,
    comment: '成交量(股)',
  },
  avg_volume_30d: {
    type: DataTypes.BIGINT,
    comment: '30日平均成交量',
  },
  volume_ratio: {
    type: DataTypes.DECIMAL(8, 2),
    comment: '量比',
  },
  turnover: {
    type: DataTypes.BIGINT,
    comment: '成交额(元)',
  },
  is_volume_up: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: '是否放量',
  },
}, {
  tableName: 'volume_history',
  indexes: [
    { fields: ['stock_code', 'trade_date'] },
  ],
});

module.exports = VolumeHistory;
