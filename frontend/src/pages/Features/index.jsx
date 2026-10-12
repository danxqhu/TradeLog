import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Dialog, Toast } from 'antd-mobile'

// 默认功能顺序
const defaultFeatures = [
  { key: 'shanghai-news', title: '上海证券报', desc: '每日提到的股票', path: '/shanghai-news', color: '#009688' },
  { key: 'goldman-sachs', title: '高盛研报', desc: '每日研报追踪', path: '/goldman-sachs', color: '#0066cc' },
  { key: 'shao', title: '邵先生', desc: '邵先生专区', path: '/shao', color: '#ff6b81' },
  { key: 'finance-report', title: '财报分析', desc: '财务报表深度解析', path: '/finance-report', color: '#5b8c00' },
  { key: 'recommendation', title: '推荐管理', desc: '早盘/午盘推荐记录', path: '/recommendation', color: '#1677ff' },
  { key: 'calendar', title: '推荐日历', desc: '日历视图查看推荐', path: '/recommendation/calendar', color: '#00b578' },
  { key: 'volume-analysis', title: '量能分析', desc: '30日量能平均值', path: '/volume/analysis', color: '#ff8f1f' },
  { key: 'volume-realtime', title: '实时放量缩量', desc: '类似同花顺', path: '/volume/realtime', color: '#e74c3c' },
  { key: 'position', title: '仓位管理', desc: '阶梯式加仓策略', path: '/position', color: '#9c27b0' },
]

// 机构入口（固定顺序）
const institutions = [
  { key: 'lixiang', title: '李享财经', desc: '早盘/午盘推荐', path: '/recommendation?source=李享财经', color: '#1677ff' },
]

export default function Features() {
  const navigate = useNavigate()
  
  // 从 localStorage 读取保存的顺序
  const [features, setFeatures] = useState(() => {
    try {
      const saved = localStorage.getItem('features_order')
      if (saved) {
        const order = JSON.parse(saved)
        // 根据保存的顺序重新排列
        const sorted = order.map(key => defaultFeatures.find(f => f.key === key)).filter(Boolean)
        // 添加可能新增的项目
        const existingKeys = new Set(order)
        const newItems = defaultFeatures.filter(f => !existingKeys.has(f.key))
        return [...sorted, ...newItems]
      }
    } catch (e) {}
    return defaultFeatures
  })
  
  const [draggedItem, setDraggedItem] = useState(null)
  const [dragOverItem, setDragOverItem] = useState(null)
  const [isDragging, setIsDragging] = useState(false)

  // 保存顺序到 localStorage
  useEffect(() => {
    localStorage.setItem('features_order', JSON.stringify(features.map(f => f.key)))
  }, [features])

  // 拖拽开始
  const handleDragStart = (e, item) => {
    setDraggedItem(item)
    setIsDragging(true)
    e.dataTransfer.effectAllowed = 'move'
  }

  // 拖拽经过
  const handleDragOver = (e, item) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (draggedItem?.key !== item.key) {
      setDragOverItem(item)
    }
  }

  // 拖拽离开
  const handleDragLeave = () => {
    setDragOverItem(null)
  }

  // 放下
  const handleDrop = (e, targetItem) => {
    e.preventDefault()
    if (!draggedItem || draggedItem.key === targetItem.key) {
      setIsDragging(false)
      return
    }

    const newFeatures = [...features]
    const dragIdx = features.findIndex(f => f.key === draggedItem.key)
    const targetIdx = features.findIndex(f => f.key === targetItem.key)

    // 移动项目
    const [removed] = newFeatures.splice(dragIdx, 1)
    newFeatures.splice(targetIdx, 0, removed)

    setFeatures(newFeatures)
    setDraggedItem(null)
    setDragOverItem(null)
    setIsDragging(false)
    Toast.show({ content: '已调整顺序', duration: 1000 })
  }

  // 拖拽结束
  const handleDragEnd = () => {
    setDraggedItem(null)
    setDragOverItem(null)
    setIsDragging(false)
  }

  // 重置顺序
  const handleResetOrder = () => {
    Dialog.confirm({
      content: '确定要恢复默认顺序吗？',
      onConfirm: () => {
        setFeatures(defaultFeatures)
        Toast.show({ content: '已恢复默认顺序', duration: 1000 })
      },
    })
  }

  const renderButton = (f) => {
    const isDragged = draggedItem?.key === f.key
    const isDragOver = dragOverItem?.key === f.key
    
    return (
      <div
        draggable
        onDragStart={(e) => handleDragStart(e, f)}
        onDragOver={(e) => handleDragOver(e, f)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, f)}
        onDragEnd={handleDragEnd}
        style={{
          height: 64,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: isDragged ? '#f0f0f0' : isDragOver ? '#e6f4ff' : '#fff',
          border: `1px solid ${isDragOver ? '#1677ff' : '#eee'}`,
          borderRadius: 10,
          padding: '8px 4px',
          cursor: isDragging ? 'grabbing' : 'grab',
          transition: 'all 0.2s ease',
          opacity: isDragged ? 0.5 : 1,
          touchAction: 'none',
        }}
        onClick={() => !isDragging && navigate(f.path)}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: f.color, lineHeight: 1.3 }}>{f.title}</div>
        <div style={{ fontSize: 10, color: '#999', marginTop: 2, lineHeight: 1.2 }}>{f.desc}</div>
      </div>
    )
  }

  return (
    <div className="page-container">
      {/* 机构入口 */}
      <Card title="机构" style={{ marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {institutions.map(f => (
            <div key={f.key}>{renderButton(f)}</div>
          ))}
        </div>
      </Card>

      {/* 功能模块 */}
      <Card 
        title="功能" 
        extra={
          <span 
            onClick={handleResetOrder}
            style={{ fontSize: 12, color: '#1677ff', cursor: 'pointer' }}
          >
            重置顺序
          </span>
        }
      >
        <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>
          💡 长按拖拽可调整顺序
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {features.map(f => (
            <div key={f.key}>{renderButton(f)}</div>
          ))}
        </div>
      </Card>
    </div>
  )
}
