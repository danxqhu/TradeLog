import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, NavBar, Tag, Empty, Button, Space } from 'antd-mobile'
import { LeftOutline, LinkOutline } from 'antd-mobile-icons'

export default function GoldmanSachs() {
  const navigate = useNavigate()

  // 模拟数据 - 链接指向高盛官网 insights 搜索页，后续接入自动抓取后会替换为真实链接
  const reports = [
    {
      id: 1, publish_date: '2026-10-10',
      title: 'China Equities Outlook Q4 2026',
      summary: 'We maintain our overweight rating on China equities, with a 12-month target of 4,200 on the CSI 300 index. Key catalysts include policy support and earnings recovery.',
      url: 'https://www.goldmansachs.com/insights/pages/china-equities-outlook',
      rating: '超配', category: '中国股市',
    },
    {
      id: 2, publish_date: '2026-10-03',
      title: 'China Tech Sector Update',
      summary: 'Technology sector shows signs of recovery with improving regulatory environment. We upgrade internet names to market-weight.',
      url: 'https://www.goldmansachs.com/insights/pages/china-tech-sector',
      rating: '标配', category: '科技板块',
    },
    {
      id: 3, publish_date: '2026-09-26',
      title: 'China Consumer Sector Analysis',
      summary: 'Consumer spending expected to recover in H2 2026 driven by employment improvement and property market stabilization.',
      url: 'https://www.goldmansachs.com/insights/pages/china-consumer-analysis',
      rating: '超配', category: '消费板块',
    },
    {
      id: 4, publish_date: '2026-09-19',
      title: 'China Financials - Rate Cut Impact',
      summary: 'Analysis of PBOC rate cut impact on bank NIMs and insurance sector investment returns.',
      url: 'https://www.goldmansachs.com/insights/pages/china-financials',
      rating: '标配', category: '金融板块',
    },
    {
      id: 5, publish_date: '2026-09-12',
      title: 'China EV & New Energy',
      summary: 'EV penetration continues to exceed expectations. We see further upside in battery and charging infrastructure names.',
      url: 'https://www.goldmansachs.com/insights/pages/china-ev-new-energy',
      rating: '超配', category: '新能源',
    },
  ]

  const ratingColors = { '超配': 'error', '标配': 'warning', '低配': 'success' }

  return (
    <div className="page-container">
      <NavBar backIcon={<LeftOutline />} onBack={() => navigate(-1)}>高盛研报</NavBar>

      <Card style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, color: '#999', marginBottom: 12, padding: '8px 12px', background: '#f5f5f5', borderRadius: 8 }}>
          链接指向高盛官网，后续接入自动抓取后会更新为真实研报地址
        </div>

        {reports.length === 0 ? (
          <Empty description="暂无研报数据" />
        ) : (
          reports.map(report => (
            <div key={report.id} className="card" style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: '#999' }}>{report.publish_date}</span>
                <Space>
                  {report.category && <Tag style={{ fontSize: 11 }}>{report.category}</Tag>}
                  {report.rating && (
                    <Tag color={ratingColors[report.rating] || 'default'} style={{ fontSize: 11, fontWeight: 600 }}>
                      {report.rating}
                    </Tag>
                  )}
                </Space>
              </div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, lineHeight: 1.4 }}>
                {report.title}
              </div>
              <div style={{ fontSize: 13, color: '#666', lineHeight: 1.5, marginBottom: 8 }}>
                {report.summary}
              </div>
              {report.url && (
                <a
                  href={report.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '6px 14px',
                    background: '#1677ff',
                    color: '#fff',
                    borderRadius: 6,
                    fontSize: 13,
                    textDecoration: 'none',
                  }}
                >
                  <LinkOutline style={{ fontSize: 14 }} />
                  查看原文
                </a>
              )}
            </div>
          ))
        )}
      </Card>
    </div>
  )
}
