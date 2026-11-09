const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * 每日追资金 —— 候选股打分明细
 * 每只票每个批次一条；人工勾选与备注直接更新本行，总分前端实时算、后端落库
 */
const MoneyChaseCandidate = sequelize.define('MoneyChaseCandidate', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  run_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '所属批次 ID',
  },
  symbol: {
    type: DataTypes.STRING(10),
    allowNull: false,
    comment: '股票代码（6 位）',
  },
  name: {
    type: DataTypes.STRING(40),
    defaultValue: '',
    comment: '股票名称',
  },
  sector: {
    type: DataTypes.STRING(60),
    defaultValue: '',
    comment: '所属板块名',
  },
  pool_type: {
    type: DataTypes.ENUM('A', 'B'),
    allowNull: false,
    comment: 'A=上升趋势票，B=超跌反弹票',
  },
  today_pct: {
    type: DataTypes.DECIMAL(8, 3),
    defaultValue: 0,
    comment: '今日涨幅 %（实时快照，列表排序依据）',
  },
  auto_score: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '自动得分',
  },
  max_auto_score: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '该池自动分满分',
  },
  manual_score: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '人工勾选得分',
  },
  total_score: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '总分 = 自动分 + 人工分',
  },
  score_detail: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '逐项得分明细 [{code,label,met,points,got,detail}]',
  },
  red_lines: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '触发红线 [{code,label,mode,detail}]，空数组=未触发',
  },
  eliminated: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: '是否被红线淘汰',
  },
  elim_source: {
    // MySQL 的 ENUM 取值列表里不能放 NULL，用 allowNull 表示“未淘汰”这一空状态
    type: DataTypes.ENUM('auto', 'manual'),
    allowNull: true,
    defaultValue: null,
    comment: '淘汰来源：auto=脚本自动判定 / manual=页面人工确认 / NULL=未淘汰',
  },
  manual_checks: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '人工复核项 [{code,label,reason,checked}]',
  },
  suggest_hold: {
    type: DataTypes.STRING(200),
    defaultValue: '',
    comment: '建议持仓周期文案',
  },
  weakest_gap: {
    type: DataTypes.STRING(200),
    defaultValue: '',
    comment: '未达标时最主要一条短板（含数值，行尾小字）',
  },
  dow_trend: {
    type: DataTypes.ENUM('UP', 'DOWN', 'SHAKE'),
    defaultValue: null,
    comment: '道氏高低点判定',
  },
  retrace: {
    type: DataTypes.DECIMAL(8, 4),
    defaultValue: null,
    comment: '60 日回撤幅度（小数，0.25 = 25%）',
  },
  fib_info: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '斐波那契价位 {fib382,fib500,fib618,near}',
  },
  indicators: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '指标数值面板 {ma5,ma20,ma30,adx,pdi,mdi,vol_ratio_raw,vol_ratio_est,...}',
  },
  chip: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '筹码近似 {cost_90_upper,pressure_dist_pct,profit_ratio,source}',
  },
  fund_flow: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '资金流 {today_net,ten_day_net,sector_today_net,sector_5d_avg_net}',
  },
  kline: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '画图数据 {dates,bars,ma5,ma20,ma30,volume,dif,dea,macd,marks,overlays}',
  },
  data_as_of: {
    type: DataTypes.DATEONLY,
    defaultValue: null,
    comment: '该票日线最后交易日',
  },
  remark: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '人工备注 {resist,stop_profit,buy_plan,note}',
  },
  picked: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: '人工标记为最终买入候选',
  },
  source: {
    type: DataTypes.ENUM('sector', 'manual_add'),
    defaultValue: 'sector',
    comment: '来源：板块成分 / 人工添加',
  },
}, {
  tableName: 'money_chase_candidates',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['run_id', 'symbol'] },
    { fields: ['symbol'] },
    { fields: ['pool_type'] },
  ],
});

module.exports = MoneyChaseCandidate;
