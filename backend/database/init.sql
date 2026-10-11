-- TradeLog 数据库初始化脚本
-- 此文件会在 MySQL 容器首次启动时自动执行

-- 创建数据库（如果不存在）
CREATE DATABASE IF NOT EXISTS tradelog_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE tradelog_db;

-- 注意：表结构由 Sequelize 模型自动同步（alter: true）
-- 此文件主要用于初始化交易日历数据和种子数据

-- 初始化2025-2026年交易日历（排除周末）
-- 实际节假日需要手动更新
DELIMITER //
CREATE PROCEDURE IF NOT EXISTS init_trading_calendar(IN start_year INT, IN end_year INT)
BEGIN
    DECLARE d DATE;
    DECLARE end_d DATE;
    SET d = CONCAT(start_year, '-01-01');
    SET end_d = CONCAT(end_year, '-12-31');

    WHILE d <= end_d DO
        INSERT IGNORE INTO trading_calendar (trade_date, is_trading_day, market, year, month, day_of_week)
        VALUES (
            d,
            CASE WHEN DAYOFWEEK(d) IN (1, 7) THEN FALSE ELSE TRUE END,
            'ALL',
            YEAR(d),
            MONTH(d),
            DAYOFWEEK(d) - 1
        );
        SET d = DATE_ADD(d, INTERVAL 1 DAY);
    END WHILE;
END //
DELIMITER ;

CALL init_trading_calendar(2025, 2026);
DROP PROCEDURE IF EXISTS init_trading_calendar;
