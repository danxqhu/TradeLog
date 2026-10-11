import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, NavBar, Input, Button, Tag, DatePicker, Empty, Space } from 'antd-mobile'
import { LeftOutline } from 'antd-mobile-icons'
import dayjs from 'dayjs'

export default function VolumeAnalysis() {
  const navigate = useNavigate()
  const [stockCode, setStockCode] = useState('')
  const [selectedDate, setSelectedDate] = useState(dayjs().format('YYYY-MM-DD'))
  const [volumeData, setVolumeData] = useState(null)

  const handleQuery = () => {
    if (!stockCode) return
    // 模拟30日量能数据
    const mockData = {
      stock_code: stockCode,
      avg_volume_30d: 12560000,
      avg_turnover_30d: 356000000,
      record_count: 30,
      latest_date: selectedDate,
      history: Array.from({ length: 10 }, (_, i) => ({
        date: dayjs(selectedDate).subtract(i, 'day').format('YYYY-MM-DD'),
        volume: Math.floor(Math.random() * 20000000 + 5000000),
        avg_30d: 12560000,
        is_up: Math.random() > 0.5,
      })),
    }
    setVolumeData(mockData)
  }

  const formatVolume = (v) => {
    if (v >= 100000000) return (v / 100000000).toFixed(2) + '亿'
    if (v >= 10000) return (v / 10000).toFixed(0) + '万'
    return v
  }

  return (
    <div className="page-container">
      <NavBar backIcon={<LeftOutline />} onBack={() => navigate(-1)}>30日量能分析</NavBar>

      <Card style={{ marginTop: 12 }}>
        <div style={{ marginBottom: 12 }}>
          <Space>
            <Input placeholder="输入股票代码" value={stockCode} onChange={setStockCode} style={{ width: 150 }} />
            <Button color="primary" size="small" onClick={handleQuery}>查询</Button>
          </Space>
        </div>

        {volumeData ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-around', marginBottom: 16, textAlign: 'center' }}>
              <div>
                <div className="stat-value">{formatVolume(volumeData.avg_volume_30d)}</div>
                <div className="stat-label">30日均量</div>
              </div>
              <div>
                <div className="stat-value">{formatVolume(volumeData.avg_turnover_30d)}</div>
                <div className="stat-label">30日均额</div>
              </div>
            </div>

            <div style={{ fontWeight: 500, marginBottom: 8 }}>历史量能对比</div>
            {volumeData.history.map((item, idx) => (
              <div key={idx} className="list-item">
                <span style={{ fontSize: 13 }}>{item.date}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{formatVolume(item.volume)}</span>
                  <Tag color={item.is_up ? 'error' : 'success'} style={{ fontSize: 11 }}>
                    {item.is_up ? '放量' : '缩量'}
                  </Tag>
                </div>
              </div>
            ))}
          </>
        ) : (
          <Empty description="输入股票代码查询量能数据" />
        )}
      </Card>
    </div>
  )
}
