// Banc d'essai : une fiche et une figurine construites en code, sans service. Les tests valident chaque contrôle
// dessus ; la galerie l'affiche pour montrer la recette de lecture et le rapport quand aucun modèle n'existe encore.
// Ce n'est pas un asset du jeu : rien n'en sort vers public/models.
import { buildFigure, REFERENCE_HEIGHT_M } from './gltf/build'
import { hit, idle, rise, strike, walkInPlace } from './gltf/fixtures'
import type { Glb } from './gltf/glb'
import { type AssetSheet, parseAsset } from './schema'

const noSource = { kind: 'aucune' }
const motion = (prompt: string) => ({ kind: 'mouvement', prompt, dureeS: 2, mode: 'swift' })

export const bancSheetRaw = (): Record<string, unknown> => ({
  id: 'banc',
  nom: 'Figurine de banc',
  famille: 'souriant',
  hauteurM: REFERENCE_HEIGHT_M,
  reference: { planche: 'art/concepts/creatures-souriant-recousu.png', zone: 'aucune : figurine de test' },
  planche: { prompt: 'test figurine', taille: '1536x1024', qualite: 'low', modele: 'flare' },
  modele: { source: 'multi-image', aiModel: 'meshy-7.1', textureResolution: '2k', pbr: true },
  budgets: { triangles: 1000, texturePx: 1024 },
  squelette: 'humanoide',
  interruption: { reaction: 'reaction' },
  clips: [
    {
      etat: 'rituel',
      type: 'boucle',
      source: motion('idle'),
      boucle: true,
      surPlace: true,
      note: 'boucle sans couture',
    },
    {
      etat: 'marche',
      type: 'boucle',
      source: motion('walk in place'),
      boucle: true,
      surPlace: false,
      locomotion: { vitesse: 'souriant.speed' },
      note: 'foulée calée sur la vitesse du Souriant',
    },
    {
      etat: 'attaque',
      type: 'attaque',
      source: motion('strike'),
      boucle: false,
      surPlace: true,
      temps: { action: 'morsure' },
      effecteur: 'mainDroite',
      note: 'impact calé sur le tick actif de la morsure',
    },
    {
      etat: 'reaction',
      type: 'reaction',
      source: motion('hit'),
      boucle: false,
      surPlace: true,
      note: 'coupe l’attaque',
    },
    {
      etat: 'relevement',
      type: 'transition',
      source: motion('rise'),
      boucle: false,
      surPlace: false,
      temps: { fenetre: ['relevementTelegraph'] },
      note: 'Relèvement calé sur son télégraphe',
    },
    {
      etat: 'mort',
      type: 'figee',
      source: noSource,
      boucle: false,
      surPlace: false,
      note: 'pose courante figée',
    },
  ],
})

export const bancSheet = (): AssetSheet => parseAsset(bancSheetRaw())

export const bancFigure = (): Glb =>
  buildFigure({
    clips: [idle('rituel'), walkInPlace('marche'), strike('attaque'), hit('reaction'), rise('relevement')],
  })
