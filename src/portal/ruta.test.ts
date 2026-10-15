import { describe, expect, it } from 'vitest'
import { slugDeRuta } from './ruta'

describe('portal · el negocio de la URL', () => {
  it('en el dominio del portal: /<negocio>', () => {
    const h = 'pedir.gvento.online'
    expect([slugDeRuta('/salchimelo', h), slugDeRuta('/Salchimelo?x=1', h), slugDeRuta('/', h),
      slugDeRuta('/pedir/salchimelo', h), slugDeRuta('/salchimelo/extra', h), slugDeRuta('/a', h)])
      .toEqual(['salchimelo', 'salchimelo', null, null, null, null])
  })
  it('en la app, las vistas previas y local: /pedir/<negocio>', () => {
    for (const h of ['g-vento.vercel.app', 'g-vento-git-x-equipo.vercel.app', 'localhost:5180']) {
      expect([slugDeRuta('/pedir/salchimelo', h), slugDeRuta('/pedir/salchimelo/', h), slugDeRuta('/salchimelo', h),
        slugDeRuta('/pedir', h), slugDeRuta('/pedir/mal_slug', h), slugDeRuta('/pedir/%E0%A4%A', h)])
        .toEqual(['salchimelo', 'salchimelo', null, null, null, null])
    }
  })
})
