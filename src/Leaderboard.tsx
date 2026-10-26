import { useEffect, useState } from "react";
import { ArrowUp, Check, RotateCcw, Trophy } from "lucide-react";
import { groups } from "./game/model";
import {
  connectPlayer,
  saveProfile,
  leaderboardErrorText,
  type Board,
} from "./leaderboard-client";
import { useI18n } from "./i18n";
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
  const { t, name: talentName, number } = useI18n();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(talents[0].id);
  const [editing, setEditing] = useState(false);
  const [reload, setReload] = useState(0);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError(null);
    connectPlayer()
      .then((data) => {
        if (active) {
          setBoard(data);
          setName(data.me?.name || "");
          setAvatar(data.me?.avatar || talents[0].id);
        }
      })
      .catch((e) => {
        if (active) setError(e);
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
    setError(null);
    setSaved(false);
    try {
      setBoard(await saveProfile(name, avatar));
      setEditing(false);
      setSaved(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="leaderboard">
      <p>{t("board.description")}</p>
      {board?.me && (
        <div className="player-summary">
          <img
            className="portrait"
            src={byId.get(board.me.avatar)?.image}
            alt={t("board.avatar")}
          />
          <div>
            <strong>{board.me.name}</strong>
            <small>
              {board.me.rank
                ? t("board.rank", {
                    rank: number(board.me.rank),
                    score: number(board.me.score),
                  })
                : t("board.noScore")}
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
            {t("board.edit")}
          </button>
        </div>
      )}
      {editing && (
        <form className="profile-form" onSubmit={save}>
          <label htmlFor="player-name">{t("board.name")}</label>
          <input
            id="player-name"
            autoComplete="nickname"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
            required
            placeholder={t("board.nameHint")}
          />
          <fieldset>
            <legend>{t("board.choose")}</legend>
            <div className="avatar-picker">
              {talents.map((talent) => (
                <button
                  type="button"
                  key={talent.id}
                  className={avatar === talent.id ? "selected" : ""}
                  aria-label={t("board.chooseAvatar", {
                    name: talentName(talent),
                  })}
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
            {busy ? t("board.saving") : t("board.save")}
          </button>
        </form>
      )}
      {saved && (
        <p role="status" className="rank-feedback">
          {t("board.saved")}
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
          {submitting ? t("board.verifying") : t("board.submit")}
        </button>
      )}
      {canSubmit && <p className="rank-help">{t("board.submitHelp")}</p>}
      {error !== null && (
        <p role="alert" className="rank-error">
          {leaderboardErrorText(error, t)}
        </p>
      )}
      <div className="rank-heading">
        <span>
          <Trophy size={14} /> {t("board.best")}
        </span>
        <button
          className="icon-button"
          aria-label={t("board.refresh")}
          disabled={busy || submitting}
          onClick={() => setReload((v) => v + 1)}
        >
          <RotateCcw size={14} />
        </button>
      </div>
      {busy && !board && <p role="status">{t("board.loading")}</p>}
      {board && !board.entries.length && (
        <p className="rank-empty">{t("board.empty")}</p>
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
                {entry.id === board.me?.id && <small>{t("board.me")}</small>}
              </span>
              <strong>{number(entry.score)}</strong>
            </li>
          ))}
        </ol>
      )}
      <p className="rank-help">{t("board.identity")}</p>
    </div>
  );
}
