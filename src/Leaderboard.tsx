import { useEffect, useState } from "react";
import { ArrowUp, Check, RotateCcw, Trophy } from "lucide-react";
import { groups } from "./game/model";
import { connectPlayer, saveProfile, type Board } from "./leaderboard-client";
const talents = [
  ...new Map(groups.flatMap((g) => g.members).map((m) => [m.id, m])).values(),
];
const byId = new Map(talents.map((m) => [m.id, m]));
export default function Leaderboard({
  canSubmit,
  submitting,
  result,
  submit,
  reloadKey,
}: {
  canSubmit: boolean;
  submitting: boolean;
  result: string;
  submit: () => void;
  reloadKey: number;
}) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(talents[0].id);
  const [editing, setEditing] = useState(false);
  const [reload, setReload] = useState(0);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    connectPlayer()
      .then((data) => {
        if (active) {
          setBoard(data);
          setName(data.me?.name || "");
          setAvatar(data.me?.avatar || talents[0].id);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [reload, reloadKey]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      setBoard(await saveProfile(name, avatar));
      setEditing(false);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="leaderboard">
      <p>按每位玩家的最高得分排序，显示前 50 名。</p>
      {board?.me && (
        <div className="player-summary">
          <img
            className="portrait"
            src={byId.get(board.me.avatar)?.image}
            alt="我的头像"
          />
          <div>
            <strong>{board.me.name}</strong>
            <small>
              {board.me.rank
                ? `第 ${board.me.rank} 名 · ${board.me.score.toLocaleString()} 分`
                : "暂无上榜成绩"}
            </small>
          </div>
          <button
            className="text-button"
            onClick={() => {
              setEditing((v) => !v);
              setSaved(false);
            }}
            aria-expanded={editing}
          >
            修改资料
          </button>
        </div>
      )}
      {editing && (
        <form className="profile-form" onSubmit={save}>
          <label htmlFor="player-name">玩家名称</label>
          <input
            id="player-name"
            autoComplete="nickname"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
            required
            placeholder="1–16 个字"
          />
          <fieldset>
            <legend>选择角色头像</legend>
            <div className="avatar-picker">
              {talents.map((talent) => (
                <button
                  type="button"
                  key={talent.id}
                  className={avatar === talent.id ? "selected" : ""}
                  aria-label={`选择头像：${talent.name}`}
                  aria-pressed={avatar === talent.id}
                  onClick={() => setAvatar(talent.id)}
                >
                  <img
                    className="portrait"
                    src={talent.image}
                    alt=""
                    loading="lazy"
                  />
                  {avatar === talent.id && <Check size={12} />}
                </button>
              ))}
            </div>
          </fieldset>
          <button className="primary-button full" disabled={busy}>
            {busy ? "保存中…" : "保存资料"}
          </button>
        </form>
      )}
      {saved && (
        <p role="status" className="rank-feedback">
          资料已保存。
        </p>
      )}
      {result && (
        <p role="status" className="rank-feedback">
          {result}
        </p>
      )}
      {canSubmit && (
        <button
          className="primary-button full submit-score"
          disabled={submitting || busy || !board?.me}
          onClick={submit}
        >
          <ArrowUp size={15} />
          {submitting ? "正在校验成绩…" : "结算本局并提交成绩"}
        </button>
      )}
      {canSubmit && (
        <p className="rank-help">提交后本局结束，以服务器校验的得分为准。</p>
      )}
      {error && (
        <p role="alert" className="rank-error">
          {error}
        </p>
      )}
      <div className="rank-heading">
        <span>
          <Trophy size={14} /> 最高得分
        </span>
        <button
          className="icon-button"
          aria-label="刷新排行榜"
          disabled={busy || submitting}
          onClick={() => setReload((v) => v + 1)}
        >
          <RotateCcw size={14} />
        </button>
      </div>
      {busy && !board && <p role="status">正在加载排行榜…</p>}
      {board && !board.entries.length && (
        <p className="rank-empty">暂无成绩，完成一局后提交即可上榜。</p>
      )}
      {board && (
        <ol className="rank-list">
          {board.entries.map((entry) => (
            <li
              key={entry.id}
              className={entry.id === board.me?.id ? "is-me" : ""}
            >
              <span className="rank-number">{entry.rank}</span>
              <img
                className="portrait"
                src={byId.get(entry.avatar)?.image}
                alt=""
              />
              <span className="rank-name">
                {entry.name}
                {entry.id === board.me?.id && <small>我</small>}
              </span>
              <strong>{entry.score.toLocaleString()}</strong>
            </li>
          ))}
        </ol>
      )}
      <p className="rank-help">
        玩家身份保存在此浏览器，清除网站数据后无法找回原纪录。
      </p>
    </div>
  );
}
