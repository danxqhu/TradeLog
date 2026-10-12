const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const ResearchReport = sequelize.define('ResearchReport', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  // 日期字段
  publish_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: '原始报告落款日期',
  },
  media_publish_date: {
    type: DataTypes.DATEONLY,
    comment: '国内媒体刊发日期',
  },
  // 基本信息
  title: {
    type: DataTypes.STRING(500),
    allowNull: false,
    comment: '研报标题',
  },
  summary: {
    type: DataTypes.TEXT,
    comment: '研报摘要/核心观点',
  },
  // 中文翻译
  title_zh: {
    type: DataTypes.STRING(500),
    comment: '标题中文翻译',
  },
  summary_zh: {
    type: DataTypes.TEXT,
    comment: '摘要中文翻译',
  },
  url: {
    type: DataTypes.STRING(1000),
    comment: '来源链接',
  },
  source: {
    type: DataTypes.STRING(50),
    defaultValue: '高盛',
    comment: '来源机构',
  },
  source_site: {
    type: DataTypes.STRING(50),
    comment: '抓取来源站点（证券时报/上证报/第一财经/每经/高盛官网）',
  },
  // 分析师 & 分类
  analyst: {
    type: DataTypes.STRING(200),
    comment: '分析师（如：刘劲津 Kinger Lau, 付思 Si Fu）',
  },
  label: {
    type: DataTypes.STRING(30),
    comment: '分类标签: core/core_theme/apac_view/macro_view/gsam_view/interview/ignore',
  },
  report_type: {
    type: DataTypes.STRING(50),
    comment: '报告类型: 年度旗舰/中期更新/策略笔记/专访观点/主题策略',
  },
  // 市场观点
  rating: {
    type: DataTypes.STRING(20),
    comment: '仓位评级: 超配/标配/低配',
  },
  category: {
    type: DataTypes.STRING(50),
    comment: '主题分类（中国经济/全球股市/AI科技/美股等）',
  },
  msci_china_target: {
    type: DataTypes.STRING(50),
    comment: 'MSCI中国目标价',
  },
  csi300_target: {
    type: DataTypes.STRING(50),
    comment: '沪深300目标价',
  },
  // 辅助字段
  confidence: {
    type: DataTypes.FLOAT,
    comment: '分类置信度 (0-1)',
  },
  classify_reason: {
    type: DataTypes.STRING(500),
    comment: '分类原因说明',
  },
}, {
  tableName: 'research_reports',
  indexes: [
    { fields: ['publish_date'] },
    { fields: ['source'] },
    { fields: ['label'] },
    { fields: ['analyst'] },
    { unique: true, fields: ['publish_date', 'title'] },
  ],
});

module.exports = ResearchReport;
