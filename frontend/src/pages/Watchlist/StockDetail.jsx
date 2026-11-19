import React, { useState, useEffect, useCallback } from 'react'
import { Card, Button, SpinLoading, Empty, Tag } from 'antd-mobile'
import { LeftOutline } from 'antd-mobile-icons'
import { useNavigate, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import { watchlistApi, stockApi } from '../../services/api'
import { formatAmount, formatVolume, formatVolumeDiff, ALERT_COLORS, buildAlertMap } from '../../utils/volumeAlert'
import { showAlert } from '../../utils/alert'

// 自选股详情 —— 逐分钟成交量时间线（主口径：成交量；成交额仅作参考）
// 数据：后端 /api/watchlist/:code/timeline，读自有库 stock_minute_turnovers（定时任务每分钟 :05 入库）；
// 库里缺当天数据才回源新浪一次并补落库；支持向前/向后切换已落库的交易日
// 行内标记：每分钟量 / 较昨日此时(量) + 放量/缩量 + 分层告警标签（与首页同一套 calcVolumeAlert，单位换为亿股）
export default function WatchlistStockDetail() {
  const { code } = useParams()
  const navigate = useNavigate()
  const [timeline, setTimeline] = useState(null)
  const [realtime, setRealtime] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  // 只拉一次：失败不自动重试，弹窗告知后由用户手动点「刷新」再试
  // targetDate = null 时用后端默认日（交易日 9:15 后看今日，否则看最近一个有数据的日子）
  const loadData = useCallback(async (isRefresh = false, targetDate = null) => {
    if (isRefresh) setRefreshing(true)
    try {
      const res = await watchlistApi.getTimeline(code, targetDate)
      setTimeline(res.data)
      setUpdatedAt(dayjs().format('HH:mm:ss'))
      // 实时行情（价格/涨跌幅）单独取，失败不影响时间线
      stockApi.getRealtime(code)
        .then(rt => { if (rt.data && rt.data.length) setRealtime(rt.data[0]) })
        .catch(() => {})
    } catch (e) {
      showAlert(`分钟数据获取失败：${e.response?.data?.error || e.message}。不会自动重试，可点右上角「刷新」手动再试一次。`, '获取失败')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [code])

  // 进入页面只拉一次，不设定时轮询；需要更新时手动点「刷新」
  useEffect(() => {
    loadData()
  }, [loadData])

  if (loading) {
    return (
      <div className="page-container" style={{ textAlign: 'center', paddingTop: 60 }}>
        <SpinLoading style={{ '--size': '32px' }} />
      </div>
    )
  }

  const rows = timeline?.rows || []

  // 日期切换：dates 为库里已有的交易日（倒序）；当前展示日可能还没数据（idx=-1）
  const dates = timeline?.dates || []
  const dIdx = timeline?.date ? dates.indexOf(timeline.date) : -1
  const canOlder = dates.length > 0 && (dIdx === -1 || dIdx + 1 < dates.length)
  const canNewer = dIdx > 0
  const shiftDay = (older) => {
    if (!timeline?.date) return
    if (dIdx === -1) {
      if (older) loadData(false, dates[0])
      return
    }
    const target = dates[dIdx + (older ? 1 : -1)]
    if (target) loadData(false, target)
  }

  // 告警序列：S = (今日累计成交量 - 昨日同刻累计)/1e8（亿股），与首页同口径（仅单位换量）
  // 单票量能小，震荡绝对阈值（20亿）基本不触发，等效只出基础趋势标签
  const times = rows.map(r => r.time)
  const cumsVol = rows.map(r => r.cum_volume)
  const prevCumsVol = rows.map(r => r.prev_cum_volume)
  const alertMap = buildAlertMap(times, cumsVol, prevCumsVol)

  const pct = realtime ? Number(realtime.change_percent) : null
  const lastVol = rows.length ? rows[rows.length - 1].cum_volume : null
  const lastAmt = rows.length ? rows[rows.length - 1].cum : null

  return (
    <div className="page-container">
      {/* 头部：股票信息 + 当日累计成交额 */}
      <Card style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button size="mini" fill="none" onClick={() => navigate(-1)}><LeftOutline /></Button>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 16 }}>
              {timeline?.name || code}
              <span style={{ fontSize: 12, color: '#999', marginLeft: 8 }}>{code}</span>
              <Tag style={{ marginLeft: 8, fontSize: 10 }} color={timeline?.market === 'SH' ? 'red' : timeline?.market === 'SZ' ? 'blue' : 'orange'}>
                {timeline?.market === 'SH' ? '沪' : timeline?.market === 'SZ' ? '深' : '北'}
              </Tag>
            </div>
            <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
              {timeline?.prev_date ? `对比 ${timeline.prev_date}` : '无上一日数据'}
              　数据源：本地库
              {updatedAt && `　更新于 ${updatedAt}`}
            </div>
            {/* 交易日切换：只能在已落库的日子间移动，不回源第三方 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <Button size="mini" fill="outline" disabled={!canOlder} onClick={() => shiftDay(true)}>前一日子</Button>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#333' }}>{timeline?.date}</span>
              <Button size="mini" fill="outline" disabled={!canNewer} onClick={() => shiftDay(false)}>后一日子</Button>
              <Button size="mini" fill="none" style={{ fontSize: 11 }} onClick={() => loadData(false, null)}>默认日</Button>
            </div>
            {timeline?.notice && (
              <div style={{ fontSize: 11, color: '#e67700', marginTop: 4 }}>{timeline.notice}</div>
            )}
          </div>
          <Button size="mini" fill="none" loading={refreshing} onClick={() => loadData(true, timeline?.date)}>
            刷新
          </Button>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 10 }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: pct > 0 ? '#e74c3c' : pct < 0 ? '#27ae60' : '#333' }}>
            {realtime && realtime.current_price > 0 ? realtime.current_price.toFixed(2) : '--'}
          </span>
          {pct !== null && !Number.isNaN(pct) && (
            <span style={{ fontSize: 14, fontWeight: 600, color: pct > 0 ? '#e74c3c' : pct < 0 ? '#27ae60' : '#999' }}>
              {pct > 0 ? '+' : ''}{pct}%
            </span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 13, color: '#666', textAlign: 'right' }}>
            当日成交量 <b style={{ color: '#333' }}>{formatVolume(lastVol)}</b>
            <div style={{ fontSize: 11, color: '#999' }}>成交额 {formatAmount(lastAmt)}</div>
          </span>
        </div>
      </Card>

      {/* 逐分钟成交额时间线 */}
      <Card title={`成交量变化（逐分钟 · ${timeline?.date || ''}）`} style={{ marginBottom: 12 }}>
        {rows.length === 0 ? (
          <Empty description="该日没有分钟级成交数据（停牌、尚未采集或超出新浪保留窗口）" />
        ) : (
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            {[...rows].reverse().map((row, idx, arr) => {
              const rev = arr.length - 1 - idx // 正序下标
              const prevRow = rev > 0 ? rows[rev - 1] : null
              // 每分钟成交量与前一分钟比：变大红/变小绿
              const minuteVolDelta = prevRow && row.volume != null && prevRow.volume != null ? row.volume - prevRow.volume : null

              let changeVsYesterday = null
              if (row.cum_volume != null && row.prev_cum_volume != null) {
                changeVsYesterday = row.cum_volume - row.prev_cum_volume
              }

              const alert = alertMap[row.time]

              // 放量/缩量：本行「较昨日此时」差距与前一分钟比，变大=放量，变小=缩量（基于成交量 S 序列）
              let volumeLabel = null
              if (alert && alert.dS !== null && alert.sPrev !== null) {
                if (alert.S > alert.sPrev) volumeLabel = { text: '放量', color: '#e74c3c' }
                else if (alert.S < alert.sPrev) volumeLabel = { text: '缩量', color: '#27ae60' }
              }

              const volColor = minuteVolDelta > 0 ? '#e74c3c' : minuteVolDelta < 0 ? '#27ae60' : '#333'
              const yestDiff = changeVsYesterday !== null && changeVsYesterday !== 0 ? formatVolumeDiff(changeVsYesterday) : null

              return (
                <div
                  key={row.time}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 0',
                    borderBottom: idx < arr.length - 1 ? '1px solid #f5f5f5' : 'none',
                    fontSize: 11,
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontWeight: 500, fontSize: 12, color: '#333', minWidth: 40 }}>{row.time}</span>
                  {row.volume != null && row.volume !== 0 && (
                    <span style={{ color: volColor }}>
                      每分钟 {formatVolume(row.volume)}
                    </span>
                  )}
                  {yestDiff && (
                    <span style={{ color: yestDiff.color }}>
                      较昨日此时: {yestDiff.text}
                    </span>
                  )}
                  {volumeLabel && (
                    <span style={{ fontWeight: 600, color: volumeLabel.color }}>
                      {volumeLabel.text}
                    </span>
                  )}
                  {alert && (
                    <span style={{ fontWeight: 600, color: ALERT_COLORS[alert.base_type] || '#999' }}>
                      {alert.final_label}
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', fontWeight: 600, fontSize: 12, color: '#333' }}>
                    {formatVolume(row.cum_volume)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
