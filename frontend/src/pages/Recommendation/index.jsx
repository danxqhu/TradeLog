import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Tabs, Button, Empty, NavBar } from 'antd-mobile'
import { AddOutline, LeftOutline } from 'antd-mobile-icons'
import { recommendationApi } from '../../services/api'
import AddForm from './AddForm'

export default function Recommendation() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTabState] = useState(() => sessionStorage.getItem('rec_tab') || 'morning')
  const setActiveTab = (tab) => {
    setActiveTabState(tab)
    sessionStorage.setItem('rec_tab', tab)
  }
  const [recommendations, setRecommendations] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [sortBy, setSortBy] = useState('time_desc')

  const sortOptions = [
    { label: '最新', value: 'time_desc' },
    { label: '最早', value: 'time_asc' },
    { label: '仅看持仓↑', value: 'position_asc' },
    { label: '仅看持仓↓', value: 'position_desc' },
  ]

  useEffect(() => {
    fetchRecommendations()
  }, [activeTab, sortBy])

  const fetchRecommendations = async () => {
    try {
      const params = { type: activeTab, sort: sortBy }
      const source = searchParams.get('source')
      if (source) params.source = source
      const res = await recommendationApi.getList(params)
      setRecommendations(res.data || [])
    } catch (error) {
      console.error('获取推荐列表失败:', error)
    }
  }

  const handleAddSuccess = () => {
    setShowAdd(false)
    fetchRecommendations()
  }

  const calcReturn = (rec) => {
    const ret = ((rec.current_price - rec.recommend_price) / rec.recommend_price * 100).toFixed(2)
    return ret
  }

  return (
    <div className="page-container" style={{ '--adm-color-primary': '#8B3A42' }}>
      <style>{`
        .rec-reasons { display: none; }
        .rec-reasons-inline { display: inline; margin-left: 4px; }
        @media (max-width: 540px) {
          .rec-reasons { display: flex !important; margin-top: 2px; }
          .rec-reasons-inline { display: none !important; }
        }
      `}</style>
      <NavBar backIcon={<LeftOutline />} onBack={() => navigate(-1)} style={{ fontSize: 14 }}>推荐管理</NavBar>

      <div style={{ padding: '0 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
          <Tabs activeKey={activeTab} onChange={setActiveTab} style={{ '--title-font-size': '13px' }}>
            <Tabs.Tab key="morning" title="早盘" />
            <Tabs.Tab key="afternoon" title="午盘" />
          </Tabs>
          <Button size="mini" color="primary" fill="outline" onClick={() => setShowAdd(true)} style={{ fontSize: 12, padding: '2px 10px' }}>
            <AddOutline /> 添加
          </Button>
        </div>

        {/* 排序按钮 */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          {sortOptions.map(opt => (
            <span
              key={opt.value}
              onClick={() => setSortBy(opt.value)}
              style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 10, cursor: 'pointer',
                background: sortBy === opt.value ? '#8B3A42' : '#f5f5f5',
                color: sortBy === opt.value ? '#fff' : '#666',
              }}
            >
              {opt.label}
            </span>
          ))}
        </div>

        {recommendations.length === 0 ? (
          <Empty description={`暂无${activeTab === 'morning' ? '早盘' : '午盘'}推荐`} style={{ marginTop: 40 }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {recommendations.map(rec => {
              const ret = calcReturn(rec)
              const isUp = Number(ret) >= 0
              const recReasons = rec.reasons || []
              return (
                <div
                  key={rec.id}
                  onClick={() => navigate(`/recommendation/${rec.id}`)}
                  style={{
                    padding: '4px 4px',
                    borderBottom: '1px solid #f5f5f5', cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {/* 股票名+代码 */}
                    <div style={{ flex: '0 0 auto', maxWidth: '30%' }}>
                      <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {rec.stock_name}
                        <span style={{ fontSize: 10, color: '#999', marginLeft: 3, fontWeight: 400 }}>{rec.stock_code}</span>
                      </div>
                    </div>
                    {/* 推荐信息 */}
                    <div style={{ flex: '1 1 auto', fontSize: 10, color: '#666', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <span style={{ color: '#999' }}>荐</span>¥{rec.recommend_price}
                      <span style={{ color: '#ccc', margin: '0 3px' }}>|</span>
                      <span style={{ color: '#999' }}>{rec.recommend_date.slice(5)} {rec.recommend_time}</span>
                      {/* 电脑端：理由跟在时间后面，同一行 */}
                      {recReasons.length > 0 && (
                        <span className="rec-reasons-inline">
                          {recReasons.map((reason, idx) => (
                            <span key={idx} style={{
                              fontSize: 9, color: '#8B3A42', background: '#F5E6E8',
                              borderRadius: 3, padding: '0 4px', marginLeft: 3,
                            }}>{reason}</span>
                          ))}
                        </span>
                      )}
                      {rec.position && (
                        <span style={{
                          fontSize: 9, color: '#8B3A42', border: '1px solid #8B3A42',
                          borderRadius: 3, padding: '0 3px', marginLeft: 4,
                        }}>已持仓</span>
                      )}
                    </div>
                    {/* 现价+涨跌幅（同一行） */}
                    <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 11, fontWeight: 600 }}>¥{rec.current_price}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, color: isUp ? '#e74c3c' : '#27ae60' }}>
                        {isUp ? '+' : ''}{ret}%
                      </span>
                    </div>
                  </div>
                  {/* 移动端：理由显示在第二行 */}
                  {recReasons.length > 0 && (
                    <div className="rec-reasons" style={{ display: 'none', flexWrap: 'wrap', gap: 3 }}>
                      {recReasons.map((reason, idx) => (
                        <span key={idx} style={{
                          fontSize: 9, color: '#8B3A42', background: '#F5E6E8',
                          borderRadius: 3, padding: '0 4px', lineHeight: '16px',
                        }}>{reason}</span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 添加推荐表单 */}
      {showAdd && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
        }}>
          {/* 遮罩 */}
          <div
            onClick={() => setShowAdd(false)}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.4)',
            }}
          />
          {/* 表单区域 */}
          <div style={{
            position: 'relative',
            background: '#fff',
            padding: 16,
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
            maxHeight: '80vh',
            overflowY: 'auto',
          }}>
            <AddForm type={activeTab} onSuccess={handleAddSuccess} />
          </div>
        </div>
      )}
    </div>
  )
}
