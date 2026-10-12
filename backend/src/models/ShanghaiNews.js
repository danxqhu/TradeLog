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
  section: {
    type: DataTypes.STRING(50),
    comment: '版面（如 A1：基金周刊）',
  },
  title: {
    type: DataTypes.STRING(200),
    allowNull: false,
    comment: '标题',
  },
  content: {
    type: DataTypes.STRING(300),
    comment: '内容摘要（限300字，节省存储）',
  },
  url: {
    type: DataTypes.STRING(500),
    comment: '原文链接',
  },
  mentioned_stocks: {
    type: DataTypes.JSON,
    comment: '提及的股票列表 [{code, name}]',
  },
  source: {
    type: DataTypes.STRING(50),
    defaultValue: '上海证券报',
    comment: '来源',
  },
  sort_order: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '版面内文章顺序（报纸从上到下的原始位置）',
  },
}, {
  tableName: 'shanghai_news',
  indexes: [
    { fields: ['publish_date'] },
    { unique: true, fields: ['publish_date', 'title'] },  // 同一天同一标题不重复
  ],
});

module.exports = ShanghaiNews;
