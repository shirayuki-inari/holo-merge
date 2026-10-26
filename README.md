# holo merge! / ホロマージ

[![CI](https://github.com/shirayuki-inari/holo-merge/actions/workflows/ci.yml/badge.svg)](https://github.com/shirayuki-inari/holo-merge/actions/workflows/ci.yml)

使用 **React 19 + TypeScript + Vite** 实现的 hololive 日本成员合成游戏。新游戏独立实现；本地参考目录 `daxigua-1.0.0/` 不纳入此仓库。

## 运行

需要 Node.js 22.13+；推荐使用当前 Node LTS。

```sh
npm install
npm run dev
```

打开终端显示的地址，默认 `http://localhost:5173`。开发服务器监听局域网，可用同一网络的手机访问终端输出的 Network 地址。

```sh
npm test          # 成员数据、图片、等级规则及投放边界验证
npm run build    # TypeScript 检查及生产构建，产物位于 dist/
npm run preview  # 预览生产构建
```

## 玩法

- 鼠标移动瞄准，点击投放；手机拖动瞄准，松手投放。
- 聚焦棋盘后，按 `←` / `→` 移动，`空格` / `Enter` 投放，`P` 暂停。
- 每局为每个团体随机选定一位成员，该局保持一致；兼属不同团体的成员不会在一局内重复出现。
- 两位同级成员碰撞后合成下一级成员，按照团体从新到旧排列：

  アソビ★まわり隊！ → FLOW GLOW → ReGLOSS → holoX → 5 期生 → 4 期生 → 3 期生 → GAMERS → 2 期生 → 1 期生 → 0 期生。

- 随机投放前三个团体的成员。首次合成到 0 期生会显示达成提示，可以继续挑战高分；最高级成员保留在场内。
- 新投放的成员有 1.6 秒入场宽限；之后若任何成员越过虚线持续 2.2 秒，本局结束。回落到线下可解除警告。
- 暂停、查看弹窗、切换到后台会停止物理模拟和计时。最高分保存在浏览器本地。

## 排行榜

右上角奖杯打开排行榜，可输入 1–16 字名称，从现有 43 位成员中选择头像。每个浏览器拥有独立玩家身份，按玩家最高分排序；改名/换头像保留纪录。显示前 50 名和自己的名次，同分按首次达到的时间排序。

联网开局会获得服务器种子。游戏结束后提交，或从排行榜点击“结算本局并提交成绩”；提交会结束本局。后端回放投放操作并计算得分，配合身份绑定、一次结算、时间/频率校验、请求限制与持久化限流。不能仅靠修改浏览器分数上榜；合法操作的机器人不在保证范围内。

支持 **Node + SQLite** 和 **Cloudflare Workers + SQLite Durable Object** 两种部署，详见 [排行榜部署说明](deploy/leaderboard.md)。默认使用同域 `/api`；跨域部署前设置 `.env.example` 的 `VITE_LEADERBOARD_URL`。本地可运行 `npm run server:dev`（端口 8787），Vite 自动代理 API；也可用 `npm run workers:dev`。后端不可用时可继续离线玩，离线纪录不会补传。排行榜没有 15 分钟计分上限；对局凭证签发 6 小时后过期。

## 设置与语言

右上角齿轮打开设置，主页面保留排行榜、设置、玩法三个入口。可选择 BGM **01 / 02 / 03**，分别开关背景音乐与角色语音，并手动切换简体中文、日本語、English。所有设置保存在当前浏览器。首次根据浏览器语言选择，手动选择优先；语言变化即时生效，保留当前棋盘、成员阵容和得分。角色录音保留原音，不随界面语言更换。

多语言包含游戏、Canvas 警戒线、说明、结算、排行榜、头像选择、错误提示、无障碍标签及页面标题和描述。英文使用成员数据已有的英文名；用户自定名称不翻译。[多语言维护说明](src/i18n/README.md) 记录新增语言、翻译参数、错误码与验证方法。

## 实现

- Matter.js 圆形刚体，固定 **120 Hz** 物理步进、基于 `requestAnimationFrame` 绘制；帧延迟截断，避免后台恢复时模拟突跳。
- Canvas 2D 渲染，圆形头像和静态背景预绘制，DPR 上限为 2；React 只订阅分数、投放、合成及状态变化，不参与逐帧动画。
- 开启刚体休眠，碰撞合成在物理步进后统一处理；消耗刚体立即移除，避免一次碰撞被重复合成。
- 暂停和后台时取消动画帧。销毁时清理物理世界、事件监听和 ResizeObserver。
- BGM 使用从 `/sdcard/BGM` 复制的 3 首本地 MP3（位于 `public/audio/bgm/`）。未选择过曲目时随机选一首循环播放，重新开始本局不换曲；右上角设置面板提供独立开关与 01 / 02 / 03 编号选择，记住曲目与开关，不显示资源文件名。
- 浏览器允许时尝试自动播放，被拦截后在首次鼠标、触屏或游戏键盘操作时重试。手动暂停游戏或切到后台时暂停音乐，恢复后继续同一首；查看说明等弹窗不切歌。
- 已移除原有振荡器合成音效。角色录音由独立的 `src/audio/character-effects.ts` 管理，与 BGM 开关互不影响；设置面板可关闭并立即停止角色语音，偏好保存在本地，静音重载时不加载录音；仅预载本局成员的录音，首次操作解锁 Web Audio，录音解码后缓存复用。
- 保留 [hololive 官网](https://hololive.hololivepro.com/) 的 `#48c5f4` / `#5edeec` 青蓝色、三角标识与组件语言，以暖白、淡薄荷和少量粉色点缀构建紧凑的桌面游戏界面。
- 页面以圆润棋盘为中心，分数和操作放在棋盘顶部；下一位成员采用对话纸条，11 位本局成员收进贴纸相册，详细合成顺序通过图鉴弹窗查看。
- 手机将下一位成员移到棋盘上方，相册缩为单行；根据触控或鼠标显示对应操作提示。界面仅保留玩法、暂停、合成结果与结束原因等基本游戏提示。

## 角色语音与覆盖情况

从用户提供的 `chr_00001-00039_语音_10字以内.csv`（1,443 条记录）及 `chr_06002-06005_语音_10字以内.csv`（188 条记录）按台词内容保留当前规则会使用的 **39 条录音**：34 位成员各一条合成语音，另为 0 期生的 5 位成员各保留一条最高等级庆祝语音。合成使用肯定、成功或喜悦类台词，最高等级使用庆祝类台词。

覆盖游戏中 **34 / 43 位独立成员（79.07%）**。白上フブキ兼属两个团体，下表按团体列出，统计独立成员时只计一次。

| 团体              | 已覆盖 / 在册成员 |
| ----------------- | ----------------- |
| 0 期生            | 5 / 5             |
| 1 期生            | 4 / 4             |
| 2 期生            | 3 / 3             |
| GAMERS            | 4 / 4             |
| 3 期生            | 4 / 4             |
| 4 期生            | 3 / 3             |
| 5 期生            | 4 / 4             |
| holoX             | 4 / 4             |
| ReGLOSS           | 4 / 4             |
| FLOW GLOW         | 0 / 5             |
| アソビ★まわり隊！ | 0 / 4             |

FLOW GLOW 与アソビ★まわり隊！的 9 位成员不在提供的 CSV 中，保持静默，不替换成其他角色的录音。合成到 ReGLOSS 及更早团体时使用对应成员的合成录音。投放语音已关闭，全部投放录音及非 0 期生的最高等级录音均已移除，同时删除对应原始 WAV 与游戏 MP3。`drop` 类型、成功投放后的回调及播放器接口继续保留，未配置音频时静默返回且不发起请求；未来仍可注入投放音频映射。`win` 只在首次合成 0 期生时触发。

以ときのそら为例：合成「いい感じだね♪」，最高等级「ばんざーい！」。完整选择清单及资源：

- [39 条台词与文件对应表](assets/character-voices/selection.csv)
- [覆盖统计及 9 位缺失成员](assets/character-voices/coverage.json)
- [人工选择配置](assets/character-voices/choices.json) 与 [原始 CSV](assets/character-voices/source-index.csv)
- 原始 WAV：`assets/character-voices/wav/<成员 ID>/<事件>.wav`，逐文件校验 SHA-256 后复制，合计 4,489,808 字节。
- 游戏用 MP3：`public/audio/characters/<成员 ID>/<事件>.mp3`，保留完整录音，合计 622,659 字节。
- 运行时清单：`src/audio/character-voices.json`，保存原文、来源文件、原始文件哈希和时长；播放器自动从清单建立成员映射。

语音按成员 ID 和 `drop` / `merge` / `win` 分发。成功投放仍调用 `drop` 接口，目前无音频配置；`merge` 使用合成后成员；`win` 仅为最高等级的 0 期生成员配置。播放优先级为最高等级 > 合成 > 投放，不同时叠放多段录音；暂停、后台、重开及卸载会停止播放，取消延迟解码的旧请求。没有增加新的界面文案或改变成员阵容、合成规则。

修改 `choices.json` 后可用以下命令重新导入（需要 Python 和带 libmp3lame 的 FFmpeg；日常 npm 构建不需要）：

```sh
python scripts/import-character-voices.py
```

导入器会读取 `.qa/voice-text/short-audio-job/wav-all/` 和 `.qa/voice-text/06002-06005-audio-job/wav-all/`，这些目录缺失时可使用项目中已保留的原始 WAV；更换录音来源时可指定 `--csv` 和 `--wav-dir`。导入时验证每位成员具有合成语音、只有最高等级成员具有 `win` 语音、同成员录音不重复、CSV 原文不超过 10 个 Unicode 字符、原始录音不超过 5 秒及音频文件真实存在；导入成功后同步移除已不在选择清单中的 WAV/MP3。打包和测试也会检查文件集合与清单完全一致，防止残留资源增大体积。

ReGLOSS 保留的合成语音：

| 成员           | 合成            |
| -------------- | --------------- |
| 音乃瀬奏       | いいねいいね～♪ |
| 一条莉々華     | ナイスぅ！      |
| 儒烏風亭らでん | いいですね～！  |
| 轟はじめ       | いいじゃん      |

## 静态部署与打包

```sh
npm ci
npm test
npm run package
```

`npm run package` 使用 Node.js 和 Python 3，先执行生产构建，再检查入口、全部头像、角色语音和 BGM。最终生成：

- `dist/`：可直接部署的静态文件，网站入口为 `index.html`。
- `release/holo-merge-web.zip`：前端部署 ZIP，解压后入口直接位于顶层。
- `release/holo-merge-node.zip`：已打包的 Node API，无需 npm 依赖，运行 `node node.mjs`。
- `release/holo-merge-workers.zip`：已打包的 Workers API 和 Durable Object 迁移配置。
- `release/deployment-manifest.json`：全部文件和分类的逻辑字节数、压缩包体积、逐文件 SHA-256 及语音覆盖情况。
- `release/SHA256SUMS`：部署 ZIP、清单和配置文件的校验值。
- `release/nginx.conf`、`release/README.txt`：Nginx 示例及部署步骤。

将 ZIP 解压到静态托管服务的网站根目录，或参考 `deploy/nginx.conf` 配置 Nginx。示例监听 8080、网站目录 `/usr/share/nginx/html`；主配置需加载 `mime.types`。离线玩法的生产运行无需 Node.js、Python 或后端；排行榜需部署下面两种后端之一。入口文件不缓存，带哈希的 JS/CSS 长期缓存，音频与头像短期缓存；缺失资源返回 404。

当前资源路径以 `/` 开始，部署目标应是域名根目录。若要使用 `/game/` 等子目录，需要先同步修改 Vite base 和头像、音频路径。Google Fonts 是可选在线字体，有系统字体回退。前端部署包只由 `dist/` 生成；原始 WAV、CSV、开发依赖及 QA 目录保留在源码工作区，不进入生产包。

部署包生成后，可将 ZIP 解压到任意目录，用静态服务器提供根路径，再运行 `BASE_URL=http://127.0.0.1:4173 npm run test:release`。此测试逐文件比对 HTTP 响应与部署清单、检查媒体 MIME/404，并验证生产页面投放 ReGLOSS 时静默、实际合成后的语音、已移除录音的 404 及响应式布局。

包内文件的 ZIP CRC、逐文件 SHA-256 和归档可读权限都会在打包阶段验证。总体积以全部生产文件的逻辑字节数统计，不等于首次加载流量；准确数值以本次生成的 `deployment-manifest.json` 为准。

## 成员与头像

数据来自 [官方成员目录](https://hololive.hololivepro.com/talents/)，核对日期 **2026-10-25**。包含 11 个日本团体、43 位在册活动成员（白上フブキ兼属两个团体，共 44 条团体成员记录），含日语企划 DEV_IS；不包含 EN、ID、工作人员、毕业或已结束活动的成员。0 期生是组合分类，GAMERS 同期包含兼属成员，顺序按团体形成时间和常用期生顺序排列。

`src/talents.json` 保存成员姓名、官方资料链接及原图地址；43 张原始 PNG 位于 `public/avatars/`，浏览器和 Canvas 均作圆形裁切，游玩期间不依赖头像源站。中文和西文字体有系统字体回退。

更新官方成员资料及头像：

```sh
python scripts/fetch-talents.py
```

更新脚本需要联网，使用 Python 标准库；完成后应重新核对名单和团体顺序，再运行测试与构建。

## 浏览器验证

先运行 `npm run dev`，然后使用本机 Chromium（或先运行 `npx playwright-core install chromium` 安装测试浏览器）：

```sh
BROWSER_PATH=/path/to/chromium npm run test:browser
BROWSER_PATH=/path/to/chromium npm run test:audio-browser  # BGM 播放、自动播放限制、开关持久化及后台恢复
BROWSER_PATH=/path/to/chromium npm run test:character-audio # 全部 39 条录音解码播放及实际合成/最高等级回调
BROWSER_PATH=/path/to/chromium npm run test:settings-browser # 编号选曲、语音静音、多语言及设置持久化
```

可通过 `BASE_URL` 指定开发服务器地址。测试在真实浏览器中覆盖全部合成等级、碰撞连锁、最高级、满线宽限与恢复、结束、防连续误投、暂停、桌面键盘、移动触屏、弹窗以及 320–1440px 布局。截图保存到忽略目录 `.qa/`。玩法和旧音频测试直接导入开发模块，需使用开发服务器；设置 / 多语言测试同时支持开发和生产页面。

## GitHub CI

推送、Pull Request 和手动触发都会运行 [GitHub Actions CI](https://github.com/shirayuki-inari/holo-merge/actions/workflows/ci.yml)：Node.js 22 / Python 3.12 环境下执行 `npm ci`、类型检查、单元测试和生产打包，并对 Node、Workers/workerd 分别运行 HTTP 校验，再运行 Chromium 的排行榜、玩法、BGM、39 条角色语音、三语言设置及解压部署包测试。测试浏览器由锁定版本的 Playwright 安装，未指定 `BROWSER_PATH` 时自动使用；Termux 继续使用系统 Chromium。

成功后可从工作流的 Artifacts 下载 `holo-merge-web`，其中包含前端及两种后端部署 ZIP、逐文件体积与 SHA-256 清单、部署说明和 Nginx 配置，保留 14 天。失败时保留浏览器截图和服务器日志 7 天。工作流不需要额外密钥，仅授予仓库内容读取权限；不自动发布网站。

## 版权

本项目为非官方粉丝创作游戏，与 COVER Corp. 无隶属关系。hololive 名称、成员角色及头像版权归其各自权利方 / COVER Corp. 所有。头像来源和官方链接保留在数据文件中。
