/**
 * 仓位策略提醒服务
 * 盘中每分钟检查 + 收盘后检查，触发加仓条件时发送邮件
 */
const axios = require('axios');
const { Position, PositionConfig, PositionAddRecord } = require('../models');
const { sendAlertEmail } = require('./emailService');

// 获取新浪实时价格（复用 positions 路由的逻辑）
function getSinaPrefix(code) {
  if (code.startsWith('6')) return 'sh';
  if (code.startsWith('0') || code.startsWith('3')) return 'sz';
  if (code.startsWith('4') || code.startsWith('8') || code.startsWith('9')) return 'bj';
  return 'sh';
}

async function fetchRealtimePrices(stockCodes) {
  if (!stockCodes.length) return {};
  try {
    const sinaCodes = stockCodes.map(code => getSinaPrefix(code) + code);
    const url = `http://hq.sinajs.cn/list=${sinaCodes.join(',')}`;
    const response = await axios.get(url, {
      headers: { Referer: 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      timeout: 8000,
      responseType: 'text',
      responseEncoding: 'binary',
    });
    const lines = response.data.split('\n').filter(l => l.trim());
    const result = {};
    for (const line of lines) {
      const match = line.match(/var hq_str_(\w+)="(.*)"/);
      if (!match) continue;
      const fields = match[2].split(',');
      if (fields.length < 32) continue;
      const code = match[1].substring(2);
      result[code] = {
        current_price: parseFloat(fields[3]) || 0,
        pre_close: parseFloat(fields[2]) || 0,
      };
    }
    return result;
  } catch (error) {
    console.error('📊 [策略提醒] 获取实时行情失败:', error.message);
    return {};
  }
}

/**
 * 检查所有启用策略的持仓是否需要加仓提醒
 * @param {boolean} isPostMarket - 是否收盘后检查（收盘后检查不区分接近/触发，统一发触发提醒）
 */
async function checkAllPositionAlerts(isPostMarket = false) {
  try {
    // 查找所有启用了策略的持仓
    const configs = await PositionConfig.findAll({
      where: { is_active: true },
    });

    if (!configs.length) return { checked: 0, alerted: 0 };

    // 批量获取实时价格
    const stockCodes = configs.map(c => c.stock_code);
    const priceMap = await fetchRealtimePrices(stockCodes);

    let alertedCount = 0;

    for (const config of configs) {
      const priceInfo = priceMap[config.stock_code];
      if (!priceInfo || !priceInfo.current_price) continue;

      const currentPrice = priceInfo.current_price;
      const basePrice = Number(config.base_price);
      const direction = config.strategy_direction;

      // 计算涨跌幅（基于基准价）
      let changePercent;
      if (direction === 'drop') {
        changePercent = ((basePrice - currentPrice) / basePrice * 100);
      } else {
        changePercent = ((currentPrice - basePrice) / basePrice * 100);
      }

      // 查找对应持仓
      const position = await Position.findOne({
        where: { stock_code: config.stock_code, status: 'holding' },
      });
      if (!position) continue;

      // 查找已加仓记录
      const addRecords = await PositionAddRecord.findAll({
        where: { position_id: position.id },
        order: [['step_number', 'ASC']],
      });

      const steps = config.step_configs;
      const nextStepIndex = addRecords.length + 1; // step_configs[0]是首次买入

      if (nextStepIndex >= steps.length) continue; // 已完成所有步骤

      const nextStep = steps[nextStepIndex];
      const threshold = nextStep.threshold || 10;
      const thresholdMin = config.alert_threshold_min || 80;
      const thresholdMax = config.alert_threshold_max || 90;

      const isTriggered = changePercent >= threshold;
      const approachMin = threshold * thresholdMin / 100;
      const approachMax = threshold * thresholdMax / 100;
      const isApproaching = !isTriggered && changePercent >= approachMin;

      // 防重复
      const lastAlertStep = config.last_alert_step || 0;
      const lastAlertType = config.last_alert_type || '';

      let alertType = null;
      if (isPostMarket) {
        // 收盘后检查：只发触发提醒，不发接近提醒
        if (isTriggered && !(lastAlertStep === nextStep.step && lastAlertType === 'trigger')) {
          alertType = 'trigger';
        }
      } else {
        // 盘中检查：接近和触发都发
        if (isTriggered && !(lastAlertStep === nextStep.step && lastAlertType === 'trigger')) {
          alertType = 'trigger';
        } else if (isApproaching && !(lastAlertStep === nextStep.step && lastAlertType === 'approach')) {
          alertType = 'approach';
        }
      }

      if (alertType && config.email_notification !== false) {
        const addAmount = (Number(config.total_capital) * nextStep.ratio).toFixed(2);
        const addQuantity = Math.floor(addAmount / currentPrice / 100) * 100;

        await config.update({
          last_alert_step: nextStep.step,
          last_alert_type: alertType,
        });

        await sendAlertEmail({
          stockCode: position.stock_code,
          stockName: position.stock_name,
          currentPrice,
          basePrice,
          buyPrice: Number(position.buy_price),
          dropPercent: changePercent.toFixed(2),
          changePercent: changePercent.toFixed(2),
          strategyName: PositionConfig.STRATEGIES[config.strategy_type].name,
          stepNumber: nextStep.step,
          addRatio: (nextStep.ratio * 100).toFixed(0),
          addAmount,
          addQuantity,
          alertType,
          threshold,
          direction,
        });

        alertedCount++;
        console.log(`🔔 [策略提醒] ${position.stock_name}(${position.stock_code}) ${alertType === 'trigger' ? '触发加仓' : '接近加仓节点'}: ${direction === 'drop' ? '跌' : '涨'}${changePercent.toFixed(1)}%`);
      }
    }

    return { checked: configs.length, alerted: alertedCount };
  } catch (error) {
    console.error('🔔 [策略提醒] 检查失败:', error.message);
    return { checked: 0, alerted: 0, error: error.message };
  }
}

module.exports = { checkAllPositionAlerts };
