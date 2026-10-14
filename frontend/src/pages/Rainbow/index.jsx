import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, NavBar } from 'antd-mobile'
import { LeftOutline } from 'antd-mobile-icons'

export default function Rainbow() {
  const navigate = useNavigate()

  return (
    <div className="page-container">
      <NavBar backIcon={<LeftOutline />} onBack={() => navigate(-1)}>七道彩虹</NavBar>
      <Card title="七道彩虹">
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
          开发中...
        </div>
      </Card>
    </div>
  )
}
