# 隐私 / Privacy

本插件通过本机 Codex 使用 ChatGPT 登录。点击“登录 Codex”会先检查现有状态，未登录时调用官方 account/login/start 并在浏览器打开官方 HTTPS 登录页。插件不接收密码，不读取或保存账号令牌；Codex 负责授权回调、凭据保存与刷新。本次登录可能被使用同一 Codex 配置目录的其他客户端复用。取消只作用于本次流程，不调用全局退出账号接口。需要账号并不表示任何付费方案均保证兼容；以连接检查结果为准。

通过插件启动的本机 `codex app-server --stdio` 读取任务元数据、已完成消息及显式本地图片字段。图片可能位于库外临时目录；不扫描无关目录或文本路径，不下载远程图片。首次设置确认前不启动该进程。连接检查只读取一个已有任务的少量数据以验证接口，不导入或记录该样本。

插件打开官方登录网页；浏览器和 Codex 会连接官方账号服务。插件自身不发送 HTTP 请求，不上传对话、不收集遥测、不自动安装依赖。Codex 程序沿用自身配置和账号服务，可能连接 OpenAI；本插件不能保证 Codex 自身离线。Obsidian Sync、云盘和其他插件是否上传库内文件取决于用户原有配置。

插件 `data.json` 保存设置、固定起点、任务 ID、笔记路径及原图到库内副本的映射，属于个人数据，不应公开。源任务删除不会触发本地清理。如需彻底移除副本，应由用户手动处理笔记、附件、备份及云同步副本。

诊断仅包含状态、计数及错误类别，不记录任务正文、完整私人路径或凭据。分享问题时仍应自行检查截图、设置页和配置文件是否含隐私。

English: This plugin reuses an existing Codex Desktop ChatGPT login or starts the official managed browser OAuth flow through a local stdio child process. The browser and Codex contact official account services. Passwords and tokens are never collected or stored by the plugin; Codex manages credentials shared by clients using the same Codex configuration. Cancelling only ends this login attempt; no global logout is sent. It reads task metadata, completed messages and explicitly attached local image files outside the vault. Connection checks read a small historical sample without importing it. The plugin sends no HTTP requests, conversation uploads or telemetry, and installs no dependencies. Codex itself may contact OpenAI according to its configuration. Existing vault/cloud sync tools remain under your control. Local mappings contain private IDs and paths and must not be published. Source deletion never purges local copies automatically.
