// Mesures de l'audit du §30 sur l'image courante (E1) : aucun élément d'une créature debout ne se lit comme le
// liseré (ivoire, or) ; l'acier du Bourreau ne se lit pas comme un mort ; les télégraphes se séparent du sang et se
// dessinent par-dessus les morts. Références de couleur : celles de B2 (médianes des liserés et des morts de l'image).
import {
  decodeId,
  deltaE00,
  hexToLab,
  type Lab,
  PALETTE,
  type PixelImage,
  PLAYER_ID,
  type Renderer,
  ROLE,
  srgbToLab,
} from '../render/index'
import type { World } from '../sim/index'
import { readFrame } from './measure'

const labAt = (img: PixelImage, i: number): Lab =>
  srgbToLab(img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0)

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? (s[s.length >> 1] as number) : Number.NaN
}
const medianLab = (ls: Lab[]): Lab | null =>
  ls.length
    ? { L: median(ls.map((l) => l.L)), a: median(ls.map((l) => l.a)), b: median(ls.map((l) => l.b)) }
    : null

// Pixels qui changent quand on masque les télégraphes.
const telegraphPixels = (r: Renderer): { on: PixelImage; off: PixelImage; idx: number[] } => {
  r.debug.setTelegraphs(false)
  const off = r.debug.readPixels()
  r.debug.setTelegraphs(true)
  const on = r.debug.readPixels()
  const idx: number[] = []
  for (let i = 0; i < on.data.length; i += 4) {
    if (
      on.data[i] !== off.data[i] ||
      on.data[i + 1] !== off.data[i + 1] ||
      on.data[i + 2] !== off.data[i + 2]
    )
      idx.push(i)
  }
  return { on, off, idx }
}

// `given` (E6) : références imposées (celles de B2, refs.json), pour auditer une image sans Résistant ni mort.
export const auditFrame = (r: Renderer, world: World, given?: { ivoire: Lab; or: Lab; gris: Lab }) => {
  const color = r.debug.readPixels()
  const ids = r.debug.idPass()
  const frame = readFrame(color, ids, world, given)
  const refs = frame.refs
  // 1. Créatures debout et Bourreau : pixels lus comme ivoire, or (et gris pour le Bourreau).
  const standing = frame.entities
    .filter((e) => e.cls === 'debout')
    .map((e) => ({ id: e.id, pixels: e.pixels, ivoirePx: e.ivoirePx, orPx: e.orPx }))
  let playerGris = 0
  let playerPx = 0
  // E8 : les morts sont éclairés naturellement ; dans le noir, un mort, le cuir du Bourreau et le sol sont tous près du
  // noir, et la référence de gris de l'image (médiane des morts) aussi. On compte à part les pixels gris éclairés
  // (L* ≥ 20, limite « éclairé » de B2, amendements A3 et A9), les seuls où le gris peut se lire comme un mort.
  let playerGrisEclaire = 0
  const playerLabs: Lab[] = []
  for (let i = 0; i < ids.data.length; i += 4) {
    const { id } = decodeId(ids.data[i] ?? 0, ids.data[i + 1] ?? 0, ids.data[i + 2] ?? 0)
    if (id !== PLAYER_ID) continue
    playerPx++
    const l = labAt(color, i)
    playerLabs.push(l)
    if (refs.gris && deltaE00(l, refs.gris) <= 10) {
      playerGris++
      if (l.L >= 20) playerGrisEclaire++
    }
  }
  const player = frame.entities.find((e) => e.id === PLAYER_ID)
  // L'arme en main (E6) : pixels du joueur au rôle « autre ». Classes réservées : ivoire, or, gris des morts (références
  // de l'image) et rouge vif (palette).
  const rougeVif = hexToLab(PALETTE.rougeVif)
  const weaponLabs: Lab[] = []
  const weaponHits: { x: number; y: number; kind: string; rgb: number[] }[] = []
  for (let i = 0, p = 0; i < ids.data.length; i += 4, p++) {
    const { id, role } = decodeId(ids.data[i] ?? 0, ids.data[i + 1] ?? 0, ids.data[i + 2] ?? 0)
    if (id !== PLAYER_ID || role !== ROLE.autre) continue
    const l = labAt(color, i)
    weaponLabs.push(l)
    const kinds: [string, Lab | null][] = [
      ['ivoire', refs.ivoire],
      ['or', refs.or],
      ['gris', refs.gris],
      ['rougeVif', rougeVif],
    ]
    const k = kinds.find(([, ref]) => ref && deltaE00(l, ref) <= 10)
    if (k && weaponHits.length < 40)
      weaponHits.push({
        x: p % ids.width,
        y: Math.floor(p / ids.width),
        kind: k[0],
        rgb: [color.data[i] ?? 0, color.data[i + 1] ?? 0, color.data[i + 2] ?? 0],
      })
  }
  const near = (ref: Lab | null): number =>
    ref ? weaponLabs.filter((l) => deltaE00(l, ref) <= 10).length : 0
  const weaponMedian = medianLab(weaponLabs)
  const weapon = {
    pixels: weaponLabs.length,
    ivoirePx: near(refs.ivoire),
    orPx: near(refs.or),
    grisPx: near(refs.gris),
    grisPxEclaires: refs.gris
      ? weaponLabs.filter((l) => l.L >= 20 && deltaE00(l, refs.gris as Lab) <= 10).length
      : 0,
    rougeVifPx: near(rougeVif),
    lab: weaponMedian,
    deGrisMedian: refs.gris && weaponMedian ? deltaE00(weaponMedian, refs.gris) : null,
    deOrMin:
      refs.or && weaponLabs.length ? Math.min(...weaponLabs.map((l) => deltaE00(l, refs.or as Lab))) : null,
    deIvoireMin:
      refs.ivoire && weaponLabs.length
        ? Math.min(...weaponLabs.map((l) => deltaE00(l, refs.ivoire as Lab)))
        : null,
    deGrisMin:
      refs.gris && weaponLabs.length
        ? Math.min(...weaponLabs.map((l) => deltaE00(l, refs.gris as Lab)))
        : null,
    deRougeVifMin: weaponLabs.length ? Math.min(...weaponLabs.map((l) => deltaE00(l, rougeVif))) : null,
    hits: weaponHits,
  }
  // Où sont ces pixels (pour les retrouver sur la capture) : id, rôle, position, classe.
  const standingIds = new Set([...standing.map((s) => s.id), PLAYER_ID])
  const hits: { id: number; role: number; x: number; y: number; kind: string }[] = []
  for (let i = 0, p = 0; i < ids.data.length && hits.length < 40; i += 4, p++) {
    const { id, role } = decodeId(ids.data[i] ?? 0, ids.data[i + 1] ?? 0, ids.data[i + 2] ?? 0)
    if (!standingIds.has(id)) continue
    const l = labAt(color, i)
    const kind =
      refs.ivoire && deltaE00(l, refs.ivoire) <= 10
        ? 'ivoire'
        : refs.or && deltaE00(l, refs.or) <= 10
          ? 'or'
          : ''
    if (kind) hits.push({ id, role, x: p % ids.width, y: Math.floor(p / ids.width), kind })
  }
  // 2. Télégraphes contre le sang (décalques) : médianes Lab et écart.
  const tel = telegraphPixels(r)
  const telSet = new Set(tel.idx)
  const telLab = medianLab(tel.idx.map((i) => labAt(tel.on, i)))
  const blood: Lab[] = []
  for (let i = 0; i < ids.data.length; i += 4) {
    if (ids.data[i + 2] === ROLE.decalque && !telSet.has(i)) blood.push(labAt(color, i))
  }
  const bloodLab = medianLab(blood)
  // Mesure de l’audit : sur les pixels de sang (et de sol) que le télégraphe recouvre, écart entre l’image avec et
  // sans télégraphe (ΔE00 médian et p10). Un télégraphe qui se fond dans le sang donne un écart proche de 0.
  // Rôles sous le télégraphe : passe d'identification sans télégraphe (le télégraphe lui-même est « autre »).
  r.debug.setTelegraphs(false)
  const under = r.debug.idPass()
  r.debug.setTelegraphs(true)
  const overRole = (role: number): { median: number; p10: number; n: number } => {
    const des: number[] = []
    for (const i of tel.idx)
      if (under.data[i + 2] === role) des.push(deltaE00(labAt(tel.on, i), labAt(tel.off, i)))
    des.sort((a, b) => a - b)
    return {
      median: des[des.length >> 1] ?? Number.NaN,
      p10: des[Math.floor(des.length * 0.1)] ?? Number.NaN,
      n: des.length,
    }
  }
  // 3. Télégraphes et morts : part du télégraphe encore visible quand les morts sont là.
  const deadIds = world.creatures.filter((c) => c.state.kind === 'mort').map((c) => c.id)
  r.debug.hide(deadIds)
  const telNoDead = telegraphPixels(r).idx.length
  r.debug.hide([])
  r.debug.readPixels()
  return {
    tick: world.tick,
    refs,
    standing,
    standingMaxIvoire: Math.max(0, ...standing.map((s) => s.ivoirePx)),
    standingMaxOr: Math.max(0, ...standing.map((s) => s.orPx)),
    standingHits: hits,
    player: {
      pixels: playerPx,
      ivoirePx: player?.ivoirePx ?? 0,
      orPx: player?.orPx ?? 0,
      grisPx: playerGris,
      grisPxEclaires: playerGrisEclaire,
      grisRefL: refs.gris?.L ?? null,
      deGrisMedian: refs.gris && playerLabs.length ? deltaE00(medianLab(playerLabs) as Lab, refs.gris) : null,
    },
    weapon,
    telegraph: {
      pixels: tel.idx.length,
      lab: telLab,
      blood: bloodLab,
      bloodPixels: blood.length,
      deltaE: telLab && bloodLab ? deltaE00(telLab, bloodLab) : null,
      pixelsWithoutDead: telNoDead,
      visibleOverDead: telNoDead ? tel.idx.length / telNoDead : null,
      overBlood: overRole(ROLE.decalque),
      overGround: overRole(ROLE.sol),
    },
  }
}
