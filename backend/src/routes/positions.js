const express = require('express');
const axios = require('axios');
const router = express.Router();
const { Position, PositionConfig, PositionAddRecord, TradingCalendar } = require('../models');
const { sendAlertEmail } = require('../services/emailService');
const { calculateTradingDays } = require('../services/tradingDayService');

// 股票代码 -> 新浪行情代码前缀
function getSinaPrefix(code) {
  if (code.startsWith('6')) return 'sh';
  if (code.startsWith('0') || code.startsWith('3')) return 'sz';
  if (code.startsWith('4') || code.startsWith('8') || code.startsWith('9')) return 'bj';
  return 'sh';
}

// 获取新浪实时价格
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
        change_percent: parseFloat(fields[2]) > 0
          ? ((parseFloat(fields[3]) - parseFloat(fields[2])) / parseFloat(fields[2]) * 100).toFixed(2)
          : '0.00',
      };
    }
    return result;
  } catch (error) {
    console.error('获取实时行情失败:', error.message);
    return {};
  }
}

// GET /api/positions - 获取持仓列表（含实时价格和持仓天数）
router.get('/', async (req, res) => {
  try {
    const { status = 'holding', page = 1, pageSize = 50 } = req.query;
    const where = {};
    if (status) where.status = status;

    const positions = await Position.findAndCountAll({
      where,
      include: [
        { model: PositionConfig, as: 'configs' },
        { model: PositionAddRecord, as: 'addRecords' },
      ],
      limit: parseInt(pageSize),
      offset: (parseInt(page) - 1) * parseInt(pageSize),
      order: [['buy_date', 'DESC']],
    });

    // 获取实时价格
    const stockCodes = positions.rows.map(p => p.stock_code);
    const priceMap = await fetchRealtimePrices(stockCodes);

    // 计算持仓天数和盈亏
    const today = new Date().toISOString().split('T')[0];
    const enrichedData = [];
    for (const pos of positions.rows) {
      const posData = pos.toJSON();
      const realtime = priceMap[pos.stock_code];
      if (realtime) {
        posData.current_price = realtime.current_price;
        posData.today_change_percent = realtime.change_percent;
      }

      // 计算盈亏
      const avgCost = Number(posData.avg_cost) || Number(posData.buy_price);
      const currentPrice = Number(posData.current_price) || avgCost;
      const quantity = Number(posData.quantity);
      posData.profit_loss = ((currentPrice - avgCost) * quantity).toFixed(2);
      posData.profit_loss_percent = avgCost > 0
        ? ((currentPrice - avgCost) / avgCost * 100).toFixed(2)
        : '0.00';

      // 计算持仓天数（自然日）
      const buyDate = new Date(posData.buy_date);
      const now = new Date(today);
      posData.holding_natural_days = Math.floor((now - buyDate) / (1000 * 60 * 60 * 24));

      // 计算持仓天数（交易日）
      try {
        const tradingDays = await calculateTradingDays(posData.buy_date, today);
        posData.holding_trading_days = tradingDays;
      } catch (e) {
        posData.holding_trading_days = posData.holding_natural_days;
      }

      enrichedData.push(posData);
    }

    res.json({
      data: enrichedData,
      total: positions.count,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/positions/strategies/list - 获取所有策略类型（必须在 /:id 之前）
router.get('/strategies/list', async (req, res) => {
  res.json({ data: PositionConfig.STRATEGIES });
});

// GET /api/positions/by-code/:stockCode - 通过股票代码获取持仓（必须在 /:id 之前）
router.get('/by-code/:stockCode', async (req, res) => {
  try {
    const position = await Position.findOne({
      where: { stock_code: req.params.stockCode, status: 'holding' },
      include: [
        { model: PositionConfig, as: 'configs' },
        { model: PositionAddRecord, as: 'addRecords' },
      ],
    });
    if (!position) {
      return res.status(404).json({ error: '未找到该股票的持仓' });
    }

    // 获取实时价格
    const priceMap = await fetchRealtimePrices([req.params.stockCode]);
    const posData = position.toJSON();
    const realtime = priceMap[req.params.stockCode];
    if (realtime) {
      posData.current_price = realtime.current_price;
      posData.today_change_percent = realtime.change_percent;
    }

    // 计算盈亏
    const avgCost = Number(posData.avg_cost) || Number(posData.buy_price);
    const currentPrice = Number(posData.current_price) || avgCost;
    posData.profit_loss = ((currentPrice - avgCost) * Number(posData.quantity)).toFixed(2);
    posData.profit_loss_percent = avgCost > 0
      ? ((currentPrice - avgCost) / avgCost * 100).toFixed(2)
      : '0.00';

    // 计算持仓天数
    const today = new Date().toISOString().split('T')[0];
    const buyDate = new Date(posData.buy_date);
    const now = new Date(today);
    posData.holding_natural_days = Math.floor((now - buyDate) / (1000 * 60 * 60 * 24));
    try {
      const tradingDays = await calculateTradingDays(posData.buy_date, today);
      posData.holding_trading_days = tradingDays;
    } catch (e) {
      posData.holding_trading_days = posData.holding_natural_days;
    }

    // 计算触发价位
    const config = posData.configs?.[0] || null;
    let stepsWithPrices = [];
    if (config) {
      const basePrice = Number(config.base_price);
      const direction = config.strategy_direction;
      stepsWithPrices = config.step_configs.map(step => {
        const threshold = step.threshold || 0;
        let triggerPrice;
        if (threshold === 0) {
          triggerPrice = basePrice;
        } else if (direction === 'drop') {
          triggerPrice = basePrice * (1 - threshold / 100);
        } else {
          triggerPrice = basePrice * (1 + threshold / 100);
        }
        return { ...step, trigger_price: Number(triggerPrice.toFixed(2)) };
      });
    }

    const investedAmount = (posData.addRecords || []).reduce((sum, r) => sum + Number(r.add_amount || 0), 0);

    res.json({
      data: {
        position: posData,
        config,
        add_records: posData.addRecords || [],
        steps_with_prices: stepsWithPrices,
        invested_amount: investedAmount,
        next_step: config ? stepsWithPrices[(posData.addRecords || []).length + 1] || null : null,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/positions/by-code/:stockCode/check-alert - 通过股票代码检查加仓提醒
router.post('/by-code/:stockCode/check-alert', async (req, res) => {
  try {
    const position = await Position.findOne({
      where: { stock_code: req.params.stockCode, status: 'holding' },
      include: [{ model: PositionConfig, as: 'configs' }],
    });
    if (!position) {
      return res.status(404).json({ error: '未找到该股票的持仓' });
    }

    const config = position.configs?.[0];
    if (!config || !config.is_active) {
      return res.json({ data: { need_alert: false, message: '未配置策略或策略未启用' } });
    }

    const { current_price } = req.body;
    const basePrice = Number(config.base_price);
    const direction = config.strategy_direction;

    let changePercent;
    if (direction === 'drop') {
      changePercent = ((basePrice - current_price) / basePrice * 100).toFixed(2);
    } else {
      changePercent = ((current_price - basePrice) / basePrice * 100).toFixed(2);
    }

    const addRecords = await PositionAddRecord.findAll({
      where: { position_id: position.id },
      order: [['step_number', 'ASC']],
    });

    const steps = config.step_configs;
    const nextStepIndex = addRecords.length + 1; // step_configs[0]是首次买入，addRecords从第2步开始记录

    if (nextStepIndex >= steps.length) {
      return res.json({ data: { need_alert: false, message: '已完成所有加仓步骤' } });
    }

    const nextStep = steps[nextStepIndex];
    const threshold = nextStep.threshold || 10;
    const thresholdMin = config.alert_threshold_min || 80;
    const thresholdMax = config.alert_threshold_max || 90;

    const isTriggered = Number(changePercent) >= threshold;
    const approachMin = threshold * thresholdMin / 100;
    const approachMax = threshold * thresholdMax / 100;
    const isApproaching = !isTriggered && Number(changePercent) >= approachMin;

    const lastAlertStep = config.last_alert_step || 0;
    const lastAlertType = config.last_alert_type || '';

    let alertType = null;
    if (isTriggered && !(lastAlertStep === nextStep.step && lastAlertType === 'trigger')) {
      alertType = 'trigger';
    } else if (isApproaching && !(lastAlertStep === nextStep.step && lastAlertType === 'approach')) {
      alertType = 'approach';
    }

    if (alertType && config.email_notification !== false) {
      const addAmount = (Number(config.total_capital) * nextStep.ratio).toFixed(2);
      const addQuantity = Math.floor(addAmount / current_price / 100) * 100;

      await config.update({ last_alert_step: nextStep.step, last_alert_type: alertType });

      await sendAlertEmail({
        stockCode: position.stock_code,
        stockName: position.stock_name,
        currentPrice: current_price,
        basePrice,
        buyPrice: Number(position.buy_price),
        dropPercent: changePercent,
        changePercent,
        strategyName: PositionConfig.STRATEGIES[config.strategy_type].name,
        stepNumber: nextStep.step,
        addRatio: (nextStep.ratio * 100).toFixed(0),
        addAmount,
        addQuantity,
        alertType,
        threshold,
        direction,
      });

      res.json({
        data: {
          need_alert: true, alert_type: alertType,
          message: alertType === 'trigger' ? '已触发加仓条件，已发送邮件' : '接近加仓节点，已发送预警邮件',
          change_percent: changePercent, threshold, next_step: nextStep,
          add_amount: addAmount, add_quantity: addQuantity, email_sent: true,
        },
      });
    } else {
      res.json({
        data: {
          need_alert: isTriggered || isApproaching, alert_type: alertType,
          message: isTriggered ? '已触发加仓条件（邮件通知已关闭）' :
                   isApproaching ? '接近加仓节点（邮件通知已关闭）' : '未达到加仓条件',
          change_percent: changePercent, threshold,
          approach_range: { min: approachMin, max: approachMax }, next_step: nextStep,
        },
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/positions/:id - 获取持仓详情
router.get('/:id', async (req, res) => {
  try {
    const position = await Position.findByPk(req.params.id, {
      include: [
        { model: PositionConfig, as: 'configs' },
        { model: PositionAddRecord, as: 'addRecords' },
      ],
    });
    if (!position) {
      return res.status(404).json({ error: '持仓不存在' });
    }
    res.json({ data: position });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/positions - 新建持仓
router.post('/', async (req, res) => {
  try {
    const { stock_code, stock_name, buy_date, buy_price, quantity } = req.body;
    const total_cost = buy_price * quantity;
    const position = await Position.create({
      stock_code,
      stock_name,
      buy_date,
      buy_price,
      quantity,
      current_price: buy_price,
      total_cost,
      avg_cost: buy_price,
    });
    res.json({ data: position });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/positions/:id - 更新持仓
router.put('/:id', async (req, res) => {
  try {
    const position = await Position.findByPk(req.params.id);
    if (!position) {
      return res.status(404).json({ error: '持仓不存在' });
    }
    await position.update(req.body);
    res.json({ data: position });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/positions/:id/add - 加仓
router.post('/:id/add', async (req, res) => {
  try {
    const position = await Position.findByPk(req.params.id);
    if (!position) {
      return res.status(404).json({ error: '持仓不存在' });
    }

    const { add_price, add_quantity, trigger_type, drop_percent, add_ratio } = req.body;
    const add_amount = add_price * add_quantity;

    // 计算新的平均成本
    const oldTotalCost = Number(position.total_cost) || 0;
    const oldQuantity = Number(position.quantity) || 0;
    const newTotalCost = oldTotalCost + add_amount;
    const newQuantity = oldQuantity + add_quantity;
    const newAvgCost = newQuantity > 0 ? (newTotalCost / newQuantity).toFixed(2) : 0;

    // 获取当前加仓是第几次
    const addCount = await PositionAddRecord.count({ where: { position_id: position.id } });

    // 创建加仓记录
    const record = await PositionAddRecord.create({
      position_id: position.id,
      step_number: addCount + 1,
      add_price,
      add_quantity,
      add_amount,
      trigger_type,
      drop_percent,
      add_ratio,
    });

    // 更新持仓信息
    await position.update({
      quantity: newQuantity,
      total_cost: newTotalCost,
      avg_cost: newAvgCost,
      current_price: add_price,
    });

    res.json({ data: record, position: await Position.findByPk(position.id) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/positions/:id - 删除持仓
router.delete('/:id', async (req, res) => {
  try {
    const position = await Position.findByPk(req.params.id);
    if (!position) {
      return res.status(404).json({ error: '持仓不存在' });
    }
    // 先删除关联的加仓记录和策略配置
    await PositionAddRecord.destroy({ where: { position_id: position.id } });
    await PositionConfig.destroy({ where: { stock_code: position.stock_code } });
    await position.destroy();
    res.json({ message: '删除成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/positions/:id/close - 清仓
router.post('/:id/close', async (req, res) => {
  try {
    const position = await Position.findByPk(req.params.id);
    if (!position) {
      return res.status(404).json({ error: '持仓不存在' });
    }

    const { close_price, close_date } = req.body;
    const totalRevenue = close_price * position.quantity;
    const profitLoss = totalRevenue - position.total_cost;
    const profitLossPercent = ((profitLoss / position.total_cost) * 100).toFixed(2);

    await position.update({
      status: 'closed',
      current_price: close_price,
      close_date: close_date || new Date().toISOString().split('T')[0],
      profit_loss: profitLoss.toFixed(2),
      profit_loss_percent: profitLossPercent,
    });

    res.json({ data: position, message: '清仓成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/positions/config - 创建/更新仓位策略配置
router.post('/config', async (req, res) => {
  try {
    const { stock_code, strategy_type, base_price, total_capital, capital_source, alert_threshold_min, alert_threshold_max, email_notification } = req.body;
    const strategies = PositionConfig.STRATEGIES;

    if (!strategies[strategy_type]) {
      return res.status(400).json({ error: '无效的策略类型' });
    }

    const strategyInfo = strategies[strategy_type];
    const stepConfigs = strategyInfo.steps;
    const direction = strategyInfo.direction;

    // 总资金：手动输入 or 首次买入金额
    let finalCapital = total_capital;
    const finalCapitalSource = capital_source || 'first_buy';
    if (finalCapitalSource === 'first_buy' || !finalCapital) {
      // 查找该股票的首次买入金额
      const position = await Position.findOne({ where: { stock_code, status: 'holding' } });
      if (position) {
        finalCapital = Number(position.buy_price) * Number(position.quantity);
      } else {
        return res.status(400).json({ error: '未找到该股票的持仓记录，无法自动计算总资金' });
      }
    }

    // 基准价格必填
    if (!base_price) {
      return res.status(400).json({ error: '请设置基准价格' });
    }

    // 查找现有配置
    let config = await PositionConfig.findOne({ where: { stock_code } });

    const updateData = {
      strategy_type,
      strategy_direction: direction,
      base_price,
      total_capital: finalCapital,
      capital_source: finalCapitalSource,
      step_configs: stepConfigs,
      alert_threshold_min: alert_threshold_min || 80,
      alert_threshold_max: alert_threshold_max || 90,
      email_notification: email_notification !== false,
      is_active: true,
    };

    if (config) {
      await config.update(updateData);
    } else {
      config = await PositionConfig.create({
        stock_code,
        ...updateData,
      });
    }

    res.json({ data: config, strategy_info: strategyInfo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/positions/:id/strategy - 获取仓位策略（含计算后的触发价位）
router.get('/:id/strategy', async (req, res) => {
  try {
    const position = await Position.findByPk(req.params.id, {
      include: [
        { model: PositionConfig, as: 'configs' },
        { model: PositionAddRecord, as: 'addRecords' },
      ],
    });
    if (!position) {
      return res.status(404).json({ error: '持仓不存在' });
    }

    const config = position.configs?.[0] || null;

    const addRecords = await PositionAddRecord.findAll({
      where: { position_id: position.id },
      order: [['step_number', 'ASC']],
    });

    // 计算每一步的触发价位
    let stepsWithPrices = [];
    if (config) {
      const basePrice = Number(config.base_price);
      const direction = config.strategy_direction;
      stepsWithPrices = config.step_configs.map(step => {
        const threshold = step.threshold || 0;
        let triggerPrice;
        if (threshold === 0) {
          triggerPrice = basePrice; // 首次买入就是基准价
        } else if (direction === 'drop') {
          triggerPrice = basePrice * (1 - threshold / 100);
        } else {
          triggerPrice = basePrice * (1 + threshold / 100);
        }
        return {
          ...step,
          trigger_price: Number(triggerPrice.toFixed(2)),
        };
      });
    }

    // 计算已投入资金
    const investedAmount = addRecords.reduce((sum, r) => sum + Number(r.add_amount || 0), 0);

    res.json({
      data: {
        position,
        config: config || null,
        add_records: addRecords,
        steps_with_prices: stepsWithPrices,
        invested_amount: investedAmount,
        next_step: config ? stepsWithPrices[addRecords.length + 1] || null : null,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/positions/:id/check-alert - 检查是否需要加仓提醒
router.post('/:id/check-alert', async (req, res) => {
  try {
    const position = await Position.findByPk(req.params.id, {
      include: [{ model: PositionConfig, as: 'configs' }],
    });
    if (!position) {
      return res.status(404).json({ error: '持仓不存在' });
    }

    const config = position.configs?.[0];
    if (!config || !config.is_active) {
      return res.json({ data: { need_alert: false, message: '未配置策略或策略未启用' } });
    }

    const { current_price } = req.body;
    const basePrice = Number(config.base_price);
    const direction = config.strategy_direction;

    // 计算涨跌幅（基于基准价）
    let changePercent;
    if (direction === 'drop') {
      changePercent = ((basePrice - current_price) / basePrice * 100).toFixed(2);
    } else {
      changePercent = ((current_price - basePrice) / basePrice * 100).toFixed(2);
    }

    const addRecords = await PositionAddRecord.findAll({
      where: { position_id: position.id },
      order: [['step_number', 'ASC']],
    });

    const steps = config.step_configs;
    const nextStepIndex = addRecords.length + 1; // step_configs[0]是首次买入，addRecords从第2步开始记录

    if (nextStepIndex >= steps.length) {
      return res.json({ data: { need_alert: false, message: '已完成所有加仓步骤' } });
    }

    const nextStep = steps[nextStepIndex];
    const threshold = nextStep.threshold || 10;
    const thresholdMin = config.alert_threshold_min || 80;
    const thresholdMax = config.alert_threshold_max || 90;

    // 判断是否触发
    const isTriggered = Number(changePercent) >= threshold;
    // 判断是否接近触发
    const approachMin = threshold * thresholdMin / 100;
    const approachMax = threshold * thresholdMax / 100;
    const isApproaching = !isTriggered && Number(changePercent) >= approachMin;

    // 防重复：同一步骤同一级别只发一次
    const lastAlertStep = config.last_alert_step || 0;
    const lastAlertType = config.last_alert_type || '';

    let alertType = null;
    if (isTriggered && !(lastAlertStep === nextStep.step && lastAlertType === 'trigger')) {
      alertType = 'trigger';
    } else if (isApproaching && !(lastAlertStep === nextStep.step && lastAlertType === 'approach')) {
      alertType = 'approach';
    }

    if (alertType && config.email_notification !== false) {
      const addAmount = (Number(config.total_capital) * nextStep.ratio).toFixed(2);
      const addQuantity = Math.floor(addAmount / current_price / 100) * 100;

      // 更新最后提醒状态
      await config.update({
        last_alert_step: nextStep.step,
        last_alert_type: alertType,
      });

      // 发送邮件
      await sendAlertEmail({
        stockCode: position.stock_code,
        stockName: position.stock_name,
        currentPrice: current_price,
        basePrice,
        buyPrice: Number(position.buy_price),
        dropPercent: changePercent,
        changePercent,
        strategyName: PositionConfig.STRATEGIES[config.strategy_type].name,
        stepNumber: nextStep.step,
        addRatio: (nextStep.ratio * 100).toFixed(0),
        addAmount,
        addQuantity,
        alertType, // 'approach' or 'trigger'
        threshold,
        direction,
      });

      res.json({
        data: {
          need_alert: true,
          alert_type: alertType,
          message: alertType === 'trigger' ? '已触发加仓条件，已发送邮件' : '接近加仓节点，已发送预警邮件',
          change_percent: changePercent,
          threshold,
          next_step: nextStep,
          add_amount: addAmount,
          add_quantity: addQuantity,
          email_sent: true,
        },
      });
    } else {
      res.json({
        data: {
          need_alert: isTriggered || isApproaching,
          alert_type: alertType,
          message: isTriggered ? '已触发加仓条件（邮件通知已关闭）' :
                   isApproaching ? '接近加仓节点（邮件通知已关闭）' :
                   '未达到加仓条件',
          change_percent: changePercent,
          threshold,
          approach_range: { min: approachMin, max: approachMax },
          next_step: nextStep,
        },
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
