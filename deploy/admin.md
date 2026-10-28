# 管理面板

访问与游戏同域的 `/admin/`，主游戏页面不增加入口。Node 和 Workers 使用相同接口与数据库迁移；不改变游戏客户端原有的请求、身份凭证、回放格式或计分规则。

## 启用与登录

服务端环境变量 `ADMIN_PASSWORD` 至少 16 个字符，推荐使用密码管理器生成 32 个以上随机字符。不设置、少于 16 个字符，或在非本机 HTTP 源运行时，管理 API 返回 503，默认关闭。不要把此变量放入 `VITE_*`、提交到 Git、传入前端构建或公开静态目录。

Node 可通过权限为 `0600` 的 systemd `EnvironmentFile` 注入。修改后重启服务；修改密码会立即使所有旧登录失效。SQLite 必须持久化，数据库应由服务用户写入。

Workers 使用 `npx wrangler secret put ADMIN_PASSWORD` 设置 secret，不能在 `wrangler.jsonc` 的公开 `vars` 中放生产密码。本地在被 Git 忽略的 `.dev.vars` 设置。管理面板必须通过 Worker route 或反向代理使 `/api/admin/*` 与页面同源，不能直接通过另一域名的 API 登录；游戏排行榜原有跨源配置仍可使用。

登录会话有效 12 小时，数据库仅保存随机会话凭证的 SHA-256 摘要。生产 Cookie 使用 `__Host-` 前缀、`HttpOnly; Secure; SameSite=Strict; Path=/`。本机 localhost/127.0.0.1 HTTP 联调使用普通 HttpOnly Cookie。密码与会话凭证不保存在浏览器 localStorage。最多保留 8 个登录会话。

所有管理写操作必须有精确匹配的 Origin；登录以外还要求会话绑定的 `X-Admin-CSRF`。登录按 IP 每 15 分钟限 10 次、全局每 15 分钟限 200 次；管理接口独立按 IP 每分钟限 180 次，计数存入数据库。游戏凭证不能访问管理接口。建议反向代理对 `/admin/` 配置 `Cache-Control: no-store`、`X-Robots-Tag: noindex, nofollow`、`X-Frame-Options: DENY` 和 `Content-Security-Policy: frame-ancestors 'none'`。

## 数据口径

- 玩家总数：`players` 当前记录数，包括未上榜的浏览器身份。不是唯一自然人数。
- 已上榜玩家、最高分、最高分分布、上榜平均分、前五名：数据库当前 `best > 0` 的记录。管理员修改会反映在这些数据中。
- 新增玩家：根据 `players.created` 按 UTC 日汇总；历史注册数据可显示。
- 对局申请：服务端成功签发对局凭证的次数。不是实际开始/完成局数。
- 通过提交：已登录玩家的回放通过校验并成功结算的次数，包括 0 分和未刷新最高分的成绩。平均提交分仅使用这些服务端计算的成绩，不包括管理员手动分数。
- 拒绝提交：已识别玩家在提交处理时返回失败的次数，包含重复、过期和回放无效等情况。未登录、无法解析请求体及身份识别前的限流失败不计入。不是作弊次数。
- 未过期凭证：数据库中未使用且尚未过期的凭证数，包含已经离开的页面，不代表在线人数。
- 对局统计和平均提交分只统计新版本部署启用之后的数据，按 UTC 日累计到 `daily_metrics`，不受原有对局凭证过期清理影响。首日为部分数据；启用前日期以 `—` 表示，而不是 0。不从已有最高分反推历史提交。概览展示最近 14 个 UTC 日期，其他历史日累计继续保留。
- 客户端没有新增遥测。面板不展示无法由现有数据得出的在线人数、实际游玩时长、留存率、访问量或设备分布。

## 排行榜修改

支持分页、名称或完整玩家 ID 搜索、已上榜/未上榜/全部筛选。每次编辑要求填写 1–200 字原因，可调整名称、已有角色头像及最高分（0–2,147,483,647 的整数）。名称和头像仍使用游戏原有校验。

分数变动时最高分时间更新为修改时间；归零时清除时间。同分继续按最高分时间、玩家 ID 排序。仅改名或换头像不改变最高分时间。

“清除排名”将最高分归零，保留玩家凭证与身份。玩家之后正常提交仍可再次入榜；这不是封禁或删除账号。

客户端编辑表单携带读取时的名称、头像、最高分与最高分时间。服务端在同一数据库事务内对比，发现玩家自改资料、新成绩或其他管理员修改时返回 409，要求刷新重试；不会静默覆盖新数据。管理员更新与修改记录在同一事务写入，任何一步失败都回滚。

`admin_audit` 保存玩家 ID、操作、修改前后资料/成绩、原因和时间，不保存玩家 token 摘要、管理密码或会话令牌。当前为单一管理员密码；日志不区分不同管理者。所有修改记录只在登录后可见，不提供删除接口。

新增表：`admin_meta`（统计起始时间）、`daily_metrics`、`admin_sessions`、`admin_audit`。只增表与索引，不重建玩家或对局表，旧客户端兼容。部署前使用现有 SQLite 在线备份；回滚旧代码时保留这些表与在线玩家数据。数据库备份包含管理会话与日志，应保持私有。

## 维护与验证

前端按 `/admin/` 路径单独加载管理代码和 CSS，不加载棋盘、BGM 或角色语音。`dist/admin/index.html` 支持目录式静态托管。三语言文案位于 `src/admin/messages.ts`，键完整性由类型检查和单元测试保证。

```sh
npm run check
npm test
# 本地数据库专用于测试，不要对生产数据执行以下写入测试
ADMIN_PASSWORD=test-only-administrator-password DATABASE_PATH=.qa/admin.sqlite PUBLIC_ORIGIN=http://127.0.0.1:5175 npm run server:dev
npm run dev -- --host 127.0.0.1 --port 5175 --strictPort
# 另开终端
npm run test:admin
BASE_URL=http://127.0.0.1:5175 npm run test:admin-browser
```

Node 与 workerd 的 HTTP 测试验证认证、Cookie、CSRF、概览、编辑、清除、冲突与审计；浏览器测试覆盖完整管理操作、修改即时影响公开榜单、三语言、320–1280px 布局、会话恢复与退出，以及管理页面不加载游戏音频。

安全实现参考：[MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie)、[OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)。
