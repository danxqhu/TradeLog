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
    display: 'flex',
    justifyContent: 'space-between',
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
    padding: '20px 0',
  },
}

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [regOpen, setRegOpen] = useState(false)
  const navigate = useNavigate()
  const { login } = useAuth()

  useEffect(() => {
    authApi.getRegistrationStatus().then(res => {
      setRegOpen(res.registrationOpen)
    }).catch(() => {})
  }, [])

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      Toast.show('请输入用户名和密码')
      return
    }
    setLoading(true)
    try {
      const res = await authApi.login({ username: username.trim(), password })
      login(res.token, res.user)
      Toast.show({ content: '登录成功', icon: 'success' })
      navigate('/', { replace: true })
    } catch (err) {
      Toast.show(err.response?.data?.error || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.title}>TradeLog</div>
        <div style={styles.subtitle}>股票交易助手</div>

        <div style={styles.field}>
          <label style={styles.label}>用户名</label>
          <Input
            placeholder="请输入用户名"
            value={username}
            onChange={setUsername}
            style={styles.input}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          />
        </div>

        <div style={styles.field}>
          <label style={styles.label}>密码</label>
          <Input
            type="password"
            placeholder="请输入密码"
            value={password}
            onChange={setPassword}
            style={styles.input}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          />
        </div>

        <Button
          block
          loading={loading}
          onClick={handleLogin}
          style={styles.btn}
        >
          登录
        </Button>

        <div style={styles.footer}>
          <Link to="/forgot-password" style={styles.link}>忘记密码？</Link>
          {regOpen && (
            <Link to="/register" style={styles.link}>注册账号</Link>
          )}
        </div>
      </div>
    </div>
  )
}
