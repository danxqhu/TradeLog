import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, NavBar, Tag, Empty, Button, Space, SpinLoading, Toast, Dialog } from 'antd-mobile'
import { LeftOutline, RightOutline } from 'antd-mobile-icons'
import { researchReportApi, shanghaiNewsApi } from '../../services/api'
import dayjs from 'dayjs'

const ratingColors = { '超配': 'error', '标配': 'warning', '低配': 'success' }
const labelDisplay = {
  core: '大盘策略', core_theme: '主题策略', apac_view: '亚太附带',
  macro_view: '宏观附带', gsam_view: '资管观点', interview: '专访观点',
}
const labelColors = {
  core: '#1677ff', core_theme: '#00b578', apac_view: '#ff8f1f',
  macro_view: '#9c27b0', gsam_view: '#999', interview: '#666',
}
const weekDays = ['日', '一', '二', '三', '四', '五', '六']

export default function GoldmanSachs() {
  const navigate = useNavigate()
  const [selectedDate, setSelectedDate] = useState(dayjs().format('YYYY-MM-DD'))
  const [viewMonth, setViewMonth] = useState(dayjs())
  const [availableDates, setAvailableDates] = useState([])
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(false)
  const [scraping, setScraping] = useState(false)
  const [importing, setImporting] = useState(false)
  const [stockDictInfo, setStockDictInfo] = useState(null)
  const [refreshingStocks, setRefreshingStocks] = useState(false)
  const [syncProgressInfo, setSyncProgressInfo] = useState(null)
  const [showOnlyCore, setShowOnlyCore] = useState(false)
  const [calendarCollapsed, setCalendarCollapsed] = useState(true)

  // 加载有数据的日期列表
  const fetchDates = useCallback(async () => {
    try {
      const res = await researchReportApi.getDates()
      setAvailableDates(Array.isArray(res) ? res : res.data || [])
    } catch (err) {
      console.error('获取日期列表失败:', err)
    }
  }, [])

  // 加载指定日期的研报，无日期则加载最近3篇
  const fetchReports = useCallback(async (date) => {
    setLoading(true)
    try {
      const params = { pageSize: 100 }
      if (date) params.date = date
      const res = await researchReportApi.getList(params)
      setReports(Array.isArray(res) ? res : res.data || [])
    } catch (err) {
      console.error('获取研报失败:', err)
      setReports([])
    } finally {
      setLoading(false)
    }
  }, [])

  // 加载最近3篇研报（不筛选日期）
  const fetchLatest = useCallback(async () => {
    setLoading(true)
    try {
      const res = await researchReportApi.getList({ pageSize: 3 })
      setReports(Array.isArray(res) ? res : res.data || [])
    } catch (err) {
      console.error('获取最新研报失败:', err)
      setReports([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDates()
    shanghaiNewsApi.getStockDict().then(res => setStockDictInfo(res)).catch(() => {})
  }, [fetchDates])

  useEffect(() => {
    // 如果选中的日期有数据，显示该日期的；否则显示最近3篇
    if (availableDates.includes(selectedDate)) {
      fetchReports(selectedDate)
    } else {
      fetchLatest()
    }
  }, [selectedDate, availableDates, fetchReports, fetchLatest])

  // 触发抓取
  const handleScrape = async () => {
    setScraping(true)
    try {
      const res = await researchReportApi.scrape('all')
      Dialog.alert({
        title: '抓取完成',
        content: res.message || `新增 ${res.created} 篇`,
        confirmText: '关闭',
      })
      await fetchDates()
      await fetchLatest()
    } catch (err) {
      Dialog.alert({
        title: '抓取失败',
        content: err.response?.data?.error || err.message,
        confirmText: '关闭',
      })
    } finally {
      setScraping(false)
    }
  }

  // 导入历史数据
  const handleImportHistory = async () => {
    Dialog.confirm({
      title: '导入历史数据',
      content: '将导入近3年刘劲津团队公开大盘策略清单（约10篇），确定导入？',
      onConfirm: async () => {
        setImporting(true)
        try {
          const res = await researchReportApi.importHistory()
          Toast.show({ content: res.message || '导入完成', duration: 3000 })
          await fetchDates()
          await fetchLatest()
        } catch (err) {
          Toast.show('导入失败')
        } finally {
          setImporting(false)
        }
      },
    })
  }

  // 刷新股票库（异步轮询，显示进度）
  const handleRefreshStocks = async () => {
    setRefreshingStocks(true)
    setSyncProgressInfo({ percent: 0, stage: '正在发起同步...' })
    try {
      await shanghaiNewsApi.refreshStocks()
      // 轮询等待刷新完成，每 2 秒查询一次进度
      const poll = async (retries = 0) => {
        if (retries > 90) {
          Toast.show({ content: '同步超时，请稍后重试', duration: 3000 })
          setRefreshingStocks(false)
          setSyncProgressInfo(null)
          return
        }
        await new Promise(r => setTimeout(r, 2000))
        try {
          const status = await shanghaiNewsApi.getRefreshStatus()
          if (status.progress) {
            setSyncProgressInfo(status.progress)
          }
          if (!status.running && status.lastResult) {
            Toast.show({ content: status.lastResult.message || '同步完成', duration: 4000 })
            const info = await shanghaiNewsApi.getStockDict()
            setStockDictInfo(info)
            setRefreshingStocks(false)
            setSyncProgressInfo(null)
          } else if (!status.running && status.lastError) {
            Toast.show({ content: '同步失败: ' + status.lastError, duration: 4000 })
            setRefreshingStocks(false)
            setSyncProgressInfo(null)
          } else {
            await poll(retries + 1)
          }
        } catch {
          await poll(retries + 1)
        }
      }
      await poll()
    } catch (err) {
      Toast.show('同步失败')
      setRefreshingStocks(false)
      setSyncProgressInfo(null)
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
  const hasDataForDate = availableDates.includes(selectedDate)

  // 过滤显示
  const displayReports = showOnlyCore
    ? reports.filter(r => r.label === 'core' || r.label === 'core_theme')
    : reports

  return (
    <div className="page-container">
      <NavBar backIcon={<LeftOutline />} onBack={() => navigate(-1)}>高盛研报</NavBar>

      <Card style={{ marginTop: 12 }}>
        {/* 日历 */}
        <div style={{ background: '#fafafa', borderRadius: 12, padding: '8px 12px', marginBottom: 12 }}>
          {/* 顶部导航栏 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, minHeight: 28 }}>
            <div 
              onClick={() => setViewMonth(viewMonth.subtract(1, 'month'))}
              style={{ cursor: 'pointer', color: '#1677ff', minWidth: 30, textAlign: 'center', fontSize: 18 }}
            >
              <LeftOutline />
            </div>
            
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
            
            <div 
              onClick={() => setViewMonth(viewMonth.add(1, 'month'))}
              style={{ cursor: 'pointer', color: '#1677ff', minWidth: 30, textAlign: 'center', fontSize: 18 }}
            >
              <RightOutline />
            </div>
          </div>

          {/* 星期标题 */}
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
              (() => {
                const selectedDay = dayjs(selectedDate || dayjs())
                const startOfWeek = selectedDay.startOf('week')
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
                  })
                }
                return weekDaysArr.map((day, idx) => (
                  <div
                    key={idx}
                    onClick={() => day.hasData && setSelectedDate(day.dateStr)}
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
              calendarDays.map((day, idx) => (
                <div
                  key={idx}
                  onClick={() => day && day.hasData && setSelectedDate(day.dateStr)}
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
        </div>

        {/* 股票库状态 */}
        <div style={{
          background: '#f9f9f9', borderRadius: 6, padding: '6px 8px', marginBottom: 8,
          fontSize: 11, color: '#888',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>
              股票库：{stockDictInfo ? `${stockDictInfo.count} 只上市` : '未加载'}
              {stockDictInfo?.delistedCount > 0 && ` / ${stockDictInfo.delistedCount} 只退市`}
              {stockDictInfo?.updatedAt && ` · 更新于 ${dayjs(stockDictInfo.updatedAt).format('M/D HH:mm')}`}
            </span>
            <Button
              size="mini"
              fill="none"
              onClick={handleRefreshStocks}
              disabled={refreshingStocks}
              style={{ fontSize: 11, padding: '0 4px' }}
            >
              {refreshingStocks ? '同步中...' : '同步股票库'}
            </Button>
          </div>
          {/* 进度条 */}
          {syncProgressInfo && (
            <div style={{ marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 10, color: '#666' }}>{syncProgressInfo.stage}</span>
                <span style={{ fontSize: 10, color: '#1677ff' }}>{syncProgressInfo.percent}%</span>
              </div>
              <div style={{ height: 4, background: '#e0e0e0', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  width: `${syncProgressInfo.percent}%`,
                  background: '#1677ff',
                  borderRadius: 2,
                  transition: 'width 0.3s ease',
                }} />
              </div>
            </div>
          )}
        </div>

        {/* 操作栏 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: '#666' }}>
            {hasDataForDate ? `${selectedDate} 共 ${reports.length} 篇` : `最近 ${reports.length} 篇`}
            {showOnlyCore && ' (仅大盘策略)'}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            {hasDataForDate && (
              <Button
                size="mini"
                fill={showOnlyCore ? 'solid' : 'outline'}
                color={showOnlyCore ? 'primary' : 'default'}
                onClick={() => setShowOnlyCore(!showOnlyCore)}
                style={{ fontSize: 11 }}
              >
                {showOnlyCore ? '查看全部' : '仅大盘策略'}
              </Button>
            )}
            <Button
              size="mini"
              fill="outline"
              onClick={handleImportHistory}
              loading={importing}
              disabled={importing || scraping}
              style={{ fontSize: 11 }}
            >
              导入历史
            </Button>
            <Button
              size="mini"
              color="primary"
              fill={hasDataForDate ? 'outline' : 'solid'}
              onClick={handleScrape}
              loading={scraping}
              disabled={scraping}
              style={{ fontSize: 11 }}
            >
              {hasDataForDate ? '重新抓取' : '抓取当日'}
            </Button>
          </div>
        </div>

        {/* 自动抓取提示 */}
        <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>
          💡 每日自动抓取：1:00、7:00、13:00、19:00
        </div>

        {/* 研报列表 */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <SpinLoading style={{ '--size': '20px' }} />
          </div>
        ) : displayReports.length === 0 ? (
          <Empty description={availableDates.length === 0 ? '暂无数据，点击"导入历史"初始化' : '该日期无研报'} />
        ) : (
          <div style={{ borderTop: '1px solid #f0f0f0' }}>
            {displayReports.map((report) => (
              <div key={report.id} style={{ padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}>
                {/* 标题行 - 优先显示中文翻译 */}
                <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.4, color: '#333', marginBottom: 4 }}>
                  {report.title_zh || report.title}
                </div>
                {/* 第二行：标签 + 分析师 + 评级 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                  {report.label && labelDisplay[report.label] && (
                    <span style={{
                      fontSize: 10, color: '#fff', background: labelColors[report.label] || '#999',
                      padding: '0 4px', borderRadius: 2, lineHeight: '16px',
                    }}>{labelDisplay[report.label]}</span>
                  )}
                  {report.report_type && (
                    <span style={{
                      fontSize: 10, color: '#999', background: '#f5f5f5',
                      padding: '0 4px', borderRadius: 2, lineHeight: '16px',
                    }}>{report.report_type}</span>
                  )}
                  {report.analyst && (
                    <span style={{ fontSize: 10, color: '#1677ff' }}>{report.analyst}</span>
                  )}
                  {report.rating && (
                    <Tag color={ratingColors[report.rating] || 'default'} style={{ fontSize: 10, fontWeight: 600, padding: '0 4px' }}>
                      {report.rating}
                    </Tag>
                  )}
                  {report.source_site && (
                    <span style={{ fontSize: 10, color: '#aaa' }}>来自{report.source_site}</span>
                  )}
                </div>
                {/* 摘要 - 优先显示中文翻译 */}
                {(report.summary_zh || report.summary) && (
                  <div style={{ fontSize: 12, color: '#666', lineHeight: 1.5, marginBottom: 4 }}>
                    {report.summary_zh || report.summary}
                  </div>
                )}
                {/* 目标价 + 链接 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {report.msci_china_target && (
                      <span style={{ fontSize: 10, color: '#e74c3c' }}>MSCI中国: {report.msci_china_target}</span>
                    )}
                    {report.csi300_target && (
                      <span style={{ fontSize: 10, color: '#e74c3c' }}>沪深300: {report.csi300_target}</span>
                    )}
                  </div>
                  {report.url && (
                    <a href={report.url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 11, color: '#1677ff', textDecoration: 'none', flexShrink: 0 }}>
                      原文 ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
