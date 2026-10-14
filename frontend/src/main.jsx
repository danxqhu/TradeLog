import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// 过滤 antd-mobile v5 内部 useForm 的无害警告（Popup + Form 渲染时序问题）
const originalError = console.error
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('useForm') && args[0].includes('not connected')) return
  originalError.apply(console, args)
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
