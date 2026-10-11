import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Grid, Button } from 'antd-mobile'

// 机构入口
const institutions = [
  { key: 'lixiang', title: '李享财经', desc: '早盘/午盘推荐', path: '/recommendation?source=李享财经', color: '#1677ff' },
  { key: 'goldman', title: '高盛', desc: '研报追踪', path: '/goldman-sachs', color: '#0066cc' },
]

const features = [
  { key: 'recommendation', title: '推荐管理', desc: '早盘/午盘推荐记录', path: '/recommendation', color: '#1677ff' },
  { key: 'calendar', title: '推荐日历', desc: '日历视图查看推荐', path: '/recommendation/calendar', color: '#00b578' },
  { key: 'volume-analysis', title: '量能分析', desc: '30日量能平均值', path: '/volume/analysis', color: '#ff8f1f' },
  { key: 'volume-realtime', title: '实时放量缩量', desc: '类似同花顺', path: '/volume/realtime', color: '#e74c3c' },
  { key: 'position', title: '仓位管理', desc: '阶梯式加仓策略', path: '/position', color: '#9c27b0' },
  { key: 'shanghai-news', title: '上海证券报', desc: '每日提到的股票', path: '/shanghai-news', color: '#009688' },
  { key: 'goldman-sachs', title: '高盛研报', desc: '每日研报追踪', path: '/goldman-sachs', color: '#0066cc' },
]

export default function Features() {
  const navigate = useNavigate()

  const renderButton = (f) => (
    <Button
      block
      style={{
        height: 80,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fff',
        border: '1px solid #eee',
        borderRadius: 12,
      }}
      onClick={() => navigate(f.path)}
    >
      <div style={{ fontSize: 15, fontWeight: 600, color: f.color }}>{f.title}</div>
      <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>{f.desc}</div>
    </Button>
  )

  return (
    <div className="page-container">
      {/* 机构入口 */}
      <Card title="机构" style={{ marginBottom: 12 }}>
        <Grid columns={2} gap={12}>
          {institutions.map(f => (
            <Grid.Item key={f.key}>{renderButton(f)}</Grid.Item>
          ))}
        </Grid>
      </Card>

      {/* 功能模块 */}
      <Card title="功能">
        <Grid columns={2} gap={12}>
          {features.map(f => (
            <Grid.Item key={f.key}>{renderButton(f)}</Grid.Item>
          ))}
        </Grid>
      </Card>
    </div>
  )
}
