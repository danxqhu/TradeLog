const nodemailer = require('nodemailer');
const { EmailConfig } = require('../models');

// 从数据库获取邮件配置，兑底用 .env
async function getEmailConfig() {
  try {
    const config = await EmailConfig.findOne({ order: [['id', 'DESC']] });
    if (config && config.smtp_user && config.smtp_pass) {
      return {
        host: config.smtp_host || 'smtp.qq.com',
        port: parseInt(config.smtp_port) || 465,
        user: config.smtp_user,
        pass: config.smtp_pass,
        to: config.smtp_to || config.smtp_user,
      };
    }
  } catch (e) {
    // 表可能不存在，兑底用 .env
  }
  // 兑底：环境变量
  return {
    host: process.env.SMTP_HOST || 'smtp.qq.com',
    port: parseInt(process.env.SMTP_PORT || '465'),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    to: process.env.SMTP_TO || process.env.SMTP_USER,
  };
}

// 创建邮件传输器
async function createTransporter() {
  const config = await getEmailConfig();
  return {
    transporter: nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: true,
      auth: { user: config.user, pass: config.pass },
    }),
    from: config.user,
    to: config.to,
  };
}

// 发送加仓提醒邮件
async function sendAlertEmail(params) {
  const {
    stockCode,
    stockName,
    currentPrice,
    basePrice,
    buyPrice,
    dropPercent,
    changePercent,
    strategyName,
    stepNumber,
    addRatio,
    addAmount,
    addQuantity,
    alertType, // 'approach' or 'trigger'
    threshold,
    direction, // 'drop' or 'rise'
  } = params;

  const { transporter, from, to } = await createTransporter();

  if (!from || !transporter) {
    console.warn('⚠️ 邮件服务未配置，跳过发送');
    return { sent: false, reason: '邮件服务未配置' };
  }

  const isApproach = alertType === 'approach';
  const isRise = direction === 'rise';
  const changeLabel = isRise ? '涨幅' : '跌幅';
  const changeVal = changePercent || dropPercent;
  const triggerLabel = isRise ? `涨${threshold}%` : `跌${threshold}%`;

  const subject = isApproach
    ? `【⚠️ 接近加仓节点】${stockName}(${stockCode}) - 已${isRise ? '涨' : '跌'}${changeVal}%，即将触发${strategyName}`
    : `【🔔 加仓提醒】${stockName}(${stockCode}) - ${strategyName} 第${stepNumber}次加仓`;

  const headerColor = isApproach ? '#ffc107' : '#e74c3c';
  const headerEmoji = isApproach ? '⚠️' : '📊';
  const headerText = isApproach ? '接近加仓节点' : '加仓提醒';
  const alertBgColor = isApproach ? '#fff3cd' : '#fce4ec';
  const alertBorderColor = isApproach ? '#ffc107' : '#e74c3c';

  const mailOptions = {
    from: `"TradeLog交易助手" <${from}>`,
    to: to,
    subject,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: ${headerColor};">${headerEmoji} ${headerText}</h2>
        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 15px 0;">
          <h3 style="margin: 0 0 10px;">${stockName} (${stockCode})</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 5px 0; color: #666;">基准价格：</td>
              <td style="padding: 5px 0; font-weight: bold;">¥${basePrice}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #666;">买入价格：</td>
              <td style="padding: 5px 0; font-weight: bold;">¥${buyPrice}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #666;">当前价格：</td>
              <td style="padding: 5px 0; font-weight: bold; color: ${headerColor};">¥${currentPrice}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #666;">当前${changeLabel}：</td>
              <td style="padding: 5px 0; font-weight: bold; color: ${headerColor};">${isRise ? '+' : '-'}${changeVal}%</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #666;">触发条件：</td>
              <td style="padding: 5px 0; font-weight: bold;">${isRise ? '涨' : '跌'}${threshold}%（¥${isRise ? (basePrice * (1 + threshold/100)).toFixed(2) : (basePrice * (1 - threshold/100)).toFixed(2)}）</td>
            </tr>
          </table>
        </div>
        <div style="background: ${alertBgColor}; padding: 15px; border-radius: 8px; border-left: 4px solid ${alertBorderColor};">
          <h4 style="margin: 0 0 10px;">📋 策略：${strategyName}</h4>
          ${isApproach ? `
            <p style="margin: 5px 0; font-weight: bold; color: #e67e22;">⚠️ 当前已${isRise ? '涨' : '跌'}${changeVal}%，距离${triggerLabel}加仓节点还差${(threshold - Number(changeVal)).toFixed(1)}%</p>
            <p style="margin: 5px 0;">请做好准备，下一步将触发第 ${stepNumber} 次加仓</p>
          ` : `
            <p style="margin: 5px 0;">第 <strong>${stepNumber}</strong> 次加仓已触发</p>
            <p style="margin: 5px 0;">建议加仓比例：<strong>${addRatio}%</strong></p>
            <p style="margin: 5px 0;">建议加仓金额：<strong>¥${addAmount}</strong></p>
            <p style="margin: 5px 0;">建议加仓数量：<strong>${addQuantity}股</strong>（${Math.floor(addQuantity / 100)}手）</p>
          `}
        </div>
        <p style="color: #999; font-size: 12px; margin-top: 20px;">
          此邮件由 TradeLog 交易助手自动发送，仅供参考，不构成投资建议。
        </p>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ ${isApproach ? '接近预警' : '加仓提醒'}邮件已发送:`, info.messageId);
    return { sent: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ 邮件发送失败:', error.message);
    return { sent: false, error: error.message };
  }
}

// 发送通用邮件
async function sendEmail({ to, subject, text, html }) {
  const { transporter, from } = await createTransporter();

  if (!from || !transporter) {
    console.warn('⚠️ 邮件服务未配置，跳过发送');
    return { sent: false, reason: '邮件服务未配置' };
  }

  try {
    const info = await transporter.sendMail({
      from: `"TradeLog交易助手" <${from}>`,
      to,
      subject,
      text,
      html,
    });
    return { sent: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ 邮件发送失败:', error.message);
    return { sent: false, error: error.message };
  }
}

module.exports = { sendAlertEmail, sendEmail };
