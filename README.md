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
- 鼠标交互动画：
  - 单击：默认播放 `waving`
  - 双击：默认播放 `jumping`
  - 右键：默认播放 `failed` 并打开菜单
  - 悬停：默认播放 `review`
  - 拖动开始：默认播放 `running`
  - 向右拖动：默认播放 `running-right`
  - 向左拖动：默认播放 `running-left`
  - 拖动结束：回到 `idle`

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

如果你的素材不是这个默认布局，可以在 `pet.json` 中声明：

```json
{
  "id": "my-pet",
  "displayName": "我的桌宠",
  "spritesheetPath": "spritesheet.webp",
  "cellWidth": 192,
  "cellHeight": 208,
  "states": {
    "idle": { "row": 0, "frames": 6, "fps": 6, "loop": true },
    "waving": { "row": 3, "frames": 6, "fps": 8, "loop": false, "next": "idle" },
    "jumping": { "row": 4, "frames": 6, "fps": 8, "loop": false, "next": "idle" }
  },
  "interactions": {
    "click": "waving",
    "doubleClick": "jumping",
    "rightClick": "failed",
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

可以把安装包或便携版上传到 GitHub Releases，普通用户下载后即可本地使用。

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
2. 把 `dist/` 中的 `.exe`、安装包或便携包上传到 GitHub Releases。
3. README 中保留开发运行方式，Release 中提供直接下载入口。

## 当前边界

- 当前只支持安装制作好的素材。
- 不提供 AI 生成。
- 不提供 spritesheet 编辑器。
- 素材图集尺寸不会在主进程强制解析校验，图片加载和播放由 Canvas 完成。
