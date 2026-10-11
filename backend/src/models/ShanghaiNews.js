const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ShanghaiNews = sequelize.define('ShanghaiNews', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  publish_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: '发布日期',
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false,
    comment: '标题',
  },
  content: {
    type: DataTypes.TEXT,
    comment: '内容摘要',
  },
  mentioned_stocks: {
    type: DataTypes.JSON,
    comment: '提及的股票列表 [{code, name}]',
  },
  url: {
    type: DataTypes.STRING(500),
    comment: '原文链接',
  },
  source: {
    type: DataTypes.STRING(50),
    defaultValue: '上海证券报',
    comment: '来源',
  },
}, {
  tableName: 'shanghai_news',
  indexes: [
    { fields: ['publish_date'] },
  ],
});

module.exports = ShanghaiNews;
