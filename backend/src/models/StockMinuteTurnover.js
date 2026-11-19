const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// 自选股逐分钟成交量/成交额快照（数据源：新浪分钟K线；volume 为原始成交量(股)，
// 成交金额 ≈ 收盘价 × 成交量 仅作参考留存）
// 采集口径与首页大盘一致：交易日 9:25、9:30-11:30、13:00-15:00 每分钟一条
// 今日/昨日为 1 分钟粒度；更早补录的历史日为 5 分钟粒度（新浪宽窗口备源）
const StockMinuteTurnover = sequelize.define('StockMinuteTurnover', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  stock_code: {
    type: DataTypes.STRING(10),
    allowNull: false,
    unique: 'uq_stock_date_time',
    comment: '股票代码',
  },
  snapshot_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    unique: 'uq_stock_date_time',
    comment: '业务日期（北京时间）',
  },
  snapshot_time: {
    type: DataTypes.STRING(5),
    allowNull: false,
    unique: 'uq_stock_date_time',
    comment: '分钟标签 HH:MM（行情原始时间）',
  },
  minute_amount: {
    type: DataTypes.BIGINT,
    allowNull: true,
    comment: '该分钟成交金额（元，近似），5分钟行为该5分钟合计',
  },
  cum_amount: {
    type: DataTypes.BIGINT,
    allowNull: true,
    comment: '日内累计成交金额（元）',
  },
  minute_volume: {
    type: DataTypes.BIGINT,
    allowNull: true,
    comment: '该分钟成交量（股，行情原始值），5分钟行为合计',
  },
  cum_volume: {
    type: DataTypes.BIGINT,
    allowNull: true,
    comment: '日内累计成交量（股）',
  },
  source: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: '采集来源：cron 定时 / backfill 补录 / page 页面回源',
  },
}, {
  tableName: 'stock_minute_turnovers',
});

module.exports = StockMinuteTurnover;
