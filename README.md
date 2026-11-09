# TradeLog - 股票交易助手

## 项目概述

移动端 Web 股票交易助手，包含推荐跟踪、量能分析、仓位管理、资讯抓取、每日追资金（板块资金流→候选股自动打分）等功能。
技术栈：React 18 + Vite + Ant Design Mobile + ECharts（前端）| Node.js + Express + Sequelize（后端）| MySQL 8.0（数据库）| Python3 + AKShare/pandas（数据抓取与打分脚本）| Docker 部署。

部署架构复用 MealLog 服务器：共享 `meal-log-network` 网络，二级域名 `tradelog.meallog.eu.cc`，不映射宿主机端口。

---

## 快速启动（本地开发模式）

### 前置条件
- Node.js 20.18+（Docker 镜像已固定为 node:20.18-alpine）
- Docker + Docker Compose（如果用容器开发）
- 或者本地有 MySQL 8.0
- 跑「每日追资金」及成交额抓取时需本机 Python 3 + `pip3 install akshare pandas numpy requests beautifulsoup4 lxml jieba pymysql`（Docker 开发模式镜像内没装 Python）

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
│       │   ├── GoldmanSachs/       # 高盛研报列表
│       │   └── MoneyChase/         # 每日追资金（板块资金流 → 候选股 → A/B 池打分）
│       │       ├── index.jsx        #   主页面：板块/成分股确认/批次进度/候选列表/红线展示
│       │       ├── KlineChart.jsx   #   日 K 线 + 均线/道氏/斐波那契/背离/颈线标注
│       │       ├── CandidateDetail.jsx # 单只票打分细则 + 红线原文 + 人工复核
│       │       ├── RulesPanel.jsx   #   规则全文展示与可调（单一真源）
│       │       └── SchedulePanel.jsx #  定时节点增删改（默认 09:50 / 10:00）
│       └── services/
│           └── api.js              # 所有 API 请求封装（axios）
│
├── backend/                        # 后端 Express 项目
│   ├── Dockerfile                  # 多阶段构建（production/development）
│   ├── package.json
│   ├── .env.example                # 后端环境变量模板
│   ├── config/
│   │   └── money_chase_rules.json  # 每日追资金规则单一真源（含所有可调数值）
│   ├── database/
│   │   └── init.sql                # 数据库初始化（交易日历 2025-2026）
│   └── src/
│       ├── app.js                  # Express 入口（路由注册、数据库同步）
│       ├── config/
│       │   └── database.js         # Sequelize 数据库配置
│       ├── models/                 # Sequelize 模型（22 张表，见下方数据库表结构）
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
│       │   ├── TradingCalendar.js  #   交易日历
│       │   ├── MoneyChaseRun.js    #   追资金：批次运行记录（进度/统计/失败原因）
│       │   ├── MoneyChaseCandidate.js # 追资金：候选股打分结果 + 画图用的 K 线数据（实时口径，会被后续走势推翻）
│       │   ├── MoneyChaseSnapshot.js  # 追资金：定格快照（按选定时间点定格的评估存档，不重算，与上行不是一回事）
│       │   ├── MoneyChaseRule.js   #   追资金：规则表（文件播种 + 页面可改）
│       │   ├── MoneyChaseSchedule.js #  追资金：定时节点
│       │   └── MoneyChaseManualStock.js # 追资金：人工加/减股票偏好（跨批次继承）
│       ├── routes/                 # API 路由模块
│       │   ├── stocks.js           #   /api/stocks - 股票 CRUD + 实时行情
│       │   ├── recommendations.js  #   /api/recommendations - 推荐 CRUD + 收益统计
│       │   ├── volume.js           #   /api/volume - 量能数据 + 30日均量 + 放量缩量
│       │   ├── positions.js        #   /api/positions - 持仓 + 加仓 + 策略 + 邮件提醒
│       │   ├── shanghaiNews.js     #   /api/shanghai-news - 上证报 CRUD
│       │   ├── researchReports.js  #   /api/research-reports - 研报 CRUD
│       │   ├── moneyChase.js       #   /api/money-chase - 每日追资金（板块/成分/打分/规则/定时）
│       │   └── calendar.js         #   /api/calendar - 交易日历 + 交易日计算
│       └── services/
│           ├── marketDataService.js # 市场数据服务（实时行情/均量/交易所数据）
│           ├── moneyChaseService.js # 每日追资金（规则播种/Python 调度/结果入库）
│           ├── scheduler.js        # 定时任务调度（含追资金节点热更新）
│           ├── stockDictionary.js  # 股票词典（DB加载+内存缓存+新闻识别）
│           ├── scraperService.js   # 上海证券报抓取服务
│           ├── emailService.js     # 163 SMTP 邮件服务（加仓提醒）
│           ├── tradingDayService.js # 交易日计算工具
│           └── stockDataService.js # 股票数据服务（当前模拟数据，预留真实API接口）
│
│   ├── scripts/                    # Python 抓取脚本
│   │   ├── fetch_exchange_daily.py # 交易所官方成交额抓取
│   │   ├── fetch_market_averages.py # 历史均量数据抓取
│   │   ├── fetch_money_chase.py     # 每日追资金（板块资金流/成分股/日线打分）
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
| `/api/money-chase/sectors` | GET | 行业板块资金流 Top N（异步脚本，失败返 `ok:false`+中文原因） |
| `/api/money-chase/constituents?sectors=` | GET | 指定板块成分股（按今日涨幅降序，含 ST/板块标记） |
| `/api/money-chase/manual-stocks` | GET/POST | 人工加/减股票偏好清单 / 调整（`op_type: add\|remove`） |
| `/api/money-chase/run` | POST | 发起打分批次（异步，立即返 `runId`，前端轮询进度） |
| `/api/money-chase/runs` | GET | 历史批次列表 |
| `/api/money-chase/runs/:id/status` | GET | 批次进度/统计/失败原因 |
| `/api/money-chase/runs/:id/candidates` | GET | 批次候选股（附高亮分数线） |
| `/api/money-chase/candidates/:id/kline` | GET | 单只票 K 线快照与标注 |
| `/api/money-chase/candidates/:id` | PUT | 人工勾选/淘汰/选中/备注（自动重算总分） |
| `/api/money-chase/stock/:symbol/analysis` | GET | 单票具体分析（`?force=1` 不走缓存；响应附带 `baseline_snapshot` / `snapshot_count`） |
| `/api/money-chase/snapshots?symbol=` | GET/POST | 该票全部定格快照摘要（只查库）/ 按 `{symbol, as_of_date, as_of_time?, overwrite?, set_baseline?}` 生成定格快照（不传时刻=收盘口径；同时间点已有旧存档时先返 `{ok:false, conflict:true}` 不请求接口，人工确认后带 `overwrite:true` 才覆盖；默认不抢基准） |
| `/api/money-chase/snapshots/:id` | GET/DELETE | 快照全文（含当时口径的 K 线/分时，只查库）/ 删除一份快照 |
| `/api/money-chase/snapshots/:id/baseline` | PUT | 把这份快照设为基准（每只票只保留一条基准） |
| `/api/money-chase/rules` | GET/PUT | 规则全文（分组）/ 保存页面修改 |
| `/api/money-chase/rules/reset` | POST | 恢复出厂值（全部或指定 key） |
| `/api/money-chase/rules/reseed` | POST | 从 `config/money_chase_rules.json` 重新同步（人工改过的值不被覆盖） |
| `/api/money-chase/rules/effective` | GET | 当前真正下发给脚本的参数与开关（排查“改了没生效”） |
| `/api/money-chase/schedules` | GET/POST | 定时节点列表 / 新增（保存即热更新 cron） |
| `/api/money-chase/schedules/:id` | PUT/DELETE | 修改 / 删除节点 |
| `/api/money-chase/schedules/:id/trigger` | POST | 按该配置立即跑一次（验证配置用） |
| `/api/calendar` | GET | 交易日历 |
| `/api/calendar/month/:year/:month` | GET | 某月日历 |
| `/api/calendar/trading-days/count` | GET | 计算交易日数 |
| `/api/calendar/trading-days/add` | GET | 加N个交易日 |
| `/api/calendar/init` | POST | 初始化某年交易日历 |

---

## 数据库表结构

由 Sequelize 自动同步（**未开 `alter`**）：新表会自动创建，但**已有表新增列需手动 `ALTER TABLE`**，项目里统一写在 `backend/src/app.js` 的 `testConnection()` 里做启动检测补列。

> 启动建表是**逐表 `model.sync()`**（不是整体 `sequelize.sync()`）：`sync()` 内部串行，某张表的 `CREATE TABLE` 报错（例如 ENUM 取值列表里写了 `null`）会直接抛出并**跳过后面所有表**，
> 页面就会报 "Table xxx doesn't exist" 却看不出原因。改成逐表后，哪张表失败会在启动日志里单独打 `❌ 建表失败 模型名（表名）: 具体 SQL 错误`，其余表照常创建。

> ⚠️ **`sync()` 不会修改已有表的列定义**（只 `CREATE TABLE IF NOT EXISTS`）。改 model 里的 `STRING(n)` 长度对老表完全无效，必须显式 `ALTER TABLE ... MODIFY COLUMN`。
> 踩过的坑：`money_chase_rules.code` 原为 `VARCHAR(20)`，而 `param:single_call_timeout_sec` 这类键名有 22～26 字符，播种第 4 行就抛 `Data too long for column 'code'`，
> **整轮 seedRules 被截断**——表里只剩 3 条参数，页面规则面板/红线速览/人工复核项几乎全空，脚本则一路按出厂默认值跑，且没有任何提示。
> 现在：model 放宽到 `STRING(60)`，`moneyChaseService.alignRuleColumns()` 在播种前查 `information_schema` 幂等补列宽，`seedRules()` 逐条 `try/catch` 并把 `failed` 清单返到日志（补齐后实测 107 条规则全部在表）。

主要表：
- `stocks` - 股票基本信息
- `recommendations` - 推荐记录（早盘/午盘）
- `recommendation_tracking` - 推荐收益跟踪（3天/7天/2周/1月/自定义）
- `volume_history` - 量能历史
- `positions` - 持仓记录
- `position_configs` - 仓位策略配置（矩形/金字塔/漏斗形）
- `position_add_records` - 加仓记录
- `shanghai_news` - 上海证券报新闻
- `news_stock` - 新闻↔股票关联表
- `research_reports` - 高盛研报
- `trading_calendar` - 交易日历（init.sql 预填 2025-2026 年数据）
- `market_snapshots` / `market_averages` / `exchange_dailies` - 成交额快照/均量/交易所官方数据
- `users` / `email_configs` / `system_configs` - 用户认证/邮件配置/系统配置
- `money_chase_runs` / `money_chase_candidates` / `money_chase_rules` / `money_chase_schedules` / `money_chase_manual_stocks` / `money_chase_snapshots` - 每日追资金（见下文章节；`money_chase_snapshots` = 定格快照存档，`symbol + snapshot_date + snapshot_time` 唯一）

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

> **注意**：Backend Dockerfile 基础镜像固定为 `node:20.18-alpine`（Node 20 LTS）。
> Node 20 已原生支持 `File`/`Blob` 等 Web API，无需 `--experimental-fetch` 参数。
> 之前使用 `node:18-alpine` 时，因镜像内 Node 小版本较老，`undici` 库会报
> `ReferenceError: File is not defined`，升级到 Node 20 后此问题已彻底解决。

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
- **数据来源**：优先 AKShare（`fetch_sse_akshare` / `fetch_szse_akshare`）；AKShare 异常时回退到 SSE/SZSE 官网 API（curl + requests）
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

### 每日追资金定时节点（默认 09:50 / 10:00，页面可自由增改）

| 项 | 说明 |
|----|------|
| 存储 | `money_chase_schedules` 表（时间/标签/取板块方式/TopN/固定板块/启用/仅交易日） |
| cron | `5 分 时 * * 1-5`（6 字段，秒位 :05），timezone `Asia/Shanghai` |
| 热更新 | 页面保存后调 `reloadMoneyChaseSchedules()`：先用 Map 持旧句柄逐个 `task.stop()` 再按表重建，**不需重启后端** |
| 非交易日 | `trading_day_only=true` 时用 `marketDataService.isTradingDay()` 过滤跳过 |
| 失败留痕 | 定时链路先建 `status:'pending'` 批次行，任一步失败（板块/成分股/候选为空）就把中文原因写进同一行，页面可见 |
| 启动初始化 | `ensureDefaultSchedules()`：表为空时按规则文件 `schedules_default` 建 09:50 / 10:00 两个节点 |

- **代码**：`backend/src/services/scheduler.js` → `runMoneyChaseNode()` / `reloadMoneyChaseSchedules()`
- **入口**：`backend/src/app.js` 启动时先 `seedRules()` + `ensureDefaultSchedules()`，再 `startScheduler()`

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

## 每日追资金（MoneyChase）

- **页面路径**：`/money-chase`（功能页 → 「每日追资金」方块）；单票具体分析 `/money-chase/stock/:symbol`（**点股票名字进入**）
- **定位**：日线批量筛选 + 自动打分的**辅助决策**工具。不做盘中实时盯盘、不自动下单、不做自动止盈止损，所有买卖决策由人工完成；分时只在单票分析页画给人工看，脚本不据分时判定。

### 业务流程

1. **板块资金流**：东方财富行业板块主力净流入排名，默认取前 3 个（`top_sectors`），页面展示 Top5（`sector_display_count`）供手工改勾，也可直接手输板块名（东财口径与同花顺所见可能不同，脚本会做模糊匹配并给建议）
2. **成分股**：所选板块成分股按**今日涨幅降序**列出，人工加/减股票后确认送入打分（偏好写入 `money_chase_manual_stocks`，跨批次自动继承）
   - **人工清单常驻展示**：第 ② 区的列表不依赖成分股接口——没取到成分股时，就直接把 `money_chase_manual_stocks` 里的加入/剔除记录逐只列出来（没行情数据时栏位写“未取到实时行情”而不是 0），加入的股票不会因为接口不可用而“消失”
   - **板块接口不可用时的兜底打分**：没勾板块、只有人工自选清单时，点「开始筛选打分」会走 `--symbols` 路径（不取成分股），且脚本里板块资金流改为软失败（`fetch_sector_flow(now, soft=True)`）：取不到只记 `meta.warnings`（批次摘要里 ⚠️ 列出），板块共振/退潮相关判定按数据缺失计，逐只打分照常入库
   - **剔除不丢加入记录**：`remove` 只新增一条 remove 行，**不删** add 行（`applyStockPrefs` 里 remove 优先于 add），因此误剔除后点「恢复」能回到人工清单
3. **打分分流**：Python 脚本逐只取 120 根前复权日线 + **运行当下的实时快照**，合成「当日未收盘 K 线」（`merge_live_bar`）后计算指标；按道氏 20 日三段 HH/HL 判定 → **A 上升趋势池 / B 超跌反弹池**
4. **入库展示**：结果写 `money_chase_candidates`（含 K 线快照），前端每 2 秒轮询 `/runs/:id/status` 显进度条（本功能不用 SSE）
5. **单票具体分析**（点股票名，`GET /api/money-chase/stock/:symbol/analysis`）：走脚本 `--action analyze`，**复用 `run_score` 同一条流水线**（JS 里不重写任何规则），因此判定口径与批次打分完全一致
   - **不依赖批次，也不需先跑批次**：分析完 `saveAnalyzeResult` 会自动把结果落成这一票自己的打分记录（挂在当日一个 `sector_source='manual_input'` 的专用批次行上，一只票一天一行、重复分析就地更新），所以人工勾选 / 备注 / 选中 / 淘汰**当场就能保存**；创建时从当天已有的打分行带过来人工态（脚本只负责重算分，不洗掉人勾的东西）
   - **加入候选即自动打分**：`POST /manual-stocks` 带 `add` 时，后台对刚加入的那几只各跑一次分析（每只 3 次请求、只间 1.5 秒、不重试），HTTP 秒返不等它；分数随后由 `GET /stocks/latest-scores` 回到② 清单小字里（只查库）
   - **请求预算**：日线 1 次 + 快照 1 次 + 分时 1 次（均走新浪、均不重试），共 3 次；东财只保留给板块资金流与成分股
   - **后端缓存**：盘中 60 秒、收盘后 10 分钟（`analyzeCache`），反复点名字不会重复打接口；页面明写“命中缓存 N 秒前”与「重新分析（不走缓存）」按钮
6. **定格快照 vs 实时追踪（两套判定口径，各回答一个问题）** —— 只有后者会看不到当初的选股依据，所以两者必须并存：
   - 📌 **定格快照**（表 `money_chase_snapshots`，脚本 `--action snapshot --as-of YYYY-MM-DD [--as-of-time HH:MM]`）：把 K 线截到选定时间点（盘中口径再用分时还原“当日未收盘临时 K”）跑**同一条 `run_score` 流水线**，结果（归类/逐项打分/红线/指标/当时人工勾选与备注/当时口径的 K 线与分时）固定存档。之后新增 K 线**不会重算、不会推翻**，回答「我当时为什么看上它」，供归档、复盘、回测
   - 🔄 **实时最新评估**（`money_chase_candidates` + 分析页「重新分析（不走缓存）」）：永远用最新 K 线重跑，回答「它现在变成什么样」，用来提示是否转强升级 / 走坏降级 / 触发红线，辅助离场与调仓决策；**它不回头改快照**
   - **录入即自动固化基准**（`ensureEnterSnapshot` / `attachBaselineSnapshot`）：该票没有基准快照时，直接把录入/分析那一次的结果写成基准（`source='auto_enter'`，**0 额外请求**）；**已有基准绝不覆盖**，也不重算。
   - **多份并存 + 不自动覆盖**：盘中一份、当日收盘一份、后续按任意时间点手动生成的（`source='manual'`）**全部保留**，方便回溯当时选股逻辑；`symbol + snapshot_date + snapshot_time` 只留一份，但重生成同一时间点时 `createSnapshot` **先查本地库**（连行情接口都不请求）直接返 `conflict`，前端弹窗问「覆盖重生成 / 保留原样」，只有人工确认才带 `overwrite=true` 改写旧存档；基准由人工自由切换（`PUT /snapshots/:id/baseline`），新生成的一份**不会静默挤掉录入基准**（只有该票原本没基准时才顶上），删基准时自动顶上最新一份
   - **两种口径**：不填时刻 = 当日收盘定型 K（稳定、可回测，**推荐做存档**，只请求 1 次日线）；填 `HH:MM` = 盘中临时 K（当日 K 未收盘，指标存在变动风险，页面必须标警示；日线 1 + 分时 1~2 次）
   - **能力边界**：新浪分时的可取范围实测——1 分钟（`datalen=250`）≈ 最近 1 个交易日，5 分钟（`datalen=330`）≈ 最近 7 个交易日；超出范围/非交易日/停牌直接中文报错，**不静默降级**成收盘口径。5 分钟精度时可能只切到 09:55（选定 10:00），量能折算按**实际截断时刻**算，页面写明 `actual_time` 与分时精度
   - **请求预算**：生成快照才会请求外部接口（收盘 1 次、盘中 2~3 次，均不重试，且不请求板块资金流与筹码）；列出 / 切换基准 / 删除 / 看当时的图全部只查本地库，**0 外部请求**

> 所有打分入口（页面“开始筛选”、整板块直接跑、定时节点、“立即跑一次”）都是 **先建批次行、立即返 runId**，
> 耗时的板块/成分股抓取全部在后台走（`startRunWithPrefetch` → `prepareAndScore`），因此 HTTP 不会卡 1-2 分钟。
> 服务重启会打断内存里的批次，启动时 `cleanupStaleRuns()` 会把残留的 `running`/`pending` 行标为“服务重启中断”，避免永久阻塞新批次。

> ⚠️ 趋势判定用的是**运行那一刻的实时价**，所以 09:50 跑和 10:00 跑结果会不同；盘中运行时当日量能只累计了一部分，所有量能判定用按已交易时间折算的全天估算量 `est_volume`（同时保留原始累计量供人工核对）。

### 两个池与持仓规则

| 池 | 准入条件 | 自动满分 | 高亮门槛 | 持仓逻辑 |
|----|---------|---------|---------|---------|
| A 上升趋势票 | 道氏 20 日三段高点抬升 + 低点抬升（HH/HL） | 8 | 总分 ≥ 7 | 灵活持仓，优先 2～3 天；趋势强劲可 4～5 天；沿均线与结构移动止盈，不强制隔日清仓 |
| B 超跌反弹票 | 非上升趋势，但满足超跌 + 止跌 + 放量启动 | 7 | 总分 ≥ 6 | 赔率高但是反弹博弈，优先 1～2 天；尽量不拖到 4～5 天；靠近压力位主动兑现 |

**总分公式**：总分 = 自动分（A 满分 8 / B 满分 7）+ 人工勾选数 × `manual_score_per_item`（上限 `manual_score_max`）；触发任一红线（自动判定或人工确认）直接淘汰，不计分数。

### 红线清单（触发任意一条直接淘汰）

页面会在三处完整展示：① 列表行内写明「🚫 触发 X_Rn：原文 + 具体数值」；② 单只票详情展开红线原文；③ 页面底部「判定规则速览」常驻全量清单。

| 编号 | 内容 | 判定方式 |
|------|------|---------|
| A_R1 | 日线明确顶背离 + 高位放量滞涨 | auto：60 日内两段价新高但 DIF 未创新高，且折算量 ≥ 均量×2 而涨幅 ≤ 1% 或收阴 |
| A_R2 | 已走出头肩顶、M 头等成熟反转形态 | semi：脚本启发式预警双顶（两高点差 < 3% 且颈线已跌破）；头肩顶等复杂形态需人工 |
| A_R3 | 关键均线被有效跌破，结构破坏 | auto：现价低于 MA20 且偏离 > 2%，或现价 < MA30，或 MA20 由升转降 |
| A_R4 | 盘中不满足分时、涨幅规则 | semi：自动判今日涨幅超阈值即不追；分时形态（拉升节奏/封单/量能分布）仍需人工在同花顺复核 |
| B_R1 | 持续创新低 + 放量杀跌，处于破位杀跌初期，暂不纳入 B 池 | auto：**三个条件同时成立**才淘汰 —— ① 近 `b_r1_new_low_window`（10）根内创 60 日新低 ≥ `b_r1_new_low_min_count`（2）次；② 窗口内阴线均量 ≥ `b_r1_down_vol_ratio`（1.2）×均量，或放量破位距今 ≤ `b_fresh_break_days`（3）天；③ 现价距 60 日最低 > `b_dist_to_low_max`（15%）。只满足③（已止跌、不再创新低）不再淘汰，改为普通预警展示 |
| B_R2 | 上方密集套牢峰很近，反弹马上就到抛压区 | semi：东财 `stock_cyq_em` 近似 90% 筹码上沿距现价 < 5%（非同花顺 Level2，仅供参考，最多查 `chip_probe_limit` 只）；最终人工确认 |
| B_R3 | 无量拉升、虚放量，板块资金快速退潮 | auto：涨幅 > 2% 但折算量 < 均量×0.8，或板块今日净流入 < 近 5 日均值/由正转负 |
| B_R4 | 盘中不满足分时、涨幅限制 | semi：自动判今日涨幅超阈值（反弹票涨太多赔率已失）；分时形态人工复核 |
| B_R5 | 属于下跌中继，不断创新低，无止跌信号 | auto：近 5 日创 20 日新低次数 ≥ 3，或今日仍创 20 日新低，或现价 < MA5 且 MA5 斜率向下 |

### 规则单一真源（“改文件”与“改页面”都能生效）

**唯一文件**：`backend/config/money_chase_rules.json`（含定位、池定义、15 个打分项、**9 条红线**、8 个人工复核项、**63 个可调参数**、K 线标注、展示规则、能力边界）。当前 `version` 1.2.1：`snapshot_note` 补快照多份并存与不自动覆盖策略（同时间点重生需人工确认，新快照不静默抢基准）。上一版 1.2.0：`positioning` 新增 `snapshot_note`（定格快照 vs 当前最新评估两套口径的职责划分），请求预算/展示规则/能力边界补快照相关说明。再上一版 1.1.0：红线 B_R1 改为三条件同时成立才淘汰（只过滤还在持续杀跌的票，不再误杀已止跌反弹的票）。无新增可调参数，仍是 63 个。

闭环链路：

```
config/money_chase_rules.json
   →（启动播种 seedRules / 页面「从文件重新同步」）→ money_chase_rules 表
   →（页面规则面板全文展示 + 可编辑）→ 后端拍平 {params, enabled} 写临时 JSON
   → fetch_money_chase.py 仅读下发参数（脚本内不硬编码任何阈值）
```

- **改页面**：规则面板直接改数值/开关/分值 → 保存 → **下次运行即生效，无需重启后端**；改过的行 `is_custom=true`，播种时**不会被文件覆盖**，单项可「恢复默认」
- **改文件**：编辑 JSON 的 `params.*.value`（或红线 `detect` 文案）→ 页面点「从文件重新同步」或 `POST /api/money-chase/rules/reseed`；未被人工改过的项会跟随文件
- **版本提示**：文件 `version` 与表内 `source_version` 不一致时，页面顶部会提示差异
- **排查入口**：`GET /api/money-chase/rules/effective` 看当前真正下发给脚本的参数与开关
- **部署注意**：生产镜像已 `COPY config ./config`；开发 override 已挂载 `./backend/config` 与 `./backend/scripts`（改脚本不需 rebuild）

### 脚本健壮性约定（产品硬性要求）

- **数据源默认新浪**（`params.kline_source`，页面规则面板可切成 `em`）：日线走 `CN_MarketData.getKLineData`（`scale=240`），实时快照走 `hq.sinajs.cn/list=`（50 只/次批量，需带 Referer 且返回 gbk），1 分钟分时走 `CN_MarketDataService.getKLineData`（`money` 域名的 `scale=1` 会返回 null，必须用 `quotes.sina.cn`）。东财只保留给板块资金流与成分股——那两个接口没有新浪等价物。注意新浪 `volume` 单位是**股**、东财日线是**手**，脚本里统一除以 100。
- 每个外部接口**只调用 1 次**，绝不自动重试、绝不退避循环（避免被封 IP）
- 单票具体分析请求预算 = **3 次**（日线 1 + 快照 1 + 分时 1），并且后端有 `analyzeCache`：盘中 60 秒、收盘后 10 分钟内重复点同一只票**不会再请求接口**；页面明写数据源、本次是命中缓存（N 秒前）还是实打实请求了，以及「重新分析（不走缓存）」按钮
- 失败立即中止，stdout 输出 `{ok:false, action, error, error_detail}`（中文原因），后端落库 `money_chase_runs.error_msg`
- 前端**弹窗**展示原因并提供「重试」按钮，由人工决定何时重试（弹窗文案会明写“脚本不会自动重试”）
- 逐只请求之间用 `pace()` 节流；单只票日线失败不中断整批，进 `skipped` 清单并在页面展示原因
- 接口列名用 `pick_col` 动态匹配（防上游改名），缺关键列直接中文报错而不是默默跑错
- **下发给 Python 的临时文件（`mc_params_*.json` / `mc_rules_*.json` / `mc_result_*.json`）写在 `os.tmpdir()/tradelog-money-chase`，不放 `backend/data/`**：
  dev 模式 `npx nodemon src/app.js` 监视 backend 整个目录，一旦往 `data/` 写文件就重启后端，正在处理的 HTTP 请求被 reset（表现为 `curl` 拿到 `HTTP 000` / exit 52）、子进程 Python 被杀、批次永远没结果，而且进程被杀前来不及 `unlink` 会残留文件。这个坑比看起来严重得多，改代码时不要退回 `data/`。

#### 超时链路（为何这样设计）

| 环节 | 上限 | 位置 |
|------|------|------|
| Python 子进程（板块/成分股） | 90s（超时 SIGTERM，返中文“超过 90 秒未返回，已中止”） | `moneyChaseService.js` → `fetchConstituents()` |
| 打分批次 | `run_timeout_sec`（默认 900s） | 同上 → `launchScore()` |
| 业务 HTTP | 秒返回 runId | `routes/moneyChase.js` → `/run`、`/schedules/:id/trigger` |
| 容器内 nginx | `/api/money-chase/` 读超时 150s | `frontend/nginx.conf` |
| 总反向代理 | `/api/money-chase/` 读超时 150s | `reverse-proxy/conf/20-tradelog.conf` |
| Cloudflare（橙色云朵） | 免费计划约 100s，不可调 | 所以后端必须 **在 90s 内自己超时**，不能依赖 nginx/CF 断开 |

### 代码位置

| 层 | 文件 |
|----|------|
| 规则真源 | `backend/config/money_chase_rules.json` |
| Python 抓取+打分 | `backend/scripts/fetch_money_chase.py`（`--action sectors\|constituents\|score\|analyze\|snapshot`，进度写 stderr `[PROGRESS] done total stage`；`analyze` 直接复用 `run_score`，只是 `symbols` 只传 1 只；`snapshot` 也是复用 `run_score`，额外接收 `--as-of` / `--as-of-time` / `--name`，在 `run_score` 内走快照分支：不请求板块资金流、用 `sina_minutes_day` + `build_asof_spot` 还原当日临时 K，判定口径与批次完全一致） |
| 服务层 | `backend/src/services/moneyChaseService.js`（`execFile` 异步 spawn、进度节流、规则播种 + `alignRuleColumns`、`analyzeCache` 单票缓存、`ensureSingleRun`/`saveAnalyzeResult` 自动落库、`queueAutoAnalyze` 加入即打分、`withCandidateContext` 关联打分行与人工复核项（附带 `baseline_snapshot`/`snapshot_count`）、定格快照一组：`writeSnapshot`/`ensureEnterSnapshot`/`attachBaselineSnapshot`/`createSnapshot`/`listSnapshots`/`getSnapshot`/`setBaselineSnapshot`/`deleteSnapshot`、人工分复算、`autoRun` 定时链路） |
| 路由 | `backend/src/routes/moneyChase.js` → 挂载为 `/api/money-chase`（业务失败统一 HTTP 200 + `{ok:false, error}`）；单票分析 `GET /stock/:symbol/analysis`、分数摘要 `GET /stocks/latest-scores`、快照 5 个接口 `GET/POST /snapshots` + `GET/PUT-baseline/DELETE /snapshots/:id` |
| 模型 | `backend/src/models/MoneyChase{Run,Candidate,Rule,Schedule,ManualStock,Snapshot}.js` |
| 定时 | `backend/src/services/scheduler.js` → `reloadMoneyChaseSchedules()` |
| 前端 | `frontend/src/pages/MoneyChase/`（index / **StockDetail（单票具体分析页）** / KlineChart / **MinuteChart（分时）** / CandidateDetail / RulesPanel / SchedulePanel）；路由 `/money-chase/stock/:symbol` 懒加载 |

### K 线可视化

- 依赖：`echarts` + `echarts-for-react`，采用 **tree-shaking** 按需注册（`echarts/core` + `echarts-for-react/esm/core`）
- 数据契约：`kline.bars = [开, 收, 低, 高, 量, 额, 换手, 涨幅]`（前 4 位直接喂 ECharts candlestick）
- 可开关标注 8 项：均线 MA5/20/30、回撤区间、道氏高低点、斐波那契 382/500/618（markLine + markArea）、顶背离连线、双顶颈线、未达标点、红线标记、当日未收盘 bar（虚线边框 + 折算量柱）
- 副图：量能柱 + MACD；tooltip 输出开收低高/涨幅/换手/量额/MA/MACD + 该日未达标项与红线原文

### 分时图（MinuteChart，只在单票分析页）

- 数据：新浪 1 分钟线（一次请求取当日全部点），合成**走势价 + 累计均价**两条线，副图量能柱
- 基准：昨收 `markLine`；昨收上方淡红 markArea、下方淡绿；午间 11:30→13:00 画竖直虚线；右轴涨幅 % 辅助轴不进 legend
- 点数不足 2 个时不画图，直接中文说明“新浪 1 分钟线只请求 1 次、不重试”，并引导点「重新分析」
- **分时不参与任何判定**（A_R4 / B_R4 的“分时形态”始终是人工复核项）；加这张图纯粹是给人工看一眼今天的走势，日线才是判定口径

### 本地手动跑脚本（调试用）

```bash
cd backend
python3 scripts/fetch_money_chase.py --action sectors --now "2026-11-09T10:00:00+08:00"
python3 scripts/fetch_money_chase.py --action constituents --sectors 半导体,软件服务
python3 scripts/fetch_money_chase.py --action score --symbols "600519:白酒,300750:电池" --out /tmp/mc.json

# 单票具体分析（前端点股票名时调的就是这一条；输出结构与 score 相同，rows 只 1 条 + minute 分时）
python3 scripts/fetch_money_chase.py --action analyze --symbol 002913 --sector 人工自选 --source sina --now "2026-11-09T10:00:00+08:00"
```

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
- [x] 每日追资金初版（板块资金流 + A/B 池打分 + 红线 + 规则可调 + 定时节点）
- [x] 定格快照机制（`money_chase_snapshots` + 脚本 `--action snapshot`）：录入即固化基准快照，分析页📌快照评估（只读）/🔄当前最新评估（动态）分块展示，历史按时间点切片已实跑验证（当日盘中 / 历史盘中 5 分钟还原 / 历史收盘 / 非交易日报错 / 超分时长报错不降级）
- [ ] 筹码分布功能开发
- [ ] 用户认证系统（JWT）
- [ ] 前端 UI 细节调优

每日追资金初版的已知待验证项：

- [x] 全市场实时快照已可走新浪 `hq.sinajs.cn/list=` 批量口径（50 只/次），不再把请求压在东财；`kline_source` 页面可切，默认 `sina`
- [x] `money_chase_rules` 列宽已自动对齐（`alignRuleColumns`），播种逐条容错，107 条规则（60 param / 15 score / 9 redline / 8 manual / 2 pool / 8 overlay / 5 text）已全部在表
- [ ] 东财接口字段名（`stock_board_industry_cons_em` / `stock_cyq_em`）未做实盘连续校验，已用动态列名匹配 + 缺列中文报错 + 页面手输板块兜底
- [ ] 用新浪日线时批量打分路径的换手率/成交额为空（只影响 tooltip 展示，不影响判定），需要时再补
- [ ] **生产环境需重启后端**才会触发 `alignRuleColumns()` 与重新播种；老库若曾被列宽截断，重启后看一眼日志里的 `failed` 清单
- [ ] 前端已把 echarts 拆为独立 chunk（648 kB / gzip 219 kB）并对 `/money-chase` 路由做懒加载，主包降到 973 kB（gzip 306 kB）；`dist/` 需本地 `npm run build` 后随 deploy 分支发布
- [ ] Docker 开发模式镜像（`target: development` 基于 deps 阶段）**未安装 python3/akshare**，需调 Python 脚本请用下面「方式一」本机 `npm run dev`

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

# 6b. 确认规则真源已播种 + 追资金节点已注册
docker logs tradelog-backend 2>&1 | grep "追资金"
# 期望: “💰 每日追资金：09:50(自动Top3)、10:00(自动Top3)”；若报“规则配置文件缺失”则说明 /app/config 没被正确 COPY
docker exec tradelog-backend ls /app/config
# 期望: money_chase_rules.json
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
| 11 | 追资金规则播种 | 日志无“规则配置文件缺失”，`money_chase_rules` 表非空 | ☐ |
| 12 | 追资金定时节点 | 启动日志列出已注册节点，页面保存后无需重启即生效 | ☐ |
