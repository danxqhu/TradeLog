const { sequelize } = require('../config/database');

const Stock = require('./Stock');
const Recommendation = require('./Recommendation');
const RecommendationTracking = require('./RecommendationTracking');
const VolumeHistory = require('./VolumeHistory');
const Position = require('./Position');
const PositionConfig = require('./PositionConfig');
const PositionAddRecord = require('./PositionAddRecord');
const ShanghaiNews = require('./ShanghaiNews');
const ResearchReport = require('./ResearchReport');
const TradingCalendar = require('./TradingCalendar');

// 模型关联关系
// Recommendation -> RecommendationTracking (一对多)
Recommendation.hasMany(RecommendationTracking, {
  foreignKey: 'recommendation_id',
  as: 'trackings',
});
RecommendationTracking.belongsTo(Recommendation, {
  foreignKey: 'recommendation_id',
  as: 'recommendation',
});

// Position -> PositionAddRecord (一对多)
Position.hasMany(PositionAddRecord, {
  foreignKey: 'position_id',
  as: 'addRecords',
});
PositionAddRecord.belongsTo(Position, {
  foreignKey: 'position_id',
  as: 'position',
});

// Position -> PositionConfig (一对一，按股票代码关联)
Position.hasMany(PositionConfig, {
  foreignKey: 'stock_code',
  sourceKey: 'stock_code',
  as: 'configs',
});
PositionConfig.belongsTo(Position, {
  foreignKey: 'stock_code',
  targetKey: 'stock_code',
  as: 'position',
});

module.exports = {
  sequelize,
  Stock,
  Recommendation,
  RecommendationTracking,
  VolumeHistory,
  Position,
  PositionConfig,
  PositionAddRecord,
  ShanghaiNews,
  ResearchReport,
  TradingCalendar,
};
