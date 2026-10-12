// Câblage de la boucle, des entrées, du rendu et de l'audio : tâche C8. Pour l'instant, la page charge la simulation.
import { TICK_HZ } from './sim/index'

const canvas = document.getElementById('view')
if (canvas instanceof HTMLCanvasElement) canvas.dataset.tickHz = String(TICK_HZ)
