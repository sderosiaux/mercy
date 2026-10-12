// Registre des familles de P0. Seul écrivain : l'orchestrateur, qui y ajoute chaque famille après fusion.
import type { FamilyRegistry } from '../types'
import { chirurgien } from './chirurgien'
import { confesseur } from './confesseur'
import { porteur } from './porteur'
import { recousu } from './recousu'
import { souriant } from './souriant'

export const FAMILIES: FamilyRegistry = { souriant, porteur, recousu, chirurgien, confesseur }
