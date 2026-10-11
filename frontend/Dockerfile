# ---------- 依赖安装层 ----------
FROM node:18-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

# ---------- 构建阶段 ----------
FROM deps AS builder
COPY . .
RUN npm run build

# ---------- 生产阶段：nginx 托管打包产物 ----------
FROM nginx:alpine AS production
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

# ---------- 开发阶段：Vite 开发服务器（热更新） ----------
FROM deps AS development
COPY . .
ENV NODE_ENV=development
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
