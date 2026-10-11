#!/bin/bash
# 上海证券报定时抓取脚本
# 用法: bash run_scraper.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

LOG_FILE="$LOG_DIR/scraper_$(date +%Y%m%d_%H%M).log"

echo "========================================" >> "$LOG_FILE"
echo "开始抓取: $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"
echo "========================================" >> "$LOG_FILE"

cd "$SCRIPT_DIR"
python3 shanghai_news_scraper.py --max-detail 10 >> "$LOG_FILE" 2>&1

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ 抓取完成: $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"
else
    echo "❌ 抓取失败 (exit code: $EXIT_CODE): $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"
fi

# 清理 30 天前的日志
find "$LOG_DIR" -name "scraper_*.log" -mtime +30 -delete 2>/dev/null

echo "日志: $LOG_FILE"
