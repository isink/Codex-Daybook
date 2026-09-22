# Codex Daybook 0.5.7

Obsidian 桌面插件，公开发布候选版。源码已公开在 [isink/obsidian-codex-daily-sync](https://github.com/isink/obsidian-codex-daily-sync)。**Windows 待实机验证；社区目录审核和社区渠道实际安装仍未完成。采用 MIT 许可证；候选版不代表已上架。**

[English guide](README.en.md) · [隐私说明](PRIVACY.md) · [Windows 验收](WINDOWS-CHECKLIST.md) · [变更及回滚](CHANGELOG.md) · [验证记录](VALIDATION.md) · [双平台验收](ACCEPTANCE.md) · [发布流程](RELEASE.md)

> **English.** Codex Daybook is a desktop-only Obsidian plugin that saves newly completed local Codex Desktop main tasks as Markdown and links them to the creation day's Dataview trail. It requires Obsidian 1.13.7 or later, Dataview, and a local Codex Desktop installation. The settings interface is available in Simplified Chinese and English — see the [full English guide](README.en.md) for setup, privacy, recovery, and upgrade details.

将开始同步之后新建的本机 **Codex Desktop 主任务**保存为 Markdown，并通过 `daily` 链接加入创建日的 Dataview 轨迹。不是普通 ChatGPT 历史同步器：顶部切换到 ChatGPT 视图不改变底层任务类型。

## 安装和首次使用

需要 Obsidian 桌面版 1.13.7 或更新版本、已启用的 Dataview、本机已安装的 Codex Desktop（可在插件中使用 ChatGPT 账号登录）。本候选版使用 Codex 实验性 App Server 分页接口，已实测 CLI `0.155.0-alpha.9.2`；其他版本必须通过连接检查。不要因此自动安装或降级 Codex。

1. 解压安装 ZIP，将其中 `codex-daily-sync` 文件夹放入库的 `.obsidian/plugins/`。该目录应直接包含 `main.js`、`manifest.json`、`styles.css`。安装包另含 MIT LICENSE 和依赖声明 `THIRD-PARTY-NOTICES.txt`。
2. 在 Obsidian 的社区插件设置中启用 Dataview，再启用 Codex Daybook。
3. 首次启用只提示设置入口，不启动 Codex 或读取对话。设置笔记目录、附件目录、每日目录、可选每日模板、时区及检查间隔（详见下方说明）。
4. 阅读并确认“允许访问库外数据”，点击“登录 Codex”：自动检测本机程序，已有 ChatGPT 登录状态时直接复用，未登录时打开官方浏览器登录页。完成后点击“检查连接”。检查会短暂读取一个已有主任务的元数据、一个轮次和一个消息分页，以验证接口，不将该任务导入。没有任何可验证主任务时，请先在 Codex 完成一个测试任务，再检查。
5. 检查成功后点击“开始同步”。此时才保存固定的时间起点。新任务首轮完成后才生成笔记；以后关闭、重开或暂停不会重置起点。
6. 如需验证，新建一个 Codex 主任务并完成一轮，等待约一个检查间隔。打开生成的笔记和创建日每日记录。

三个目录字段会在输入时提示当前库内已有目录，也可直接填写尚未创建的新目录；每日模板字段会提示库内现有的 Markdown 文件，点击“选择模板…”可搜索并填入路径。

“高级设置：Codex 可执行文件”默认收起，自动检测失败时再填写。macOS 会检测标准应用安装位置和 PATH。Windows 可用“浏览…”定位实际 `codex.exe`，或填写完整路径；PATH 检测只选择 `.exe`，不运行 `.cmd`、WSL，也不修改 PATH。中文和空格路径按独立进程参数传入，不用 Shell 拼接。选择的可执行文件会以你的权限运行，请只选择可信的 Codex 程序。

默认目录：`Codex Conversations`、`Attachments/Codex`、`Daily`。时区在首次设置时取系统时区，之后固定保存；检查间隔默认 10 秒，可设为 5–3600 秒。任务串行同步，检查忙碌时不叠加。暂停时不运行；已开始的配置在重启后会重新检查连接再继续。

## 界面语言

界面支持简体中文与 English：首次使用及旧版首次升级会按 Obsidian 语言选择默认值（中文界面选中文，其他选英语），也可在“语言”中另选后点击“保存设置”，设置页、命令和状态栏会立即切换，选择会持久保存。保存设置会暂停同步，需检查连接后再开始；语言设置只影响界面文字，不翻译对话原文，也不改动已有笔记。当前使用传统设置面板，字段尚不支持 Obsidian 全局设置搜索。

## 登录与账号

官方浏览器登录由本机 Codex app-server 托管，密码及登录令牌不交给插件、不写入库。Codex 管理并保存登录状态，同一 Codex 配置目录中的其他客户端可能复用该状态。登录页需要联网；本机仍须安装 Codex。登录成功不自动开始同步，需先检查连接。浏览器完成后会自动刷新插件提示；失败时可重试。“取消登录”只取消本次待完成流程，不退出已有账号；暂停、保存其他设置或禁用插件会结束本次登录进程。插件不提供全局退出账号按钮。

[官方登录接口说明](https://learn.chatgpt.com/codex/auth#sign-in-with-chatgpt)。

## 每日轨迹与正文

每个任务固定自己的目录、时区和创建日。更改设置只影响新纳入的任务，旧笔记不搬动、不自动改文件名。改名时只更新笔记标题属性。重名（含大小写差异）追加任务 ID 短码，Windows 保留文件名会转义。

“每日笔记保存位置”填写库内文件夹，例如 `Daily`，会生成 `Daily/2026-09-20.md` 这样的每日笔记，用于查看当天新建的 Codex 对话。“使用自己的每日笔记模板（可选）”不确定就留空；想沿用自己的排版时，填写已有模板文件的库内路径，例如 `Templates/Daily.md`。模板仅用于新建每日笔记。

每日文件名固定为 `YYYY-MM-DD.md`。未选择模板时用内置 Dataview 模板；自定义模板只支持 `{{date:YYYY-MM-DD}}`，不运行 Templater 脚本或其他动态代码。已有每日文件不修改；需补查询时可从设置页复制：

```dataview
LIST WITHOUT ID captured_at + "　→　" + file.link
WHERE contains(file.outlinks, this.file.link)
SORT captured_at ASC
```

仅保存已完成轮次的用户消息、正式答复和正式计划。过滤过程更新、工具、推理、系统消息；失败、中断及进行中的轮次不导出。用户气泡靠右，最大正文宽度 80%；Codex 标签和 Markdown 靠左。列表、表格、代码和计划保留。只在带 `codex-conversation` 样式类的笔记上应用样式。

PNG、JPEG、GIF、WebP 从明确的本地图片字段复制到库内，按 SHA-256 去重。缩略图最大 240×180 CSS 像素，等比、不裁剪；点击在新标签打开原图。远程图片不下载，文本里的路径不扫描。临时原图丢失后复用已保存映射；从未成功保存则显示简短提示。仅清理能由图片字段佐证的开头附件包装，不删除用户真实英文、路径或代码块。

已完成核对且无变化时不写笔记或附件。写入与迁移遵循以下规则：

- 0.5.1 起，首次处理旧版任务会完整核对一次，修复旧版写入失败后可能被跳过的内容；起点、文件位置和个人补充保留。
- 附件缓存单独持久化：正文写入失败后仍保持待重试，只有成功写入且状态保存成功后，才会标记该轮完成。
- 对话只更新同步标记之间的内容，标记外的个人文字和自定义属性保留；没有默认“我的补充”，旧版空补充标题可被移除，非空文字保留。请勿删除或复制同步标记。
- 首次创建会先在库根目录的 `.tmp` 完整暂存，再移入目标目录，避免空笔记触发创建模板；随后仅在首次发布时通过文件处理接口追加一个空行，触发 Obsidian 索引，确保每日轨迹立即收录，后续相同内容不再写入。
- 失败可能留下可手动恢复的暂存文件。

## 归档、删除、错误与升级

来源归档、删除或暂时不可读都不会自动删除本地笔记、每日链接及图片。仅最后成功导出的内容有本地副本，失败提示不能证明源任务已经删除。普通任务读取失败可跳过该任务；连接或接口不兼容停止同步，请在设置中重连。插件不读取其他历史文件绕过接口。

升级前备份整个插件目录（包括 `data.json`）、笔记和附件。0.4 配置迁移保留固定起点、任务和附件映射，从现有笔记与每日配置推断新任务设置；迁移后先暂停，请确认目录、时区、访问说明并检查连接后开始。无法明确推断时显示提示。旧版若未保存任务 ID，会从原笔记读取，不能确认则停止。已有每日链接和创建时间不会重算。

不要删除 `data.json` 来重置插件：它包含起点、任务映射和丢失原图的副本映射。卸载不清理笔记和图片，但应先备份配置。同步不提供自动回填历史、普通 ChatGPT 导入、自动重命名或后台常驻服务。

## 开发

```sh
npm ci
npm run package
npm audit --audit-level=high
```

测试仅用虚构数据和临时测试库。`npm run probe` 是需要显式运行的真实 Codex 连接检查，会读取上述最小样本，仅打印成功/失败，不输出任务内容或路径。`scripts/fixture-server.js` 仅用于模拟源的独立 UI 测试，不在安装包内，也不表示真实 Codex 已验证。

发布脚本按文件白名单构建安装 ZIP、源码 ZIP、文档及 SHA256 校验值，禁止 `data.json`、笔记、备份、私有路径与真实任务标识。运行时没有 npm 依赖安装；yaml 已打包，保留其 ISC 声明及构建依赖声明。本项目采用 [MIT](LICENSE)。运行时 yaml 的完整许可同时嵌入 main.js，社区目录安装也会携带。新增文件或测试时必须更新发布白名单。

接口依据：[Codex App Server](https://learn.chatgpt.com/docs/app-server)。发布要求：[Obsidian 提交指南](https://docs.obsidian.md/plugins/releasing/submit-plugin)、[开发者政策](https://docs.obsidian.md/community-directory/developer-policies)。本项目不是 OpenAI 或 Obsidian 官方插件。
