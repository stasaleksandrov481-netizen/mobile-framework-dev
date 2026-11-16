import assert from "node:assert/strict";
import test from "node:test";
import { AUDIO_CODEC, encodeAdpcm4 } from "./audio.ts";

function decodeForTest(encoded: Uint8Array): Int16Array {
  assert.equal(new TextDecoder().decode(encoded.slice(0, 4)), "C4A1");
  const sampleCount = new DataView(encoded.buffer, encoded.byteOffset).getUint32(4, true);
  const out = new Int16Array(sampleCount);
  let sample = new DataView(encoded.buffer, encoded.byteOffset).getInt16(8, true);
  let index = 0;
  out[0] = sample;
  const stepTable = [7,8,9,10,11,12,13,14,16,17,19,21,23,25,28,31,34,37,41,45,50,55,60,66,73,80,88,97,107,118,130,143,157,173,190,209,230,253,279,307,337,371,408,449,494,544,598,658,724,796,876,963,1060,1166,1282,1411,1552,1707,1878,2066,2272,2499,2749,3024,3327,3660,4026,4428,4871,5358,5894,6484,7132,7845,8630,9493,10442,11487,12635,13899,15289,16818,18500,20350,22385,24623,27086,29794,32767];
  const change = [-1, -1, -1, -1, 2, 4, 6, 8];
  for (let i = 1; i < sampleCount; i++) {
    const n = i - 1;
    const code = (encoded[12 + (n >> 1)] >> ((n & 1) * 4)) & 15;
    const step = stepTable[index];
    const magnitude = code & 7;
    const delta = (step >> 3) + ((magnitude & 4) ? step : 0) +
      ((magnitude & 2) ? step >> 1 : 0) + ((magnitude & 1) ? step >> 2 : 0);
    sample = Math.max(-32768, Math.min(32767, sample + (code & 8 ? -delta : delta)));
    index = Math.max(0, Math.min(88, index + change[magnitude]));
    out[i] = sample;
  }
  return out;
}

test("4-bit speech codec retains length, channel format and bounded waveform error", () => {
  assert.equal(AUDIO_CODEC, "ima_adpcm4_24000_mono");
  const samples = new Int16Array(24_000);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.round(14000 * Math.sin(i * Math.PI * 2 * 320 / 24000));
  const pcm = new Uint8Array(samples.length * 2);
  const view = new DataView(pcm.buffer);
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i], true);
  const compressed = encodeAdpcm4(pcm);
  const replay = decodeForTest(compressed);
  assert.equal(compressed.byteLength, 12_012);
  assert.equal(replay.length, samples.length);
  const error = samples.reduce((sum, original, i) => sum + Math.abs(original - replay[i]), 0) / samples.length;
  assert.ok(error < 2000, `Average amplitude error too high: ${error}`);
});

test("4-bit speech codec bounds input and supports negative initial samples", () => {
  const pcm = Uint8Array.from([0, 128, 127, 127, 0, 0, 0, 128]);
  const frame = encodeAdpcm4(pcm);
  assert.equal(decodeForTest(frame)[0], -32768);
  assert.throws(() => encodeAdpcm4(new Uint8Array()), /invalid_pcm/);
  assert.throws(() => encodeAdpcm4(new Uint8Array(3)), /invalid_pcm/);
  assert.throws(() => encodeAdpcm4(new Uint8Array(2_400_002)), /invalid_pcm/);
});
