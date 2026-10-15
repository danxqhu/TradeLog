import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Card, Tag, SpinLoading, Button, Toast, Empty } from 'antd-mobile'
import { LeftOutline, RightOutline } from 'antd-mobile-icons'
import { marketApi } from '../../services/api'
import dayjs from 'dayjs'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend } from 'recharts'

// 市场状态中文映射
const STATUS_MAP = {
  'pre-market': '盘前',
  'call-auction': '集合竞价',
  'morning': '上午盘',
  'noon-break': '午间休市',
  'afternoon': '下午盘',
  'closed': '已收盘',
}

// 格式化成交额（元 → 亿/万）
const formatAmount = (yuan) => {
  if (!yuan || yuan === 0) return '--'
  if (yuan >= 1e8) return (yuan / 1e8).toFixed(2) + '亿'
  if (yuan >= 1e4) return (yuan / 1e4).toFixed(0) + '万'
  return yuan.toFixed(0)
}

// 格式化5分钟增量（带正负号和颜色）
const formatIncrement = (yuan) => {
  if (!yuan || yuan === 0) return { text: '--', color: '#999' }
  const abs = Math.abs(yuan)
  const formatted = abs >= 1e8
    ? (abs / 1e8).toFixed(2) + '亿'
    : abs >= 1e4
      ? (abs / 1e4).toFixed(0) + '万'
      : abs.toFixed(0)
  if (yuan > 0) return { text: '+' + formatted, color: '#e74c3c' }
  return { text: '-' + formatted, color: '#27ae60' }
}

const weekDays = ['日', '一', '二', '三', '四', '五', '六']

export default function Home() {
  const [realtime, setRealtime] = useState(null)
  const [snapshots, setSnapshots] = useState([])
  const [yesterdayData, setYesterdayData] = useState({ date: '', snapshots: [] })
  const [loading, setLoading] = useState(false)
  const [marketStatus, setMarketStatus] = useState('closed')
  const timerRef = useRef(null)
  
  // 日历相关状态
  const [selectedDate, setSelectedDate] = useState(null) // null表示今日
  const [viewMonth, setViewMonth] = useState(dayjs())
  const [availableDates, setAvailableDates] = useState([])
  const [historySnapshots, setHistorySnapshots] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [calendarCollapsed, setCalendarCollapsed] = useState(true) // 默认收起
  const [averages, setAverages] = useState(null) // 20日/60日平均成交额
  const [refreshingAverages, setRefreshingAverages] = useState(false) // 均量刷新中
  const [averagesTrend, setAveragesTrend] = useState([]) // 均量趋势数据（最近60个交易日）
  const [incompleteCount, setIncompleteCount] = useState(0) // 不完整数据数量
  const [trendRange, setTrendRange] = useState(60) // 趋势图显示范围：20/60/120/250
  const [exchangeData, setExchangeData] = useState([]) // 沪深A股成交额数据
  const [exchangeRange, setExchangeRange] = useState(30) // 交易所卡片图显示范围：30或60

  // 上一个/下一个交易日
  const getCurrentDateIdx = () => {
    const target = selectedDate || dayjs().format('YYYY-MM-DD')
    // 确保日期列表是升序排列（从旧到新）
    const sortedDates = [...availableDates].sort((a, b) => a.localeCompare(b))
    let idx = sortedDates.indexOf(target)
    if (idx === -1) {
      // 如果当前日期不在列表中，找到最接近的日期
      for (let i = 0; i < sortedDates.length; i++) {
        if (sortedDates[i] >= target) {
          idx = i
          break
        }
        idx = i + 1
      }
    }
    return { idx, sortedDates }
  }

  const goToPrevTradingDay = () => {
    const { idx, sortedDates } = getCurrentDateIdx()
    if (idx > 0) {
      const prevDate = sortedDates[idx - 1]
      setSelectedDate(prevDate)
      setViewMonth(dayjs(prevDate))
      fetchHistory(prevDate)
    } else {
      Toast.show('已经是第一个交易日了')
    }
  }
  const goToNextTradingDay = () => {
    const { idx, sortedDates } = getCurrentDateIdx()
    if (idx < sortedDates.length - 1) {
      const nextDate = sortedDates[idx + 1]
      setSelectedDate(nextDate)
      setViewMonth(dayjs(nextDate))
      fetchHistory(nextDate)
    } else {
      Toast.show('已经是最新的交易日了')
    }
  }

  // 获取20日/60日平均成交额
  const fetchAverages = useCallback(async () => {
    try {
      const res = await marketApi.getAverages()
      setAverages(res.data || { ma20: null, ma60: null, latestDate: null, latestTurnover: 0 })
    } catch (err) {
      console.error('获取平均成交额失败:', err)
      // 失败时也设置空数据，避免一直转圈
      setAverages({ ma20: null, ma60: null, latestDate: null, latestTurnover: 0, error: true })
    }
  }, [])

  // 获取均量趋势数据（仅完整数据），limit 指定返回条数
  const fetchAveragesTrend = useCallback(async (limit) => {
    try {
      const res = await marketApi.getAveragesTrend(limit)
      setAveragesTrend(res.data || [])
      setIncompleteCount(res.incompleteCount || 0)
    } catch (err) {
      console.error('获取均量趋势失败:', err)
      setAveragesTrend([])
    }
  }, [])

  // 获取沪深A股成交额数据（来自 AKShare）
  const fetchExchangeData = useCallback(async () => {
    try {
      const res = await marketApi.getExchangeDaily(250)
      setExchangeData(Array.isArray(res) ? res : res.data || [])
    } catch (err) {
      console.error('获取沪深A股成交额失败:', err)
      setExchangeData([])
    }
  }, [])

  // 加载今日数据（快照历史 + 实时 + 昨日对比）
  const loadData = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true)
      const res = await marketApi.getToday()
      if (res.realtime) setRealtime(res.realtime)
      setSnapshots(res.data || [])
      setMarketStatus(res.status || 'closed')
      if (res.yesterday) setYesterdayData(res.yesterday)
    } catch (err) {
      console.error('加载市场数据失败:', err)
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  // 采集一次快照
  const takeSnapshot = useCallback(async () => {
    try {
      const res = await marketApi.takeSnapshot()
      if (res.realtime) setRealtime(res.realtime)
      if (res.data) {
        // 更新快照列表（去重替换同时间的记录）
        setSnapshots(prev => {
          const existing = prev.filter(s => s.snapshot_time !== res.data.snapshot_time)
          return [...existing, res.data].sort((a, b) =>
            a.snapshot_time.localeCompare(b.snapshot_time)
          )
        })
      }
      if (res.status) setMarketStatus(res.status)
      return res
    } catch (err) {
      console.error('采集快照失败:', err)
      return null
    }
  }, [])

  // 加载有数据的日期列表
  const fetchDates = useCallback(async () => {
    try {
      const res = await marketApi.getDates()
      setAvailableDates(Array.isArray(res) ? res : res.data || [])
    } catch (err) {
      console.error('获取日期列表失败:', err)
    }
  }, [])

  // 加载指定日期的历史数据
  const fetchHistory = useCallback(async (date) => {
    setHistoryLoading(true)
    try {
      const res = await marketApi.getHistory(date)
      setHistorySnapshots(Array.isArray(res) ? res : res.data || [])
    } catch (err) {
      console.error('获取历史数据失败:', err)
      setHistorySnapshots([])
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  // 初始化 + 设置自动刷新（与后端采集时间对齐）
  useEffect(() => {
    loadData(true)
    fetchDates()
    fetchAverages()
    fetchAveragesTrend()
    fetchExchangeData()

    // 获取北京时间（无论本地时区是什么）
    const getBeijingNow = () => {
      const now = new Date()
      const utc = now.getTime() + now.getTimezoneOffset() * 60000
      return new Date(utc + 8 * 3600000)
    }

    // 判断是否在交易时段（北京时间）
    const isTradingTime = () => {
      const now = getBeijingNow()
      const h = now.getUTCHours()
      const m = now.getUTCMinutes()
      const t = h * 60 + m
      const day = now.getUTCDay()
      return day >= 1 && day <= 5 && 
        (t === 565 || (t >= 570 && t <= 690) || (t >= 780 && t <= 900))
    }
    
    // 计算距离下一个刷新时间的毫秒数
    // 每次调度时重新判断是否在交易时段，避免午休加载后下午不刷新
    const getMsToNextRefresh = () => {
      const now = getBeijingNow()
      const seconds = now.getUTCSeconds()
      const ms = now.getUTCMilliseconds()
      const h = now.getUTCHours()
      const m = now.getUTCMinutes()
      const t = h * 60 + m
      const day = now.getUTCDay()
      
      if (isTradingTime()) {
        // 交易时段：每分钟 XX:06 刷新
        if (seconds < 6) {
          return (6 - seconds) * 1000 - ms
        } else {
          return (66 - seconds) * 1000 - ms
        }
      }
      
      // 非交易时段：判断距离下一个交易时段的距离
      const isWeekday = day >= 1 && day <= 5
      
      if (isWeekday && t >= 691 && t < 780) {
        // 午休时段（11:31 - 12:59）：每5分钟检查，但如果下次已超过13:00则直接跳到13:00
        const minsToOpen = 780 - t // 距离13:00的分钟数
        if (minsToOpen <= 5) {
          // 距离开盘不足5分钟，直接等到13:00:06
          const waitSec = minsToOpen * 60 - seconds + 6
          return waitSec * 1000 - ms
        } else {
          // 每5分钟检查一次
          const nextCheck = Math.ceil((m + 1) / 5) * 5
          const waitSec = (nextCheck - m) * 60 - seconds + 6
          return waitSec * 1000 - ms
        }
      }
      
      if (isWeekday && t >= 901) {
        // 收盘后（15:01以后）：每小时刷新
        const waitSec = (60 - m) * 60 - seconds + 6
        return waitSec * 1000 - ms
      }
      
      if (isWeekday && t < 565) {
        // 盘前（9:25之前）：每5分钟检查
        const minsToOpen = 565 - t
        if (minsToOpen <= 5) {
          const waitSec = minsToOpen * 60 - seconds + 6
          return waitSec * 1000 - ms
        }
        const nextCheck = Math.ceil((m + 1) / 5) * 5
        const waitSec = (nextCheck - m) * 60 - seconds + 6
        return waitSec * 1000 - ms
      }
      
      // 其他（周末、节假日等）：每小时刷新
      const waitSec = (60 - m) * 60 - seconds + 6
      return waitSec * 1000 - ms
    }
    
    // 递归定时器
    const scheduleNextRefresh = () => {
      const waitMs = getMsToNextRefresh()
      timerRef.current = setTimeout(() => {
        loadData(false)
        // 均量数据也一起轮询，确保收盘后自动更新
        fetchAverages()
        scheduleNextRefresh()
      }, waitMs)
    }
    
    // 启动
    timerRef.current = setTimeout(() => {
      loadData(false)
      scheduleNextRefresh()
    }, getMsToNextRefresh())

    // SSE 事件监听：后端采集完快照后立即通知前端刷新
    const token = localStorage.getItem('token')
    const sseUrl = token ? `/api/market/events?token=${encodeURIComponent(token)}` : '/api/market/events'
    const evtSource = new EventSource(sseUrl)
    evtSource.onopen = () => console.log('💹 [SSE] 已连接后端事件流')
    evtSource.addEventListener('snapshot', (e) => {
      console.log('💹 [SSE] 收到快照通知:', e.data)
      loadData(false)
      fetchAverages()
    })
    // 均量数据刷新通知（收盘后 17:00 抓取完成）
    evtSource.addEventListener('averages', (e) => {
      console.log('💹 [SSE] 收到均量刷新通知:', e.data)
      fetchAverages()
      fetchAveragesTrend()
      fetchExchangeData()
    })
    evtSource.onerror = (e) => {
      console.warn('💹 [SSE] 连接断开，将自动重连...', e)
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      evtSource.close()
    }
  }, [loadData, fetchDates])

  // 手动刷新
  const handleRefresh = async () => {
    const res = await takeSnapshot()
    if (res && res.saved === false) {
      Toast.show('非交易时段，仅刷新显示')
    } else {
      Toast.show('已刷新')
    }
  }

  // 手动刷新均量数据
  const handleRefreshAverages = async () => {
    setRefreshingAverages(true)
    try {
      // 调用后端接口刷新均量
      await marketApi.refreshAverages()
      // 刷新前端数据
      await fetchAverages()
      await fetchAveragesTrend()
      await fetchExchangeData()
      Toast.show('均量数据已刷新')
    } catch (err) {
      console.error('刷新均量失败:', err)
      Toast.show('刷新失败')
    } finally {
      setRefreshingAverages(false)
    }
  }

  // 当前实时数据（使用最新一条快照，与时间线保持一致）
  const latestSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null
  const currentTurnover = latestSnapshot?.total_turnover || realtime?.total?.turnover || 0
  
  // 计算"昨日此时"对比
  const getYesterdayComparison = () => {
    if (!yesterdayData.snapshots || yesterdayData.snapshots.length === 0) return null
    if (!currentTurnover || currentTurnover === 0) return null
  
    // 找到当前时间对应的昨日快照（最接近当前时间的）
    const now = new Date()
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  
    // 先精确匹配，再找最接近的
    let ySnap = yesterdayData.snapshots.find(s => s.snapshot_time === currentTimeStr)
    let isExactMatch = !!ySnap
    if (!ySnap) {
      // 找最接近当前时间的昨日快照（不超过当前时间）
      const candidates = yesterdayData.snapshots.filter(s => {
        const [h, m] = s.snapshot_time.split(':').map(Number)
        return h * 60 + m <= nowMinutes
      })
      if (candidates.length > 0) {
        ySnap = candidates[candidates.length - 1]
      } else {
        // 当前时间早于昨日第一条快照，用昨日最后一条（收盘数据）
        ySnap = yesterdayData.snapshots[yesterdayData.snapshots.length - 1]
      }
    }
  
    if (!ySnap) return null
    const yTurnover = Number(ySnap.total_turnover)
    if (yTurnover === 0) return null
  
    return {
      date: yesterdayData.date,
      time: ySnap.snapshot_time,
      turnover: yTurnover,
      diff: currentTurnover - yTurnover,
      isExactMatch,
    }
  }

  const yesterdayComp = getYesterdayComparison()

  // 选择日历日期
  const handleDateSelect = (dateStr) => {
    const today = dayjs().format('YYYY-MM-DD')
    if (dateStr === today) {
      setSelectedDate(null)
      setHistorySnapshots([])
    } else {
      setSelectedDate(dateStr)
      fetchHistory(dateStr)
    }
  }

  // 生成日历网格
  const generateCalendarDays = () => {
    const start = viewMonth.startOf('month')
    const end = viewMonth.endOf('month')
    const startDay = start.day()
    const daysInMonth = end.date()
    const days = []
    for (let i = 0; i < startDay; i++) days.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = viewMonth.date(d).format('YYYY-MM-DD')
      days.push({
        date: d,
        dateStr,
        hasData: availableDates.includes(dateStr),
        isToday: dateStr === dayjs().format('YYYY-MM-DD'),
        isSelected: dateStr === selectedDate,
      })
    }
    return days
  }

  const calendarDays = generateCalendarDays()

  // 当前显示的数据
  const displaySnapshots = selectedDate ? historySnapshots : snapshots

  return (
    <div className="page-container">
      {/* 日历区域 */}
      <Card style={{ marginBottom: 12 }}>
        <div style={{ background: '#fafafa', borderRadius: 12, padding: '8px 12px' }}>
          {/* 顶部导航栏 - 固定高度 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, minHeight: 28 }}>
            {/* 左侧按钮：固定尺寸 */}
            <div 
              onClick={calendarCollapsed ? goToPrevTradingDay : () => setViewMonth(viewMonth.subtract(1, 'month'))}
              style={{ 
                cursor: 'pointer', 
                color: '#1677ff',
                minWidth: 65,
                textAlign: 'center',
                fontSize: 13,
              }}
            >
              {calendarCollapsed ? '上一交易日' : <LeftOutline />}
            </div>
            
            {/* 中间标题 + 展开/收起按钮 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                {calendarCollapsed && selectedDate 
                  ? `${selectedDate} ${weekDays[dayjs(selectedDate).day()]}`
                  : viewMonth.format('YYYY年M月')}
              </span>
              <span 
                onClick={() => setCalendarCollapsed(!calendarCollapsed)}
                style={{ fontSize: 12, color: '#1677ff', cursor: 'pointer' }}
              >
                {calendarCollapsed ? '展开' : '收起'}
              </span>
            </div>
            
            {/* 右侧按钮：固定尺寸 */}
            <div 
              onClick={calendarCollapsed ? goToNextTradingDay : () => setViewMonth(viewMonth.add(1, 'month'))}
              style={{ 
                cursor: 'pointer', 
                color: '#1677ff',
                minWidth: 65,
                textAlign: 'center',
                fontSize: 13,
              }}
            >
              {calendarCollapsed ? '下一交易日' : <RightOutline />}
            </div>
          </div>

          {/* 星期标题 - 固定样式 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 2 }}>
            {weekDays.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 11, color: '#999', padding: '2px 0' }}>{d}</div>
            ))}
          </div>

          {/* 日历网格 - 带过渡动画 */}
          <div style={{ 
            overflow: 'hidden', 
            transition: 'max-height 0.3s ease',
            maxHeight: calendarCollapsed ? '35px' : '220px',
          }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {calendarCollapsed ? (
              // 收起模式：只显示选中日期所在的那一行
              (() => {
                const selectedDay = dayjs(selectedDate || dayjs())
                const startOfWeek = selectedDay.startOf('week') // 周日
                const weekDaysArr = []
                for (let i = 0; i < 7; i++) {
                  const d = startOfWeek.add(i, 'day')
                  const dateStr = d.format('YYYY-MM-DD')
                  weekDaysArr.push({
                    date: d.date(),
                    dateStr,
                    hasData: availableDates.includes(dateStr),
                    isToday: dateStr === dayjs().format('YYYY-MM-DD'),
                    isSelected: dateStr === selectedDate,
                    inCurrentMonth: d.month() === selectedDay.month(),
                  })
                }
                return weekDaysArr.map((day, idx) => (
                  <div
                    key={idx}
                    onClick={() => day.hasData && handleDateSelect(day.dateStr)}
                    style={{
                      textAlign: 'center',
                      padding: '4px 0',
                      borderRadius: 6,
                      cursor: day.hasData ? 'pointer' : 'default',
                      background: day.isSelected ? '#1677ff' : 'transparent',
                      color: day.isSelected ? '#fff' : day.hasData ? '#333' : '#ccc',
                      position: 'relative',
                      fontSize: 13,
                      opacity: !day.hasData && !day.isSelected ? 0.4 : 1,
                    }}
                  >
                    {day.date}
                    {day.hasData && !day.isSelected && (
                      <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#1677ff', margin: '1px auto 0' }} />
                    )}
                  </div>
                ))
              })()
            ) : (
              // 展开模式：显示整月
              calendarDays.map((day, idx) => (
                <div
                  key={idx}
                  onClick={() => day && day.hasData && handleDateSelect(day.dateStr)}
                  style={{
                    textAlign: 'center',
                    padding: '4px 0',
                    borderRadius: 6,
                    cursor: day?.hasData ? 'pointer' : 'default',
                    background: day?.isSelected ? '#1677ff' : 'transparent',
                    color: day?.isSelected ? '#fff' : day?.hasData ? '#333' : '#ccc',
                    position: 'relative',
                    fontSize: 13,
                    opacity: day && !day.hasData && !day.isSelected ? 0.4 : 1,
                  }}
                >
                  {day ? day.date : ''}
                  {day?.hasData && !day.isSelected && (
                    <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#1677ff', margin: '1px auto 0' }} />
                  )}
                </div>
              ))
            )}
          </div>
          </div>
          
          {selectedDate && (
            <div style={{ marginTop: 8, textAlign: 'center' }}>
              <Button size="mini" fill="outline" onClick={() => { setSelectedDate(null); setHistorySnapshots([]) }}>
                返回今日
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* 主卡片：A股全市场成交额 */}
      <Card style={{ padding: 12, marginBottom: 12 }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
        }}>
          <div style={{ fontSize: 14, color: '#666', fontWeight: 500 }}>
            A股全市场成交额
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tag
              color={marketStatus === 'morning' || marketStatus === 'afternoon' ? 'primary' : 'default'}
              style={{ fontSize: 11 }}
            >
              {STATUS_MAP[marketStatus] || marketStatus}
            </Tag>
            <Button
              size="mini"
              fill="none"
              onClick={handleRefresh}
              style={{ padding: '2px 8px', fontSize: 12 }}
            >
              {loading ? <SpinLoading style={{ '--size': '14px' }} /> : '刷新'}
            </Button>
          </div>
        </div>
        {/* 数据源说明 */}
        <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>
          沪市 + 深市 + 北证50（北交所为估算值，约占全市场70-80%）
        </div>

        {/* 总成交额 + 较昨日此时（同一行） */}
        <div style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}>
          <div style={{
            fontSize: 26,
            fontWeight: 700,
            color: '#333',
            fontFamily: 'DIN Alternate, Helvetica Neue, monospace',
          }}>
            {currentTurnover > 0 ? formatAmount(currentTurnover) : '--'}
          </div>
          {yesterdayComp && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 11, color: '#999' }}>
                {yesterdayComp.isExactMatch
                  ? `较昨日此时（${yesterdayComp.time}）`
                  : `较昨日（${yesterdayComp.time}）`}
              </span>
              <span style={{
                fontSize: 14,
                fontWeight: 600,
                color: formatIncrement(yesterdayComp.diff).color,
              }}>
                {formatIncrement(yesterdayComp.diff).text}
              </span>
            </div>
          )}
        </div>
      </Card>

      {/* 成交额时间线 */}
      <Card
        title={selectedDate ? `${selectedDate} 成交额` : '今日成交额变化'}
        style={{ marginBottom: 12 }}
        extra={
          <span style={{ fontSize: 12, color: '#999' }}>
            {displaySnapshots.length > 0 ? `${displaySnapshots.length}条记录` : '暂无数据'}
          </span>
        }
      >
        {displaySnapshots.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '24px 0',
            color: '#ccc',
            fontSize: 14,
          }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
            <div>{selectedDate ? '该日期无记录' : '开盘后每分钟自动记录'}</div>
          </div>
        ) : (
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            {[...displaySnapshots].reverse().map((snap, idx) => {
              // 对比上一分钟
              const prevSnap = idx < displaySnapshots.length - 1
                ? displaySnapshots[displaySnapshots.length - 2 - idx]
                : null
              const changeVsPrev = prevSnap
                ? Number(snap.total_turnover) - Number(prevSnap.total_turnover)
                : null

              // 对比昨日此时
              let changeVsYesterday = null
              if (yesterdayData.snapshots && yesterdayData.snapshots.length > 0) {
                const ySnap = yesterdayData.snapshots.find(s => s.snapshot_time === snap.snapshot_time)
                if (ySnap) {
                  changeVsYesterday = Number(snap.total_turnover) - Number(ySnap.total_turnover)
                }
              }

              const prevColor = changeVsPrev > 0 ? '#e74c3c' : changeVsPrev < 0 ? '#27ae60' : '#999'
              const yestColor = changeVsYesterday > 0 ? '#e74c3c' : changeVsYesterday < 0 ? '#27ae60' : '#999'

              return (
                <div
                  key={snap.id || snap.snapshot_time}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 0',
                    borderBottom: idx < displaySnapshots.length - 1 ? '1px solid #f5f5f5' : 'none',
                    fontSize: 11,
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontWeight: 500, fontSize: 12, color: '#333', minWidth: 40 }}>{snap.snapshot_time}</span>
                  {changeVsPrev !== null && changeVsPrev !== 0 && (
                    <span style={{ color: prevColor }}>
                      较上一分钟: {formatIncrement(changeVsPrev).text}
                    </span>
                  )}
                  {changeVsYesterday !== null && changeVsYesterday !== 0 && (
                    <span style={{ color: yestColor }}>
                      较昨日此时: {formatIncrement(changeVsYesterday).text}
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', fontWeight: 600, fontSize: 12, color: '#333' }}>
                    {formatAmount(Number(snap.total_turnover))}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* 近20日/60日平均成交额 */}
      <Card style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          marginBottom: 10 
        }}>
          <div style={{ fontSize: 14, color: '#666', fontWeight: 500 }}>
            历史平均成交额
            {averages?.latestDate && (
              <span style={{ fontSize: 11, color: '#999', fontWeight: 400, marginLeft: 8 }}>
                截至 {averages.latestDate}
              </span>
            )}
            <span style={{ fontSize: 10, color: '#bbb', fontWeight: 400, marginLeft: 8 }}>
              （不含北交所）
            </span>
          </div>
          <Button
            size="mini"
            fill="none"
            onClick={handleRefreshAverages}
            style={{ padding: '2px 8px', fontSize: 12 }}
          >
            {refreshingAverages ? <SpinLoading style={{ '--size': '14px' }} /> : '刷新'}
          </Button>
        </div>
        {!averages ? (
          <div style={{ textAlign: 'center', padding: '16px 0', color: '#ccc' }}>
            <SpinLoading style={{ '--size': '20px' }} />
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 12 }}>
            {/* 20日均线 */}
            <div style={{
              flex: 1,
              background: '#f8f9fa',
              borderRadius: 8,
              padding: '10px 12px',
            }}>
              <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>近20日平均</div>
              <div style={{
                fontSize: 18,
                fontWeight: 700,
                color: '#333',
                fontFamily: 'DIN Alternate, Helvetica Neue, monospace',
              }}>
                {averages.ma20 ? formatAmount(averages.ma20) : '--'}
              </div>
              {averages.ma20 && averages.latestTurnover > 0 && (
                <div style={{
                  fontSize: 11,
                  marginTop: 4,
                  color: averages.latestTurnover >= averages.ma20 ? '#e74c3c' : '#27ae60',
                }}>
                  当日 {averages.latestTurnover >= averages.ma20 ? '↑' : '↓'}{' '}
                  {((averages.latestTurnover / averages.ma20 - 1) * 100).toFixed(1)}%
                </div>
              )}
            </div>
            {/* 60日均线 */}
            <div style={{
              flex: 1,
              background: '#f8f9fa',
              borderRadius: 8,
              padding: '10px 12px',
            }}>
              <div style={{ fontSize: 11, color: '#999', marginBottom: 4 }}>近60日平均</div>
              <div style={{
                fontSize: 18,
                fontWeight: 700,
                color: '#333',
                fontFamily: 'DIN Alternate, Helvetica Neue, monospace',
              }}>
                {averages.ma60 ? formatAmount(averages.ma60) : '--'}
              </div>
              {averages.ma60 && averages.latestTurnover > 0 && (
                <div style={{
                  fontSize: 11,
                  marginTop: 4,
                  color: averages.latestTurnover >= averages.ma60 ? '#e74c3c' : '#27ae60',
                }}>
                  当日 {averages.latestTurnover >= averages.ma60 ? '↑' : '↓'}{' '}
                  {((averages.latestTurnover / averages.ma60 - 1) * 100).toFixed(1)}%
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* 均量趋势折线图 */}
      {averagesTrend.length > 0 && (
        <Card style={{ padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: '#666', fontWeight: 500, marginBottom: 8 }}>
            均量趋势
            <span style={{ fontSize: 10, color: '#bbb', fontWeight: 400, marginLeft: 8 }}>
              （不含北交所）
            </span>
          </div>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={averagesTrend.slice(-trendRange).map(d => ({
                date: d.trade_date.slice(5), // MM-DD
                ma20: d.ma20 ? parseFloat(d.ma20) : null,
                ma60: d.ma60 ? parseFloat(d.ma60) : null,
              }))} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: '#999' }}
                  interval={Math.max(1, Math.floor(trendRange / 6))}
                  axisLine={{ stroke: '#eee' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#999' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => v >= 10000 ? (v / 10000).toFixed(1) + '万' : v}
                  width={45}
                />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  formatter={(value, name) => [
                    value ? value.toLocaleString() + ' 亿' : '--',
                    name === 'ma20' ? 'MA20' : 'MA60',
                  ]}
                  labelFormatter={(label) => `日期: ${label}`}
                />
                <Legend
                  verticalAlign="top"
                  height={28}
                  formatter={(value) => value === 'ma20' ? 'MA20' : 'MA60'}
                  iconType="line"
                />
                <Line
                  type="monotone"
                  dataKey="ma20"
                  stroke="#1677ff"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="ma60"
                  stroke="#722ed1"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {[
              { label: '近20日', value: 20 },
              { label: '近60日', value: 60 },
              { label: '近半年', value: 120 },
              { label: '近一年', value: 250 },
            ].map(({ label, value }) => (
              <span
                key={value}
                onClick={() => {
                  setTrendRange(value)
                  if (averagesTrend.length < value) {
                    fetchAveragesTrend(value)
                  }
                }}
                style={{
                  fontSize: 12,
                  padding: '4px 12px',
                  borderRadius: 14,
                  cursor: 'pointer',
                  fontWeight: 600,
                  background: trendRange === value ? '#e74c3c' : '#f5f5f5',
                  color: trendRange === value ? '#fff' : '#999',
                  border: trendRange === value ? '1px solid #e74c3c' : '1px solid #e0e0e0',
                }}
              >
                {label}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* 沪深A股成交额（来自 AKShare） */}
      <Card style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ fontSize: 14, color: '#666', fontWeight: 500, marginBottom: 4 }}>
          沪深A股成交额
          <span style={{ fontSize: 10, color: '#bbb', fontWeight: 400, marginLeft: 8 }}>
            数据来源：AKShare
          </span>
        </div>
        {exchangeData.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '16px 0', color: '#ccc' }}>
            <SpinLoading style={{ '--size': '20px' }} />
          </div>
        ) : (
          <>
            {/* 折线图 */}
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <LineChart data={exchangeData.slice(-exchangeRange).map(d => ({
                  date: d.trade_date.slice(5), // MM-DD
                  amount: d.amount_yi ? parseFloat(d.amount_yi) : null,
                }))} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#999' }}
                    interval={Math.max(1, Math.floor(exchangeRange / 6))}
                    axisLine={{ stroke: '#eee' }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#999' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => v >= 10000 ? (v / 10000).toFixed(1) + '万' : v}
                    width={45}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    formatter={(value) => [value ? value.toLocaleString() + ' 亿' : '--', 'A股成交额']}
                    labelFormatter={(label) => `日期: ${label}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="amount"
                    stroke="#e74c3c"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3 }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {/* 时间范围切换 */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 8 }}>
              {[
                { label: '近30日', value: 30 },
                { label: '近60日', value: 60 },
                { label: '近半年', value: 120 },
                { label: '近一年', value: 250 },
              ].map(opt => (
                <span
                  key={opt.value}
                  onClick={() => setExchangeRange(opt.value)}
                  style={{
                    fontSize: 12,
                    padding: '4px 12px',
                    borderRadius: 14,
                    cursor: 'pointer',
                    fontWeight: 600,
                    background: exchangeRange === opt.value ? '#e74c3c' : '#f5f5f5',
                    color: exchangeRange === opt.value ? '#fff' : '#999',
                    border: exchangeRange === opt.value ? '1px solid #e74c3c' : '1px solid #e0e0e0',
                  }}
                >
                  {opt.label}
                </span>
              ))}
            </div>
            {/* 最近5天数据表格 */}
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: '#f8f9fa', color: '#666' }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 500 }}>日期</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 500 }}>沪A</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 500 }}>深A</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 500 }}>A股合计</th>
                  </tr>
                </thead>
                <tbody>
                  {[...exchangeData].reverse().slice(0, 5).map((row, idx) => (
                    <tr key={row.trade_date || idx} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={{ padding: '6px 8px', color: '#333' }}>{row.trade_date}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: '#333' }}>
                        {row.sse_amount ? `${Number(row.sse_amount).toLocaleString()}亿` : '--'}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: '#333' }}>
                        {row.szse_amount ? `${Number(row.szse_amount).toLocaleString()}亿` : '--'}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: '#333' }}>
                        {row.amount_yi ? `${Number(row.amount_yi).toLocaleString()}亿` : '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
