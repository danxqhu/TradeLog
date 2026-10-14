# TradeLog - 股票交易助手

## 项目概述

移动端 Web 股票交易助手，包含推荐追踪、量能分析、仓位管理、资讯抓取等功能。
技术栈：React 18 + Vite + Ant Design Mobile（前端）| Node.js + Express + Sequelize（后端）| MySQL 8.0（数据库）| Docker 部署。

部署架构复用 MealLog 服务器：共享 `meal-log-network` 网络，二级域名 `tradelog.meallog.eu.cc`，不映射宿主机端口。

---

## 快速启动（本地开发模式）

### 前置条件
- Node.js 18+
- Docker + Docker Compose（如果用容器开发）
- 或者本地有 MySQL 8.0

### 方式一：直接本地运行（推荐开发时使用）

```bash
# 1. 启动 MySQL（用 Docker 单独启动）
docker run -d --name tradelog-mysql-dev \
  -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=tradelog_password \
  -e MYSQL_DATABASE=tradelog_db \
  -e MYSQL_USER=tradeloguser \
  -e MYSQL_PASSWORD=tradelog_password \
  mysql:8.0

# 2. 启动后端
cd backend
cp .env.example .env
# 编辑 .env，把 DB_HOST 改为 localhost
npm install
npm run dev    # nodemon 热更新，端口 3001

# 3. 启动前端（新终端）
cd frontend
npm install
npm run dev    # Vite HMR 热更新，端口 5173
```

访问 http://localhost:5173 即可开发，前端修改自动热更新，后端修改也自动重启。

### 方式二：Docker Compose 开发模式

```bash
# 使用 override 文件启动开发环境（带热更新）
docker-compose -f docker-compose.yml -f docker-compose.override.yml up -d

# 前端：http://localhost:5173（Vite HMR）
# 后端：http://localhost:3001（nodemon）
# MySQL：localhost:3307
```

### 方式三：Docker Compose 生产模式

```bash
cp .env.example .env
# 编辑 .env 配置密码等
docker-compose -f docker-compose.yml up -d --build
```

---

## 项目目录结构

```
TradeLog/
├── docker-compose.yml              # 生产部署编排
├── docker-compose.override.yml     # 本地开发热更新层
├── .env.example                    # 环境变量模板
├── README.md                       # 本文档
│
├── frontend/                       # 前端 React 项目
│   ├── Dockerfile                  # 多阶段构建（production/development）
│   ├── nginx.conf                  # 业务侧 nginx 配置（纯 HTTP，API 代理到后端）
│   ├── vite.config.js              # Vite 配置（含 API 代理）
│   ├── package.json
│   └── src/
│       ├── main.jsx                # 入口
│       ├── App.jsx                 # 路由配置
│       ├── index.css               # 全局样式
│       ├── components/
│       │   └── Layout/
│       │       └── TabBar.jsx      # 底部四Tab导航（首页/自选/资讯/功能）
│       ├── pages/
│       │   ├── Home/               # 首页：机构按钮 + 实时成交额排行
│       │   ├── Watchlist/          # 自选股列表
│       │   ├── News/               # 资讯页（上证报 + 高盛研报 Tab）
│       │   ├── Features/           # 功能入口页（所有功能模块按钮）
│       │   ├── ChipDistribution/   # 筹码分布（开发中）
│       │   ├── Recommendation/     # 推荐管理
│       │   │   ├── index.jsx       #   早盘/午盘推荐列表 + 添加
│       │   │   ├── Detail.jsx      #   推荐详情 + 收益率统计 + 自定义天数
│       │   │   └── Calendar.jsx    #   日历视图（月历，前后翻月）
│       │   ├── Volume/             # 量能分析
│       │   │   ├── Analysis.jsx    #   30日量能平均值 + 历史对比
│       │   │   └── Realtime.jsx    #   实时放量/缩量（类似同花顺）
│       │   ├── Position/           # 仓位管理
│       │   │   ├── index.jsx       #   持仓列表 + 三种策略说明 + 新建
│       │   │   └── Strategy.jsx    #   仓位策略详情 + 加仓记录 + 提醒
│       │   ├── ShanghaiNews/       # 上海证券报每日股票
│       │   └── GoldmanSachs/       # 高盛研报列表
│       └── services/
│           └── api.js              # 所有 API 请求封装（axios）
│
├── backend/                        # 后端 Express 项目
│   ├── Dockerfile                  # 多阶段构建（production/development）
│   ├── package.json
│   ├── .env.example                # 后端环境变量模板
│   ├── database/
│   │   └── init.sql                # 数据库初始化（交易日历 2025-2026）
│   └── src/
│       ├── app.js                  # Express 入口（路由注册、数据库同步）
│       ├── config/
│       │   └── database.js         # Sequelize 数据库配置
│       ├── models/                 # 10 个 Sequelize 模型
│       │   ├── index.js            #   模型汇总 + 关联关系
│       │   ├── Stock.js            #   股票基本信息
│       │   ├── Recommendation.js   #   推荐记录（早盘/午盘）
│       │   ├── RecommendationTracking.js  # 推荐收益跟踪
│       │   ├── VolumeHistory.js    #   量能历史
│       │   ├── Position.js         #   持仓记录
│       │   ├── PositionConfig.js   #   仓位策略配置（含三种策略常量）
│       │   ├── PositionAddRecord.js #  加仓记录
│       │   ├── ShanghaiNews.js     #   上海证券报新闻
│       │   ├── ResearchReport.js   #   高盛研报
│       │   └── TradingCalendar.js  #   交易日历
│       ├── routes/                 # 7 个 API 路由模块
│       │   ├── stocks.js           #   /api/stocks - 股票 CRUD + 实时行情
│       │   ├── recommendations.js  #   /api/recommendations - 推荐 CRUD + 收益统计
│       │   ├── volume.js           #   /api/volume - 量能数据 + 30日均量 + 放量缩量
│       │   ├── positions.js        #   /api/positions - 持仓 + 加仓 + 策略 + 邮件提醒
│       │   ├── shanghaiNews.js     #   /api/shanghai-news - 上证报 CRUD
│       │   ├── researchReports.js  #   /api/research-reports - 研报 CRUD
│       │   └── calendar.js         #   /api/calendar - 交易日历 + 交易日计算
│       └── services/
│           ├── marketDataService.js # 市场数据服务（实时行情/均量/交易所数据）
│           ├── scheduler.js        # 定时任务调度
│           ├── stockDictionary.js  # 股票词典（DB加载+内存缓存+新闻识别）
│           ├── scraperService.js   # 上海证券报抓取服务
│           ├── emailService.js     # 163 SMTP 邮件服务（加仓提醒）
│           ├── tradingDayService.js # 交易日计算工具
│           └── stockDataService.js # 股票数据服务（当前模拟数据，预留真实API接口）
│
│   ├── scripts/                    # Python 抓取脚本
│   │   ├── fetch_exchange_daily.py # 交易所官方成交额抓取
│   │   ├── fetch_market_averages.py # 历史均量数据抓取
│   │   ├── import_exchange_daily.js # 交易所数据导入
│   │   └── import_averages.js      # 均量数据导入（合并+重算均线）
│
└── scripts/
    ├── deploy.sh                   # 一键部署脚本（服务器用）
    └── update.sh                   # 热更新脚本（支持 frontend/backend/all）
```

---

## API 接口清单

| 路径 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/stocks` | GET/POST | 股票列表（支持 `?search=` 模糊搜索）/新增 |
| `/api/stocks/realtime` | GET | 实时行情（新浪财经，支持 `?codes=603138,000001`） |
| `/api/stocks/:code` | GET/PUT/DELETE | 单只股票操作 |
| `/api/recommendations` | GET/POST | 推荐列表/新增 |
| `/api/recommendations/:id` | GET/PUT/DELETE | 推荐详情操作 |
| `/api/recommendations/:id/returns` | GET | 获取各周期收益率 |
| `/api/recommendations/:id/track` | POST | 记录收益 |
| `/api/recommendations/:id/calculate-returns` | POST | 自动计算收益率（只计算已到期的周期） |
| `/api/recommendations/:id/calculate-custom` | POST | 自定义天数收益率计算（按交易日） |
| `/api/volume` | GET/POST | 量能列表/新增 |
| `/api/volume/:code/avg30d` | GET | 30日平均量能 |
| `/api/volume/:code/realtime` | GET | 实时放量缩量 |
| `/api/positions` | GET/POST | 持仓列表/新建 |
| `/api/positions/:id` | GET/PUT | 持仓详情/更新 |
| `/api/positions/:id/add` | POST | 加仓 |
| `/api/positions/:id/close` | POST | 清仓 |
| `/api/positions/config` | POST | 配置仓位策略 |
| `/api/positions/:id/strategy` | GET | 获取仓位策略 |
| `/api/positions/:id/check-alert` | POST | 检查加仓提醒（发邮件） |
| `/api/positions/strategies/list` | GET | 所有策略类型 |
| `/api/shanghai-news` | GET/POST | 上证报列表/新增 |
| `/api/shanghai-news/dates` | GET | 有记录的日期列表 |
| `/api/shanghai-news/stock-dict` | GET | 获取股票库信息（数量、加载状态） |
| `/api/shanghai-news/refresh-stocks` | POST | 从新浪刷新全市场股票到 DB |
| `/api/shanghai-news/rescan` | POST | 重新扫描文章识别股票 |
| `/api/research-reports` | GET/POST | 研报列表/新增 |
| `/api/market/averages` | GET | 获取 MA20/MA60 均量数据 |
| `/api/market/averages-trend` | GET | 获取最近 60 个交易日 ma20/ma60 趋势 |
| `/api/market/exchange-daily` | GET | 交易所官方每日成交额 |
| `/api/calendar` | GET | 交易日历 |
| `/api/calendar/month/:year/:month` | GET | 某月日历 |
| `/api/calendar/trading-days/count` | GET | 计算交易日数 |
| `/api/calendar/trading-days/add` | GET | 加N个交易日 |
| `/api/calendar/init` | POST | 初始化某年交易日历 |

---

## 数据库表结构

10 张表，由 Sequelize 自动同步（`alter: true`）：
- `stocks` - 股票基本信息
- `recommendations` - 推荐记录（早盘/午盘）
- `recommendation_tracking` - 推荐收益跟踪（3天/7天/2周/1月/自定义）
- `volume_history` - 量能历史
- `positions` - 持仓记录
- `position_configs` - 仓位策略配置（矩形/金字塔/漏斗形）
- `position_add_records` - 加仓记录
- `shanghai_news` - 上海证券报新闻
- `research_reports` - 高盛研报
- `trading_calendar` - 交易日历（init.sql 预填 2025-2026 年数据）

---

## 部署架构（服务器端）

- 二级域名：`tradelog.meallog.eu.cc`
- 共享网络：`meal-log-network`（external）
- 服务名：`tradelog-frontend`、`tradelog-backend`、`tradelog-mysql`
- 总反向代理：`reverse-proxy` 独立目录，SSL 终止
- 不映射宿主机端口

### 服务器部署步骤
1. 推送代码到服务器
2. `cp .env.example .env` 并编辑
3. `./scripts/deploy.sh`
4. 在 `reverse-proxy/conf/` 添加 `20-tradelog.conf`
5. `cd reverse-proxy && docker-compose restart`
6. Cloudflare 添加 A 记录（橙色云朵）

---

## 环境变量说明

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `NODE_ENV` | 环境 | development |
| `PORT` | 后端端口 | 3001 |
| `DB_HOST` | 数据库地址 | tradelog-mysql |
| `DB_PORT` | 数据库端口 | 3306 |
| `DB_USER` | 数据库用户 | tradeloguser |
| `DB_PASSWORD` | 数据库密码 | tradelog_password |
| `DB_NAME` | 数据库名 | tradelog_db |
| `JWT_SECRET` | JWT 密钥 | - |
| `SMTP_HOST` | 邮件服务器 | smtp.163.com |
| `SMTP_PORT` | 邮件端口 | 465 |
| `SMTP_USER` | 发件邮箱 | - |
| `SMTP_PASS` | 授权码 | - |
| `SMTP_TO` | 收件邮箱 | - |

---

## 市场成交额数据源

系统有三种成交额数据来源，分别用于不同场景：

### 1. 实时成交额（新浪财经）

- **用途**：首页“A股全市场成交额”实时显示 + 每分钟快照记录
- **数据源**：新浪财经实时行情接口 `http://hq.sinajs.cn/list=sh000001,sz399001,bj899050`
- **代码位置**：`backend/src/services/marketDataService.js` → `fetchMarketData()`
- **采集方式**：后端定时任务每分钟调用，交易时段写入数据库 `market_snapshots` 表
- **数据内容**：上证 + 深证 + 北交所的实时成交额（元）、点位
- **注意**：新浪返回的是指数成交额，非全市场精确值，但实时性好

### 2. 交易所官方每日成交额（三大交易所官网 API）

- **用途**：首页"交易所公布A股成交额"卡片，含沪深明细和 MA20/MA60
- **数据库表**：`exchange_dailies`
- **代码位置**：`backend/scripts/fetch_exchange_daily.py`

#### 上交所 (SSE)

- **页面**：https://www.sse.com.cn/market/stockdata/overview/day/
- **API**：`https://query.sse.com.cn/commonQuery.do`
- **参数**：`sqlId=COMMON_SSE_SJ_GPSJ_CJGK_MRGK_C&PRODUCT_CODE=01,02,03,11,17&SEARCH_DATE=YYYY-MM-DD`
- **必须 Header**：`Referer: https://www.sse.com.cn/market/stockdata/overview/day/`
- **格式**：JSONP（需正则提取 JSON）
- **关键字段**：`PRODUCT_CODE=01` 主板A、`03` 科创板、`17` 合计；`TRADE_AMT` 成交金额（亿元）
- **调用方式**：通过 `curl` 子进程调用（Python requests 在此域名有 SSL 兼容问题）

#### 深交所 (SZSE)

- **页面**：https://www.szse.cn/market/overview/index.html
- **API**：`https://www.szse.cn/api/report/ShowReport/data`
- **参数**：`SHOWTYPE=JSON&CATALOGID=1803_sczm&txtQueryDate=YYYY-MM-DD`
- **格式**：纯 JSON
- **关键字段**：`lbmc` 证券类别（主板A股/创业板A股）、`cjje` 成交金额（亿元，带千分位逗号）
- **调用方式**：Python `requests.get()` 直接调用

#### 北交所 (BSE)

- **页面**：https://www.bse.cn/static/statisticdata.html
- **API**：`https://www.bse.cn/marketStatController/dailyReport.do`（POST）
- **现状**：该接口有 307 重定向循环，需要浏览器 session 才能访问
- **处理方案**：北交所占比极小（约 6 亿/天 vs 全A 19000 亿，占 0.03%），暂设为 0
- **备用方案**：如需精确数据，可用 Browser 子代理定期抓取

#### 脚本用法

```bash
# 增量模式：从指定日期之后抓取（日常刷新用，通常只抓 1 天）
python3 backend/scripts/fetch_exchange_daily.py --from-date 2026-10-12

# 指定天数：抓取最近 N 个交易日
python3 backend/scripts/fetch_exchange_daily.py --days 5

# 全量模式：抓取最近 80 个交易日（首次初始化用）
python3 backend/scripts/fetch_exchange_daily.py --full

# 导入数据库
node backend/scripts/import_exchange_daily.js
```

### 3. 历史均量成交额（交易所官网汇总）

- **用途**：首页"历史平均成交额"卡片（MA20/MA60）
- **数据库表**：`market_averages`
- **代码位置**：`backend/scripts/fetch_market_averages.py`
- **数据来源**：与上面相同，SSE + SZSE 官网 API（curl + requests）
- **计算方式**：Python 抓取原始数据 → Node.js 导入脚本合并新旧数据并重算 MA20/MA60

#### 脚本用法

```bash
# 增量模式：从指定日期之后抓取（日常刷新用，通常只抓 1 天）
python3 backend/scripts/fetch_market_averages.py --from-date 2026-10-12

# 导入数据库（自动合并已有数据 + 重算均线）
node backend/scripts/import_averages.js
```

#### 增量刷新流程

1. Node.js 查询 `market_averages` 表最新日期
2. 运行 Python 脚本 `--from-date <最新日期>` 只抓缺失的交易日
3. 导入脚本读取 DB 已有记录 + JSON 新记录 → 合并 → 重算 MA20/MA60 → 全量 upsert

---

## 定时任务一览

所有定时任务在 `backend/src/services/scheduler.js` 中配置，使用 **node-cron** 实现调度，显式指定时区 `Asia/Shanghai`。

### 成交额快照采集（交易时段每分钟 :05 秒）

| 时段 | cron 表达式 | 说明 |
|------|------------|------|
| 交易日 9:25:05 | `25,30-59 9 * * 1-5` | 集合竞价结果 + 9:30-9:59 每分钟 |
| 交易日 10:00:05–11:30:05 | `* 10-11 * * 1-5` | 上午盘每分钟（isTradingWindow 精确过滤到 11:30） |
| 交易日 13:00:05–14:59:05 | `* 13-14 * * 1-5` | 下午盘每分钟 |
| 交易日 15:00:05 | `0 15 * * 1-5` | 收盘采集 |
| 非交易时段 | — | cron 不触发，无需过滤 |

- **调度方式**：`node-cron`，6 字段 cron（含秒），timezone: `Asia/Shanghai`
- **时间戳规范**：优先使用行情数据源返回的原始业务时间戳（`marketDate` + `marketTime`），转为 UTC 存入 `collected_at` 字段；**禁止用 `new Date()` 作为主业务时间**
- **数据源**：新浪财经实时接口
- **写入表**：`market_snapshots`（新增 `collected_at` 列，UTC 时间戳）
- **前端刷新**：后端采集完成后通过 SSE 推送 `snapshot` 事件，前端收到后立即刷新（延迟 ~1-2 秒）
- **Docker 时区**：容器挂载宿主机 `/etc/localtime` + `/etc/timezone`（只读），Dockerfile 设置 `TZ=Asia/Shanghai`，不在容器内开 NTP

### 均量数据 + 交易所成交额刷新（交易日 1:00 + 17:00:05）

| 触发条件 | cron 表达式 | 说明 |
|----------|------------|------|
| 交易日 1:00 | `0 1 * * *` | 凌晨增量抓取前一交易日数据，重算 MA20/MA60 |
| 交易日 17:00:05 | `5 0 17 * * *` | 收盘后 2 小时抓取，确保交易所数据已发布 |

- **代码**：`runAvgRefresh()` + `runExchangeRefresh()`
- **写入表**：`market_averages` + `exchange_dailies`
- **前端刷新**：抓取完成后通过 SSE 广播 `averages` 事件，前端立即刷新均量数据 + 趋势图 + 交易所成交额
- **预计耗时**：约 1 分钟（只抓 1-2 个缺失日期）

### 上海证券报抓取（每天凌晨 3:00 和 6:00）

| 触发条件 | 说明 |
|----------|------|
| 每天 3:00 | 抓取当日上海证券报电子报 |
| 每天 6:00 | 补充抓取（确保不漏） |

- **代码**：`runScrape()` → `scraperService.scrapeAndSave()`
- **脚本**：`scraper/shanghai_news_scraper.py`

### 高盛研报抓取（每天 1:00、7:00、13:00、19:00）

| 触发条件 | 说明 |
|----------|------|
| 每 6 小时 | 抓取高盛官网最新研报 |

- **代码**：`runGSScrape()` → `gsScraperService.scrapeAndSaveReports()`

---

## 前端自动刷新逻辑

首页成交额数据的自动刷新由前端定时器控制，代码位置：`frontend/src/pages/Home/index.jsx`。

### 刷新频率规则

每次刷新完成后，都会重新判断当前处于哪个时段，然后决定下次刷新时间：

| 时段 | 刷新频率 | 说明 |
|------|----------|------|
| 交易时段（9:25、9:30-11:30、13:00-15:00） | 每分钟 XX:06 | 后端 XX:05 采集，前端延迟 5 秒刷新 |
| 午休（11:31-12:59） | 每 5 分钟 | 但如果距离 13:00 不足 5 分钟，直接等到 13:00:06 |
| 盘前（9:25 之前） | 每 5 分钟 | 同理，临近开盘直接跳到 9:25:06 |
| 收盘后（15:01 以后） | 每小时 XX:06 | 已收盘，无需频繁刷新 |
| 周末/节假日 | 每小时 XX:06 | 不交易 |

### 关键设计

- **动态判断**：每次调度时重新调用 `isTradingTime()` 判断是否在交易时段，而不是页面加载时判断一次。这样即使午休时打开了页面，下午开盘后也能自动切换到每分钟刷新。
- **开盘对齐**：午休/盘前时段如果距离开盘不足 5 分钟，直接等到开盘时刻（13:00:06 或 9:25:06），避免跨入交易时段后还在用低频刷新。
- **XX:06 秒触发**：所有刷新都在每分钟的第 6 秒触发，确保后端已完成采集（后端在 XX:01 左右采集）。
- **setTimeout 递归**：使用 setTimeout 递归而非 setInterval，每次重新计算等待时间，避免时间累积误差。

---

## 数据库表补充说明

除上述 10 张表外，还有以下市场数据表：

| 表名 | 说明 | 数据来源 |
|------|------|----------|
| `market_snapshots` | 每分钟成交额快照 | 新浪财经实时接口 |
| `market_averages` | 每日成交额 + MA20/MA60 | SSE + SZSE 官网 |
| `exchange_dailies` | 交易所官方分类成交额（沪主板A/科创板/深主板A/创业板） | SSE + SZSE 官网 |

---

## 股票库管理

### 架构说明

**数据库是唯一数据源**，所有股票数据统一存储在 `stocks` 表中。

| 组件 | 说明 |
|------|------|
| `stocks` 表 | 唯一数据源，存储全市场 A 股（代码、名称、市场） |
| 内存缓存 | 启动时从 DB 加载，用于新闻股票识别（`detectStocks`）快速匹配 |
| `stockDictionary.js` | 服务层：加载 DB → 内存、刷新股票库、识别新闻中的股票 |
| ~~`stock_dict.json`~~ | 已废弃，不再使用 |

### 数据流

```
刷新股票库 → 新浪 API 拉取全市场列表 → 写入 stocks 表 → 刷新内存缓存
                                                    ↓
                            ┌────────────────────┬──────────────────┐
                            │                          │                          │
                    新闻股票识别              推荐表单搜索            其他功能
                (detectStocks)            (GET /api/stocks?search)
```

### 刷新股票库

- **前端入口**：资讯页 → "刷新股票库" 按钮
- **API**：`POST /api/shanghai-news/refresh-stocks`
- **代码**：`stockDictionary.js` → `refreshDictionary()`
- **流程**：新浪 API 分页拉取 → `Stock.bulkCreate(ignoreDuplicates)` 写入 DB → 重新加载内存缓存
- **当前数据**：约 5572 只 A 股（沪/深/北三市）

### 股票搜索 API

```
GET /api/stocks?search=关键词&pageSize=15
```

- 支持按代码搜索（如 `6031`）或按名称搜索（如 `海量`）
- 使用 SQL LIKE 模糊匹配
- 用于推荐管理页面的添加股票搜索下拉框

### 新闻股票识别

- **代码**：`stockDictionary.js` → `detectStocks(text)`
- **匹配逻辑**：
  1. 手动关键词词典（40 只核心股票，支持简称变体如"茅台"→"贵州茅台"）
  2. 全市场股票名称精确匹配（从 DB 加载的 5572 只）
  3. 6 位数字代码匹配
- **使用场景**：抓取上海证券报文章时自动识别提及的股票

---

## 推荐管理系统

### 功能说明

管理早盘/午盘推荐记录，追踪推荐后各周期收益率。

### 页面结构

| 页面 | 路径 | 说明 |
|------|------|------|
| 推荐列表 | `/recommendation` | 早盘/午盘 Tab 切换，添加推荐 |
| 推荐详情 | `/recommendation/:id` | 股票信息 + 收益率统计 + 自定义天数 |
| 推荐日历 | `/recommendation/calendar` | 月历视图查看推荐 |

### 添加推荐流程

1. 点击"添加" → 弹出表单
2. **搜索股票**：输入代码或名称（至少 2 字符），300ms 防抖后调搜索 API
3. 下拉显示匹配结果，点击选中自动填入代码和名称
4. 选择日期、时间、输入推荐价格、备注
5. 保存 → `POST /api/recommendations` 写入 DB

### 收益率计算

- **API**：`POST /api/recommendations/:id/calculate-returns`
- **数据源**：新浪财经日K线 API（历史收盘价）
- **流程**：
  1. 获取实时价格（更新当前价格显示）
  2. 获取历史日K线数据（从推荐日期起）
  3. 对每个周期（3天/7天/2周/1月），计算目标日期（按交易日）
  4. 查找目标日期的**收盘价**，计算收益率
  5. 只计算目标日期已到期的周期
- **交易日计算**：依赖 `trading_calendar` 表（已预填 2026 全年数据，243 个交易日）
- **自定义天数**：`POST /api/recommendations/:id/calculate-custom`，同样使用历史收盘价

### 数据库表

| 表名 | 说明 |
|------|------|
| `recommendations` | 推荐记录（代码、名称、类型、来源、日期、时间、价格） |
| `recommendation_tracking` | 收益跟踪（周期类型、检查日期、检查价格、收益率、交易日数） |

---

## 交易日历

### 说明

`trading_calendar` 表存储每日是否为交易日，用于收益率计算等需要交易日运算的场景。

### 数据初始化

- **init.sql**：预填 2025-2026 年基础数据
- **当前数据**：2026 全年 365 天，其中 243 个交易日（已标注法定节假日）
- **节假日**：元旦、春节、清明、劳动节、端午、中秋、国庆（预估日期，以官方公布为准）

### 交易日计算 API

| API | 说明 |
|-----|------|
| `GET /api/calendar/trading-days/count?start=&end=` | 计算两日期之间的交易日数 |
| `GET /api/calendar/trading-days/add?start=&days=5` | 从某日期起加 N 个交易日 |

### 代码位置

- 服务层：`backend/src/services/tradingDayService.js`
- 路由：`backend/src/routes/calendar.js`
- 模型：`backend/src/models/TradingCalendar.js`

---

## 筹码分布（开发中）

- **页面路径**：`/chip-distribution`
- **功能入口**：功能页 → "筹码分布" 方块
- **计划数据源**：AKShare `stock_cyq_em` 接口（东方财富，免费）
- **计划功能**：个股筹码分布图、获利比例、平均成本、集中度等

---

## 待开发 / 已知待完善项

- [x] 上海证券报自动抓取（scraper/shanghai_news_scraper.py）
- [x] 股票库统一管理（DB 唯一数据源，5572 只 A 股）
- [x] 推荐管理系统（添加/详情/收益率计算）
- [x] 交易日历初始化（2026 全年 243 个交易日）
- [x] 实时行情接入（新浪财经 API）
- [ ] 筹码分布功能开发
- [ ] 用户认证系统（JWT）
- [ ] 前端 UI 细节调优

---

## 上海证券报抓取器

独立的 Python 脚本，自动抓取上海证券报电子报和中国证券网证券频道内容。

```bash
cd scraper
pip3 install -r requirements.txt

# 抓取当日
python3 shanghai_news_scraper.py --no-detail

# 抓取并推送到后端
python3 shanghai_news_scraper.py --push

# 抓取最近 3 天
python3 shanghai_news_scraper.py --days 3
```

输出 JSON 保存在 `scraper/output/`，每篇文章包含标题、版面、原文链接、提及的股票代码。

详细用法见 `scraper/README.md`。

---

## 本地开发启动

需要开两个终端窗口分别启动：

**终端 1 - 后端**

```bash
cd backend && node src/app.js
```

**终端 2 - 前端**

```bash
cd frontend && npm run dev
```

启动后访问 http://localhost:5173

> 注意：后端用 `node` 直启，不用 `npm run dev`（nodemon），避免多进程抢端口冲突。

---

## 本地开发常用命令

```bash
# 前端构建
cd frontend && npm run build

# 更新代码后重建 Docker 容器
./scripts/update.sh          # 全部重建
./scripts/update.sh frontend # 只更新前端
./scripts/update.sh backend  # 只更新后端

# 查看 Docker 日志
docker-compose logs -f tradelog-backend
docker-compose logs -f tradelog-frontend
docker-compose logs -f tradelog-mysql
```

## 部署验证与排查清单

### 时间校准验证

```bash
# 1. 容器内执行 date，应输出北京时间 CST
docker exec tradelog-backend date
# 期望输出: Wed Oct 14 09:30:00 CST 2026

# 2. 验证时区环境变量
docker exec tradelog-backend sh -c 'echo $TZ'
# 期望输出: Asia/Shanghai

# 3. 验证 /etc/localtime 挂载
docker exec tradelog-backend ls -la /etc/localtime
# 期望: 显示为只读挂载
```

### 调度器验证

```bash
# 4. 查看后端启动日志，确认 node-cron 任务已注册
docker logs tradelog-backend 2>&1 | grep "定时任务已启动"
# 期望: 包含 node-cron, 时区: Asia/Shanghai

# 5. 确认成交额快照任务已注册
docker logs tradelog-backend 2>&1 | grep "成交额快照"
# 期望: 交易时段 9:25/9:30-11:30/13:00-15:00（每分钟 :05 秒）

# 6. 交易时段观察采集日志
docker logs -f tradelog-backend 2>&1 | grep "成交额"
# 期望: 每分钟 :05 秒左右打印采集日志，包含 UTC 时间戳
```

### 时间戳规范验证

```bash
# 7. 查看最新快照的 collected_at 字段（应为 UTC 时间）
docker exec tradelog-mysql mysql -u tradeloguser -p tradelog_db \
  -e "SELECT snapshot_date, snapshot_time, collected_at FROM market_snapshots ORDER BY id DESC LIMIT 5;"
# 期望: collected_at 是 UTC 时间（比北京时间晚 8 小时）
```

### 上线前排查清单

| 序号 | 检查项 | 期望结果 | 状态 |
|------|--------|----------|------|
| 1 | 容器 `date` 输出 | 北京时间 CST | ☐ |
| 2 | `TZ` 环境变量 | `Asia/Shanghai` | ☐ |
| 3 | `/etc/localtime` 挂载 | 只读挂载成功 | ☐ |
| 4 | 后端启动日志 | 显示 node-cron + Asia/Shanghai | ☐ |
| 5 | 交易时段采集日志 | 每分钟 :05 秒触发 | ☐ |
| 6 | `collected_at` 字段 | UTC 时间（比北京时间晚 8h） | ☐ |
| 7 | SSE 事件流 | 前端控制台显示 "已连接后端事件流" | ☐ |
| 8 | 前端数据刷新 | 后端采集后 1-2 秒内页面更新 | ☐ |
| 9 | 非交易时段 | 无采集日志，无无效请求 | ☐ |
| 10 | 周末/节假日 | 自动跳过，不采集 | ☐ |
