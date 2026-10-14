const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const { sequelize } = require('../models');

// 获取邮件配置
router.get('/config', async (req, res) => {
  try {
    const [rows] = await sequelize.query('SELECT * FROM email_configs LIMIT 1');
    if (rows.length === 0) {
      return res.json({
        smtp_host: 'smtp.qq.com',
        smtp_port: 465,
        smtp_user: '',
        smtp_pass: '',
        smtp_to: '',
      });
    }
    const config = rows[0];
    res.json({
      smtp_host: config.smtp_host,
      smtp_port: config.smtp_port,
      smtp_user: config.smtp_user || '',
      smtp_pass: config.smtp_pass || '',
      smtp_to: config.smtp_to || '',
    });
  } catch (error) {
    // 表可能还不存在，返回默认值
    res.json({
      smtp_host: 'smtp.qq.com',
      smtp_port: 465,
      smtp_user: '',
      smtp_pass: '',
      smtp_to: '',
    });
  }
});

// 保存邮件配置
router.post('/config', async (req, res) => {
  try {
    const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_to } = req.body;
    const [rows] = await sequelize.query('SELECT id FROM email_configs LIMIT 1');

    if (rows.length === 0) {
      await sequelize.query(
        `INSERT INTO email_configs (smtp_host, smtp_port, smtp_user, smtp_pass, smtp_to, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
        { replacements: [smtp_host, smtp_port, smtp_user, smtp_pass, smtp_to] }
      );
    } else {
      await sequelize.query(
        `UPDATE email_configs SET smtp_host=?, smtp_port=?, smtp_user=?, smtp_pass=?, smtp_to=?, updated_at=NOW() WHERE id=?`,
        { replacements: [smtp_host, smtp_port, smtp_user, smtp_pass, smtp_to, rows[0].id] }
      );
    }

    res.json({ success: true, message: '配置保存成功' });
  } catch (error) {
    console.error('保存邮件配置失败:', error.message);
    res.status(500).json({ error: '保存配置失败: ' + error.message });
  }
});

// 测试发送邮件
router.post('/test', async (req, res) => {
  try {
    const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_to } = req.body;

    if (!smtp_user || !smtp_pass) {
      return res.status(400).json({ error: '请先配置发件人邮箱和授权码' });
    }

    const transporter = nodemailer.createTransport({
      host: smtp_host,
      port: parseInt(smtp_port),
      secure: true,
      auth: { user: smtp_user, pass: smtp_pass },
    });

    const info = await transporter.sendMail({
      from: `"TradeLog交易助手" <${smtp_user}>`,
      to: smtp_to || smtp_user,
      subject: '【TradeLog】邮件测试',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #8B3A42;">📧 邮件测试成功</h2>
          <p>恭喜！TradeLog 邮件推送功能配置成功。</p>
          <p>后续系统将通过此邮箱向您发送交易相关通知。</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="color: #999; font-size: 12px;">此邮件由 TradeLog 交易助手自动发送，仅供参考。</p>
        </div>
      `,
    });

    res.json({ sent: true, messageId: info.messageId });
  } catch (error) {
    console.error('测试邮件发送失败:', error.message);
    res.status(500).json({ sent: false, error: error.message });
  }
});

module.exports = router;
