import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Card, Button, Input, Empty, Dialog, Tag, SpinLoading } from 'antd-mobile'
import { AddOutline, DeleteOutline, SearchOutline } from 'antd-mobile-icons'
import { useNavigate } from 'react-router-dom'
import { watchlistApi, stockApi } from '../../services/api'
import { formatAmount } from '../../utils/volumeAlert'
import { showAlert } from '../../utils/alert'

export default function Watchlist() {
  const navigate = useNavigate()
  const [stocks, setStocks] = useState([])          // 自选列表（数据库持久化）
  const [realtimeMap, setRealtimeMap] = useState({}) // code → 新浪实时行情
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [results, setResults] = useState([])        // 股票库搜索结果
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef(null)

  // 进页只拉一次（列表 + 实时行情），不做定时轮询；失败弹窗告知，不自动重试
  const loadList = useCallback(async () => {
    try {
      const res = await watchlistApi.getList()
      const list = res.data || []
      setStocks(list)
      if (list.length) {
        try {
          const rt = await stockApi.getRealtime(list.map(s => s.code).join(','))
          const map = {}
          ;(rt.data || []).forEach(item => { map[item.code] = item })
          setRealtimeMap(map)
        } catch (e) {
          showAlert(`实时行情获取失败：${e.response?.data?.error || e.message}。不会自动重试，退出页面重新进入可再拉一次。`, '行情获取失败')
        }
      }
    } catch (e) {
      showAlert(`自选列表加载失败：${e.response?.data?.error || e.message}。不会自动重试，退出页面重新进入可再拉一次。`, '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadList()
  }, [loadList])

  // 关键词防抖搜索股票库（代码/名称模糊匹配）
  const handleKeyword = (val) => {
    setKeyword(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!val.trim()) { setResults([]); return }
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await stockApi.getList({ search: val.trim(), pageSize: 15 })
        setResults(res.data || [])
      } catch (e) {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
  }

  const handleAdd = async (code) => {
    try {
      await watchlistApi.add(code)
      showAlert(`${code} 已加入自选`, '添加成功')
      setKeyword('')
      setResults([])
      setShowAdd(false)
      loadList()
    } catch (e) {
      showAlert(e.response?.data?.error || '添加失败', '添加失败')
    }
  }

  const handleDelete = (code, name) => {
    Dialog.confirm({
      content: `确定删除 ${name}(${code}) 吗？`,
      onConfirm: async () => {
        try {
          await watchlistApi.remove(code)
          setStocks(prev => prev.filter(s => s.code !== code))
          showAlert(`${name}(${code}) 已从自选移除`, '已删除')
        } catch (e) {
          showAlert(`删除失败：${e.response?.data?.error || e.message}`, '删除失败')
        }
      },
    })
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
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #eee', borderRadius: 8, padding: '6px 10px' }}>
              <SearchOutline color="#999" />
              <Input
                placeholder="搜索全市场 A 股（代码或名称）"
                value={keyword}
                onChange={handleKeyword}
                style={{ flex: 1 }}
              />
            </div>
            {searching && <div style={{ textAlign: 'center', padding: 8 }}><SpinLoading style={{ '--size': '20px' }} /></div>}
            {!searching && keyword.trim() && results.length === 0 && (
              <div style={{ padding: 8, fontSize: 12, color: '#999', textAlign: 'center' }}>股票库中无匹配结果</div>
            )}
            {results.length > 0 && (
              <div style={{ maxHeight: 220, overflowY: 'auto', borderTop: '1px solid #f5f5f5' }}>
                {results.map(s => (
                  <div
                    key={s.code}
                    onClick={() => handleAdd(s.code)}
                    style={{ display: 'flex', alignItems: 'center', padding: '8px 4px', borderBottom: '1px solid #f5f5f5', cursor: 'pointer' }}
                  >
                    <div>
                      <span style={{ fontWeight: 500, fontSize: 13 }}>{s.name}</span>
                      <span style={{ fontSize: 12, color: '#999', marginLeft: 8 }}>{s.code}</span>
                    </div>
                    <Tag style={{ marginLeft: 'auto', fontSize: 10 }} color={s.market === 'SH' ? 'red' : s.market === 'SZ' ? 'blue' : 'orange'}>
                      {s.market === 'SH' ? '沪' : s.market === 'SZ' ? '深' : '北'}
                    </Tag>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 20 }}><SpinLoading /></div>
        ) : stocks.length === 0 ? (
          <Empty description="暂无自选股，点右上「添加」从股票库搜索" />
        ) : (
          stocks.map(stock => {
            const rt = realtimeMap[stock.code]
            const pct = rt ? Number(rt.change_percent) : null
            return (
              <div
                key={stock.code}
                className="list-item"
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/watchlist/${stock.code}`)}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>{stock.name}</div>
                  <div style={{ fontSize: 12, color: '#999' }}>{stock.code}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 500 }}>{rt && rt.current_price > 0 ? `¥${rt.current_price}` : '--'}</div>
                    {pct !== null && !Number.isNaN(pct) ? (
                      <Tag color={pct >= 0 ? 'error' : 'success'} style={{ fontSize: 12 }}>
                        {pct >= 0 ? '+' : ''}{pct}%
                      </Tag>
                    ) : (
                      <span style={{ fontSize: 12, color: '#999' }}>{rt && rt.turnover ? formatAmount(rt.turnover) : ''}</span>
                    )}
                  </div>
                  <Button
                    size="mini"
                    fill="none"
                    color="danger"
                    onClick={(e) => { e.stopPropagation(); handleDelete(stock.code, stock.name) }}
                  >
                    <DeleteOutline />
                  </Button>
                </div>
              </div>
            )
          })
        )}
      </Card>
    </div>
  )
}
