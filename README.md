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
│           ├── emailService.js     # 163 SMTP 邮件服务（加仓提醒）
│           ├── tradingDayService.js # 交易日计算工具
│           └── stockDataService.js # 股票数据服务（当前模拟数据，预留真实API接口）
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
| `/api/stocks` | GET/POST | 股票列表/新增 |
| `/api/stocks/realtime` | GET | 实时行情（模拟数据） |
| `/api/stocks/:code` | GET/PUT/DELETE | 单只股票操作 |
| `/api/recommendations` | GET/POST | 推荐列表/新增 |
| `/api/recommendations/:id` | GET/PUT/DELETE | 推荐详情操作 |
| `/api/recommendations/:id/returns` | GET | 获取各周期收益率 |
| `/api/recommendations/:id/track` | POST | 记录收益 |
| `/api/recommendations/:id/calculate-returns` | POST | 自动计算收益率 |
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
| `/api/research-reports` | GET/POST | 研报列表/新增 |
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

## 待开发 / 已知待完善项

- [x] 上海证券报自动抓取（scraper/shanghai_news_scraper.py）
- [ ] 实时行情数据接入（当前 stockDataService.js 使用模拟数据，预留了 AKShare/Tushare 接口）
- [ ] 高盛研报自动抓取
- [ ] 李享财经推荐数据自动抓取
- [ ] 用户认证系统（JWT）
- [ ] 前端 UI 细节调优
- [ ] 交易日历节假日手动标注
- [ ] 后端定时任务（检查持仓跌幅触发加仓提醒）

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

## 本地开发常用命令

```bash
# 前端开发（热更新）
cd frontend && npm run dev

# 后端开发（nodemon 热更新）
cd backend && npm run dev

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
