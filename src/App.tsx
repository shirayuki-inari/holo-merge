import {
  useEffect,
  useId,
  useRef,
  useState,
  useMemo,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  CircleHelp,
  Crown,
  Heart,
  Keyboard,
  MousePointer2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Trophy,
  Settings,
  X,
} from "lucide-react";
import { HoloEngine, type GameState } from "./game/engine";
import { COLORS, createLineup, groups, WIDTH, type Talent } from "./game/model";
import { useBackgroundMusic } from "./audio/useBackgroundMusic";
import { CharacterEffectsPlayer } from "./audio/character-effects";
import Leaderboard from "./Leaderboard";
import { useRankedRound } from "./useRankedRound";
import { seededRandom, MAX_DROPS } from "./game/replay";
import {
  submitScore,
  LeaderboardError,
  leaderboardErrorText,
} from "./leaderboard-client";
import { useI18n } from "./i18n";
import SettingsPanel from "./Settings";
import { useVoicePreference } from "./preferences";
type ScoreFeedback =
  | { kind: "capacity" | "expired" }
  | { kind: "accepted"; score: number; improved: boolean }
  | { kind: "error"; error: unknown };
const STORAGE_KEY = "holo-merge-best-v1";
function storedBest() {
  try {
    return Math.max(0, Number(localStorage.getItem(STORAGE_KEY)) || 0);
  } catch {
    return 0;
  }
}
function Portrait({
  talent,
  className = "",
  style,
}: {
  talent: Talent;
  className?: string;
  style?: React.CSSProperties;
}) {
  const { name } = useI18n();
  return (
    <img
      className={`portrait ${className}`}
      src={talent.image}
      alt={name(talent)}
      style={style}
      draggable={false}
    />
  );
}
function Modal({
  children,
  close,
  title,
}: {
  children: ReactNode;
  close: () => void;
  title: string;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current!;
    el.showModal();
    return () => el.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        const bounds = e.currentTarget.getBoundingClientRect();
        if (
          e.target === e.currentTarget &&
          (e.clientX < bounds.left ||
            e.clientX > bounds.right ||
            e.clientY < bounds.top ||
            e.clientY > bounds.bottom)
        )
          close();
      }}
    >
      <div className="modal-inner">
        <button
          className="icon-button modal-close"
          onClick={close}
          aria-label={t("common.close")}
        >
          <X size={20} />
        </button>
        <span className="eyebrow">HOLO MERGE!</span>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
const initial: GameState = {
  score: 0,
  current: 0,
  next: 0,
  highest: 0,
  count: 0,
  drops: 0,
  danger: false,
  over: false,
  won: false,
  combo: 0,
};
export default function App() {
  const { t, name, group, number } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null),
    engine = useRef<HoloEngine | null>(null);
  const [round, setRound] = useState(0);
  const ranked = useRankedRound(round);
  const lineup = useMemo(
    () =>
      createLineup(
        ranked.session
          ? seededRandom(ranked.session.seed ^ 0x51f15e)
          : Math.random,
      ),
    [round, ranked.session],
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [rankResult, setRankResult] = useState<ScoreFeedback | null>(null);
  const rankText = !rankResult
    ? ""
    : rankResult.kind === "error"
      ? leaderboardErrorText(rankResult.error, t)
      : rankResult.kind === "accepted"
        ? t(rankResult.improved ? "score.improved" : "score.kept", {
            score: number(rankResult.score),
          })
        : t(
            rankResult.kind === "capacity" ? "score.capacity" : "score.expired",
          );
  const [rankReload, setRankReload] = useState(0);
  const [game, setGame] = useState<GameState>(initial);
  const [mergeNotice, setMergeNotice] = useState<{
    level: number;
    stamp: number;
  } | null>(null);
  const [best, setBest] = useState(storedBest),
    bestRef = useRef(best);
  const [paused, setPaused] = useState(false);
  const bgm = useBackgroundMusic(paused);
  const characterEffects = useRef<CharacterEffectsPlayer | null>(null);
  const voices = useVoicePreference((enabled) =>
    characterEffects.current?.setEnabled(enabled),
  );
  const voicesInitial = useRef(voices.enabled);
  const [modal, setModal] = useState<
    | "help"
    | "restart"
    | "over"
    | "win"
    | "lineup"
    | "leaderboard"
    | "settings"
    | null
  >(null);
  const dragging = useRef(false),
    pointerStart = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const player = new CharacterEffectsPlayer();
    player.setEnabled(voicesInitial.current);
    characterEffects.current = player;
    return () => {
      player.destroy();
      characterEffects.current = null;
    };
  }, []);
  useEffect(() => {
    characterEffects.current?.prepare(lineup.map((talent) => talent.id));
  }, [lineup]);
  useEffect(() => {
    if (paused) characterEffects.current?.stop();
  }, [paused]);
  useEffect(() => {
    if (!ranked.ready) return;
    const instance = new HoloEngine(canvas.current!, {
      lineup,
      seed: ranked.session?.seed,
      onChange: (state) => {
        setGame(state);
        if (state.score > bestRef.current) {
          bestRef.current = state.score;
          setBest(state.score);
          try {
            localStorage.setItem(STORAGE_KEY, String(state.score));
          } catch {
            /* Play without storage. */
          }
        }
      },
      onMerge: (level) => {
        characterEffects.current?.play("merge", lineup[level].id);
        setMergeNotice({ level, stamp: Date.now() });
      },
      onEnd: () => setModal("over"),
      onWin: () => {
        characterEffects.current?.play("win", lineup[10].id);
        setModal("win");
      },
    });
    engine.current = instance;
    return () => {
      instance.destroy();
      engine.current = null;
    };
  }, [lineup, ranked.ready, ranked.session]);
  // UI language updates only the renderer, preserving the current simulation and replay.
  useEffect(() => {
    engine.current?.setLabels({
      limit: t("game.limit"),
      danger: t("game.danger"),
    });
  }, [t, lineup, ranked.ready]);
  useEffect(() => {
    engine.current?.setPaused(paused || modal !== null);
  }, [paused, modal, lineup, ranked.ready]);
  useEffect(() => {
    if (!mergeNotice) return;
    const timeout = window.setTimeout(() => setMergeNotice(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [mergeNotice]);
  function restart() {
    if (submitting) return;
    characterEffects.current?.stop();
    setMergeNotice(null);
    setRound((v) => v + 1);
    setSubmitted(false);
    setRankResult(null);
    setGame(initial);
    setPaused(false);
    setModal(null);
  }
  async function submitCurrentScore() {
    const instance = engine.current,
      session = ranked.session;
    if (!instance || !session || submitting || submitted) return;
    const replay = instance.replay();
    if (replay.drops.length > MAX_DROPS) {
      setRankResult({ kind: "capacity" });
      return;
    }
    if (Date.now() > session.expires) {
      setRankResult({ kind: "expired" });
      return;
    }
    if (!instance.state.over) instance.finish();
    setModal("leaderboard");
    setSubmitting(true);
    setRankResult(null);
    try {
      const result = await submitScore(session.id, replay);
      setSubmitted(true);
      setRankReload((v) => v + 1);
      setRankResult({
        kind: "accepted",
        score: result.acceptedScore,
        improved: result.improved,
      });
    } catch (error) {
      if (error instanceof LeaderboardError && error.status === 409) {
        setSubmitted(true);
        setRankReload((v) => v + 1);
      }
      setRankResult({ kind: "error", error });
    } finally {
      setSubmitting(false);
    }
  }
  function closeModal() {
    setModal(null);
    canvas.current?.focus({ preventScroll: true });
  }
  function drop() {
    const instance = engine.current;
    if (!instance || !ranked.ready) return;
    const level = instance.state.current;
    // Reserved for future drop recordings; the current catalog has no drop clips.
    if (instance.drop())
      characterEffects.current?.play("drop", lineup[level].id);
  }
  function aim(clientX: number) {
    const rect = canvas.current!.getBoundingClientRect();
    engine.current?.setAim(((clientX - rect.left) / rect.width) * WIDTH);
  }
  function requestRestart() {
    if (submitting) return;
    if (game.drops && !game.over) setModal("restart");
    else restart();
  }
  return (
    <div className="game-room">
      <audio ref={bgm.audioRef} aria-hidden="true" />
      <header className="room-header">
        <div className="brand">
          <span className="brand-tile" aria-hidden="true">
            <span className="brand-mark" />
          </span>
          <div>
            <h1>
              holo<span>merge!</span>
              <Heart className="brand-heart" size={15} />
            </h1>
            <p>{t("app.subtitle")}</p>
          </div>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            onClick={() => setModal("leaderboard")}
            aria-label={t("board.title")}
            title={t("board.title")}
          >
            <Trophy size={17} />
          </button>
          <button
            className="icon-button"
            onClick={() => setModal("settings")}
            aria-label={t("settings.title")}
            title={t("settings.title")}
          >
            <Settings size={18} />
          </button>
          <button
            className="icon-button"
            onClick={() => setModal("help")}
            aria-label={t("help.open")}
            title={t("help.title")}
          >
            <CircleHelp size={18} />
          </button>
        </div>
      </header>
      <main className="game-desk" aria-label={t("game.label")}>
        <aside className="desk-note" aria-hidden="true">
          <svg className="note-doodle" viewBox="0 0 100 75" fill="none">
            <path
              d="M15 44c-9-10-2-23 7-21 7 0 9 8 9 8s4-11 12-7c12 7-5 25-14 30-6-3-12-6-14-10Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
            <path
              d="M44 57c14 13 34 5 32-12-2-16-22-8-13 2 6 7 20 0 25-9m-9 0 10-2-1 10"
              stroke="#82bdc9"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </aside>
        <section
          className={`game-shell ${game.danger ? "in-danger" : ""}`}
          aria-label={t("game.board")}
        >
          <div className="game-toolbar">
            <div className="score-card">
              <span>
                <Sparkles size={12} />
                {t("game.score")}
              </span>
              <strong aria-live="polite">{number(game.score)}</strong>
            </div>
            <div className="best-card">
              <span>
                <Trophy size={12} />
                {t("game.best")}
              </span>
              <strong>{number(best)}</strong>
            </div>
            <div className="board-actions">
              <button
                className="icon-button"
                onClick={() => setPaused((v) => !v)}
                disabled={game.over}
                aria-label={paused ? t("game.resume") : t("game.pause")}
                title={paused ? t("game.resume") : t("game.pause")}
              >
                {paused ? <Play size={17} /> : <Pause size={17} />}
              </button>
              <button
                className="icon-button"
                onClick={requestRestart}
                aria-label={t("game.restart")}
                title={t("game.restart")}
              >
                <RotateCcw size={17} />
              </button>
            </div>
          </div>
          <div className="canvas-wrap">
            <canvas
              ref={canvas}
              tabIndex={0}
              aria-label={t("game.canvas")}
              onPointerDown={(e) => {
                if (e.pointerType === "mouse" && e.button !== 0) return;
                dragging.current = true;
                pointerStart.current = { x: e.clientX, y: e.clientY };
                e.currentTarget.setPointerCapture(e.pointerId);
                aim(e.clientX);
                e.currentTarget.focus({ preventScroll: true });
              }}
              onPointerMove={(e) => {
                if (e.pointerType === "mouse" || dragging.current)
                  aim(e.clientX);
              }}
              onPointerUp={(e) => {
                if (!dragging.current) return;
                dragging.current = false;
                if (
                  e.pointerType !== "mouse" &&
                  Math.abs(e.clientY - pointerStart.current.y) > 100
                )
                  return;
                aim(e.clientX);
                drop();
              }}
              onPointerCancel={() => {
                dragging.current = false;
              }}
              onKeyDown={(e) => {
                if (
                  ["ArrowLeft", "ArrowRight", " ", "Enter", "p", "P"].includes(
                    e.key,
                  )
                )
                  e.preventDefault();
                if (e.key === "ArrowLeft") engine.current?.moveAim(-14);
                if (e.key === "ArrowRight") engine.current?.moveAim(14);
                if ((e.key === " " || e.key === "Enter") && !e.repeat) drop();
                if ((e.key === "p" || e.key === "P") && !e.repeat)
                  setPaused((v) => !v);
              }}
            />

            {!ranked.ready && (
              <div className="board-overlay">
                <p role="status">{t("game.preparing")}</p>
              </div>
            )}
            {ranked.ready && game.drops === 0 && !paused && !modal && (
              <div className="empty-welcome" aria-hidden="true">
                <span className="welcome-tag">{t("game.rules")}</span>
                <div className="welcome-faces">
                  <Portrait talent={lineup[0]} />
                  <Plus size={19} aria-hidden="true" />
                  <Portrait talent={lineup[0]} />
                </div>
                <h2>{t("game.same")}</h2>
                <p>{t("game.dropHint")}</p>
                <span className="welcome-pointer">
                  <MousePointer2 size={17} />
                </span>
              </div>
            )}
            {mergeNotice && !paused && !modal && (
              <div
                className="merge-greeting"
                key={mergeNotice.stamp}
                role="status"
              >
                <Heart size={13} fill="currentColor" />
                {t("game.merged", { name: name(lineup[mergeNotice.level]) })}
              </div>
            )}
            {paused && !modal && (
              <div className="board-overlay">
                <span className="overlay-faces">
                  <Portrait talent={lineup[game.current]} />
                  <span>
                    <Pause size={18} />
                  </span>
                </span>
                <h2>{t("game.paused")}</h2>
                <button
                  className="primary-button"
                  onClick={() => setPaused(false)}
                  aria-label={t("game.resume")}
                >
                  <Play size={15} />
                  {t("game.resume")}
                </button>
              </div>
            )}
            {game.over && !modal && (
              <div className="board-overlay">
                <Heart className="end-heart" size={32} />
                <h2>{t("game.over")}</h2>
                {ranked.session && !submitted && game.score > 0 && (
                  <button
                    className="secondary-button"
                    onClick={() => setModal("leaderboard")}
                  >
                    {t("game.submit")}
                  </button>
                )}
                <button className="primary-button" onClick={restart}>
                  {t("game.again")}
                  <ArrowRight size={15} />
                </button>
              </div>
            )}
          </div>
          <div className={`game-bottom ${game.danger ? "warning" : ""}`}>
            <span>
              {game.danger ? <CircleHelp size={13} /> : <Heart size={12} />}
              {game.danger ? t("game.danger") : t("game.mergeRule")}
            </span>
            <span
              className={`status-dot ${paused || modal || game.over ? "is-paused" : ""}`}
              title={
                game.over
                  ? t("game.ended")
                  : paused || modal
                    ? t("game.pauseStatus")
                    : t("game.running")
              }
            />
          </div>
        </section>
        <aside className="play-companions" aria-label={t("lineup.label")}>
          <section className="next-card">
            <div className="note-heading">
              <span className="tiny-play" />
              {t("lineup.next")}
              <Heart size={12} />
            </div>
            <div className="next-orbit">
              <Portrait
                talent={lineup[game.next]}
                style={{ borderColor: COLORS[game.next] }}
              />
              <span className="next-spark">✧</span>
            </div>
            <div className="next-name">
              <h2>{name(lineup[game.next])}</h2>
              <span className="group-pill">{group(groups[game.next])}</span>
            </div>
            <Heart className="next-heart" size={14} aria-hidden="true" />
          </section>
          <section className="goal-note" aria-label={t("lineup.goal")}>
            <span className="goal-flower" aria-hidden="true">
              ✿
            </span>
            <div>
              <p>
                {game.highest === 10 ? t("lineup.max") : t("lineup.nextLevel")}
              </p>
              <h3>
                {game.highest === 10
                  ? group(groups[10])
                  : group(groups[game.highest + 1])}
              </h3>
            </div>
          </section>
          <section className="companion-album" aria-label={t("lineup.album")}>
            <div className="album-heading">
              <h2>{t("lineup.current")}</h2>
              <span>
                {game.highest + 1}
                <small> / 11</small>
              </span>
            </div>
            <div className="evolution-track">
              {lineup.map((talent, i) => (
                <button
                  className={`evolution-item ${i <= game.highest ? "discovered" : ""} ${i === game.highest ? "latest" : ""}`}
                  key={groups[i].id}
                  onClick={() => setModal("lineup")}
                  title={`${group(groups[i])} · ${name(talent)}`}
                  aria-label={t("lineup.view", {
                    name: name(talent),
                    group: group(groups[i]),
                  })}
                  style={{ "--member-color": COLORS[i] } as React.CSSProperties}
                >
                  <Portrait talent={talent} />
                  <span className="member-dot" />
                </button>
              ))}
            </div>
            <button className="text-button" onClick={() => setModal("lineup")}>
              {t("lineup.guide")}
              <ArrowRight size={13} />
            </button>
            <p className="album-caption">{t("lineup.fixed")}</p>
          </section>
        </aside>
        <div className="play-hint">
          <span className="mouse-hint">
            <MousePointer2 size={13} />
            {t("controls.mouse")}
          </span>
          <span className="touch-hint">
            <ArrowDown size={13} />
            {t("controls.touch")}
          </span>
          <span className="keyboard-hint">
            <kbd>←</kbd>
            <kbd>→</kbd> {t("controls.move")} <i>·</i>
            <kbd>{t("controls.space")}</kbd>
            {t("controls.drop")}
          </span>
        </div>
      </main>
      <div className="rank-round-status" role="status">
        {submitted ? t("rank.submitted") : t(ranked.message)}
      </div>
      <footer className="room-footer">
        <p>
          {t("footer.fan")} <Heart size={10} />
        </p>
        <span>
          {t("footer.copyright")}
          <i>·</i>
          <a
            href="https://hololive.hololivepro.com/talents/"
            target="_blank"
            rel="noreferrer"
          >
            {t("footer.official")}
            <ArrowUpRight size={10} />
          </a>
        </span>
      </footer>
      {modal && (
        <Modal
          close={closeModal}
          title={
            modal === "help"
              ? t("help.title")
              : modal === "restart"
                ? t("restart.title")
                : modal === "over"
                  ? t("game.over")
                  : modal === "win"
                    ? t("result.win")
                    : modal === "leaderboard"
                      ? t("board.title")
                      : modal === "settings"
                        ? t("settings.title")
                        : t("lineup.current")
          }
        >
          {modal === "settings" && (
            <SettingsPanel bgm={bgm} voices={voices} close={closeModal} />
          )}
          {modal === "leaderboard" && (
            <Leaderboard
              canSubmit={!!ranked.session && !submitted && game.drops > 0}
              submitting={submitting}
              result={rankText}
              submit={submitCurrentScore}
              reloadKey={rankReload}
            />
          )}
          {modal === "help" && (
            <>
              <div className="help-demo">
                <Portrait talent={lineup[0]} />
                <span>+</span>
                <Portrait talent={lineup[0]} />
                <ArrowRight size={22} />
                <Portrait talent={lineup[1]} />
              </div>
              <p>{t("help.aim")}</p>
              <p>{t("help.lineup")}</p>
              <div className="help-controls">
                <span>
                  <MousePointer2 size={18} /> {t("help.mouse")}
                </span>
                <span>
                  <ArrowDown size={18} /> {t("help.touch")}
                </span>
                <span>
                  <Keyboard size={18} /> {t("help.keyboard")}
                </span>
              </div>
              <p className="help-warning">{t("help.warning")}</p>
              <button className="primary-button full" onClick={closeModal}>
                {t("common.back")} <Play size={15} />
              </button>
            </>
          )}
          {modal === "restart" && (
            <>
              <p>{t("restart.body", { score: number(game.score) })}</p>
              <div className="modal-actions">
                <button className="secondary-button" onClick={closeModal}>
                  {t("restart.continue")}
                </button>
                <button className="primary-button" onClick={restart}>
                  {t("game.restart")} <RotateCcw size={15} />
                </button>
              </div>
            </>
          )}
          {(modal === "over" || modal === "win") && (
            <>
              <div className="result-icon">
                {modal === "win" ? <Crown size={38} /> : <Heart size={35} />}
              </div>
              <p className="result-caption">
                {modal === "win"
                  ? t("result.member", { name: name(lineup[10]) })
                  : t("result.over")}
              </p>
              <div className="result-score">
                <span>{t("game.score")}</span>
                <strong>{number(game.score)}</strong>
              </div>
              <div className="result-details">
                <span>
                  {t("game.best")} <b>{number(best)}</b>
                </span>
                <span>
                  {t("result.reached")} <b>{group(groups[game.highest])}</b>
                </span>
              </div>
              {modal === "over" &&
                ranked.session &&
                !submitted &&
                game.score > 0 && (
                  <button
                    className="secondary-button full"
                    onClick={() => setModal("leaderboard")}
                  >
                    {t("game.submit")}
                  </button>
                )}
              <button
                className="primary-button full"
                onClick={modal === "win" ? closeModal : restart}
              >
                {modal === "win" ? t("game.resume") : t("result.again")}{" "}
                <ArrowRight size={16} />
              </button>
            </>
          )}
          {modal === "lineup" && (
            <>
              <p>{t("lineup.description")}</p>
              <div className="lineup-list">
                {lineup.map((talent, i) => (
                  <a
                    key={talent.id + i}
                    href={talent.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className="lineup-number">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <Portrait talent={talent} />
                    <div>
                      <strong>{name(talent)}</strong>
                      <small>{group(groups[i])}</small>
                    </div>
                    <ArrowUpRight size={15} />
                  </a>
                ))}
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
