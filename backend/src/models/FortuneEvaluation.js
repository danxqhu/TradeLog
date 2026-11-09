const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * 胡胖胖招财进宝 —— 评估记录（每只票每个评估日一行，可复盘对比）
 *
 * criterion_scores: { [判定项code]: { score:0-100, checked:[子项id], veto:bool, auto:bool } }
 * weighted_total:   Σ(score × weight%) —— 落库时按当时权重算，并存 criteria_snapshot 便于回溯口径。
 * band_code/label:  按分档自动归类（放弃/观察/建议/买入/买买买）。
 * eval_date:        评估对应的那根 K 线日期（手动选过去日期复盘时就填当时点，方便对比当初判断）。
 */
const FortuneEvaluation = sequelize.define('FortuneEvaluation', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  symbol: { type: DataTypes.STRING(10), allowNull: false, comment: '股票代码' },
  name: { type: DataTypes.STRING(60), defaultValue: '', comment: '股票名称' },
  sector: { type: DataTypes.STRING(60), defaultValue: '', comment: '板块/题材' },
  eval_date: { type: DataTypes.DATEONLY, allowNull: false, comment: '评估对应日期（复盘时可选历史日）' },
  criterion_scores: { type: DataTypes.JSON, defaultValue: null, comment: '各判定项得分与勾选明细' },
  weighted_total: { type: DataTypes.DECIMAL(6, 2), defaultValue: 0, comment: '加权总分 0-100' },
  band_code: { type: DataTypes.STRING(20), defaultValue: '', comment: '分档编码' },
  band_label: { type: DataTypes.STRING(20), defaultValue: '', comment: '分档名称' },
  buy_point: { type: DataTypes.STRING(120), defaultValue: '', comment: '买入时机（人工，如回踩 MA20 / 放量突破）' },
  sell_plan: { type: DataTypes.STRING(120), defaultValue: '', comment: '卖出/止损计划（人工）' },
  note: { type: DataTypes.TEXT, defaultValue: null, comment: '复盘备注' },
  criteria_snapshot: { type: DataTypes.JSON, defaultValue: null, comment: '本次用的权重/分档快照（口径可追溯）' },
}, {
  tableName: 'fortune_evaluations',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['symbol', 'eval_date'] },
    { fields: ['eval_date'] },
  ],
});

module.exports = FortuneEvaluation;
