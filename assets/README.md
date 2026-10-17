# 气泡美术素材（2.8.0）

运行时素材内嵌在 client.js，不访问第三方图片服务。方案 JSON 不携带内置皮肤。

| 文件 | 用途 |
| --- | --- |
| cat-skin.webp / cat-dark-skin.webp | 猫猫昼夜整图，身体和脚允许伸缩 |
| ocean-skin.svg / ocean-dark-skin.svg | 澄蓝水波昼夜矢量底图，顶部高光与分层水波 |
| vector/*-edge.svg / *-edge-dark.svg | 120×24 的 SVG 花边单元，按固定 CSS 尺寸重复铺排 |
| vector/*-crest.svg / *-crest-dark.svg | 120×60 的独立蝴蝶结或花束，固定比例、上下居中 |
| vector/*-corner.svg / *-corner-dark.svg | 64×64 的角花，独立等比显示 |
| vector/*-character.* | 三位角色透明原画，独立固定尺寸，正文伸展不改变人物比例 |

dragon 对应莉栀，yuyu 对应鱼鱼，yuyu-cat 对应猫耳鱼鱼，pastoral 对应田园。
SVG 由莉栀用矢量路径绘制，是可编辑的原始源码；不是把旧位图包进 SVG。SVG 花边、中心装饰与人物分层显示，只有写字面随正文宽高变化。
鱼鱼和猫耳鱼鱼角色图片原样保留用户提供的透明 PNG；莉栀使用此前定稿的透明角色 WebP。角色插画仍是位图，边框、花边与装饰为矢量。猫猫沿用此前生成的 WebP。

维护时同时更新文件和 client.js 中对应的 data URL，并核对字节一致性。SVG 的 viewBox 和长宽比属于素材约定；替换前要检查真实聊天、76×40 预览卡、窄窗口与昼夜主题。
完整皮肤绘制在 ::before，不改变原生 Markdown、链接、表格、代码或流式光标。

素材使用权沿用原参考图的权利边界，本项目不额外授予第三方角色图授权。原生思索尾巴来自本机 DSH 0.2.1-rc.2 RunningWhaleTail.REST_PATH。
此前位图生成与编辑记录见 [生成提示词](生成提示词.md)。四套位图边框已由矢量层替代，不随 2.8.0 安装包分发。
