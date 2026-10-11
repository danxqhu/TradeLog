const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const RecommendationTracking = sequelize.define('RecommendationTracking', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  recommendation_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: '关联推荐ID',
  },
  period_type: {
    type: DataTypes.ENUM('3d', '7d', '2w', '1m', 'custom'),
    allowNull: false,
    comment: '周期类型：3天/7天/2周/1月/自定义',
  },
  custom_days: {
    type: DataTypes.INTEGER,
    comment: '自定义天数（仅period_type=custom时有效）',
  },
  check_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: '查看日期',
  },
  check_price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: '查看时价格',
  },
  return_rate: {
    type: DataTypes.DECIMAL(8, 2),
    allowNull: false,
    comment: '收益率%',
  },
  trading_days_count: {
    type: DataTypes.INTEGER,
    comment: '经过的交易日数',
  },
}, {
  tableName: 'recommendation_tracking',
});

module.exports = RecommendationTracking;
