/** Small, self-contained 4-bit IMA ADPCM wire codec for 24 kHz mono speech. */
const STEPS = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31,
  34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143,
  157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544,
  598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707,
  1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871,
  5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
  15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
] as const;
const INDEX_CHANGE = [-1, -1, -1, -1, 2, 4, 6, 8] as const;
export const AUDIO_CODEC = "ima_adpcm4_24000_mono";

/** Returns a versioned frame; only caller-negotiated speech should use this codec. */
export function encodeAdpcm4(pcm: Uint8Array): Uint8Array {
  if (!pcm.length || pcm.length % 2 || pcm.length > 2_400_000) throw new Error("invalid_pcm");
  const samples = pcm.length / 2;
  const output = new Uint8Array(12 + Math.ceil((samples - 1) / 2));
  output.set([0x43, 0x34, 0x41, 0x31]); // "C4A1" version 1
  new DataView(output.buffer).setUint32(4, samples, true);
  let predictor = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength).getInt16(0, true);
  new DataView(output.buffer).setInt16(8, predictor, true);
  let stepIndex = 0;
  for (let sampleIndex = 1; sampleIndex < samples; sampleIndex++) {
    const sample = (pcm[sampleIndex * 2] | (pcm[sampleIndex * 2 + 1] << 8)) << 16 >> 16;
    const step = STEPS[stepIndex];
    const negative = sample < predictor;
    let difference = Math.abs(sample - predictor);
    let delta = 0;
    if (difference >= step) { delta |= 4; difference -= step; }
    if (difference >= (step >> 1)) { delta |= 2; difference -= step >> 1; }
    if (difference >= (step >> 2)) delta |= 1;
    const differenceApplied = (step >> 3) + ((delta & 4) ? step : 0) +
      ((delta & 2) ? step >> 1 : 0) + ((delta & 1) ? step >> 2 : 0);
    predictor = Math.max(-32768, Math.min(32767, predictor + (negative ? -differenceApplied : differenceApplied)));
    stepIndex = Math.max(0, Math.min(88, stepIndex + INDEX_CHANGE[delta]));
    const nibble = delta | (negative ? 8 : 0);
    const packedIndex = sampleIndex - 1;
    output[12 + (packedIndex >> 1)] |= nibble << ((packedIndex & 1) * 4);
  }
  return output;
}
