const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * 胡胖胖招财进宝 —— 判定项表（加权评分框架的最小单元）
 *
 * 真源关系：backend/config/fortune_criteria.json →（启动播种）→ 本表
 *   页面人工改过的行 is_custom=true，播种不覆盖；权重/子项/开关都以本表为准。
 * 一个判定项 = 一类判据（主观判断 / 道氏 / 葛兰碧 / 未来新增的理论）。
 *   weight 是该项在总分里的权重百分比（所有启用项权重之和应为 100）。
 *   items 是结构化子清单（每条 {id,label,points,...}），基础版全部人工勾选。
 */
const FortuneCriterion = sequelize.define('FortuneCriterion', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  code: {
    type: DataTypes.STRING(40),
    allowNull: false,
    unique: true,
    comment: '判定项编码：manual / dow / granville / …（后续新理论自定义）',
  },
  name: { type: DataTypes.STRING(80), allowNull: false, comment: '判定项名称（页面展示）' },
  type: {
    type: DataTypes.ENUM('manual', 'auto', 'semi', 'sell_auto', 'reversal_auto'),
    defaultValue: 'manual',
    comment: 'manual=纯主观录入；auto=可自动判定（当前仍人工）；semi=机器预警+人工确认；sell_auto=衰竭止盈 W 组（机器判定，不参与买入加权）；reversal_auto=超跌反转 B 组（机器判定，独立成分，不参与买入/衰竭加权）',
  },
  weight: {
    type: DataTypes.DECIMAL(6, 2),
    defaultValue: 0,
    comment: '该项权重百分比（0-100），所有启用项之和应为 100',
  },
  enabled: { type: DataTypes.BOOLEAN, defaultValue: true, comment: '是否参与总分计算' },
  items: { type: DataTypes.JSON, defaultValue: [], comment: '子判定项清单 [{id,label,points,semantic?,formula?,desc?}]' },
  description: { type: DataTypes.TEXT, defaultValue: null, comment: '判定项说明全文' },
  sort_order: { type: DataTypes.INTEGER, defaultValue: 0, comment: '页面展示顺序' },
  source_version: { type: DataTypes.STRING(20), defaultValue: '', comment: '来源配置文件版本' },
  is_custom: { type: DataTypes.BOOLEAN, defaultValue: false, comment: '是否被人工修改过（true 时播种不覆盖）' },
}, {
  tableName: 'fortune_criteria',
  timestamps: true,
});

module.exports = FortuneCriterion;
