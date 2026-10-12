import React from 'react'
import { useNavigate } from 'react-router-dom'
import { NavBar, Card, Empty } from 'antd-mobile'
import { LeftOutline } from 'antd-mobile-icons'

export default function FinanceReport() {
  const navigate = useNavigate()

  return (
    <div className="page-container">
      <NavBar backIcon={<LeftOutline />} onBack={() => navigate(-1)}>财报分析</NavBar>

      <Card style={{ marginTop: 12 }}>
        <Empty description="暂无内容，敬请期待" />
      </Card>
    </div>
  )
}
