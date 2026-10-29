# 给 AI 的 DSH 自定义气泡制作说明（格式 v1）

请生成一个 UTF-8 的 .json 文件，用户在「聊天外观 → 自定义气泡外观 → 导入设计」导入。
它是聊天气泡的纯数据设计文件，不是网页，不要生成 HTML、CSS、JS、ZIP 或含聊天文字的截图。
文件不能带 Markdown 代码围栏或注释；总大小不超过 512 KiB。设计用于用户和助手两侧，深浅主题都要可读。

必填根字段：format 固定为 "dsh-wx-chat/bubble"；version 为数字 1；name 为 1–40 字；light、dark 为主题对象。
可选根字段：description（最多160字）、layout（下面各项均可省略，省略采用默认值）。其它未知字段会报错。
light / dark：都必须包含 user、assistant，各自必填 background、text、border，全部用 #RRGGBB 六位颜色。
每个主题可带 assets 对象；两个主题的素材分别指定，某主题缺少某个素材表示该主题不绘制它。

layout 字段（数值，单位 CSS px；范围 / 默认值）：
paddingX: 6–40 /14；paddingTop、paddingBottom: 6–40 /12；radius: 0–32 /12；borderWidth: 0–4 /1；
edgeWidth: 8–160 /60；edgeHeight: 0–32 /8；crestWidth: 0–96 /36；crestHeight: 0–32 /16；
cornerSize: 0–48 /18；characterWidth、characterHeight: 16–96 /48。
没有 minHeight 或固定高度字段。短句要紧凑，不要通过扩大图片透明边界或 padding 撑高气泡。

assets 仅支持以下键（值为一条完整 SVG XML 字符串，或 PNG/WebP/JPEG 的 base64 data URL）：
edge：上下横向重复的无缝花边，用 edgeWidth × edgeHeight 绘制；左右端必须衔接。
crest：上下居中的独立装饰，用 crestWidth × crestHeight 绘制。
corner：四个角使用同一张装饰图，用 cornerSize × cornerSize 绘制。
character：角落人物/挂件，用 characterWidth × characterHeight 绘制。宽高须与原画比例一致，透明边缘应裁紧。
background：随气泡拉伸的整面背景，只放纹理/渐变，不要放文字、人脸或必须保持比例的图形。
人物在用户侧右下、助手侧左下镜像；正文永远不镜像。挂件贴住底角，并向头像侧伸出最多10px，保留至少8px头像间隙；只与底部留白重叠，外悬部分由消息间距容纳，不撑高正文区域。
paddingTop 和 paddingBottom 必须不小于已有 edge 的 edgeHeight、crest 的 crestHeight、corner 的 cornerSize/2 的最大值。
素材留空请省略整个键，不要写空字符串或 null。设计可完全不含图片，只使用配色。

SVG 要求：以 <svg 开头，xmlns="http://www.w3.org/2000/svg"，有正数宽高的 viewBox；尺寸最多4096，元素最多4000。
仅允许 svg,g,defs,path,rect,circle,ellipse,line,polyline,polygon,linearGradient,radialGradient,stop,clipPath,title,desc。
允许属性：xmlns,viewBox,width,height,preserveAspectRatio,id,x,y,x1,y1,x2,y2,cx,cy,r,rx,ry,fx,fy,fr,d,points,fill,fill-opacity,fill-rule,stroke,stroke-width,stroke-opacity,stroke-linecap,stroke-linejoin,stroke-miterlimit,stroke-dasharray,stroke-dashoffset,opacity,transform,gradientUnits,gradientTransform,spreadMethod,offset,stop-color,stop-opacity,clip-path,clipPathUnits,clip-rule,vector-effect。
只使用上述属性；渐变/裁剪只能 url(#内部ID)。文字字段用 JSON 双引号，SVG 属性的双引号须用 JSON.stringify 等 JSON 序列化器转义，不要手拼未转义的引号。
不要使用 style/class、script、事件属性、foreignObject、image、use、text、滤镜、动画、外部链接、XML声明、注释或实体。
优先直接写简单 SVG 源码，不要编造 base64。PNG/WebP/JPEG 必须是真实图片编码，宽高最多4096；远程 URL、本地路径不支持。

交付前核对：JSON可解析、字段无拼写错误、深浅主题均有两侧配色、素材可解码、装饰不压字、长文可伸展。
导入会替换当前头像方案中保存的自定义设计，并选中它；先复制头像方案可保留另一套设计。
导入/选择设计独立保存，不会提交尚未保存的颜色/大小等外观草稿。

下方是可直接导入的完整示例，可修改颜色、布局与装饰后另存为 .json：

```json
{
  "format": "dsh-wx-chat/bubble",
  "version": 1,
  "name": "月光信笺",
  "description": "紧凑留白、柔紫配色与波纹花边",
  "layout": {
    "paddingX": 14,
    "paddingTop": 12,
    "paddingBottom": 12,
    "radius": 14,
    "borderWidth": 1,
    "edgeWidth": 60,
    "edgeHeight": 8
  },
  "light": {
    "user": {
      "background": "#eef0ff",
      "text": "#34345c",
      "border": "#c9cbee"
    },
    "assistant": {
      "background": "#fbf8ff",
      "text": "#473b5d",
      "border": "#ded3eb"
    },
    "assets": {
      "edge": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 60 8\"><path d=\"M0 4 Q15 0 30 4 T60 4\" fill=\"none\" stroke=\"#b9a6d5\" stroke-width=\"1.5\"/></svg>"
    }
  },
  "dark": {
    "user": {
      "background": "#29304f",
      "text": "#edf0ff",
      "border": "#596488"
    },
    "assistant": {
      "background": "#30293f",
      "text": "#f0e8fa",
      "border": "#685677"
    },
    "assets": {
      "edge": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 60 8\"><path d=\"M0 4 Q15 0 30 4 T60 4\" fill=\"none\" stroke=\"#8874a1\" stroke-width=\"1.5\"/></svg>"
    }
  }
}
```
