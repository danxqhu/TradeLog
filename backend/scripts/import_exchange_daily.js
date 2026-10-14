/**
 * 一次性脚本：将交易所官方数据 JSON 导入数据库 exchange_dailies 表
 * 运行: cd backend && node scripts/import_exchange_daily.js
 */
const fs = require('fs');
const path = require('path');
const { sequelize, ExchangeDaily } = require('../src/models');

async function main() {
  const jsonPath = path.join(__dirname, '../data/exchange_daily.json');
  
  if (!fs.existsSync(jsonPath)) {
    console.error('❌ JSON 文件不存在:', jsonPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(jsonPath, 'utf-8');
  const records = JSON.parse(raw);
  console.log(`📖 读取到 ${records.length} 条记录`);

  await sequelize.sync();

  let imported = 0;
  let updated = 0;

  for (const r of records) {
    const [row, created] = await ExchangeDaily.findOrCreate({
      where: { trade_date: r.date },
      defaults: {
        trade_date: r.date,
        sse_main_a: r.sse_main_a || null,
        sse_star: r.sse_star || null,
        sse_total: r.sse_total || null,
        szse_main_a: r.szse_main_a || null,
        szse_gem: r.szse_gem || null,
        szse_total: r.szse_total || null,
        bse_total: r.bse_total || null,
        total_amount: r.total_amount || null,
        ma20: r.ma20 || null,
        ma60: r.ma60 || null,
        data_complete: r.data_complete !== undefined ? r.data_complete : true,
      },
    });

    if (!created) {
      await row.update({
        sse_main_a: r.sse_main_a || null,
        sse_star: r.sse_star || null,
        sse_total: r.sse_total || null,
        szse_main_a: r.szse_main_a || null,
        szse_gem: r.szse_gem || null,
        szse_total: r.szse_total || null,
        bse_total: r.bse_total || null,
        total_amount: r.total_amount || null,
        ma20: r.ma20 || null,
        ma60: r.ma60 || null,
        data_complete: r.data_complete !== undefined ? r.data_complete : true,
      });
      updated++;
    } else {
      imported++;
    }
  }

  console.log(`✅ 导入完成！共 ${records.length} 条（新增 ${imported}，更新 ${updated}）`);
  console.log(`📊 表名: exchange_dailies`);

  // 打印最新 3 条
  const latest = await ExchangeDaily.findAll({
    order: [['trade_date', 'DESC']],
    limit: 3,
  });
  console.log('\n最新 3 条记录:');
  for (const row of latest) {
    const tag = row.data_complete ? '' : ' [不完整]';
    console.log(`  ${row.trade_date}: 沪=${row.sse_total}亿 深=${row.szse_total}亿 合计=${row.total_amount}亿  ma20=${row.ma20}亿  ma60=${row.ma60}亿${tag}`);
  }

  await sequelize.close();
}

main().catch(err => {
  console.error('❌ 导入失败:', err.message);
  process.exit(1);
});
