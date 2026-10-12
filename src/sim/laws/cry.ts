// L2 Cri : halètement de 0,5 s, puis cri continu qui alerte les créatures en Rituel à moins de 8 m.
// Les corps absorbés gardent une voix étouffée (D8) mais n'alertent pas.
import { alert, type Draft, emit } from '../draft'
import { TUNING } from '../tuning'
import { dist } from '../vec'

export const cryTick = (d: Draft): void => {
  for (const c of d.creatures) {
    if ((c.state.kind === 'abattu' || c.state.kind === 'absorbe') && c.state.cryAt === d.tick) {
      emit(d, { type: 'cry-start', tick: d.tick, id: c.id })
    }
  }
  for (const c of d.creatures) {
    if (c.state.kind !== 'abattu' || c.state.cryAt === null || c.state.cryAt > d.tick) continue
    for (const o of d.creatures) {
      if (o.state.kind === 'rituel' && dist(o.pos, c.pos) <= TUNING.criAlertRadius) alert(d, o, 'cry')
    }
  }
}
