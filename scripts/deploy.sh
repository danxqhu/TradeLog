#!/bin/bash
# =============================================================================
# TradeLog 一键部署脚本
# 使用方式：chmod +x scripts/deploy.sh && ./scripts/deploy.sh
# =============================================================================

set -e

echo "🚀 TradeLog 部署开始..."

# 检查 .env 文件
if [ ! -f .env ]; then
    echo "⚠️  .env 文件不存在，从模板复制..."
    cp .env.example .env
    echo "📝 请编辑 .env 文件配置环境变量后再运行部署脚本"
    exit 1
fi

# 检查 Docker 网络
echo "📡 检查 Docker 网络..."
if ! docker network inspect meal-log-network >/dev/null 2>&1; then
    echo "⚠️  共享网络 meal-log-network 不存在，正在创建..."
    docker network create meal-log-network
    echo "✅ 网络创建成功"
else
    echo "✅ 网络已存在"
fi

# 构建并启动服务
echo "🔨 构建 Docker 镜像..."
docker-compose -f docker-compose.yml up -d --build

# 等待服务启动
echo "⏳ 等待服务启动..."
sleep 10

# 检查服务状态
echo "📊 服务状态："
docker-compose ps

# 检查网络
echo ""
echo "🌐 网络中的容器："
docker network inspect meal-log-network --format='{{range .Containers}}  {{.Name}} ({{.IPv4Address}}){{"\n"}}{{end}}' 2>/dev/null || echo "  无法获取网络信息"

echo ""
echo "✅ 部署完成！"
echo ""
echo "📋 后续步骤："
echo "  1. 在总反向代理中添加 tradelog 站点配置"
echo "  2. 重启总反向代理"
echo "  3. 在 Cloudflare 添加 tradelog A 记录（橙色云朵）"
echo "  4. 访问 https://tradelog.meallog.eu.cc 验证"
