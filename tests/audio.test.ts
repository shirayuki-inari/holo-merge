import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { BGM_TRACKS, BgmPlayer, chooseBgmTrack } from "../src/audio/bgm.ts";

class FakeAudio extends EventTarget {
  src = "";
  preload = "";
  loop = false;
  volume = 1;
  paused = true;
  playCalls = 0;
  loads = 0;
  blocked = false;
  pending: Promise<void> | null = null;
  play() {
    this.playCalls++;
    if (this.blocked)
      return Promise.reject(
        new DOMException("Gesture required", "NotAllowedError"),
      );
    this.paused = false;
    return this.pending ?? Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  load() {
    this.loads++;
  }
}
class FakeDocument extends EventTarget {
  hidden = false;
}
class FakeElement extends EventTarget {
  closest() {
    return null;
  }
}
class FakeKeyboardEvent extends Event {
  repeat = false;
  ctrlKey = false;
  metaKey = false;
  altKey = false;
  key = " ";
}

const asAudio = (audio: FakeAudio) => audio as unknown as HTMLAudioElement;
describe("BGM lifecycle", () => {
  let documentMock: FakeDocument;
  let recordings: FakeAudio[];
  let originals: Map<string, PropertyDescriptor | undefined>;
  beforeEach(() => {
    documentMock = new FakeDocument();
    recordings = [];
    const globals = {
      document: documentMock,
      Element: FakeElement,
      KeyboardEvent: FakeKeyboardEvent,
      Audio: class extends FakeAudio {
        constructor(source: string) {
          super();
          this.src = source;
          recordings.push(this);
        }
      },
    };
    originals = new Map(
      Object.keys(globals).map((key) => [
        key,
        Object.getOwnPropertyDescriptor(globalThis, key),
      ]),
    );
    for (const [key, value] of Object.entries(globals))
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });
  });
  afterEach(() => {
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  test("each random choice selects one of the three copied MP3 assets", () => {
    assert.equal(new Set(BGM_TRACKS).size, 3);
    BGM_TRACKS.forEach((source) => assert.ok(existsSync(`public${source}`)));
    assert.equal(
      chooseBgmTrack(() => 0),
      BGM_TRACKS[0],
    );
    assert.equal(
      chooseBgmTrack(() => 0.5),
      BGM_TRACKS[1],
    );
    assert.equal(
      chooseBgmTrack(() => 0.9999),
      BGM_TRACKS[2],
    );
  });
  test("blocked autoplay waits for an interaction and retries the same looping track", async () => {
    const audio = new FakeAudio();
    audio.blocked = true;
    const player = new BgmPlayer(asAudio(audio), {
      source: BGM_TRACKS[1],
      enabled: true,
      suspended: false,
    });
    await Promise.resolve();
    assert.equal(audio.paused, true);
    audio.blocked = false;
    documentMock.dispatchEvent(new Event("pointerdown"));
    await Promise.resolve();
    assert.equal(audio.paused, false);
    assert.equal(audio.src, BGM_TRACKS[1]);
    assert.equal(audio.loop, true);
    assert.equal(audio.volume, 0.35);
    const calls = audio.playCalls;
    documentMock.dispatchEvent(new Event("pointerdown"));
    assert.equal(
      audio.playCalls,
      calls,
      "ordinary clicks do not restart an active track",
    );
    player.destroy();
  });
  test("an explicit off preference survives gestures and late play completion", async () => {
    const audio = new FakeAudio();
    const player = new BgmPlayer(asAudio(audio), {
      source: BGM_TRACKS[0],
      enabled: false,
      suspended: false,
    });
    documentMock.dispatchEvent(new Event("pointerdown"));
    assert.equal(audio.playCalls, 0);
    let finish!: () => void;
    audio.pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    player.setEnabled(true);
    assert.equal(audio.paused, false);
    player.setEnabled(false);
    finish();
    await Promise.resolve();
    assert.equal(audio.paused, true);
    documentMock.dispatchEvent(new Event("pointerdown"));
    assert.equal(audio.playCalls, 1);
    player.destroy();
  });
  test("manual pause and background suspend playback without changing the enabled preference", async () => {
    const audio = new FakeAudio();
    const player = new BgmPlayer(asAudio(audio), {
      source: BGM_TRACKS[2],
      enabled: true,
      suspended: false,
    });
    player.setSuspended(true);
    assert.equal(audio.paused, true);
    documentMock.dispatchEvent(new Event("pointerdown"));
    assert.equal(audio.paused, true);
    player.setSuspended(false);
    assert.equal(audio.paused, false);
    documentMock.hidden = true;
    documentMock.dispatchEvent(new Event("visibilitychange"));
    assert.equal(audio.paused, true);
    documentMock.hidden = false;
    documentMock.dispatchEvent(new Event("visibilitychange"));
    assert.equal(audio.paused, false);
    player.setEnabled(false);
    player.setSuspended(true);
    player.setSuspended(false);
    assert.equal(audio.paused, true, "resuming a game never overrides off");
    await Promise.resolve();
    player.destroy();
  });
  test("cleanup releases audio and an older player cannot pause a replacement", async () => {
    const audio = new FakeAudio();
    let finish!: () => void;
    audio.pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const first = new BgmPlayer(asAudio(audio), {
      source: BGM_TRACKS[0],
      enabled: true,
      suspended: false,
    });
    first.destroy();
    assert.equal(audio.src, "");
    assert.equal(audio.paused, true);
    assert.equal(audio.loads, 1);
    audio.pending = null;
    const replacement = new BgmPlayer(asAudio(audio), {
      source: BGM_TRACKS[1],
      enabled: true,
      suspended: false,
    });
    finish();
    await Promise.resolve();
    assert.equal(audio.paused, false);
    replacement.destroy();
    const count = audio.playCalls;
    documentMock.dispatchEvent(new Event("pointerdown"));
    documentMock.dispatchEvent(new Event("visibilitychange"));
    assert.equal(audio.playCalls, count);
  });
});
