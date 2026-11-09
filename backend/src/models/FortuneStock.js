const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * 胡胖胖招财进宝 —— 我的股票池
 *
 * 接口拿不到的信息（如今日主力净流入、板块热点标签）允许人工填写，存 info(JSON)。
 * 一只票一条记录（重复添加就地更新），评估记录用 symbol 关联。
 */
const FortuneStock = sequelize.define('FortuneStock', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  symbol: { type: DataTypes.STRING(10), allowNull: false, unique: true, comment: '6 位股票代码' },
  name: { type: DataTypes.STRING(60), defaultValue: '', comment: '股票名称' },
  sector: { type: DataTypes.STRING(60), defaultValue: '', comment: '板块/题材标签' },
  info: { type: DataTypes.JSON, defaultValue: null, comment: '人工补充信息（资金流入/热点/市值/备注等自由字段）' },
  note: { type: DataTypes.TEXT, defaultValue: null, comment: '备注' },
  sort_order: { type: DataTypes.INTEGER, defaultValue: 0, comment: '排序（预留）' },
}, {
  tableName: 'fortune_stocks',
  timestamps: true,
});

module.exports = FortuneStock;
