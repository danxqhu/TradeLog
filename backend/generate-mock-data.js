/**
 * 生成10月9日（上一交易日）的模拟成交额数据
 * 用于测试"昨日此时"对比功能
 */

const { sequelize } = require('./src/config/database');
const { MarketSnapshot } = require('./src/models');

async function generateMockData() {
  try {
    await sequelize.sync();
    
    const date = '2026-10-09';
    
    // 检查是否已有数据
    const existing = await MarketSnapshot.findOne({ where: { snapshot_date: date } });
    if (existing) {
      console.log(`${date} 已有数据，先清除...`);
      await MarketSnapshot.destroy({ where: { snapshot_date: date } });
    }
    
    // 生成时间点：9:25, 9:30-11:30, 13:00-15:00
    const times = [];
    
    // 9:25 集合竞价
    times.push('09:25');
    
    // 上午盘 9:30-11:30
    for (let h = 9; h <= 11; h++) {
      const startM = h === 9 ? 30 : 0;
      const endM = h === 11 ? 30 : 59;
      for (let m = startM; m <= endM; m++) {
        times.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    }
    
    // 下午盘 13:00-15:00
    for (let h = 13; h <= 15; h++) {
      const endM = h === 15 ? 0 : 59;
      for (let m = 0; m <= endM; m++) {
        times.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    }
    
    console.log(`生成 ${times.length} 条记录...`);
    
    // 模拟成交额数据（单位：元）
    // 基础值约 8000 亿，每分钟增加约 30-80 亿
    let baseTurnover = 8000 * 1e8; // 8000亿
    const records = [];
    
    for (const time of times) {
      // 每分钟增加 30-80 亿的随机值
      const increment = (30 + Math.random() * 50) * 1e8;
      baseTurnover += increment;
      
      // 沪市约占 55%，深市约占 45%
      const shTurnover = baseTurnover * (0.53 + Math.random() * 0.04);
      const szTurnover = baseTurnover - shTurnover;
      
      records.push({
        snapshot_date: date,
        snapshot_time: time,
        sh_turnover: Math.round(shTurnover),
        sz_turnover: Math.round(szTurnover),
        total_turnover: Math.round(baseTurnover),
        sh_index: 3200 + Math.random() * 100,
        sz_index: 10500 + Math.random() * 300,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    
    // 批量插入
    await MarketSnapshot.bulkCreate(records);
    
    console.log(`✅ 成功生成 ${date} 的 ${records.length} 条模拟数据`);
    console.log(`   起始成交额: ${(records[0].total_turnover / 1e8).toFixed(2)} 亿`);
    console.log(`   结束成交额: ${(records[records.length - 1].total_turnover / 1e8).toFixed(2)} 亿`);
    
    process.exit(0);
  } catch (err) {
    console.error('生成失败:', err.message);
    process.exit(1);
  }
}

generateMockData();
