import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  History,
  LogOut,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Trophy,
  X,
} from "lucide-react";
import { useI18n } from "../i18n";
import { LANGUAGES, isLocale } from "../i18n/core";
import { groups } from "../game/model";
import type {
  AdminAudit,
  AdminOverview,
  AdminPlayers,
  ManagedPlayer,
} from "../shared/admin";
import { adminText, type AdminMessageKey } from "./messages";
import "./admin.css";
const talents = [
  ...new Map(groups.flatMap((g) => g.members).map((m) => [m.id, m])).values(),
];
class RequestError extends Error {
  constructor(
    public code: string,
    public status = 0,
  ) {
    super(code);
  }
}
type RequestApi = <T>(
  path: string,
  method?: string,
  body?: unknown,
) => Promise<T>;
function useText() {
  const { locale } = useI18n();
  return (key: AdminMessageKey) => adminText(locale, key);
}
function useData<T>(path: string, api: RequestApi, revision: number) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<T>(path)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(e instanceof RequestError ? e.code : "network");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, api, revision]);
  return { data, error, loading };
}
function ErrorNotice({ code }: { code: string }) {
  const { locale } = useI18n();
  return code ? (
    <p role="alert" className="admin-error">
      {adminText(locale, code)}
    </p>
  ) : null;
}
function Empty({ loading }: { loading: boolean }) {
  const t = useText();
  return <p className="admin-empty">{t(loading ? "loading" : "noData")}</p>;
}
function Avatar({ id }: { id: string }) {
  const { name } = useI18n();
  const talent = talents.find((m) => m.id === id);
  return talent ? (
    <img
      className="portrait admin-avatar"
      src={talent.image}
      alt={name(talent)}
      loading="lazy"
    />
  ) : null;
}
function Pager({
  page,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  const t = useText(),
    { number } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="admin-pager">
      <span>
        {t("total")} {number(total)} {t("rows")}
      </span>
      <div>
        <button
          type="button"
          className="icon-button"
          aria-label={t("previous")}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft size={17} />
        </button>
        <span>
          {page} / {pages}
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label={t("next")}
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  );
}
function Overview({ api, revision }: { api: RequestApi; revision: number }) {
  const { data, error, loading } = useData<AdminOverview>(
    "overview",
    api,
    revision,
  );
  const t = useText(),
    { number, locale } = useI18n();
  if (!data)
    return (
      <>
        <ErrorNotice code={error} />
        <Empty loading={loading} />
      </>
    );
  const max = Math.max(
    1,
    ...data.days.flatMap((d) => [d.players, d.started || 0]),
  );
  const distMax = Math.max(1, ...data.distribution.map((d) => d.count));
  const primary: [
    [AdminMessageKey, number],
    [AdminMessageKey, number],
    [AdminMessageKey, number],
    [AdminMessageKey, number],
  ] = [
    ["players", data.totals.players],
    ["ranked", data.totals.ranked],
    ["highest", data.totals.highest],
    ["started", data.period.started],
  ];
  return (
    <>
      <ErrorNotice code={error} />
      <div className="admin-section-heading">
        <p>{t("overviewHint")}</p>
        <time dateTime={new Date(data.now).toISOString()}>
          {t("updated")} · {new Date(data.now).toLocaleString(locale)}
        </time>
      </div>
      <div className="admin-metrics">
        {primary.map(([label, value]) => (
          <article className="admin-card admin-metric" key={label}>
            <span>
              {t(label)}
              {label === "started" && <small>{t("fourteen")}</small>}
            </span>
            <strong
              className={
                number(value).length > 8 ? "admin-large-number" : undefined
              }
            >
              {number(value)}
            </strong>
          </article>
        ))}
      </div>
      <section className="admin-card admin-activity">
        <div className="admin-card-heading">
          <h2>{t("activity")}</h2>
          <span>
            {t("fourteen")} · {t("utc")}
          </span>
        </div>
        <div className="admin-chart-legend">
          <span className="new">{t("newPlayers")}</span>
          <span className="started">{t("started")}</span>
        </div>
        <div
          className="admin-chart"
          role="img"
          aria-label={`${t("activity")} · ${t("fourteen")}`}
        >
          {data.days.map((d) => (
            <div
              className="admin-chart-day"
              key={d.day}
              title={`${d.day} UTC\n${t("newPlayers")}: ${d.players}\n${t("started")}: ${d.started ?? t("none")}\n${t("accepted")}: ${d.accepted ?? t("none")}\n${t("rejected")}: ${d.rejected ?? t("none")}`}
            >
              <div className="admin-chart-bars">
                <i
                  className="new"
                  style={{ height: `${(d.players / max) * 100}%` }}
                />
                <i
                  className={`started${d.started === null ? " unknown" : ""}`}
                  style={{
                    height:
                      d.started === null
                        ? "100%"
                        : `${(d.started / max) * 100}%`,
                  }}
                />
              </div>
              <span>{d.day.slice(5).replace("-", "/")}</span>
            </div>
          ))}
        </div>
        <div className="admin-secondary-metrics">
          {(
            [
              ["accepted", data.period.accepted],
              ["rejected", data.period.rejected],
              ["averageScore", Math.round(data.period.averageScore)],
              ["outstanding", data.totals.outstanding],
            ] as const
          ).map(([key, value]) => (
            <div key={key}>
              <span>
                {t(key)}
                {key !== "outstanding" && <small>{t("fourteen")}</small>}
              </span>
              <strong>
                {key === "averageScore" && !data.period.accepted
                  ? t("none")
                  : number(value)}
              </strong>
            </div>
          ))}
        </div>
        <p className="admin-note">
          {t("source")} · {new Date(data.metricsSince).toLocaleString(locale)}
          <br />
          {t("beforeStats")} {t("limits")}
        </p>
        <details className="admin-details">
          <summary>{t("exact")}</summary>
          <div className="admin-table-wrap">
            <table>
              <thead>
                <tr>
                  {[
                    "date",
                    "newPlayers",
                    "started",
                    "accepted",
                    "rejected",
                  ].map((k) => (
                    <th key={k}>{t(k as AdminMessageKey)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.days.map((d) => (
                  <tr key={d.day}>
                    <td>{d.day}</td>
                    {[d.players, d.started, d.accepted, d.rejected].map(
                      (v, i) => (
                        <td key={i}>{v === null ? t("none") : number(v)}</td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
      <div className="admin-two-columns">
        <section className="admin-card">
          <div className="admin-card-heading">
            <h2>{t("distribution")}</h2>
            <span>{t("current")}</span>
          </div>
          <div className="admin-distribution">
            {data.distribution.map((d) => (
              <div key={d.bucket}>
                <span>{d.bucket === "0" ? t("scoreZero") : d.bucket}</span>
                <div>
                  <i style={{ width: `${(d.count / distMax) * 100}%` }} />
                </div>
                <strong>{number(d.count)}</strong>
              </div>
            ))}
          </div>
          <p className="admin-note">
            {t("averageBest")} ·{" "}
            {data.totals.ranked
              ? number(Math.round(data.totals.averageBest))
              : t("none")}
          </p>
        </section>
        <section className="admin-card">
          <div className="admin-card-heading">
            <h2>{t("top")}</h2>
            <Trophy size={16} />
          </div>
          {data.top.length ? (
            <ol className="admin-top">
              {data.top.map((p) => (
                <li key={p.id}>
                  <span>{p.rank}</span>
                  <Avatar id={p.avatar} />
                  <span>{p.name}</span>
                  <strong>{number(p.best)}</strong>
                </li>
              ))}
            </ol>
          ) : (
            <Empty loading={false} />
          )}
        </section>
      </div>
    </>
  );
}
function Editor({
  player,
  reset,
  api,
  onClose,
  onSaved,
}: {
  player: ManagedPlayer;
  reset: boolean;
  api: RequestApi;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useText(),
    { name: talentName, locale } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(player.name),
    [avatar, setAvatar] = useState(player.avatar),
    [score, setScore] = useState(String(reset ? 0 : player.best)),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`players/${player.id}`, "PATCH", {
        action: reset ? "reset" : "edit",
        name,
        avatar,
        best: Number(score),
        reason,
        expected: player,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof RequestError ? e.code : "network");
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="modal admin-editor"
      aria-labelledby="editor-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit} className="admin-form">
        <div className="admin-card-heading">
          <h2 id="editor-title">{t(reset ? "resetTitle" : "editTitle")}</h2>
          <button
            type="button"
            className="icon-button"
            aria-label={t("cancel")}
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <p className="admin-id">{player.id}</p>
        {reset ? (
          <p className="admin-reset-description">
            <strong>
              {player.name} · {player.best.toLocaleString(locale)} → 0
            </strong>
            <br />
            {t("resetHint")}
          </p>
        ) : (
          <>
            <label>
              {t("name")}
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                maxLength={32}
              />
            </label>
            <label>
              {t("avatar")}
              <span className="admin-avatar-field">
                <Avatar id={avatar} />
                <select
                  aria-label={t("avatar")}
                  value={avatar}
                  onChange={(e) => setAvatar(e.target.value)}
                >
                  {talents.map((m) => (
                    <option key={m.id} value={m.id}>
                      {talentName(m)}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            <label>
              {t("score")}
              <input
                required
                type="number"
                min="0"
                max="2147483647"
                step="1"
                value={score}
                onChange={(e) => setScore(e.target.value)}
              />
            </label>
            <p className="admin-note">{t("scoreHint")}</p>
          </>
        )}
        <label>
          {t("reason")}
          <textarea
            required
            maxLength={400}
            rows={3}
            placeholder={t("reasonHint")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <ErrorNotice code={error} />
        <div className="admin-form-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onClose}
          >
            {t("cancel")}
          </button>
          <button
            className={`primary-button${reset ? " admin-danger" : ""}`}
            disabled={busy || !reason.trim()}
          >
            {t(busy ? "loading" : reset ? "confirmReset" : "save")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
function Players({
  api,
  revision,
  changed,
}: {
  api: RequestApi;
  revision: number;
  changed: () => void;
}) {
  const t = useText(),
    { number, locale } = useI18n();
  const [input, setInput] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("ranked"),
    [page, setPage] = useState(1),
    [editor, setEditor] = useState<{ player: ManagedPlayer; reset: boolean }>();
  const { data, error, loading } = useData<AdminPlayers>(
    `players?${new URLSearchParams({ search, filter, page: String(page) })}`,
    api,
    revision,
  );
  return (
    <>
      <section className="admin-card admin-player-panel">
        <form
          className="admin-search"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(input.trim());
            setPage(1);
          }}
        >
          <label className="admin-search-input">
            <span className="visually-hidden">{t("search")}</span>
            <input
              type="search"
              placeholder={t("search")}
              value={input}
              maxLength={100}
              onChange={(e) => setInput(e.target.value)}
            />
          </label>
          <button className="secondary-button">{t("searchButton")}</button>
          <label className="admin-filter">
            <span>{t("filter")}</span>
            <select
              aria-label={t("filter")}
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(1);
              }}
            >
              {["ranked", "all", "unranked"].map((f) => (
                <option key={f} value={f}>
                  {t(f as AdminMessageKey)}
                </option>
              ))}
            </select>
          </label>
        </form>
        <ErrorNotice code={error} />
        {loading ? (
          <Empty loading />
        ) : data?.players.length ? (
          <div className="admin-table-wrap">
            <table className="admin-players-table">
              <thead>
                <tr>
                  {[
                    "rank",
                    "name",
                    "score",
                    "bestAt",
                    "created",
                    "actions",
                  ].map((k) => (
                    <th key={k}>{t(k as AdminMessageKey)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.players.map((p) => (
                  <tr key={p.id}>
                    <td>{p.rank ?? t("none")}</td>
                    <td>
                      <div className="admin-player">
                        <Avatar id={p.avatar} />
                        <span>
                          <strong>{p.name}</strong>
                          <small title={p.id}>{p.id}</small>
                        </span>
                      </div>
                    </td>
                    <td className="admin-score">{number(p.best)}</td>
                    <td>
                      {p.best_at
                        ? new Date(p.best_at).toLocaleString(locale)
                        : t("none")}
                    </td>
                    <td>{new Date(p.created).toLocaleDateString(locale)}</td>
                    <td>
                      <div className="admin-row-actions">
                        <button
                          type="button"
                          onClick={() => setEditor({ player: p, reset: false })}
                        >
                          <Pencil size={13} />
                          {t("edit")}
                        </button>
                        <button
                          type="button"
                          className="admin-reset"
                          disabled={!p.best}
                          onClick={() => setEditor({ player: p, reset: true })}
                        >
                          {t("reset")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty loading={false} />
        )}
        {data && (
          <Pager
            page={page}
            total={data.total}
            pageSize={data.pageSize}
            onPage={setPage}
          />
        )}
      </section>
      {editor && (
        <Editor
          key={editor.player.id}
          {...editor}
          api={api}
          onClose={() => setEditor(undefined)}
          onSaved={() => {
            setEditor(undefined);
            changed();
          }}
        />
      )}
    </>
  );
}
function Audit({ api, revision }: { api: RequestApi; revision: number }) {
  const t = useText(),
    { locale, number } = useI18n();
  const [page, setPage] = useState(1);
  const { data, error, loading } = useData<AdminAudit>(
    `audit?page=${page}`,
    api,
    revision,
  );
  const snapshot = (json: string) => {
    try {
      const p = JSON.parse(json) as ManagedPlayer;
      const m = talents.find((m) => m.id === p.avatar);
      return (
        <>
          <span>
            {p.name} · {number(p.best)}
          </span>
          <small>{m ? (locale === "en" ? m.en : m.name) : p.avatar}</small>
        </>
      );
    } catch {
      return t("none");
    }
  };
  return (
    <section className="admin-card">
      <ErrorNotice code={error} />
      {loading ? (
        <Empty loading />
      ) : data?.entries.length ? (
        <div className="admin-table-wrap">
          <table className="admin-audit-table">
            <thead>
              <tr>
                {["date", "operator", "before", "after", "reason"].map((k) => (
                  <th key={k}>{t(k as AdminMessageKey)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.created).toLocaleString(locale)}</td>
                  <td>
                    {t(e.action === "reset" ? "reset" : "edit")}
                    <small title={e.player_id}>{e.player_id}</small>
                  </td>
                  <td>{snapshot(e.before_json)}</td>
                  <td>{snapshot(e.after_json)}</td>
                  <td>{e.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty loading={false} />
      )}
      {data && (
        <Pager
          page={page}
          total={data.total}
          pageSize={data.pageSize}
          onPage={setPage}
        />
      )}
    </section>
  );
}
export default function Admin() {
  const { locale, setLocale } = useI18n(),
    t = useText();
  const [session, setSession] = useState<{
      csrf: string;
      expires: number;
    } | null>(),
    [tab, setTab] = useState("overview"),
    [revision, setRevision] = useState(0),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(false);
  const api = useCallback<RequestApi>(
    async (path, method = "GET", body) => {
      let response: Response;
      try {
        response = await fetch(`/api/admin/${path}`, {
          method,
          credentials: "same-origin",
          headers: {
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
            ...(method !== "GET" && session
              ? { "X-Admin-CSRF": session.csrf }
              : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
      } catch {
        throw new RequestError("network");
      }
      const result = await response
        .json()
        .catch(() => ({ code: "unavailable" }));
      if (!response.ok) {
        if (response.status === 401 && path !== "login") {
          setSession(null);
          setError("unauthorized");
        }
        throw new RequestError(result.code || "unavailable", response.status);
      }
      return result;
    },
    [session],
  );
  useEffect(() => {
    let active = true;
    fetch("/api/admin/session", { credentials: "same-origin" })
      .then(async (r) => {
        if (!active) return;
        if (r.ok) setSession(await r.json());
        else {
          setSession(null);
          if (r.status !== 401)
            setError((await r.json()).code || "unavailable");
        }
      })
      .catch(() => {
        if (active) {
          setSession(null);
          setError("network");
        }
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    document.title = `${t("title")} · holo merge!`;
  }, [locale]);
  useEffect(() => {
    document.querySelector('meta[name="robots"]')?.remove();
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex,nofollow";
    document.head.append(meta);
    return () => meta.remove();
  }, []);
  async function login(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setSession(
        await api<{ csrf: string; expires: number }>("login", "POST", {
          password,
        }),
      );
      setPassword("");
    } catch (e) {
      setError(e instanceof RequestError ? e.code : "network");
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await api("logout", "POST", {});
      setSession(null);
      setNotice(false);
      setError("");
    } catch (e) {
      setError(e instanceof RequestError ? e.code : "network");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div className="brand">
          <a className="brand-tile" href="/" aria-label={t("back")}>
            <span className="brand-mark" />
          </a>
          <div>
            <h1>
              holo<span>merge!</span>
            </h1>
            <p>{t("title")}</p>
          </div>
        </div>
        <div className="admin-header-actions">
          <label>
            <span className="visually-hidden">{t("language")}</span>
            <select
              aria-label={t("language")}
              value={locale}
              onChange={(e) => {
                if (isLocale(e.target.value)) setLocale(e.target.value);
              }}
            >
              {LANGUAGES.map((l) => (
                <option value={l.id} key={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <a className="secondary-button" href="/">
            {t("back")}
          </a>
          {session && (
            <button
              className="icon-button"
              title={t("logout")}
              aria-label={t("logout")}
              disabled={busy}
              onClick={logout}
            >
              <LogOut size={18} />
            </button>
          )}
        </div>
      </header>
      {session === undefined ? (
        <Empty loading />
      ) : session ? (
        <>
          <div className="admin-navigation">
            <nav aria-label={t("title")}>
              {(
                [
                  ["overview", BarChart3],
                  ["rankings", Trophy],
                  ["audit", History],
                ] as const
              ).map(([key, Icon]) => (
                <button
                  type="button"
                  key={key}
                  aria-current={tab === key ? "page" : undefined}
                  onClick={() => {
                    setTab(key);
                    setNotice(false);
                  }}
                >
                  <Icon size={16} />
                  {t(key)}
                </button>
              ))}
            </nav>
            <button
              type="button"
              className="icon-button"
              aria-label={t("refresh")}
              title={t("refresh")}
              onClick={() => {
                setRevision((r) => r + 1);
                setNotice(false);
              }}
            >
              <RefreshCw size={17} />
            </button>
          </div>
          <ErrorNotice code={error} />
          {notice && (
            <p role="status" className="admin-success">
              {t("saved")}
            </p>
          )}
          {tab === "overview" ? (
            <Overview api={api} revision={revision} />
          ) : tab === "rankings" ? (
            <Players
              api={api}
              revision={revision}
              changed={() => {
                setRevision((r) => r + 1);
                setNotice(true);
              }}
            />
          ) : (
            <Audit api={api} revision={revision} />
          )}
          <footer className="admin-footer">
            {t("sessionUntil")} ·{" "}
            {new Date(session.expires).toLocaleString(locale)}
          </footer>
        </>
      ) : (
        <section className="admin-card admin-login">
          <ShieldCheck size={27} />
          <h2>{t("login")}</h2>
          <p>{t("loginHint")}</p>
          <form className="admin-form" onSubmit={login}>
            <label>
              {t("password")}
              <input
                type="password"
                autoComplete="current-password"
                required
                maxLength={1024}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <ErrorNotice code={error} />
            <button className="primary-button" disabled={busy || !password}>
              {t(busy ? "loading" : "signIn")}
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
