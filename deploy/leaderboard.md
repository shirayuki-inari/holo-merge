# 排行榜部署

前端和后端分别部署，选 Node 或 Cloudflare Workers 中的一种即可；两者使用相同的 API、物理回放与排序规则。已有静态游戏包仍可独立离线游玩。首次加载会尝试连接排行榜，5 秒内不可用则转为离线对局；离线产生的纪录不会补传。

## Node + SQLite

需要 Node **22.13+**（22 系列内置 SQLite 会显示实验提示）或更新的 LTS。SQLite 文件必须位于可持久写入的磁盘，不要放进公开网站目录。

从源码启动：

```sh
npm ci
npm run server:build
PUBLIC_ORIGIN=https://game.example.com DATABASE_PATH=/srv/holo-merge/leaderboard.sqlite npm run server:start
```

或直接解压 `release/holo-merge-node.zip`，配置环境变量后运行 `node node.mjs`，无需安装 npm 依赖。`deploy/leaderboard.env.example` 列出全部配置。使用 systemd、容器或其他进程管理器保持进程运行；开发时可用 `npm run server:dev`。

API 默认监听 `127.0.0.1:8787`。将 `deploy/nginx-leaderboard.conf` 中的 location 加入游戏的 HTTPS server。设置 `PUBLIC_ORIGIN` 为游戏的完整源，例如 `https://game.example.com`，不带路径或末尾斜杠。

若启用 `TRUST_PROXY=1`，反向代理必须覆盖 `X-Real-IP`，并禁止绕过代理直接访问 API，否则保持默认 `0`。默认值使用 socket IP；代理后未启用此选项时，所有玩家会共用代理的 IP 频率额度。不要直接信任客户端的 `X-Forwarded-For`。

容器示例（需要预先构建前端并通过独立静态服务提供）：

```sh
docker build -f deploy/Dockerfile -t holo-merge-api .
docker run -d --name holo-merge-api --restart unless-stopped \
  -p 127.0.0.1:8787:8787 -v holo-merge-data:/app/data \
  -e PUBLIC_ORIGIN=https://game.example.com -e TRUST_PROXY=1 holo-merge-api
```

备份使用 SQLite 的在线备份工具，或停止进程后复制数据库（不要漏掉仍在使用的 WAL 数据）。多进程可共享本地 SQLite，但不适用于不同机器间的网络文件系统。物理校验每 2048 步让出一次事件循环，并在数据库事务外执行，以免长局阻塞所有请求或长期锁住数据库；适合小规模粉丝游戏，扩大流量前可将校验移到作业队列/独立进程。

## Cloudflare Workers + SQLite Durable Object

不需要创建 D1 或 KV。一个 SQLite Durable Object 负责频率限制、对局与排行榜，事务防止并发重复入榜。Wrangler 自动建立命名空间与迁移；不需要额外密钥。

```sh
npm ci
npx wrangler login
# 修改 wrangler.jsonc 中 vars.PUBLIC_ORIGIN 为 https://game.example.com
npm run workers:check
npm run workers:deploy
```

部署后获得 API 地址，例如 `https://holo-merge-leaderboard.<账户>.workers.dev`。也可解压 `release/holo-merge-workers.zip`，编辑其 `wrangler.jsonc` 后运行 `npx wrangler@4 deploy`。该包的入口已打包，不需要安装游戏依赖。

将前端的 `VITE_LEADERBOARD_URL` 设为 API 源，并重新构建前端：

```sh
VITE_LEADERBOARD_URL=https://holo-merge-leaderboard.example.workers.dev npm run package
```

同域 `/api/*` 配置 Worker route 或反向代理时，前端可保留空值。必须把 `PUBLIC_ORIGIN` 设为前端实际源；不要使用 `*`。Workers 和 Node 两个后端的数据库相互独立；切换后端不会自动迁移原排行。

本地联调：`npm run workers:dev`，另开终端 `npm run dev`，访问 `http://localhost:5173`。Vite 自动代理 `/api` 到 8787。若使用 `127.0.0.1` 访问前端，需要同步修改 `PUBLIC_ORIGIN`。

Wrangler/workerd 需要受支持的桌面或 Linux 系统；当前 Android/Termux 环境不能运行 workerd。本地可构建 Worker 并做类型检查，真实 Workers 运行时测试由 Linux CI 执行。生产对局回放在 Durable Object 中执行，CPU 预算与计费以 Cloudflare 的 Durable Objects 当前限制为准，不要依赖普通 Worker 免费请求的 CPU 额度。

## 管理面板

可选启用同域 `/admin/`，展示数据库运行概览并管理排行榜，支持修改原因、审计记录及并发修改检查。不改变原游戏上报数据。Node 设置私有环境变量 `ADMIN_PASSWORD`，Workers 使用 `wrangler secret put ADMIN_PASSWORD`，不少于 16 字符；未配置默认关闭。管理 API 必须与页面同源。详见 [管理面板部署、统计口径与维护](admin.md)。

## 计分、玩家与校验规则

- 浏览器生成 256 位随机凭证，服务端只保存 SHA-256 摘要。名称允许 1–16 个 Unicode 字符，头像必须来自现有 43 位角色。改名/换头像保留身份与最高分；名称允许重复。没有账号恢复功能，清理网站数据会丢失该浏览器身份。
- 排行显示前 50 名，自己即使不在前 50 也能看见名次。只收录正分。分数相同按首次达到该最高分的时间排序，最后以玩家 ID 稳定排序。
- 服务端签发随机种子与绑定玩家的对局 ID，前后端共用固定 120 Hz 的 Matter.js 物理规则。提交的是每次投放的 tick 和横坐标；后端回放后计算得分，忽略客户端的分数字段。修改本地最高分、伪造合成事件或直接提交任意分数都不能入榜。
- 校验投放冷却、位置、时序、游戏结束、有效随机序列和请求体积；**没有 15 分钟计分上限**，实际运行步数只需符合服务端的对局经过时间，暂停不计时。仍保留每次提交最多 **2400 次投放**、请求体最多 **160,000 字节**的容量保护，以及对局凭证签发后 **6 小时**过期的规则；凭证过期后可继续本地游玩，但无法提交本局。最多保留每位玩家最近三局未提交对局。
- 对局仅可结算一次，成绩和对局状态在同一数据库事务中更新。较低分不会覆盖最高分。主动点击“结算本局并提交成绩”会结束本局，也可在游戏结束后提交。
- 每 IP 每分钟最多 240 次请求、120 次写入，每小时最多注册 30 位玩家；每位玩家每小时最多开 60 局、每分钟最多尝试提交 20 次。失败提交也消耗额度。限流状态存入数据库，不能通过重启或跨 isolate 绕过；过期记录按请求清理。仅保存 IP 的摘要限流键。
- CORS 精确匹配前端源，写请求要求 JSON 与身份凭证，SQL 参数绑定，名称作为纯文本渲染，头像不接受外部 URL。上线通过 HTTPS 提供前后端。

这些机制防止篡改分数和明显加速/非法操作；不能证明操作者一定是人，也不能阻止通过合法操作运行的机器人、脚本辅助、代理 IP 或多浏览器身份。需要更强的真人限制时，可在注册/开局前增加 Turnstile 验证或账号登录。前后端物理规则升级必须一起部署并升级协议版本，以免旧对局误判；不同 JS 引擎极端碰撞的浮点分歧也可能使分数存在差异，提交显示服务器实际计算值。

## 校验

```sh
npm run check
npm test
npm run server:build
npm run workers:build
npm run workers:check
# 启动 Node 或 wrangler dev 后：
npm run test:backend
# 同时启动 Vite 后：
npm run test:leaderboard-browser
```

CI 分别对 Node 和 workerd 本地运行时执行相同 HTTP 校验，另外用 Chromium 验证改名、43 个头像、真实对局提交、刷新保持记录和手机布局，并对比浏览器与 Node 的多组物理回放。部署说明依据 [Cloudflare Durable Objects SQLite API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)、[Durable Objects 限制](https://developers.cloudflare.com/durable-objects/platform/limits/) 与 [Node 22 SQLite API](https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html)。
