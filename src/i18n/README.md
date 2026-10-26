# 多语言维护

当前语言：`zh-CN`、`ja`、`en`。无外部语言服务；翻译随前端打包，静态部署和离线游玩均可使用。

## 文案与参数

- `locales/zh-CN.ts` 是消息键和插值参数的类型来源，保持 `as const`。
- `locales/ja.ts`、`locales/en.ts` 使用 `satisfies Messages`，新增键或拼写错误会导致类型检查失败。
- UI 使用 `useI18n()`：`t("game.score")`、`t("game.merged", { name: name(talent) })`。参数名来自中文模板的 `{name}`，调用缺参或错参会报类型错误。
- 翻译整句话，避免拼接不同语序的片段。译文作为普通文本渲染，不接收 HTML。
- 数字使用 `number(value)`；角色名使用 `name(talent)`，团体使用 `group(group)`，稳定数据 ID 不翻译。头像来源、用户自定名称和原始角色录音不翻译。
- 同步覆盖按钮、aria-label、title、占位文字和状态提示。不要只翻译可见标题。
- 异步结果保存结构化内容，在渲染时翻译，避免请求期间切换语言后出现旧语言。

## 新增语言

1. 新建 `locales/<locale>.ts`，按 `Messages` 提供全部消息，保留相同 `{参数名}`。
2. 在 `core.ts` 的 `LANGUAGES` 中加入语言 ID 和本语言名称，并导入、注册 `dictionaries`。如需首次自动匹配，更新 `detectLocale`。
3. 如果语言需要不同的角色名处理，在 `talentName` 中扩展；团体名称通过 `group.<稳定 ID>` 消息维护。
4. 在 `scripts/settings-browser-test.mjs` 的语言场景中加入实际界面及小屏检查。
5. 运行 `npm run check`、`npm test` 和 `npm run test:settings-browser`。CI 对开发页面及解压后的生产包均运行设置和多语言浏览器测试。

`LANGUAGE_KEY`（`holo-merge-language-v1`）只保存有效语言 ID。首次读取浏览器首个受支持的语言，不支持时回退中文。手动选择覆盖浏览器偏好；存储不可用时仍可在当前页面切换。`<html lang>`、标题和 description 随选择更新。

## Canvas 与游戏状态

`I18nProvider` 独立管理语言。`HoloEngine.setLabels()` 只更新渲染文案并立即重绘，包括已暂停的棋盘。不要把语言加入创建游戏引擎或选择阵容的 effect 依赖，这会重置当前游戏。物理模型、随机种子与对局回放不包含语言。

## API 错误

Node 与 Workers 共用 `src/shared/api-errors.ts` 的稳定错误码；API 返回 `{ code, error }`，`error` 为兼容旧客户端保留。前端根据 `code` 渲染 `error.<code>`，不直接展示服务端中文字符串。过渡期间也识别旧后端的已有消息；未知错误用当前语言的通用提示。

新增服务端错误时：在 `API_ERRORS` 增加稳定码，在各语言增加 `error.<code>`，后端通过 `fail(status, code)` 使用。不要以中文/日文/英文内容作为新的业务协议。

## 自动检查

`tests/i18n.test.ts` 检查每种语言键集合、非空译文、插值参数一致、全部 API 错误和团体覆盖。TypeScript 检查 UI 消息键和调用参数。浏览器测试验证手动语言覆盖浏览器偏好、刷新保留、三种语言 320–1280px 布局、Canvas 文字、不重置游戏、实际 BGM 播放、静音持久化、资料编辑和错误翻译。
