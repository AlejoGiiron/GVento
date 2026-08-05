import { useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query'
import * as Sentry from '@sentry/react'
import { AuthProvider } from '@/contexts/AuthContext'
import { ErrorFallback } from '@/components/ErrorFallback'
import { captureError, type SentryArea } from '@/lib/sentry'
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
import { ShiftHistoryPage } from '@/pages/ShiftHistoryPage'
import { ExpensesHistoryPage } from '@/pages/ExpensesHistoryPage'
import { ConfigPage } from '@/pages/ConfigPage'

function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // Reporte central de errores de MUTACIÓN. Cubre de una sola vez los
        // `catch {} // error toast handled in hook` de los modales de caja,
        // movimientos y categorías: el toast del hook explica al usuario, pero
        // el objeto de error se descartaba y no quedaba rastro en ningún lado.
        //
        // Las QUERIES a propósito NO se reportan acá: fallan en masa cuando se
        // cae la red (el bar sin internet) y ahogarían la cuota. Lo que importa
        // —cobrar, cerrar turno, abrir caja— son todas mutaciones.
        mutationCache: new MutationCache({
          onError: (error, _vars, _ctx, mutation) => {
            const area = (mutation.options.meta?.area as SentryArea) ?? 'venta'
            captureError(error, area, {
              mutationKey: mutation.options.mutationKey,
            })
          },
        }),
      }),
  )

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
              <Route element={<ProtectedRoute permission="caja.cerrar" />}>
                <Route path="historial-turnos" element={<ShiftHistoryPage />} />
              </Route>
              <Route element={<ProtectedRoute permission="caja.movimientos" />}>
                <Route path="historial-gastos" element={<ExpensesHistoryPage />} />
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

/**
 * ErrorBoundary de Sentry envolviendo la app entera: captura los errores de
 * render, que de otro modo desmontan el árbol y dejan la pantalla en blanco.
 *
 * Va POR FUERA de App (y por lo tanto de los providers) a propósito: si el que
 * revienta es el QueryClientProvider o el AuthProvider, un boundary interno se
 * caería con ellos.
 */
export default Sentry.withErrorBoundary(App, {
  fallback: ({ eventId }) => <ErrorFallback eventId={eventId ?? null} />,
})
