import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Input, Button, Toast } from 'antd-mobile'
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
  questionBox: {
    background: '#FAF0F1',
    borderRadius: 8,
    padding: '12px 16px',
    marginBottom: 16,
    fontSize: 14,
    color: '#8B3A42',
    lineHeight: 1.6,
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
}

export default function ForgotPassword() {
  const [step, setStep] = useState(1) // 1=输入用户名获取密保问题, 2=回答问题重置密码
  const [username, setUsername] = useState('')
  const [securityQuestion, setSecurityQuestion] = useState('')
  const [securityAnswer, setSecurityAnswer] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  // 步骤1：获取密保问题
  const handleGetQuestion = async () => {
    if (!username.trim()) {
      Toast.show('请输入用户名')
      return
    }
    setLoading(true)
    try {
      const res = await authApi.getSecurityQuestion(username.trim())
      setSecurityQuestion(res.security_question)
      setStep(2)
    } catch (err) {
      Toast.show(err.response?.data?.error || '用户不存在')
    } finally {
      setLoading(false)
    }
  }

  // 步骤2：提交重置
  const handleReset = async () => {
    if (!securityAnswer.trim()) {
      Toast.show('请输入密保答案')
      return
    }
    if (newPassword.length < 6) {
      Toast.show('新密码至少 6 位')
      return
    }
    if (newPassword !== confirmPassword) {
      Toast.show('两次密码输入不一致')
      return
    }

    setLoading(true)
    try {
      await authApi.resetPassword({
        username: username.trim(),
        security_answer: securityAnswer.trim(),
        new_password: newPassword,
      })
      Toast.show({ content: '密码重置成功', icon: 'success' })
      navigate('/login', { replace: true })
    } catch (err) {
      Toast.show(err.response?.data?.error || '重置失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.title}>忘记密码</div>
        <div style={styles.subtitle}>
          {step === 1 ? '输入用户名查看密保问题' : '回答密保问题重置密码'}
        </div>

        {step === 1 ? (
          <>
            <div style={styles.field}>
              <label style={styles.label}>用户名</label>
              <Input
                placeholder="请输入注册时的用户名"
                value={username}
                onChange={setUsername}
                style={styles.input}
                onKeyDown={(e) => e.key === 'Enter' && handleGetQuestion()}
              />
            </div>

            <Button
              block
              loading={loading}
              onClick={handleGetQuestion}
              style={styles.btn}
            >
              下一步
            </Button>
          </>
        ) : (
          <>
            <div style={styles.questionBox}>
              密保问题：{securityQuestion}
            </div>

            <div style={styles.field}>
              <label style={styles.label}>密保答案</label>
              <Input
                placeholder="请输入密保答案"
                value={securityAnswer}
                onChange={setSecurityAnswer}
                style={styles.input}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>新密码</label>
              <Input
                type="password"
                placeholder="至少 6 位"
                value={newPassword}
                onChange={setNewPassword}
                style={styles.input}
              />
            </div>

            <div style={styles.field}>
              <label style={styles.label}>确认新密码</label>
              <Input
                type="password"
                placeholder="再次输入新密码"
                value={confirmPassword}
                onChange={setConfirmPassword}
                style={styles.input}
              />
            </div>

            <Button
              block
              loading={loading}
              onClick={handleReset}
              style={styles.btn}
            >
              重置密码
            </Button>

            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <span
                style={{ color: '#C4737A', fontSize: 13, cursor: 'pointer' }}
                onClick={() => setStep(1)}
              >
                返回上一步
              </span>
            </div>
          </>
        )}

        <div style={styles.footer}>
          <Link to="/login" style={styles.link}>返回登录</Link>
        </div>
      </div>
    </div>
  )
}
