const nodemailer = require('nodemailer');

// 创建邮件传输器
function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.163.com',
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// 发送加仓提醒邮件
async function sendAlertEmail(params) {
  const {
    stockCode,
    stockName,
    currentPrice,
    buyPrice,
    dropPercent,
    strategyName,
    stepNumber,
    addRatio,
    addAmount,
    addQuantity,
  } = params;

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('⚠️ 邮件服务未配置，跳过发送');
    return { sent: false, reason: '邮件服务未配置' };
  }

  const transporter = createTransporter();

  const mailOptions = {
    from: `"TradeLog交易助手" <${process.env.SMTP_USER}>`,
    to: process.env.SMTP_TO || process.env.SMTP_USER,
    subject: `【加仓提醒】${stockName}(${stockCode}) - ${strategyName}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #e74c3c;">📊 加仓提醒</h2>
        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin: 15px 0;">
          <h3 style="margin: 0 0 10px;">${stockName} (${stockCode})</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 5px 0; color: #666;">买入价格：</td>
              <td style="padding: 5px 0; font-weight: bold;">¥${buyPrice}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #666;">当前价格：</td>
              <td style="padding: 5px 0; font-weight: bold; color: #e74c3c;">¥${currentPrice}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #666;">当前跌幅：</td>
              <td style="padding: 5px 0; font-weight: bold; color: #e74c3c;">-${dropPercent}%</td>
            </tr>
          </table>
        </div>
        <div style="background: #fff3cd; padding: 15px; border-radius: 8px; border-left: 4px solid #ffc107;">
          <h4 style="margin: 0 0 10px;">📋 策略：${strategyName}</h4>
          <p style="margin: 5px 0;">第 <strong>${stepNumber}</strong> 次加仓</p>
          <p style="margin: 5px 0;">建议加仓比例：<strong>${addRatio}%</strong></p>
          <p style="margin: 5px 0;">建议加仓金额：<strong>¥${addAmount}</strong></p>
          <p style="margin: 5px 0;">建议加仓数量：<strong>${addQuantity}股</strong>（${Math.floor(addQuantity / 100)}手）</p>
        </div>
        <p style="color: #999; font-size: 12px; margin-top: 20px;">
          此邮件由 TradeLog 交易助手自动发送，仅供参考，不构成投资建议。
        </p>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('✅ 加仓提醒邮件已发送:', info.messageId);
    return { sent: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ 邮件发送失败:', error.message);
    return { sent: false, error: error.message };
  }
}

// 发送通用邮件
async function sendEmail({ to, subject, text, html }) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn('⚠️ 邮件服务未配置，跳过发送');
    return { sent: false, reason: '邮件服务未配置' };
  }

  const transporter = createTransporter();

  try {
    const info = await transporter.sendMail({
      from: `"TradeLog交易助手" <${process.env.SMTP_USER}>`,
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
