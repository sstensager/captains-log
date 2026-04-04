import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { EntityTypeProvider } from './contexts/EntityTypeContext'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EntityTypeProvider>
      <App />
    </EntityTypeProvider>
  </StrictMode>,
)
