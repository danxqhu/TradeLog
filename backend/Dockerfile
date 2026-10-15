# ---------- 依赖安装层（development target 使用） ----------
FROM node:18-alpine AS deps
WORKDIR /app
# 时区支持：安装 tzdata，设置 Asia/Shanghai
RUN apk add --no-cache tzdata
ENV TZ=Asia/Shanghai
COPY package*.json ./
RUN npm install

# ---------- 生产阶段：node 直启 + Python 脚本支持 ----------
FROM node:18-alpine AS production
WORKDIR /app
# 时区支持 + Python3 + curl（定时任务需要调用 Python 脚本和 curl）
# akshare 依赖 pandas/lxml，需要编译环境
RUN apk add --no-cache tzdata python3 py3-pip curl build-base python3-dev libxml2-dev libxslt-dev \
    && pip3 install --no-cache --break-system-packages requests beautifulsoup4 lxml akshare \
    && apk del build-base python3-dev libxml2-dev libxslt-dev
ENV TZ=Asia/Shanghai
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
# 定时任务依赖的 Python 抓取脚本 + Node.js 导入脚本
COPY scripts ./scripts
# Python 脚本写入中间 JSON 的目录（运行时动态生成，不 COPY）
RUN mkdir -p /app/data
EXPOSE 3001
CMD ["node", "src/app.js"]

# ---------- 开发阶段：nodemon 热更新 ----------
FROM deps AS development
COPY . .
ENV NODE_ENV=development
EXPOSE 3001
CMD ["npx", "nodemon", "src/app.js"]
