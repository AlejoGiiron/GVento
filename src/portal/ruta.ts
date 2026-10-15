import { RE_SLUG } from '@/lib/portal'
import { HOST_PORTAL } from '@/lib/identidadRutas'

/**
 * El negocio de la URL del portal. Dos formas, las mismas que reescribe vercel.json:
 *   · en el dominio del portal (pedir.gvento.online): /<negocio>;
 *   · en la app, las vistas previas y el servidor local: /pedir/<negocio>.
 * El formato es el del link (RE_SLUG, R1 #12 b). null = la URL no trae un negocio válido.
 */
export function slugDeRuta(pathname: string, host: string): string | null {
  const enDominio = host.split(':')[0].toLowerCase() === HOST_PORTAL
  const partes = pathname.split('?')[0].split('#')[0].split('/').filter(Boolean)
  const slug = enDominio ? (partes.length === 1 ? partes[0] : null)
    : (partes.length === 2 && partes[0] === 'pedir' ? partes[1] : null)
  if (slug === null) return null
  let s: string
  try { s = decodeURIComponent(slug).toLowerCase() } catch { return null }
  return RE_SLUG.test(s) ? s : null
}
