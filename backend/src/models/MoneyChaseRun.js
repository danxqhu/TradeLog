const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * 每日追资金 —— 一次筛选批次
 * 一次运行（手动触发或定时触发）对应一条记录，候选股结果挂在 candidates 表
 */
const MoneyChaseRun = sequelize.define('MoneyChaseRun', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  trade_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: '业务交易日（北京时间）',
  },
  run_time: {
    type: DataTypes.STRING(5),
    defaultValue: '',
    comment: '运行时刻 HH:MM（北京时间）',
  },
  triggered_by: {
    type: DataTypes.ENUM('manual', 'cron'),
    defaultValue: 'manual',
    comment: '触发方式',
  },
  schedule_id: {
    type: DataTypes.INTEGER,
    defaultValue: null,
    comment: '定时配置 ID（手动触发为 null）',
  },
  sectors: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '本次采用的板块 [{name, net_inflow_yi, pct_change}]',
  },
  sector_source: {
    type: DataTypes.ENUM('auto_top', 'fixed', 'manual_input'),
    defaultValue: 'auto_top',
    comment: '板块来源：自动TopN / 固定清单 / 人工输入',
  },
  status: {
    type: DataTypes.ENUM('pending', 'running', 'completed', 'partial', 'failed'),
    defaultValue: 'pending',
    comment: '批次状态',
  },
  stage: {
    type: DataTypes.STRING(120),
    defaultValue: '',
    comment: '当前阶段文案（供前端进度显示）',
  },
  progress: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '进度百分比 0-100',
  },
  candidate_total: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '进入打分的候选股数量',
  },
  success_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '打分成功数',
  },
  fail_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '接口失败跳过数',
  },
  skip_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '条件不满足跳过数（次新股等）',
  },
  eliminated_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '触发红线淘汰数',
  },
  data_as_of: {
    type: DataTypes.DATEONLY,
    defaultValue: null,
    comment: '日线最后完成交易日（数据新鲜度）',
  },
  intraday: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: '本次是否含盘中实时合成 bar',
  },
  elapsed_trading_min: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '运行时已交易分钟数',
  },
  vol_scale: {
    type: DataTypes.DECIMAL(6, 4),
    defaultValue: 1,
    comment: '量能折算系数（已交易分钟/240）',
  },
  params_snapshot: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '本次生效参数快照（保证历史批次可复现）',
  },
  skip_list: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '跳过明细 [{symbol, name, reason}]',
  },
  error_msg: {
    type: DataTypes.TEXT,
    defaultValue: null,
    comment: '失败原因（中文，前端弹窗展示）',
  },
  error_detail: {
    type: DataTypes.TEXT,
    defaultValue: null,
    comment: '接口原始异常文本（截断，供排查）',
  },
}, {
  tableName: 'money_chase_runs',
  timestamps: true,
  indexes: [
    { fields: ['trade_date'] },
    { fields: ['status'] },
  ],
});

module.exports = MoneyChaseRun;
