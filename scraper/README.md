# 上海证券报抓取工具

## 快速开始

```bash
# 安装依赖
pip3 install -r requirements.txt

# 抓取当日（仅列表，不抓详情）
python3 shanghai_news_scraper.py --no-detail

# 抓取当日（含文章详情和股票代码提取）
python3 shanghai_news_scraper.py

# 抓取并推送到后端 API（需要先启动后端）
python3 shanghai_news_scraper.py --push

# 抓取指定日期
python3 shanghai_news_scraper.py --date 2026-10-10

# 抓取最近 3 天
python3 shanghai_news_scraper.py --days 3

# 控制详情抓取数量（默认20篇，避免太慢）
python3 shanghai_news_scraper.py --max-detail 10
```

## 数据来源

| 来源 | URL | 说明 |
|------|-----|------|
| 电子报 | `paper.cnstock.com` | 按版面分类，有原文链接 |
| 证券频道 | `cnstock.com/channel/10232` | 最新证券新闻，有原文链接 |

## 输出

- JSON 文件保存在 `output/` 目录，文件名格式 `shanghai_news_YYYYMMDD_HHMM.json`
- 每篇文章包含：标题、版面、原文链接、发布日期、内容摘要、提及的股票代码

## 推送到后端

使用 `--push` 参数时，脚本会调用后端 API：
```
POST http://localhost:3001/api/shanghai-news
```

需要确保后端服务已启动。

## 定时运行（可选）

macOS 可以用 crontab 设置每日自动运行：
```bash
# 每个交易日早上 8:30 自动抓取
crontab -e
# 添加：
30 8 * * 1-5 cd /path/to/TradeLog/scraper && python3 shanghai_news_scraper.py --push >> /tmp/tradelog_scraper.log 2>&1
```

## 依赖

- Python 3.8+
- requests
- beautifulsoup4
- lxml
