// Shipped audio is validated from the files themselves: MP3 frame headers give
// format and duration, and the PCM sources prove no recording is silent.
// Real browser decoding/playback is covered by the character-audio, settings
// and release browser tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import voices from "../src/audio/character-voices.json" with { type: "json" };
import { BGM_TRACKS } from "../src/audio/bgm.ts";

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG-1
  2: [22050, 24000, 16000], // MPEG-2
  0: [11025, 12000, 8000], // MPEG-2.5
};
/** Walk every MPEG audio layer III frame; throws on any corrupt header. */
function parseMp3(path: string) {
  const data = readFileSync(path);
  let offset = 0;
  if (data.subarray(0, 3).toString("latin1") === "ID3") {
    const size =
      ((data[6] & 0x7f) << 21) |
      ((data[7] & 0x7f) << 14) |
      ((data[8] & 0x7f) << 7) |
      (data[9] & 0x7f);
    offset = 10 + size;
  }
  let frames = 0,
    samples = 0,
    sampleRate = 0,
    mono = true;
  while (offset + 4 <= data.length) {
    if (data.subarray(offset, offset + 3).toString("latin1") === "TAG") break; // ID3v1
    const header = data.readUInt32BE(offset);
    assert.equal(header >>> 21, 0x7ff, `${path}: frame sync at byte ${offset}`);
    const version = (header >>> 19) & 3;
    const layer = (header >>> 17) & 3;
    assert.notEqual(version, 1, `${path}: reserved MPEG version`);
    assert.equal(layer, 1, `${path}: not layer III`);
    const bitrate = (version === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3)[
      (header >>> 12) & 15
    ];
    const rate = SAMPLE_RATES[version][(header >>> 10) & 3];
    assert.ok(bitrate && rate, `${path}: invalid header at byte ${offset}`);
    const padding = (header >>> 9) & 1;
    const perFrame = version === 3 ? 1152 : 576;
    const length = Math.floor(((perFrame / 8) * bitrate * 1000) / rate) + padding;
    assert.ok(offset + length <= data.length + 1, `${path}: truncated frame`);
    sampleRate ||= rate;
    assert.equal(rate, sampleRate, `${path}: sample rate changes mid-file`);
    mono &&= ((header >>> 6) & 3) === 3;
    frames++;
    samples += perFrame;
    offset += length;
  }
  assert.ok(frames > 1, `${path}: no audio frames`);
  // The first frame of a LAME file is the Xing/Info header and holds no audio.
  return { frames, sampleRate, mono, duration: (samples - 1152) / sampleRate };
}
/** Mean energy of a 16-bit PCM WAV, normalised to [-1, 1] samples. */
function wavEnergy(path: string) {
  const data = readFileSync(path);
  assert.equal(data.subarray(0, 4).toString("latin1"), "RIFF");
  assert.equal(data.subarray(8, 12).toString("latin1"), "WAVE");
  let offset = 12;
  while (offset + 8 <= data.length) {
    const id = data.subarray(offset, offset + 4).toString("latin1");
    const size = data.readUInt32LE(offset + 4);
    if (id === "data") {
      let energy = 0;
      const count = Math.floor(size / 2);
      for (let i = 0; i < count; i++) {
        const value = data.readInt16LE(offset + 8 + i * 2) / 32768;
        energy += value * value;
      }
      return energy / count;
    }
    offset += 8 + size + (size & 1);
  }
  throw new Error(`${path}: no data chunk`);
}

const events = ["drop", "merge", "win"] as const;
type Clip = { src: string; durationSeconds: number };
test("every character voice is a valid 48 kHz mono MP3 of the recorded length and not silent", () => {
  let clips = 0;
  for (const [id, role] of Object.entries(voices) as [
    string,
    Partial<Record<(typeof events)[number], Clip>>,
  ][])
    for (const event of events) {
      const clip = role[event];
      if (!clip) continue;
      clips++;
      const mp3 = parseMp3("public" + clip.src);
      assert.equal(mp3.sampleRate, 48000, clip.src);
      assert.ok(mp3.mono, `${clip.src}: mono`);
      // Encoder delay/padding adds a few milliseconds; truncation would not.
      assert.ok(
        Math.abs(mp3.duration - clip.durationSeconds) < 0.1,
        `${clip.src}: ${mp3.duration.toFixed(3)}s vs ${clip.durationSeconds}s`,
      );
      const energy = wavEnergy(`assets/character-voices/wav/${id}/${event}.wav`);
      assert.ok(energy > 1e-7, `${id}/${event}: silent source (${energy})`);
    }
  assert.ok(clips > 0);
});

test("every background track is a valid MP3 longer than a minute", () => {
  assert.equal(BGM_TRACKS.length, 3);
  for (const source of BGM_TRACKS) {
    const mp3 = parseMp3("public" + source);
    assert.ok(mp3.duration > 60, `${source}: ${mp3.duration}s`);
  }
});
