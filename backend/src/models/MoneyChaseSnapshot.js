const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * 每日追资金 —— 定格快照（录入基准评估，只读存档）
 *
 * 与 money_chase_candidates 的分工：
 *   candidates / 分析页「当前最新评估」= 实时口径，永远用最新 K 线重算，会被后续走势推翻；
 *   本表 = 定格口径，按选定时间点（盘中时刻或当日收盘）截断历史 K 线跑一遍判定后固化，
 *          之后新增 K 线不会改动它，用来回答「当初为什么看上它」。
 * 同一只票同一时间点只留一份（symbol + snapshot_date + snapshot_time 唯一），但重生成默认不自动覆盖，
 * 需上层拿到人工确认（writeSnapshot 的 overwrite）才改写；盘中一份、收盘一份、后续手动生成的全部并存，
 * 基准（is_baseline）每只票只有一条且由人工自由切换，新生成的一份不会静默挤掉录入基准。
 */
const MoneyChaseSnapshot = sequelize.define('MoneyChaseSnapshot', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
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
    defaultValue: '人工自选',
    comment: '快照时的板块归属',
  },
  snapshot_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: '快照定格到哪个交易日',
  },
  snapshot_time: {
    type: DataTypes.STRING(5),
    defaultValue: '',
    comment: '盘中时刻 HH:MM；空串=当日收盘定型口径',
  },
  kind: {
    type: DataTypes.ENUM('intraday', 'close'),
    allowNull: false,
    comment: 'intraday=盘中临时 K（指标存在变动风险）/ close=收盘定型 K（可复盘回测）',
  },
  actual_time: {
    type: DataTypes.STRING(5),
    defaultValue: '',
    comment: '分时实际截断到的时刻（5 分钟精度时可能早于选定时刻）',
  },
  minute_scale: {
    type: DataTypes.INTEGER,
    defaultValue: null,
    comment: '盘中快照的分时精度（分钟：1 或 5）',
  },
  pool_type: {
    type: DataTypes.ENUM('A', 'B'),
    defaultValue: null,
    comment: '快照时点的 A/B 归类',
  },
  dow_trend: {
    type: DataTypes.ENUM('UP', 'DOWN', 'SHAKE'),
    defaultValue: null,
    comment: '快照时点的道氏判定',
  },
  today_pct: {
    type: DataTypes.DECIMAL(8, 3),
    defaultValue: 0,
    comment: '快照时点的当日涨幅 %',
  },
  auto_score: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '快照时点自动得分',
  },
  max_auto_score: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '快照时点自动分满分（随启用项个数变化）',
  },
  manual_score: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '固化当时的人工勾选分',
  },
  total_score: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '快照时点总分',
  },
  eliminated: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: '快照时点是否被红线淘汰',
  },
  elim_source: {
    // MySQL 的 ENUM 取值列表里不能放 NULL，用 allowNull 表示“未淘汰”这一空状态
    type: DataTypes.ENUM('auto', 'manual'),
    allowNull: true,
    defaultValue: null,
    comment: '淘汰来源：auto=脚本判定 / manual=当时人工确认 / NULL=未淘汰',
  },
  score_detail: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '快照时点逐项打分 [{code,label,met,detail}]',
  },
  red_lines: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '快照时点触发的红线 [{code,label,mode,detail}]',
  },
  manual_checks: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '固化当时的人工复核勾选 [{code,label,checked}]（只读，不随后续改动）',
  },
  remark: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '固化当时的人工备注 {resist,stop_profit,buy_plan,note}',
  },
  human_from: {
    type: DataTypes.STRING(40),
    defaultValue: '',
    comment: '人工态来源说明（candidate#id / 录入当下 / 无人工态）',
  },
  weakest_gap: {
    type: DataTypes.STRING(200),
    defaultValue: '',
    comment: '快照时点最主要一条短板（含数值）',
  },
  suggest_hold: {
    type: DataTypes.STRING(200),
    defaultValue: '',
    comment: '快照时点的建议持仓周期',
  },
  retrace: {
    type: DataTypes.DECIMAL(8, 4),
    defaultValue: null,
    comment: '快照时点 60 日回撤（小数）',
  },
  indicators: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '快照时点指标数值面板（含 warnings）',
  },
  fib_info: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '快照时点斐波那契价位',
  },
  chip: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '快照时点筹码近似（默认不请求，故常为空）',
  },
  fund_flow: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '快照时点板块资金（盘中/历史快照按数据缺失计）',
  },
  kline: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '快照口径的日 K 画图数据（截断到快照时点）',
  },
  minutes: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '盘中快照的分时点（截至选定时刻，收盘口径为空）',
  },
  data_as_of: {
    type: DataTypes.DATEONLY,
    defaultValue: null,
    comment: '该次日线最后完整交易日',
  },
  meta: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '脚本 meta（intraday/vol_scale/elapsed_trading_min/data_source/warnings/snapshot）',
  },
  source: {
    type: DataTypes.ENUM('auto_enter', 'manual', 'auto_close'),
    defaultValue: 'manual',
    comment: 'auto_enter=录入时顺带固化（0 额外请求）/ manual=页面按时间点生成 / auto_close=收盘补档',
  },
  is_baseline: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: '是否当前基准快照（每只票最多一条，页面默认展示这条）',
  },
  from_candidate_id: {
    type: DataTypes.INTEGER,
    defaultValue: null,
    comment: '由哪条打分记录固化（可空）',
  },
}, {
  tableName: 'money_chase_snapshots',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['symbol', 'snapshot_date', 'snapshot_time'] },
    { fields: ['symbol'] },
    { fields: ['is_baseline'] },
  ],
});

module.exports = MoneyChaseSnapshot;
