const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const NewsStock = sequelize.define('NewsStock', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  news_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '新闻 ID',
  },
  stock_code: {
    type: DataTypes.STRING(10),
    allowNull: false,
    comment: '股票代码',
  },
}, {
  tableName: 'news_stock',
  indexes: [
    { unique: true, fields: ['news_id', 'stock_code'] },
  ],
});

module.exports = NewsStock;
