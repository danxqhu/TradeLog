const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const PositionConfig = sequelize.define('PositionConfig', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  stock_code: {
    type: DataTypes.STRING(10),
    allowNull: false,
    comment: '股票代码',
  },
  strategy_type: {
    type: DataTypes.ENUM('rectangle', 'pyramid', 'funnel'),
    allowNull: false,
    comment: '策略类型：矩形/金字塔/漏斗形',
  },
  strategy_direction: {
    type: DataTypes.ENUM('drop', 'rise'),
    allowNull: false,
    defaultValue: 'drop',
    comment: '策略方向：下跌加仓/上涨加仓',
  },
  base_price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: '基准价格（自定义，跌幅/涨幅计算的起点）',
  },
  total_capital: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: '总资金',
  },
  capital_source: {
    type: DataTypes.ENUM('manual', 'first_buy'),
    allowNull: false,
    defaultValue: 'first_buy',
    comment: '总资金来源：manual手动输入 / first_buy首次买入金额',
  },
  step_configs: {
    type: DataTypes.JSON,
    allowNull: false,
    comment: '每层配置JSON',
  },
  alert_threshold_min: {
    type: DataTypes.INTEGER,
    defaultValue: 80,
    comment: '接近提醒阈值下限(%)，默认80',
  },
  alert_threshold_max: {
    type: DataTypes.INTEGER,
    defaultValue: 90,
    comment: '接近提醒阈值上限(%)，默认90',
  },
  last_alert_step: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: '上次提醒的步骤编号（防重复）',
  },
  last_alert_type: {
    type: DataTypes.STRING(20),
    defaultValue: '',
    comment: '上次提醒类型：approach/trigger（防重复）',
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: '是否启用',
  },
  email_notification: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: '是否邮件通知',
  },
}, {
  tableName: 'position_configs',
});

// 策略常量定义
PositionConfig.STRATEGIES = {
  rectangle: {
    name: '矩形仓位法',
    description: '资金分成5份，每次加20%，适合无法判断涨跌时等额分批分摊风险',
    direction: 'drop',
    steps: [
      { step: 1, ratio: 0.20, trigger: '首次买入', threshold: 0 },
      { step: 2, ratio: 0.20, trigger: '跌10%', threshold: 10 },
      { step: 3, ratio: 0.20, trigger: '跌20%', threshold: 20 },
      { step: 4, ratio: 0.20, trigger: '跌30%', threshold: 30 },
      { step: 5, ratio: 0.20, trigger: '跌40%', threshold: 40 },
    ],
  },
  pyramid: {
    name: '金字塔仓位法',
    description: '越涨越买，越买越少，首次50%，加仓30%，再加仓20%，适合趋势确认后的顺势加仓',
    direction: 'rise',
    steps: [
      { step: 1, ratio: 0.50, trigger: '首次买入', threshold: 0 },
      { step: 2, ratio: 0.30, trigger: '涨10%', threshold: 10 },
      { step: 3, ratio: 0.20, trigger: '涨20%', threshold: 20 },
    ],
  },
  funnel: {
    name: '漏斗形仓位法',
    description: '越跌越加，首次10%，加仓15%/20%/25%/30%，左侧交易',
    direction: 'drop',
    steps: [
      { step: 1, ratio: 0.10, trigger: '首次买入', threshold: 0 },
      { step: 2, ratio: 0.15, trigger: '跌10%', threshold: 10 },
      { step: 3, ratio: 0.20, trigger: '跌20%', threshold: 20 },
      { step: 4, ratio: 0.25, trigger: '跌30%', threshold: 30 },
      { step: 5, ratio: 0.30, trigger: '跌40%', threshold: 40 },
    ],
  },
};

module.exports = PositionConfig;
