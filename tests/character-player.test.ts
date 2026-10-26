import { beforeEach, afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { CharacterEffectsPlayer } from "../src/audio/character-effects.ts";
class FakeDocument extends EventTarget {
  hidden = false;
}
class FakeKeyboardEvent extends Event {
  repeat = false;
  ctrlKey = false;
  metaKey = false;
  altKey = false;
  key = " ";
}
class FakeSource {
  buffer: { source: string } | null = null;
  started = false;
  stopped = false;
  onended: (() => void) | null = null;
  connect() {}
  disconnect() {}
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}
class FakeContext {
  state = "suspended";
  destination = {};
  sources: FakeSource[] = [];
  decodes = 0;
  createGain() {
    return { gain: { value: 1 }, connect() {}, disconnect() {} };
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  suspend() {
    this.state = "suspended";
    return Promise.resolve();
  }
  close() {
    this.state = "closed";
    return Promise.resolve();
  }
  decodeAudioData(bytes: ArrayBuffer): Promise<{ source: string }> {
    this.decodes++;
    return Promise.resolve({ source: new TextDecoder().decode(bytes) });
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
}
const fixture = {
  member: { drop: "/drop.mp3", merge: "/merge.mp3", win: "/win.mp3" },
  other: { merge: "/other.mp3" },
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
describe("recorded character playback", () => {
  let doc: FakeDocument;
  let contexts: FakeContext[];
  let requests: string[];
  let originals: Map<string, PropertyDescriptor | undefined>;
  beforeEach(() => {
    doc = new FakeDocument();
    contexts = [];
    requests = [];
    const mocks = {
      document: doc,
      KeyboardEvent: FakeKeyboardEvent,
      AudioContext: class extends FakeContext {
        constructor() {
          super();
          contexts.push(this);
        }
      },
      fetch: async (source: string) => {
        requests.push(source);
        return new Response(new TextEncoder().encode(source));
      },
    };
    originals = new Map(
      Object.keys(mocks).map((key) => [
        key,
        Object.getOwnPropertyDescriptor(globalThis, key),
      ]),
    );
    for (const [key, value] of Object.entries(mocks))
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
  test("preload is limited to the lineup, context waits for a gesture, decoding is cached", async () => {
    const player = new CharacterEffectsPlayer(fixture);
    player.prepare(["member", "missing"]);
    assert.equal(contexts.length, 0);
    assert.deepEqual(requests.sort(), ["/drop.mp3", "/merge.mp3", "/win.mp3"]);
    assert.equal(await player.play("merge", "member"), false);
    doc.dispatchEvent(new Event("pointerdown"));
    await settle();
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].decodes, 3);
    assert.equal(await player.play("merge", "member"), true);
    player.stop();
    assert.equal(await player.play("merge", "member"), true);
    assert.equal(contexts[0].decodes, 3);
    assert.equal(contexts[0].sources[0].buffer?.source, "/merge.mp3");
    player.destroy();
  });
  test("missing members stay silent instead of using another member's voice", async () => {
    const player = new CharacterEffectsPlayer(fixture);
    player.unlock();
    assert.equal(await player.play("merge", "missing"), false);
    assert.equal(await player.play("win", "other"), false);
    assert.equal(requests.length, 0);
    assert.equal(contexts[0].sources.length, 0);
    player.destroy();
  });
  test("default drop hook stays silent without fetching; custom drop recordings still work", async () => {
    const player = new CharacterEffectsPlayer();
    player.prepare(["todoroki-hajime", "tokino-sora"]);
    player.unlock();
    await settle();
    assert.equal(requests.length, 3);
    assert.ok(requests.every((source) => !source.endsWith("/drop.mp3")));
    const before = [...requests];
    assert.equal(await player.play("drop", "todoroki-hajime"), false);
    assert.equal(await player.play("drop", "tokino-sora"), false);
    assert.equal(await player.play("win", "todoroki-hajime"), false);
    assert.deepEqual(requests, before);
    assert.equal(contexts[0].sources.length, 0);
    player.destroy();
    const custom = new CharacterEffectsPlayer(fixture);
    custom.unlock();
    assert.equal(await custom.play("drop", "member"), true);
    assert.equal(contexts[1].sources[0].buffer?.source, "/drop.mp3");
    custom.destroy();
  });
  test("drop cannot interrupt merge or win; win replaces the simultaneous final merge", async () => {
    const player = new CharacterEffectsPlayer(fixture);
    player.unlock();
    assert.equal(await player.play("merge", "member"), true);
    assert.equal(await player.play("drop", "member"), false);
    assert.equal(contexts[0].sources[0].stopped, false);
    assert.equal(await player.play("win", "member"), true);
    assert.equal(contexts[0].sources[0].stopped, true);
    assert.equal(await player.play("merge", "member"), false);
    player.stop();
    assert.deepEqual(
      await Promise.all([
        player.play("merge", "member"),
        player.play("win", "member"),
      ]),
      [false, true],
    );
    assert.equal(contexts[0].sources.at(-1)?.buffer?.source, "/win.mp3");
    player.destroy();
  });
  test("late decoding cannot restart a stopped or destroyed voice", async () => {
    const player = new CharacterEffectsPlayer(fixture);
    player.unlock();
    let finish!: (buffer: { source: string }) => void;
    contexts[0].decodeAudioData = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const playing = player.play("merge", "member");
    await settle();
    player.stop();
    finish({ source: "/merge.mp3" });
    assert.equal(await playing, false);
    assert.equal(contexts[0].sources.length, 0);
    player.destroy();
    assert.equal(contexts[0].state, "closed");
    doc.dispatchEvent(new Event("pointerdown"));
    assert.equal(contexts.length, 1);
  });
  test("muting stops active and pending voices and blocks future playback until re-enabled", async () => {
    const player = new CharacterEffectsPlayer(fixture);
    player.setEnabled(false);
    player.prepare(["member"]);
    player.unlock();
    assert.equal(contexts.length, 0);
    assert.deepEqual(requests, []);
    player.setEnabled(true);
    await settle();
    assert.equal(await player.play("merge", "member"), true);
    player.setEnabled(false);
    assert.equal(contexts[0].sources[0].stopped, true);
    assert.equal(await player.play("win", "member"), false);
    doc.dispatchEvent(new Event("pointerdown"));
    assert.equal(contexts[0].state, "suspended");
    player.setEnabled(true);
    assert.equal(await player.play("win", "member"), true);
    player.stop();
    let finish!: (buffer: { source: string }) => void;
    contexts[0].decodeAudioData = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const pending = player.play("merge", "other");
    await settle();
    player.setEnabled(false);
    player.setEnabled(true);
    finish({ source: "/other.mp3" });
    assert.equal(
      await pending,
      false,
      "a late decode stays cancelled even after re-enabling",
    );
    player.destroy();
  });
  test("background stops voices, foreground resumes the context without replaying a clip", async () => {
    const player = new CharacterEffectsPlayer(fixture);
    player.unlock();
    await player.play("merge", "member");
    doc.hidden = true;
    doc.dispatchEvent(new Event("visibilitychange"));
    assert.equal(contexts[0].sources[0].stopped, true);
    assert.equal(contexts[0].state, "suspended");
    assert.equal(await player.play("win", "member"), false);
    doc.hidden = false;
    doc.dispatchEvent(new Event("visibilitychange"));
    await settle();
    assert.equal(contexts[0].state, "running");
    assert.equal(contexts[0].sources.length, 1);
    player.destroy();
  });
});
