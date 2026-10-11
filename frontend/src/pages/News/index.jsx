import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Tabs, List, Tag, Empty, Button } from 'antd-mobile'
import { shanghaiNewsApi, researchReportApi } from '../../services/api'

export default function News() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('shanghai')
  const [shanghaiData, setShanghaiData] = useState([])
  const [goldmanData, setGoldmanData] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchData()
  }, [activeTab])

  const fetchData = async () => {
    setLoading(true)
    try {
      if (activeTab === 'shanghai') {
        // 模拟数据
        setShanghaiData([
          { id: 1, publish_date: '2026-10-11', title: '进击的ETF生态圈', section: 'A1：基金周刊', url: 'http://paper.cnstock.com/html/2026-10/11/content_2276088.htm', mentioned_stocks: [] },
          { id: 2, publish_date: '2026-10-11', title: '迷你基金“壳”价值失色', section: 'A1：基金周刊', url: 'http://paper.cnstock.com/html/2026-10/11/content_2276089.htm', mentioned_stocks: [] },
          { id: 3, publish_date: '2026-10-11', title: '长端美债收益率高企 机构热议全球科技股后市走向', section: 'A2：基金·一周', url: 'http://paper.cnstock.com/html/2026-10/11/content_2276064.htm', mentioned_stocks: [] },
        ])
      } else {
        setGoldmanData([
          { id: 1, publish_date: '2026-10-10', title: 'China Equities Outlook Q4 2026', summary: 'We maintain overweight rating on China equities...', url: 'https://www.goldmansachs.com/insights/pages/china-equities-outlook', rating: '超配' },
          { id: 2, publish_date: '2026-10-03', title: 'China Tech Sector Update', summary: 'Technology sector shows signs of recovery...', url: 'https://www.goldmansachs.com/insights/pages/china-tech-sector', rating: '标配' },
          { id: 3, publish_date: '2026-09-26', title: 'China Consumer Sector Analysis', summary: 'Consumer spending expected to recover in H2...', url: 'https://www.goldmansachs.com/insights/pages/china-consumer-analysis', rating: '超配' },
        ])
      }
    } catch (error) {
      console.error('获取数据失败:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-container">
      <Card>
        <Tabs activeKey={activeTab} onChange={setActiveTab}>
          <Tabs.Tab key="shanghai" title="上海证券报" />
          <Tabs.Tab key="goldman" title="高盛研报" />
        </Tabs>

        {activeTab === 'shanghai' ? (
          <div style={{ marginTop: 12 }}>
            <Button
              block
              size="small"
              fill="outline"
              onClick={() => navigate('/shanghai-news')}
              style={{ marginBottom: 12 }}
            >
              查看全部记录
            </Button>
            {shanghaiData.length === 0 ? (
              <Empty description="暂无数据" />
            ) : (
              shanghaiData.map(item => (
                <div key={item.id} className="card" style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#999', marginBottom: 4 }}>
                    <span>{item.publish_date}</span>
                    {item.section && <Tag style={{ fontSize: 11 }}>{item.section}</Tag>}
                  </div>
                  <div style={{ fontWeight: 500, marginBottom: 8 }}>{item.title}</div>
                  <div style={{ marginBottom: 8 }}>
                    {item.mentioned_stocks?.map(s => (
                      <Tag key={s.code} color="primary" style={{ marginRight: 4, marginBottom: 4 }}>
                        {s.name}
                      </Tag>
                    ))}
                  </div>
                  {item.url && (
                    <a href={item.url} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#1677ff' }}>
                      查看原文 →
                    </a>
                  )}
                </div>
              ))
            )}
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            <Button
              block
              size="small"
              fill="outline"
              onClick={() => navigate('/goldman-sachs')}
              style={{ marginBottom: 12 }}
            >
              查看全部研报
            </Button>
            {goldmanData.length === 0 ? (
              <Empty description="暂无数据" />
            ) : (
              goldmanData.map(item => (
                <div key={item.id} className="card" style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: '#999' }}>{item.publish_date}</span>
                    {item.rating && <Tag color="primary">{item.rating}</Tag>}
                  </div>
                  <div style={{ fontWeight: 500, marginBottom: 8 }}>{item.title}</div>
                  <div style={{ fontSize: 13, color: '#666' }}>{item.summary}</div>
                  {item.url && (
                    <a href={item.url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 12, color: '#1677ff', marginTop: 8, display: 'inline-block' }}>
                      查看原文
                    </a>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
