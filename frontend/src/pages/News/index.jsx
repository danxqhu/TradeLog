import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Tabs, Tag, Empty, Button, SpinLoading, Toast, Dialog } from 'antd-mobile'
import { LeftOutline, RightOutline } from 'antd-mobile-icons'
import { shanghaiNewsApi } from '../../services/api'
import dayjs from 'dayjs'

const weekDays = ['日', '一', '二', '三', '四', '五', '六']

export default function News() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('shanghai')
  const [selectedDate, setSelectedDate] = useState(dayjs().format('YYYY-MM-DD'))
  const [viewMonth, setViewMonth] = useState(dayjs())
  const [availableDates, setAvailableDates] = useState([])
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(false)
  const [scraping, setScraping] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [refreshingStocks, setRefreshingStocks] = useState(false)
  const [stockDictInfo, setStockDictInfo] = useState(null)
  const [showOnlyStock, setShowOnlyStock] = useState(true)
  const [calendarCollapsed, setCalendarCollapsed] = useState(true)

  // 加载有数据的日期列表
  const fetchDates = useCallback(async () => {
    try {
      const res = await shanghaiNewsApi.getDates()
      setAvailableDates(Array.isArray(res) ? res : res.data || [])
    } catch (err) {
      console.error('获取日期列表失败:', err)
    }
  }, [])

  // 加载指定日期的文章
  const fetchArticles = useCallback(async (date) => {
    setLoading(true)
    try {
      const res = await shanghaiNewsApi.getList({ date, pageSize: 100 })
      setArticles(Array.isArray(res) ? res : res.data || [])
    } catch (err) {
      console.error('获取文章失败:', err)
      setArticles([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDates()
    // 加载股票词典信息
    shanghaiNewsApi.getStockDict().then(res => setStockDictInfo(res)).catch(() => {})
  }, [fetchDates])

  useEffect(() => {
    fetchArticles(selectedDate)
  }, [selectedDate, fetchArticles])

  // 触发抓取
  const handleScrape = async () => {
    setScraping(true)
    try {
      const res = await shanghaiNewsApi.scrape(selectedDate)
      if (res.success) {
        Dialog.alert({
          title: '抓取完成',
          content: res.message,
          confirmText: '关闭',
        })
        await fetchDates()
        await fetchArticles(selectedDate)
        if (res.date && res.date !== selectedDate) {
          setSelectedDate(res.date)
          setViewMonth(dayjs(res.date))
        }
      } else {
        Toast.show('抓取失败')
      }
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

  // 触发重新扫描股票
  const handleRescan = async () => {
    setScanning(true)
    try {
      const res = await shanghaiNewsApi.rescan(selectedDate)
      Dialog.alert({
        title: '扫描完成',
        content: res.message || '扫描完成',
        confirmText: '关闭',
      })
      await fetchArticles(selectedDate)
    } catch (err) {
      Toast.show('扫描失败')
    } finally {
      setScanning(false)
    }
  }

  // 刷新股票词典
  const handleRefreshStocks = async () => {
    setRefreshingStocks(true)
    try {
      const res = await shanghaiNewsApi.refreshStocks()
      Toast.show({ content: res.message || `已更新 ${res.count} 只股票`, duration: 3000 })
      const info = await shanghaiNewsApi.getStockDict()
      setStockDictInfo(info)
    } catch (err) {
      Toast.show('刷新失败')
    } finally {
      setRefreshingStocks(false)
    }
  }

  const hasDataForDate = availableDates.includes(selectedDate)

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

  return (
    <div className="page-container">
      <Card>
        <Tabs activeKey={activeTab} onChange={(key) => {
          if (key === 'goldman') {
            navigate('/goldman-sachs')
          } else {
            setActiveTab(key)
          }
        }}>
          <Tabs.Tab key="shanghai" title="上海证券报" />
          <Tabs.Tab key="goldman" title="高盛研报 →" />
        </Tabs>

        <div style={{ marginTop: 12 }}>
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

            {/* 股票词典状态 */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              background: '#f9f9f9', borderRadius: 6, padding: '4px 8px', marginBottom: 8,
              fontSize: 11, color: '#888',
            }}>
              <span>
                股票库：{stockDictInfo ? `${stockDictInfo.count} 只` : '未加载'}
                {stockDictInfo?.updatedAt && ` · 更新于 ${dayjs(stockDictInfo.updatedAt).format('M/D HH:mm')}`}
              </span>
              <Button
                size="mini"
                fill="none"
                onClick={handleRefreshStocks}
                loading={refreshingStocks}
                disabled={refreshingStocks}
                style={{ fontSize: 11, padding: '0 4px' }}
              >
                {refreshingStocks ? '拉取中...' : '刷新股票库'}
              </Button>
            </div>

            {/* 操作栏 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: '#666' }}>
                {selectedDate} {articles.length > 0 ? `共 ${articles.length} 篇` : ''}
                {showOnlyStock && ` (仅显示有股票的)`}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                {hasDataForDate && (
                  <>
                    <Button
                      size="mini"
                      fill={showOnlyStock ? 'solid' : 'outline'}
                      color={showOnlyStock ? 'primary' : 'default'}
                      onClick={() => setShowOnlyStock(!showOnlyStock)}
                      style={{ fontSize: 11 }}
                    >
                      {showOnlyStock ? '查看全部' : '仅看有股票'}
                    </Button>
                    <Button
                      size="mini"
                      fill="outline"
                      onClick={handleRescan}
                      loading={scanning}
                      disabled={scanning || scraping}
                      style={{ fontSize: 11 }}
                    >
                      扫描股票
                    </Button>
                  </>
                )}
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
              💡 每日自动抓取：凌晨 3:00、早上 6:00
            </div>

            {/* 文章列表 */}
            {loading ? (
              <div style={{ textAlign: 'center', padding: 20 }}>
                <SpinLoading style={{ '--size': '20px' }} />
              </div>
            ) : articles.length === 0 ? (
              <Empty description="该日期暂无数据，点击上方按钮抓取" />
            ) : (
              <div style={{ borderTop: '1px solid #f0f0f0' }}>
                {(showOnlyStock
                  ? articles.filter(item => item.mentioned_stocks && item.mentioned_stocks.length > 0)
                  : articles
                ).map((item, idx) => (
                  <div key={item.id} style={{
                    padding: '5px 0',
                    borderBottom: '1px solid #f5f5f5',
                  }}>
                    {/* 标题 */}
                    <div style={{
                      fontSize: 13, fontWeight: 500, lineHeight: 1.4,
                      color: '#333', marginBottom: 2,
                    }}>
                      {item.title}
                    </div>
                    {/* 第二行：原文在左，股票+版面在右 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {item.url && (
                        <a href={item.url} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 11, color: '#1677ff', textDecoration: 'none', flexShrink: 0 }}>
                          原文 ↗
                        </a>
                      )}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, overflow: 'hidden' }}>
                        {item.section && (
                          <span style={{
                            fontSize: 10, color: '#999', background: '#f5f5f5',
                            padding: '0 4px', borderRadius: 2, lineHeight: '16px', flexShrink: 0,
                          }}>{item.section}</span>
                        )}
                        {item.mentioned_stocks?.map((s, i) => (
                          <span key={i} style={{
                            fontSize: 10, color: '#1677ff', background: '#e6f4ff',
                            padding: '0 4px', borderRadius: 2, lineHeight: '16px', flexShrink: 0,
                          }}>
                            {s.name} {s.code}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </div>
      </Card>
    </div>
  )
}
