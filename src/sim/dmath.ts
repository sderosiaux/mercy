// Maths déterministes d'un moteur JS à l'autre (requête C7 R1).
// Math.sin, cos, atan2, hypot et ** sont « approximés par l'implémentation » : Chrome et Node diffèrent parfois
// d'un ulp, et un monde rejoué ailleurs diverge. Ici, seules + − × ÷ et Math.sqrt servent : IEEE 754 les arrondit
// au plus près, donc le résultat est identique partout. Noyaux et coefficients repris de fdlibm (FreeBSD libm).

// Réduction de Cody-Waite par π/2, suffisante pour les angles du jeu (|x| ≤ 1e5).
const INV_PIO2 = 0.6366197723675814
const PIO2_1 = 1.5707963267341256
const PIO2_1T = 6.077100506506192e-11

const S1 = -0.16666666666666632
const S2 = 0.00833333333332249
const S3 = -0.0001984126982985795
const S4 = 2.7557313707070068e-6
const S5 = -2.5050760253406863e-8
const S6 = 1.58969099521155e-10

const C1 = 0.0416666666666666
const C2 = -0.001388888888887411
const C3 = 2.480158728947673e-5
const C4 = -2.7557314351390663e-7
const C5 = 2.087572321298175e-9
const C6 = -1.1359647557788195e-11

// Noyaux valables sur [−π/4, π/4].
const kSin = (x: number): number => {
  const z = x * x
  return x + x * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))))
}
const kCos = (x: number): number => {
  const z = x * x
  return 1 - 0.5 * z + z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))))
}

const reduce = (x: number): readonly [number, number] => {
  const n = Math.round(x * INV_PIO2)
  return [x - n * PIO2_1 - n * PIO2_1T, ((n % 4) + 4) % 4]
}

export const dsin = (x: number): number => {
  if (x === 0) return x
  const [r, q] = reduce(x)
  switch (q) {
    case 0:
      return kSin(r)
    case 1:
      return kCos(r)
    case 2:
      return -kSin(r)
    default:
      return -kCos(r)
  }
}

export const dcos = (x: number): number => {
  const [r, q] = reduce(x)
  switch (q) {
    case 0:
      return kCos(r)
    case 1:
      return -kSin(r)
    case 2:
      return -kCos(r)
    default:
      return kSin(r)
  }
}

const ATANHI = [0.4636476090008061, 0.7853981633974483, 0.982793723247329, 1.5707963267948966]
const ATANLO = [2.2698777452961687e-17, 3.061616997868383e-17, 1.3903311031230998e-17, 6.123233995736766e-17]
const AT = [
  0.3333333333333293, -0.19999999999876483, 0.14285714272503466, -0.11111110405462356, 0.09090887133436507,
  -0.0769187620504483, 0.06661073137387531, -0.058335701337905735, 0.049768779946159324,
  -0.036531572744216916, 0.016285820115365782,
] as const

const at = (i: number): number => AT[i] as number

export const datan = (x: number): number => {
  const neg = x < 0
  let t = neg ? -x : x
  let id = -1
  if (t >= 0.4375) {
    if (t < 1.1875) {
      if (t < 0.6875) {
        id = 0
        t = (2 * t - 1) / (2 + t)
      } else {
        id = 1
        t = (t - 1) / (t + 1)
      }
    } else if (t < 2.4375) {
      id = 2
      t = (t - 1.5) / (1 + 1.5 * t)
    } else {
      id = 3
      t = -1 / t
    }
  }
  const z = t * t
  const w = z * z
  const s1 = z * (at(0) + w * (at(2) + w * (at(4) + w * (at(6) + w * (at(8) + w * at(10))))))
  const s2 = w * (at(1) + w * (at(3) + w * (at(5) + w * (at(7) + w * at(9)))))
  if (id < 0) {
    const r = t - t * (s1 + s2)
    return neg ? -r : r
  }
  const r = (ATANHI[id] as number) - (t * (s1 + s2) - (ATANLO[id] as number) - t)
  return neg ? -r : r
}

const PI = 3.141592653589793
const PI_2 = 1.5707963267948966

export const datan2 = (y: number, x: number): number => {
  if (x === 0) return y > 0 ? PI_2 : y < 0 ? -PI_2 : 0
  const a = datan(y / x)
  if (x > 0) return a
  return y < 0 ? a - PI : a + PI
}

export const dhypot = (x: number, z: number): number => Math.sqrt(x * x + z * z)

// Puissance entière par multiplications successives (k ≥ 0).
export const dpowInt = (base: number, k: number): number => {
  let r = 1
  for (let i = 0; i < k; i++) r *= base
  return r
}
