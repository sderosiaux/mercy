// API du rendu, des entrées visuelles et des instruments de lecture (C4).
export { groundToUv, SCREEN_RIGHT, SCREEN_UP, uvToGround } from './camera'
export { chroma, deltaE00, hexToLab, type Lab, srgbToLab } from './color-science'
export { createHud, HUD_BAND_PX, type Hud } from './hud'
export { decodeId, encodeId, ROLE, ROLE_NAMES } from './idpass'
export { bodyClass } from './look'
export { cssVariables, hexCss, PALETTE } from './palette'
export {
  createRenderer,
  type EntityPose,
  type PixelImage,
  type RenderDebug,
  type Renderer,
  type RendererOptions,
  type RenderStats,
} from './renderer'
export { PLAYER_ID } from './rig'
