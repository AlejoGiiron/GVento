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
