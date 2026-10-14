/**
 * 导入脚本：将 market_averages.json 新数据合并到数据库
 * - 读取 JSON 中的新记录（包含 sse, szse, bse, complete 字段）
 * - 从数据库读取所有已有记录
 * - 合并新旧数据，重算 ma20/ma60（仅计算完整数据）
 * - 全量 upsert
 *
 * 运行: cd backend && node scripts/import_averages.js
 */
const fs = require('fs');
const path = require('path');
const { sequelize, MarketAverage } = require('../src/models');

async function main() {
  const jsonPath = path.join(__dirname, '../data/market_averages.json');

  if (!fs.existsSync(jsonPath)) {
    console.error('❌ JSON 文件不存在:', jsonPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(jsonPath, 'utf-8').trim();
  if (!raw) {
    console.error('❌ JSON 文件为空');
    process.exit(1);
  }

  const newRecords = JSON.parse(raw);
  console.log(`📖 JSON 中有 ${newRecords.length} 条记录`);

  await sequelize.sync();

  // 1. 从数据库读取所有已有记录
  const existing = await MarketAverage.findAll({
    order: [['trade_date', 'ASC']],
    raw: true,
  });
  console.log(`📊 数据库已有 ${existing.length} 条记录`);

  // 2. 合并：以 trade_date 为 key，新数据覆盖旧数据
  const merged = new Map();
  for (const r of existing) {
    merged.set(r.trade_date, {
      trade_date: r.trade_date,
      sse_amount: r.sse_amount ? parseFloat(r.sse_amount) : null,
      szse_amount: r.szse_amount ? parseFloat(r.szse_amount) : null,
      bse_amount: r.bse_amount ? parseFloat(r.bse_amount) : null,
      amount_yi: parseFloat(r.amount_yi) || 0,
      data_complete: r.data_complete || false,
    });
  }
  
  for (const r of newRecords) {
    // 计算总额
    const sse = r.sse || null;
    const szse = r.szse || null;
    const bse = r.bse || null;
    const total = (sse || 0) + (szse || 0) + (bse || 0);
    
    // 完整性定义：沪深两市都有数据即为"完整"
    // 北交所占比较小（约1-2%），暂不要求
    const isComplete = (sse !== null) && (szse !== null);
    
    merged.set(r.date, {
      trade_date: r.date,
      sse_amount: sse,
      szse_amount: szse,
      bse_amount: bse,
      amount_yi: total > 0 ? parseFloat(total.toFixed(2)) : 0,
      data_complete: isComplete,
    });
  }

  // 3. 按日期排序
  const allDates = [...merged.values()].sort((a, b) =>
    a.trade_date.localeCompare(b.trade_date)
  );

  // 4. 计算滚动 ma20/ma60（仅使用完整数据）
  const completeRecords = allDates.filter(r => r.data_complete);
  console.log(`📊 完整数据: ${completeRecords.length} 条，不完整数据: ${allDates.length - completeRecords.length} 条`);

  // 为所有记录初始化 ma20/ma60 为 null
  for (const r of allDates) {
    r.ma20 = null;
    r.ma60 = null;
  }

  // 只对完整数据计算 MA
  if (completeRecords.length > 0) {
    const amounts = completeRecords.map(r => r.amount_yi);
    
    for (let i = 0; i < completeRecords.length; i++) {
      const record = completeRecords[i];
      // 找到该记录在 allDates 中的位置
      const idx = allDates.indexOf(record);
      
      // ma20
      if (i >= 19) {
        const slice20 = amounts.slice(i - 19, i + 1);
        allDates[idx].ma20 = +(slice20.reduce((a, b) => a + b, 0) / 20).toFixed(2);
      }
      // ma60
      if (i >= 59) {
        const slice60 = amounts.slice(i - 59, i + 1);
        allDates[idx].ma60 = +(slice60.reduce((a, b) => a + b, 0) / 60).toFixed(2);
      }
    }
  }

  // 5. Upsert 到数据库
  let created = 0;
  let updated = 0;

  for (const r of allDates) {
    const [row, isCreated] = await MarketAverage.findOrCreate({
      where: { trade_date: r.trade_date },
      defaults: {
        trade_date: r.trade_date,
        sse_amount: r.sse_amount,
        szse_amount: r.szse_amount,
        bse_amount: r.bse_amount,
        amount_yi: r.amount_yi,
        data_complete: r.data_complete,
        ma20: r.ma20,
        ma60: r.ma60,
      },
    });

    if (!isCreated) {
      await row.update({
        sse_amount: r.sse_amount,
        szse_amount: r.szse_amount,
        bse_amount: r.bse_amount,
        amount_yi: r.amount_yi,
        data_complete: r.data_complete,
        ma20: r.ma20,
        ma60: r.ma60,
      });
      updated++;
    } else {
      created++;
    }
  }

  console.log(`✅ 导入完成！共 ${allDates.length} 条（新增 ${created}，更新 ${updated}）`);
  console.log(`📊 表名: market_averages`);

  // 显示最新 5 条
  const latest = await MarketAverage.findAll({
    order: [['trade_date', 'DESC']],
    limit: 5,
    raw: true,
  });
  console.log('\n最新 5 条记录:');
  for (const r of latest) {
    const status = r.data_complete ? '✓' : '⚠不完整';
    console.log(`  ${r.trade_date}: SSE=${r.sse_amount || 'N/A'} SZSE=${r.szse_amount || 'N/A'} BSE=${r.bse_amount || 'N/A'} 总额=${r.amount_yi}亿 ${status}`);
  }

  // 统计完整/不完整数据
  const completeCount = await MarketAverage.count({ where: { data_complete: true } });
  const incompleteCount = await MarketAverage.count({ where: { data_complete: false } });
  console.log(`\n📊 数据统计: 完整 ${completeCount} 条，不完整 ${incompleteCount} 条`);

  process.exit(0);
}

main().catch(err => {
  console.error('❌ 导入失败:', err.message);
  process.exit(1);
});
