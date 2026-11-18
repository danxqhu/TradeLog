const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// 自选股分析记录（结构复制自 Recommendation，供「自选股分析」板块独立使用）
const WatchlistAnalysis = sequelize.define('WatchlistAnalysis', {
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
  reasons: {
    type: DataTypes.TEXT,
    comment: '推荐理由(JSON数组)',
    get() {
      const raw = this.getDataValue('reasons');
      if (!raw) return [];
      try { return JSON.parse(raw); } catch { return []; }
    },
    set(val) {
      if (Array.isArray(val)) {
        this.setDataValue('reasons', JSON.stringify(val.filter(r => r && r.trim())));
      } else {
        this.setDataValue('reasons', null);
      }
    },
  },
  // ===== K 线汇总缓存列（自选股详情页：加入后区间内极值 + 最近刷新日，避免重复打接口） =====
  best_close_date: {
    type: DataTypes.DATEONLY,
    comment: '区间最高收盘价对应日期',
  },
  best_close_price: {
    type: DataTypes.DECIMAL(10, 2),
    comment: '区间最高收盘价',
  },
  best_close_return: {
    type: DataTypes.DECIMAL(8, 2),
    comment: '最高收盘价收益率%',
  },
  best_high_date: {
    type: DataTypes.DATEONLY,
    comment: '区间盘中最高价对应日期',
  },
  best_high_price: {
    type: DataTypes.DECIMAL(10, 2),
    comment: '区间盘中最高价',
  },
  best_high_return: {
    type: DataTypes.DECIMAL(8, 2),
    comment: '盘中最高价收益率%',
  },
  kline_refreshed_date: {
    type: DataTypes.DATEONLY,
    comment: 'K线数据最近一次刷新日（中国时区），同天不重复拉接口',
  },
  sector: {
    type: DataTypes.STRING(60),
    defaultValue: '',
    comment: '板块/行业（人工填写，留空时按追资金候选→评估记录→股票池回填）',
  },
}, {
  tableName: 'watchlist_analysis',
});

module.exports = WatchlistAnalysis;
