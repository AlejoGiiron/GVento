import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/contexts/AuthContext'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { AppLayout } from '@/components/layout/AppLayout'
import { LoginPage } from '@/pages/LoginPage'
import { POSPage } from '@/pages/POSPage'
import { TablesPage } from '@/pages/TablesPage'
import { KitchenPage } from '@/pages/KitchenPage'
import { DeliveryPage } from '@/pages/DeliveryPage'
import { ProductsPage } from '@/pages/ProductsPage'
import { InventoryPage } from '@/pages/InventoryPage'
import { PurchasesPage } from '@/pages/PurchasesPage'
import { FiadoPage } from '@/pages/FiadoPage'
import { ReportsPage } from '@/pages/ReportsPage'
import { SalesHistoryPage } from '@/pages/SalesHistoryPage'
import { ConfigPage } from '@/pages/ConfigPage'

function App() {
  const [queryClient] = useState(() => new QueryClient())

  return (
    <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* Cocina KDS — acceso independiente por PIN, sin Supabase Auth */}
          <Route path="cocina" element={<KitchenPage />} />

          {/* Rutas protegidas — cualquier usuario autenticado */}
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route index element={<Navigate to="/ventas" replace />} />
              <Route path="ventas" element={<POSPage />} />
              <Route path="mesas" element={<TablesPage />} />

              {/* Rutas gateadas por permiso RBAC */}
              <Route element={<ProtectedRoute permission="delivery.gestionar" />}>
                <Route path="delivery" element={<DeliveryPage />} />
              </Route>
              <Route element={<ProtectedRoute permission="productos.editar" />}>
                <Route path="productos" element={<ProductsPage />} />
                <Route path="inventario" element={<InventoryPage />} />
              </Route>
              <Route element={<ProtectedRoute permission="compras.gestionar" />}>
                <Route path="compras" element={<PurchasesPage />} />
              </Route>
              <Route element={<ProtectedRoute permission="fiado.gestionar" />}>
                <Route path="fiado" element={<FiadoPage />} />
              </Route>
              <Route element={<ProtectedRoute permission="ventas.historial" />}>
                <Route path="historial" element={<SalesHistoryPage />} />
              </Route>
              <Route element={<ProtectedRoute permission="reportes.financiero" />}>
                <Route path="reportes" element={<ReportsPage />} />
              </Route>
              <Route element={<ProtectedRoute permission="config.acceder" />}>
                <Route path="config" element={<ConfigPage />} />
                <Route path="configuracion" element={<ConfigPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/ventas" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </QueryClientProvider>
  )
}

export default App
