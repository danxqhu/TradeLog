import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Button, Tag, SpinLoading, Dialog, Toast } from 'antd-mobile'
import { CloseOutline } from 'antd-mobile-icons'

// 大盘指数模拟数据
const indexData = [
  {
    key: 'sh000001',
    name: '上证指数',
    code: '000001',
    current: 3286.53,
    change_percent: 0.72,
    turnover: 452300000000,
    turnover_change: 12.5,
    volume: 328500000000,
  },
  {
    key: 'sh000985',
    name: '中证全指',
    code: '000985',
    current: 5128.76,
    change_percent: 0.95,
    turnover: 895600000000,
    turnover_change: -5.3,
    volume: 652300000000,
  },
]

export default function Home() {
  const navigate = useNavigate()
  const [turnoverData, setTurnoverData] = useState([
    { code: '600519', name: '贵州茅台', turnover: 8560000000, change_percent: 2.35 },
    { code: '000858', name: '五粮液', turnover: 5230000000, change_percent: -1.28 },
    { code: '601318', name: '中国平安', turnover: 4120000000, change_percent: 0.85 },
    { code: '000001', name: '平安银行', turnover: 3890000000, change_percent: -0.52 },
    { code: '600036', name: '招商银行', turnover: 3560000000, change_percent: 1.12 },
    { code: '002594', name: '比亚迪', turnover: 6780000000, change_percent: 3.45 },
    { code: '300750', name: '宁德时代', turnover: 7230000000, change_percent: -2.18 },
    { code: '601012', name: '隆基绿能', turnover: 2340000000, change_percent: -0.95 },
  ])
  const [loading, setLoading] = useState(false)

  const formatTurnover = (value) => {
    if (value >= 100000000) return (value / 100000000).toFixed(2) + '亿'
    if (value >= 10000) return (value / 10000).toFixed(0) + '万'
    return value.toString()
  }

  const handleDelete = (e, stock) => {
    e.stopPropagation()
    Dialog.confirm({
      content: `确定从排行中移除 ${stock.name} 吗？`,
      onConfirm: () => {
        setTurnoverData(prev => prev.filter(s => s.code !== stock.code))
        Toast.show('已移除')
      },
    })
  }

  return (
    <div className="page-container">
      {/* 大盘指数 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        {indexData.map(idx => (
          <Card key={idx.key} style={{ padding: 12 }}>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 4 }}>{idx.name}</div>
            <div style={{
              fontSize: 20,
              fontWeight: 700,
              color: idx.change_percent >= 0 ? '#e74c3c' : '#27ae60',
              marginBottom: 4,
            }}>
              {idx.current}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <Tag
                color={idx.change_percent >= 0 ? 'error' : 'success'}
                style={{ fontSize: 12 }}
              >
                {idx.change_percent >= 0 ? '+' : ''}{idx.change_percent}%
              </Tag>
            </div>
            <div style={{ marginTop: 8, borderTop: '1px solid #f0f0f0', paddingTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666' }}>
                <span>成交额</span>
                <span style={{ fontWeight: 500 }}>{formatTurnover(idx.turnover)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginTop: 2 }}>
                <span>量能变化</span>
                <span style={{
                  fontWeight: 600,
                  color: idx.turnover_change >= 0 ? '#e74c3c' : '#27ae60',
                }}>
                  {idx.turnover_change >= 0 ? '↑' : '↓'}{Math.abs(idx.turnover_change)}%
                </span>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* 实时成交额排行 */}
      <Card
        title="个股成交额排行"
        extra={
          <span style={{ fontSize: 12, color: '#999' }}>
            {loading ? <SpinLoading style={{ '--size': '12px' }} /> : `${turnoverData.length}只`}
          </span>
        }
      >
        {turnoverData.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📊</div>
            <div>暂无数据</div>
          </div>
        ) : (
          turnoverData.map((stock, index) => (
            <div key={stock.code} className="list-item" onClick={() => navigate(`/volume/realtime?code=${stock.code}`)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: index < 3 ? '#e74c3c' : '#999',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 600,
                }}>
                  {index + 1}
                </span>
                <div>
                  <div style={{ fontWeight: 500 }}>{stock.name}</div>
                  <div style={{ fontSize: 12, color: '#999' }}>{stock.code}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 500 }}>{formatTurnover(stock.turnover)}</div>
                  <Tag
                    color={stock.change_percent >= 0 ? 'error' : 'success'}
                    style={{ fontSize: 12 }}
                  >
                    {stock.change_percent >= 0 ? '+' : ''}{stock.change_percent}%
                  </Tag>
                </div>
                <Button
                  size="mini"
                  fill="none"
                  color="default"
                  onClick={(e) => handleDelete(e, stock)}
                  style={{ padding: '2px 6px' }}
                >
                  <CloseOutline style={{ fontSize: 12, color: '#ccc' }} />
                </Button>
              </div>
            </div>
          ))
        )}
      </Card>
    </div>
  )
}
