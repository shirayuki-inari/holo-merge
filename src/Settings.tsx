import { Music2, Play } from "lucide-react";
import { useI18n } from "./i18n";
import { LANGUAGES, type Locale } from "./i18n/core";
import { BGM_TRACKS } from "./audio/bgm";
import type { useBackgroundMusic } from "./audio/useBackgroundMusic";
export default function SettingsPanel({
  bgm,
  voices,
  close,
}: {
  bgm: ReturnType<typeof useBackgroundMusic>;
  voices: { enabled: boolean; toggle: () => void };
  close: () => void;
}) {
  const { t, locale, setLocale } = useI18n();
  return (
    <div className="settings-panel">
      <div className="setting-row">
        <label id="bgm-label">{t("settings.bgm")}</label>
        <button
          className="setting-switch"
          role="switch"
          data-bgm-toggle
          aria-labelledby="bgm-label"
          aria-checked={bgm.enabled}
          title={
            bgm.enabled
              ? t(bgm.playing ? "bgm.off" : "bgm.waiting")
              : t("bgm.on")
          }
          onClick={bgm.toggle}
        >
          <span />
        </button>
      </div>
      <div
        className="track-picker"
        role="group"
        aria-label={t("settings.track")}
      >
        {BGM_TRACKS.map((_, index) => (
          <button
            key={index}
            className={bgm.trackIndex === index ? "selected" : ""}
            aria-label={t("settings.trackNumber", {
              number: String(index + 1).padStart(2, "0"),
            })}
            aria-pressed={bgm.trackIndex === index}
            onClick={() => bgm.selectTrack(index)}
          >
            <Music2 size={14} />
            <span>{String(index + 1).padStart(2, "0")}</span>
          </button>
        ))}
      </div>
      <div className="setting-row voice-setting">
        <div>
          <label id="voice-label">{t("settings.voice")}</label>
          <p>{t("settings.voiceHint")}</p>
        </div>
        <button
          className="setting-switch"
          role="switch"
          aria-labelledby="voice-label"
          aria-checked={voices.enabled}
          title={t(voices.enabled ? "voice.off" : "voice.on")}
          onClick={voices.toggle}
        >
          <span />
        </button>
      </div>
      <div className="setting-row language-setting">
        <label htmlFor="game-language">{t("settings.language")}</label>
        <select
          id="game-language"
          value={locale}
          onChange={(event) => setLocale(event.target.value as Locale)}
        >
          {LANGUAGES.map(({ id, name }) => (
            <option key={id} value={id} lang={id}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <p className="settings-hint">{t("settings.saved")}</p>
      <button className="primary-button full" onClick={close}>
        {t("common.back")}
        <Play size={15} />
      </button>
    </div>
  );
}
