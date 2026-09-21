# Codex Daybook 0.5.6 发布流程

此版本采用 MIT，插件 ID 固定为 codex-daily-sync。源码仓库为 [isink/obsidian-codex-daily-sync](https://github.com/isink/obsidian-codex-daily-sync)。当前是公开候选版；是否能在社区目录安装仍以 VALIDATION.md、双平台验收和社区审核结果为准。

## 本地检查

使用 Node.js 22.14+ 或 24：

```sh
npm ci
npm run package
npm audit --audit-level=high
```

package 会先运行官方 Obsidian ESLint 推荐规则、自动测试、生产构建、版本/许可/隐私模式检查，再按白名单输出 release/0.5.6。检查成功不代表桌面验收或社区审核通过。

解压源码 ZIP 到独立目录，重新运行以上命令，并逐字节比对 main.js、manifest.json、styles.css、LICENSE 和 THIRD-PARTY-NOTICES.txt。对照 SHA256SUMS.txt 核验所有交付文件。人工检查白名单源码和截图，模式扫描不能识别所有个人信息。

## 发布门槛

- 自动检查通过；所有审核错误修复。已知建议单独列出，不隐藏或等同于错误。
- 相同候选安装包在 macOS 与 Windows 的真实验收通过，环境版本和包哈希已记录。
- 没有未解决的数据丢失、覆盖、误导入或重复写入问题。
- README 和验证记录如实说明 Dataview、Codex 登录、实验接口、库外读取和 Codex 自身可能联网；不承诺未经验证的账号方案。
- 发布只使用白名单文件，不包含测试库、data.json、真实任务标识、个人路径或本地工具配置。

## GitHub 与社区目录

1. 公开仓库必须只包含已审查源码，不上传本地测试库。确认 CI 的 macOS/Windows × Node 22/24 检查全部通过。
2. 将该提交标记为 **0.5.6**，标签必须与 manifest.version 完全一致，不加 v。创建正式 GitHub Release。
3. 单独上传 main.js、manifest.json、styles.css；同时提供安装 ZIP、源码 ZIP、LICENSE、声明和 SHA256SUMS.txt。只有 ZIP 不满足社区安装要求。
4. 用 Obsidian 账号登录社区目录，绑定仓库所属 GitHub 账号；确认插件 ID/名称未被占用，再提交。若标识冲突，先制定已有用户迁移方案，不擅自改 ID。
5. 处理自动审核的错误；可通过 Review branch 预检。发布修复版时递增版本，重新完成受影响验收。
6. 社区显示可安装后，从全新库实际安装并重复 A01–A06；确认收到正确版本和依赖许可声明。此时才记录“上架完成”。

账号登录、Windows 验收或审核反馈未齐时，保持候选状态，不假定发布成功。CI 工作流只检查和上传测试产物，不自动创建 Release 或提交社区目录。

## 回滚

先暂停并禁用插件，备份配置、笔记和附件；恢复旧版二进制及对应的 data.json。不要删除新笔记来处理版本差异。0.5.6 保持 schemaVersion 3，继承 0.5.1 的每任务 syncPending / publicationVersion，并保留 settings.language；0.4 回滚必须使用旧配置备份。

官方依据：[提交指南](https://docs.obsidian.md/plugins/releasing/submit-plugin)、[开发者政策](https://docs.obsidian.md/community-directory/developer-policies)、[审核 FAQ](https://docs.obsidian.md/community-directory/faq)。
