import React, { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import TabBar from './components/Layout/TabBar'
import { useAuth } from './utils/AuthContext'
import Home from './pages/Home'
import Watchlist from './pages/Watchlist'
import News from './pages/News'
import Features from './pages/Features'
import Recommendation from './pages/Recommendation'
import RecommendationDetail from './pages/Recommendation/Detail'
import VolumeAnalysis from './pages/Volume/Analysis'
import VolumeRealtime from './pages/Volume/Realtime'
import Position from './pages/Position'
import PositionStrategy from './pages/Position/Strategy'
import GoldmanSachs from './pages/GoldmanSachs'
import Shao from './pages/Shao'
import FinanceReport from './pages/FinanceReport'
import ChipDistribution from './pages/ChipDistribution'
import Rainbow from './pages/Rainbow'
import Email from './pages/Email'
import Login from './pages/Auth/Login'
import Register from './pages/Auth/Register'
import ForgotPassword from './pages/Auth/ForgotPassword'

// 每日追资金页依赖 echarts（单独 chunk），懒加载以免其他页面白白下载 K 线图代码
const MoneyChase = lazy(() => import('./pages/MoneyChase'))
const MoneyChaseStock = lazy(() => import('./pages/MoneyChase/StockDetail'))
// 胡胖胖招财进宝：加权评分选股，复盘图复用 echarts，故同样懒加载
const Fortune = lazy(() => import('./pages/Fortune'))
const FortuneStock = lazy(() => import('./pages/Fortune/StockDetail'))
const lazyFallback = <div style={{ padding: 24, textAlign: 'center', color: '#8B3A42' }}>页面加载中…</div>

function App() {
  const { isLoggedIn, loading } = useAuth()

  // 初始化中，显示空白
  if (loading) {
    return <div style={{ minHeight: '100vh', background: '#FAF0F1' }} />
  }

  // 未登录：只显示认证页面
  if (!isLoggedIn) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  // 已登录：显示所有业务路由 + TabBar
  return (
    <>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <Routes>
          {/* 底部Tab页 */}
          <Route path="/" element={<Home />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/news" element={<News />} />
          <Route path="/features" element={<Features />} />

          {/* 推荐管理 */}
          <Route path="/recommendation" element={<Recommendation />} />
          <Route path="/recommendation/:id" element={<RecommendationDetail />} />

          {/* 量能分析 */}
          <Route path="/volume/analysis" element={<VolumeAnalysis />} />
          <Route path="/volume/realtime" element={<VolumeRealtime />} />

          {/* 仓位管理 */}
          <Route path="/position" element={<Position />} />
          <Route path="/position/strategy/:stockCode" element={<PositionStrategy />} />

          {/* 资讯 */}
          <Route path="/goldman-sachs" element={<GoldmanSachs />} />
          <Route path="/shanghai-news" element={<News />} />

          {/* 邵先生 */}
          <Route path="/shao" element={<Shao />} />

          {/* 财报分析 */}
          <Route path="/finance-report" element={<FinanceReport />} />

          {/* 筹码分布 */}
          <Route path="/chip-distribution" element={<ChipDistribution />} />

          {/* 七道彩虹 */}
          <Route path="/rainbow" element={<Rainbow />} />

          {/* 邮件推送 */}
          <Route path="/email" element={<Email />} />

          {/* 每日追资金（懒加载 echarts chunk，Suspense 只在本路由内生效） */}
          <Route
            path="/money-chase"
            element={(<Suspense fallback={lazyFallback}><MoneyChase /></Suspense>)}
          />
          {/* 点股票名进入的单票具体分析（日 K + 分时） */}
          <Route
            path="/money-chase/stock/:symbol"
            element={(<Suspense fallback={lazyFallback}><MoneyChaseStock /></Suspense>)}
          />

          {/* 胡胖胖招财进宝（批量自动打分榜单 + 单票明细） */}
          <Route
            path="/fortune"
            element={(<Suspense fallback={lazyFallback}><Fortune /></Suspense>)}
          />
          <Route
            path="/fortune/stock/:symbol"
            element={(<Suspense fallback={lazyFallback}><FortuneStock /></Suspense>)}
          />

          {/* 默认重定向 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <TabBar />
    </>
  )
}

export default App
