const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * 每日追资金 —— 规则与参数表（页面全文展示 + 可编辑的唯一运行时来源）
 *
 * 真源关系：
 *   backend/config/money_chase_rules.json  →（启动播种）→  本表
 *   页面上人工改过的行 is_custom = true，播种时不再被文件覆盖；
 *   Python 脚本不读文件也不读表，只读后端下发的「生效参数」（本表 value 拍平）。
 */
const MoneyChaseRule = sequelize.define('MoneyChaseRule', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  key: {
    type: DataTypes.STRING(80),
    allowNull: false,
    unique: true,
    comment: '唯一键：param:top_sectors / score:A_S1 / redline:A_R1 / manual:A_M1 / pool:A / overlay:ma / text:xxx',
  },
  category: {
    type: DataTypes.ENUM('param', 'score', 'redline', 'manual', 'pool', 'overlay', 'text'),
    allowNull: false,
    comment: '规则类别',
  },
  code: {
    // 长度要容得下最长的参数名（如 chip_pressure_dist_min_pct），否则播种会被 MySQL 判 Data too long
    type: DataTypes.STRING(60),
    defaultValue: null,
    comment: '规则编号（A_R1 / B_S3 等），param 类为参数名',
  },
  pool: {
    type: DataTypes.ENUM('A', 'B', 'AB'),
    defaultValue: null,
    comment: '适用池子',
  },
  label: {
    type: DataTypes.STRING(200),
    defaultValue: '',
    comment: '规则名称（页面展示原文）',
  },
  value: {
    type: DataTypes.TEXT,
    defaultValue: null,
    comment: '当前生效值（param 类为数字/布尔/字符串；其他类可为空）',
  },
  default_value: {
    type: DataTypes.TEXT,
    defaultValue: null,
    comment: '配置文件里的出厂默认值',
  },
  unit: {
    type: DataTypes.STRING(20),
    defaultValue: '',
    comment: '单位（%、日、倍、个…）',
  },
  group_name: {
    type: DataTypes.STRING(40),
    defaultValue: '',
    comment: '参数分组（板块与选股 / 趋势结构参数 / 均线体系 …）',
  },
  description: {
    type: DataTypes.TEXT,
    defaultValue: null,
    comment: '规则说明全文（页面「规则总表」直接渲染此字段）',
  },
  payload: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '结构化原文（formula/explain/detect/param_keys/reason/options 等）',
  },
  mode: {
    type: DataTypes.ENUM('auto', 'semi', 'manual'),
    defaultValue: null,
    comment: '判定方式：auto=脚本全自动，semi=脚本预警+人工确认，manual=纯人工',
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: '是否参与判定',
  },
  points: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '分值（打分项 / 人工勾选项）',
  },
  is_custom: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: '是否被人工修改过（true 时播种不覆盖）',
  },
  sort_order: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '页面展示顺序',
  },
  source_version: {
    type: DataTypes.STRING(20),
    defaultValue: '',
    comment: '来源配置文件版本',
  },
}, {
  tableName: 'money_chase_rules',
  timestamps: true,
  indexes: [
    { fields: ['category'] },
    { fields: ['pool'] },
  ],
});

module.exports = MoneyChaseRule;
