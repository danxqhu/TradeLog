import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Card, Button, Tag, Input, TextArea, Toast, Grid, NavBar, Space, SpinLoading, Popup, DatePicker } from 'antd-mobile'
import { LeftOutline, AddOutline, DeleteOutline } from 'antd-mobile-icons'
import { watchlistAnalysisApi, stockApi } from '../../services/api'
import dayjs from 'dayjs'

// 展示用周期：默认 1/2/3/4 交易日 + 用户自定义天数
const DEFAULT_DAYS = [1, 2, 3, 4]
// 三价字段顺序与中文名
const PRICE_FIELDS = [
  { f: 'open', name: '开盘价' },
  { f: 'high', name: '盘中最高价' },
  { f: 'close', name: '收盘价' },
]

// ===== 多因子打分（v1 初始基准权重，后续可用真实收益回测校准） =====
// type: bool 布尔（是得满分/否0）；tier 数值分段；combo 组合项（完美分时 + 均价线分钟）；penalty 扣分项
const SCORE_FACTORS = [
  { key: 'boll_mid', type: 'bool', name: '布林中轨上方', max: 15, hint: '收盘价站上布林中轨（中期多空分水岭）' },
  {
    key: 'bottom_pct', type: 'tier', name: '距离底部幅度', max: 20, unit: '%',
    hint: '距底部反弹幅度，<10% 最优，>35% 视为高位',
    tiers: [[10, 20], [20, 12], [35, 6]], // [上界(不含), 得分]，超出最后一档得 0
  },
  {
    key: 'low180_days', type: 'tier', name: '距半年低点天数', max: 10, unit: '天',
    hint: '刚脱离底部新鲜度，≤10 天最优，>60 天得 0',
    tiers: [[11, 10], [31, 6]], // ≤10 / ≤30 / 其余 0
  },
  { key: 'sector_before', type: 'bool', name: '买前板块阳线', max: 18, hint: '板块先行走强，个股才有依托（短线核心）' },
  { key: 'intraday', type: 'combo', name: '买前分时质量', max: 15, hint: '完美分时 + 站稳均价≥5分钟=15；仅满足其一=7' },
  {
    key: 'pre_gain', type: 'tier', name: '买前涨幅', max: 12, unit: '%',
    hint: '3%~8% 区间最优；8%~12% 递减；<3% 或 >12% 得 0（不追高）',
    range: [3, 8, 12, 5], // [满分区间的下界, 上界, 递减上界, 递减值]
  },
  { key: 'perfect_minute', type: 'bool', name: '完美分时', max: 0, hint: '参与"买前分时质量"合成，不单独计分' },
  { key: 'avg_line_min', type: 'number', name: '均价线上方分钟数', max: 0, unit: '分钟', hint: '参与"买前分时质量"合成，不单独计分' },
  { key: 'upper_shadow', type: 'penalty', name: '长上影线', penalty: -12, hint: '抛压信号，触发扣 12 分' },
  { key: 'vol_yin', type: 'penalty', name: '放量阴线', penalty: -10, hint: '弱信号，触发扣 10 分' },
]

const SCORE_STORAGE_PREFIX = 'wa_factor_scores_'

// 依据表单值计算总分与各因子得分
function computeFactorScores(form) {
  const detail = {}
  let positive = 0
  let penalty = 0

  for (const f of SCORE_FACTORS) {
    if (f.type === 'bool') {
      const s = form[f.key] ? f.max : 0
      detail[f.key] = s
      positive += s
    } else if (f.type === 'tier') {
      const v = form[f.key] === '' ? null : Number(form[f.key])
      let s = 0
      if (v !== null && !Number.isNaN(v)) {
        if (f.range) {
          const [lo, hi, hi2, half] = f.range
          if (v >= lo && v <= hi) s = f.max
          else if (v > hi && v <= hi2) s = half
        } else {
          s = 0
          for (const [upper, tierScore] of f.tiers) {
            if (v < upper) { s = tierScore; break }
          }
        }
      }
      detail[f.key] = s
      positive += s
    } else if (f.type === 'combo') {
      const perfect = !!form.perfect_minute
      const mins = form.avg_line_min === '' ? 0 : Number(form.avg_line_min)
      const strong = perfect && mins >= 5
      const s = strong ? f.max : (perfect || mins >= 5 ? 7 : 0)
      detail[f.key] = s
      positive += s
    } else if (f.type === 'penalty') {
      const s = form[f.key] ? f.penalty : 0
      detail[f.key] = s
      penalty += s
    }
  }

  const total = Math.max(positive + penalty, 0)
  return { total, positive, penalty, detail }
}

function scoreAdvice(total) {
  if (total >= 75) return { level: 'buy', text: '≥75 优先买入 · 标准仓位', color: '#e74c3c', bg: '#fff1f0' }
  if (total >= 60) return { level: 'watch', text: '60~74 纳入观察池 · 半仓/轻仓试错', color: '#d46b08', bg: '#fff7e6' }
  return { level: 'skip', text: '<60 建议放弃', color: '#27ae60', bg: '#f6ffed' }
}

export default function WatchlistAnalysisDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [record, setRecord] = useState(null)
  const [klineStats, setKlineStats] = useState({}) // { [天数]: {target_date, available, due, open/high/close:{price,return_rate}} }
  const [best, setBest] = useState({ best_close: null, best_high: null })
  const [refreshedDate, setRefreshedDate] = useState(null)
  const [customDays, setCustomDays] = useState('')
  const [loading, setLoading] = useState(true)
  const [updatingPrice, setUpdatingPrice] = useState(false)

  // 自定义天数列表（持久化到 localStorage）
  const [customPeriods, setCustomPeriods] = useState(() => {
    try {
      const saved = localStorage.getItem('wa_custom_periods')
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })

  // 编辑 & 删除
  const [showEdit, setShowEdit] = useState(false)
  const [deletingRec, setDeletingRec] = useState(null)
  const [confirmDeleteName, setConfirmDeleteName] = useState('')
  const [resultMessage, setResultMessage] = useState('')

  const fetchDetail = async () => {
    try {
      const res = await watchlistAnalysisApi.getById(id)
      setRecord(res.data)
    } catch (error) {
      console.error('获取自选股详情失败:', error)
      Toast.show('获取详情失败')
    }
  }

  // 拉取周期收益率统计（同一天命中缓存不重复打接口；force=true 强制刷新）
  const fetchKlineStats = async (force = false, daysOverride) => {
    try {
      const days = daysOverride
        || [...new Set([...DEFAULT_DAYS, ...customPeriods.map(cp => cp.days)])].sort((a, b) => a - b)
      const params = { days: days.join(',') }
      if (force) params.force = 1
      const res = await watchlistAnalysisApi.getKlineStats(id, params)
      setKlineStats(res.data || {})
      setBest(res.best || { best_close: null, best_high: null })
      setRefreshedDate(res.refreshed_date || null)
    } catch (error) {
      console.error('获取收益率统计失败:', error)
    }
  }

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      await fetchDetail()
      await fetchKlineStats()
      setLoading(false)
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // 更新现价并强制刷新收益率（隔天或手动刷新时打一次接口）
  const handleUpdatePrice = async () => {
    if (!record) return
    setUpdatingPrice(true)
    try {
      const res = await stockApi.getRealtime(record.stock_code)
      const realtimeData = res.data && res.data[0]
      if (realtimeData && realtimeData.current_price) {
        await watchlistAnalysisApi.update(record.id, { current_price: realtimeData.current_price })
      }
      await fetchDetail()
      await fetchKlineStats(true)
      setResultMessage(realtimeData && realtimeData.current_price
        ? `已更新现价为 ¥${realtimeData.current_price}，收益率已刷新`
        : '现价获取失败，仅刷新了收益率')
    } catch (error) {
      console.error('更新价格失败:', error)
      Toast.show('更新失败')
    }
    setUpdatingPrice(false)
  }

  // 添加自定义天数
  const handleAddCustomPeriod = () => {
    const days = parseInt(customDays)
    if (!days || days <= 0) { Toast.show('请输入有效天数'); return }
    if (DEFAULT_DAYS.includes(days)) { Toast.show(`${days}天已是默认周期`); return }
    if (customPeriods.some(cp => cp.days === days)) { Toast.show('该天数已存在'); return }
    const updated = [...customPeriods, { days }]
    setCustomPeriods(updated)
    localStorage.setItem('wa_custom_periods', JSON.stringify(updated))
    setCustomDays('')
    const daysList = [...new Set([...DEFAULT_DAYS, ...updated.map(cp => cp.days)])].sort((a, b) => a - b)
    fetchKlineStats(false, daysList)
  }

  // 删除自定义天数
  const handleDeleteCustomPeriod = (days) => {
    const updated = customPeriods.filter(cp => cp.days !== days)
    setCustomPeriods(updated)
    localStorage.setItem('wa_custom_periods', JSON.stringify(updated))
  }

  // 删除确认
  const handleConfirmDelete = async () => {
    if (!deletingRec) return
    if (confirmDeleteName !== deletingRec.stock_name) {
      Toast.show('股票名称不匹配，请重新输入')
      return
    }
    try {
      await watchlistAnalysisApi.delete(deletingRec.id)
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

  if (!record) {
    return (
      <div className="page-container">
        <NavBar backIcon={<LeftOutline />} onBack={() => navigate(-1)}>自选股详情</NavBar>
        <Card style={{ marginTop: 12, textAlign: 'center', padding: 40 }}>
          自选股记录不存在
        </Card>
      </div>
    )
  }

  const currentReturn = ((record.current_price - record.recommend_price) / record.recommend_price * 100).toFixed(2)

  // 展示顺序：默认 1-4 天 + 自定义天数
  const displayPeriods = [
    ...DEFAULT_DAYS.map(d => ({ days: d, label: `${d}天`, custom: false })),
    ...customPeriods.map(cp => ({ days: cp.days, label: `${cp.days}天`, custom: true })),
  ]

  // 在所有可用单元格（行：1/2/3/4天+自定义 × 列：开盘/最高/收盘）中找收益率最高/最低的格子
  const availCells = []
  for (const p of displayPeriods) {
    const stat = klineStats[p.days]
    if (!stat?.available) continue
    for (const { f } of PRICE_FIELDS) {
      const item = stat[f]
      if (item?.return_rate !== null && item?.return_rate !== undefined) {
        availCells.push({ key: `${p.days}-${f}`, value: Number(item.return_rate) })
      }
    }
  }
  let maxKey = null
  let minKey = null
  if (availCells.length > 1) {
    maxKey = availCells.reduce((a, b) => (b.value > a.value ? b : a)).key
    minKey = availCells.reduce((a, b) => (b.value < a.value ? b : a)).key
  }

  return (
    <div className="page-container" style={{ '--adm-color-primary': '#8B3A42' }}>
      <NavBar backIcon={<LeftOutline />} onBack={() => navigate(-1)}>
        自选股详情
      </NavBar>

      <Card style={{ marginTop: 6, padding: '8px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{record.stock_name}</span>
            <span style={{ fontSize: 11, color: '#999', marginLeft: 4 }}>{record.stock_code}</span>
            {record.sector && (
              <span style={{ fontSize: 10, color: '#8B3A42', background: '#F5E6E8', borderRadius: 3, padding: '1px 5px', marginLeft: 6 }}>{record.sector}</span>
            )}
          </div>
          <Tag color="primary" style={{ fontSize: 10, padding: '0 4px', height: 18, lineHeight: '18px' }}>
            自选股
          </Tag>
        </div>
        <Grid columns={2} gap={4}>
          <div><span style={{ color: '#999', fontSize: 11 }}>加入日期</span><div style={{ fontSize: 12 }}>{record.recommend_date}</div></div>
          <div><span style={{ color: '#999', fontSize: 11 }}>加入时间</span><div style={{ fontSize: 12 }}>{record.recommend_time}</div></div>
          <div><span style={{ color: '#999', fontSize: 11 }}>加入价格</span><div style={{ fontWeight: 600, fontSize: 12 }}>¥{record.recommend_price}</div></div>
          <div>
            <span style={{ color: '#999', fontSize: 11 }}>当前价格</span>
            <div style={{ fontWeight: 600, fontSize: 12 }}>
              ¥{record.current_price}
              <span style={{ fontSize: 10, color: currentReturn >= 0 ? '#e74c3c' : '#27ae60', marginLeft: 3 }}>
                {currentReturn >= 0 ? '+' : ''}{currentReturn}%
              </span>
            </div>
          </div>
        </Grid>
        {record.reasons && record.reasons.length > 0 && (
          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {record.reasons.map((reason, idx) => (
              <Tag key={idx} color="primary" fill="outline" style={{ fontSize: 11, padding: '2px 6px' }}>
                {reason}
              </Tag>
            ))}
          </div>
        )}
        {record.notes && (
          <div style={{ marginTop: 6, padding: '4px 8px', background: '#f9f9f9', borderRadius: 6, fontSize: 11, color: '#666' }}>
            <span style={{ color: '#999' }}>备注：</span>{record.notes}
          </div>
        )}
      </Card>

      {/* 编辑 / 刷新现价并重算收益率 / 删除 */}
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
          {updatingPrice ? '更新中...' : '刷新现价并重算收益率'}
        </Button>
        <Button className="btn-delete" size="small" fill="outline" onClick={() => setDeletingRec(record)} style={{ color: '#8B3A42', borderColor: '#8B3A42' }}>删除</Button>
      </div>

      {/* 收益率统计（按交易日：开盘/最高/收盘三价） */}
      <Card title="收益率统计" style={{ marginTop: 6, '--header-font-size': '14px' }}>
        {refreshedDate && (
          <div style={{ fontSize: 10, color: '#bbb', marginBottom: 4 }}>数据更新至 {refreshedDate}</div>
        )}
        {/* 区间极值行 */}
        {best.best_close && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '4px 8px', marginBottom: 4, borderRadius: 6,
            background: '#fff7e6', border: '1px solid #ffd591',
          }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 11, color: '#d46b08' }}>🏆 最高收盘</span>
              <span style={{ fontSize: 10, color: '#999', marginLeft: 4 }}>{best.best_close.date} 收盘 ¥{best.best_close.price}</span>
            </div>
            <div style={{
              fontWeight: 700, fontSize: 12,
              color: Number(best.best_close.return_rate) >= 0 ? '#e74c3c' : '#27ae60',
            }}>
              {Number(best.best_close.return_rate) >= 0 ? '+' : ''}{best.best_close.return_rate}%
            </div>
          </div>
        )}
        {best.best_high && (
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '4px 8px', marginBottom: 6, borderRadius: 6,
            background: '#FAF0F1', border: '1px solid #E8CED1'
          }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 11, color: '#8B3A42' }}>📈 盘中最高</span>
              <span style={{ fontSize: 10, color: '#999', marginLeft: 4 }}>{best.best_high.date} 上影线 ¥{best.best_high.price}</span>
            </div>
            <div style={{
              fontWeight: 700, fontSize: 12,
              color: Number(best.best_high.return_rate) >= 0 ? '#e74c3c' : '#27ae60',
            }}>
              {Number(best.best_high.return_rate) >= 0 ? '+' : ''}{best.best_high.return_rate}%
            </div>
          </div>
        )}

        <div style={{ border: '1px solid #eee', borderRadius: 6, overflow: 'hidden', marginBottom: 6 }}>
          {/* 表头：开盘 / 盘中最高 / 收盘 */}
          <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(3, 1fr)', background: '#fafafa' }}>
            <div style={{ fontSize: 11, color: '#666', fontWeight: 600, padding: '6px 2px', textAlign: 'center' }}>天</div>
            {PRICE_FIELDS.map(({ f, name }) => (
              <div key={f} style={{ fontSize: 11, color: '#666', fontWeight: 600, padding: '6px 2px', textAlign: 'center', borderLeft: '1px solid #eee' }}>{name}</div>
            ))}
          </div>
          {displayPeriods.map(p => {
            const stat = klineStats[p.days]
            return (
              <div key={p.days} style={{ display: 'grid', gridTemplateColumns: '60px repeat(3, 1fr)', borderTop: '1px solid #eee' }}>
                {/* 行首：天数 + 目标日期 */}
                <div style={{ background: '#fafafa', padding: '4px 2px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: 12 }}>
                    {p.label}
                    {p.custom && (
                      <span
                        onClick={() => handleDeleteCustomPeriod(p.days)}
                        style={{ color: '#ccc', cursor: 'pointer', fontSize: 10, marginLeft: 3, lineHeight: 1 }}
                        title="删除"
                      >✕</span>
                    )}
                  </span>
                  <span style={{ fontSize: 9, color: '#bbb' }}>{stat?.target_date ? stat.target_date.slice(5) : ''}</span>
                </div>
                {PRICE_FIELDS.map(({ f }) => {
                  const item = stat?.available ? stat[f] : null
                  const has = item?.return_rate !== null && item?.return_rate !== undefined
                  const num = has ? Number(item.return_rate) : 0
                  const key = `${p.days}-${f}`
                  const bg = key === maxKey ? '#fff1f0' : key === minKey ? '#f6ffed' : 'transparent'
                  return (
                    <div key={f} style={{ borderLeft: '1px solid #eee', padding: '4px 2px', textAlign: 'center', background: bg }}>
                      <div style={{ fontSize: 12 }}>¥{has ? item.price : '-'}</div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: has ? (num >= 0 ? '#e74c3c' : '#27ae60') : '#ccc' }}>
                        {has ? `${num >= 0 ? '+' : ''}${item.return_rate}%` : (stat && stat.due ? '暂无' : '未到期')}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        {(maxKey || minKey) && (
          <div style={{ display: 'flex', gap: 12, fontSize: 10, color: '#999', marginBottom: 6 }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#fff1f0', border: '1px solid #ffccc7', borderRadius: 2, marginRight: 3, verticalAlign: 'middle' }} />收益率最高</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 2, marginRight: 3, verticalAlign: 'middle' }} />收益率最低</span>
          </div>
        )}

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
          </Space>
        </div>
      </Card>

      {/* 多因子打分 */}
      <FactorScoreCard recordId={record.id} />

      {/* 编辑弹窗 */}
      <Popup visible={showEdit} onMaskClick={() => setShowEdit(false)} bodyStyle={{ padding: 16, borderTopLeftRadius: 12, borderTopRightRadius: 12, minHeight: '50vh' }}>
        {record && (
          <EditForm
            record={record}
            onSuccess={() => { setShowEdit(false); fetchDetail(); fetchKlineStats(true) }}
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
              你确定要删除以下自选股记录吗？此操作<strong>不可恢复</strong>！
            </p>
            <div style={{ padding: '8px 12px', background: '#f5f5f5', borderRadius: 8, marginBottom: 16 }}>
              <div><strong>{deletingRec.stock_name}</strong>（{deletingRec.stock_code}）</div>
              <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                加入日期: {deletingRec.recommend_date} | 加入价: ¥{deletingRec.recommend_price}
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
          <h3 style={{ margin: 0, color: '#8B3A42' }}>刷新结果</h3>
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

// 多因子打分卡片：布尔项点击 是/否 切换，数值项直接输入，实时计算总分（v1 存 localStorage）
function FactorScoreCard({ recordId }) {
  const storageKey = SCORE_STORAGE_PREFIX + recordId
  const [form, setForm] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) return JSON.parse(saved)
    } catch { /* ignore */ }
    return {}
  })

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(form)) } catch { /* ignore */ }
  }, [storageKey, form])

  const { total, positive, penalty, detail } = computeFactorScores(form)
  const advice = scoreAdvice(total)

  const setField = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const renderBoolSwitch = (key) => (
    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
      {[true, false].map(v => {
        const active = !!form[key] === v
        return (
          <span
            key={String(v)}
            onClick={() => setField(key, v)}
            style={{
              fontSize: 11, padding: '2px 10px', borderRadius: 4, cursor: 'pointer', lineHeight: '18px',
              background: active ? (v ? '#8B3A42' : '#eee') : '#fff',
              color: active ? (v ? '#fff' : '#666') : '#999',
              border: active ? 'none' : '1px solid #ddd',
            }}
          >{v ? '是' : '否'}</span>
        )
      })}
    </div>
  )

  const renderNumberInput = (key, unit) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'flex-end' }}>
      <Input
        type="number"
        placeholder="-"
        value={form[key] ?? ''}
        onChange={(v) => setField(key, v === '' ? '' : v)}
        style={{ width: 56, fontSize: 12, textAlign: 'right', '--text-align': 'right' }}
      />
      <span style={{ fontSize: 10, color: '#999' }}>{unit}</span>
    </div>
  )

  // 主表格行（满分>0；分时辅助项在表格下方单独录入）
  const mainRows = SCORE_FACTORS.filter(f => f.max > 0)

  const renderRow = (f) => {
    const s = detail[f.key] ?? 0
    const isPenalty = f.type === 'penalty'
    return (
      <div key={f.key} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 46px', alignItems: 'center', borderTop: '1px solid #f0f0f0', padding: '5px 8px', gap: 6 }}>
        <div>
          <div style={{ fontSize: 12, color: '#333' }}>
            {f.name}
            {f.type === 'combo' && <span style={{ fontSize: 9, color: '#8B3A42', marginLeft: 4 }}>(合成)</span>}
            {isPenalty && <span style={{ fontSize: 9, color: '#27ae60', marginLeft: 4 }}>(扣分)</span>}
          </div>
          <div style={{ fontSize: 9, color: '#bbb' }}>{f.hint}</div>
        </div>
        <div>
          {(f.type === 'bool' || isPenalty) && renderBoolSwitch(f.key)}
          {f.type === 'tier' && renderNumberInput(f.key, f.unit)}
          {f.type === 'combo' && renderNumberInput('avg_line_min', '分')}
        </div>
        <div style={{ textAlign: 'right', fontWeight: 700, fontSize: 13, color: s === 0 ? '#ccc' : (isPenalty ? '#27ae60' : '#8B3A42') }}>
          {s > 0 ? `+${s}` : s}
        </div>
      </div>
    )
  }

  return (
    <Card title="多因子打分（v1 初始权重）" style={{ marginTop: 6, '--header-font-size': '14px' }}>
      <div style={{ border: '1px solid #eee', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 46px', background: '#fafafa', padding: '6px 8px', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#666', fontWeight: 600 }}>因子</span>
          <span style={{ fontSize: 11, color: '#666', fontWeight: 600, textAlign: 'right' }}>取值</span>
          <span style={{ fontSize: 11, color: '#666', fontWeight: 600, textAlign: 'right' }}>得分</span>
        </div>
        {mainRows.map(renderRow)}
      </div>

      {/* 分时辅助输入（参与"买前分时质量"合成） */}
      <div style={{ marginTop: 4, padding: '6px 8px', background: '#fafafa', borderRadius: 6 }}>
        <div style={{ fontSize: 10, color: '#999', marginBottom: 4 }}>分时质量辅助项（计入上方"买前分时质量"）</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, color: '#666' }}>完美分时</span>
            {renderBoolSwitch('perfect_minute')}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, color: '#666' }}>均价线上方</span>
            {renderNumberInput('avg_line_min', '分钟')}
          </div>
        </div>
      </div>

      {/* 总分与建议 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, padding: '8px 12px', borderRadius: 6, background: advice.bg, border: `1px solid ${advice.color}33` }}>
        <div>
          <span style={{ fontSize: 11, color: '#999' }}>总分</span>
          <span style={{ fontWeight: 700, fontSize: 22, color: advice.color, marginLeft: 6 }}>{total}</span>
          <span style={{ fontSize: 10, color: '#bbb', marginLeft: 6 }}>/ 100（加分 {positive}，扣分 {penalty}）</span>
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: advice.color }}>{advice.text}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
        <span style={{ fontSize: 10, color: '#bbb' }}>打分已自动保存 · 权重待用真实收益回测校准</span>
        <span onClick={() => setForm({})} style={{ fontSize: 11, color: '#8B3A42', cursor: 'pointer' }}>清空重填</span>
      </div>
    </Card>
  )
}

// 编辑自选股记录表单
function EditForm({ record, onSuccess }) {
  const [dateTimeValue, setDateTimeValue] = useState(
    dayjs(`${record.recommend_date} ${record.recommend_time}`).toDate()
  )
  const [showDateTimePicker, setShowDateTimePicker] = useState(false)
  const [price, setPrice] = useState(record.recommend_price)
  const [notes, setNotes] = useState(record.notes || '')
  const [sector, setSector] = useState(record.sector || '')
  const [sectorOptions, setSectorOptions] = useState([])
  useEffect(() => {
    watchlistAnalysisApi.getSectorOptions()
      .then(res => setSectorOptions(res.data || []))
      .catch(() => setSectorOptions([]))
  }, [])
  const [reasons, setReasons] = useState(() => {
    const existing = record.reasons || []
    return existing.length > 0 ? existing : ['']
  })

  const handleFinish = async () => {
    if (!dateTimeValue) { Toast.show('请选择加入时间'); return }
    if (!price) { Toast.show('请输入加入价格'); return }
    try {
      await watchlistAnalysisApi.update(record.id, {
        recommend_date: dayjs(dateTimeValue).format('YYYY-MM-DD'),
        recommend_time: dayjs(dateTimeValue).format('HH:mm'),
        recommend_price: price,
        notes,
        sector: sector.trim(),
        reasons: reasons.filter(r => r && r.trim()),
      })
      Toast.show('修改成功')
      onSuccess?.()
    } catch (error) {
      console.error('修改自选股记录失败:', error)
      Toast.show('修改失败')
    }
  }

  return (
    <>
      <h3 style={{ marginBottom: 16 }}>编辑自选股</h3>
      <div style={{ padding: '8px 12px', background: '#f5f5f5', borderRadius: 8, marginBottom: 16 }}>
        <span style={{ fontWeight: 600 }}>{record.stock_name}</span>
        <span style={{ color: '#999', marginLeft: 8 }}>{record.stock_code}</span>
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: '#999', marginBottom: 4 }}>加入时间</div>
        <div onClick={() => setShowDateTimePicker(true)} style={{ padding: '8px 0', fontSize: 14, color: '#333', cursor: 'pointer' }}>
          {dayjs(dateTimeValue).format('YYYY-MM-DD HH:mm')}
        </div>
        <DatePicker visible={showDateTimePicker} onClose={() => setShowDateTimePicker(false)}
          onConfirm={(val) => { setDateTimeValue(val); setShowDateTimePicker(false) }}
          precision="minute" defaultValue={dateTimeValue}
          style={{ '--header-button-font-size': '16px' }} />
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: '#999', marginBottom: 4 }}>加入价格</div>
        <Input type="number" value={price} onChange={setPrice} placeholder="加入自选股时的价格" />
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: '#999', marginBottom: 4 }}>板块</div>
        <Input value={sector} onChange={setSector} placeholder="可选，如 光伏设备" />
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
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: '#999', marginBottom: 4 }}>备注</div>
        <TextArea value={notes} onChange={setNotes} rows={2} placeholder="可选，补充说明" />
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: '#333', marginBottom: 8, fontWeight: 500 }}>自选理由</div>
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
