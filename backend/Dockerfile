# ---------- 依赖安装层（development target 使用） ----------
FROM node:18-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

# ---------- 生产阶段：node 直启 ----------
FROM node:18-alpine AS production
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
EXPOSE 3001
CMD ["node", "src/app.js"]

# ---------- 开发阶段：nodemon 热更新 ----------
FROM deps AS development
COPY . .
ENV NODE_ENV=development
EXPOSE 3001
CMD ["npx", "nodemon", "src/app.js"]
