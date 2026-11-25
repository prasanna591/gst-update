import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './index.css'
import './Polish.css'
import Root from './Root.jsx'
import { AuthProvider } from './AuthProvider.jsx'
import { ConfirmProvider } from './ConfirmProvider.jsx'


createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <ConfirmProvider>
          <Root />
        </ConfirmProvider>
      </AuthProvider>
    </HashRouter>
  </StrictMode>,
)