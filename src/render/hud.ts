// HUD du §21, en DOM superposé au canvas : Vie en bas à gauche (cadre ivoire, remplissage rouge brun), Ferveur
// en bas à droite (du sang qui monte, §17.1 : la jauge se remplit de sang sombre à surface mouillée, qui ondule et
// monte en douceur ; seuil de chaque Rite), les Rites et les deux pastilles d'Esquive au centre, l'arme
// et sa touche X (grisée quand un Hostile est à moins de 15 m). Aucun chiffre de dégâts, aucune barre au-dessus
// des créatures. Couleurs : variables CSS tirées de la palette, aucune autre.
import { TUNING, type World } from '../sim/index'
import { cssVariables } from './palette'

export interface Hud {
  update(world: World): void
  dispose(): void
}

export const HUD_BAND_PX = 92 // hauteur du bandeau bas : les sondes du test des 3 s l'évitent (B2 §11)

const FONT = `'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif`

const CSS = `
.mercy-hud {
  ${cssVariables()};
  position: absolute; inset: 0; pointer-events: none; font-family: ${FONT};
  color: var(--hud-encre); font-size: 13px; letter-spacing: 0.02em;
}
.mercy-hud .band { position: absolute; left: 0; right: 0; bottom: 0; height: ${HUD_BAND_PX}px; display: grid;
  grid-template-columns: minmax(180px, 1fr) auto minmax(180px, 1fr); align-items: end; gap: 28px;
  padding: 0 clamp(18px, 3vw, 44px) 22px; }
.mercy-hud .gauge { display: grid; gap: 6px; }
.mercy-hud .gauge.right { justify-items: end; text-align: right; }
.mercy-hud .name { font-style: italic; opacity: 0.8; font-size: 12px; }
.mercy-hud .track { position: relative; width: min(320px, 100%); height: 9px;
  outline: 1px solid var(--hud-cadre); outline-offset: 2px; background: var(--noir); }
.mercy-hud .fill { position: absolute; inset: 0; transform-origin: left center; }
.mercy-hud .vie .fill { background: var(--hud-vie); }
.mercy-hud .ferveur .track { height: 11px; background: var(--noir); overflow: hidden; }
.mercy-hud .ferveur .fill { transform-origin: right center; transition: transform 520ms cubic-bezier(.2,.7,.2,1);
  background:
    linear-gradient(to bottom, var(--hud-ferveur-reflet) 0, var(--hud-ferveur) 30%, var(--hud-ferveur) 55%,
      var(--hud-ferveur-fond) 100%); }
.mercy-hud .ferveur .fill::before { content: ''; position: absolute; inset: 0;
  background: radial-gradient(ellipse 7px 3px at 20% 30%, var(--hud-ferveur-reflet), transparent 70%),
    radial-gradient(ellipse 9px 3px at 65% 55%, var(--hud-ferveur-fond), transparent 70%);
  background-size: 23px 11px, 31px 11px; opacity: 0.55; animation: mercy-sang 3.2s linear infinite; }
.mercy-hud .ferveur .fill::after { content: ''; position: absolute; top: 0; bottom: 0; left: -3px; width: 6px;
  background: radial-gradient(ellipse at center, var(--hud-ferveur-reflet), transparent 70%); opacity: 0.8; }
@keyframes mercy-sang { from { background-position: 0 0, 0 0; } to { background-position: -23px 0, 31px 0; } }
.mercy-hud .notch { position: absolute; top: -5px; bottom: -5px; width: 1px; background: var(--hud-encre);
  opacity: 0.55; }
.mercy-hud .center { display: grid; justify-items: center; gap: 10px; }
.mercy-hud .rites { display: flex; gap: 18px; }
.mercy-hud .rite { display: grid; justify-items: center; gap: 3px; transition: opacity 160ms ease; }
.mercy-hud .rite svg { width: 34px; height: 34px; stroke: var(--hud-encre); fill: none; stroke-width: 1.4; }
.mercy-hud .rite .key { font-size: 11px; opacity: 0.85; }
.mercy-hud .rite .cost { font-size: 11px; color: var(--hud-ferveur-reflet); }
.mercy-hud .rite.off { opacity: 0.32; }
.mercy-hud .rite.locked { opacity: 0.14; }
.mercy-hud .lower { display: flex; gap: 22px; align-items: center; }
.mercy-hud .pips { display: flex; gap: 9px; }
.mercy-hud .pip { width: 9px; height: 9px; transform: rotate(45deg); border: 1px solid var(--hud-encre);
  position: relative; overflow: hidden; }
.mercy-hud .pip i { position: absolute; inset: 0; background: var(--hud-encre); transform-origin: bottom; }
.mercy-hud .arme { font-size: 12px; font-style: italic; transition: opacity 160ms ease; }
.mercy-hud .arme b { font-style: normal; font-weight: normal; margin-left: 6px; opacity: 0.8; }
.mercy-hud .arme.off { opacity: 0.32; }
@media (prefers-reduced-motion: reduce) { .mercy-hud *, .mercy-hud *::before { transition: none !important; animation: none !important; } }
`

const ICONS = {
  balayage:
    '<svg viewBox="0 0 34 34"><circle cx="17" cy="17" r="11"/><path d="M17 6 l4 -3 M17 6 l4 3"/></svg>',
  charge: '<svg viewBox="0 0 34 34"><path d="M5 17 H27 M21 11 L27 17 L21 23 M5 12 V22"/></svg>',
  glas: '<svg viewBox="0 0 34 34"><path d="M10 24 C10 12 13 8 17 8 C21 8 24 12 24 24 Z M8 24 H26 M17 24 v4"/></svg>',
} as const

// Le Glas (R) n'est pas dans P0 (§28) : son emplacement reste visible et éteint.
// Les touches sont lues par position physique (KeyboardEvent.code) : l'étiquette affichée est celle de la touche du
// joueur à cette position (KeyQ est « A » sur un clavier AZERTY), lue dans la disposition du clavier quand le
// navigateur la donne (navigator.keyboard.getLayoutMap), sinon apprise à la première frappe, sinon celle du QWERTY.
const RITES = [
  { id: 'balayage', key: 'clic droit', code: null, cost: TUNING.balayage.cost, locked: false },
  { id: 'charge', key: 'Q', code: 'KeyQ', cost: TUNING.charge.cost, locked: false },
  { id: 'glas', key: 'R', code: 'KeyR', cost: null, locked: true },
] as const

interface LayoutNavigator {
  readonly keyboard?: { getLayoutMap?: () => Promise<{ get(code: string): string | undefined }> }
}

// Étiquette d'une touche physique : appelle `apply` avec la lettre réelle dès qu'elle est connue.
export const watchKeyLabel = (code: string, apply: (label: string) => void): (() => void) => {
  const nav = (typeof navigator === 'undefined' ? {} : navigator) as LayoutNavigator
  void nav.keyboard
    ?.getLayoutMap?.()
    .then((m) => {
      const k = m.get(code)
      if (k) apply(k.toUpperCase())
    })
    .catch(() => {})
  const learn = (e: KeyboardEvent): void => {
    if (e.code === code && e.key.length === 1) apply(e.key.toUpperCase())
  }
  addEventListener('keydown', learn)
  return () => removeEventListener('keydown', learn)
}

export const createHud = (container: HTMLElement): Hud => {
  const style = document.createElement('style')
  style.textContent = CSS
  const root = document.createElement('div')
  root.className = 'mercy-hud'
  root.setAttribute('aria-hidden', 'true')
  const notches = RITES.filter((r) => r.cost !== null)
    .map((r) => `<span class="notch" style="right:${((r.cost ?? 0) / TUNING.ferveur.max) * 100}%"></span>`)
    .join('')
  root.innerHTML = `
    <div class="band">
      <div class="gauge vie"><span class="name">Vie</span><div class="track"><div class="fill"></div></div></div>
      <div class="center">
        <div class="rites">${RITES.map(
          (r) => `<div class="rite${r.locked ? ' locked' : ''}" data-rite="${r.id}">${ICONS[r.id]}
            <span class="key">${r.key}</span>${r.cost !== null ? `<span class="cost">${r.cost}</span>` : ''}</div>`,
        ).join('')}</div>
        <div class="lower">
          <div class="pips"><span class="pip"><i></i></span><span class="pip"><i></i></span></div>
          <div class="arme"><span class="weapon"></span><b>X</b></div>
        </div>
      </div>
      <div class="gauge right ferveur"><span class="name">Ferveur</span>
        <div class="track"><div class="fill"></div>${notches}</div></div>
    </div>`
  container.append(style, root)

  const q = <T extends Element>(sel: string): T => {
    const el = root.querySelector<T>(sel)
    if (!el) throw new Error(`HUD : ${sel} absent`)
    return el
  }
  const vie = q<HTMLElement>('.vie .fill')
  const ferveur = q<HTMLElement>('.ferveur .fill')
  const rites = RITES.map((r) => ({ r, el: q<HTMLElement>(`[data-rite="${r.id}"]`) }))
  const unwatch: (() => void)[] = []
  for (const { r, el } of rites) {
    const label = el.querySelector<HTMLElement>('.key')
    if (r.code && label) unwatch.push(watchKeyLabel(r.code, (k) => (label.textContent = k)))
  }
  const swapKey = root.querySelector<HTMLElement>('.arme b')
  if (swapKey) unwatch.push(watchKeyLabel('KeyX', (k) => (swapKey.textContent = k)))
  const pips = [...root.querySelectorAll<HTMLElement>('.pip i')]
  const arme = q<HTMLElement>('.arme')
  const weapon = q<HTMLElement>('.weapon')
  // Le cadre de la Ferveur se lit de droite à gauche : son seuil de Rite se place depuis le bord droit.
  ferveur.style.transformOrigin = 'right center'

  let lastKey = ''
  return {
    update(world) {
      const p = world.player
      const hostileNear = world.creatures.some(
        (c) =>
          c.state.kind === 'hostile' &&
          Math.hypot(c.pos.x - p.pos.x, c.pos.z - p.pos.z) <= TUNING.swapHostileRadius,
      )
      const recharge =
        p.dodgeRechargeAt === null
          ? 1
          : 1 - Math.max(0, p.dodgeRechargeAt - world.tick) / TUNING.dodge.recharge
      const key = `${p.vie}|${Math.round(p.ferveur * 10)}|${p.dodgeCharges}|${Math.round(recharge * 40)}|${p.weapon}|${hostileNear}`
      if (key === lastKey) return
      lastKey = key
      vie.style.transform = `scaleX(${Math.max(0, p.vie) / TUNING.vieMax})`
      ferveur.style.transform = `scaleX(${p.ferveur / TUNING.ferveur.max})`
      for (const { r, el } of rites) {
        if (r.cost !== null) el.classList.toggle('off', p.ferveur < r.cost)
      }
      pips.forEach((pip, i) => {
        const fill = i < p.dodgeCharges ? 1 : i === p.dodgeCharges ? recharge * 0.6 : 0
        pip.style.transform = `scaleY(${fill})`
      })
      weapon.textContent = p.weapon === 'couperet' ? 'Couperet' : 'Masse'
      arme.classList.toggle('off', hostileNear)
    },
    dispose() {
      for (const u of unwatch) u()
      root.remove()
      style.remove()
    },
  }
}
