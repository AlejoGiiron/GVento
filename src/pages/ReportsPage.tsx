import { useState, useMemo } from 'react'
import {
  format, startOfMonth, endOfMonth, startOfWeek,
  subMonths, subDays, parseISO, differenceInDays,
} from 'date-fns'
import { es } from 'date-fns/locale'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  LineChart, Line,
  PieChart, Pie, Cell,
} from 'recharts'
import { Download, TrendingUp, TrendingDown, ShoppingBag, DollarSign, Package } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useReports } from '@/hooks/useReports'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const COP = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0,
  }).format(n)

function pctChange(current: number, prev: number): number | null {
  if (prev === 0) return null
  return ((current - prev) / prev) * 100
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const CH_COLOR: Record<string, string> = {
  dine_in: '#10b981', takeaway: '#f59e0b', delivery: '#3b82f6',
}
const CH_LABEL: Record<string, string> = {
  dine_in: 'Mesa', takeaway: 'Para llevar', delivery: 'Delivery',
}
const PAY_COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b']

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ h }: { h: number }) {
  return <div className="animate-pulse bg-slate-100 rounded-xl" style={{ height: h }} />
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KPICard({
  label, value, icon, change, isLoading,
}: {
  label: string
  value: string
  icon: React.ReactNode
  change: number | null
  isLoading: boolean
}) {
  if (isLoading) return <Skeleton h={110} />
  const up = change !== null && change >= 0
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>{label}</span>
        <span style={{
          width: 30, height: 30, borderRadius: 8,
          background: 'rgba(16,185,129,.10)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981',
        }}>
          {icon}
        </span>
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 700, color: '#0f172a', letterSpacing: -0.5 }}>
        {value}
      </div>
      <div style={{
        marginTop: 6, display: 'flex', alignItems: 'center', gap: 4,
        fontSize: 11.5, fontWeight: 600,
        color: change === null ? '#94a3b8' : up ? '#059669' : '#dc2626',
      }}>
        {change !== null && (up ? <TrendingUp size={12} /> : <TrendingDown size={12} />)}
        {change !== null
          ? `${up ? '+' : ''}${change.toFixed(1)}% vs período anterior`
          : '— sin datos anteriores'}
      </div>
    </div>
  )
}

// ─── Chart card wrapper ───────────────────────────────────────────────────────

function ChartCard({
  title, subtitle, children, isLoading, skeletonH = 240,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  isLoading: boolean
  skeletonH?: number
}) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '20px 20px 14px' }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>{title}</p>
      {subtitle && <p style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 14 }}>{subtitle}</p>}
      {isLoading ? <Skeleton h={skeletonH} /> : children}
    </div>
  )
}

// ─── ReportsPage ──────────────────────────────────────────────────────────────

const SHORTCUTS = [
  { key: 'hoy',          label: 'Hoy' },
  { key: 'semana',       label: 'Esta semana' },
  { key: 'mes',          label: 'Este mes' },
  { key: 'mes_anterior', label: 'Mes anterior' },
] as const

export function ReportsPage() {
  const [from, setFrom] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [to,   setTo]   = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [activeShortcut, setActiveShortcut] = useState<string>('mes')
  const [isExporting, setIsExporting] = useState(false)

  // ─── Previous period (same length, ending day before `from`) ──────────────
  const periodLen = useMemo(
    () => differenceInDays(parseISO(to), parseISO(from)) + 1,
    [from, to],
  )
  const prevTo   = useMemo(() => format(subDays(parseISO(from), 1),         'yyyy-MM-dd'), [from])
  const prevFrom = useMemo(() => format(subDays(parseISO(from), periodLen), 'yyyy-MM-dd'), [from, periodLen])

  // ─── Data ─────────────────────────────────────────────────────────────────
  const { dailySales, productPerformance, hourlySales, isLoading } = useReports({ from, to })
  const { dailySales: prevDailySales } = useReports({ from: prevFrom, to: prevTo })

  // ─── KPI aggregates ───────────────────────────────────────────────────────
  const totalRev   = useMemo(() => dailySales.reduce((s, r) => s + r.total_revenue, 0), [dailySales])
  const totalOrd   = useMemo(() => dailySales.reduce((s, r) => s + r.order_count,   0), [dailySales])
  const avgTicket  = useMemo(() => totalOrd > 0 ? totalRev / totalOrd : 0, [totalRev, totalOrd])
  const prevRev    = useMemo(() => prevDailySales.reduce((s, r) => s + r.total_revenue, 0), [prevDailySales])
  const prevOrd    = useMemo(() => prevDailySales.reduce((s, r) => s + r.order_count,   0), [prevDailySales])
  const prevTicket = useMemo(() => prevOrd > 0 ? prevRev / prevOrd : 0, [prevRev, prevOrd])

  // ─── Bar chart: pivot daily sales by day × channel ────────────────────────
  const barData = useMemo(() => {
    const map: Record<string, { day: string; dine_in: number; takeaway: number; delivery: number }> = {}
    for (const r of dailySales) {
      if (!map[r.day]) map[r.day] = { day: r.day, dine_in: 0, takeaway: 0, delivery: 0 }
      const key = r.order_type as 'dine_in' | 'takeaway' | 'delivery'
      map[r.day][key] += r.total_revenue
    }
    return Object.values(map).sort((a, b) => a.day.localeCompare(b.day))
  }, [dailySales])

  // ─── Line chart: hourly totals aggregated across all days ─────────────────
  const hourlyData = useMemo(() => {
    const map: Record<number, number> = {}
    for (const r of hourlySales) {
      map[r.hour] = (map[r.hour] ?? 0) + r.total_revenue
    }
    return Array.from({ length: 24 }, (_, h) => ({
      label: `${h.toString().padStart(2, '0')}h`,
      ventas: map[h] ?? 0,
    }))
  }, [hourlySales])

  // ─── Pie: payment method totals ───────────────────────────────────────────
  const payData = useMemo(() => [
    { name: 'Efectivo',      value: dailySales.reduce((s, r) => s + r.cash_total,     0), color: PAY_COLORS[0] },
    { name: 'Tarjeta',       value: dailySales.reduce((s, r) => s + r.card_total,     0), color: PAY_COLORS[1] },
    { name: 'Transferencia', value: dailySales.reduce((s, r) => s + r.transfer_total, 0), color: PAY_COLORS[2] },
    { name: 'Nequi',         value: dailySales.reduce((s, r) => s + r.nequi_total,    0), color: PAY_COLORS[3] },
  ].filter(d => d.value > 0), [dailySales])

  // ─── Products: aggregate by product_id ───────────────────────────────────
  const allProducts = useMemo(() => {
    const map: Record<string, {
      product_id: string; product_name: string; category_name: string
      total_qty: number; total_revenue: number
    }> = {}
    for (const r of productPerformance) {
      if (!map[r.product_id]) {
        map[r.product_id] = {
          product_id: r.product_id, product_name: r.product_name,
          category_name: r.category_name, total_qty: 0, total_revenue: 0,
        }
      }
      map[r.product_id].total_qty     += r.total_qty
      map[r.product_id].total_revenue += r.total_revenue
    }
    return Object.values(map).sort((a, b) => b.total_revenue - a.total_revenue)
  }, [productPerformance])

  const top10 = useMemo(() => {
    const total = allProducts.reduce((s, p) => s + p.total_revenue, 0)
    return allProducts.slice(0, 10).map(p => ({
      ...p,
      sharePct: total > 0 ? (p.total_revenue / total) * 100 : 0,
    }))
  }, [allProducts])

  const totalUnits = useMemo(() => allProducts.reduce((s, p) => s + p.total_qty, 0), [allProducts])
  const isEmpty    = !isLoading && totalOrd === 0

  // ─── Shortcut handlers ────────────────────────────────────────────────────
  function applyShortcut(key: string) {
    const now = new Date()
    setActiveShortcut(key)
    switch (key) {
      case 'hoy': {
        const d = format(now, 'yyyy-MM-dd')
        setFrom(d); setTo(d)
        break
      }
      case 'semana':
        setFrom(format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'))
        setTo(format(now, 'yyyy-MM-dd'))
        break
      case 'mes':
        setFrom(format(startOfMonth(now), 'yyyy-MM-dd'))
        setTo(format(now, 'yyyy-MM-dd'))
        break
      case 'mes_anterior': {
        const prev = subMonths(now, 1)
        setFrom(format(startOfMonth(prev), 'yyyy-MM-dd'))
        setTo(format(endOfMonth(prev),     'yyyy-MM-dd'))
        break
      }
    }
  }

  // ─── Excel export ─────────────────────────────────────────────────────────
  async function handleExport() {
    setIsExporting(true)
    try {
      const { default: ExcelJS } = await import('exceljs')
      const wb = new ExcelJS.Workbook()
      wb.creator = 'G-Vento POS'

      // Hoja 1: Resumen
      const ws1 = wb.addWorksheet('Resumen')
      ws1.columns = [
        { header: 'Métrica', key: 'metric', width: 32 },
        { header: 'Valor',   key: 'value',  width: 22 },
      ]
      ws1.addRows([
        { metric: 'Período',              value: `${from} — ${to}` },
        { metric: 'Ventas totales (COP)', value: totalRev },
        { metric: 'Cantidad de órdenes',  value: totalOrd },
        { metric: 'Ticket promedio (COP)',value: Math.round(avgTicket) },
        { metric: 'Efectivo (COP)',        value: dailySales.reduce((s, r) => s + r.cash_total,     0) },
        { metric: 'Tarjeta (COP)',         value: dailySales.reduce((s, r) => s + r.card_total,     0) },
        { metric: 'Transferencia (COP)',   value: dailySales.reduce((s, r) => s + r.transfer_total, 0) },
        { metric: 'Nequi (COP)',           value: dailySales.reduce((s, r) => s + r.nequi_total,    0) },
      ])

      // Hoja 2: Ventas por día
      const ws2 = wb.addWorksheet('Ventas por día')
      ws2.columns = [
        { header: 'Fecha',         key: 'day',         width: 14 },
        { header: 'Canal',         key: 'order_type',  width: 14 },
        { header: 'Órdenes',       key: 'order_count', width: 10 },
        { header: 'Efectivo',      key: 'cash',        width: 16 },
        { header: 'Tarjeta',       key: 'card',        width: 16 },
        { header: 'Transferencia', key: 'transfer',    width: 16 },
        { header: 'Nequi',         key: 'nequi',       width: 16 },
        { header: 'Total',         key: 'total',       width: 16 },
      ]
      for (const r of dailySales) {
        ws2.addRow({
          day: r.day, order_type: r.order_type, order_count: r.order_count,
          cash: r.cash_total, card: r.card_total,
          transfer: r.transfer_total, nequi: r.nequi_total, total: r.total_revenue,
        })
      }

      // Hoja 3: Detalle de productos
      const ws3 = wb.addWorksheet('Detalle de productos')
      ws3.columns = [
        { header: 'Producto',          key: 'product_name',  width: 32 },
        { header: 'Categoría',         key: 'category_name', width: 20 },
        { header: 'Unidades vendidas', key: 'total_qty',     width: 18 },
        { header: 'Revenue (COP)',      key: 'total_revenue', width: 18 },
      ]
      for (const p of allProducts) {
        ws3.addRow({
          product_name: p.product_name, category_name: p.category_name,
          total_qty: p.total_qty, total_revenue: p.total_revenue,
        })
      }

      const buf  = await wb.xlsx.writeBuffer()
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = `gvento_reporte_${format(new Date(), 'yyyy-MM-dd')}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Error al exportar el reporte')
    } finally {
      setIsExporting(false)
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  const exportDisabled = isExporting || isLoading || isEmpty

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Barra de controles ── */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '12px 24px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>

          {/* Título + atajos */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div>
              <h1 style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Reportes</h1>
              <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
                {format(parseISO(from), "d MMM yyyy", { locale: es })}
                {' — '}
                {format(parseISO(to),   "d MMM yyyy", { locale: es })}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {SHORTCUTS.map(s => (
                <button
                  key={s.key}
                  onClick={() => applyShortcut(s.key)}
                  style={{
                    fontSize: 12, fontWeight: 600, padding: '5px 10px',
                    borderRadius: 7, border: 'none', cursor: 'pointer',
                    background: activeShortcut === s.key ? '#10b981' : '#f1f5f9',
                    color:      activeShortcut === s.key ? '#fff'     : '#475569',
                    transition: 'all .15s',
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date pickers + Exportar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="date" value={from} max={to}
              onChange={e => { setFrom(e.target.value); setActiveShortcut('') }}
              style={{ fontSize: 13, padding: '6px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, color: '#0f172a', outline: 'none' }}
            />
            <span style={{ color: '#94a3b8', fontSize: 13 }}>—</span>
            <input
              type="date" value={to} min={from}
              onChange={e => { setTo(e.target.value); setActiveShortcut('') }}
              style={{ fontSize: 13, padding: '6px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, color: '#0f172a', outline: 'none' }}
            />
            <button
              onClick={handleExport}
              disabled={exportDisabled}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 13, fontWeight: 600, padding: '7px 14px',
                borderRadius: 9, border: 'none',
                cursor:     exportDisabled ? 'not-allowed' : 'pointer',
                background: exportDisabled ? '#cbd5e1'     : '#10b981',
                color: '#fff',
                boxShadow: exportDisabled ? 'none' : '0 4px 12px rgba(16,185,129,.35)',
                transition: 'all .15s',
              }}
            >
              <Download size={14} />
              {isExporting ? 'Exportando…' : 'Exportar Excel'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Contenido scrollable ── */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#f8fafc' }}>
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            <KPICard
              label="Ventas totales"
              value={COP(totalRev)}
              icon={<DollarSign size={15} />}
              change={pctChange(totalRev, prevRev)}
              isLoading={isLoading}
            />
            <KPICard
              label="Órdenes"
              value={totalOrd.toLocaleString('es-CO')}
              icon={<ShoppingBag size={15} />}
              change={pctChange(totalOrd, prevOrd)}
              isLoading={isLoading}
            />
            <KPICard
              label="Ticket promedio"
              value={COP(avgTicket)}
              icon={<TrendingUp size={15} />}
              change={pctChange(avgTicket, prevTicket)}
              isLoading={isLoading}
            />
            <KPICard
              label="Unidades vendidas"
              value={totalUnits.toLocaleString('es-CO')}
              icon={<Package size={15} />}
              change={null}
              isLoading={isLoading}
            />
          </div>

          {/* Estado vacío */}
          {isEmpty && (
            <div style={{
              background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14,
              padding: '52px 24px', textAlign: 'center',
            }}>
              <p style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Sin ventas en el período</p>
              <p style={{ fontSize: 13.5, color: '#64748b', marginTop: 6 }}>
                Ajusta el rango de fechas para ver datos de otro período.
              </p>
            </div>
          )}

          {!isEmpty && (
            <>
              {/* Fila 1: Barras diarias + Línea horaria */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

                <ChartCard
                  title="Ventas por día y canal"
                  subtitle="Mesa · Para llevar · Delivery"
                  isLoading={isLoading}
                >
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={barData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis
                        dataKey="day"
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                        tickFormatter={(v: string) => v.slice(5)}
                        interval="preserveStartEnd"
                        axisLine={false} tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                        tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                        width={40} axisLine={false} tickLine={false}
                      />
                      <Tooltip
                        formatter={(v: unknown, name: unknown) =>
                          [COP(Number(v)), CH_LABEL[String(name)] ?? String(name)]
                        }
                        labelFormatter={(l: unknown) => `Fecha: ${String(l)}`}
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,.06)' }}
                      />
                      <Legend
                        formatter={(v: string) => CH_LABEL[v] ?? v}
                        iconSize={8}
                        wrapperStyle={{ fontSize: 11.5, paddingTop: 8 }}
                      />
                      <Bar dataKey="dine_in"  stackId="a" fill={CH_COLOR.dine_in}  radius={[0, 0, 0, 0]} />
                      <Bar dataKey="takeaway" stackId="a" fill={CH_COLOR.takeaway} radius={[0, 0, 0, 0]} />
                      <Bar dataKey="delivery" stackId="a" fill={CH_COLOR.delivery} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard
                  title="Ventas por hora del día"
                  subtitle="Acumulado del período seleccionado"
                  isLoading={isLoading}
                >
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={hourlyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                        interval={3}
                        axisLine={false} tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: '#94a3b8' }}
                        tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
                        width={40} axisLine={false} tickLine={false}
                      />
                      <Tooltip
                        formatter={(v: unknown) => [COP(Number(v)), 'Ventas']}
                        contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,.06)' }}
                      />
                      <Line
                        type="monotone" dataKey="ventas"
                        stroke="#10b981" strokeWidth={2.5}
                        dot={false}
                        activeDot={{ r: 4, fill: '#10b981', strokeWidth: 0 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>

              {/* Fila 2: Pie métodos de pago + Tabla top 10 */}
              <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 16 }}>

                {/* Métodos de pago */}
                <ChartCard
                  title="Métodos de pago"
                  subtitle="Distribución del período"
                  isLoading={isLoading}
                  skeletonH={280}
                >
                  {payData.length === 0 ? (
                    <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
                      Sin datos
                    </div>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={160}>
                        <PieChart>
                          <Pie
                            data={payData} dataKey="value"
                            cx="50%" cy="50%"
                            outerRadius={68} innerRadius={34}
                          >
                            {payData.map((d, i) => <Cell key={i} fill={d.color} />)}
                          </Pie>
                          <Tooltip
                            formatter={(v: unknown, name: unknown) => [COP(Number(v)), String(name)]}
                            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                          />
                        </PieChart>
                      </ResponsiveContainer>

                      {/* Leyenda manual */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 10 }}>
                        {payData.map(d => {
                          const share = totalRev > 0 ? (d.value / totalRev) * 100 : 0
                          return (
                            <div key={d.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                                <div style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                                <span style={{ color: '#475569', fontWeight: 500 }}>{d.name}</span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: '#94a3b8', fontSize: 11 }}>{share.toFixed(1)}%</span>
                                <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#0f172a' }}>{COP(d.value)}</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </ChartCard>

                {/* Top 10 productos */}
                <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 20 }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 2 }}>Top 10 productos</p>
                  <p style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 16 }}>Por revenue del período</p>

                  {isLoading ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} h={36} />)}
                    </div>
                  ) : top10.length === 0 ? (
                    <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
                      Sin productos vendidos
                    </div>
                  ) : (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid #f1f5f9' }}>
                            {['#', 'Producto', 'Categoría', 'Unidades', 'Total', '% rev.'].map((h, i) => (
                              <th key={h} style={{
                                padding: '7px 10px', fontSize: 11.5, fontWeight: 600, color: '#64748b',
                                textAlign: i >= 3 ? 'right' : 'left', whiteSpace: 'nowrap',
                              }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {top10.map((p, i) => (
                            <tr key={p.product_id} style={{ borderBottom: '1px solid #f8fafc' }}>
                              <td style={{ padding: '10px 10px', color: '#94a3b8', fontWeight: 700, fontSize: 11 }}>{i + 1}</td>
                              <td style={{ padding: '10px 10px', color: '#0f172a', fontWeight: 600, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {p.product_name}
                              </td>
                              <td style={{ padding: '10px 10px', color: '#64748b' }}>{p.category_name}</td>
                              <td style={{ padding: '10px 10px', textAlign: 'right', fontFamily: 'monospace', color: '#334155' }}>
                                {p.total_qty.toLocaleString('es-CO')}
                              </td>
                              <td style={{ padding: '10px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: '#0f172a' }}>
                                {COP(p.total_revenue)}
                              </td>
                              <td style={{ padding: '10px 0 10px 10px', textAlign: 'right' }}>
                                <span style={{ background: '#ecfdf5', color: '#065f46', borderRadius: 5, padding: '2px 7px', fontSize: 11, fontWeight: 600 }}>
                                  {p.sharePct.toFixed(1)}%
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
