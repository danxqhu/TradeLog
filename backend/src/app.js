require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { sequelize } = require('./models');

const app = express();
const PORT = process.env.PORT || 3001;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 路由
app.use('/api/stocks', require('./routes/stocks'));
app.use('/api/recommendations', require('./routes/recommendations'));
app.use('/api/volume', require('./routes/volume'));
app.use('/api/positions', require('./routes/positions'));
app.use('/api/shanghai-news', require('./routes/shanghaiNews'));
app.use('/api/research-reports', require('./routes/researchReports'));
app.use('/api/calendar', require('./routes/calendar'));

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

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
    // 同步模型（开发环境使用 alter，生产环境应使用 migration）
    await sequelize.sync({ alter: true });
    console.log('✅ 数据库模型同步完成');
  } catch (error) {
    console.error('❌ 数据库连接失败:', error.message);
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 TradeLog 后端服务运行在端口 ${PORT}`);
  testConnection();
});

module.exports = app;
