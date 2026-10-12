// Passe d'identification (B2 §12 I1) : chaque pixel porte l'id de l'entité visible et son rôle.
// Encodage RGBA 8 bits : R = id >> 8, G = id & 255, B = code du rôle, A = 255. Même géométrie et mêmes
// matrices que la passe couleur : seules les matières changent.
import { FrontSide, ShaderMaterial, type Side, Vector3 } from 'three'

export const ROLE = { aucun: 0, corps: 1, lisere: 2, marque: 3, sol: 4, decalque: 5, autre: 6 } as const
export type RoleCode = (typeof ROLE)[keyof typeof ROLE]
export const ROLE_NAMES: Readonly<Record<number, string>> = {
  0: 'aucun',
  1: 'corps',
  2: 'liseré',
  3: 'marque',
  4: 'sol',
  5: 'décalque',
  6: 'autre',
}

export const encodeId = (id: number, role: number): readonly [number, number, number] => [
  (id >> 8) & 255,
  id & 255,
  role & 255,
]
export const decodeId = (r: number, g: number, b: number): { id: number; role: number } => ({
  id: (r << 8) | g,
  role: b,
})

const VERTEX_INSTANCED = /* glsl */ `
attribute vec3 aId;
varying vec3 vId;
void main() {
  vId = aId;
  #include <begin_vertex>
  #include <project_vertex>
}`

const VERTEX_UNIFORM = /* glsl */ `
void main() {
  #include <begin_vertex>
  #include <project_vertex>
}`

const FRAGMENT_INSTANCED = /* glsl */ `
varying vec3 vId;
void main() { gl_FragColor = vec4(vId, 1.0); }`

const FRAGMENT_UNIFORM = /* glsl */ `
uniform vec3 uId;
void main() { gl_FragColor = vec4(uId, 1.0); }`

// Matière d'identification d'un lot instancié : l'id et le rôle viennent de l'attribut aId de chaque instance.
export const instancedIdMaterial = (side?: Side, depthWrite = true): ShaderMaterial =>
  new ShaderMaterial({
    vertexShader: VERTEX_INSTANCED,
    fragmentShader: FRAGMENT_INSTANCED,
    side: side ?? FrontSide,
    depthWrite,
  })

// Matière d'identification d'un objet unique (sol, télégraphe, sceau).
export const uniformIdMaterial = (id: number, role: number, depthWrite = true): ShaderMaterial => {
  const [r, g, b] = encodeId(id, role)
  return new ShaderMaterial({
    vertexShader: VERTEX_UNIFORM,
    fragmentShader: FRAGMENT_UNIFORM,
    uniforms: { uId: { value: new Vector3(r / 255, g / 255, b / 255) } },
    depthWrite,
  })
}
