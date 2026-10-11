import React, { useState } from 'react'
import { Card, Button, Input, Empty, Dialog, Toast, Tag } from 'antd-mobile'
import { AddOutline, DeleteOutline } from 'antd-mobile-icons'

export default function Watchlist() {
  const [stocks, setStocks] = useState([
    { code: '600519', name: '贵州茅台', current_price: 1856.00, change_percent: 2.35, turnover: 8560000000 },
    { code: '000858', name: '五粮液', current_price: 156.80, change_percent: -1.28, turnover: 5230000000 },
    { code: '300750', name: '宁德时代', current_price: 215.60, change_percent: -2.18, turnover: 7230000000 },
  ])
  const [showAdd, setShowAdd] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')

  const handleAdd = async () => {
    if (!newCode || !newName) {
      Toast.show('请填写股票代码和名称')
      return
    }
    setStocks([...stocks, { code: newCode, name: newName, current_price: 0, change_percent: 0, turnover: 0 }])
    setNewCode('')
    setNewName('')
    setShowAdd(false)
    Toast.show('添加成功')
  }

  const handleDelete = (code) => {
    Dialog.confirm({
      content: `确定删除 ${code} 吗？`,
      onConfirm: () => {
        setStocks(stocks.filter(s => s.code !== code))
        Toast.show('已删除')
      },
    })
  }

  const formatTurnover = (value) => {
    if (value >= 100000000) return (value / 100000000).toFixed(2) + '亿'
    if (value >= 10000) return (value / 10000).toFixed(0) + '万'
    return value.toString()
  }

  return (
    <div className="page-container">
      <Card
        title="自选股"
        extra={
          <Button size="small" color="primary" fill="none" onClick={() => setShowAdd(!showAdd)}>
            <AddOutline /> 添加
          </Button>
        }
      >
        {showAdd && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Input placeholder="股票代码" value={newCode} onChange={setNewCode} style={{ flex: 1 }} />
            <Input placeholder="股票名称" value={newName} onChange={setNewName} style={{ flex: 1 }} />
            <Button color="primary" size="small" onClick={handleAdd}>确定</Button>
          </div>
        )}

        {stocks.length === 0 ? (
          <Empty description="暂无自选股" />
        ) : (
          stocks.map(stock => (
            <div key={stock.code} className="list-item">
              <div>
                <div style={{ fontWeight: 500 }}>{stock.name}</div>
                <div style={{ fontSize: 12, color: '#999' }}>{stock.code}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 500 }}>{stock.current_price > 0 ? `¥${stock.current_price}` : '--'}</div>
                  <Tag color={stock.change_percent >= 0 ? 'error' : 'success'} style={{ fontSize: 12 }}>
                    {stock.change_percent >= 0 ? '+' : ''}{stock.change_percent}%
                  </Tag>
                </div>
                <Button
                  size="mini"
                  fill="none"
                  color="danger"
                  onClick={() => handleDelete(stock.code)}
                >
                  <DeleteOutline />
                </Button>
              </div>
            </div>
          ))
        )}
      </Card>
    </div>
  )
}
