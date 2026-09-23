# Codex Daybook 0.5.7

Obsidian 桌面插件，将本机 **Codex Desktop** 完成的对话保存为 Markdown 笔记。可选开启每日轨迹，按创建日加入 Dataview 每日轨迹。不是 ChatGPT 历史同步器：只处理本机 Codex Desktop 主任务，且只有开始同步之后新建的任务才会被采集。

公开发布候选版，源码见 [isink/obsidian-codex-daily-sync](https://github.com/isink/obsidian-codex-daily-sync)，采用 MIT 许可证。**Windows 尚未完成实机验收，社区目录审核也未完成；候选版不等于已上架。**

[English guide](README.en.md) · [隐私说明](PRIVACY.md) · [变更日志](CHANGELOG.md)

## 安装

需要 Obsidian 1.13.7 及以上版本、本机安装的 Codex Desktop；只有开启每日轨迹功能时才需要 Dataview 插件。

1. 解压安装 ZIP，将其中 `codex-daily-sync` 文件夹放入库的 `.obsidian/plugins/`。
2. 在 Obsidian 的社区插件设置中启用 Codex Daybook（若计划使用每日轨迹，也一并启用 Dataview）。
3. 首次启用只会提示最基础的设置：笔记目录、附件目录。每日轨迹默认关闭，一键开启即可显示每日目录与模板（均已有可用默认值）；时区、检查间隔在高级设置中。
4. 确认允许库外访问，点击“登录 Codex”完成 ChatGPT 登录，再点击“检查连接”验证接口。没有可验证的主任务时，请先在 Codex 完成一个测试任务。
5. 检查通过后点击“开始同步”，此时固定同步起点；只有此后新建的 Codex 主任务会被采集。

Codex 可执行文件默认自动检测，检测失败可在高级设置里手动选择；请只选择可信的 Codex 程序，它将以你的权限运行。界面支持简体中文与 English，可在设置的“语言”中切换，只影响界面文字，不影响已同步的笔记内容。

## 同步范围

只导出已完成轮次的用户消息、正式答复和正式计划；工具调用、推理过程、系统消息，以及进行中或失败的轮次不会被导出。本地 PNG/JPEG/GIF/WebP 图片会复制进库内并按内容去重；远程图片不会下载。每个任务固定自己的目录、时区和创建日，之后改设置不影响旧笔记。已同步且无变化的对话不会重写笔记；对话内容以外的个人文字和自定义属性会保留。删除或归档源对话不会自动删除本地笔记、图片或每日链接。

## 登录

登录使用 Codex 官方浏览器授权流程，密码和登录令牌不经过插件、不写入库。详见[隐私说明](PRIVACY.md)。

## 开发

```sh
npm ci
npm run package
```

发布与验收流程见 [RELEASE.md](RELEASE.md)；变更历史见 [CHANGELOG.md](CHANGELOG.md)。

更多文档：[Windows 验收](WINDOWS-CHECKLIST.md) · [验证记录](VALIDATION.md) · [双平台验收](ACCEPTANCE.md)

本项目不是 OpenAI 或 Obsidian 官方插件。
