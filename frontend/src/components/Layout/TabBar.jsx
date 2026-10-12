import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { TabBar as AntTabBar } from 'antd-mobile'
import {
  AppOutline,
  StarOutline,
  FileOutline,
  UnorderedListOutline,
} from 'antd-mobile-icons'

const tabs = [
  { key: '/', title: '首页', icon: <AppOutline /> },
  { key: '/watchlist', title: '自选', icon: <StarOutline /> },
  { key: '/news', title: '资讯', icon: <FileOutline /> },
  { key: '/features', title: '功能', icon: <UnorderedListOutline /> },
]

export default function TabBar() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      background: '#fff',
      borderTop: '1px solid #eee',
      paddingBottom: 'env(safe-area-inset-bottom)',
      zIndex: 100,
    }}>
      <AntTabBar
        activeKey={location.pathname}
        onChange={(key) => navigate(key)}
      >
        {tabs.map(tab => (
          <AntTabBar.Item
            key={tab.key}
            icon={tab.icon}
            title={tab.title}
          />
        ))}
      </AntTabBar>
    </div>
  )
}
