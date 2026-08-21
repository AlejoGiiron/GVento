import { useCallback, useState } from 'react'
import { AlertTriangle, CalendarClock, X } from 'lucide-react'
import { useSubscriptionStatus, type EstadoConAviso } from '@/hooks/useSubscriptionStatus'

const STORAGE_KEY = 'gvento:suscripcion:descartado'

interface Descarte {
  estado: string
  dia: string
}

/**
 * Día calendario en zona Bogotá, en formato `YYYY-MM-DD`.
 *
 * `en-CA` se usa porque produce exactamente ese orden (año-mes-día) y por lo
 * tanto una clave estable y comparable; `es-CO` daría `18/08/2026`. Es una
 * decisión de FORMATO de la clave, no de UI: nada de esto se le muestra al
 * usuario. La zona es la del negocio, no la del navegador — un POS con el reloj
 * en otra zona no debe cambiar el día en que reaparece el aviso.
 */
function diaBogota(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
}

function leerDescarte(): Descarte | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const { estado, dia } = parsed as Partial<Descarte>
    if (typeof estado !== 'string' || typeof dia !== 'string') return null
    return { estado, dia }
  } catch {
    // localStorage bloqueado o JSON corrupto: se trata como "no descartado".
    // El modo de fallo es MOSTRAR de más, nunca callar el aviso.
    return null
  }
}

/**
 * Paleta por estado. Ambos son avisos SUAVES: informan y no bloquean nada.
 * `grace` usa el rojo del design system para diferenciarse de `expiring`
 * (ámbar, el mismo del banner de turno) — no porque restrinja algo.
 */
const ESTILOS: Record<EstadoConAviso, {
  fondo: string; borde: string; texto: string; icono: typeof AlertTriangle
}> = {
  expiring: { fondo: '#fffbeb', borde: '#fde68a', texto: '#92400e', icono: CalendarClock },
  grace: { fondo: '#fef2f2', borde: '#fecaca', texto: '#991b1b', icono: AlertTriangle },
}

/**
 * Aviso de estado de suscripción. Fila hermana debajo del header, ARRIBA del
 * banner de turno; comprime `<main>` en vez de superponerse (ninguna pantalla
 * bajo AppLayout usa `100vh`: todas derivan su alto del padre).
 *
 * SOLO UI: no bloquea ninguna acción, ni oculta módulos, ni toca RLS. Un falso
 * positivo en una política de BD sería un bar que no vende de madrugada; un
 * moroso que abre devtools se resuelve con una llamada.
 *
 * DESCARTE (solo `expiring`): dura el día calendario de Bogotá y vuelve al día
 * siguiente. Un descarte permanente anularía el aviso; uno que reaparece en
 * cada recarga entrena a ignorarlo.
 *
 * Se guarda el ESTADO junto con el día para que descartar `expiring` no tape
 * un `grace` que llegue el mismo día — que es el caso que importa: son avisos
 * distintos y el segundo es más serio.
 * ⚠️ RESIDUO CONOCIDO, no bug: si la bandera va y vuelve al MISMO estado en el
 * mismo día (`expiring` → `grace` → `expiring`), el descarte original sigue
 * valiendo y `expiring` no reaparece hasta mañana. Se acepta: la bandera
 * cambia una vez al mes, y el error es mostrar de menos, nunca bloquear.
 *
 * Es por NAVEGADOR, no por usuario: en un POS compartido, si un cajero descarta,
 * el del turno siguiente no lo ve ese día. Asumido — es un aviso del negocio.
 */
export function SubscriptionBanner() {
  const { notice } = useSubscriptionStatus()
  const [descarte, setDescarte] = useState<Descarte | null>(leerDescarte)

  const descartar = useCallback((estado: string) => {
    const nuevo = { estado, dia: diaBogota() }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nuevo))
    } catch {
      /* localStorage no disponible: degradar en silencio (vuelve al recargar) */
    }
    setDescarte(nuevo)
  }, [])

  // Sin aviso (incluye `active`, los estados no implementados, un valor
  // desconocido y la lectura fallida): no se renderiza nada.
  if (!notice) return null

  const yaDescartado =
    notice.descartable
    && descarte?.estado === notice.estado
    && descarte?.dia === diaBogota()

  if (yaDescartado) return null

  const estilo = ESTILOS[notice.estado]
  const Icono = estilo.icono

  return (
    <div
      data-testid="subscription-banner"
      data-estado={notice.estado}
      className="flex-shrink-0 flex items-center gap-3 px-6 py-2.5 border-b"
      style={{ background: estilo.fondo, borderColor: estilo.borde }}
    >
      <Icono size={16} color={estilo.texto} style={{ flexShrink: 0 }} />
      {/*
        `minWidth: 0` + `overflowWrap: 'anywhere'`: sin esto, una corrida sin
        espacios (un token, un ID largo) se RECORTA EN SILENCIO — un flex item
        trae `min-width:auto` y el ancestro es `overflow-hidden`, así que el
        texto no desborda la página: simplemente deja de verse, sin ninguna
        señal. El tope de largo se acordó con G-Centro (140), pero el tope no
        protege de una corrida sin cortes posibles.
      */}
      <span
        data-testid="subscription-banner-message"
        className="text-sm font-medium"
        style={{ color: estilo.texto, minWidth: 0, overflowWrap: 'anywhere' }}
      >
        {notice.mensaje}
      </span>
      {notice.descartable && (
        <button
          onClick={() => descartar(notice.estado)}
          data-testid="subscription-banner-dismiss"
          className="ml-auto"
          style={{ color: estilo.texto, display: 'grid', placeItems: 'center', flexShrink: 0 }}
          title="Descartar por hoy"
        >
          <X size={16} />
        </button>
      )}
    </div>
  )
}
