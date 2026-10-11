const express = require('express');
const router = express.Router();
const { Position, PositionConfig, PositionAddRecord } = require('../models');
const { sendAlertEmail } = require('../services/emailService');

// GET /api/positions - 获取持仓列表
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

    res.json({
      data: positions.rows,
      total: positions.count,
      page: parseInt(page),
      pageSize: parseInt(pageSize),
    });
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
    const { stock_code, strategy_type, total_capital, email_notification } = req.body;
    const strategies = PositionConfig.STRATEGIES;

    if (!strategies[strategy_type]) {
      return res.status(400).json({ error: '无效的策略类型' });
    }

    const stepConfigs = strategies[strategy_type].steps;

    // 查找现有配置
    let config = await PositionConfig.findOne({ where: { stock_code } });

    if (config) {
      await config.update({
        strategy_type,
        total_capital,
        step_configs: stepConfigs,
        email_notification: email_notification !== false,
        is_active: true,
      });
    } else {
      config = await PositionConfig.create({
        stock_code,
        strategy_type,
        total_capital,
        step_configs: stepConfigs,
        email_notification: email_notification !== false,
        is_active: true,
      });
    }

    res.json({ data: config, strategy_info: strategies[strategy_type] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/positions/:id/strategy - 获取仓位策略
router.get('/:id/strategy', async (req, res) => {
  try {
    const position = await Position.findByPk(req.params.id);
    if (!position) {
      return res.status(404).json({ error: '持仓不存在' });
    }

    const config = await PositionConfig.findOne({
      where: { stock_code: position.stock_code, is_active: true },
    });

    const addRecords = await PositionAddRecord.findAll({
      where: { position_id: position.id },
      order: [['step_number', 'ASC']],
    });

    res.json({
      data: {
        position,
        config: config || null,
        add_records: addRecords,
        next_step: config ? config.step_configs[addRecords.length] || null : null,
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
    const buyPrice = Number(position.buy_price);
    const dropPercent = ((buyPrice - current_price) / buyPrice * 100).toFixed(2);

    const addRecords = await PositionAddRecord.findAll({
      where: { position_id: position.id },
      order: [['step_number', 'ASC']],
    });

    const steps = config.step_configs;
    const nextStepIndex = addRecords.length;

    if (nextStepIndex >= steps.length) {
      return res.json({ data: { need_alert: false, message: '已完成所有加仓步骤' } });
    }

    const nextStep = steps[nextStepIndex];
    const shouldAlert = dropPercent >= 10 * (nextStepIndex + 1); // 每跌10%触发下一级

    if (shouldAlert && config.email_notification) {
      const addAmount = (Number(config.total_capital) * nextStep.ratio).toFixed(2);
      const addQuantity = Math.floor(addAmount / current_price / 100) * 100; // 按手(100股)取整

      // 发送邮件提醒
      await sendAlertEmail({
        stockCode: position.stock_code,
        stockName: position.stock_name,
        currentPrice: current_price,
        buyPrice,
        dropPercent,
        strategyName: PositionConfig.STRATEGIES[config.strategy_type].name,
        stepNumber: nextStep.step,
        addRatio: (nextStep.ratio * 100).toFixed(0),
        addAmount,
        addQuantity,
      });

      res.json({
        data: {
          need_alert: true,
          message: '已发送加仓提醒邮件',
          drop_percent: dropPercent,
          next_step: nextStep,
          add_amount: addAmount,
          add_quantity: addQuantity,
          email_sent: true,
        },
      });
    } else {
      res.json({
        data: {
          need_alert: shouldAlert,
          message: shouldAlert ? '触发加仓条件（邮件通知已关闭）' : '未达到加仓条件',
          drop_percent: dropPercent,
          next_step: nextStep,
        },
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/positions/strategies/list - 获取所有策略类型
router.get('/strategies/list', async (req, res) => {
  res.json({ data: PositionConfig.STRATEGIES });
});

module.exports = router;
