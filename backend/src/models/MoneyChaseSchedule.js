const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * 每日追资金 —— 定时运行配置（支持多个时间点，页面自由增删改）
 * 由 scheduler.js 用 node-cron 动态注册，配置变更后热更新，不重启后端
 */
const MoneyChaseSchedule = sequelize.define('MoneyChaseSchedule', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  time_hm: {
    type: DataTypes.STRING(5),
    allowNull: false,
    comment: '触发时刻 HH:MM（北京时间）',
  },
  label: {
    type: DataTypes.STRING(60),
    defaultValue: '',
    comment: '备注名称，如「买点窗口前定档」',
  },
  sector_source: {
    type: DataTypes.ENUM('auto_top', 'fixed'),
    defaultValue: 'auto_top',
    comment: 'auto_top=自动取资金流入 TopN；fixed=用 fixed_sectors 指定板块',
  },
  top_n: {
    type: DataTypes.INTEGER,
    defaultValue: 3,
    comment: '自动模式取前 N 个板块',
  },
  fixed_sectors: {
    type: DataTypes.JSON,
    defaultValue: null,
    comment: '固定板块名数组',
  },
  enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: '是否启用',
  },
  trading_day_only: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: '仅交易日执行',
  },
  last_run_at: {
    type: DataTypes.DATE,
    defaultValue: null,
    comment: '上次实际触发时间（UTC）',
  },
  last_run_id: {
    type: DataTypes.INTEGER,
    defaultValue: null,
    comment: '上次生成的批次 ID',
  },
  last_status: {
    type: DataTypes.STRING(20),
    defaultValue: '',
    comment: '上次结果状态',
  },
}, {
  tableName: 'money_chase_schedules',
  timestamps: true,
  indexes: [
    { unique: true, fields: ['time_hm'] },
  ],
});

module.exports = MoneyChaseSchedule;
