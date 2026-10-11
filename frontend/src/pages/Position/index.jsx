import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, NavBar, Button, Tag, Form, Input, Toast, Empty, Popup, Selector, Space } from 'antd-mobile'
import { LeftOutline, AddOutline } from 'antd-mobile-icons'

const strategies = {
  rectangle: { name: '矩形仓位法', desc: '5等份，每次20%', color: '#1677ff' },
  pyramid: { name: '金字塔仓位法', desc: '50%/30%/20%', color: '#ff8f1f' },
  funnel: { name: '漏斗形仓位法', desc: '10%/15%/20%/25%/30%', color: '#9c27b0' },
}

export default function Position() {
  const navigate = useNavigate()
  const [positions, setPositions] = useState([
    { id: 1, stock_code: '600519', stock_name: '贵州茅台', buy_price: 1850, current_price: 1892, quantity: 100, avg_cost: 1850, profit_loss_percent: 2.27, strategy: 'funnel', add_count: 1 },
    { id: 2, stock_code: '002594', stock_name: '比亚迪', buy_price: 268, current_price: 245, quantity: 200, avg_cost: 260, profit_loss_percent: -8.58, strategy: 'rectangle', add_count: 2 },
  ])
  const [showAdd, setShowAdd] = useState(false)
  const [form] = Form.useForm()

  const handleAdd = (values) => {
    Toast.show('持仓添加成功')
    setShowAdd(false)
    form.resetFields()
  }

  return (
    <div className="page-container">
      <NavBar backIcon={<LeftOutline />} onBack={() => navigate(-1)}>仓位管理</NavBar>

      {/* 策略说明 */}
      <Card title="仓位策略" style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Object.entries(strategies).map(([key, s]) => (
            <div key={key} style={{ padding: 10, background: '#f5f5f5', borderRadius: 8 }}>
              <div style={{ fontWeight: 600, color: s.color }}>{s.name}</div>
              <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{s.desc}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 12, padding: 10, background: '#fff3cd', borderRadius: 8, fontSize: 13 }}>
          <strong>阶梯加仓规则：</strong>跌10%加仓、跌20%加仓、跌30%加仓，触发时通过邮件提醒
        </div>
      </Card>

      {/* 持仓列表 */}
      <Card
        title="我的持仓"
        extra={
          <Button size="small" color="primary" fill="none" onClick={() => setShowAdd(true)}>
            <AddOutline /> 新建
          </Button>
        }
        style={{ marginTop: 12 }}
      >
        {positions.length === 0 ? (
          <Empty description="暂无持仓" />
        ) : (
          positions.map(pos => (
            <div key={pos.id} className="card" style={{ marginBottom: 8 }} onClick={() => navigate(`/position/strategy/${pos.stock_code}`)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: 16 }}>{pos.stock_name}</span>
                  <span style={{ fontSize: 12, color: '#999', marginLeft: 8 }}>{pos.stock_code}</span>
                </div>
                <Tag color={strategies[pos.strategy]?.color || '#999'}>{strategies[pos.strategy]?.name}</Tag>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>成本: ¥{pos.avg_cost} | 数量: {pos.quantity}股</span>
                <span style={{ fontWeight: 600, color: pos.profit_loss_percent >= 0 ? '#e74c3c' : '#27ae60' }}>
                  {pos.profit_loss_percent >= 0 ? '+' : ''}{pos.profit_loss_percent}%
                </span>
              </div>
              {pos.add_count > 0 && (
                <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>已加仓 {pos.add_count} 次</div>
              )}
            </div>
          ))
        )}
      </Card>

      {/* 添加持仓弹窗 */}
      <Popup visible={showAdd} onMaskClick={() => setShowAdd(false)} bodyStyle={{ padding: 16, borderTopLeftRadius: 12, borderTopRightRadius: 12, minHeight: '50vh' }}>
        <h3 style={{ marginBottom: 16 }}>新建持仓</h3>
        <Form form={form} onFinish={handleAdd} layout="vertical">
          <Form.Item name="stock_code" label="股票代码" rules={[{ required: true }]}>
            <Input placeholder="如: 600519" />
          </Form.Item>
          <Form.Item name="stock_name" label="股票名称" rules={[{ required: true }]}>
            <Input placeholder="如: 贵州茅台" />
          </Form.Item>
          <Form.Item name="buy_price" label="买入价格" rules={[{ required: true }]}>
            <Input type="number" placeholder="买入价格" />
          </Form.Item>
          <Form.Item name="quantity" label="买入数量(股)" rules={[{ required: true }]}>
            <Input type="number" placeholder="买入数量" />
          </Form.Item>
          <Form.Item name="strategy" label="仓位策略" rules={[{ required: true }]}>
            <Selector
              options={Object.entries(strategies).map(([k, v]) => ({ label: v.name, value: k }))}
            />
          </Form.Item>
          <Button block type="submit" color="primary" size="large">保存</Button>
        </Form>
      </Popup>
    </div>
  )
}
