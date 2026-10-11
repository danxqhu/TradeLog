const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Stock = sequelize.define('Stock', {
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
    comment: '股票名称',
  },
  market: {
    type: DataTypes.ENUM('SH', 'SZ', 'BJ'),
    defaultValue: 'SH',
    comment: '市场：上海/深圳/北京',
  },
  current_price: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    comment: '当前价格',
  },
  change_percent: {
    type: DataTypes.DECIMAL(8, 2),
    defaultValue: 0,
    comment: '涨跌幅%',
  },
  volume: {
    type: DataTypes.BIGINT,
    defaultValue: 0,
    comment: '成交量(股)',
  },
  turnover: {
    type: DataTypes.BIGINT,
    defaultValue: 0,
    comment: '成交额(元)',
  },
}, {
  tableName: 'stocks',
});

module.exports = Stock;
