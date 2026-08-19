import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/hooks/useAuth'
import { getOrganizationSubscription } from '@/lib/supabase-helpers'

/**
 * Estados que ESTA FASE muestra. El CHECK de la BD acepta cinco
 * (`active | expiring | grace | restricted | suspended`); acá se manejan dos a
 * propósito. `restricted` y `suspended` caen en el default del switch —igual
 * que un estado desconocido— y no muestran nada: se dejan sin implementar
 * hasta saber si el aviso suave alcanza.
 */
export type EstadoConAviso = 'expiring' | 'grace'

export interface SubscriptionNotice {
  estado: EstadoConAviso
  mensaje: string
  /** `expiring` se puede descartar por el día; `grace` no. */
  descartable: boolean
}

/**
 * Textos por defecto cuando `subscription_message` viene vacío.
 *
 * POR QUÉ un default y no ocultar el banner: el ESTADO es el contrato y el
 * mensaje es presentación. Si un NULL silenciara el aviso, G-Centro tendría un
 * interruptor accidental para apagarlo — un campo opcional pasaría a decidir si
 * el cliente se entera o no.
 */
const MENSAJE_POR_DEFECTO: Record<EstadoConAviso, string> = {
  expiring: 'Tu suscripción está por vencer. Comunicate con soporte para renovarla.',
  grace: 'Tu suscripción venció. Seguí operando normalmente; comunicate con soporte para regularizar.',
}

/**
 * Traduce la fila de `organizations` al aviso a mostrar, o `null` si no hay
 * nada que mostrar. Pura y exportada para poder ejercitarla sin red.
 *
 * FAIL-OPEN: el `switch` NO tiene `else`/`default` que muestre algo. Todo lo
 * que no sea exactamente `expiring` o `grace` —incluidos `active`, los dos
 * estados no implementados, un valor nuevo que agregue G-Centro y una columna
 * nula— devuelve `null`. La ausencia de información nunca degrada a un cliente:
 * un bar sin poder operar un domingo por una bandera que no supimos leer es
 * inaceptable, y el bien protegido acá es la cobranza, no los datos.
 */
export function resolveNotice(
  status: string | null | undefined,
  message: string | null | undefined,
): SubscriptionNotice | null {
  // `?? ''` cubre null y undefined; `.trim()` cubre '' y los solo-espacios.
  const texto = (message ?? '').trim()

  switch (status) {
    case 'expiring':
      return {
        estado: 'expiring',
        mensaje: texto || MENSAJE_POR_DEFECTO.expiring,
        descartable: true,
      }
    case 'grace':
      return {
        estado: 'grace',
        mensaje: texto || MENSAJE_POR_DEFECTO.grace,
        descartable: false,
      }
    default:
      return null
  }
}

/**
 * Lee la bandera de suscripción que escribe G-Centro. G-Vento SOLO LEE.
 *
 * ── SIN REALTIME (decisión, no omisión) ─────────────────────────────────────
 * G-Vento usa Realtime en cinco lugares y estaría disponible acá, pero una
 * bandera comercial que cambia una vez al mes no lo justifica: la latencia es
 * AMORTIGUACIÓN, no carencia. Una bandera que se actualiza sola en medio de un
 * cobro es exactamente el modo de fallo que cazamos con `checkoutOrder` en
 * TablesPage (Realtime desmontaba el modal antes del step de éxito).
 * Lectura al iniciar sesión + el refetch por foco de React Query alcanza.
 * NO "mejorar" esto con una suscripción Realtime.
 *
 * ── EL TIMESTAMP NO DECIDE ──────────────────────────────────────────────────
 * `subscription_updated_at` significa "cuándo CAMBIÓ el estado", no "cuándo
 * llamó G-Centro": re-aplicar el mismo estado es un no-op y no la mueve. Por
 * eso un cliente estable en `grace` hace tres semanas tiene el timestamp viejo
 * y ESO ES CORRECTO. Caducar el aviso por antigüedad haría desaparecer el
 * banner solo — la degradación por timeout que queremos evitar, invertida.
 * Se expone únicamente como diagnóstico; no entra en la decisión.
 */
export function useSubscriptionStatus() {
  const { organizationId } = useAuth()

  const { data, isError } = useQuery({
    queryKey: ['organization-subscription', organizationId],
    queryFn: async () => {
      const { data, error } = await getOrganizationSubscription(organizationId!)
      if (error) throw error
      return data
    },
    // Sin organización (perfil sin `organization_id`) no se consulta: fail-open.
    enabled: !!organizationId,
    // Cinco minutos: con `refetchOnWindowFocus` (default de React Query) el
    // cajero que vuelve a la pestaña revalida, pero alt-tabear no dispara una
    // consulta por cada foco.
    staleTime: 5 * 60_000,
    // Una bandera comercial no merece la tormenta de reintentos por defecto:
    // si la lectura falla, fail-open y se reintenta en el próximo foco.
    retry: 1,
  })

  // Si la lectura falló, `data` queda undefined y `resolveNotice` devuelve
  // null. `isError` se comprueba igual para que la intención quede explícita
  // y no dependa de un undefined incidental.
  const notice = isError ? null : resolveNotice(data?.subscription_status, data?.subscription_message)

  return {
    notice,
    /** Solo diagnóstico — NO se usa para decidir si el aviso se muestra. */
    actualizadoEn: data?.subscription_updated_at ?? null,
  }
}
