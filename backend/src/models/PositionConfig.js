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
  total_capital: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    comment: '总资金',
  },
  step_configs: {
    type: DataTypes.JSON,
    allowNull: false,
    comment: '每层配置JSON',
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
    steps: [
      { step: 1, ratio: 0.20, trigger: '首次买入' },
      { step: 2, ratio: 0.20, trigger: '跌10%' },
      { step: 3, ratio: 0.20, trigger: '跌20%' },
      { step: 4, ratio: 0.20, trigger: '跌30%' },
      { step: 5, ratio: 0.20, trigger: '跌40%' },
    ],
  },
  pyramid: {
    name: '金字塔仓位法',
    description: '越涨越买，越买越少，首次50%，加仓30%，再加仓20%，适合趋势确认后的顺势加仓',
    steps: [
      { step: 1, ratio: 0.50, trigger: '首次买入' },
      { step: 2, ratio: 0.30, trigger: '确认上涨' },
      { step: 3, ratio: 0.20, trigger: '继续上涨' },
    ],
  },
  funnel: {
    name: '漏斗形仓位法',
    description: '越跌越加，首次10%，加仓15%/20%/25%/30%，左侧交易',
    steps: [
      { step: 1, ratio: 0.10, trigger: '首次买入' },
      { step: 2, ratio: 0.15, trigger: '跌10%' },
      { step: 3, ratio: 0.20, trigger: '跌20%' },
      { step: 4, ratio: 0.25, trigger: '跌30%' },
      { step: 5, ratio: 0.30, trigger: '跌40%' },
    ],
  },
};

module.exports = PositionConfig;
