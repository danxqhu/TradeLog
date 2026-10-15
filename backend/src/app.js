require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { sequelize } = require('./models');
const { startScheduler } = require('./services/scheduler');
const { authenticateToken } = require('./middleware/auth');
const { SystemConfig } = require('./models');
const pkg = require(path.resolve(__dirname, '../package.json'));

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 认证路由（公开接口，不需要 token）
app.use('/api/auth', require('./routes/auth'));

// 健康检查（公开）
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// 版本信息（公开）
app.get('/api/version', (req, res) => {
  res.json({ version: pkg.version, name: pkg.name });
});

// 其余所有业务路由需要 JWT 认证
app.use(authenticateToken);

// 业务路由
app.use('/api/stocks', require('./routes/stocks'));
app.use('/api/recommendations', require('./routes/recommendations'));
app.use('/api/volume', require('./routes/volume'));
app.use('/api/positions', require('./routes/positions'));
app.use('/api/shanghai-news', require('./routes/shanghaiNews'));
app.use('/api/research-reports', require('./routes/researchReports'));
app.use('/api/calendar', require('./routes/calendar'));
app.use('/api/market', require('./routes/market'));
app.use('/api/email', require('./routes/email'));

// 错误处理
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({
    error: err.message || '服务器内部错误',
  });
});

// 测试数据库连接
async function testConnection() {
  try {
    await sequelize.authenticate();
    console.log('✅ 数据库连接成功');

    // 清理 stocks 表多余的 UNIQUE 索引（Sequelize alter:true 历史累积）
    try {
      const [indexes] = await sequelize.query(
        `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stocks' 
         AND INDEX_NAME != 'PRIMARY' 
         ORDER BY INDEX_NAME`
      );
      // 找出同一列上的重复唯一索引，只保留一个
      const colIndexes = {};
      for (const row of indexes) {
        const [cols] = await sequelize.query(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.STATISTICS 
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stocks' 
           AND INDEX_NAME = ? ORDER BY SEQ_IN_INDEX`,
          { replacements: [row.INDEX_NAME] }
        );
        const key = cols.map(c => c.COLUMN_NAME).join(',');
        if (!colIndexes[key]) colIndexes[key] = [];
        colIndexes[key].push(row.INDEX_NAME);
      }
      for (const cols of Object.keys(colIndexes)) {
        const names = colIndexes[cols];
        if (names.length > 1) {
          // 保留第一个，删除其余重复索引
          for (let i = 1; i < names.length; i++) {
            await sequelize.query(`ALTER TABLE stocks DROP INDEX \`${names[i]}\``);
            console.log(`🗑️  清理重复索引: ${names[i]} (${cols})`);
          }
        }
      }
    } catch (e) {
      // 忽略清理错误（表可能不存在）
    }

    // 同步模型（不使用 alter，避免重复创建索引）
    await sequelize.sync();
    console.log('✅ 数据库模型同步完成');

    // 手动补充 Stock 模型新增的列（sequelize.sync() 不会自动添加新列）
    try {
      const [cols] = await sequelize.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stocks'`
      );
      const colNames = new Set(cols.map(c => c.COLUMN_NAME));
      if (!colNames.has('list_status')) {
        await sequelize.query(`ALTER TABLE stocks ADD COLUMN list_status VARCHAR(20) NOT NULL DEFAULT 'LISTED' COMMENT '上市状态：LISTED/DELISTED'`);
        console.log('✅ stocks 表新增 list_status 列');
      }
      if (!colNames.has('sync_date')) {
        await sequelize.query(`ALTER TABLE stocks ADD COLUMN sync_date DATETIME NULL COMMENT '最近一次同步时间'`);
        console.log('✅ stocks 表新增 sync_date 列');
      }
      if (!colNames.has('delist_date')) {
        await sequelize.query(`ALTER TABLE stocks ADD COLUMN delist_date DATE NULL COMMENT '退市日期'`);
        console.log('✅ stocks 表新增 delist_date 列');
      }
      if (!colNames.has('full_name')) {
        await sequelize.query(`ALTER TABLE stocks ADD COLUMN full_name VARCHAR(255) NULL COMMENT '股票全称'`);
        console.log('✅ stocks 表新增 full_name 列');
      }
    } catch (e) {
      console.error('⚠️ stocks 表新增列失败（可能已存在）:', e.message);
    }

    // 手动补充 shanghai_news 表新增的列
    try {
      const [cols2] = await sequelize.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shanghai_news'`
      );
      const colNames2 = new Set(cols2.map(c => c.COLUMN_NAME));
      if (!colNames2.has('body')) {
        await sequelize.query(`ALTER TABLE shanghai_news ADD COLUMN body TEXT NULL COMMENT '文章全文正文'`);
        console.log('✅ shanghai_news 表新增 body 列');
      }
    } catch (e) {
      console.error('⚠️ shanghai_news 表新增列失败（可能已存在）:', e.message);
    }
    // 手动补充 recommendations 表新增的列
    try {
      const [cols3] = await sequelize.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recommendations'`
      );
      const colNames3 = new Set(cols3.map(c => c.COLUMN_NAME));
      if (!colNames3.has('reasons')) {
        await sequelize.query(`ALTER TABLE recommendations ADD COLUMN reasons TEXT NULL COMMENT '推荐理由(JSON数组)'`);
        console.log('✅ recommendations 表新增 reasons 列');
      }
    } catch (e) {
      console.error('⚠️ recommendations 表新增列失败（可能已存在）:', e.message);
    }

    // 手动补充 position_configs 表新增的列（策略升级）
    try {
      const [cols4] = await sequelize.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'position_configs'`
      );
      const colNames4 = new Set(cols4.map(c => c.COLUMN_NAME));
      const newCols = [
        { name: 'base_price', sql: `ALTER TABLE position_configs ADD COLUMN base_price DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '基准价格（自定义，跌幅/涨幅计算的起点）'` },
        { name: 'capital_source', sql: `ALTER TABLE position_configs ADD COLUMN capital_source ENUM('manual','first_buy') NOT NULL DEFAULT 'first_buy' COMMENT '总资金来源'` },
        { name: 'strategy_direction', sql: `ALTER TABLE position_configs ADD COLUMN strategy_direction ENUM('drop','rise') NOT NULL DEFAULT 'drop' COMMENT '策略方向'` },
        { name: 'alert_threshold_min', sql: `ALTER TABLE position_configs ADD COLUMN alert_threshold_min INT DEFAULT 80 COMMENT '接近提醒阈值下限(%)'` },
        { name: 'alert_threshold_max', sql: `ALTER TABLE position_configs ADD COLUMN alert_threshold_max INT DEFAULT 90 COMMENT '接近提醒阈值上限(%)'` },
        { name: 'last_alert_step', sql: `ALTER TABLE position_configs ADD COLUMN last_alert_step INT DEFAULT 0 COMMENT '上次提醒步骤号'` },
        { name: 'last_alert_type', sql: `ALTER TABLE position_configs ADD COLUMN last_alert_type VARCHAR(20) DEFAULT '' COMMENT '上次提醒类型'` },
      ];
      for (const col of newCols) {
        if (!colNames4.has(col.name)) {
          await sequelize.query(col.sql);
          console.log(`✅ position_configs 表新增 ${col.name} 列`);
        }
      }
    } catch (e) {
      console.error('⚠️ position_configs 表新增列失败（可能已存在）:', e.message);
    }

    // 初始化系统配置（注册开关，首次部署默认开放）
    try {
      const [regConfig] = await SystemConfig.findOrCreate({
        where: { key: 'registration_open' },
        defaults: { key: 'registration_open', value: 'true' },
      });
      console.log(`✅ 注册状态: ${regConfig.value === 'true' ? '开放' : '关闭'}`);
    } catch (e) {
      console.error('⚠️ 系统配置初始化失败:', e.message);
    }

    // 启动定时任务
    startScheduler();
  } catch (error) {
    console.error('❌ 数据库连接失败:', error.message);
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 TradeLog 后端服务运行在端口 ${PORT}`);
  console.log(`📋 版本: v${pkg.version}`);
  testConnection();
});

module.exports = app;
