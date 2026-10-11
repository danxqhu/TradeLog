import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, NavBar, Button, Tag } from 'antd-mobile'
import { LeftOutline, LeftOutline as PrevIcon, RightOutline as NextIcon } from 'antd-mobile-icons'
import dayjs from 'dayjs'

export default function RecommendationCalendar() {
  const navigate = useNavigate()
  const [currentMonth, setCurrentMonth] = useState(dayjs())

  // 模拟推荐数据
  const recommendData = {
    '2026-10-11': [{ stock_name: '贵州茅台', type: 'morning' }, { stock_name: '宁德时代', type: 'afternoon' }],
    '2026-10-10': [{ stock_name: '五粮液', type: 'morning' }, { stock_name: '比亚迪', type: 'afternoon' }],
    '2026-10-09': [{ stock_name: '中国平安', type: 'morning' }],
    '2026-10-08': [{ stock_name: '招商银行', type: 'morning' }, { stock_name: '隆基绿能', type: 'afternoon' }],
  }

  const year = currentMonth.year()
  const month = currentMonth.month() + 1
  const daysInMonth = currentMonth.daysInMonth()
  const firstDayOfWeek = currentMonth.startOf('month').day()

  const prevMonth = () => setCurrentMonth(currentMonth.subtract(1, 'month'))
  const nextMonth = () => setCurrentMonth(currentMonth.add(1, 'month'))

  const renderDays = () => {
    const cells = []
    const weekDays = ['日', '一', '二', '三', '四', '五', '六']

    // 星期标题
    weekDays.forEach(d => cells.push(
      <div key={`h-${d}`} style={{ textAlign: 'center', fontSize: 12, color: '#999', padding: 8 }}>{d}</div>
    ))

    // 空白填充
    for (let i = 0; i < firstDayOfWeek; i++) {
      cells.push(<div key={`e-${i}`} />)
    }

    // 日期
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const recs = recommendData[dateStr]
      const hasRec = recs && recs.length > 0
      const hasMorning = recs?.some(r => r.type === 'morning')
      const hasAfternoon = recs?.some(r => r.type === 'afternoon')

      cells.push(
        <div
          key={day}
          style={{
            textAlign: 'center',
            padding: 4,
            minHeight: 50,
            background: hasRec ? '#f0f5ff' : 'transparent',
            borderRadius: 8,
            cursor: hasRec ? 'pointer' : 'default',
          }}
          onClick={() => hasRec && navigate(`/recommendation?date=${dateStr}`)}
        >
          <div style={{ fontSize: 14, fontWeight: hasRec ? 600 : 400 }}>{day}</div>
          {hasRec && (
            <div style={{ display: 'flex', gap: 2, justifyContent: 'center', marginTop: 2 }}>
              {hasMorning && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#faad14' }} />}
              {hasAfternoon && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#52c41a' }} />}
            </div>
          )}
        </div>
      )
    }

    return cells
  }

  return (
    <div className="page-container">
      <NavBar backIcon={<LeftOutline />} onBack={() => navigate(-1)}>推荐日历</NavBar>

      <Card style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Button size="small" fill="none" onClick={prevMonth}>{'<'}</Button>
          <span style={{ fontSize: 16, fontWeight: 600 }}>{year}年{month}月</span>
          <Button size="small" fill="none" onClick={nextMonth}>{'>'}</Button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
          {renderDays()}
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 16, fontSize: 12, color: '#999' }}>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#faad14', marginRight: 4 }} />早盘</span>
          <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#52c41a', marginRight: 4 }} />午盘</span>
        </div>
      </Card>
    </div>
  )
}
