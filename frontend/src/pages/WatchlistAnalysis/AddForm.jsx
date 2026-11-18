import React, { useState, useEffect, useRef } from 'react'
import { Form, Input, TextArea, DatePicker, Button, Toast } from 'antd-mobile'
import { AddOutline, DeleteOutline } from 'antd-mobile-icons'
import { watchlistAnalysisApi, stockApi } from '../../services/api'
import dayjs from 'dayjs'

/**
 * 添加自选股表单组件
 * 不使用 Form.useForm()，避免 "useForm not connected" 警告
 */
export default function AddForm({ onSuccess }) {
  const [stockKeyword, setStockKeyword] = useState('')
  const [stockResults, setStockResults] = useState([])
  const [stockSearching, setStockSearching] = useState(false)
  const [showStockDropdown, setShowStockDropdown] = useState(false)
  const [selectedStock, setSelectedStock] = useState(null)
  // 默认时间：10:15
  const [dateTimeValue, setDateTimeValue] = useState(
    dayjs().hour(10).minute(15).second(0).toDate()
  )
  const [showDateTimePicker, setShowDateTimePicker] = useState(false)
  const [reasons, setReasons] = useState(['', '', ''])
  const [sector, setSector] = useState('')
  const [sectorOptions, setSectorOptions] = useState([])
  const searchTimerRef = useRef(null)
  const dropdownRef = useRef(null)

  // 板块候选（仅读库，不拉外部接口）
  useEffect(() => {
    watchlistAnalysisApi.getSectorOptions()
      .then(res => setSectorOptions(res.data || []))
      .catch(() => setSectorOptions([]))
  }, [])

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
    if (!selectedStock) { Toast.show('请选择股票'); return }
    if (!dateTimeValue) { Toast.show('请选择添加时间'); return }
    try {
      const validReasons = reasons.filter(r => r && r.trim())
      const data = {
        stock_code: selectedStock.code,
        stock_name: selectedStock.name,
        recommend_date: dayjs(dateTimeValue).format('YYYY-MM-DD'),
        recommend_time: dayjs(dateTimeValue).format('HH:mm'),
        recommend_price: values.recommend_price,
        notes: values.notes,
        reasons: validReasons,
        sector: sector.trim(),
        type: 'morning',
        source: '自选股',
      }
      await watchlistAnalysisApi.create(data)
      Toast.show('添加成功')
      onSuccess?.()
    } catch (error) {
      console.error('添加自选股失败:', error)
      Toast.show('添加失败')
    }
  }

  return (
    <>
      <h3 style={{ marginBottom: 16 }}>添加自选股</h3>
      <Form onFinish={handleFinish} layout="vertical">
        <Form.Item label="搜索股票" required>
          <div ref={dropdownRef} style={{ position: 'relative' }}>
            <Input
              placeholder="输入代码或名称搜索，如 603138 或 海量数据"
              value={stockKeyword}
              onChange={handleStockSearch}
              onFocus={() => stockResults.length > 0 && setShowStockDropdown(true)}
            />
            {showStockDropdown && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0,
                background: '#fff', border: '1px solid #e0e0e0', borderRadius: 8,
                maxHeight: 200, overflow: 'auto', zIndex: 100,
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              }}>
                {stockSearching ? (
                  <div style={{ padding: 12, textAlign: 'center', color: '#999', fontSize: 13 }}>搜索中...</div>
                ) : stockResults.length === 0 ? (
                  <div style={{ padding: 12, textAlign: 'center', color: '#999', fontSize: 13 }}>未找到匹配股票</div>
                ) : (
                  stockResults.map(s => (
                    <div key={s.code} onClick={() => handleSelectStock(s)}
                      style={{
                        padding: '10px 12px', display: 'flex', justifyContent: 'space-between',
                        alignItems: 'center', borderBottom: '1px solid #f5f5f5', cursor: 'pointer',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#f5f7fa'}
                      onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}
                    >
                      <span style={{ fontSize: 14, fontWeight: 500 }}>{s.name}</span>
                      <span style={{ fontSize: 12, color: '#999' }}>{s.code}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </Form.Item>
        <Form.Item label="添加时间" required>
          <div onClick={() => setShowDateTimePicker(true)}
            style={{ padding: '8px 0', fontSize: 14, color: dateTimeValue ? '#333' : '#ccc', cursor: 'pointer' }}>
            {dateTimeValue ? dayjs(dateTimeValue).format('YYYY-MM-DD HH:mm') : '请选择日期和时间'}
          </div>
          <DatePicker visible={showDateTimePicker} onClose={() => setShowDateTimePicker(false)}
            onConfirm={(val) => { setDateTimeValue(val); setShowDateTimePicker(false) }}
            precision="minute" defaultValue={dateTimeValue}
            style={{ '--header-button-font-size': '16px' }} />
        </Form.Item>
        <Form.Item name="recommend_price" label="添加时价格" rules={[{ required: true }]}>
          <Input type="number" placeholder="加入自选股时的价格" />
        </Form.Item>
        <Form.Item label="板块">
          <Input
            placeholder="可选，如 光伏设备（不填则自动取所属板块）"
            value={sector}
            onChange={setSector}
          />
          {sectorOptions.length > 0 && (
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginTop: 8, paddingBottom: 2 }}>
              {sectorOptions.slice(0, 30).map(name => {
                const active = sector === name
                return (
                  <span
                    key={name}
                    onClick={() => setSector(active ? '' : name)}
                    style={{
                      fontSize: 12, padding: '2px 8px', borderRadius: 10, cursor: 'pointer', whiteSpace: 'nowrap',
                      background: active ? '#8B3A42' : '#f5f5f5',
                      color: active ? '#fff' : '#666',
                    }}
                  >{name}</span>
                )
              })}
            </div>
          )}
        </Form.Item>
        <Form.Item name="notes" label="备注">
          <TextArea placeholder="可选，补充说明" rows={2} />
        </Form.Item>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: '#333', marginBottom: 8, fontWeight: 500 }}>自选理由（可选）</div>
          {reasons.map((reason, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Input
                placeholder={`理由${idx + 1}（可选）`}
                value={reason}
                onChange={(val) => {
                  const newReasons = [...reasons]
                  newReasons[idx] = val
                  setReasons(newReasons)
                }}
                style={{ flex: 1, fontSize: 13 }}
              />
              {reasons.length > 1 && (
                <span onClick={() => setReasons(reasons.filter((_, i) => i !== idx))}
                  style={{ color: '#999', cursor: 'pointer', fontSize: 16, flexShrink: 0 }}>
                  <DeleteOutline />
                </span>
              )}
            </div>
          ))}
          {reasons.length < 3 && (
            <span onClick={() => setReasons([...reasons, ''])}
              style={{ fontSize: 12, color: '#8B3A42', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2 }}>
              <AddOutline /> 添加理由
            </span>
          )}
        </div>
        <Button block type="submit" color="primary" size="large">保存</Button>
      </Form>
    </>
  )
}
