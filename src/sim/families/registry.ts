// Registre des familles de P0. Seul écrivain : l'orchestrateur, qui y ajoute chaque famille après fusion.
import type { FamilyRegistry } from '../types'
import { confesseur } from './confesseur'
import { souriant } from './souriant'

export const FAMILIES: FamilyRegistry = { souriant, confesseur }
