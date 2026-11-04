# 自定义宠物与 MCP

入口：设置 → 主题与外观 → 宠物样式与 AI 接入；也可以从桌面宠物的右键菜单打开。

## 给普通用户

1. 点击「导入素材」，选择 PNG、WebP、GIF、JPG，或宠物包内的 `pet.json`。
2. 选择宠物，预览动作，调整大小、不透明度、左右镜像、气泡颜色和问候语。
3. 点击「应用到桌面」。每只宠物独立保存参数，切回原角色也会恢复原参数。

单张静态图片不会自动变成多帧动画。可导入动画图片、视频片段，或让 AI 制作精灵图。动画速度作用于视频和精灵图；GIF / WebP 使用素材自身速度。缺少的标准动作会回退到 `idle`，提醒功能不受影响。自定义动作可从预览区、宠物菜单及 MCP 调用。删除自定义宠物会移到系统回收站；内置角色保留。

## 接入 AI

在宠物设置中开启「允许 MCP 控制宠物」，复制连接配置到支持**本机 stdio MCP** 的 AI 客户端。配置使用安装后的实际可执行文件路径和用户数据目录，无需另外安装 Node / Python。使用期间保持 MarkFlow 运行；收起主窗口后，宠物仍可运行。关闭 MCP 开关后，AI 的运行时调用会被拒绝。

配置形式（请使用界面复制的实际路径）：

```json
{
  "mcpServers": {
    "markflow-pet": {
      "command": "C:/实际安装目录/MarkFlow.exe",
      "args": ["--pet-mcp", "--data-dir", "C:/实际用户数据目录/com.exchangemd.app"]
    }
  }
}
```

Mac 的 command 使用应用包内可执行文件的路径，界面会自动生成。运行时使用带会话令牌的本机连接，不提供公网 HTTP MCP 端点。MCP 只开放宠物接口，不读取文档、便签或待办内容。连接配置本身不包含模型密钥。MCP 规范参照 [stdio 传输](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports) 与 [工具调用](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)；支持协议版本协商。

让 AI 生成宠物的流程：

1. `pet_prepare_generation`：传入角色描述以及 `image`、`sprite` 或 `clips`，获取素材规格和生成指引。
2. AI 调用它自己连接的绘图／视频工具，并把素材保存到运行 MarkFlow 的电脑上。这个 MCP 不会生成像素，也不会消耗模型 API 额度。
3. 单张图片／精灵图使用 `pet_create_from_image`；完整宠物包先 `pet_validate_pack`，再 `pet_install_pack`。
4. `pet_configure` 选择新角色和参数，`pet_show` 显示到桌面。
5. `pet_get_state` 获取动作清单，`pet_play` 播放动作，`pet_say` 冒泡说话。

运行时命令返回 `queued`，代表已排入宠物窗口，不代表动画已播放完毕。待办提醒和拖动优先，AI 请求在空闲时执行，30 秒后过期；连续请求会用最新请求替换尚未执行的请求。`pet_get_schema` 和生成指引可在主程序关闭时读取；其他接口需要主程序已运行且允许 MCP 控制。

| 工具 | 用途 |
| --- | --- |
| `pet_get_schema` | 包格式、参数定义、最小模板 |
| `pet_prepare_generation` | 给外部生成工具的制作规范 |
| `pet_list` | 宠物库与已保存参数 |
| `pet_get_state` | 当前角色、动作与最新命令 |
| `pet_validate_pack` | 校验本地包，不安装 |
| `pet_install_pack` | 复制并安装完整宠物包，不覆盖已有 ID |
| `pet_create_from_image` | 从图片／精灵图生成宠物包和静态封面 |
| `pet_configure` | 按 ID 调整部分参数，可切换当前角色 |
| `pet_show` | 显示宠物，不收起编辑器 |
| `pet_play` | 播放当前角色支持的动作 |
| `pet_say` | 显示文字气泡，可同时指定动作 |

## 宠物包 v1

完整机器可读格式见 `public/pet-api/schema.json`；最小模板可在设置中保存。宠物包为文件夹，包含 `pet.json` 和它引用的本地素材，不运行脚本。素材路径必须留在包内，不支持网页、SVG、远程 URL 或脚本。单个文件不超过 64 MB，包不超过 256 MB。

```json
{
  "version": 1,
  "id": "my-pet",
  "name": "我的宠物",
  "author": "你的名字",
  "license": "素材的授权说明",
  "canvas": { "width": 512, "height": 512 },
  "hitBox": { "x": 0.1, "y": 0.05, "width": 0.8, "height": 0.9 },
  "poster": "poster.png",
  "clips": {
    "idle": { "file": "idle.webp", "durationMs": 3000 },
    "wave": { "file": "wave.webm", "fallback": "wave.webp", "durationMs": 4000 }
  },
  "actions": { "idle": ["idle"], "react": ["wave"], "wave": ["wave"] },
  "phrases": { "greeting": "你好，我来啦。", "tap": ["我在呢。"], "idle": ["记得休息一下。"] }
}
```

`id` 使用小写英文、数字和连字符，不能占用内置 `dsh-blue`。名称与文案支持中文。`canvas` 表示单帧尺寸；`hitBox` 使用 0–1 坐标，定义可点击／拖动的角色区域。画布宽高比需在 0.5–2.5 之间。透明 WebM 建议提供动画 WebP `fallback`，用于 Mac WebKit；系统启用减少动态效果时显示 `poster`。

动作名与素材名分离：`actions` 每个动作可映射多个片段，互动时随机选取。`idle` 必需。标准动作包括 `react`、`wave`、`drag`、`remind`、`celebrate`、`stretch`、`play`、`sleepStart`、`sleep`、`wake`，也可以增加自定义名字。`sleepStart` 播放后转入 `sleep`；待机小动作之间回到首个 idle 片段。

精灵图片段示例（4×4 布局，单帧 256×256，总图 1024×1024）：

```json
{
  "file": "idle-sheet.png",
  "durationMs": 2000,
  "sprite": { "columns": 4, "rows": 4, "frames": 16, "fps": 8 }
}
```

帧顺序为从左到右、从上到下，无间距。行列数 1–32，FPS 1–60。以 `frames / fps` 作为实际播放长度。MCP 的 `pet_create_from_image` 支持同样的 `sprite` 对象并自动生成第一帧封面。

可调参数：`scale` 0.5–1.5，`opacity` 0.3–1，`speed` 0.5–2，`flip` 布尔值，`bubbleColor` 为 `#RRGGBB`，`idleChat` 布尔值，`greeting` 最多 300 字。`pet_configure` 接受部分更新，未传入的参数保持原值。

安装后素材会复制到用户数据目录 `pets/<id>`，原素材移动不会影响已安装宠物。相同 ID 不会静默覆盖；更新素材可使用新 ID，或先从界面移除旧包再导入。内置角色的 MIT 授权和原素材保留。
