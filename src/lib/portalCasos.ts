// Casos del formato del link del portal (R1 #12 b). Los usan los DOS lados del contrato:
//   · src/lib/portal.test.ts → slugValido (lo que la pantalla deja guardar);
//   · tests/portal-config.spec.ts → portal_slug_disponible (el CHECK y el regex del servidor).
// Los dos tienen que dar `valido` en cada caso. Van ya normalizados (minúsculas y sin espacios
// alrededor): el servidor normaliza antes de validar y la pantalla también (normalizarSlug).
// Ninguno de los válidos puede estar tomado en la base de pruebas.

export const CASOS_SLUG: readonly { slug: string; valido: boolean }[] = [
  { slug: 'abc', valido: true },
  { slug: 'salchimelo', valido: true },
  { slug: 'g-10', valido: true },
  { slug: 'e2e-libre-123', valido: true },
  { slug: 'a'.repeat(40), valido: true },
  { slug: 'ab', valido: false },
  { slug: 'a'.repeat(41), valido: false },
  { slug: '-abc', valido: false },
  { slug: 'abc-', valido: false },
  { slug: 'ab c', valido: false },
  { slug: 'ñam', valido: false },
  { slug: 'a_b', valido: false },
  { slug: 'a.b', valido: false },
]

// Casos del formato del WhatsApp del local (R1 #12 c), ya normalizados (57 + 10 dígitos o algo que
// no lo es): src/lib/portal.test.ts los pasa por RE_WHATSAPP y tests/portal-config.spec.ts por
// actualizar_portal (el CHECK portal_sedes_whatsapp). Los dos tienen que dar `valido`.
export const CASOS_WHATSAPP: readonly { numero: string; valido: boolean }[] = [
  { numero: '573001234567', valido: true },
  { numero: '573155550101', valido: true },
  { numero: '576012345678', valido: true },
  { numero: '576082345678', valido: true },
  { numero: '570000000001', valido: false },
  { numero: '576092345678', valido: false },
  { numero: '575012345678', valido: false },
  { numero: '57300123456', valido: false },
  { numero: '3001234567', valido: false },
  { numero: '5730012345678', valido: false },
]
