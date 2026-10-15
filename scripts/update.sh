#!/bin/bash
# =============================================================================
# TradeLog 热更新脚本
# 使用方式：chmod +x scripts/update.sh && ./scripts/update.sh
# 用于代码更新后快速重建并重启服务
# =============================================================================

set -e

# 确定使用的 compose 命令（新版 Docker 用 `docker compose`，旧版用 `docker-compose`）
if command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
else
    COMPOSE_CMD="docker compose"
fi

echo "🔄 TradeLog 热更新开始..."

# 拉取最新代码（如果是 git 管理）
if [ -d .git ]; then
    echo "📥 拉取最新代码..."
    git pull
fi

# 根据参数决定更新范围
case "${1:-all}" in
    frontend)
        echo "🎨 更新前端..."
        $COMPOSE_CMD -f docker-compose.yml build tradelog-frontend
        $COMPOSE_CMD -f docker-compose.yml up -d tradelog-frontend
        ;;
    backend)
        echo "⚙️  更新后端..."
        $COMPOSE_CMD -f docker-compose.yml build tradelog-backend
        $COMPOSE_CMD -f docker-compose.yml up -d tradelog-backend
        ;;
    all)
        echo "🔨 重建所有服务..."
        $COMPOSE_CMD -f docker-compose.yml up -d --build
        ;;
    *)
        echo "用法: ./scripts/update.sh [frontend|backend|all]"
        exit 1
        ;;
esac

# 等待服务启动
echo "⏳ 等待服务启动..."
sleep 5

# 检查状态
echo "📊 服务状态："
$COMPOSE_CMD ps

echo ""
echo "✅ 更新完成！"
