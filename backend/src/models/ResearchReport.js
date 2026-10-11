const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ResearchReport = sequelize.define('ResearchReport', {
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
    type: DataTypes.STRING(300),
    allowNull: false,
    comment: '研报标题',
  },
  summary: {
    type: DataTypes.TEXT,
    comment: '研报摘要',
  },
  url: {
    type: DataTypes.STRING(500),
    comment: '研报链接',
  },
  pdf_url: {
    type: DataTypes.STRING(500),
    comment: 'PDF下载链接',
  },
  source: {
    type: DataTypes.STRING(50),
    defaultValue: '高盛',
    comment: '来源机构',
  },
  category: {
    type: DataTypes.STRING(50),
    comment: '分类(如：中国股市)',
  },
  rating: {
    type: DataTypes.STRING(20),
    comment: '评级(如：超配/标配/低配)',
  },
}, {
  tableName: 'research_reports',
  indexes: [
    { fields: ['publish_date'] },
    { fields: ['source'] },
  ],
});

module.exports = ResearchReport;
