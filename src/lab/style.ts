// Habillage du laboratoire : couleurs de la palette seulement.
import { cssVariables } from '../render/index'

const style = document.createElement('style')
style.textContent = `
:root { ${cssVariables()}; }
body { background: var(--noir); color: var(--hud-encre);
  font-family: 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif; }
.lab-label { position: absolute; top: 10px; left: 14px; font-size: 13px; font-style: italic; opacity: 0.75;
  pointer-events: none; }
.lab-list { max-width: 64ch; margin: 48px auto; line-height: 1.6; }
.lab-list h1 { font-weight: normal; font-size: 28px; }
.lab-list a { color: var(--ivoire); }
.lab-list code { color: var(--or); }
.lab-out { position: absolute; left: 0; right: 0; bottom: 0; max-height: 40vh; overflow: auto; margin: 0;
  padding: 8px 14px; font-size: 11px; white-space: pre-wrap; word-break: break-all; background: var(--noir); }
`
document.head.append(style)
