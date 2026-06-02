# PetCreater

PetCreater 是一个独立运行的桌面宠物应用。当前版本只支持安装已经制作好的素材：`pet.json + spritesheet.webp`。

它不依赖 Codex。Codex 的 `hatch-pet` skill 可以用来制作素材，但本项目运行时只读取本地文件。

## 技术栈

- Electron：桌面应用、透明窗口、置顶、右键菜单、本地文件读取。
- HTML Canvas：按 `spritesheet.webp` 的行列裁剪并播放动画。
- 原生 JavaScript/CSS：不引入 React/Vue，先保持运行端简单。
- electron-builder：打包 Windows 安装包或便携版。

## 功能

- 安装本地桌宠素材文件夹。
- 读取 `pet.json` 和 `spritesheet.webp`。
- 透明无边框桌宠窗口。
- 保持在其他应用上层显示。
- 右键菜单支持放大、缩小、重置大小。
- 鼠标交互动画：
  - 单击：默认播放 `waving`
  - 双击：默认播放 `jumping`
  - 右键：只打开菜单，不播放动作
  - 滚轮向上：默认播放 `jumping`
  - 滚轮向下：默认播放 `failed`
  - 悬停：默认慢速播放 `review`
  - 鼠标离开：交互后默认循环两次 `waiting`，之后进入慢速 `idle`
  - 长时间无交互：使用慢速 `idle`，每帧停留 1 秒
  - 拖动开始：默认播放 `running`
  - 向右拖动：默认播放 `running-right`
  - 向左拖动：默认播放 `running-left`
  - 拖动结束：如果鼠标仍停在桌宠上，回到 `review`；鼠标离开后再循环两次 `waiting`
- 如果导入的图片不是标准图集，应用会把它当作单张形象完整显示，不再强制裁剪成 `192x208` 的半身。但这种模式没有逐帧动画，只会保留点击、双击、拖动的缩放/跳动反馈。

## 素材格式

选择安装的文件夹必须包含：

```text
my-pet/
  pet.json
  spritesheet.webp
```

最小 `pet.json`：

```json
{
  "id": "my-pet",
  "displayName": "我的桌宠",
  "description": "本地导入的桌宠",
  "spritesheetPath": "spritesheet.webp"
}
```

默认图集格式沿用 Codex pet / hatch-pet 产物：

- 单格尺寸：`192x208`
- 图集尺寸：`1536x1872`
- 9 行状态：
  - 第 0 行：`idle`
  - 第 1 行：`running-right`
  - 第 2 行：`running-left`
  - 第 3 行：`waving`
  - 第 4 行：`jumping`
  - 第 5 行：`failed`
  - 第 6 行：`waiting`
  - 第 7 行：`running`
  - 第 8 行：`review`

要让单击、双击、拖动等操作展示不同动画，建议使用上面的标准 9 行图集。只放一张普通图片也可以显示完整形象，但无法展示不同动作帧。

如果你的素材不是这个默认布局，可以在 `pet.json` 中声明：

```json
{
  "id": "my-pet",
  "displayName": "我的桌宠",
  "spritesheetPath": "spritesheet.webp",
  "cellWidth": 192,
  "cellHeight": 208,
  "states": {
    "idle": { "row": 0, "frames": 6, "fps": 3, "loop": true },
    "waving": { "row": 3, "frames": 6, "fps": 8, "loop": false, "next": "idle" },
    "jumping": { "row": 4, "frames": 6, "fps": 8, "loop": false, "next": "idle" }
  },
  "interactions": {
    "click": "waving",
    "doubleClick": "jumping",
    "wheelUp": "jumping",
    "wheelDown": "failed",
    "hover": "review",
    "dragStart": "running",
    "draggingRight": "running-right",
    "draggingLeft": "running-left",
    "dragEnd": "idle"
  }
}
```

## 开发运行

先安装 Node.js 18+。

```bash
npm install
npm run dev
```

如果 `npm install` 下载很慢，项目已内置 `.npmrc`，默认使用国内镜像下载 npm 包、Electron 和 electron-builder 依赖。依赖安装过一次后，后续只要 `package.json` 没有新增依赖，一般不需要重复执行 `npm install`。

启动后：

1. 如果还没有安装桌宠，会显示“安装素材”按钮。
2. 选择包含 `pet.json` 和 `spritesheet.webp` 的文件夹。
3. 安装成功后会显示透明桌宠。
4. 右键桌宠可以安装新素材、切换桌宠、打开本地素材目录、退出。

## 打包发布

```bash
npm run build
```

打包结果在：

```text
dist/
```

默认只生成安装包，避免 Windows 下便携版中间文件被杀毒软件或资源管理器锁住导致整次构建失败。需要便携版时单独执行：

```bash
npm run build:portable
```

可以把安装包上传到 GitHub Releases，普通用户下载后即可本地使用。

发布给别人时通常只需要发 `dist/PetCreater Setup 版本号.exe`。这是安装包，对方双击安装即可，不需要发整个项目文件夹、`src/`、`node_modules/` 或 `dist/win-unpacked/`。

如果你单独执行 `npm run build:portable` 生成了便携版 `PetCreater 版本号.exe`，也可以只发这个便携版 exe。安装包和便携版二选一即可：

- `PetCreater Setup 版本号.exe`：推荐给普通用户，安装后使用。
- `PetCreater 版本号.exe`：便携版，免安装运行。

## GitHub 发布建议

仓库里放源码和说明：

```text
README.md
package.json
src/
examples/
```

发布给普通用户时，不建议让对方下载源码运行。更推荐：

1. 本地执行 `npm run build`。
2. 把 `dist/` 中的安装包 `.exe` 上传到 GitHub Releases。
3. README 中保留开发运行方式，Release 中提供直接下载入口。

## 当前边界

- 当前只支持安装制作好的素材。
- 不提供 AI 生成。
- 不提供 spritesheet 编辑器。
- 素材图集尺寸不会在主进程强制解析校验，图片加载和播放由 Canvas 完成。
