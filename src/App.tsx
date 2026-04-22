import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import { LoginPage } from '@/pages/LoginPage'
import { POSPage } from '@/pages/POSPage'
import { TablesPage } from '@/pages/TablesPage'
import { KitchenPage } from '@/pages/KitchenPage'
import { ProductsPage } from '@/pages/ProductsPage'
import { ReportsPage } from '@/pages/ReportsPage'

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* Rutas protegidas — cualquier usuario autenticado */}
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route index element={<Navigate to="/ventas" replace />} />
              <Route path="ventas" element={<POSPage />} />
              <Route path="mesas" element={<TablesPage />} />
              <Route path="cocina" element={<KitchenPage />} />

              {/* Rutas solo para admin */}
              <Route element={<ProtectedRoute roles={['admin']} />}>
                <Route path="productos" element={<ProductsPage />} />
                <Route path="reportes" element={<ReportsPage />} />
                <Route
                  path="config"
                  element={
                    <div className="p-8">
                      <h1 className="text-2xl font-semibold text-slate-900">Configuración</h1>
                      <p className="text-slate-500 mt-1 text-sm">
                        Configuración del restaurante — próximamente
                      </p>
                    </div>
                  }
                />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/ventas" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
