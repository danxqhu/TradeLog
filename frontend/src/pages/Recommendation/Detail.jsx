import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Card, Button, Tag, Input, Toast, Grid, NavBar, Space } from 'antd-mobile'
import { LeftOutline } from 'antd-mobile-icons'

export default function RecommendationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [recommendation, setRecommendation] = useState(null)
  const [returns, setReturns] = useState({})
  const [customDays, setCustomDays] = useState('')
  const [customReturn, setCustomReturn] = useState(null)

  useEffect(() => {
    // 模拟数据
    setRecommendation({
      id: 1, stock_code: '600519', stock_name: '贵州茅台', type: 'morning',
      source: '李享财经', recommend_date: '2026-10-11', recommend_time: '09:35',
      recommend_price: 1850.00, current_price: 1892.00,
    })
    setReturns({
      '3d': { return_rate: 2.27, check_date: '2026-10-16', check_price: 1892, trading_days: 3 },
      '7d': { return_rate: null },
      '2w': { return_rate: null },
      '1m': { return_rate: null },
    })
  }, [id])

  const handleCalcCustom = () => {
    if (!customDays || customDays <= 0) {
      Toast.show('请输入有效天数')
      return
    }
    // 模拟自定义天数收益率计算
    const mockReturn = (Math.random() * 10 - 2).toFixed(2)
    setCustomReturn({ days: customDays, return_rate: mockReturn })
    Toast.show(`推荐后${customDays}个交易日收益率: ${mockReturn}%`)
  }

  if (!recommendation) return null

  const periods = [
    { key: '3d', label: '3天' },
    { key: '7d', label: '7天' },
    { key: '2w', label: '2周' },
    { key: '1m', label: '1月' },
  ]

  return (
    <div className="page-container">
      <NavBar backIcon={<LeftOutline />} onBack={() => navigate(-1)}>
        推荐详情
      </NavBar>

      <Card style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <span style={{ fontWeight: 700, fontSize: 20 }}>{recommendation.stock_name}</span>
            <span style={{ fontSize: 14, color: '#999', marginLeft: 8 }}>{recommendation.stock_code}</span>
          </div>
          <Tag color={recommendation.type === 'morning' ? 'warning' : 'success'}>
            {recommendation.type === 'morning' ? '早盘' : '午盘'}
          </Tag>
        </div>
        <Grid columns={2} gap={8}>
          <div><span style={{ color: '#999', fontSize: 13 }}>推荐日期</span><div>{recommendation.recommend_date}</div></div>
          <div><span style={{ color: '#999', fontSize: 13 }}>推荐时间</span><div>{recommendation.recommend_time}</div></div>
          <div><span style={{ color: '#999', fontSize: 13 }}>推荐价格</span><div style={{ fontWeight: 600 }}>¥{recommendation.recommend_price}</div></div>
          <div><span style={{ color: '#999', fontSize: 13 }}>当前价格</span><div style={{ fontWeight: 600 }}>¥{recommendation.current_price}</div></div>
        </Grid>
      </Card>

      {/* 收益率按钮 */}
      <Card title="收益率统计" style={{ marginTop: 12 }}>
        <Grid columns={4} gap={8} style={{ marginBottom: 16 }}>
          {periods.map(p => {
            const data = returns[p.key]
            const hasData = data?.return_rate !== null && data?.return_rate !== undefined
            return (
              <Button
                key={p.key}
                block
                size="small"
                color={hasData ? (data.return_rate >= 0 ? 'danger' : 'success') : 'default'}
                fill={hasData ? 'solid' : 'outline'}
                style={{ height: 48, fontSize: 13 }}
              >
                <div>{p.label}</div>
                <div style={{ fontWeight: 700 }}>
                  {hasData ? `${data.return_rate >= 0 ? '+' : ''}${data.return_rate}%` : '--'}
                </div>
              </Button>
            )
          })}
        </Grid>

        {/* 自定义天数 */}
        <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 12 }}>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>自定义天数（按交易日计算）</div>
          <Space>
            <Input
              type="number"
              placeholder="输入交易日天数"
              value={customDays}
              onChange={setCustomDays}
              style={{ width: 150 }}
            />
            <Button color="primary" size="small" onClick={handleCalcCustom}>计算</Button>
          </Space>
          {customReturn && (
            <div style={{ marginTop: 8, padding: 8, background: '#f5f5f5', borderRadius: 8 }}>
              推荐后 <strong>{customReturn.days}</strong> 个交易日收益率：
              <strong style={{ color: customReturn.return_rate >= 0 ? '#e74c3c' : '#27ae60' }}>
                {customReturn.return_rate >= 0 ? '+' : ''}{customReturn.return_rate}%
              </strong>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
