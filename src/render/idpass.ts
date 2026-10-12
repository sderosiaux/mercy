// Passe d'identification (B2 §12 I1) : chaque pixel porte l'id de l'entité visible et son rôle.
// Encodage RGBA 8 bits : R = id >> 8, G = id & 255, B = code du rôle, A = 255. Même géométrie et mêmes
// matrices que la passe couleur : seules les matières changent.
//
// Elle montre ce que montre l'image (arbitrage E4) : chaque objet y est dessiné dans le même ordre (scène, puis
// profondeur effacée, puis la couche des signaux en quatre passes : renderer.ts) et avec le même test de profondeur
// que sa matière couleur — état matériel recopié à chaque image (`idMaterialFor`), test contre la profondeur de la
// scène construit avec la même fonction GLSL (`sceneDepth`, shaders.ts), même découpe du décor, même seuil
// d'alpha. Là où un télégraphe couvre un mort à l'écran, le pixel est au télégraphe.
import {
  FrontSide,
  type Material,
  type Mesh,
  NoBlending,
  ShaderMaterial,
  type Side,
  type Texture,
  Vector3,
} from 'three'
import { cutUniforms, overlayUniforms } from './materials'
import { CUT_GLSL, DEPTH_TEST_GLSL, SCENE_DEPTH_CALL, type SceneDepth } from './shaders'

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

// Options d'une matière d'identification : ce que sa matière couleur fait au fragment, hors couleur.
export interface IdOptions {
  readonly side?: Side
  readonly depthWrite?: boolean
  readonly sceneDepth?: SceneDepth // couche des signaux : test contre la profondeur de la scène
  readonly cut?: boolean // décor découpé entre la caméra et le joueur (§20)
  readonly alphaMap?: { readonly map: Texture; readonly test: number } // seuil d'alpha d'une texture (bannières)
}

const vertex = (instanced: boolean, o: IdOptions): string => /* glsl */ `
${instanced ? 'attribute vec3 aId;\nvarying vec3 vId;' : ''}
${o.cut ? 'varying vec3 vIdWorld;' : ''}
${o.alphaMap ? 'varying vec2 vIdUv;' : ''}
void main() {
  ${instanced ? 'vId = aId;' : ''}
  ${o.alphaMap ? 'vIdUv = uv;' : ''}
  #include <begin_vertex>
  #include <project_vertex>
  ${
    o.cut
      ? `{
    vec4 w = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      w = instanceMatrix * w;
    #endif
    vIdWorld = ( modelMatrix * w ).xyz;
  }`
      : ''
  }
}`

const fragment = (instanced: boolean, o: IdOptions): string => {
  const depth = o.sceneDepth ?? 'aucun'
  return /* glsl */ `
${instanced ? 'varying vec3 vId;' : 'uniform vec3 uId;'}
${depth !== 'aucun' ? DEPTH_TEST_GLSL : ''}
${o.cut ? `${CUT_GLSL}\nvarying vec3 vIdWorld;` : ''}
${o.alphaMap ? `uniform sampler2D uIdAlphaMap;\nvarying vec2 vIdUv;` : ''}
void main() {
  ${SCENE_DEPTH_CALL[depth]}
  ${o.cut ? 'e1Cut( vIdWorld );' : ''}
  ${o.alphaMap ? `if ( texture2D( uIdAlphaMap, vIdUv ).a < ${o.alphaMap.test.toFixed(4)} ) discard;` : ''}
  gl_FragColor = vec4( ${instanced ? 'vId' : 'uId'}, 1.0 );
}`
}

const uniformsFor = (o: IdOptions): Record<string, { value: unknown }> => ({
  ...((o.sceneDepth ?? 'aucun') !== 'aucun' ? overlayUniforms : {}),
  ...(o.cut ? cutUniforms : {}),
  ...(o.alphaMap ? { uIdAlphaMap: { value: o.alphaMap.map } } : {}),
})

// Matière d'identification d'un lot instancié : l'id et le rôle viennent de l'attribut aId de chaque instance.
export const instancedIdMaterial = (o: IdOptions = {}): ShaderMaterial =>
  new ShaderMaterial({
    vertexShader: vertex(true, o),
    fragmentShader: fragment(true, o),
    uniforms: uniformsFor(o),
    side: o.side ?? FrontSide,
    depthWrite: o.depthWrite ?? true,
  })

// Matière d'identification d'un objet unique (sol, télégraphe, sceau, décor).
export const uniformIdMaterial = (id: number, role: number, o: IdOptions = {}): ShaderMaterial => {
  const [r, g, b] = encodeId(id, role)
  return new ShaderMaterial({
    vertexShader: vertex(false, o),
    fragmentShader: fragment(false, o),
    uniforms: { ...uniformsFor(o), uId: { value: new Vector3(r / 255, g / 255, b / 255) } },
    side: o.side ?? FrontSide,
    depthWrite: o.depthWrite ?? true,
  })
}

// Matière avec laquelle la passe d'identification dessine un objet (null : objet absent de la passe). Son état de
// rendu est celui de la matière couleur de l'objet, recopié à chaque image : test et écriture de profondeur (un
// télégraphe ignore la profondeur des morts), gabarit (liseré des modèles), faces, décalage de polygones (décalques),
// liste opaque ou transparente (même ordre de dessin). Jamais de mélange : un pixel porte un seul id.
export const idMaterialFor = (o: Mesh): ShaderMaterial | null => {
  const idm = o.userData.idMaterial as ShaderMaterial | undefined
  if (!idm) return null
  const src = o.material as Material
  if (idm === (src as unknown)) return idm // masque de silhouette : sa propre matière (aucune couleur écrite)
  idm.depthTest = src.depthTest
  idm.depthWrite = src.depthWrite
  idm.depthFunc = src.depthFunc
  idm.side = src.side
  idm.colorWrite = src.colorWrite
  idm.stencilWrite = src.stencilWrite
  idm.stencilFunc = src.stencilFunc
  idm.stencilRef = src.stencilRef
  idm.stencilFuncMask = src.stencilFuncMask
  idm.stencilWriteMask = src.stencilWriteMask
  idm.stencilFail = src.stencilFail
  idm.stencilZFail = src.stencilZFail
  idm.stencilZPass = src.stencilZPass
  idm.polygonOffset = src.polygonOffset
  idm.polygonOffsetFactor = src.polygonOffsetFactor
  idm.polygonOffsetUnits = src.polygonOffsetUnits
  idm.transparent = src.transparent
  idm.blending = NoBlending
  return idm
}
