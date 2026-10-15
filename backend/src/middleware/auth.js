const jwt = require('jsonwebtoken');

/**
 * JWT 认证中间件
 * 从 Authorization: Bearer <token> 提取并验证 JWT
 * 验证通过后把用户信息注入 req.user
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  // SSE (EventSource) 不支持自定义 header，允许从 query 参数读取 token
  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: '登录已过期，请重新登录' });
    }
    return res.status(401).json({ error: '无效的登录凭证' });
  }
}

/**
 * 管理员权限中间件
 * 必须在 authenticateToken 之后使用
 */
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: '需要管理员权限' });
  }
  next();
}

module.exports = { authenticateToken, requireAdmin };
