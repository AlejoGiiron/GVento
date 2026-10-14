import { beforeEach, describe, expect, it } from 'vitest'
import { MS_ENTRE_CONSULTAS, reiniciarNominatim, ubicarDireccion, type DependenciasNominatim } from './nominatim'

// La política de uso de Nominatim: máximo 1 consulta por segundo, guardar resultados, identificarse.

function falso(respuestas: unknown[][]) {
  let reloj = 0
  const llamadas: { url: string; init?: RequestInit; en: number }[] = []
  const esperas: number[] = []
  const dep: DependenciasNominatim = {
    ahora: () => reloj,
    // Solo registra la espera: el reloj lo mueve la prueba (con dos consultas a la vez, adelantarlo
    // aquí haría que la segunda viera la hora de la primera ya despierta).
    dormir: async (ms) => { esperas.push(ms) },
    fetch: (async (url: string, init?: RequestInit) => {
      llamadas.push({ url, init, en: reloj })
      const cuerpo = respuestas.shift() ?? []
      return { ok: true, status: 200, json: async () => cuerpo } as Response
    }) as typeof fetch,
  }
  return { dep, llamadas, esperas, avanzar: (ms: number) => { reloj += ms } }
}

beforeEach(() => reiniciarNominatim())

describe('ubicarDireccion (Nominatim)', () => {
  it('dos direcciones seguidas: la segunda espera hasta cumplir 1,1 s entre consultas', async () => {
    const f = falso([[{ lat: '4.7110001', lon: '-74.0721' }], [{ lat: '4.6', lon: '-74.1' }]])
    expect(await ubicarDireccion('Calle 1 # 2-3, Bogotá', f.dep)).toEqual([4.711, -74.0721])
    f.avanzar(300)
    expect(await ubicarDireccion('Carrera 7 # 8-9, Bogotá', f.dep)).toEqual([4.6, -74.1])
    expect(f.esperas).toEqual([MS_ENTRE_CONSULTAS - 300])
    expect(f.llamadas).toHaveLength(2)
  })

  it('si ya pasó más de 1,1 s, no espera (contraste)', async () => {
    const f = falso([[], []])
    await ubicarDireccion('A 1', f.dep)
    f.avanzar(5000)
    await ubicarDireccion('B 2', f.dep)
    expect(f.esperas).toEqual([])
  })

  it('la misma dirección (mayúsculas y espacios aparte) no se vuelve a consultar', async () => {
    const f = falso([[{ lat: '4.7', lon: '-74.07' }]])
    await ubicarDireccion('Calle 1 # 2-3', f.dep)
    expect(await ubicarDireccion('  calle 1   # 2-3 ', f.dep)).toEqual([4.7, -74.07])
    expect(f.llamadas).toHaveLength(1)
  })

  it('pide un solo resultado en Colombia y manda el Referer con el origen de la app', async () => {
    const f = falso([[]])
    expect(await ubicarDireccion('Dirección que no existe', f.dep)).toBeNull()
    const u = new URL(f.llamadas[0].url)
    expect([u.host, u.searchParams.get('limit'), u.searchParams.get('countrycodes'), u.searchParams.get('q')])
      .toEqual(['nominatim.openstreetmap.org', '1', 'co', 'Dirección que no existe'])
    expect(f.llamadas[0].init?.referrerPolicy).toBe('strict-origin-when-cross-origin')
  })

  it('tres consultas lanzadas a la vez salen separadas 1,1 s cada una', async () => {
    const f = falso([[], [], []])
    await Promise.all(['X 1', 'Y 2', 'Z 3'].map((d) => ubicarDireccion(d, f.dep)))
    expect(f.esperas).toEqual([MS_ENTRE_CONSULTAS, 2 * MS_ENTRE_CONSULTAS])
  })

  it('vacío no consulta', async () => {
    const f = falso([])
    expect(await ubicarDireccion('   ', f.dep)).toBeNull()
    expect(f.llamadas).toHaveLength(0)
  })
})
