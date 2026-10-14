import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Card, Button, Tag, Input, TextArea, Toast, Grid, NavBar, Space, SpinLoading, Popup, DatePicker } from 'antd-mobile'
import { LeftOutline, AddOutline, DeleteOutline } from 'antd-mobile-icons'
import { recommendationApi, stockApi, calendarApi } from '../../services/api'
import dayjs from 'dayjs'

export default function RecommendationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [recommendation, setRecommendation] = useState(null)
  const [returns, setReturns] = useState({})
  const [bestReturn, setBestReturn] = useState({ best_close: null, best_high: null })
  const [customDays, setCustomDays] = useState('')
  const [customReturn, setCustomReturn] = useState(null)
  const [loading, setLoading] = useState(true)
  const [updatingPrice, setUpdatingPrice] = useState(false)
  const [targetDates, setTargetDates] = useState({}) // 各周期的目标日期
  // 自定义天数列表（持久化到 localStorage）
  const [customPeriods, setCustomPeriods] = useState(() => {
    try {
      const saved = localStorage.getItem('rec_custom_periods')
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })

  // 编辑 & 删除
  const [showEdit, setShowEdit] = useState(false)
  const [deletingRec, setDeletingRec] = useState(null)
  const [confirmDeleteName, setConfirmDeleteName] = useState('')
  const [resultMessage, setResultMessage] = useState('')

  // 计算各周期的目标日期（按交易日）
  const computeTargetDates = async (recommendDate) => {
    if (!recommendDate) return
    const periodDays = { '3d': 3, '7d': 7, '2w': 10, '1m': 22 }
    // 加入自定义天数
    customPeriods.forEach(cp => {
      periodDays[`custom_${cp.days}d`] = cp.days
    })
    const dates = {}
    for (const [key, days] of Object.entries(periodDays)) {
      try {
        const res = await calendarApi.addTradingDays(recommendDate, days)
        // res = { data: { start_date, add_days, target_date } }
        const targetDate = res.data?.target_date
        if (targetDate) {
          dates[key] = typeof targetDate === 'string' ? targetDate : targetDate.substring(0, 10)
        }
      } catch (e) {
        // ignore
      }
    }
    setTargetDates(dates)
  }

  // 获取推荐详情
  const fetchDetail = async () => {
    try {
      const res = await recommendationApi.getById(id)
      setRecommendation(res.data)
    } catch (error) {
      console.error('获取推荐详情失败:', error)
      Toast.show('获取详情失败')
    }
  }

  // 获取最高收益率
  const fetchBestReturn = async () => {
    try {
      const res = await recommendationApi.getBestReturn(id)
      setBestReturn(res.data || { best_close: null, best_high: null })
    } catch (error) {
      setBestReturn({ best_close: null, best_high: null })
    }
  }

  // 获取收益率统计
  const fetchReturns = async () => {
    try {
      const res = await recommendationApi.getReturns(id)
      setReturns(res.data || {})
    } catch (error) {
      // 可能还没有计算过收益率
      setReturns({})
    }
  }

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      await fetchDetail()
      await fetchReturns()
      await fetchBestReturn()
      setLoading(false)
    }
    load()
  }, [id])

  // 当 recommendation 或 customPeriods 变化后，计算各周期目标日期
  useEffect(() => {
    if (recommendation?.recommend_date) {
      const dateStr = typeof recommendation.recommend_date === 'string'
        ? recommendation.recommend_date
        : recommendation.recommend_date.substring(0, 10)
      computeTargetDates(dateStr)
    }
  }, [recommendation?.recommend_date, customPeriods])

  // 更新当前价格并计算收益率
  const handleUpdatePrice = async () => {
    if (!recommendation) return
    setUpdatingPrice(true)
    try {
      // 获取实时价格
      const res = await stockApi.getRealtime(recommendation.stock_code)
      const realtimeData = res.data && res.data[0]
      if (!realtimeData || !realtimeData.current_price) {
        Toast.show('获取实时价格失败')
        setUpdatingPrice(false)
        return
      }
      const currentPrice = realtimeData.current_price
      // 调用后端计算收益率
      const calcRes = await recommendationApi.calculateReturns(id, { current_price: currentPrice })
      // 刷新数据
      await fetchDetail()
      await fetchReturns()
      await fetchBestReturn()
      setResultMessage(calcRes.message || '已更新价格并计算收益率')
    } catch (error) {
      console.error('更新价格失败:', error)
      Toast.show('更新失败')
    }
    setUpdatingPrice(false)
  }

  // 添加自定义天数
  const handleAddCustomPeriod = () => {
    const days = parseInt(customDays)
    if (!days || days <= 0) {
      Toast.show('请输入有效天数')
      return
    }
    if (customPeriods.some(cp => cp.days === days)) {
      Toast.show('该天数已存在')
      return
    }
    const updated = [...customPeriods, { days }]
    setCustomPeriods(updated)
    localStorage.setItem('rec_custom_periods', JSON.stringify(updated))
    setCustomDays('')
  }

  // 删除自定义天数
  const handleDeleteCustomPeriod = (days) => {
    const updated = customPeriods.filter(cp => cp.days !== days)
    setCustomPeriods(updated)
    localStorage.setItem('rec_custom_periods', JSON.stringify(updated))
  }

  // 自定义天数收益率计算（使用交易日）
  const handleCalcCustom = async () => {
    if (!customDays || customDays <= 0) {
      Toast.show('请输入有效天数')
      return
    }
    try {
      // 先获取当前价格
      const res = await stockApi.getRealtime(recommendation.stock_code)
      const realtimeData = res.data && res.data[0]
      if (!realtimeData || !realtimeData.current_price) {
        Toast.show('获取实时价格失败')
        return
      }
      const currentPrice = realtimeData.current_price
      // 调用后端接口计算自定义天数收益率（后端会用交易日计算）
      const calcRes = await recommendationApi.calculateCustom(id, {
        custom_days: parseInt(customDays),
        current_price: currentPrice,
      })
      if (!calcRes.data) {
        // 目标日期未到期
        Toast.show(calcRes.message || '目标日期还未到期')
        return
      }
      const returnRate = parseFloat(calcRes.data.return_rate)
      setCustomReturn({
        days: customDays,
        return_rate: returnRate,
        check_price: currentPrice,
        target_date: calcRes.target_date,
        trading_days: calcRes.data.trading_days_count,
      })
      // 刷新详情和收益率
      await fetchDetail()
      await fetchReturns()
      Toast.show(calcRes.message || '计算完成')
    } catch (error) {
      console.error('计算自定义收益率失败:', error)
      Toast.show('计算失败')
    }
  }

  // 删除确认
  const handleConfirmDelete = async () => {
    if (!deletingRec) return
    if (confirmDeleteName !== deletingRec.stock_name) {
      Toast.show('股票名称不匹配，请重新输入')
      return
    }
    try {
      await recommendationApi.delete(deletingRec.id)
      Toast.show('删除成功')
      navigate(-1)
    } catch (error) {
      console.error('删除失败:', error)
      Toast.show('删除失败')
    }
  }

  if (loading) {
    return (
      <div className="page-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <SpinLoading color="primary" />
      </div>
    )
  }

  if (!recommendation) {
    return (
      <div className="page-container">
        <NavBar backIcon={<LeftOutline />} onBack={() => navigate(-1)}>推荐详情</NavBar>
        <Card style={{ marginTop: 12, textAlign: 'center', padding: 40 }}>
          推荐记录不存在
        </Card>
      </div>
    )
  }

  const currentReturn = ((recommendation.current_price - recommendation.recommend_price) / recommendation.recommend_price * 100).toFixed(2)

  const periods = [
    { key: '3d', label: '3天' },
    { key: '7d', label: '7天' },
    { key: '2w', label: '2周' },
    { key: '1m', label: '1月' },
  ]

  // 合并默认周期和自定义周期
  const allPeriods = [
    ...periods,
    ...customPeriods.map(cp => ({ key: `custom_${cp.days}d`, label: `${cp.days}天`, isCustom: true, days: cp.days })),
  ]

  // 从 returns.custom 数组中按天数查找对应数据
  const getCustomReturnData = (days) => {
    if (!returns.custom || !Array.isArray(returns.custom)) return null
    const found = returns.custom.find(c => c.custom_days === days)
    return found || null
  }

  return (
    <div className="page-container" style={{ '--adm-color-primary': '#8B3A42' }}>
      <NavBar backIcon={<LeftOutline />} onBack={() => navigate(-1)}>
        推荐详情
      </NavBar>

      <Card style={{ marginTop: 6, padding: '8px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{recommendation.stock_name}</span>
            <span style={{ fontSize: 11, color: '#999', marginLeft: 4 }}>{recommendation.stock_code}</span>
          </div>
          <Tag color={recommendation.type === 'morning' ? 'warning' : 'success'} style={{ fontSize: 10, padding: '0 4px', height: 18, lineHeight: '18px' }}>
            {recommendation.type === 'morning' ? '早盘' : '午盘'}
          </Tag>
        </div>
        <Grid columns={2} gap={4}>
          <div><span style={{ color: '#999', fontSize: 11 }}>推荐日期</span><div style={{ fontSize: 12 }}>{recommendation.recommend_date}</div></div>
          <div><span style={{ color: '#999', fontSize: 11 }}>推荐时间</span><div style={{ fontSize: 12 }}>{recommendation.recommend_time}</div></div>
          <div><span style={{ color: '#999', fontSize: 11 }}>推荐价格</span><div style={{ fontWeight: 600, fontSize: 12 }}>¥{recommendation.recommend_price}</div></div>
          <div>
            <span style={{ color: '#999', fontSize: 11 }}>当前价格</span>
            <div style={{ fontWeight: 600, fontSize: 12 }}>
              ¥{recommendation.current_price}
              <span style={{ fontSize: 10, color: currentReturn >= 0 ? '#e74c3c' : '#27ae60', marginLeft: 3 }}>
                {currentReturn >= 0 ? '+' : ''}{currentReturn}%
              </span>
            </div>
          </div>
        </Grid>
        {recommendation.reasons && recommendation.reasons.length > 0 && (
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {recommendation.reasons.map((reason, idx) => (
              <Tag key={idx} color="primary" fill="outline" style={{ fontSize: 11, padding: '2px 6px' }}>
                {reason}
              </Tag>
            ))}
          </div>
        )}
        {recommendation.notes && (
          <div style={{ marginTop: 6, padding: '4px 8px', background: '#f9f9f9', borderRadius: 6, fontSize: 11, color: '#666' }}>
            <span style={{ color: '#999' }}>备注：</span>{recommendation.notes}
          </div>
        )}
      </Card>

      {/* 编辑 / 获取最新价格并计算收益率 / 删除 */}
      <style>{`
        .rec-actions { display: flex; gap: 8px; margin-top: 6px; }
        .rec-actions .adm-button { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        @media (max-width: 540px) {
          .rec-actions .adm-button { font-size: 12px; padding: 0 6px; }
          .rec-actions .btn-edit,
          .rec-actions .btn-delete { flex: 0 0 18%; min-width: 0; }
          .rec-actions .btn-update { flex: 1 1 0%; min-width: 0; }
        }
      `}</style>
      <div className="rec-actions">
        <Button className="btn-edit" size="small" color="primary" fill="outline" onClick={() => setShowEdit(true)}>编辑</Button>
        <Button className="btn-update" size="small" color="primary" loading={updatingPrice} onClick={handleUpdatePrice}>
          {updatingPrice ? '更新中...' : '更新价格并计算收益率'}
        </Button>
        <Button className="btn-delete" size="small" fill="outline" onClick={() => setDeletingRec(recommendation)} style={{ color: '#8B3A42', borderColor: '#8B3A42' }}>删除</Button>
      </div>

      {/* 收益率统计 */}
      <Card title="收益率统计" style={{ marginTop: 6, '--header-font-size': '14px' }}>
        {/* 最高收益行 */}
        {bestReturn.best_close && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '4px 8px', marginBottom: 4, borderRadius: 6,
            background: '#fff7e6', border: '1px solid #ffd591',
          }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 11, color: '#d46b08' }}>🏆 最高收盘</span>
              <span style={{ fontSize: 10, color: '#999', marginLeft: 4 }}>{bestReturn.best_close.date} 收盘 ¥{bestReturn.best_close.price}</span>
            </div>
            <div style={{
              fontWeight: 700, fontSize: 12,
              color: Number(bestReturn.best_close.return_rate) >= 0 ? '#e74c3c' : '#27ae60',
            }}>
              {Number(bestReturn.best_close.return_rate) >= 0 ? '+' : ''}{bestReturn.best_close.return_rate}%
            </div>
          </div>
        )}
        {bestReturn.best_high && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '4px 8px', marginBottom: 6, borderRadius: 6,
            background: '#FAF0F1', border: '1px solid #E8CED1'
          }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 11, color: '#8B3A42' }}>📈 盘中最高</span>
              <span style={{ fontSize: 10, color: '#999', marginLeft: 4 }}>{bestReturn.best_high.date} 上影线 ¥{bestReturn.best_high.price}</span>
            </div>
            <div style={{
              fontWeight: 700, fontSize: 12,
              color: Number(bestReturn.best_high.return_rate) >= 0 ? '#e74c3c' : '#27ae60',
            }}>
              {Number(bestReturn.best_high.return_rate) >= 0 ? '+' : ''}{bestReturn.best_high.return_rate}%
            </div>
          </div>
        )}
        <div style={{ marginBottom: 6 }}>
          {allPeriods.map(p => {
            // 自定义周期从 returns.custom 数组中取数据
            const data = p.isCustom ? getCustomReturnData(p.days) : returns[p.key]
            const hasData = data?.return_rate !== null && data?.return_rate !== undefined
            const returnRate = hasData ? parseFloat(data.return_rate) : null
            const isPositive = returnRate !== null && returnRate >= 0
            return (
              <div key={p.key} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '4px 0',
                borderBottom: '1px solid #f0f0f0',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 12 }}>{p.label}</span>
                  <span style={{ fontSize: 10, color: '#999', marginLeft: 4 }}>
                    {targetDates[p.key] ? `目标 ${targetDates[p.key]}` : ''}
                    {hasData && data?.check_price ? ` · 收盘 ¥${data.check_price}` : ''}
                  </span>
                  {p.isCustom && (
                    <span
                      onClick={() => handleDeleteCustomPeriod(p.days)}
                      style={{ color: '#ccc', cursor: 'pointer', fontSize: 10, marginLeft: 2, lineHeight: 1 }}
                      title="删除"
                    >✕</span>
                  )}
                </div>
                <div style={{
                  fontWeight: 700,
                  fontSize: 13,
                  color: hasData ? (isPositive ? '#e74c3c' : '#27ae60') : '#ccc',
                }}>
                  {hasData ? `${isPositive ? '+' : ''}${returnRate}%` : '暂无'}
                </div>
              </div>
            )
          })}
        </div>

        {/* 自定义天数 */}
        <div style={{ borderTop: '1px solid #f0f0f0', paddingTop: 6 }}>
          <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 4 }}>自定义天数（按交易日）</div>
          <Space>
            <Input
              type="number"
              placeholder="输入天数"
              value={customDays}
              onChange={setCustomDays}
              style={{ width: 100, fontSize: 12 }}
            />
            <Button color="primary" size="mini" onClick={handleAddCustomPeriod}>添加</Button>
            <Button color="primary" size="mini" fill="outline" onClick={handleCalcCustom}>计算</Button>
          </Space>
          {customReturn && (
            <div style={{ marginTop: 4, padding: '4px 8px', background: '#f5f5f5', borderRadius: 6, fontSize: 11 }}>
              推荐后 <strong>{customReturn.days}</strong> 个交易日（共 {customReturn.trading_days} 个交易日）收益率：
              <strong style={{ color: customReturn.return_rate >= 0 ? '#e74c3c' : '#27ae60' }}>
                {customReturn.return_rate >= 0 ? '+' : ''}{customReturn.return_rate}%
              </strong>
              {customReturn.check_price && (
                <span style={{ fontSize: 10, color: '#999', marginLeft: 4 }}>
                  （现价 ¥{customReturn.check_price}，目标 {customReturn.target_date}）
                </span>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* 编辑弹窗 */}
      <Popup visible={showEdit} onMaskClick={() => setShowEdit(false)} bodyStyle={{ padding: 16, borderTopLeftRadius: 12, borderTopRightRadius: 12, minHeight: '50vh' }}>
        {recommendation && (
          <EditForm
            recommendation={recommendation}
            onSuccess={() => { setShowEdit(false); fetchDetail(); fetchReturns(); fetchBestReturn() }}
          />
        )}
      </Popup>

      {/* 删除确认弹窗 */}
      <Popup
        visible={!!deletingRec}
        onMaskClick={() => { setDeletingRec(null); setConfirmDeleteName('') }}
        bodyStyle={{ padding: 16, borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        {deletingRec && (
          <>
            <h3 style={{ marginBottom: 8, color: '#8B3A42' }}>⚠️ 确认删除</h3>
            <p style={{ fontSize: 14, color: '#666', marginBottom: 4 }}>
              你确定要删除以下推荐记录吗？此操作<strong>不可恢复</strong>！
            </p>
            <div style={{ padding: '8px 12px', background: '#f5f5f5', borderRadius: 8, marginBottom: 16 }}>
              <div><strong>{deletingRec.stock_name}</strong>（{deletingRec.stock_code}）</div>
              <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                推荐日期: {deletingRec.recommend_date} | 推荐价: ¥{deletingRec.recommend_price}
              </div>
            </div>
            <p style={{ fontSize: 13, color: '#333', marginBottom: 8 }}>
              请输入股票名称 <strong>「{deletingRec.stock_name}」</strong> 以确认：
            </p>
            <Input
              placeholder={`输入 ${deletingRec.stock_name}`}
              value={confirmDeleteName}
              onChange={setConfirmDeleteName}
              style={{ marginBottom: 16 }}
            />
            <div style={{ display: 'flex', gap: 12 }}>
              <Button block onClick={() => { setDeletingRec(null); setConfirmDeleteName('') }}>取消</Button>
              <Button block fill="outline" disabled={confirmDeleteName !== deletingRec.stock_name} onClick={handleConfirmDelete} style={{ color: confirmDeleteName === deletingRec.stock_name ? '#fff' : '#8B3A42', borderColor: '#8B3A42', background: confirmDeleteName === deletingRec.stock_name ? '#8B3A42' : 'transparent' }}>确认删除</Button>
            </div>
          </>
        )}
      </Popup>

      {/* 计算结果弹窗 */}
      <Popup
        visible={!!resultMessage}
        onMaskClick={() => setResultMessage('')}
        bodyStyle={{ padding: 16, borderTopLeftRadius: 12, borderTopRightRadius: 12 }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, color: '#8B3A42' }}>计算结果</h3>
          <span onClick={() => setResultMessage('')} style={{ fontSize: 20, color: '#999', cursor: 'pointer', padding: '0 4px' }}>✕</span>
        </div>
        <div style={{ fontSize: 15, color: '#333', lineHeight: 1.6, padding: '8px 0' }}>
          {resultMessage}
        </div>
        <Button block color="primary" onClick={() => setResultMessage('')} style={{ marginTop: 12 }}>确定</Button>
      </Popup>
    </div>
  )
}

// 编辑推荐表单
function EditForm({ recommendation, onSuccess }) {
  const [dateTimeValue, setDateTimeValue] = useState(
    dayjs(`${recommendation.recommend_date} ${recommendation.recommend_time}`).toDate()
  )
  const [showDateTimePicker, setShowDateTimePicker] = useState(false)
  const [price, setPrice] = useState(recommendation.recommend_price)
  const [notes, setNotes] = useState(recommendation.notes || '')
  const [reasons, setReasons] = useState(() => {
    const existing = recommendation.reasons || []
    return existing.length > 0 ? existing : ['']
  })

  const handleFinish = async () => {
    if (!dateTimeValue) { Toast.show('请选择推荐时间'); return }
    if (!price) { Toast.show('请输入推荐价格'); return }
    try {
      await recommendationApi.update(recommendation.id, {
        recommend_date: dayjs(dateTimeValue).format('YYYY-MM-DD'),
        recommend_time: dayjs(dateTimeValue).format('HH:mm'),
        recommend_price: price,
        notes,
        reasons: reasons.filter(r => r && r.trim()),
      })
      Toast.show('修改成功')
      onSuccess?.()
    } catch (error) {
      console.error('修改推荐失败:', error)
      Toast.show('修改失败')
    }
  }

  return (
    <>
      <h3 style={{ marginBottom: 16 }}>编辑推荐</h3>
      <div style={{ padding: '8px 12px', background: '#f5f5f5', borderRadius: 8, marginBottom: 16 }}>
        <span style={{ fontWeight: 600 }}>{recommendation.stock_name}</span>
        <span style={{ color: '#999', marginLeft: 8 }}>{recommendation.stock_code}</span>
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: '#999', marginBottom: 4 }}>推荐时间</div>
        <div onClick={() => setShowDateTimePicker(true)} style={{ padding: '8px 0', fontSize: 14, color: '#333', cursor: 'pointer' }}>
          {dayjs(dateTimeValue).format('YYYY-MM-DD HH:mm')}
        </div>
        <DatePicker visible={showDateTimePicker} onClose={() => setShowDateTimePicker(false)}
          onConfirm={(val) => { setDateTimeValue(val); setShowDateTimePicker(false) }}
          precision="minute" defaultValue={dateTimeValue}
          style={{ '--header-button-font-size': '16px' }} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: '#999', marginBottom: 4 }}>推荐价格</div>
        <Input type="number" value={price} onChange={setPrice} placeholder="推荐时的价格" />
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: '#999', marginBottom: 4 }}>备注</div>
        <TextArea value={notes} onChange={setNotes} rows={2} placeholder="可选，补充说明" />
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: '#333', marginBottom: 8, fontWeight: 500 }}>推荐理由</div>
        {reasons.map((reason, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Input
              placeholder={`理由${idx + 1}`}
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
      <Button block color="primary" size="large" onClick={handleFinish}>保存修改</Button>
    </>
  )
}
