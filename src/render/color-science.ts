// Colorimétrie des mesures de B2 (§5, conventions) : sRGB D65 → CIELAB, chroma C*, écart CIEDE2000 (Sharma 2005).
// Sert aux tests de la palette et aux mesures du laboratoire de rendu.

export interface Lab {
  readonly L: number
  readonly a: number
  readonly b: number
}

const toLinear = (c8: number): number => {
  const c = c8 / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)

// Blanc de référence D65 (2°).
const XN = 0.95047
const YN = 1
const ZN = 1.08883

export const srgbToLab = (r8: number, g8: number, b8: number): Lab => {
  const r = toLinear(r8)
  const g = toLinear(g8)
  const b = toLinear(b8)
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b
  const fx = f(x / XN)
  const fy = f(y / YN)
  const fz = f(z / ZN)
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) }
}

export const hexToLab = (hex: number): Lab => srgbToLab((hex >> 16) & 255, (hex >> 8) & 255, hex & 255)

export const chroma = (c: Lab): number => Math.hypot(c.a, c.b)

const deg = (r: number): number => (r * 180) / Math.PI
const rad = (d: number): number => (d * Math.PI) / 180

const hueDeg = (b: number, a: number): number => {
  if (a === 0 && b === 0) return 0
  const v = deg(Math.atan2(b, a))
  return v < 0 ? v + 360 : v
}

// CIEDE2000, kL = kC = kH = 1.
export const deltaE00 = (p: Lab, q: Lab): number => {
  const Cm = (Math.hypot(p.a, p.b) + Math.hypot(q.a, q.b)) / 2
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)))
  const a1 = (1 + G) * p.a
  const a2 = (1 + G) * q.a
  const c1 = Math.hypot(a1, p.b)
  const c2 = Math.hypot(a2, q.b)
  const h1 = hueDeg(p.b, a1)
  const h2 = hueDeg(q.b, a2)
  const dL = q.L - p.L
  const dC = c2 - c1
  let dh = 0
  if (c1 * c2 !== 0) {
    dh = h2 - h1
    if (dh > 180) dh -= 360
    else if (dh < -180) dh += 360
  }
  const dH = 2 * Math.sqrt(c1 * c2) * Math.sin(rad(dh / 2))
  const Lm = (p.L + q.L) / 2
  const cm = (c1 + c2) / 2
  let hm = h1 + h2
  if (c1 * c2 !== 0) {
    if (Math.abs(h1 - h2) <= 180) hm = (h1 + h2) / 2
    else hm = h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2
  }
  const T =
    1 -
    0.17 * Math.cos(rad(hm - 30)) +
    0.24 * Math.cos(rad(2 * hm)) +
    0.32 * Math.cos(rad(3 * hm + 6)) -
    0.2 * Math.cos(rad(4 * hm - 63))
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2))
  const Rc = 2 * Math.sqrt(cm ** 7 / (cm ** 7 + 25 ** 7))
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2)
  const Sc = 1 + 0.045 * cm
  const Sh = 1 + 0.015 * cm * T
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh))
}
