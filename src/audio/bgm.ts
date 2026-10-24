export const BGM_TRACKS = [
  "/audio/bgm/bgm_park_area_area-a01-area-01-night.mp3",
  "/audio/bgm/bgm_park_area_area-a01-area-01-pre-001.mp3",
  "/audio/bgm/bgm_park_area_area-a02-area-01.mp3",
] as const;

export function chooseBgmTrack(random = Math.random): string {
  return BGM_TRACKS[
    Math.min(BGM_TRACKS.length - 1, Math.floor(random() * BGM_TRACKS.length))
  ];
}

interface BgmOptions {
  source: string;
  enabled: boolean;
  suspended: boolean;
}

/** One looping track per page. Music preferences are independent of character effects. */
export class BgmPlayer {
  private enabled: boolean;
  private suspended: boolean;
  private disposed = false;
  constructor(
    private audio: HTMLAudioElement,
    options: BgmOptions,
  ) {
    this.enabled = options.enabled;
    this.suspended = options.suspended;
    audio.src = options.source;
    audio.preload = "none";
    audio.loop = true;
    audio.volume = 0.35;
    document.addEventListener("pointerdown", this.onInteraction);
    document.addEventListener("keydown", this.onInteraction);
    document.addEventListener("visibilitychange", this.sync);
    this.sync();
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.sync();
  }
  setSuspended(suspended: boolean) {
    this.suspended = suspended;
    this.sync();
  }
  private shouldPlay() {
    return (
      !this.disposed && this.enabled && !this.suspended && !document.hidden
    );
  }
  private onInteraction = (event: Event) => {
    // The toggle handles playback itself. Clicking "off" must never start the track.
    if (
      event.target instanceof Element &&
      event.target.closest("[data-bgm-toggle]")
    )
      return;
    if (
      event instanceof KeyboardEvent &&
      (event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        ![" ", "Enter", "ArrowLeft", "ArrowRight"].includes(event.key))
    )
      return;
    this.sync();
  };
  private sync = () => {
    if (!this.shouldPlay()) {
      this.audio.pause();
      return;
    }
    if (!this.audio.paused) return;
    // Autoplay may be blocked. Retry on the next user gesture, without an unhandled rejection.
    void this.audio
      .play()
      .then(() => {
        // A pending play request may resolve after the user disables music or leaves the tab.
        if (!this.disposed && !this.shouldPlay()) this.audio.pause();
      })
      .catch(() => {});
  };
  destroy() {
    this.disposed = true;
    document.removeEventListener("pointerdown", this.onInteraction);
    document.removeEventListener("keydown", this.onInteraction);
    document.removeEventListener("visibilitychange", this.sync);
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
  }
}
