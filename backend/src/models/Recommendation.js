const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Recommendation = sequelize.define('Recommendation', {
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
  stock_name: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: '股票名称',
  },
  type: {
    type: DataTypes.ENUM('morning', 'afternoon'),
    allowNull: false,
    comment: '推荐类型：早盘/午盘',
  },
  source: {
    type: DataTypes.STRING(50),
    defaultValue: '李享财经',
    comment: '来源机构',
  },
  recommend_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: '推荐日期',
  },
  recommend_time: {
    type: DataTypes.TIME,
    allowNull: false,
    comment: '推荐时间(精确到分钟)',
  },
  recommend_price: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    comment: '推荐时价格',
  },
  current_price: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    comment: '当前价格',
  },
  notes: {
    type: DataTypes.TEXT,
    comment: '备注',
  },
}, {
  tableName: 'recommendations',
});

module.exports = Recommendation;
