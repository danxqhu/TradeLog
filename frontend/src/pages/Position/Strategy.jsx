import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Card, NavBar, Tag, Button, Steps, Toast } from 'antd-mobile'
import { LeftOutline } from 'antd-mobile-icons'

const strategyDetails = {
  rectangle: {
    name: '矩形仓位法', steps: [
      { title: '首次买入', ratio: '20%', trigger: '建仓' },
      { title: '第1次加仓', ratio: '20%', trigger: '跌10%' },
      { title: '第2次加仓', ratio: '20%', trigger: '跌20%' },
      { title: '第3次加仓', ratio: '20%', trigger: '跌30%' },
      { title: '第4次加仓', ratio: '20%', trigger: '跌40%' },
    ],
  },
  pyramid: {
    name: '金字塔仓位法', steps: [
      { title: '首次买入', ratio: '50%', trigger: '建仓' },
      { title: '第1次加仓', ratio: '30%', trigger: '确认上涨' },
      { title: '第2次加仓', ratio: '20%', trigger: '继续上涨' },
    ],
  },
  funnel: {
    name: '漏斗形仓位法', steps: [
      { title: '首次买入', ratio: '10%', trigger: '建仓' },
      { title: '第1次加仓', ratio: '15%', trigger: '跌10%' },
      { title: '第2次加仓', ratio: '20%', trigger: '跌20%' },
      { title: '第3次加仓', ratio: '25%', trigger: '跌30%' },
      { title: '第4次加仓', ratio: '30%', trigger: '跌40%' },
    ],
  },
}

export default function PositionStrategy() {
  const { stockCode } = useParams()
  const navigate = useNavigate()
  const strategy = 'funnel' // 模拟当前策略
  const detail = strategyDetails[strategy]
  const currentStep = 1 // 已加仓次数

  const handleCheckAlert = () => {
    Toast.show('加仓提醒检查完成，已发送邮件')
  }

  return (
    <div className="page-container">
      <NavBar backIcon={<LeftOutline />} onBack={() => navigate(-1)}>
        仓位策略 - {stockCode}
      </NavBar>

      <Card title={`当前策略：${detail.name}`} style={{ marginTop: 12 }}>
        <Steps direction="vertical" current={currentStep}>
          {detail.steps.map((step, idx) => (
            <Steps.Step
              key={idx}
              title={
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{step.title}</span>
                  <Tag color={idx < currentStep ? 'success' : idx === currentStep ? 'warning' : 'default'}>
                    {step.ratio}
                  </Tag>
                </div>
              }
              description={`触发条件：${step.trigger}`}
              status={idx < currentStep ? 'finish' : idx === currentStep ? 'process' : 'wait'}
            />
          ))}
        </Steps>
      </Card>

      <Card title="加仓记录" style={{ marginTop: 12 }}>
        <div className="list-item">
          <div>
            <div style={{ fontWeight: 500 }}>首次买入</div>
            <div style={{ fontSize: 12, color: '#999' }}>2026-10-08 | ¥1850 | 100股</div>
          </div>
          <Tag color="success">已完成</Tag>
        </div>
        <div className="list-item">
          <div>
            <div style={{ fontWeight: 500 }}>第1次加仓 (跌10%)</div>
            <div style={{ fontSize: 12, color: '#999' }}>2026-10-10 | ¥1665 | 100股</div>
          </div>
          <Tag color="success">已完成</Tag>
        </div>
      </Card>

      <div style={{ padding: 12 }}>
        <Button block color="warning" size="large" onClick={handleCheckAlert}>
          检查加仓提醒
        </Button>
      </div>
    </div>
  )
}
