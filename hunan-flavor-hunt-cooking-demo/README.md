# 湘味寻宝 · Food Wars 烹饪合成原型

这是一个原生 HTML/CSS/JavaScript 的独立原型。食材卡牌已换成用户指定的完整《Food Wars》卡牌图（含卡面标题、属性和纸张边缘），而不是之前单独的食材图标。

## 运行

在本目录运行：

```bash
python -m http.server 8000
```

浏览器打开 `http://127.0.0.1:8000`。

## 玩法

- 四张完整卡牌固定显示在烹饪锅下方，与锅在同一画面。
- 点击卡牌，或将卡牌拖到中央锅上，即可投料。
- 两张不同食材入锅后自动开始烹饪。等待过程保留在主场景中：锅摇晃、蒸汽浮动、进度条滚动；不会用一个普通加载弹窗替代烹饪界面。
- 摄像头手势（需浏览器摄像头权限、HTTPS/localhost 和网络加载 MediaPipe）：
  - 伸出 1 根手指：辣椒
  - 伸出 2 根手指：猪肉
  - 伸出 3 根手指：鱼头
  - 伸出 4 根手指：湘西腊肉
  - 手势稳定约 0.7 秒会将相应卡牌投进锅。每局选两种食材。
- 不启用摄像头时，点击和拖拽照常可玩。

## LM Studio

接口默认是 `http://127.0.0.1:1234/v1/chat/completions`，请求字段为 OpenAI 兼容的 chat completions 结构。

`js/cooking.js` 中 `LOCAL_MODEL` 默认值为 `local-model`。如果你的 LM Studio 配置要求明确的模型 ID，把它改成当前加载模型的 ID。请在 LM Studio 中允许此网页来源的 CORS 请求。GitHub Pages 是 HTTPS，浏览器访问本机 HTTP API 可能受混合内容/本地网络策略限制；本地开发时建议通过 localhost 启动本页面。

`DEMO_FALLBACK` 默认 `true`，模型请求不可用时会展示预置组合菜谱，方便体验动效。真实模型成功返回时会展示模型生成的菜名、文案和风味。

## 图片

- `assets/ingredient-cards/`：从你指定的四卡合集裁切并移除外部棋盘格的完整卡牌 WebP。
- `assets/scene/`：料理桌与锅具场景插画。

WebP 卡牌采用无损编码并保留 Alpha 透明通道。
