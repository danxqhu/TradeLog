const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const SystemConfig = sequelize.define('SystemConfig', {
  key: {
    type: DataTypes.STRING(100),
    primaryKey: true,
    allowNull: false,
  },
  value: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
}, {
  tableName: 'system_configs',
  timestamps: false,
});

module.exports = SystemConfig;
