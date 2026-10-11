import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Card, Tabs, Button, Form, Input, DatePicker, Toast, Tag, Empty, Popup, Space } from 'antd-mobile'
import { AddOutline } from 'antd-mobile-icons'
import { recommendationApi } from '../../services/api'
import dayjs from 'dayjs'

export default function Recommendation() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState('morning')
  const [recommendations, setRecommendations] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [form] = Form.useForm()

  useEffect(() => {
    const source = searchParams.get('source')
    if (source) fetchRecommendations(source)
    else fetchRecommendations()
  }, [activeTab])

  const fetchRecommendations = async (source) => {
    try {
      // 模拟数据
      const mockData = [
        { id: 1, stock_code: '600519', stock_name: '贵州茅台', type: 'morning', source: '李享财经', recommend_date: '2026-10-11', recommend_time: '09:35', recommend_price: 1850.00, current_price: 1892.00 },
        { id: 2, stock_code: '000858', stock_name: '五粮液', type: 'morning', source: '李享财经', recommend_date: '2026-10-10', recommend_time: '09:42', recommend_price: 155.00, current_price: 153.20 },
        { id: 3, stock_code: '300750', stock_name: '宁德时代', type: 'afternoon', source: '李享财经', recommend_date: '2026-10-11', recommend_time: '13:15', recommend_price: 212.00, current_price: 218.50 },
        { id: 4, stock_code: '002594', stock_name: '比亚迪', type: 'afternoon', source: '李享财经', recommend_date: '2026-10-10', recommend_time: '13:05', recommend_price: 268.00, current_price: 272.80 },
      ]
      const filtered = mockData.filter(r => r.type === activeTab)
      if (source) {
        setRecommendations(filtered.filter(r => r.source === source))
      } else {
        setRecommendations(filtered)
      }
    } catch (error) {
      console.error('获取推荐列表失败:', error)
    }
  }

  const handleAdd = async (values) => {
    try {
      const data = {
        ...values,
        type: activeTab,
        recommend_date: dayjs(values.recommend_date).format('YYYY-MM-DD'),
        recommend_time: dayjs(values.recommend_time).format('HH:mm'),
      }
      // await recommendationApi.create(data)
      Toast.show('添加成功')
      setShowAdd(false)
      form.resetFields()
      fetchRecommendations()
    } catch (error) {
      Toast.show('添加失败')
    }
  }

  const calcReturn = (rec) => {
    const ret = ((rec.current_price - rec.recommend_price) / rec.recommend_price * 100).toFixed(2)
    return ret
  }

  return (
    <div className="page-container">
      <Card
        title="推荐管理"
        extra={
          <Button size="small" color="primary" fill="none" onClick={() => setShowAdd(true)}>
            <AddOutline /> 添加
          </Button>
        }
      >
        <Tabs activeKey={activeTab} onChange={setActiveTab}>
          <Tabs.Tab key="morning" title="早盘推荐" />
          <Tabs.Tab key="afternoon" title="午盘推荐" />
        </Tabs>

        <div style={{ marginTop: 12 }}>
          {recommendations.length === 0 ? (
            <Empty description={`暂无${activeTab === 'morning' ? '早盘' : '午盘'}推荐`} />
          ) : (
            recommendations.map(rec => (
              <div
                key={rec.id}
                className="card"
                style={{ marginBottom: 8, cursor: 'pointer' }}
                onClick={() => navigate(`/recommendation/${rec.id}`)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 16 }}>{rec.stock_name}</span>
                    <span style={{ fontSize: 12, color: '#999', marginLeft: 8 }}>{rec.stock_code}</span>
                  </div>
                  <Tag color={rec.type === 'morning' ? 'warning' : 'success'}>
                    {rec.type === 'morning' ? '早盘' : '午盘'}
                  </Tag>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#666' }}>
                  <span>{rec.recommend_date} {rec.recommend_time}</span>
                  <span>推荐价: ¥{rec.recommend_price}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                  <span style={{ fontSize: 13 }}>
                    现价: <strong>¥{rec.current_price}</strong>
                  </span>
                  <Tag
                    color={calcReturn(rec) >= 0 ? 'error' : 'success'}
                    style={{ fontSize: 14, fontWeight: 600 }}
                  >
                    {calcReturn(rec) >= 0 ? '+' : ''}{calcReturn(rec)}%
                  </Tag>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* 添加推荐弹窗 */}
      <Popup visible={showAdd} onMaskClick={() => setShowAdd(false)} bodyStyle={{ padding: 16, borderTopLeftRadius: 12, borderTopRightRadius: 12, minHeight: '60vh' }}>
        <h3 style={{ marginBottom: 16 }}>添加{activeTab === 'morning' ? '早盘' : '午盘'}推荐</h3>
        <Form form={form} onFinish={handleAdd} layout="vertical">
          <Form.Item name="stock_code" label="股票代码" rules={[{ required: true }]}>
            <Input placeholder="如: 600519" />
          </Form.Item>
          <Form.Item name="stock_name" label="股票名称" rules={[{ required: true }]}>
            <Input placeholder="如: 贵州茅台" />
          </Form.Item>
          <Form.Item name="recommend_date" label="推荐日期" rules={[{ required: true }]}>
            <DatePicker mode="date" style={{ width: '100%' }}>
              {(value) => value ? dayjs(value).format('YYYY-MM-DD') : '请选择日期'}
            </DatePicker>
          </Form.Item>
          <Form.Item name="recommend_time" label="推荐时间" rules={[{ required: true }]}>
            <DatePicker mode="time" format="HH:mm" style={{ width: '100%' }}>
              {(value) => value ? dayjs(value).format('HH:mm') : '请选择时间'}
            </DatePicker>
          </Form.Item>
          <Form.Item name="recommend_price" label="推荐价格" rules={[{ required: true }]}>
            <Input type="number" placeholder="推荐时的价格" />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea placeholder="推荐理由等" rows={2} />
          </Form.Item>
          <Button block type="submit" color="primary" size="large">保存</Button>
        </Form>
      </Popup>
    </div>
  )
}
