const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User, SystemConfig } = require('../models');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// JWT 有效期：7 天
const TOKEN_EXPIRES_IN = '7d';

/**
 * 生成 JWT token
 */
function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_EXPIRES_IN }
  );
}

/**
 * GET /api/auth/registration-status
 * 查询注册是否开放（公开接口）
 */
router.get('/registration-status', async (req, res) => {
  try {
    const config = await SystemConfig.findByPk('registration_open');
    const isOpen = config && config.value === 'true';
    res.json({ registrationOpen: isOpen });
  } catch (err) {
    res.status(500).json({ error: '查询注册状态失败' });
  }
});

/**
 * POST /api/auth/register
 * 注册新用户
 */
router.post('/register', async (req, res) => {
  try {
    const { username, password, security_question, security_answer } = req.body;

    // 参数校验
    if (!username || !password || !security_question || !security_answer) {
      return res.status(400).json({ error: '所有字段均为必填' });
    }
    if (username.length < 2 || username.length > 50) {
      return res.status(400).json({ error: '用户名长度需在 2-50 之间' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '密码长度至少 6 位' });
    }

    // 检查注册是否开放
    const config = await SystemConfig.findByPk('registration_open');
    if (!config || config.value !== 'true') {
      return res.status(403).json({ error: '注册已关闭，请联系管理员' });
    }

    // 检查用户名是否已存在
    const existing = await User.findOne({ where: { username } });
    if (existing) {
      return res.status(409).json({ error: '用户名已存在' });
    }

    // 判断是否是第一个用户（自动成为 admin）
    const userCount = await User.count();
    const isFirstUser = userCount === 0;

    // 哈希密码和密保答案
    const password_hash = await bcrypt.hash(password, 10);
    const security_answer_hash = await bcrypt.hash(security_answer.toLowerCase().trim(), 10);

    // 创建用户
    const user = await User.create({
      username,
      password_hash,
      security_question,
      security_answer_hash,
      role: isFirstUser ? 'admin' : 'user',
    });

    // 首个用户注册后自动关闭注册
    if (isFirstUser) {
      await SystemConfig.upsert({ key: 'registration_open', value: 'false' });
      console.log('✅ 首个用户注册完成，已自动关闭注册（用户角色: admin）');
    } else {
      console.log(`✅ 新用户注册成功: ${username}`);
    }

    // 返回 token（注册即登录）
    const token = generateToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('注册失败:', err.message);
    res.status(500).json({ error: '注册失败，请稍后重试' });
  }
});

/**
 * POST /api/auth/login
 * 登录
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: '请输入用户名和密码' });
    }

    const user = await User.findOne({ where: { username } });
    if (!user) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const token = generateToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('登录失败:', err.message);
    res.status(500).json({ error: '登录失败，请稍后重试' });
  }
});

/**
 * GET /api/auth/me
 * 获取当前用户信息（需认证）
 */
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: ['id', 'username', 'role', 'created_at'],
    });
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: '获取用户信息失败' });
  }
});

/**
 * POST /api/auth/reset-password
 * 通过密保问题重置密码
 * 分两步：1) 用用户名获取密保问题  2) 提交答案+新密码
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { username, security_answer, new_password } = req.body;

    if (!username || !security_answer || !new_password) {
      return res.status(400).json({ error: '所有字段均为必填' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: '新密码长度至少 6 位' });
    }

    const user = await User.findOne({ where: { username } });
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }

    // 验证密保答案
    const valid = await bcrypt.compare(
      security_answer.toLowerCase().trim(),
      user.security_answer_hash
    );
    if (!valid) {
      return res.status(401).json({ error: '密保答案错误' });
    }

    // 更新密码
    const password_hash = await bcrypt.hash(new_password, 10);
    await user.update({ password_hash });

    res.json({ message: '密码重置成功，请重新登录' });
  } catch (err) {
    console.error('重置密码失败:', err.message);
    res.status(500).json({ error: '重置密码失败，请稍后重试' });
  }
});

/**
 * GET /api/auth/security-question/:username
 * 根据用户名获取密保问题（公开接口，用于忘记密码流程）
 */
router.get('/security-question/:username', async (req, res) => {
  try {
    const user = await User.findOne({
      where: { username: req.params.username },
      attributes: ['username', 'security_question'],
    });
    if (!user) {
      return res.status(404).json({ error: '用户不存在' });
    }
    res.json({ security_question: user.security_question });
  } catch (err) {
    res.status(500).json({ error: '获取密保问题失败' });
  }
});

/**
 * PUT /api/auth/registration-toggle
 * 管理员开关注册
 */
router.put('/registration-toggle', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { open } = req.body;
    if (typeof open !== 'boolean') {
      return res.status(400).json({ error: '参数 open 必须为布尔值' });
    }
    await SystemConfig.upsert({ key: 'registration_open', value: open ? 'true' : 'false' });
    res.json({ message: open ? '注册已开放' : '注册已关闭', registrationOpen: open });
  } catch (err) {
    res.status(500).json({ error: '操作失败' });
  }
});

module.exports = router;
