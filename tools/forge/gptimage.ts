// Planche de modèle par GPT Image, via le seul générateur autorisé : ~/.claude/scripts/generate_image.py.
// Le script ne prend qu'un texte (pas d'image de référence) : la planche de concept de art/concepts sert au
// jugement humain, le texte décrit le personnage. Le gabarit commun impose ce dont Meshy a besoin : trois vues
// séparées (face, profil, dos), A-pose, fond gris uni, mains vides. Le gore n'est pas demandé : le moteur le fait.
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AssetSheet } from './schema'

export const GENERATE_IMAGE_SCRIPT = join(homedir(), '.claude', 'scripts', 'generate_image.py')
export const SHEET_VIEWS = ['face', 'profil', 'dos'] as const

// Toute modification du gabarit change l'empreinte de toutes les planches : il fait partie des entrées.
export const SHEET_TEMPLATE =
  'Three-view character turnaround model sheet for 3D modeling. One single character drawn three times side by ' +
  'side at exactly the same scale: on the left a front view, in the middle a left side profile view, on the right ' +
  'a back view. Full body from the top of the head to the soles of the feet, each view complete and separated from ' +
  'the others by wide empty background, nothing overlapping, nothing cropped. Neutral A-pose: standing straight, ' +
  'arms held down and away from the body at about 40 degrees, hands open and empty, legs straight, feet apart at ' +
  'shoulder width. Orthographic camera at mid-body height, no perspective. Flat uniform medium grey studio ' +
  'background, soft even frontal lighting, no cast shadow, no floor, no scenery, no props in the hands, no text, ' +
  'no labels. Identical costume and details in the three views. Realistic dark medieval horror game character in ' +
  'the style of Diablo, detailed physically based materials. Character: {description}'

export const sheetPrompt = (sheet: AssetSheet): string =>
  SHEET_TEMPLATE.replace('{description}', sheet.planche.prompt)

export interface ImageCommand {
  readonly command: string
  readonly args: readonly string[]
}

export const buildImageCommand = (sheet: AssetSheet, outPath: string): ImageCommand => ({
  command: 'python3',
  args: [
    GENERATE_IMAGE_SCRIPT,
    sheetPrompt(sheet),
    outPath,
    '--size',
    sheet.planche.taille,
    '--model',
    sheet.planche.modele,
    '--quality',
    sheet.planche.qualite,
  ],
})

// Ce qui détermine la planche (hors chemin de sortie) : base de l'empreinte de l'étape concept.
export const imageDescriptor = (sheet: AssetSheet): Readonly<Record<string, unknown>> => ({
  script: 'generate_image.py',
  prompt: sheetPrompt(sheet),
  taille: sheet.planche.taille,
  modele: sheet.planche.modele,
  qualite: sheet.planche.qualite,
})

export interface RunResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}
export type CommandRunner = (cmd: ImageCommand) => Promise<RunResult>

export const spawnRunner: CommandRunner = (cmd) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd.command, [...cmd.args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => {
      stdout += String(d)
    })
    child.stderr.on('data', (d) => {
      stderr += String(d)
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
  })
