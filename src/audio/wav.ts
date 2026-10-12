// WAV PCM 16 bits : format de la banque (aucun délai de codec au décodage) et des extraits du banc (B5 I7).

export const toPcm16 = (x: number): number => {
  const c = Math.max(-1, Math.min(1, x))
  return Math.round(c < 0 ? c * 0x8000 : c * 0x7fff)
}

export const fromPcm16 = (v: number): number => (v < 0 ? v / 0x8000 : v / 0x7fff)

// Quantifie comme le fichier écrit, pour mesurer dans le script exactement ce que le navigateur décodera.
export const quantize16 = (ch: Float32Array): Float32Array => ch.map((x) => fromPcm16(toPcm16(x)))

export const encodeWav = (channels: readonly Float32Array[], sampleRate: number): Uint8Array => {
  const nch = channels.length
  const frames = channels[0]?.length ?? 0
  const dataBytes = frames * nch * 2
  const buf = new ArrayBuffer(44 + dataBytes)
  const v = new DataView(buf)
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + dataBytes, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, nch, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * nch * 2, true)
  v.setUint16(32, nch * 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, dataBytes, true)
  let o = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < nch; c++) {
      v.setInt16(o, toPcm16((channels[c] as Float32Array)[i] as number), true)
      o += 2
    }
  }
  return new Uint8Array(buf)
}
