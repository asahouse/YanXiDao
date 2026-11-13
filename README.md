# 研习岛客户端（YanXiDao Client）

研习岛（YanXiDao）英语打字与口语练习平台**客户端仓库**，覆盖 **Web 学习前台** 与 **Windows 桌面安装版（Electron）**。

> 本仓库已完全剥离后台管理页面与管理员权限代码；后台管理与中心数据服务请参见 [YanXiDao-Admin-Platform](https://github.com/asahouse/YanXiDao-Admin-Platform)，共享领域规则由 [@yanxidao/shared](https://github.com/asahouse/YanXiDao-Shared) 通过 Git Tag 提供。

## 核心功能

- **英语听写与句型练习**：逐词音标与中文解析、整句完成度校验、Edge-TTS 拟人语音合成与本地音频缓存。
- **成长等级与会员体系**：30 级成长路线、每日学习配额与经验上限、VIP 权益展示及「会员升级申请 / 双向沟通」功能。
- **双端运行形态**：
  - **Web 版**：静态构建后配合 Nginx/Docker 部署，通过 `/api` 对接中心服务端。
  - **Windows 桌面版**：基于 Electron + 内置本地 SQLite 服务，支持离线练习与 `.yxdpack` 课程包同步更新。

## 本地开发与构建

```bash
npm install

# 启动本地内置服务 (端口 3001) + 前端开发服务器 (端口 5173)
npm run server
npm run dev

# 类型检查与全量构建 (Web + 内置服务端)
npm run typecheck
npm run build

# 打包 Windows 安装包 (输出至 release/)
npm run electron:build
```

## 容器化部署（Web 端）

```bash
docker build -t yanxidao-client .
docker run -d -p 80:80 yanxidao-client
```

## CI/CD 流水线

- Push / PR 至 `main`：自动执行 `npm run typecheck` 与 `npm run build` 验证。
- 推送 `v*` 标签：自动在 `windows-latest` Runner 上构建 Windows NSIS 安装包并上传产物。
