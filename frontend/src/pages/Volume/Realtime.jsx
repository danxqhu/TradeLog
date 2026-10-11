import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, NavBar, Tag, Grid, Empty } from 'antd-mobile'
import { LeftOutline } from 'antd-mobile-icons'

export default function VolumeRealtime() {
  const navigate = useNavigate()
  // 模拟实时放量缩量数据
  const stocks = [
    { code: '600519', name: '贵州茅台', current_vol: 18500000, avg_30d: 12560000, ratio: 1.47, is_up: true },
    { code: '000858', name: '五粮液', current_vol: 8200000, avg_30d: 10500000, ratio: 0.78, is_up: false },
    { code: '300750', name: '宁德时代', current_vol: 22000000, avg_30d: 15000000, ratio: 1.47, is_up: true },
    { code: '002594', name: '比亚迪', current_vol: 15800000, avg_30d: 12000000, ratio: 1.32, is_up: true },
    { code: '601318', name: '中国平安', current_vol: 6500000, avg_30d: 9800000, ratio: 0.66, is_up: false },
    { code: '600036', name: '招商银行', current_vol: 9200000, avg_30d: 8500000, ratio: 1.08, is_up: true },
  ]

  const formatVol = (v) => v >= 10000 ? (v / 10000).toFixed(0) + '万' : v

  return (
    <div className="page-container">
      <NavBar backIcon={<LeftOutline />} onBack={() => navigate(-1)}>实时放量/缩量</NavBar>

      <Card style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, color: '#999', marginBottom: 12 }}>
          对比30日平均成交量，红色=放量，绿色=缩量
        </div>

        {stocks.map(stock => (
          <div key={stock.code} style={{ marginBottom: 16, padding: 12, background: stock.is_up ? '#fff5f5' : '#f0fff0', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div>
                <span style={{ fontWeight: 600 }}>{stock.name}</span>
                <span style={{ fontSize: 12, color: '#999', marginLeft: 8 }}>{stock.code}</span>
              </div>
              <Tag color={stock.is_up ? 'error' : 'success'} style={{ fontWeight: 600 }}>
                {stock.is_up ? '放量' : '缩量'} {stock.ratio}x
              </Tag>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span>当前量: <strong>{formatVol(stock.current_vol)}</strong></span>
              <span>30日均量: {formatVol(stock.avg_30d)}</span>
            </div>
            <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#999', marginBottom: 2 }}>
                <span>0</span>
                <span>均量</span>
                <span>2x</span>
              </div>
              <div style={{ height: 8, background: '#eee', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${Math.min(stock.ratio / 2 * 100, 100)}%`,
                  background: stock.is_up ? '#e74c3c' : '#27ae60',
                  borderRadius: 4,
                  transition: 'width 0.3s',
                }} />
              </div>
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}
