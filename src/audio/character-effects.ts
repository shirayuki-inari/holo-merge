import recordings from "./character-voices.json";

export type CharacterEffectEvent = "drop" | "merge" | "win";
export type CharacterEffectMap = Partial<
  Record<string, Partial<Record<CharacterEffectEvent, string>>>
>;
export interface CharacterRecording {
  text: string;
  src: string;
  sourceFile: string;
  sourceSha256: string;
  durationSeconds: number;
}
export type CharacterVoiceCatalog = Record<
  string,
  { characterId: string; name: string; merge: CharacterRecording } & Partial<
    Record<Exclude<CharacterEffectEvent, "merge">, CharacterRecording>
  >
>;
export const CHARACTER_VOICES: CharacterVoiceCatalog = recordings;
export const CHARACTER_EFFECTS: CharacterEffectMap = Object.fromEntries(
  Object.entries(CHARACTER_VOICES).map(([id, role]) => [
    id,
    Object.fromEntries(
      (["drop", "merge", "win"] as const).flatMap((event) => {
        const clip = role[event];
        return clip ? [[event, clip.src]] : [];
      }),
    ),
  ]),
);
const PRIORITY = { drop: 0, merge: 1, win: 2 };

/** Preload only the current lineup; decode each recording once, after a user gesture. */
export class CharacterEffectsPlayer {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private ready = Promise.resolve();
  private bytes = new Map<string, Promise<ArrayBuffer>>();
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private planned = new Set<string>();
  private requests = new AbortController();
  private current: {
    node: AudioBufferSourceNode;
    event: CharacterEffectEvent;
  } | null = null;
  private pending: { token: number; event: CharacterEffectEvent } | null = null;
  private token = 0;
  private disposed = false;
  private enabled = true;
  constructor(private sources: CharacterEffectMap = CHARACTER_EFFECTS) {
    document.addEventListener("pointerdown", this.onInteraction);
    document.addEventListener("keydown", this.onInteraction);
    document.addEventListener("visibilitychange", this.onVisibility);
  }
  prepare(talentIds: string[]) {
    this.planned = new Set(
      talentIds.flatMap((id) => Object.values(this.sources[id] ?? {})),
    );
    this.preload();
  }
  private preload() {
    if (!this.enabled || this.disposed) return;
    for (const source of this.planned) {
      void this.fetchBytes(source).catch(() => {});
      if (this.context) void this.decode(source).catch(() => {});
    }
  }
  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.stop();
      if (this.context?.state === "running")
        void this.context.suspend().catch(() => {});
    } else {
      this.preload();
      this.unlock();
    }
  }
  private fetchBytes(source: string): Promise<ArrayBuffer> {
    let request = this.bytes.get(source);
    if (!request) {
      request = fetch(source, { signal: this.requests.signal }).then(
        (response) => {
          if (!response.ok)
            throw new Error(`Voice request failed: ${response.status}`);
          return response.arrayBuffer();
        },
      );
      this.bytes.set(source, request);
      void request.catch(() => {
        if (this.bytes.get(source) === request) this.bytes.delete(source);
      });
    }
    return request;
  }
  private decode(source: string): Promise<AudioBuffer> {
    let buffer = this.buffers.get(source);
    if (!buffer) {
      const context = this.context!;
      buffer = this.fetchBytes(source).then((bytes) =>
        context.decodeAudioData(bytes.slice(0)),
      );
      this.buffers.set(source, buffer);
      void buffer.catch(() => {
        if (this.buffers.get(source) === buffer) this.buffers.delete(source);
      });
    }
    return buffer;
  }
  /** Called synchronously by an actual input event; async physics merges reuse this unlocked context. */
  unlock = () => {
    if (this.disposed || !this.enabled || document.hidden) return;
    try {
      if (!this.context) {
        this.context = new AudioContext({ latencyHint: "interactive" });
        this.gain = this.context.createGain();
        this.gain.gain.value = 0.8;
        this.gain.connect(this.context.destination);
      }
      this.ready =
        this.context.state === "suspended"
          ? this.context.resume()
          : Promise.resolve();
      void this.ready
        .then(() => {
          if (this.disposed || !this.enabled) return;
          for (const source of this.planned)
            void this.decode(source).catch(() => {});
        })
        .catch(() => {});
    } catch {
      /* Audio is optional; gameplay continues if the browser denies access. */
    }
  };
  private onInteraction = (event: Event) => {
    if (
      event instanceof KeyboardEvent &&
      (event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        ![" ", "Enter", "ArrowLeft", "ArrowRight"].includes(event.key))
    )
      return;
    this.unlock();
  };
  async play(event: CharacterEffectEvent, talentId: string): Promise<boolean> {
    const source = this.sources[talentId]?.[event];
    if (
      !source ||
      !this.context ||
      this.disposed ||
      !this.enabled ||
      document.hidden
    )
      return false;
    const active = this.pending?.event ?? this.current?.event;
    if (active && PRIORITY[event] < PRIORITY[active]) return false;
    this.stop();
    const token = this.token;
    this.pending = { token, event };
    try {
      await this.ready;
      const buffer = await this.decode(source);
      if (
        this.disposed ||
        !this.enabled ||
        this.token !== token ||
        document.hidden ||
        this.context.state !== "running"
      )
        return false;
      const node = this.context.createBufferSource();
      node.buffer = buffer;
      node.connect(this.gain!);
      node.onended = () => {
        node.disconnect();
        if (this.current?.node === node) this.current = null;
      };
      this.current = { node, event };
      this.pending = null;
      node.start();
      return true;
    } catch {
      return false;
    } finally {
      if (this.pending?.token === token) this.pending = null;
    }
  }
  private onVisibility = () => {
    if (document.hidden) {
      this.stop();
      if (this.context?.state === "running")
        void this.context.suspend().catch(() => {});
    } else if (this.context) this.unlock();
  };
  stop() {
    this.token++;
    this.pending = null;
    if (!this.current) return;
    const { node } = this.current;
    this.current = null;
    node.onended = null;
    node.stop();
    node.disconnect();
  }
  destroy() {
    this.disposed = true;
    document.removeEventListener("pointerdown", this.onInteraction);
    document.removeEventListener("keydown", this.onInteraction);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.stop();
    this.requests.abort();
    if (this.context) void this.context.close().catch(() => {});
    this.gain?.disconnect();
    this.bytes.clear();
    this.buffers.clear();
    this.planned.clear();
  }
}
