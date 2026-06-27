import { useState, useRef } from 'react'
import { toast } from 'react-hot-toast'
import {
  Building2,
  Users,
  Wallet,
  ChefHat,
  Truck,
  Bell,
  Plus,
  Trash2,
  Upload,
  X,
  Loader2,
  UserPlus,
  ToggleLeft,
  ToggleRight,
  Copy,
  RefreshCw,
  Check,
  Store,
  Shield,
  Pencil,
  Lock,
  Puzzle,
  Package,
  type LucideIcon,
} from 'lucide-react'
import { useRestaurantConfig } from '@/hooks/useRestaurantConfig'
import { useUsers } from '@/hooks/useUsers'
import { useAuth } from '@/hooks/useAuth'
import { usePermissions } from '@/hooks/usePermissions'
import { useRoles, rolePermissions, type RoleRow } from '@/hooks/useRoles'
import { useStores, type StoreRow } from '@/hooks/useStores'
import { useExtras } from '@/hooks/useExtras'
import { useProducts } from '@/hooks/useProducts'
import {
  uploadRestaurantLogo,
  uploadNequiQR,
  upsertCourier,
  getAllCouriers,
  deleteCourier,
  countOrderItemsUsingExtra,
} from '@/lib/supabase-helpers'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { PaymentMethod } from '@/hooks/useRestaurantConfig'
import type { Tables } from '@/types/database.types'

// ─── Constants ────────────────────────────────────────────────────

type SectionId = 'restaurante' | 'usuarios' | 'sedes' | 'roles' | 'extras' | 'caja' | 'cocina' | 'delivery' | 'notificaciones'

const SECTIONS: { id: SectionId; label: string; icon: LucideIcon; permission?: string }[] = [
  { id: 'restaurante', label: 'Restaurante', icon: Building2 },
  { id: 'usuarios', label: 'Usuarios', icon: Users },
  { id: 'sedes', label: 'Sedes', icon: Store, permission: 'sedes.gestionar' },
  { id: 'roles', label: 'Roles y permisos', icon: Shield, permission: 'roles.gestionar' },
  { id: 'extras', label: 'Extras', icon: Puzzle, permission: 'productos.editar' },
  { id: 'caja', label: 'Caja', icon: Wallet },
  { id: 'cocina', label: 'Cocina', icon: ChefHat },
  { id: 'delivery', label: 'Delivery', icon: Truck },
  { id: 'notificaciones', label: 'Notificaciones', icon: Bell },
]

// Catálogo de permisos agrupado por módulo (para la matriz de roles).
const PERMISSION_GROUPS: { module: string; perms: { key: string; label: string }[] }[] = [
  { module: 'POS', perms: [
    { key: 'pos.vender', label: 'Vender' },
    { key: 'pos.descuento', label: 'Descuento' },
    { key: 'pos.anular', label: 'Anular' },
  ] },
  { module: 'Caja', perms: [
    { key: 'caja.abrir', label: 'Abrir turno' },
    { key: 'caja.cerrar', label: 'Cerrar turno' },
    { key: 'caja.movimientos', label: 'Movimientos' },
  ] },
  { module: 'Mesas', perms: [
    { key: 'mesas.gestionar', label: 'Gestionar' },
    { key: 'mesas.cobrar', label: 'Cobrar' },
  ] },
  { module: 'Cocina', perms: [
    { key: 'cocina.acceder', label: 'Acceder' },
  ] },
  { module: 'Delivery', perms: [
    { key: 'delivery.gestionar', label: 'Gestionar' },
  ] },
  { module: 'Productos', perms: [
    { key: 'productos.ver', label: 'Ver' },
    { key: 'productos.editar', label: 'Editar' },
  ] },
  { module: 'Reportes', perms: [
    { key: 'reportes.financiero', label: 'Financiero' },
    { key: 'reportes.stock', label: 'Stock' },
    { key: 'reportes.consolidado', label: 'Consolidado' },
  ] },
  { module: 'Configuración', perms: [
    { key: 'config.acceder', label: 'Acceder' },
    { key: 'usuarios.gestionar', label: 'Usuarios' },
    { key: 'sedes.gestionar', label: 'Sedes' },
    { key: 'roles.gestionar', label: 'Roles' },
  ] },
]

const DEFAULT_CASH_OUT_REASONS = ['Mercado', 'Domicilio', 'Servicios', 'Otro']
const DEFAULT_STATIONS = ['Cocina fría', 'Cocina caliente', 'Barra']

// ─── Shared UI helpers ────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 24 }}>
      {children}
    </h2>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
      {children}
    </label>
  )
}

function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  maxLength,
  testId,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  maxLength?: number
  testId?: string
}) {
  return (
    <input
      type={type}
      data-testid={testId}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      style={{
        width: '100%',
        border: '1.5px solid #e2e8f0',
        borderRadius: 8,
        padding: '10px 12px',
        fontSize: 14,
        color: '#0f172a',
        outline: 'none',
        background: '#fff',
        boxSizing: 'border-box',
      }}
      onFocus={e => (e.currentTarget.style.borderColor = '#10b981')}
      onBlur={e => (e.currentTarget.style.borderColor = '#e2e8f0')}
    />
  )
}

function SaveButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      style={{
        background: loading ? '#cbd5e1' : '#10b981',
        color: '#fff',
        border: 'none',
        borderRadius: 10,
        padding: '11px 28px',
        fontSize: 14,
        fontWeight: 700,
        cursor: loading ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        boxShadow: loading ? 'none' : '0 6px 16px rgba(16,185,129,.35)',
        marginTop: 28,
      }}
    >
      {loading && <Loader2 size={15} className="animate-spin" />}
      Guardar
    </button>
  )
}

function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {[1, 2, 3].map(i => (
        <div
          key={i}
          style={{ height: 48, borderRadius: 8, background: '#f1f5f9', animation: 'pulse 1.5s infinite' }}
        />
      ))}
    </div>
  )
}

function EditableList({
  items,
  onChange,
  placeholder,
}: {
  items: string[]
  onChange: (items: string[]) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')

  const add = () => {
    const v = draft.trim()
    if (!v || items.includes(v)) return
    onChange([...items, v])
    setDraft('')
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        {items.map(item => (
          <div
            key={item}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              background: '#f8fafc',
              fontSize: 14,
              color: '#0f172a',
            }}
          >
            {item}
            <button
              onClick={() => onChange(items.filter(i => i !== item))}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 2 }}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder={placeholder ?? 'Nuevo elemento...'}
          style={{
            flex: 1,
            border: '1.5px solid #e2e8f0',
            borderRadius: 8,
            padding: '9px 12px',
            fontSize: 14,
            color: '#0f172a',
            outline: 'none',
          }}
          onFocus={e => (e.currentTarget.style.borderColor = '#10b981')}
          onBlur={e => (e.currentTarget.style.borderColor = '#e2e8f0')}
        />
        <button
          onClick={add}
          style={{
            background: '#f1f5f9',
            border: '1.5px solid #e2e8f0',
            borderRadius: 8,
            padding: '9px 14px',
            cursor: 'pointer',
            color: '#334155',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <Plus size={14} /> Agregar
        </button>
      </div>
    </div>
  )
}

// ─── Section 1: Restaurante ───────────────────────────────────────

function SectionRestaurant() {
  const { restaurant, config, isLoading, updateRestaurant, updateConfig, isSaving } = useRestaurantConfig()
  const { profile } = useAuth()
  const logoInputRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [slug, setSlug] = useState('')
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [initialized, setInitialized] = useState(false)

  if (!initialized && restaurant) {
    setName(restaurant.name ?? '')
    setAddress(restaurant.address ?? '')
    setPhone(restaurant.phone ?? '')
    setSlug((config.slug as string) ?? '')
    setInitialized(true)
  }

  if (isLoading) return <Skeleton />

  const handleLogoUpload = async (file: File) => {
    if (!profile?.restaurant_id) return
    setUploadingLogo(true)
    const url = await uploadRestaurantLogo(profile.restaurant_id, file)
    setUploadingLogo(false)
    if (!url) { toast.error('Error al subir el logo'); return }
    await updateRestaurant({ logo_url: url })
  }

  const handleSave = async () => {
    await updateRestaurant({ name, address, phone })
    await updateConfig({ slug: slug.toLowerCase().replace(/\s+/g, '-') })
  }

  return (
    <div>
      <SectionTitle>Restaurante</SectionTitle>

      {/* Logo */}
      <div style={{ marginBottom: 24 }}>
        <FieldLabel>Logo</FieldLabel>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 12,
              border: '1.5px solid #e2e8f0',
              background: '#f8fafc',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {restaurant?.logo_url ? (
              <img src={restaurant.logo_url} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <Building2 size={28} color="#94a3b8" />
            )}
          </div>
          <input ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f) }}
          />
          <button
            onClick={() => logoInputRef.current?.click()}
            disabled={uploadingLogo}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '9px 16px',
              border: '1.5px solid #e2e8f0',
              borderRadius: 9,
              background: '#fff',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              color: '#334155',
            }}
          >
            {uploadingLogo ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploadingLogo ? 'Subiendo...' : 'Cambiar logo'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr', maxWidth: 560 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <FieldLabel>Nombre del restaurante</FieldLabel>
          <TextInput value={name} onChange={setName} placeholder="G-Vento Resto" testId="config-restaurant-name" />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <FieldLabel>Dirección</FieldLabel>
          <TextInput value={address} onChange={setAddress} placeholder="Calle 123 #45-67, Bogotá" />
        </div>
        <div>
          <FieldLabel>Teléfono</FieldLabel>
          <TextInput value={phone} onChange={setPhone} placeholder="601 234 5678" />
        </div>
        <div>
          <FieldLabel>Slug público</FieldLabel>
          <TextInput
            value={slug}
            onChange={v => setSlug(v.toLowerCase().replace(/\s+/g, '-'))}
            placeholder="mi-restaurante"
          />
        </div>
      </div>

      <SaveButton onClick={handleSave} loading={isSaving} />
    </div>
  )
}

// ─── Section 2: Usuarios ──────────────────────────────────────────

function generatePassword(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%'
  const arr = new Uint8Array(12)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(b => chars[b % chars.length]).join('')
}

// Deriva el enum legacy (que exige la Edge Function) desde el nombre del rol RBAC.
function enumFromRoleName(name: string): 'admin' | 'cashier' | 'waiter' {
  if (name === 'owner' || name === 'admin') return 'admin'
  if (name === 'mozo') return 'waiter'
  return 'cashier'
}

function CreateUserModal({ onClose }: { onClose: () => void }) {
  const { createUser, isCreatingUser } = useUsers()
  const { roles } = useRoles()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState(() => generatePassword())
  const [roleId, setRoleId] = useState('')
  const [copied, setCopied] = useState(false)

  // Default: primer rol disponible (cajero suele ser el inicial razonable).
  if (!roleId && roles.length > 0) {
    setRoleId(roles.find(r => r.name === 'cajero')?.id ?? roles[0].id)
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(`Usuario: ${email}\nContraseña: ${password}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleSubmit = async () => {
    if (!fullName.trim() || !email.trim() || !password.trim()) {
      toast.error('Completa todos los campos')
      return
    }
    const selected = roles.find(r => r.id === roleId)
    if (!selected) { toast.error('Selecciona un rol'); return }
    await createUser({
      full_name: fullName.trim(),
      email: email.trim(),
      password,
      enumRole: enumFromRoleName(selected.name),
      roleId: selected.id,
    })
    onClose()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', zIndex: 50 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: '#fff', borderRadius: 14, width: 460, maxWidth: '92%', boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>Crear usuario</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={18} /></button>
        </div>

        {/* Body */}
        <div style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <FieldLabel>Nombre completo</FieldLabel>
            <TextInput value={fullName} onChange={setFullName} placeholder="Juan Pérez" />
          </div>
          <div>
            <FieldLabel>Correo electrónico</FieldLabel>
            <TextInput value={email} onChange={setEmail} placeholder="juan@restaurante.com" type="email" />
          </div>

          {/* Contraseña + generador */}
          <div>
            <FieldLabel>Contraseña temporal</FieldLabel>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <input
                  type="text"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  style={{
                    width: '100%',
                    border: '1.5px solid #e2e8f0',
                    borderRadius: 8,
                    padding: '10px 12px',
                    fontSize: 14,
                    fontFamily: 'monospace',
                    color: '#0f172a',
                    outline: 'none',
                    boxSizing: 'border-box',
                    letterSpacing: 1,
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = '#10b981')}
                  onBlur={e => (e.currentTarget.style.borderColor = '#e2e8f0')}
                />
              </div>
              <button
                onClick={() => setPassword(generatePassword())}
                title="Generar contraseña"
                style={{ padding: '0 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, background: '#f8fafc', cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center' }}
              >
                <RefreshCw size={15} />
              </button>
            </div>
            <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, marginBottom: 0 }}>
              El usuario deberá cambiar esta contraseña al ingresar por primera vez.
            </p>
          </div>

          <div>
            <FieldLabel>Rol</FieldLabel>
            <select
              value={roleId}
              onChange={e => setRoleId(e.target.value)}
              style={{ width: '100%', border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', fontSize: 14, color: '#0f172a', background: '#fff', outline: 'none', textTransform: 'capitalize' }}
            >
              {roles.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>

          {/* Copiar credenciales */}
          <button
            onClick={handleCopy}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              padding: '10px',
              border: `1.5px solid ${copied ? '#a7f3d0' : '#e2e8f0'}`,
              borderRadius: 9,
              background: copied ? '#ecfdf5' : '#f8fafc',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              color: copied ? '#065f46' : '#334155',
              transition: 'all .15s',
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Credenciales copiadas' : 'Copiar credenciales'}
          </button>
        </div>

        {/* Footer */}
        <div style={{ padding: '0 22px 22px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{ padding: '10px 20px', border: '1.5px solid #e2e8f0', borderRadius: 9, background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#334155' }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={isCreatingUser}
            style={{
              padding: '10px 24px',
              background: isCreatingUser ? '#cbd5e1' : '#10b981',
              border: 'none',
              borderRadius: 10,
              cursor: isCreatingUser ? 'not-allowed' : 'pointer',
              fontSize: 13,
              fontWeight: 700,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              boxShadow: isCreatingUser ? 'none' : '0 4px 12px rgba(16,185,129,.3)',
            }}
          >
            {isCreatingUser && <Loader2 size={14} className="animate-spin" />}
            Crear usuario
          </button>
        </div>
      </div>
    </div>
  )
}

function SectionUsers() {
  const { users, isLoading, updateUser, isUpdating } = useUsers()
  const { roles } = useRoles()
  const [showCreate, setShowCreate] = useState(false)

  if (isLoading) return <Skeleton />

  return (
    <div>
      <SectionTitle>Usuarios</SectionTitle>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '9px 18px',
            background: '#10b981',
            border: 'none',
            borderRadius: 10,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 700,
            color: '#fff',
            boxShadow: '0 4px 12px rgba(16,185,129,.3)',
          }}
        >
          <UserPlus size={15} /> Crear usuario
        </button>
      </div>

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
        {/* Header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 180px 120px 80px',
            padding: '10px 16px',
            background: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            fontSize: 11,
            fontWeight: 600,
            color: '#64748b',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}
        >
          <span>Usuario</span>
          <span>Rol</span>
          <span>Estado</span>
          <span />
        </div>

        {users.length === 0 && (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
            No hay usuarios en este restaurante
          </div>
        )}

        {users.map((user, idx) => (
          <div
            key={user.id}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 180px 120px 80px',
              padding: '12px 16px',
              alignItems: 'center',
              borderBottom: idx < users.length - 1 ? '1px solid #f1f5f9' : 'none',
            }}
          >
            <div>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', margin: 0 }}>{user.full_name}</p>
              <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>{user.email}</p>
            </div>

            <select
              value={user.role_id ?? ''}
              disabled={isUpdating}
              onChange={e => updateUser(user.id, { role_id: e.target.value })}
              style={{
                border: '1.5px solid #e2e8f0',
                borderRadius: 7,
                padding: '6px 10px',
                fontSize: 13,
                color: '#0f172a',
                background: '#fff',
                cursor: 'pointer',
                outline: 'none',
                textTransform: 'capitalize',
              }}
            >
              {!user.role_id && <option value="" disabled>Sin rol</option>}
              {roles.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>

            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 12,
                fontWeight: 600,
                color: user.is_active ? '#065f46' : '#64748b',
                background: user.is_active ? '#ecfdf5' : '#f1f5f9',
                padding: '4px 10px',
                borderRadius: 20,
                width: 'fit-content',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: user.is_active ? '#10b981' : '#94a3b8',
                }}
              />
              {user.is_active ? 'Activo' : 'Inactivo'}
            </span>

            <button
              onClick={() => updateUser(user.id, { is_active: !user.is_active })}
              disabled={isUpdating}
              title={user.is_active ? 'Desactivar' : 'Activar'}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: user.is_active ? '#10b981' : '#94a3b8', display: 'flex', alignItems: 'center' }}
            >
              {user.is_active ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
            </button>
          </div>
        ))}
      </div>

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} />}
    </div>
  )
}

// ─── Section 3: Caja ──────────────────────────────────────────────

function SectionCaja() {
  const { config, isLoading, updateConfig, isSaving } = useRestaurantConfig()
  const { profile } = useAuth()
  const nequiInputRef = useRef<HTMLInputElement>(null)
  const [uploadingQR, setUploadingQR] = useState(false)

  const reasons: string[] = config.cash_out_reasons ?? DEFAULT_CASH_OUT_REASONS
  const methods: PaymentMethod[] = config.payment_methods ?? ['cash', 'card', 'transfer', 'nequi']

  const ALL_METHODS: { value: PaymentMethod; label: string }[] = [
    { value: 'cash', label: 'Efectivo' },
    { value: 'card', label: 'Tarjeta' },
    { value: 'transfer', label: 'Transferencia' },
    { value: 'nequi', label: 'Nequi' },
  ]

  const [localReasons, setLocalReasons] = useState<string[]>(reasons)
  const [localMethods, setLocalMethods] = useState<PaymentMethod[]>(methods)

  const toggleMethod = (m: PaymentMethod) =>
    setLocalMethods(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])

  const handleNequiUpload = async (file: File) => {
    if (!profile?.restaurant_id) return
    setUploadingQR(true)
    const url = await uploadNequiQR(profile.restaurant_id, file)
    setUploadingQR(false)
    if (!url) { toast.error('Error al subir el QR'); return }
    await updateConfig({ nequi_qr_url: url })
  }

  if (isLoading) return <Skeleton />

  return (
    <div>
      <SectionTitle>Caja</SectionTitle>

      {/* Motivos de egreso */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Motivos de egreso</h3>
        <p style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
          Aparecen como opciones rápidas al registrar egresos de caja.
        </p>
        <EditableList items={localReasons} onChange={setLocalReasons} placeholder="Nuevo motivo..." />
      </div>

      {/* Métodos de pago */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Métodos de pago habilitados</h3>
        <p style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
          Solo los métodos activos aparecen en el flujo de cobro.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {ALL_METHODS.map(({ value, label }) => {
            const active = localMethods.includes(value)
            return (
              <button
                key={value}
                onClick={() => toggleMethod(value)}
                style={{
                  padding: '8px 18px',
                  border: `1.5px solid ${active ? '#10b981' : '#e2e8f0'}`,
                  borderRadius: 9,
                  background: active ? '#ecfdf5' : '#fff',
                  color: active ? '#065f46' : '#64748b',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all .12s',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* QR Nequi */}
      <div style={{ marginBottom: 8 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>QR de Nequi</h3>
        <p style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
          Se muestra en el modal de cobro cuando el método es Nequi.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {config.nequi_qr_url && (
            <div style={{ width: 88, height: 88, border: '1.5px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
              <img src={config.nequi_qr_url} alt="QR Nequi" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          )}
          <input ref={nequiInputRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleNequiUpload(f) }}
          />
          <button
            onClick={() => nequiInputRef.current?.click()}
            disabled={uploadingQR}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '9px 16px',
              border: '1.5px solid #e2e8f0',
              borderRadius: 9,
              background: '#fff',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              color: '#334155',
            }}
          >
            {uploadingQR ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploadingQR ? 'Subiendo...' : config.nequi_qr_url ? 'Cambiar QR' : 'Subir QR'}
          </button>
        </div>
      </div>

      <SaveButton
        onClick={() => updateConfig({ cash_out_reasons: localReasons, payment_methods: localMethods })}
        loading={isSaving}
      />
    </div>
  )
}

// ─── Section 4: Cocina ────────────────────────────────────────────

function SectionCocina() {
  const { restaurant, config, isLoading, updateConfig, updateRestaurant, isSaving } = useRestaurantConfig()

  const [pin, setPin] = useState('')
  const [stations, setStations] = useState<string[]>([])
  const [greenMin, setGreenMin] = useState(10)
  const [amberMin, setAmberMin] = useState(20)
  const [initialized, setInitialized] = useState(false)

  if (!initialized && !isLoading) {
    setPin(config.kitchen_pin ?? '')
    setStations(config.kitchen_stations ?? DEFAULT_STATIONS)
    setGreenMin(config.kds_timers?.green ?? 10)
    setAmberMin(config.kds_timers?.amber ?? 20)
    setInitialized(true)
  }

  if (isLoading) return <Skeleton />

  // uses_kitchen vive en la fila restaurants. Se guarda al instante (no espera al
  // SaveButton del KDS) para que el sidebar, el botón de Mesas y el checkbox del
  // ProductModal reaccionen de inmediato al invalidar el cache ['restaurant'].
  const usesKitchen = restaurant?.uses_kitchen ?? true
  const toggleUsesKitchen = () => updateRestaurant({ uses_kitchen: !usesKitchen })

  return (
    <div>
      <SectionTitle>Cocina</SectionTitle>

      {/* Toggle: ¿esta sede usa cocina? — gobierna el resto de la sección */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 560 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>Esta sede usa cocina</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
              Si se desactiva, no se envían comandas ni hay KDS en esta sede.
            </div>
          </div>
          <button
            type="button"
            data-testid="config-uses-kitchen"
            onClick={toggleUsesKitchen}
            disabled={isSaving}
            aria-checked={usesKitchen}
            role="switch"
            style={{
              width: 44, height: 24, borderRadius: 12,
              background: usesKitchen ? '#10b981' : '#e2e8f0',
              border: 'none', cursor: isSaving ? 'not-allowed' : 'pointer',
              position: 'relative', transition: 'background .15s', flexShrink: 0,
            }}
          >
            <span style={{
              position: 'absolute', top: 2,
              left: usesKitchen ? 22 : 2,
              width: 20, height: 20, borderRadius: '50%',
              background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.2)',
              transition: 'left .15s',
            }} />
          </button>
        </div>
      </div>

      {!usesKitchen && (
        <div style={{
          fontSize: 13, color: '#64748b', lineHeight: 1.5,
          border: '1px dashed #e2e8f0', borderRadius: 9, padding: '14px 16px', maxWidth: 560,
        }}>
          Esta sede no usa cocina. El KDS y las comandas están desactivados, y los
          productos no muestran la opción “Va a cocina”. Activa el interruptor para
          configurar PIN, estaciones y tiempos del semáforo.
        </div>
      )}

      {usesKitchen && <>
      {/* PIN */}
      <div style={{ marginBottom: 28 }}>
        <FieldLabel>PIN de acceso al KDS (4 dígitos)</FieldLabel>
        <input
          type="text"
          inputMode="numeric"
          value={pin}
          maxLength={4}
          onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="Sin PIN = acceso libre"
          style={{
            width: 160,
            border: '1.5px solid #e2e8f0',
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 20,
            fontFamily: 'monospace',
            letterSpacing: 8,
            color: '#0f172a',
            outline: 'none',
          }}
          onFocus={e => (e.currentTarget.style.borderColor = '#10b981')}
          onBlur={e => (e.currentTarget.style.borderColor = '#e2e8f0')}
        />
      </div>

      {/* Estaciones */}
      <div style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Estaciones de cocina</h3>
        <p style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
          Se usan para categorizar órdenes en el KDS.
        </p>
        <EditableList items={stations} onChange={setStations} placeholder="Nueva estación..." />
      </div>

      {/* Semáforo */}
      <div style={{ marginBottom: 8 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>Tiempos del semáforo</h3>
        <p style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
          Controla el color de las cards en el KDS según el tiempo transcurrido.
        </p>
        <div style={{ display: 'flex', gap: 24 }}>
          <div>
            <FieldLabel>
              <span style={{ color: '#10b981' }}>Verde</span> hasta (min)
            </FieldLabel>
            <input
              type="number"
              min={1}
              max={59}
              value={greenMin}
              onChange={e => setGreenMin(Number(e.target.value))}
              style={{
                width: 100,
                border: '1.5px solid #e2e8f0',
                borderRadius: 8,
                padding: '9px 12px',
                fontSize: 16,
                fontFamily: 'monospace',
                color: '#0f172a',
                outline: 'none',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = '#10b981')}
              onBlur={e => (e.currentTarget.style.borderColor = '#e2e8f0')}
            />
          </div>
          <div>
            <FieldLabel>
              <span style={{ color: '#f59e0b' }}>Ámbar</span> hasta (min)
            </FieldLabel>
            <input
              type="number"
              min={1}
              max={120}
              value={amberMin}
              onChange={e => setAmberMin(Number(e.target.value))}
              style={{
                width: 100,
                border: '1.5px solid #e2e8f0',
                borderRadius: 8,
                padding: '9px 12px',
                fontSize: 16,
                fontFamily: 'monospace',
                color: '#0f172a',
                outline: 'none',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = '#10b981')}
              onBlur={e => (e.currentTarget.style.borderColor = '#e2e8f0')}
            />
          </div>
        </div>
      </div>

      <SaveButton
        onClick={() =>
          updateConfig({
            kitchen_pin: pin || null,
            kitchen_stations: stations,
            kds_timers: { green: greenMin, amber: amberMin },
          })
        }
        loading={isSaving}
      />
      </>}
    </div>
  )
}

// ─── Section 5: Delivery ──────────────────────────────────────────

type CourierRow = Tables<'couriers'>

function CourierFormModal({
  courier,
  restaurantId,
  onClose,
}: {
  courier: CourierRow | null
  restaurantId: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState(courier?.name ?? '')
  const [phone, setPhone] = useState(courier?.phone ?? '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!name.trim()) { toast.error('El nombre es obligatorio'); return }
    setSaving(true)
    const { error } = await upsertCourier({
      ...(courier ? { id: courier.id } : {}),
      restaurant_id: restaurantId,
      name: name.trim(),
      phone: phone.trim() || null,
      is_active: true,
    })
    setSaving(false)
    if (error) { toast.error('Error al guardar repartidor'); return }
    toast.success(courier ? 'Repartidor actualizado' : 'Repartidor creado')
    qc.invalidateQueries({ queryKey: ['all_couriers', restaurantId] })
    onClose()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', zIndex: 50 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: '#fff', borderRadius: 14, width: 400, boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
            {courier ? 'Editar repartidor' : 'Nuevo repartidor'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={18} /></button>
        </div>
        <div style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <FieldLabel>Nombre</FieldLabel>
            <TextInput value={name} onChange={setName} placeholder="Pedro Ramírez" />
          </div>
          <div>
            <FieldLabel>Teléfono (opcional)</FieldLabel>
            <TextInput value={phone} onChange={setPhone} placeholder="310 000 0000" />
          </div>
        </div>
        <div style={{ padding: '0 22px 22px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', border: '1.5px solid #e2e8f0', borderRadius: 9, background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#334155' }}>
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ padding: '10px 24px', background: saving ? '#cbd5e1' : '#10b981', border: 'none', borderRadius: 10, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 6, boxShadow: saving ? 'none' : '0 4px 12px rgba(16,185,129,.3)' }}
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

function SectionDelivery() {
  const { profile } = useAuth()
  const { config, isLoading: configLoading, updateConfig, isSaving } = useRestaurantConfig()
  const restaurantId = profile?.restaurant_id ?? ''
  const qc = useQueryClient()

  const [defaultTime, setDefaultTime] = useState<number>(config.default_delivery_time ?? 30)
  const [editCourier, setEditCourier] = useState<CourierRow | null | 'new'>()
  const [timeInitialized, setTimeInitialized] = useState(false)

  if (!timeInitialized && !configLoading) {
    setDefaultTime(config.default_delivery_time ?? 30)
    setTimeInitialized(true)
  }

  const { data: couriers = [], isLoading: couriersLoading } = useQuery({
    queryKey: ['all_couriers', restaurantId],
    queryFn: async () => {
      const { data, error } = await getAllCouriers(restaurantId)
      if (error) throw error
      return data ?? []
    },
    enabled: !!restaurantId,
    staleTime: 30_000,
  })

  const handleDeactivate = async (id: string) => {
    const { error } = await deleteCourier(id)
    if (error) { toast.error('Error al desactivar repartidor'); return }
    toast.success('Repartidor desactivado')
    qc.invalidateQueries({ queryKey: ['all_couriers', restaurantId] })
  }

  if (configLoading || couriersLoading) return <Skeleton />

  return (
    <div>
      <SectionTitle>Delivery</SectionTitle>

      {/* Tiempo estimado default */}
      <div style={{ marginBottom: 32 }}>
        <FieldLabel>Tiempo estimado de entrega por defecto (minutos)</FieldLabel>
        <input
          type="number"
          min={5}
          max={180}
          value={defaultTime}
          onChange={e => setDefaultTime(Number(e.target.value))}
          style={{
            width: 120,
            border: '1.5px solid #e2e8f0',
            borderRadius: 8,
            padding: '9px 12px',
            fontSize: 16,
            fontFamily: 'monospace',
            color: '#0f172a',
            outline: 'none',
          }}
          onFocus={e => (e.currentTarget.style.borderColor = '#10b981')}
          onBlur={e => (e.currentTarget.style.borderColor = '#e2e8f0')}
        />
        <SaveButton onClick={() => updateConfig({ default_delivery_time: defaultTime })} loading={isSaving} />
      </div>

      {/* Repartidores */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>Repartidores</h3>
          <button
            onClick={() => setEditCourier('new')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#10b981', border: 'none', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#fff', boxShadow: '0 4px 12px rgba(16,185,129,.3)' }}
          >
            <Plus size={14} /> Agregar
          </button>
        </div>

        <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
          {couriers.length === 0 && (
            <div style={{ padding: '28px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
              No hay repartidores registrados
            </div>
          )}
          {couriers.map((c, idx) => (
            <div
              key={c.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '12px 16px',
                borderBottom: idx < couriers.length - 1 ? '1px solid #f1f5f9' : 'none',
                gap: 12,
                opacity: c.is_active ? 1 : 0.5,
              }}
            >
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', margin: 0 }}>{c.name}</p>
                {c.phone && <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>{c.phone}</p>}
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: c.is_active ? '#065f46' : '#64748b', background: c.is_active ? '#ecfdf5' : '#f1f5f9', padding: '3px 10px', borderRadius: 20 }}>
                {c.is_active ? 'Activo' : 'Inactivo'}
              </span>
              <button
                onClick={() => setEditCourier(c)}
                style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', fontSize: 12, color: '#334155' }}
              >
                Editar
              </button>
              {c.is_active && (
                <button
                  onClick={() => handleDeactivate(c.id)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                  title="Desactivar"
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {editCourier !== undefined && (
        <CourierFormModal
          courier={editCourier === 'new' ? null : editCourier}
          restaurantId={restaurantId}
          onClose={() => setEditCourier(undefined)}
        />
      )}
    </div>
  )
}

// ─── Section 6: Notificaciones ────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        width: 44,
        height: 24,
        borderRadius: 12,
        background: checked ? '#10b981' : '#cbd5e1',
        border: 'none',
        cursor: 'pointer',
        position: 'relative',
        transition: 'background .15s',
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: checked ? 23 : 3,
          width: 18,
          height: 18,
          borderRadius: '50%',
          background: '#fff',
          transition: 'left .15s',
          boxShadow: '0 1px 4px rgba(0,0,0,.2)',
        }}
      />
    </button>
  )
}

function SectionNotificaciones() {
  const { config, isLoading, updateConfig, isSaving } = useRestaurantConfig()

  const [deliverySound, setDeliverySound] = useState(true)
  const [kitchenSound, setKitchenSound] = useState(true)
  const [initialized, setInitialized] = useState(false)

  if (!initialized && !isLoading) {
    setDeliverySound(config.notifications?.delivery_sound ?? true)
    setKitchenSound(config.notifications?.kitchen_sound ?? true)
    setInitialized(true)
  }

  if (isLoading) return <Skeleton />

  const ToggleRow = ({
    label,
    description,
    value,
    onChange,
  }: {
    label: string
    description: string
    value: boolean
    onChange: (v: boolean) => void
  }) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 20px',
        border: '1px solid #e2e8f0',
        borderRadius: 10,
        background: '#fff',
        gap: 16,
      }}
    >
      <div>
        <p style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', margin: 0 }}>{label}</p>
        <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>{description}</p>
      </div>
      <Toggle checked={value} onChange={onChange} />
    </div>
  )

  return (
    <div>
      <SectionTitle>Notificaciones</SectionTitle>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
        Controla las alertas sonoras de cada módulo.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520 }}>
        <ToggleRow
          label="Delivery — nueva orden"
          description="Alerta cuando llega un pedido de delivery"
          value={deliverySound}
          onChange={setDeliverySound}
        />
        <ToggleRow
          label="Cocina — nueva comanda"
          description="Beep triple al recibir una comanda en el KDS"
          value={kitchenSound}
          onChange={setKitchenSound}
        />
      </div>

      <SaveButton
        onClick={() =>
          updateConfig({
            notifications: { delivery_sound: deliverySound, kitchen_sound: kitchenSound },
          })
        }
        loading={isSaving}
      />
    </div>
  )
}

// ─── Section: Sedes ───────────────────────────────────────────────

function StoreModal({
  store,
  onClose,
  onSave,
  saving,
}: {
  store: StoreRow | 'new'
  onClose: () => void
  onSave: (data: { name: string; address: string; phone: string }) => void
  saving: boolean
}) {
  const isNew = store === 'new'
  const [name, setName] = useState(isNew ? '' : store.name)
  const [address, setAddress] = useState(isNew ? '' : (store.address ?? ''))
  const [phone, setPhone] = useState(isNew ? '' : (store.phone ?? ''))

  const handleSave = () => {
    if (!name.trim()) { toast.error('Ingresa el nombre de la sede'); return }
    onSave({ name: name.trim(), address, phone })
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', zIndex: 50 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: '#fff', borderRadius: 14, width: 460, maxWidth: '92%', boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)', overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>{isNew ? 'Nueva sede' : 'Editar sede'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={18} /></button>
        </div>
        <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div><FieldLabel>Nombre</FieldLabel><TextInput value={name} onChange={setName} placeholder="Sede Centro" /></div>
          <div><FieldLabel>Dirección</FieldLabel><TextInput value={address} onChange={setAddress} placeholder="Calle 10 #5-20" /></div>
          <div><FieldLabel>Teléfono</FieldLabel><TextInput value={phone} onChange={setPhone} placeholder="3001234567" /></div>
        </div>
        <div style={{ padding: '0 22px 22px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', border: '1.5px solid #e2e8f0', borderRadius: 9, background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#334155' }}>Cancelar</button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ padding: '10px 24px', background: saving ? '#cbd5e1' : '#10b981', border: 'none', borderRadius: 10, cursor: saving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 6, boxShadow: saving ? 'none' : '0 4px 12px rgba(16,185,129,.3)' }}
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {isNew ? 'Crear sede' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SectionSedes() {
  const { stores, orgUsers, assignments, isLoading, createStore, updateStore, deleteStore, setAssignment, isMutating } = useStores()
  const [editStore, setEditStore] = useState<StoreRow | 'new' | null>(null)

  if (isLoading) return <Skeleton />

  const isAssigned = (userId: string, storeId: string) =>
    assignments.some(a => a.user_id === userId && a.restaurant_id === storeId)

  const handleSave = async (data: { name: string; address: string; phone: string }) => {
    if (editStore === 'new') await createStore(data)
    else if (editStore) await updateStore({ id: editStore.id, data: { name: data.name, address: data.address || null, phone: data.phone || null } })
    setEditStore(null)
  }

  const handleDelete = async (store: StoreRow) => {
    if (stores.length <= 1) { toast.error('No puedes eliminar la única sede de la organización'); return }
    if (!window.confirm(`¿Eliminar la sede "${store.name}"? Se borrarán también sus datos asociados.`)) return
    await deleteStore(store.id)
  }

  return (
    <div>
      <SectionTitle>Sedes</SectionTitle>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button
          onClick={() => setEditStore('new')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', background: '#10b981', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#fff', boxShadow: '0 4px 12px rgba(16,185,129,.3)' }}
        >
          <Plus size={15} /> Crear sede
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {stores.map(store => (
          <div key={store.id} style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #f1f5f9' }}>
              <div>
                <p style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', margin: 0 }}>{store.name}</p>
                <p style={{ fontSize: 12.5, color: '#64748b', margin: '3px 0 0' }}>
                  {store.address || 'Sin dirección'}{store.phone ? ` · ${store.phone}` : ''}
                </p>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setEditStore(store)} title="Editar" style={{ width: 30, height: 30, border: '1px solid #e2e8f0', background: '#fff', borderRadius: 7, cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center' }}><Pencil size={13} /></button>
                <button onClick={() => handleDelete(store)} disabled={stores.length <= 1 || isMutating} title={stores.length <= 1 ? 'No puedes eliminar la única sede' : 'Eliminar'} style={{ width: 30, height: 30, border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 7, cursor: stores.length <= 1 ? 'not-allowed' : 'pointer', color: '#dc2626', display: 'grid', placeItems: 'center', opacity: stores.length <= 1 ? 0.4 : 1 }}><Trash2 size={13} /></button>
              </div>
            </div>
            {/* Acceso de usuarios */}
            <div style={{ padding: '12px 16px' }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 10px' }}>Acceso de usuarios</p>
              {orgUsers.length === 0 ? (
                <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>Sin usuarios.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {orgUsers.map(u => {
                    const checked = isAssigned(u.id, store.id)
                    return (
                      <label key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5, color: '#334155', cursor: 'pointer', padding: '4px 0' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setAssignment({ userId: u.id, restaurantId: store.id, assigned: !checked })}
                          style={{ width: 16, height: 16, accentColor: '#10b981', cursor: 'pointer' }}
                        />
                        <span style={{ fontWeight: 600 }}>{u.full_name}</span>
                        <span style={{ color: '#94a3b8' }}>{u.email}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {editStore && <StoreModal store={editStore} onClose={() => setEditStore(null)} onSave={handleSave} saving={isMutating} />}
    </div>
  )
}

// ─── Section: Roles y permisos ────────────────────────────────────

function RoleModal({ role, onClose }: { role: RoleRow | 'new'; onClose: () => void }) {
  const { createRole, updateRole, isMutating } = useRoles()
  const isNew = role === 'new'
  const [name, setName] = useState(isNew ? '' : role.name)
  const [perms, setPerms] = useState<string[]>(isNew ? [] : rolePermissions(role))

  const toggle = (key: string) =>
    setPerms(p => (p.includes(key) ? p.filter(x => x !== key) : [...p, key]))

  const handleSave = async () => {
    if (!name.trim()) { toast.error('Ingresa un nombre para el rol'); return }
    if (isNew) await createRole({ name: name.trim(), permissions: perms })
    else await updateRole({ id: role.id, name: name.trim(), permissions: perms })
    onClose()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', zIndex: 50 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: '#fff', borderRadius: 14, width: 560, maxWidth: '94%', maxHeight: '88vh', boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>{isNew ? 'Nuevo rol' : `Editar rol · ${role.name}`}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={18} /></button>
        </div>
        <div style={{ padding: 22, overflowY: 'auto' }}>
          <div style={{ marginBottom: 20 }}>
            <FieldLabel>Nombre del rol</FieldLabel>
            <TextInput value={name} onChange={setName} placeholder="Ej: Supervisor" />
          </div>
          <FieldLabel>Permisos</FieldLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 6 }}>
            {PERMISSION_GROUPS.map(group => (
              <div key={group.module} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px' }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>{group.module}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px' }}>
                  {group.perms.map(perm => (
                    <label key={perm.key} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: '#334155', cursor: 'pointer' }}>
                      <input type="checkbox" checked={perms.includes(perm.key)} onChange={() => toggle(perm.key)} style={{ width: 15, height: 15, accentColor: '#10b981', cursor: 'pointer' }} />
                      {perm.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ padding: '14px 22px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 10, justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '10px 20px', border: '1.5px solid #e2e8f0', borderRadius: 9, background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#334155' }}>Cancelar</button>
          <button
            onClick={handleSave}
            disabled={isMutating}
            style={{ padding: '10px 24px', background: isMutating ? '#cbd5e1' : '#10b981', border: 'none', borderRadius: 10, cursor: isMutating ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 6, boxShadow: isMutating ? 'none' : '0 4px 12px rgba(16,185,129,.3)' }}
          >
            {isMutating && <Loader2 size={14} className="animate-spin" />}
            {isNew ? 'Crear rol' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SectionRoles() {
  const { roles, roleCounts, isLoading, deleteRole, isMutating } = useRoles()
  const [editRole, setEditRole] = useState<RoleRow | 'new' | null>(null)

  if (isLoading) return <Skeleton />

  const handleDelete = async (role: RoleRow) => {
    if ((roleCounts[role.id] ?? 0) > 0) { toast.error('No puedes eliminar un rol con usuarios asignados'); return }
    if (!window.confirm(`¿Eliminar el rol "${role.name}"?`)) return
    await deleteRole(role.id)
  }

  return (
    <div>
      <SectionTitle>Roles y permisos</SectionTitle>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button
          onClick={() => setEditRole('new')}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', background: '#10b981', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#fff', boxShadow: '0 4px 12px rgba(16,185,129,.3)' }}
        >
          <Plus size={15} /> Crear rol
        </button>
      </div>

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
        {roles.map((role, idx) => {
          const count = roleCounts[role.id] ?? 0
          const perms = rolePermissions(role)
          const hasWildcard = perms.includes('*')
          const permLabel = hasWildcard
            ? 'Todos los permisos'
            : `${perms.length} ${perms.length === 1 ? 'permiso' : 'permisos'}`
          return (
            <div key={role.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: idx < roles.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', textTransform: 'capitalize' }}>{role.name}</span>
                  {role.is_system && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, color: '#475569', background: '#f1f5f9', border: '1px solid #e2e8f0', padding: '2px 7px', borderRadius: 20 }}>
                      <Lock size={9} /> Sistema
                    </span>
                  )}
                  {hasWildcard && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, color: '#047857', background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '2px 7px', borderRadius: 20 }}>
                      <Shield size={9} /> Acceso total
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>
                  {permLabel} · {count} {count === 1 ? 'usuario' : 'usuarios'}
                </p>
              </div>
              {role.is_system ? (
                <span style={{ fontSize: 12, color: '#94a3b8' }}>No editable</span>
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setEditRole(role)} title="Editar" style={{ width: 30, height: 30, border: '1px solid #e2e8f0', background: '#fff', borderRadius: 7, cursor: 'pointer', color: '#64748b', display: 'grid', placeItems: 'center' }}><Pencil size={13} /></button>
                  <button onClick={() => handleDelete(role)} disabled={count > 0 || isMutating} title={count > 0 ? 'Tiene usuarios asignados' : 'Eliminar'} style={{ width: 30, height: 30, border: '1px solid #fecaca', background: '#fef2f2', borderRadius: 7, cursor: count > 0 ? 'not-allowed' : 'pointer', color: '#dc2626', display: 'grid', placeItems: 'center', opacity: count > 0 ? 0.4 : 1 }}><Trash2 size={13} /></button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {editRole && <RoleModal role={editRole} onClose={() => setEditRole(null)} />}
    </div>
  )
}

// ─── Section: Extras ──────────────────────────────────────────────

type ExtraRow = Tables<'extras'>

const formatCOP = (n: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n)

function ExtraFormModal({
  extra,
  restaurantId,
  onClose,
}: {
  extra: ExtraRow | null
  restaurantId: string
  onClose: () => void
}) {
  const { saveExtra } = useExtras()
  const { data: products = [] } = useProducts()

  const [name, setName] = useState(extra?.name ?? '')
  const [price, setPrice] = useState(extra ? String(extra.price) : '')
  const [tracksStock, setTracksStock] = useState(!!extra?.linked_product_id)
  const [linkedProductId, setLinkedProductId] = useState(extra?.linked_product_id ?? '')

  const priceNum = parseInt(price.replace(/\D/g, ''), 10) || 0
  const isValid = name.trim().length > 0 && (!tracksStock || !!linkedProductId)
  const saving = saveExtra.isPending

  const handleSave = async () => {
    if (!isValid) return
    await saveExtra.mutateAsync({
      ...(extra ? { id: extra.id } : {}),
      restaurant_id: restaurantId,
      name: name.trim(),
      price: priceNum,
      linked_product_id: tracksStock ? (linkedProductId || null) : null,
      is_active: true,
    })
    onClose()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', display: 'grid', placeItems: 'center', zIndex: 50 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: '#fff', borderRadius: 14, width: 440, boxShadow: '0 25px 50px -12px rgba(0,0,0,.25)' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
            {extra ? 'Editar extra' : 'Nuevo extra'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={18} /></button>
        </div>

        <div style={{ padding: '22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <FieldLabel>Nombre</FieldLabel>
            <TextInput value={name} onChange={setName} placeholder="Ej: Topping de queso" testId="extra-name" />
          </div>

          <div>
            <FieldLabel>Precio (COP)</FieldLabel>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: '#94a3b8', fontFamily: 'monospace', pointerEvents: 'none' }}>$</span>
              <input
                type="text"
                inputMode="numeric"
                data-testid="extra-price"
                value={price ? formatCOP(priceNum).replace('$', '').trim() : ''}
                onChange={e => setPrice(e.target.value.replace(/\D/g, ''))}
                placeholder="0"
                style={{ width: '100%', border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '10px 12px 10px 24px', fontSize: 14, color: '#0f172a', outline: 'none', background: '#fff', boxSizing: 'border-box', fontFamily: 'monospace' }}
                onFocus={e => (e.currentTarget.style.borderColor = '#10b981')}
                onBlur={e => (e.currentTarget.style.borderColor = '#e2e8f0')}
              />
            </div>
          </div>

          {/* Toggle: descuenta inventario */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Descuenta inventario</div>
                <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>
                  Vender este extra descuenta stock de un producto
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={tracksStock}
                data-testid="extra-link-toggle"
                onClick={() => setTracksStock(!tracksStock)}
                style={{ width: 44, height: 24, borderRadius: 12, background: tracksStock ? '#10b981' : '#e2e8f0', border: 'none', cursor: 'pointer', position: 'relative', transition: 'background .15s', flexShrink: 0 }}
              >
                <span style={{ position: 'absolute', top: 2, left: tracksStock ? 22 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.2)', transition: 'left .15s' }} />
              </button>
            </div>

            {tracksStock && (
              <div style={{ marginTop: 12 }}>
                <FieldLabel>Producto vinculado</FieldLabel>
                <select
                  value={linkedProductId}
                  data-testid="extra-link-product"
                  onChange={e => setLinkedProductId(e.target.value)}
                  style={{ width: '100%', border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', fontSize: 14, color: '#0f172a', outline: 'none', background: '#fff', cursor: 'pointer' }}
                  onFocus={e => (e.currentTarget.style.borderColor = '#10b981')}
                  onBlur={e => (e.currentTarget.style.borderColor = '#e2e8f0')}
                >
                  <option value="">Seleccionar producto...</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: '0 22px 22px', display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '10px 20px', border: '1.5px solid #e2e8f0', borderRadius: 9, background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#334155' }}>
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={!isValid || saving}
            data-testid="extra-save"
            style={{ padding: '10px 24px', background: !isValid || saving ? '#cbd5e1' : '#10b981', border: 'none', borderRadius: 10, cursor: !isValid || saving ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 6, boxShadow: !isValid || saving ? 'none' : '0 4px 12px rgba(16,185,129,.3)' }}
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  )
}

function SectionExtras() {
  const { profile } = useAuth()
  const restaurantId = profile?.restaurant_id ?? ''
  const { extras, isLoading, deactivate } = useExtras()
  const { data: products = [] } = useProducts()
  const [editExtra, setEditExtra] = useState<ExtraRow | null | 'new'>()

  const productName = (id: string | null) =>
    id ? (products.find(p => p.id === id)?.name ?? 'Producto eliminado') : null

  // Borrado lógico, nunca físico: si el extra está en ventas (order_item_extras),
  // el FK ON DELETE RESTRICT impediría borrarlo y conservamos el histórico. Por eso
  // siempre desactivamos y, cuando está en uso, lo explicitamos en el mensaje.
  const handleDeactivate = async (extra: ExtraRow) => {
    const { count } = await countOrderItemsUsingExtra(extra.id)
    const inUse = (count ?? 0) > 0
    const message = inUse
      ? `«${extra.name}» se usa en ${count} línea${count === 1 ? '' : 's'} de venta, así que no se puede eliminar. ` +
        `Se desactivará para que no aparezca en nuevas ventas (el histórico se conserva). ¿Continuar?`
      : `¿Desactivar «${extra.name}»?`
    if (!window.confirm(message)) return
    deactivate.mutate(extra.id)
  }

  if (isLoading) return <Skeleton />

  return (
    <div>
      <SectionTitle>Extras</SectionTitle>
      <p style={{ fontSize: 13, color: '#64748b', marginTop: -16, marginBottom: 24 }}>
        Subproductos reutilizables (toppings, adiciones, salsas). Se asignan a cada
        producto desde su ficha en <strong>Productos</strong>.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>Catálogo</h3>
        <button
          onClick={() => setEditExtra('new')}
          data-testid="extra-new"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#10b981', border: 'none', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#fff', boxShadow: '0 4px 12px rgba(16,185,129,.3)' }}
        >
          <Plus size={14} /> Nuevo extra
        </button>
      </div>

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
        {extras.length === 0 && (
          <div style={{ padding: '28px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
            No hay extras en el catálogo
          </div>
        )}
        {extras.map((e, idx) => (
          <div
            key={e.id}
            data-testid="extra-row"
            style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: idx < extras.length - 1 ? '1px solid #f1f5f9' : 'none', gap: 12, opacity: e.is_active ? 1 : 0.5 }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#0f172a', margin: 0 }}>{e.name}</p>
              {e.linked_product_id && (
                <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Package size={12} /> Descuenta: {productName(e.linked_product_id)}
                </p>
              )}
            </div>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>{formatCOP(Number(e.price))}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: e.is_active ? '#065f46' : '#64748b', background: e.is_active ? '#ecfdf5' : '#f1f5f9', padding: '3px 10px', borderRadius: 20 }}>
              {e.is_active ? 'Activo' : 'Inactivo'}
            </span>
            <button
              onClick={() => setEditExtra(e)}
              style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', fontSize: 12, color: '#334155' }}
            >
              Editar
            </button>
            {e.is_active && (
              <button
                onClick={() => handleDeactivate(e)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                title="Desactivar"
              >
                <Trash2 size={15} />
              </button>
            )}
          </div>
        ))}
      </div>

      {editExtra !== undefined && (
        <ExtraFormModal
          extra={editExtra === 'new' ? null : editExtra}
          restaurantId={restaurantId}
          onClose={() => setEditExtra(undefined)}
        />
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────

export function ConfigPage() {
  const { can } = usePermissions()
  const [active, setActive] = useState<SectionId>('restaurante')

  const visibleSections = SECTIONS.filter(s => !s.permission || can(s.permission))

  const SECTION_MAP: Record<SectionId, React.ReactNode> = {
    restaurante: <SectionRestaurant />,
    usuarios: <SectionUsers />,
    sedes: <SectionSedes />,
    roles: <SectionRoles />,
    extras: <SectionExtras />,
    caja: <SectionCaja />,
    cocina: <SectionCocina />,
    delivery: <SectionDelivery />,
    notificaciones: <SectionNotificaciones />,
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left nav */}
      <nav
        style={{
          width: 220,
          flexShrink: 0,
          borderRight: '1px solid #e2e8f0',
          background: '#f8fafc',
          padding: '16px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <p
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: '#64748b',
            textTransform: 'uppercase',
            letterSpacing: 1,
            padding: '4px 10px 10px',
            margin: 0,
          }}
        >
          Ajustes
        </p>
        {visibleSections.map(({ id, label, icon: Icon }) => {
          const isActive = active === id
          return (
            <button
              key={id}
              onClick={() => setActive(id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                fontSize: 13.5,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? '#0f172a' : '#64748b',
                background: isActive ? '#fff' : 'transparent',
                boxShadow: isActive ? '0 1px 3px rgba(0,0,0,.07)' : 'none',
                transition: 'all .12s',
                width: '100%',
              }}
            >
              <Icon
                size={16}
                style={{ color: isActive ? '#10b981' : '#94a3b8', flexShrink: 0 }}
              />
              {label}
            </button>
          )
        })}
      </nav>

      {/* Right content */}
      <main
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '36px 48px',
          background: '#fff',
        }}
      >
        <div style={{ maxWidth: 640 }}>
          {SECTION_MAP[active]}
        </div>
      </main>
    </div>
  )
}
