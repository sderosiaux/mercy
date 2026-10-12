// API publique du module audio (tâche C5). Le jeu (C8) appelle createAudio().resume() après le clic de l'écran
// titre, puis update(world, joueur) après chaque step. Les outils de dev (C7) branchent log(), renderOffline(),
// analyseBank() et runLive() sur window.__mercy.
export { analyseBank, type BankAnalysis } from './analyse-bank'
export { fetchManifest, loadBank } from './bank'
export {
  type BenchResult,
  type EventJournal,
  excerpt,
  masterWav,
  renderOffline,
  type TickInfo,
} from './bench'
export * from './constants'
export type { Cmd, Phase, Pools, SourceKind } from './director'
export { type AudioEngine, createAudio, createAudioEngine, type GameAudio, poolsOf } from './engine'
export type { AudioLog, Bank, LogFrame, LogOneShot, LogSource } from './graph'
export { type LiveResult, runLive } from './live'
export type { Manifest, ManifestEntry, Role } from './manifest'
export { levelDb, METER_INPUTS, type MeterInput, type MeterTables } from './meter'
export type { O11Row } from './o11'
export { encodeWav } from './wav'
