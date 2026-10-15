import React, { useState, useEffect } from 'react'
import { NavBar, Card, Button, Input, Toast, List, Dialog, SpinLoading } from 'antd-mobile'
import { useNavigate } from 'react-router-dom'
import api from '../../services/api'

export default function Email() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [config, setConfig] = useState({
    smtp_host: 'smtp.qq.com',
    smtp_port: 465,
    smtp_user: '',
    smtp_pass: '',
    smtp_to: '',
  })

  // 加载配置
  useEffect(() => {
    setLoading(true)
    api.get('/email/config')
      .then(data => {
        setConfig({
          smtp_host: data.smtp_host || 'smtp.qq.com',
          smtp_port: data.smtp_port || 465,
          smtp_user: data.smtp_user || '',
          smtp_pass: data.smtp_pass || '',
          smtp_to: data.smtp_to || '',
        })
      })
      .catch(() => Toast.show({ content: '加载配置失败', icon: 'fail' }))
      .finally(() => setLoading(false))
  }, [])

  const updateField = (key, value) => {
    setConfig(prev => ({ ...prev, [key]: value }))
  }

  // 保存配置
  const handleSave = async () => {
    if (!config.smtp_user || !config.smtp_pass) {
      Toast.show({ content: '请填写发件人邮箱和授权码', icon: 'fail' })
      return
    }
    setSaving(true)
    try {
      const data = await api.post('/email/config', config)
      if (data.success) {
        Toast.show({ content: '配置保存成功', icon: 'success' })
      } else {
        Toast.show({ content: data.error || '保存失败', icon: 'fail' })
      }
    } catch {
      Toast.show({ content: '保存请求失败', icon: 'fail' })
    } finally {
      setSaving(false)
    }
  }

  // 测试发送
  const handleTest = async () => {
    if (!config.smtp_user || !config.smtp_pass) {
      Toast.show({ content: '请先填写发件人邮箱和授权码', icon: 'fail' })
      return
    }
    Dialog.confirm({
      content: `将发送测试邮件到 ${config.smtp_to || config.smtp_user}，确认？`,
      onConfirm: async () => {
        setTesting(true)
        try {
          const data = await api.post('/email/test', config)
          if (data.sent) {
            Toast.show({ content: '测试邮件发送成功', icon: 'success' })
          } else {
            Toast.show({ content: `发送失败: ${data.error}`, icon: 'fail' })
          }
        } catch {
          Toast.show({ content: '发送请求失败', icon: 'fail' })
        } finally {
          setTesting(false)
        }
      },
    })
  }

  if (loading) {
    return (
      <div className="page-container" style={{ display: 'flex', justifyContent: 'center', paddingTop: 100 }}>
        <SpinLoading color="primary" />
      </div>
    )
  }

  return (
    <div className="page-container" style={{ '--adm-color-primary': '#8B3A42' }}>
      <NavBar onBack={() => navigate(-1)}>邮件推送配置</NavBar>

      <Card title="SMTP 服务器配置" style={{ marginBottom: 12 }}>
        <List>
          <List.Item
            extra={
              <Input
                placeholder="smtp.qq.com"
                value={config.smtp_host}
                onChange={(v) => updateField('smtp_host', v)}
                style={{ '--font-size': '14px' }}
              />
            }
          >
            服务器地址
          </List.Item>
          <List.Item
            extra={
              <Input
                placeholder="465"
                value={String(config.smtp_port)}
                onChange={(v) => updateField('smtp_port', v)}
                type="number"
                style={{ '--font-size': '14px' }}
              />
            }
          >
            端口
          </List.Item>
        </List>
      </Card>

      <Card title="发件人配置" style={{ marginBottom: 12 }}>
        <List>
          <List.Item
            extra={
              <Input
                placeholder="your@qq.com"
                value={config.smtp_user}
                onChange={(v) => updateField('smtp_user', v)}
                style={{ '--font-size': '14px' }}
              />
            }
          >
            发件人邮箱
          </List.Item>
          <List.Item
            extra={
              <Input
                placeholder="邮箱授权码"
                value={config.smtp_pass}
                onChange={(v) => updateField('smtp_pass', v)}
                type="password"
                style={{ '--font-size': '14px' }}
              />
            }
          >
            授权码
          </List.Item>
          <List.Item
            extra={
              <Input
                placeholder="默认收件人（留空则发给自己）"
                value={config.smtp_to}
                onChange={(v) => updateField('smtp_to', v)}
                style={{ '--font-size': '14px' }}
              />
            }
          >
            默认收件人
          </List.Item>
        </List>
      </Card>

      <div style={{ padding: '12px 16px', display: 'flex', gap: 12 }}>
        <Button
          block
          color="primary"
          size="large"
          loading={saving}
          onClick={handleSave}
        >
          保存配置
        </Button>
        <Button
          block
          size="large"
          loading={testing}
          onClick={handleTest}
          style={{ '--border-color': '#8B3A42', '--text-color': '#8B3A42' }}
        >
          测试发送
        </Button>
      </div>

      <Card title="使用说明" style={{ margin: '12px 16px' }}>
        <div style={{ fontSize: 13, color: '#666', lineHeight: 1.8 }}>
          <p style={{ margin: '0 0 8px' }}><strong>QQ 邮箱：</strong></p>
          <ol style={{ margin: '0 0 12px', paddingLeft: 20 }}>
            <li>登录 QQ 邮箱 → 设置 → 账户</li>
            <li>开启 SMTP 服务</li>
            <li>获取授权码填入上方「授权码」</li>
            <li>服务器: smtp.qq.com，端口: 465</li>
          </ol>
          <p style={{ margin: '0 0 8px' }}><strong>163 邮箱：</strong></p>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            <li>登录 163 邮箱 → 设置 → POP3/SMTP</li>
            <li>开启 SMTP 服务</li>
            <li>获取授权码填入上方「授权码」</li>
            <li>服务器: smtp.163.com，端口: 465</li>
          </ol>
        </div>
      </Card>
    </div>
  )
}
