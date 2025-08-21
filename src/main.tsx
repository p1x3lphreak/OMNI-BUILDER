import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Restore GH Pages redirect path BEFORE the router mounts
const saved = sessionStorage.getItem('gh-spa-path')
if (saved) {
  sessionStorage.removeItem('gh-spa-path')
  history.replaceState(null, '', saved)
}

import { BrowserRouter } from 'react-router-dom'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/OMNI-BUILDER">
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
