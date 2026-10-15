import React, { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Input, Button, Toast } from 'antd-mobile'
import { useAuth } from '../../utils/AuthContext'
import { authApi } from '../../services/api'

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#FAF0F1',
    padding: '20px',
  },
  card: {
    width: '100%',
    maxWidth: 360,
    background: '#fff',
    borderRadius: 12,
    padding: '32px 24px',
    boxShadow: '0 2px 12px rgba(139,58,66,0.08)',
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    color: '#8B3A42',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: '#999',
    textAlign: 'center',
    marginBottom: 28,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13,
    color: '#666',
    marginBottom: 6,
    display: 'block',
  },
  input: {
    '--font-size': '15px',
    '--color': '#333',
    border: '1px solid #E8CED1',
    borderRadius: 8,
    padding: '10px 12px',
    width: '100%',
    boxSizing: 'border-box',
  },
  btn: {
    '--background-color': '#8B3A42',
    '--border-radius': '8px',
    width: '100%',
    height: 44,
    fontSize: 16,
    marginTop: 8,
  },
  footer: {
    marginTop: 20,
    textAlign: 'center',
    fontSize: 13,
  },
  link: {
    color: '#C4737A',
    textDecoration: 'none',
  },
  closed: {
    textAlign: 'center',
    color: '#999',
    fontSize: 14,
    padding: '40px 20px',
    lineHeight: 1.8,
  },
}

export default function Register() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [securityQuestion, setSecurityQuestion] = useState('')
  const [securityAnswer, setSecurityAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [regOpen, setRegOpen] = useState(null) // null=loading, true/false
  const navigate = useNavigate()
  const { login } = useAuth()

  useEffect(() => {
    authApi.getRegistrationStatus().then(res => {
      setRegOpen(res.registrationOpen)
    }).catch(() => {
      setRegOpen(false)
    })
  }, [])

  const handleRegister = async () => {
    if (!username.trim() || !password || !securityQuestion.trim() || !securityAnswer.trim()) {
      Toast.show('所有字段均为必填')
      return
    }
    if (username.trim().length < 2) {
      Toast.show('用户名至少 2 个字符')
      return
    }
    if (password.length < 6) {
      Toast.show('密码至少 6 位')
      return
    }
    if (password !== confirmPassword) {
      Toast.show('两次密码输入不一致')
      return
    }

    setLoading(true)
    try {
      const res = await authApi.register({
        username: username.trim(),
        password,
        security_question: securityQuestion.trim(),
        security_answer: securityAnswer.trim(),
      })
      login(res.token, res.user)
      Toast.show({ content: '注册成功', icon: 'success' })
      navigate('/', { replace: true })
    } catch (err) {
      Toast.show(err.response?.data?.error || '注册失败')
    } finally {
      setLoading(false)
    }
  }

  // 加载中
  if (regOpen === null) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.title}>注册</div>
          <div style={{ textAlign: 'center', padding: 40, color: '#999' }}>加载中...</div>
        </div>
      </div>
    )
  }

  // 注册已关闭
  if (!regOpen) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.title}>注册</div>
          <div style={styles.closed}>
            注册已关闭<br />
            请联系管理员开通
          </div>
          <div style={styles.footer}>
            <Link to="/login" style={styles.link}>返回登录</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.title}>注册账号</div>
        <div style={styles.subtitle}>创建您的 TradeLog 账号</div>

        <div style={styles.field}>
          <label style={styles.label}>用户名</label>
          <Input
            placeholder="至少 2 个字符"
            value={username}
            onChange={setUsername}
            style={styles.input}
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>密码</label>
          <Input
            type="password"
            placeholder="至少 6 位"
            value={password}
            onChange={setPassword}
            style={styles.input}
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>确认密码</label>
          <Input
            type="password"
            placeholder="再次输入密码"
            value={confirmPassword}
            onChange={setConfirmPassword}
            style={styles.input}
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>密保问题</label>
          <Input
            placeholder="例如：你第一只股票是什么？"
            value={securityQuestion}
            onChange={setSecurityQuestion}
            style={styles.input}
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>密保答案</label>
          <Input
            placeholder="用于找回密码，请牢记"
            value={securityAnswer}
            onChange={setSecurityAnswer}
            style={styles.input}
          />
        </div>

        <Button
          block
          loading={loading}
          onClick={handleRegister}
          style={styles.btn}
        >
          注册
        </Button>

        <div style={styles.footer}>
          已有账号？ <Link to="/login" style={styles.link}>去登录</Link>
        </div>
      </div>
    </div>
  )
}
