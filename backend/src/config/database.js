const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME || 'tradelog_db',
  process.env.DB_USER || 'tradeloguser',
  process.env.DB_PASSWORD || 'tradelog_password',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    dialect: 'mysql',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    timezone: '+08:00',
    define: {
      timestamps: true,
      underscored: true,
    },
  }
);

module.exports = { sequelize };
