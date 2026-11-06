# Codex Daybook 0.5.12

0.5.12 新增 WorkBuddy 本地对话导入（含提问中的图片），并包含 0.5.11 的对话保存质量修复。

Obsidian 桌面插件，将本机 **Codex Desktop** 完成的对话保存为 Markdown 笔记，并可选导入本机 **WorkBuddy** 对话。可选开启每日轨迹，按创建日加入 Dataview 每日轨迹。不是 ChatGPT 历史同步器：Codex 只处理本机 Desktop 主任务，且只有开始同步之后新建的任务才会被采集。

已进入 Obsidian 社区插件目录，源码见 [isink/Codex-Daybook](https://github.com/isink/Codex-Daybook)，采用 MIT 许可证。当前条目尚未经过 Obsidian 员工人工审核；Windows 实机验收仍待完成。

[English guide](README.en.md) · [隐私说明](PRIVACY.md) 

## 安装

需要 Obsidian 1.13.7 及以上版本、本机安装的 Codex Desktop；只有开启每日轨迹功能时才需要 Dataview 插件。

Windows 上从 Microsoft Store 安装的 Codex Desktop 不允许其他程序启动它自带的 Codex，需另外安装 Codex 命令行工具：`npm install -g @openai/codex`。它和桌面版读取同一份对话数据。

1. 解压安装 ZIP，将其中 `codex-daily-sync` 文件夹放入库的 `.obsidian/plugins/`。
2. 在 Obsidian 的社区插件设置中启用 Codex Daybook（若计划使用每日轨迹，也一并启用 Dataview）。
3. 设置面板分三个标签页：**基础设置**（笔记目录、附件目录、Codex 可执行文件——默认自动检测，也可一键扫描——时区、检查间隔）、**每日轨迹**和 **WorkBuddy**。每日轨迹和 WorkBuddy 均默认关闭。
4. 确认允许库外访问，点击“登录 Codex”完成 ChatGPT 登录（使用 Codex 官方浏览器授权，密码和登录令牌不经过插件、不写入库），再点击“检查连接”验证接口。没有可验证的主任务时，请先在 Codex 完成一个测试任务。
5. 检查通过后点击“开始同步”，此时固定同步起点；只有此后新建的 Codex 主任务会被采集。

若 Codex 可执行文件自动检测失败，可手动选择；请只选择可信的 Codex 程序，它将以你的权限运行。界面支持简体中文与 English，可在设置的“语言”中切换，只影响界面文字，不影响已同步的笔记内容。

## 同步范围

只导出已完成轮次的用户消息、正式答复和正式计划；若该轮没有明确标记的正式答复，兼容保存最后一条非空且未标记阶段的助手消息。工具调用、推理过程、系统消息，以及进行中或失败的轮次不会被导出。用户附带及 Codex 图像工具生成的本地 PNG/JPEG/GIF/WebP 图片会复制进库内并按内容去重；远程图片不会下载。每个任务固定自己的目录、时区和创建日，之后改设置不影响旧笔记。已同步且无变化的对话不会重写笔记；对话内容以外的个人文字和自定义属性会保留。删除或归档源对话不会自动删除本地笔记、图片或每日链接。升级到 0.5.11 后会对已登记的对话做一次完整核对，补上旧版可能漏掉的答复；代码块和行内代码中的图片链接及路径示例保留原文。

## WorkBuddy 本地对话（实验性）

在 **WorkBuddy** 标签页允许读取本地数据，点击“检查本地数据”，通过后点击“开始 WorkBuddy 同步”。默认读取当前用户的 `~/.workbuddy/projects`；只在数据存于其他位置时填写绝对路径。笔记默认写入库内 `WorkBuddy Conversations`。WorkBuddy 与 Codex 的开关相互独立；点击检查不会暂停同步。首次启动会导入已有的本地对话，之后按基础设置中的间隔检查更新。

此功能按 macOS 版 WorkBuddy 5.6.2 的本地普通任务文件开发，并在 5.7.7 上复核，使用本地 JSONL 文件，不要求 WorkBuddy 登录令牌，也不会调用 WorkBuddy 云端接口。只写入界面可见的用户提问及已完成的回答；私有上下文、推理、工具事件和未完成轮次不写入笔记。提问中附带的图片会复制进库内 `Attachments/WorkBuddy/<笔记名>/`（可在 WorkBuddy 标签页修改），按内容去重并直接显示在提问里；只读取 WorkBuddy 自己保存在 `~/.workbuddy/blobs` 的原图，原图不存在时显示带文件名的未导入提示；其他附件仅显示未导入提示；纯云端任务以及其他 WorkBuddy 产品形态尚不支持。文件格式未公开保证稳定性：格式不兼容时停止导入该对话，保留已有笔记。用户手动增加的笔记属性和同步区域外文字会保留；暂停同步不会删除笔记。

## 开发

```sh
npm ci
npm run package
```

本项目不是 OpenAI 或 Obsidian 官方插件。
