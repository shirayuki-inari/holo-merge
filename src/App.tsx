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
  Music2,
  VolumeX,
  X,
} from "lucide-react";
import { HoloEngine, type GameState } from "./game/engine";
import { COLORS, createLineup, groups, WIDTH, type Talent } from "./game/model";
import { useBackgroundMusic } from "./audio/useBackgroundMusic";
import { CharacterEffectsPlayer } from "./audio/character-effects";
import Leaderboard from "./Leaderboard";
import { useRankedRound } from "./useRankedRound";
import { seededRandom, MAX_TICKS, MAX_DROPS } from "./game/replay";
import { submitScore, LeaderboardError } from "./leaderboard-client";
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
  return (
    <img
      className={`portrait ${className}`}
      src={talent.image}
      alt={talent.name}
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
          aria-label="关闭"
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
  const [rankResult, setRankResult] = useState("");
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
  const [modal, setModal] = useState<
    "help" | "restart" | "over" | "win" | "lineup" | "leaderboard" | null
  >(null);
  const dragging = useRef(false),
    pointerStart = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const player = new CharacterEffectsPlayer();
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
    setRankResult("");
    setGame(initial);
    setPaused(false);
    setModal(null);
  }
  async function submitCurrentScore() {
    const instance = engine.current,
      session = ranked.session;
    if (!instance || !session || submitting || submitted) return;
    const replay = instance.replay();
    if (
      replay.ticks > MAX_TICKS ||
      replay.drops.length > MAX_DROPS ||
      Date.now() > session.expires
    ) {
      setRankResult("本局已超过排行榜计分时长，可重新开始后参榜。");
      return;
    }
    if (!instance.state.over) instance.finish();
    setModal("leaderboard");
    setSubmitting(true);
    setRankResult("");
    try {
      const result = await submitScore(session.id, replay);
      setSubmitted(true);
      setRankReload((v) => v + 1);
      setRankResult(
        `已提交 ${result.acceptedScore.toLocaleString()} 分${result.improved ? "，最高纪录已更新。" : "。最高纪录保留。"}`,
      );
    } catch (error) {
      if (error instanceof LeaderboardError && error.status === 409) {
        setSubmitted(true);
        setRankReload((v) => v + 1);
      }
      setRankResult((error as Error).message);
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
            <p>hololive 成员合成游戏</p>
          </div>
        </div>
        <div className="header-actions">
          <button
            className="icon-button"
            onClick={() => setModal("leaderboard")}
            aria-label="排行榜"
            title="排行榜"
          >
            <Trophy size={17} />
          </button>
          <button
            className="icon-button bgm-button"
            data-bgm-toggle
            data-playing={bgm.playing}
            onClick={bgm.toggle}
            aria-label={bgm.enabled ? "关闭背景音乐" : "开启背景音乐"}
            aria-pressed={bgm.enabled}
            title={
              bgm.enabled
                ? bgm.playing
                  ? "关闭背景音乐"
                  : "背景音乐：待播放"
                : "开启背景音乐"
            }
          >
            {bgm.enabled ? <Music2 size={17} /> : <VolumeX size={17} />}
            <span>BGM</span>
          </button>
          <button
            className="icon-button"
            onClick={() => setModal("help")}
            aria-label="查看玩法说明"
            title="玩法说明"
          >
            <CircleHelp size={18} />
          </button>
        </div>
      </header>
      <main className="game-desk" aria-label="合成游戏">
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
          aria-label="游戏棋盘"
        >
          <div className="game-toolbar">
            <div className="score-card">
              <span>
                <Sparkles size={12} />
                本局得分
              </span>
              <strong aria-live="polite">{game.score.toLocaleString()}</strong>
            </div>
            <div className="best-card">
              <span>
                <Trophy size={12} />
                最高纪录
              </span>
              <strong>{best.toLocaleString()}</strong>
            </div>
            <div className="board-actions">
              <button
                className="icon-button"
                onClick={() => setPaused((v) => !v)}
                disabled={game.over}
                aria-label={paused ? "继续游戏" : "暂停游戏"}
                title={paused ? "继续游戏" : "暂停游戏"}
              >
                {paused ? <Play size={17} /> : <Pause size={17} />}
              </button>
              <button
                className="icon-button"
                onClick={requestRestart}
                aria-label="重新开始"
                title="重新开始"
              >
                <RotateCcw size={17} />
              </button>
            </div>
          </div>
          <div className="canvas-wrap">
            <canvas
              ref={canvas}
              tabIndex={0}
              aria-label="合成游戏区域。左右方向键移动，空格或回车投放，P 键暂停。"
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
                <p role="status">正在准备本局…</p>
              </div>
            )}
            {ranked.ready && game.drops === 0 && !paused && !modal && (
              <div className="empty-welcome" aria-hidden="true">
                <span className="welcome-tag">合成规则</span>
                <div className="welcome-faces">
                  <Portrait talent={lineup[0]} />
                  <Plus size={19} aria-hidden="true" />
                  <Portrait talent={lineup[0]} />
                </div>
                <h2>相同成员合成下一级</h2>
                <p>点击或松手投放成员。</p>
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
                已合成：{lineup[mergeNotice.level].name}
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
                <h2>游戏已暂停</h2>
                <button
                  className="primary-button"
                  onClick={() => setPaused(false)}
                  aria-label="继续游戏"
                >
                  <Play size={15} />
                  继续游戏
                </button>
              </div>
            )}
            {game.over && !modal && (
              <div className="board-overlay">
                <Heart className="end-heart" size={32} />
                <h2>游戏结束</h2>
                {ranked.session && !submitted && game.score > 0 && (
                  <button
                    className="secondary-button"
                    onClick={() => setModal("leaderboard")}
                  >
                    提交成绩
                  </button>
                )}
                <button className="primary-button" onClick={restart}>
                  再玩一局
                  <ArrowRight size={15} />
                </button>
              </div>
            )}
          </div>
          <div className={`game-bottom ${game.danger ? "warning" : ""}`}>
            <span>
              {game.danger ? <CircleHelp size={13} /> : <Heart size={12} />}
              {game.danger
                ? "已超过警戒线，请及时合成"
                : "相同成员碰撞后合成下一级。"}
            </span>
            <span
              className={`status-dot ${paused || modal || game.over ? "is-paused" : ""}`}
              title={
                game.over
                  ? "本局结束"
                  : paused || modal
                    ? "已暂停"
                    : "游戏进行中"
              }
            />
          </div>
        </section>
        <aside className="play-companions" aria-label="成员与合成图鉴">
          <section className="next-card">
            <div className="note-heading">
              <span className="tiny-play" />
              下一位
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
              <h2>{lineup[game.next].name}</h2>
              <span className="group-pill">{groups[game.next].name}</span>
            </div>
            <Heart className="next-heart" size={14} aria-hidden="true" />
          </section>
          <section className="goal-note" aria-label="下一个合成目标">
            <span className="goal-flower" aria-hidden="true">
              ✿
            </span>
            <div>
              <p>{game.highest === 10 ? "已达最高等级" : "下一合成等级"}</p>
              <h3>
                {game.highest === 10
                  ? "0 期生"
                  : groups[game.highest + 1].name.replace("秘密結社 ", "")}
              </h3>
            </div>
          </section>
          <section className="companion-album" aria-label="本局成员图鉴">
            <div className="album-heading">
              <h2>本局成员</h2>
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
                  title={`${groups[i].name} · ${talent.name}`}
                  aria-label={`查看本局成员：${talent.name}，${groups[i].name}`}
                  style={{ "--member-color": COLORS[i] } as React.CSSProperties}
                >
                  <Portrait talent={talent} />
                  <span className="member-dot" />
                </button>
              ))}
            </div>
            <button className="text-button" onClick={() => setModal("lineup")}>
              合成图鉴
              <ArrowRight size={13} />
            </button>
            <p className="album-caption">每局成员随机选定，局内固定。</p>
          </section>
        </aside>
        <div className="play-hint">
          <span className="mouse-hint">
            <MousePointer2 size={13} />
            移动瞄准，点击落下
          </span>
          <span className="touch-hint">
            <ArrowDown size={13} />
            拖动瞄准，松手落下
          </span>
          <span className="keyboard-hint">
            <kbd>←</kbd>
            <kbd>→</kbd> 移动 <i>·</i>
            <kbd>空格</kbd>落下
          </span>
        </div>
      </main>
      <div className="rank-round-status" role="status">
        {submitted ? "本局成绩已提交" : ranked.message}
      </div>
      <footer className="room-footer">
        <p>
          非官方粉丝游戏 <Heart size={10} />
        </p>
        <span>
          角色与头像 © COVER Corp.<i>·</i>
          <a
            href="https://hololive.hololivepro.com/talents/"
            target="_blank"
            rel="noreferrer"
          >
            官方成员介绍
            <ArrowUpRight size={10} />
          </a>
        </span>
      </footer>
      {modal && (
        <Modal
          close={closeModal}
          title={
            modal === "help"
              ? "玩法说明"
              : modal === "restart"
                ? "重新开始？"
                : modal === "over"
                  ? "游戏结束"
                  : modal === "win"
                    ? "已合成最高等级"
                    : modal === "leaderboard"
                      ? "排行榜"
                      : "本局成员"
          }
        >
          {modal === "leaderboard" && (
            <Leaderboard
              canSubmit={!!ranked.session && !submitted && game.drops > 0}
              submitting={submitting}
              result={rankResult}
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
              <p>
                移动鼠标或手指选择位置，点击或松手投放。两个相同成员碰到一起，就会合成下一个更早出道团体的成员。
              </p>
              <p>
                每局为每个团体随机选择一位成员，同局保持一致。新投放的是前三个团体的成员；最高可合成到{" "}
                <b>0 期生</b>，达成后还能继续挑战高分。
              </p>
              <div className="help-controls">
                <span>
                  <MousePointer2 size={18} /> 鼠标移动 / 点击
                </span>
                <span>
                  <ArrowDown size={18} /> 触屏拖动 / 松手
                </span>
                <span>
                  <Keyboard size={18} /> ← → 移动 · 空格投放 · P 暂停
                </span>
              </div>
              <p className="help-warning">
                成员在虚线上方持续堆积约 2
                秒，本局结束。暂停或切到后台时，游戏会停止计时。
              </p>
              <button className="primary-button full" onClick={closeModal}>
                返回游戏 <Play size={15} />
              </button>
            </>
          )}
          {modal === "restart" && (
            <>
              <p>
                本局得分为 <b>{game.score}</b>
                。重新开始会清空棋盘，随机选择新的成员阵容，最高纪录会保留。
              </p>
              <div className="modal-actions">
                <button className="secondary-button" onClick={closeModal}>
                  继续本局
                </button>
                <button className="primary-button" onClick={restart}>
                  重新开始 <RotateCcw size={15} />
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
                  ? `已合成 0 期生：${lineup[10].name}`
                  : "成员持续超过警戒线，本局结束。"}
              </p>
              <div className="result-score">
                <span>本局得分</span>
                <strong>{game.score.toLocaleString()}</strong>
              </div>
              <div className="result-details">
                <span>
                  最高纪录 <b>{best.toLocaleString()}</b>
                </span>
                <span>
                  已到达 <b>{groups[game.highest].name}</b>
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
                    提交成绩
                  </button>
                )}
              <button
                className="primary-button full"
                onClick={modal === "win" ? closeModal : restart}
              >
                {modal === "win" ? "继续游戏" : "再来一局"}{" "}
                <ArrowRight size={16} />
              </button>
            </>
          )}
          {modal === "lineup" && (
            <>
              <p>
                以下按合成顺序排列。两个相同成员合成后，将升级为列表中的下一位。
              </p>
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
                      <strong>{talent.name}</strong>
                      <small>{groups[i].name}</small>
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
