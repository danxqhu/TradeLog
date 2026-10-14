import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, NavBar, Button, Tag, Form, Input, Toast, Empty, Popup, DatePicker, Selector } from 'antd-mobile'
import { LeftOutline, AddOutline } from 'antd-mobile-icons'
import { positionApi, stockApi } from '../../services/api'
import dayjs from 'dayjs'

export default function Position() {
  const navigate = useNavigate()
  const [positions, setPositions] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [editingPos, setEditingPos] = useState(null) // 正在编辑的持仓
  const [deletingPos, setDeletingPos] = useState(null) // 正在删除的持仓（第一步确认）
  const [confirmDeleteName, setConfirmDeleteName] = useState('') // 删除确认输入的股票名
  const [showStrategy, setShowStrategy] = useState(false) // 策略切换弹窗
  const [strategyPos, setStrategyPos] = useState(null) // 当前设置策略的持仓

  useEffect(() => {
    fetchPositions()
  }, [])

  const fetchPositions = async () => {
    try {
      const res = await positionApi.getList({ status: 'holding' })
      setPositions(res.data || [])
    } catch (error) {
      console.error('获取持仓列表失败:', error)
    }
  }

  const handleAddSuccess = () => {
    setShowAdd(false)
    fetchPositions()
  }

  const handleEditSuccess = () => {
    setEditingPos(null)
    fetchPositions()
  }

  // 删除流程：第二步 - 输入股票名确认
  const handleConfirmDelete = async () => {
    if (!deletingPos) return
    if (confirmDeleteName !== deletingPos.stock_name) {
      Toast.show('股票名称不匹配，请重新输入')
      return
    }
    try {
      await positionApi.deletePosition(deletingPos.id)
      Toast.show('删除成功')
      setDeletingPos(null)
      setConfirmDeleteName('')
      fetchPositions()
    } catch (error) {
      console.error('删除失败:', error)
      Toast.show('删除失败')
    }
  }

  const calcReturn = (pos) => {
    const avgCost = Number(pos.avg_cost) || Number(pos.buy_price)
    const currentPrice = Number(pos.current_price) || avgCost
    return avgCost > 0 ? ((currentPrice - avgCost) / avgCost * 100).toFixed(2) : '0.00'
  }

  // 汇总计算
  const totalProfitLoss = positions.reduce((sum, pos) => sum + Number(pos.profit_loss || 0), 0).toFixed(2)
  const totalCost = positions.reduce((sum, pos) => sum + Number(pos.avg_cost || pos.buy_price) * Number(pos.quantity), 0)
  const totalProfitPercent = totalCost > 0 ? ((Number(totalProfitLoss) / totalCost) * 100).toFixed(2) : '0.00'
  const isTotalPositive = Number(totalProfitLoss) >= 0

  const strategies = [
    { label: '矩形仓位', value: 'rectangle' },
    { label: '金字塔', value: 'pyramid' },
    { label: '漏斗形', value: 'funnel' },
  ]

  return (
    <div className="page-container">
      <NavBar backIcon={<LeftOutline />} onBack={() => navigate(-1)}>仓位管理</NavBar>

      {/* 总盈亏汇总 */}
      {positions.length > 0 && (
        <Card style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 12, color: '#999' }}>总盈亏</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: isTotalPositive ? '#e74c3c' : '#27ae60' }}>
                {isTotalPositive ? '+' : ''}{totalProfitLoss} 元
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: '#999' }}>总收益率</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: isTotalPositive ? '#e74c3c' : '#27ae60' }}>
                {isTotalPositive ? '+' : ''}{totalProfitPercent}%
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* 持仓列表 */}
      <Card
        title="我的持仓"
        extra={
          <Button size="small" color="primary" fill="none" onClick={() => setShowAdd(true)}>
            <AddOutline /> 新建
          </Button>
        }
        style={{ marginTop: 12 }}
      >
        {positions.length === 0 ? (
          <Empty description="暂无持仓" />
        ) : (
          positions.map(pos => {
            const ret = pos.profit_loss_percent || calcReturn(pos)
            const profitLoss = pos.profit_loss || ((Number(pos.current_price || pos.avg_cost || pos.buy_price) - Number(pos.avg_cost || pos.buy_price)) * Number(pos.quantity)).toFixed(2)
            const isPositive = Number(ret) >= 0
            const currentPrice = Number(pos.current_price) || Number(pos.avg_cost) || Number(pos.buy_price)
            return (
              <div key={pos.id} style={{ padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', lineHeight: '20px' }}>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{pos.stock_name}</span>
                    <span style={{ fontSize: 11, color: '#999', marginLeft: 4 }}>{pos.stock_code}</span>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: isPositive ? '#e74c3c' : '#27ae60' }}>
                    {isPositive ? '+' : ''}{ret}%
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#666', lineHeight: '18px' }}>
                  <span>成本¥{pos.avg_cost || pos.buy_price} | 现价<strong>¥{currentPrice}</strong></span>
                  <span style={{ color: isPositive ? '#e74c3c' : '#27ae60' }}>
                    {Number(profitLoss) >= 0 ? '+' : ''}{profitLoss}元
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#999', lineHeight: '18px' }}>
                  <span>{pos.holding_natural_days}天/{pos.holding_trading_days}交易日</span>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <Tag
                      color="primary"
                      style={{ fontSize: 10, padding: '0 4px', height: 18, lineHeight: '18px', cursor: 'pointer' }}
                      onClick={() => { setStrategyPos(pos); setShowStrategy(true) }}
                    >
                      {pos.configs?.[0]?.strategy_type ? strategies.find(s => s.value === pos.configs[0].strategy_type)?.label || '回本策略' : '策略'}
                    </Tag>
                    <Button size="mini" fill="none" color="primary" onClick={() => setEditingPos(pos)} style={{ fontSize: 11, padding: '0 4px' }}>编辑</Button>
                    <Button size="mini" fill="none" color="danger" onClick={() => setDeletingPos(pos)} style={{ fontSize: 11, padding: '0 4px' }}>删除</Button>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </Card>

      {/* 添加持仓弹窗 */}
      <Popup visible={showAdd} onMaskClick={() => setShowAdd(false)} bodyStyle={{ padding: 16, borderTopLeftRadius: 12, borderTopRightRadius: 12, minHeight: '50vh' }}>
        {showAdd && (
          <PositionForm onSuccess={handleAddSuccess} />
        )}
      </Popup>

      {/* 编辑持仓弹窗 */}
      <Popup visible={!!editingPos} onMaskClick={() => setEditingPos(null)} bodyStyle={{ padding: 16, borderTopLeftRadius: 12, borderTopRightRadius: 12, minHeight: '50vh' }}>
        {editingPos && (
          <PositionForm position={editingPos} onSuccess={handleEditSuccess} />
        )}
      </Popup>

      {/* 删除确认弹窗 - 需要输入股票名才能删除 */}
      <Popup
        visible={!!deletingPos}
        onMaskClick={() => { setDeletingPos(null); setConfirmDeleteName('') }}
        bodyStyle={{ padding: 16, borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        {deletingPos && (
          <>
            <h3 style={{ marginBottom: 8, color: '#e74c3c' }}>⚠️ 确认删除</h3>
            <p style={{ fontSize: 14, color: '#666', marginBottom: 4 }}>
              你确定要删除以下持仓吗？此操作<strong>不可恢复</strong>！
            </p>
            <div style={{ padding: '8px 12px', background: '#f5f5f5', borderRadius: 8, marginBottom: 16 }}>
              <div><strong>{deletingPos.stock_name}</strong>（{deletingPos.stock_code}）</div>
              <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                成本: ¥{deletingPos.avg_cost || deletingPos.buy_price} | 数量: {deletingPos.quantity}股
              </div>
            </div>
            <p style={{ fontSize: 13, color: '#333', marginBottom: 8 }}>
              请输入股票名称 <strong>「{deletingPos.stock_name}」</strong> 以确认：
            </p>
            <Input
              placeholder={`输入 ${deletingPos.stock_name}`}
              value={confirmDeleteName}
              onChange={setConfirmDeleteName}
              style={{ marginBottom: 16 }}
            />
            <div style={{ display: 'flex', gap: 12 }}>
              <Button block onClick={() => { setDeletingPos(null); setConfirmDeleteName('') }}>
                取消
              </Button>
              <Button
                block
                color="danger"
                disabled={confirmDeleteName !== deletingPos.stock_name}
                onClick={handleConfirmDelete}
              >
                确认删除
              </Button>
            </div>
          </>
        )}
      </Popup>

      {/* 回本策略弹窗 - 每只股票单独设置 */}
      <Popup
        visible={showStrategy}
        onMaskClick={() => { setShowStrategy(false); setStrategyPos(null) }}
        bodyStyle={{ padding: 16, borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        {strategyPos && (
          <StrategySelector
            position={strategyPos}
            strategies={strategies}
            onClose={() => { setShowStrategy(false); setStrategyPos(null) }}
            onSaved={() => { setShowStrategy(false); setStrategyPos(null); fetchPositions() }}
          />
        )}
      </Popup>
    </div>
  )
}

// 新建/编辑持仓表单
function PositionForm({ position, onSuccess }) {
  const isEdit = !!position
  const [stockKeyword, setStockKeyword] = useState(position ? `${position.stock_code} ${position.stock_name}` : '')
  const [stockResults, setStockResults] = useState([])
  const [stockSearching, setStockSearching] = useState(false)
  const [showStockDropdown, setShowStockDropdown] = useState(false)
  const [selectedStock, setSelectedStock] = useState(position ? { code: position.stock_code, name: position.stock_name } : null)
  const [dateValue, setDateValue] = useState(position ? dayjs(position.buy_date) : null)
  const [showDatePicker, setShowDatePicker] = useState(false)
  const searchTimerRef = useRef(null)
  const dropdownRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setShowStockDropdown(false)
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  const handleStockSearch = (keyword) => {
    setStockKeyword(keyword)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (!keyword || keyword.length < 2) { setStockResults([]); setShowStockDropdown(false); return }
    searchTimerRef.current = setTimeout(async () => {
      setStockSearching(true)
      try {
        const res = await stockApi.getList({ search: keyword, pageSize: 15 })
        setStockResults(res.data || [])
        setShowStockDropdown(true)
      } catch (e) { setStockResults([]) }
      setStockSearching(false)
    }, 300)
  }

  const handleSelectStock = (stock) => {
    setSelectedStock({ code: stock.code, name: stock.name })
    setStockKeyword(`${stock.code} ${stock.name}`)
    setShowStockDropdown(false)
  }

  const handleFinish = async (values) => {
    if (!isEdit && !selectedStock) { Toast.show('请选择股票'); return }
    if (!dateValue) { Toast.show('请选择买入日期'); return }
    try {
      const data = {
        buy_date: dayjs(dateValue).format('YYYY-MM-DD'),
        buy_price: values.buy_price,
        quantity: parseInt(values.quantity),
      }
      if (isEdit) {
        await positionApi.update(position.id, data)
        Toast.show('修改成功')
      } else {
        data.stock_code = selectedStock.code
        data.stock_name = selectedStock.name
        await positionApi.create(data)
        Toast.show('持仓添加成功')
      }
      onSuccess?.()
    } catch (error) {
      console.error(isEdit ? '修改失败:' : '添加失败:', error)
      Toast.show(isEdit ? '修改失败' : '添加失败')
    }
  }

  return (
    <>
      <h3 style={{ marginBottom: 16 }}>{isEdit ? '编辑持仓' : '新建持仓'}</h3>
      <Form onFinish={handleFinish} layout="vertical" initialValues={isEdit ? { buy_price: position.buy_price, quantity: position.quantity } : {}}>
        {!isEdit && (
          <Form.Item label="搜索股票" required>
            <div ref={dropdownRef} style={{ position: 'relative' }}>
              <Input placeholder="输入代码或名称搜索" value={stockKeyword} onChange={handleStockSearch} onFocus={() => stockResults.length > 0 && setShowStockDropdown(true)} />
              {showStockDropdown && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8, maxHeight: 200, overflow: 'auto', zIndex: 100, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                  {stockSearching ? (
                    <div style={{ padding: 12, textAlign: 'center', color: '#999', fontSize: 13 }}>搜索中...</div>
                  ) : stockResults.length === 0 ? (
                    <div style={{ padding: 12, textAlign: 'center', color: '#999', fontSize: 13 }}>未找到匹配股票</div>
                  ) : (
                    stockResults.map(s => (
                      <div key={s.code} onClick={() => handleSelectStock(s)} style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f5f5f5', cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f5f7fa'} onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}>
                        <span style={{ fontSize: 14, fontWeight: 500 }}>{s.name}</span>
                        <span style={{ fontSize: 12, color: '#999' }}>{s.code}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </Form.Item>
        )}
        {isEdit && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: '#f5f5f5', borderRadius: 8 }}>
            <span style={{ fontWeight: 600 }}>{position.stock_name}</span>
            <span style={{ color: '#999', marginLeft: 8 }}>{position.stock_code}</span>
          </div>
        )}
        <Form.Item label="买入日期" required>
          <div onClick={() => setShowDatePicker(true)} style={{ padding: '8px 0', fontSize: 14, color: dateValue ? '#333' : '#ccc', cursor: 'pointer' }}>
            {dateValue ? dayjs(dateValue).format('YYYY-MM-DD') : '请选择日期'}
          </div>
          <DatePicker visible={showDatePicker} onClose={() => setShowDatePicker(false)} onConfirm={(val) => { setDateValue(val); setShowDatePicker(false) }} style={{ '--header-button-font-size': '16px' }} />
        </Form.Item>
        <Form.Item name="buy_price" label="买入价格（成本价）" rules={[{ required: true }]}>
          <Input type="number" placeholder="买入时的价格" />
        </Form.Item>
        <Form.Item name="quantity" label="买入数量(股)" rules={[{ required: true }]}>
          <Input type="number" placeholder="买入股数" />
        </Form.Item>
        <Button block type="submit" color="primary" size="large">{isEdit ? '保存修改' : '保存'}</Button>
      </Form>
    </>
  )
}

// 策略选择器组件（每只股票单独设置）
function StrategySelector({ position, strategies, onClose, onSaved }) {
  const currentStrategy = position.configs?.[0]?.strategy_type || ''
  const [selected, setSelected] = useState(currentStrategy)
  const [saving, setSaving] = useState(false)

  const desc = {
    rectangle: '资金5等份，每次加仓20%',
    pyramid: '首次50%，后续30%、20%',
    funnel: '首次10%，逐步加大到30%',
  }

  const handleSave = async () => {
    if (!selected) { Toast.show('请选择策略'); return }
    setSaving(true)
    try {
      await positionApi.setConfig({
        stock_code: position.stock_code,
        strategy_type: selected,
        total_capital: Number(position.avg_cost || position.buy_price) * Number(position.quantity),
      })
      Toast.show('策略已保存')
      onSaved?.()
    } catch (error) {
      console.error('保存策略失败:', error)
      Toast.show('保存失败')
    }
    setSaving(false)
  }

  return (
    <>
      <h3 style={{ marginBottom: 4 }}>回本策略</h3>
      <p style={{ fontSize: 13, color: '#999', marginBottom: 16 }}>
        {position.stock_name}（{position.stock_code}）
      </p>
      {strategies.map(s => (
        <div
          key={s.value}
          onClick={() => setSelected(s.value)}
          style={{
            padding: '12px 16px',
            background: selected === s.value ? '#e6f4ff' : '#f5f5f5',
            border: selected === s.value ? '2px solid #1677ff' : '2px solid transparent',
            borderRadius: 8,
            marginBottom: 8,
            cursor: 'pointer',
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4, color: selected === s.value ? '#1677ff' : '#333' }}>{s.label}</div>
          <div style={{ fontSize: 12, color: '#666' }}>{desc[s.value]}</div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <Button block onClick={onClose}>取消</Button>
        <Button block color="primary" loading={saving} onClick={handleSave}>保存</Button>
      </div>
    </>
  )
}
