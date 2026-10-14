const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const EmailConfig = sequelize.define('EmailConfig', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  smtp_host: {
    type: DataTypes.STRING(100),
    allowNull: false,
    defaultValue: 'smtp.qq.com',
    comment: 'SMTP 服务器地址',
  },
  smtp_port: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 465,
    comment: 'SMTP 端口',
  },
  smtp_user: {
    type: DataTypes.STRING(200),
    allowNull: true,
    comment: '发件人邮箱',
  },
  smtp_pass: {
    type: DataTypes.STRING(200),
    allowNull: true,
    comment: '邮箱授权码',
  },
  smtp_to: {
    type: DataTypes.STRING(200),
    allowNull: true,
    comment: '默认收件人邮箱',
  },
}, {
  tableName: 'email_configs',
});

module.exports = EmailConfig;
