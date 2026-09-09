# ADR-0010：Windows 打包扫描路径

- 状态：M2-02 构建阻塞修正
- 范围：构建依赖，不涉及 Codex 引擎或产品执行权限

Forge 7.11.2 在打包后的 `.bin` 清理步骤将 `path.join(buildPath, '**/.bin/**/*')` 直接交给 fast-glob。在 Windows 上反斜杠被视为模式转义，任务基目录成为 `.`，实际遍历了源仓库的无关测试缓存，而非打包临时目录。现场打包停滞与 `generateTasks()` 回归均已复现。

采用一个固定版本、源码哈希受控的单行修正：先用 `convertPathToPattern(buildPath)` 转换实际目录，再追加 `/**/.bin/**/*`。保留原清理操作，仅修正扫描范围，不关闭构建或安全检查。[fast-glob 路径转换说明](https://github.com/mrmlnc/fast-glob#convertpathtopatternpath)

`scripts/prepare-build-tools.cjs` 在 `postinstall` 和 `prepackage` 核验/应用修正。版本或原始源码不符时明确失败，不覆盖未知修改；重复执行只校验。更新 Forge 时重新审查，官方修复后删除该脚本及钩子。重新安装锁定依赖可恢复原始依赖文件，不修改锁文件中的包来源或完整性。

这不是 Codex Patch Queue；运行时继续使用固定官方 Codex 0.153.4、零补丁。打包产物仍需真实 Electron 验证。
