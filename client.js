/**
 * dsh-wx-chat —— DeepSeek Harness 微信风聊天气泡（Client half）。
 * @version 2.4.0
 *
 * 设计原则（presentation-only）：
 * - 不替换任何 `conversation.chat.node` 渲染器，Markdown/代码高亮/流式/
 *   复制/重试/工具调用全部保留原生实现。
 * - 布局与配色全部通过注入 CSS 完成。主钩子是稳定的 data-* 属性
 *   （`data-chat-flow-kind` / `data-chat-turn` / `data-chat-group-part` 等）；
 *   另有**固定 hash 类名**（如 `.xz4KEq_flowItem` / `.xz4KEq_column`）与
 *   `[class*='...']` 子串匹配两种辅助写法。
 *   ⚠ 兼容性：固定 hash 类名随宿主构建版本变化。升级 DSH 后请按 docs/代码导读.md
 *   末尾的「维护检查」核对选择器，不要假设跨版本一定兼容。
 * - 默认配色参考「深海女仆工坊」皮肤：柔金描边 #c5a468、瓷白/深海蓝底、
 *   非对称圆角、柔和蓝影；全部可经配置面板覆盖。
 * - DeepSeek 默认头像为官方鲸鱼 logo（path 取自
 *   @deepseek-ai/dsh-client-ui-primitives 的 FISH_LOGO_PATH，本地内嵌）。
 * - 配置持久化到 localStorage，跨窗口经 storage 事件同步。
 *
 * 动态头像（工具 / 类型 / 角色扮演）：
 * - 数据来源是会话的 ChatSnapshot（经 session 作用域 slot 的标准 prop `useChat`
 *   获得），**不**根据卡片文字猜工具名，也不遍历 React fiber。
 * - 每轮（turn）按工具调用**开始顺序**（原生 `anchorSeq`）求「最后一个已配置并
 *   匹配的工具头像」，本轮内未匹配的调用保留本轮最近一次匹配；**新一轮不继承
 *   上一轮的工具头像**。
 * - **自动模式**下，角色扮演状态只由助手正文里**严格独立行**的标记决定，
 *   不解析用户消息/思考/工具输出/代码块/引用；**手动模式**（开启/关闭）按「轮次边界」
 *   生效、优先于标记，不改写历史。
 * - DOM 装饰：`[data-chat-flow-kind="assistant-step"][data-chat-turn=N]` 行内覆盖
 *   `--wx-avatar-ai-img`；用 MutationObserver 处理虚拟化/折叠造成的行增删。
 *
 * 头像外观：
 * - `avatarSize`（24–96px）驱动 `--wx-avatar-size` 与 gap / 行最小高度。
 * - `avatarRoundness`（0–100）驱动 `--wx-avatar-round`：border-radius = roundness/2 %，
 *   0 -> 直角，50 -> 圆角方形，100 -> 圆形。与气泡圆角彼此独立。
 * - GIF 头像以原始 data:image/gif 保存，走 CSS 遮罩（圆形/圆角方形），不做静态裁剪。
 * - 点击头像区域打开大图预览（遮罩点击 / Esc / 关闭按钮关闭，焦点可恢复）。
 */

/*
 * ──────────────────────────────────────────────────────────────────────────
 * 模块索引：注释里的 WX-Mxx 编号与 docs/代码导读.md 逐项对应，搜索 "WX-M" 可跳转。
 *
 *   WX-M01 模块外壳      __ModuleLoader__ 工厂、require 依赖、inject/apply/__test
 *   WX-M02 常量与默认值  包名/版本、基础 localStorage 键（config/roleplay）、DEFAULTS
 *   WX-M03 数值与背景色  clampNumber、normalizeAvatarBg、亮度对比色
 *   WX-M04 存储读写      readConfig/writeConfig + 写失败上报
 *   WX-M05 配置单例      同窗 configSnapshot / commitConfig / onConfigChange
 *   WX-M06 角色模式边界  每会话 entries[{mode,fromTurn}] + 旧格式惰性迁移
 *   WX-M07 根变量写入    配置 -> CSS 变量/dataset，以及只清自己那份的清理
 *   WX-M08 GIF 识别      MIME/扩展名/文件头三路判定 + data URL MIME 规范化
 *   WX-M09 工具头像解析  类型关键字 + 具体工具名规则
 *   WX-M10 角色标记解析  只认助手正文里的严格独立行
 *   WX-M11 轮次索引      工具调用/turn -> 头像；summarizeSession 汇总会话态
 *   WX-M12 DOM 装饰引擎  行内变量覆盖 + MutationObserver 兜住虚拟化增删
 *   WX-M13 会话状态广播  createSessionInfoStore（按 sessionId 隔离）
 *   WX-M14 大图预览层    命令式弹层 + 头像区域点击命中
 *   WX-M15 时间戳装饰    本地近似渲染时间（非服务器消息时间）
 *   WX-M16 通用弹窗层    portal 宿主、层栈、焦点约束、滚动/焦点还原
 *   WX-M17 裁剪器        拖动/缩放/复位 + 方形 PNG 导出
 *   WX-M18 头像选择行    缩略图 + URL + 上传 + 裁剪/转静态 + 清除
 *   WX-M19 上传读取      取消/失效令牌 createUploadGuard + readAvatarFile
 *   WX-M20 外观预览弹窗  样例会话 + 就地调大小/圆角
 *   WX-M21 角色设置弹窗  模式 + 角色图片 + 状态说明 + 裁剪子层
 *   WX-M22 配置面板      所有配置项的 UI（渲染在插件详情页）
 *   WX-M23 会话内组件    AvatarDriver / RoleplayControl / useConfigValue
 *   WX-M24 样式表        buildCss 返回的整段 CSS（唯一注入点）
 *   WX-M25 装配与销毁    slot 注册、模块级单例、apply 返回值与清理
 *   WX-M26 头像方案库    具名方案 + 预设绑定 + 会话覆盖 + 导入导出（新键 schemes-v1，原子整写；生效顺序：会话覆盖 > 预设绑定 > 默认方案）
 *   WX-M27 会话配置作用域 把某方案的变量写到会话 scope / 弹窗宿主，并完整清理
 *   WX-M28 方案入口      输入框旁的「头像方案」按钮 + 本会话选择弹窗
 *   WX-M29 智能体预设    **只读**拿预设 id/name + 从标准 useSessions 读会话实际预设（绑定与优先级解析）
 *   WX-M30 头像历史      按会话/轮次固定身份，IndexedDB 去重保存；载入、失败降级与卸载重启
 * ──────────────────────────────────────────────────────────────────────────
 */
// ── WX-M01 模块外壳 ─────────────────────────────────────────────────────────
// DSH 的 Web 端在加载 client.js 之前注入 window.__ModuleLoader__，这里只是注册一个工厂；
// 真正的 React / react-dom 由宿主共享模块表通过 require 注入（本项目不是普通 Node 脚本，
// 不能直接 `node client.js` 跑出界面）。factory 返回 { inject, apply, __test }：
// inject 声明 slot 能力，apply 做装配与销毁；__test 暴露测试引用，导出本身不主动调用它们。
window.__ModuleLoader__.load({
  id: '@local/dsh-wx-chat',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback, useRef, useMemo } = React;
    // 弹窗挂到 body 层：优先用原生种子里的 react-dom.createPortal；
    // 拿不到就退化成组件内的固定定位层（不阻断功能，只是可能受祖先 overflow 影响）。
    const ReactDOM = (() => {
      try { return require('react-dom'); } catch (_err) { return null; }
    })();
    const CAN_PORTAL = !!(ReactDOM && typeof ReactDOM.createPortal === 'function');

    // ── WX-M02 常量与默认配置 ─────────────────────────────────────────────
    // 两个 localStorage 键：CONFIG_KEY 存整份配置，ROLE_MODE_KEY 存「每会话角色模式边界」。
    const PACKAGE_NAME = '@local/dsh-wx-chat';
    const VERSION = '2.4.0';
    const CONFIG_KEY = 'dsh-wx-chat/config-v1';
    const ROLE_MODE_KEY = 'dsh-wx-chat/roleplay-v1';

    // ------------------------------------------------------------------
    // DeepSeek 官方鲸鱼 logo（内嵌，来源 dsh-client-ui-primitives FishLogo）
    // path 数据已内嵌在本文件里，属于必须保持完整的常量：不要手改、不要重新格式化。
    // 解包后的项目里没有构建脚本，也没有 original/ 目录，无需拼装步骤。
    // ------------------------------------------------------------------
    const FISH_PATH =
      'M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z';
    const DS_LOGO_SVG =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">' +
      '<circle cx="24" cy="24" r="24" fill="#4D6BFE"/>' +
      '<path transform="translate(12.42 15.48)" d="' + FISH_PATH + '" fill="#ffffff"/>' +
      '</svg>';
    const DS_LOGO_URL = 'data:image/svg+xml;utf8,' + encodeURIComponent(DS_LOGO_SVG);

    // ------------------------------------------------------------------
    // 默认配置（深海女仆工坊配色）
    // ------------------------------------------------------------------
    const DEFAULT_CATEGORY_AVATARS = { search: '', read: '', write: '', command: '' };
    // 头像外观的取值边界：大小、圆角、背景色。UI 与 normalizeConfig 共用这几个常量。
    const AVATAR_SIZE_MIN = 24;
    const AVATAR_SIZE_MAX = 96;
    const AVATAR_SIZE_DEFAULT = 36;
    const AVATAR_ROUNDNESS_DEFAULT = 100;
    // 配置默认值（配置面板的「恢复默认」就是写回这一份；字段说明见 docs/配置字段.md）。
    const DEFAULTS = {
      userAvatar: '',        // URL 或 dataURL；空 = 字母头像
      userLetter: '我',       // 字母头像文字
      aiAvatar: '',          // 空 = 内置官方鲸鱼 logo
      ringColor: '#4d6bfe',  // 头像描边色；空字符串 = 无描边
      userBubble: '',        // 空 = 默认瓷蓝气泡
      aiBubble: '',          // 空 = 默认陶瓷白气泡
      radius: 12,            // 气泡圆角 px（4-20）
      maxWidth: 76,          // 气泡最大宽度 %（50-90）
      showTimestamps: false, // 时间戳装饰（近似渲染时刻）
      mergeAvatars: false,   // 连续同角色消息合并头像
      theme: 'system',       // system | light | dark
      avatarSize: AVATAR_SIZE_DEFAULT,          // 头像边长 px（24-96）
      avatarRoundness: AVATAR_ROUNDNESS_DEFAULT, // 头像圆角 0-100（0 直角 / 100 圆形）
      avatarBg: '',                          // 头像背景纯色：'' = 默认蓝 #4d6bfe；'transparent' = 透明；否则 #rrggbb
      toolAvatars: true,                    // 工具头像总开关
      toolCategoryAvatars: { ...DEFAULT_CATEGORY_AVATARS }, // 类型头像
      toolRules: [],                        // [{ name, avatar }] 具体工具名规则，优先于类型
      roleAvatar: '',                       // 角色扮演头像
      roleMarkerEnabled: true,              // 解析助手正文里的角色扮演标记
    };

    const ROLE_MODES = ['auto', 'on', 'off'];
    const DEFAULT_ROLE_MODE = 'auto';
    const AVATAR_BG_DEFAULT = '#4d6bfe';
    const AVATAR_BG_TRANSPARENT = 'transparent';

    // ── WX-M03 数值与背景色规范化 ─────────────────────────────────────────
    // clampNumber：把任意输入收敛到区间内的整数，非有限数回落 fallback。
    function clampNumber(value, min, max, fallback) {
      const number = Number(value);
      if (!Number.isFinite(number)) return fallback;
      return Math.min(max, Math.max(min, Math.round(number)));
    }

    // ------------------------------------------------------------------
    // localStorage 读写：失败要能被界面告知（不再静默）
    // ------------------------------------------------------------------
    // ── WX-M04 存储读写与失败上报 ─────────────────────────────────────────
    // 写失败不再静默：通知配置面板/弹窗把红字显示出来（配额不足时尤其重要）。
    const storageErrorListeners = new Set();
    let lastStorageError = '';

    function reportStorageError(scope, error) {
      lastStorageError = String((error && error.message) || error || '未知错误');
      const payload = { scope, message: lastStorageError };
      for (const fn of storageErrorListeners) {
        try { fn(payload); } catch (_err) { /* 监听器自身异常不影响主流程 */ }
      }
    }
    function onStorageError(fn) {
      storageErrorListeners.add(fn);
      return () => storageErrorListeners.delete(fn);
    }

    // 归一化：补默认值 + 校正结构。
    // 注意只有 avatarSize / avatarRoundness / avatarBg 在这里被强制收敛；
    // radius、maxWidth 等只有 UI 滑条的 min/max 限制，手改 localStorage 不会被拦。
    function normalizeConfig(parsed) {
      const next = { ...DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
      if (!next.toolCategoryAvatars || typeof next.toolCategoryAvatars !== 'object') {
        next.toolCategoryAvatars = { ...DEFAULT_CATEGORY_AVATARS };
      } else {
        next.toolCategoryAvatars = { ...DEFAULT_CATEGORY_AVATARS, ...next.toolCategoryAvatars };
      }
      if (!Array.isArray(next.toolRules)) next.toolRules = [];
      next.toolRules = next.toolRules
        .filter((r) => r && typeof r === 'object')
        .map((r) => ({ name: String(r.name == null ? '' : r.name), avatar: String(r.avatar == null ? '' : r.avatar) }));
      next.avatarSize = clampNumber(next.avatarSize, AVATAR_SIZE_MIN, AVATAR_SIZE_MAX, AVATAR_SIZE_DEFAULT);
      next.avatarRoundness = clampNumber(next.avatarRoundness, 0, 100, AVATAR_ROUNDNESS_DEFAULT);
      next.avatarBg = normalizeAvatarBg(next.avatarBg);
      return next;
    }
    /** 头像背景只允许：空（默认蓝）/ 'transparent' / #rgb / #rrggbb。其它一律回落默认。 */
    // 白名单式校验：贴图（url(...)）、渐变、命名色都会被拒并回落「默认蓝」。
    function normalizeAvatarBg(value) {
      if (value === undefined || value === null) return '';
      const text = String(value).trim().toLowerCase();
      if (text === '') return '';
      if (text === AVATAR_BG_TRANSPARENT) return AVATAR_BG_TRANSPARENT;
      return /^#[0-9a-f]{6}$/.test(text) || /^#[0-9a-f]{3}$/.test(text) ? text : '';
    }
    /** 解析成 CSS 颜色：'' -> 默认蓝，'transparent' -> transparent，否则原色。 */
    function avatarBgOf(cfg) {
      const value = normalizeAvatarBg(cfg && cfg.avatarBg);
      if (value === AVATAR_BG_TRANSPARENT) return AVATAR_BG_TRANSPARENT;
      return value === '' ? AVATAR_BG_DEFAULT : value;
    }
    function hexToRgb(hex) {
      const text = String(hex || '').replace('#', '');
      const full = text.length === 3 ? text.split('').map((c) => c + c).join('') : text;
      if (!/^[0-9a-f]{6}$/.test(full)) return null;
      return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
    }
    /**
     * 字母头像的文字色：按背景亮度挑深/浅，透明背景用品牌蓝（在亮暗聊天底上都看得清）。
     * @returns CSS 颜色
     */
    // 字母头像的文字色：背景亮用深字、暗用白字，保证浅色背景上也能看清。
    function avatarFgOf(cfg) {
      const bg = avatarBgOf(cfg);
      if (bg === AVATAR_BG_TRANSPARENT) return AVATAR_BG_DEFAULT;
      const rgb = hexToRgb(bg);
      if (!rgb) return '#ffffff';
      const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
      return luminance > 0.62 ? '#172347' : '#ffffff';
    }

    /**
     * 气泡里的文字色：只在**用户自定义了气泡底色**时按实际对比度挑选。
     * 没自定义就返回 ''（调用方写 initial），让 CSS 回落到本主题的 --wx-*-text。
     * 只作用于本插件的气泡，不改用户保存的颜色，也不动宿主全局配色。
     */
    function bubbleTextOn(color) {
      const raw = String(color == null ? '' : color).trim();
      if (!raw || raw === 'transparent') return '';
      const rgb = hexToRgb(raw.toLowerCase());
      if (!rgb) return '';
      // sRGB 先线性化，再计算相对亮度；直接对通道加权会误判中灰、红色等背景。
      const luminanceOf = (channels) => channels.map((value) => {
        const srgb = value / 255;
        return srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
      }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
      const luminance = luminanceOf(rgb);
      const contrastWith = (other) => (Math.max(luminance, other) + 0.05) / (Math.min(luminance, other) + 0.05);
      const navyContrast = contrastWith(luminanceOf([23, 35, 71]));
      const whiteContrast = contrastWith(1);
      if (Math.max(navyContrast, whiteContrast) >= 4.5) {
        return navyContrast >= whiteContrast ? '#172347' : '#ffffff';
      }
      // 中间亮度下白字与主题深蓝都不够清晰，黑字可提供足够对比。
      return '#000000';
    }

    // 读：任何异常（JSON 损坏、被禁用）都回落默认值并上报，不抛给调用方。
    function readConfig() {
      try {
        const raw = localStorage.getItem(CONFIG_KEY);
        if (!raw) return normalizeConfig(null);
        return normalizeConfig(JSON.parse(raw));
      } catch (err) {
        reportStorageError('read', err);
        return normalizeConfig(null);
      }
    }
    // 写：返回 { ok, error, applied }，调用方据此决定提示文案；不抛异常。
    // 结果协议（所有会落盘的入口统一遵守）：
    //   ok:true                     → 已改内存、已写磁盘
    //   ok:false, applied:false     → **提交前**被拒绝（校验/容量/无效目标/文件不合法）：内存与磁盘都没动
    //   ok:false, applied:true      → 已改进本窗内存，只是没写进磁盘（配额/存储被禁用）
    function rejectedResult(error) {
      return { ok: false, error: String(error == null ? '' : error), applied: false };
    }
    function writeFailureResult(error) {
      return { ok: false, error: String(error == null ? '' : error), applied: true };
    }
    /** 成功的统一形状（applied:true 便于 UI 一视同仁地判断）。 */
    function okResult() {
      return { ok: true, error: '', applied: true };
    }
    /**
     * 保存结果 → 界面提示（所有会写盘的入口共用，措辞必须严格区分）：
     * - 提交前被拒绝（applied === false）：什么都没改，**不能说「已生效」**；
     * - 已改本窗内存但没写盘（applied === true）：才可以说「当前窗口已生效、刷新后可能丢失」。
     */
    function resultNotice(result, okText) {
      if (result && result.ok === false) {
        if (result.applied === false) {
          return {
            failed: true, applied: false,
            text: '未应用、也没有修改任何已保存的设置：' + (result.error || '这次改动没有被接受') + '。',
          };
        }
        return {
          failed: true, applied: true,
          text: '当前窗口已生效，但保存失败（' + (result.error || '存储不可用')
            + '）：刷新后可能回到上一个设置。',
        };
      }
      return { failed: false, applied: true, text: okText || '' };
    }
    function writeConfig(config) {
      try {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
        return okResult();
      } catch (err) {
        reportStorageError('write', err);
        // 内存里已经换成新值了（见 commitConfig），所以这里必须标 applied:true
        return writeFailureResult(String((err && err.message) || err || ''));
      }
    }

    // 同窗配置单例：配置面板、头像引擎、控件都从这里读，避免各自读盘
    // ── WX-M05 同窗配置单例与提交 ─────────────────────────────────────────
    // 面板、头像引擎、控件共用一个内存快照，避免各自读盘导致不一致。
    let configCache = null;
    const configListeners = new Set();
    function configSnapshot() {
      if (configCache === null) configCache = readConfig();
      return configCache;
    }
    // 提交一次修改：归一化 -> 写盘 -> 更新内存快照并重构根变量 -> 广播给订阅者。
    // 即使写盘失败也保留内存新值，本窗预览不被旧值覆盖（返回值告诉调用方是否落盘）。
    /**
     * 合并一次配置补丁。
     * 普通字段是浅合并；但 `toolCategoryAvatars` 是**嵌套对象**，必须逐键合并——
     * 否则调用方只传「某一类」时（例如只改 search），其它三类会被打回默认值。
     * 传入函数时按旧语义整体替换（函数自己负责给出完整配置）。
     */
    function mergeConfigPatch(prev, patch) {
      if (typeof patch === 'function') return patch(prev);
      const next = { ...prev, ...patch };
      if (patch && patch.toolCategoryAvatars && prev.toolCategoryAvatars) {
        next.toolCategoryAvatars = { ...prev.toolCategoryAvatars, ...patch.toolCategoryAvatars };
      }
      return next;
    }
    function commitConfig(patch) {
      // 写路径先过字段闸门：绝不允许「报保存成功、刷新后被打回」
      const gate = checkConfigPatch(typeof patch === 'function' ? null : patch);
      if (!gate.ok) return gate;
      const prev = configSnapshot();
      const next = normalizeConfig(mergeConfigPatch(prev, patch));
      const result = writeConfig(next);
      // 写入失败也保留内存里的新值：本窗预览继续用新配置，不被旧 localStorage 值覆盖
      configCache = next;
      applyConfig(document.documentElement, next);
      for (const fn of configListeners) {
        try { fn(next, result); } catch (_err) { /* 监听器自身异常不影响主流程 */ }
      }
      return result;
    }
    function onConfigChange(fn) {
      configListeners.add(fn);
      return () => configListeners.delete(fn);
    }
    function notifyConfig(next, result) {
      configCache = next === undefined ? readConfig() : next;
      for (const fn of configListeners) {
        try { fn(configCache, result || { ok: true, error: '' }); } catch (_err) { /* 空实现 */ }
      }
    }

    // ------------------------------------------------------------------
    // 每会话角色扮演模式（按「轮次边界」记录，历史不被倒灌）
    // 存储：{ [sessionId]: { entries: [{ mode, fromTurn }] } }
    // 旧格式（值为 'auto'|'on'|'off' 字符串）在首次得知该会话轮次时惰性迁移：
    // 历史保持 auto，旧值只作用于「当前未结束轮 / 下一轮」及其之后。
    // ------------------------------------------------------------------
    // ── WX-M26 头像方案库（具名方案 + 预设绑定 + 会话覆盖） ───────────────
    // 存储（新键，原子整写）：
    //   dsh-wx-chat/schemes-v1 = {
    //     version: 1,
    //     schemes: { <schemeId>: { id, name, config } },
    //     presetBindings: { <presetId>: <schemeId> },   // 智能体预设 → 方案（默认路径）
    //     bindings: { <sessionId>: <schemeId> }         // 本会话的显式覆盖（临时例外）
    //   }
    // 生效顺序（唯一权威解析 resolveScheme(sessionId, presetId)）：
    //   **本会话显式覆盖 > 本会话实际智能体预设的绑定 > 默认方案**
    // 注意：bindings[s] === 'default' 是「本会话明确用默认方案」，与「没有这条绑定
    //   （跟随预设）」是两回事，读入时必须原样保留。
    // 关键设计：
    // - **默认方案不存副本**：它的实时配置就是 config-v1（旧数据零迁移，老用户体验不变）；
    //   只有具名方案才把整份配置存进本键，因此不会在读取时复制多份大 GIF。
    // - 旧键 config-v1 / roleplay-v1 的格式完全不动；会话的 auto/on/off 仍由 roleplay-v1 管，不进入方案。
    // - 绑定缺失或指向已删除方案 → 安全回落默认（只读回落，不写回、不伪造成功）。
    // - 本键的每次修改都是整体一次写，读失败/写失败都如实上报。
    const SCHEMES_KEY = 'dsh-wx-chat/schemes-v1';
    const SCHEME_EXPORT_FORMAT = 'dsh-wx-chat/scheme';
    const SCHEME_EXPORT_VERSION = 1;
    const DEFAULT_SCHEME_ID = 'default';
    const DEFAULT_SCHEME_NAME = '默认方案';
    const SCHEME_MAX_COUNT = 50;
    const SCHEME_MAX_RULES = 200;
    const SCHEME_NAME_MAX = 40;
    // ── 容量规则（写 / 读 / 导入三处**必须同一套**，否则会出现「保存成功、刷新后整套消失」）──
    // 单个字符串字段（头像 data URL 等）上限 3M 字符：足够放常见的 GIF 头像，
    // 且仍在 localStorage 常见配额之内；超限一律**在写入前拒绝**，绝不先写后丢。
    const SCHEME_MAX_STRING_CHARS = 3 * 1024 * 1024;
    // 整个方案库序列化后的上限（字符数）：防止一次性写爆配额。
    const SCHEME_MAX_STORE_CHARS = 6 * 1024 * 1024;
    const SCHEME_THEMES = ['system', 'light', 'dark'];
    // 危险键：绝不写进字典，也绝不当成已存在的方案/预设
    const UNSAFE_DICT_KEYS = ['__proto__', 'prototype', 'constructor'];
    /** 自建方案 id 的形状（新建时由 newSchemeId 生成，导入时也按这个校验） */
    const SCHEME_ID_PATTERN = /^s-[a-z0-9-]{4,64}$/;
    // 方案里允许出现的配置字段＝DEFAULTS 的全部字段（含主题/气泡/合并头像/时间戳）。
    const SCHEME_CONFIG_KEYS = Object.keys(DEFAULTS);
    const SCHEME_NUMBER_KEYS = SCHEME_CONFIG_KEYS.filter((key) => typeof DEFAULTS[key] === 'number');
    const SCHEME_STRING_KEYS = SCHEME_CONFIG_KEYS.filter((key) => typeof DEFAULTS[key] === 'string');
    const SCHEME_BOOL_KEYS = SCHEME_CONFIG_KEYS.filter((key) => typeof DEFAULTS[key] === 'boolean');

    /** 字典只认自有属性：继承来的 constructor/__proto__ 不能充当「已存在」。 */
    function hasOwn(dict, key) {
      return !!dict && Object.prototype.hasOwnProperty.call(dict, key);
    }
    function isUnsafeKey(key) {
      return UNSAFE_DICT_KEYS.indexOf(String(key)) >= 0;
    }
    /** 合法方案 id（**写入/调用方传入**时用）：默认方案，或形如 s-xxxx 的自建 id。 */
    function isSchemeId(value) {
      const id = String(value == null ? '' : value);
      return id === DEFAULT_SCHEME_ID || SCHEME_ID_PATTERN.test(id);
    }
    /** 存储里可以接受的方案 id（**读入**时用）：不卡形状，只挡空串/危险键/超长。 */
    function isStorableId(value) {
      const id = String(value == null ? '' : value);
      if (!id || id.length > 200 || isUnsafeKey(id)) return false;
      return id === DEFAULT_SCHEME_ID || true;
    }
    /** 合法预设 id：非空、有限长度、不是危险键（宿主给的 id 通常是 uuid 形态，不做形状限制）。 */
    function isPresetId(value) {
      const id = String(value == null ? '' : value);
      return id.length > 0 && id.length <= 200 && !isUnsafeKey(id);
    }

    /** 深拷贝：方案的新建/复制/导入都必须走它，避免嵌套 toolRules/分类头像被共享。 */
    function deepCopy(value) {
      if (typeof structuredClone === 'function') {
        try { return structuredClone(value); } catch (_err) { /* 回落 JSON */ }
      }
      return JSON.parse(JSON.stringify(value));
    }
    function newSchemeId() {
      return 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    }
    function normalizeSchemeName(name, fallback) {
      const text = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
      if (!text) return fallback || '未命名方案';
      return text.slice(0, SCHEME_NAME_MAX);
    }

    let schemeCache = null;
    let lastSchemeError = '';
    const schemeListeners = new Set();

    /** 校验并收敛方案库结构；任何不合法内容都丢弃，不抛给调用方。 */
    function normalizeSchemeStore(parsed) {
      // 字典一律用无原型对象：这样 Object.entries 不会拿到继承键，
      // 也不会有 __proto__ 之类的写入污染。
      const out = { version: 1, schemes: Object.create(null), bindings: Object.create(null), presetBindings: Object.create(null) };
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
      const rawSchemes = parsed.schemes && typeof parsed.schemes === 'object' && !Array.isArray(parsed.schemes)
        ? parsed.schemes : {};
      for (const [key, value] of Object.entries(rawSchemes)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const id = String(key);
        // 默认方案由 config-v1 承载；其它 id 只做「安全」判断，不按形状卡死
        // （形状卡死会把历史/手写数据整条丢掉，那是真的丢用户数据）。
        if (id === DEFAULT_SCHEME_ID || !isStorableId(id)) continue;
        // 结构性坏条目（config 根本不是对象）没有可保留的内容 → 丢弃；
        // 但 config 是对象只是**某些字段**坏 → 逐字段修复并保留这个方案。
        if (!value.config || typeof value.config !== 'object' || Array.isArray(value.config)) continue;
        out.schemes[id] = {
          id,
          name: normalizeSchemeName(value.name, '未命名方案'),
          config: sanitizeSchemeConfig(value.config),
        };
      }
      const rawBindings = parsed.bindings && typeof parsed.bindings === 'object' && !Array.isArray(parsed.bindings)
        ? parsed.bindings : {};
      for (const [key, value] of Object.entries(rawBindings)) {
        const sessionId = String(key);
        const schemeId = String(value == null ? '' : value);
        if (!sessionId || isUnsafeKey(sessionId) || !isStorableId(schemeId)) continue;
        // 'default' 也允许：它表示「本会话显式覆盖成默认方案」，与「没有覆盖（跟随预设）」不是一回事。
        if (schemeId !== DEFAULT_SCHEME_ID && !hasOwn(out.schemes, schemeId)) continue;   // 指向不存在的方案 → 不记
        out.bindings[sessionId] = schemeId;
      }
      const rawPresetBindings = parsed.presetBindings && typeof parsed.presetBindings === 'object' && !Array.isArray(parsed.presetBindings)
        ? parsed.presetBindings : {};
      for (const [key, value] of Object.entries(rawPresetBindings)) {
        const presetId = String(key);
        const schemeId = String(value == null ? '' : value);
        if (!isPresetId(presetId) || !isStorableId(schemeId)) continue;
        // 预设绑定只指向**存在**的具名方案；指向默认方案等同于没绑定（跟随默认就是没有绑定）。
        if (schemeId === DEFAULT_SCHEME_ID || !hasOwn(out.schemes, schemeId)) continue;
        out.presetBindings[presetId] = schemeId;
      }
      return out;
    }

    /**
     * 校验**一个配置字段**（写 / 读 / 导入共用同一套规则）。
     * mode='write' 用严格容量（写不进去就拒绝）；mode='read' 只看类型/枚举/有限性，
     * 容量放宽到整库上限 —— 因为「已经存在存储里的数据」不该在读的时候被删掉。
     */
    function validateConfigField(key, value, mode) {
      if (value === undefined) return;
      const expected = typeof DEFAULTS[key];
      if (typeof value !== expected) throw new Error('配置项「' + key + '」的类型不正确');
      if (expected === 'number' && !Number.isFinite(value)) throw new Error('配置项「' + key + '」的数值不合法');
      if (expected === 'string') {
        const limit = mode === 'read' ? SCHEME_MAX_STORE_CHARS : SCHEME_MAX_STRING_CHARS;
        if (value.length > limit) throw new Error('配置项「' + key + '」的内容过大（超过 ' + Math.round(limit / 1024 / 1024) + 'M 字符）');
        if (key === 'theme' && SCHEME_THEMES.indexOf(value) < 0) throw new Error('主题取值不合法');
      }
    }
    function validateCategoryAvatars(raw, mode) {
      if (raw === undefined) return null;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('工具分类头像的格式不正确');
      const next = { ...DEFAULT_CATEGORY_AVATARS };
      for (const key of Object.keys(DEFAULT_CATEGORY_AVATARS)) {
        if (!hasOwn(raw, key)) continue;
        const value = raw[key];
        if (typeof value !== 'string') throw new Error('工具分类头像「' + key + '」的类型不正确');
        const limit = mode === 'read' ? SCHEME_MAX_STORE_CHARS : SCHEME_MAX_STRING_CHARS;
        if (value.length > limit) throw new Error('工具分类头像「' + key + '」的内容过大');
        next[key] = value;
      }
      return next;
    }
    function validateToolRules(raw, mode) {
      if (raw === undefined) return null;
      if (!Array.isArray(raw)) throw new Error('工具名规则的格式不正确');
      if (raw.length > SCHEME_MAX_RULES) throw new Error('工具名规则太多了（最多 ' + SCHEME_MAX_RULES + ' 条）');
      const limit = mode === 'read' ? SCHEME_MAX_STORE_CHARS : SCHEME_MAX_STRING_CHARS;
      return raw.map((rule) => {
        if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new Error('工具名规则的条目格式不正确');
        const name = rule.name;
        const avatar = rule.avatar === undefined ? '' : rule.avatar;
        if (typeof name !== 'string' || typeof avatar !== 'string') throw new Error('工具名规则的条目类型不正确');
        if (avatar.length > limit) throw new Error('工具名规则里的头像过大');
        return { name, avatar };
      });
    }

    /**
     * 校验一份方案配置（**导入**用）：逐字段核对类型与取值，未知字段忽略。
     * 出错时抛带**面向使用者**文案的 Error（不泄露实现术语）。
     */
    function validateSchemeConfig(raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('方案的配置部分格式不正确');
      const merged = { ...DEFAULTS };
      for (const key of SCHEME_CONFIG_KEYS) {
        if (!hasOwn(raw, key)) continue;
        validateConfigField(key, raw[key], 'write');
        merged[key] = raw[key];
      }
      const categories = validateCategoryAvatars(raw.toolCategoryAvatars, 'write');
      if (categories) merged.toolCategoryAvatars = categories;
      const rules = validateToolRules(raw.toolRules, 'write');
      if (rules) merged.toolRules = rules;
      // 不认识的字段直接忽略（merged 只从 DEFAULTS 与已知键构造）
      return normalizeConfig(merged);
    }

    /**
     * 写路径的字段闸门：只校验**这次补丁里出现的字段**（与导入/读盘同一套逐字段规则），
     * 不合法就拒绝这次写入（不写、不改内存），避免出现「报保存成功、刷新后方案消失」。
     * 只校验补丁字段而不是整份配置，是为了不因为历史遗留的其它字段而挡住正常编辑。
     * @returns { ok, error }
     */
    function checkConfigPatch(patch) {
      if (!patch || typeof patch !== 'object') return okResult();
      try {
        for (const key of SCHEME_CONFIG_KEYS) {
          if (!hasOwn(patch, key)) continue;
          validateConfigField(key, patch[key], 'write');
        }
        if (hasOwn(patch, 'toolCategoryAvatars')) validateCategoryAvatars(patch.toolCategoryAvatars, 'write');
        if (hasOwn(patch, 'toolRules')) validateToolRules(patch.toolRules, 'write');
      } catch (err) {
        return rejectedResult((err && err.message) || err);
      }
      return okResult();
    }

    /**
     * 读盘用的**宽容修复**：单个字段不合法就丢掉这个字段，但**保留这个方案**。
     * 这样「写进去过的数据」不会在读的时候让整套方案凭空消失（不静默删用户数据）。
     */
    function sanitizeSchemeConfig(raw) {
      const merged = { ...DEFAULTS };
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return normalizeConfig(merged);
      for (const key of SCHEME_CONFIG_KEYS) {
        if (!hasOwn(raw, key)) continue;
        try {
          validateConfigField(key, raw[key], 'read');
          merged[key] = raw[key];
        } catch (_err) { /* 只丢这个字段 */ }
      }
      try {
        const categories = validateCategoryAvatars(raw.toolCategoryAvatars, 'read');
        if (categories) merged.toolCategoryAvatars = categories;
      } catch (_err) { /* 分类头像坏了就整块回默认 */ }
      try {
        const rules = validateToolRules(raw.toolRules, 'read');
        if (rules) merged.toolRules = rules;
      } catch (_err) { merged.toolRules = []; }
      return normalizeConfig(merged);
    }

    /**
     * 写入前的容量闸门：与 validateSchemeConfig 使用同一套上限，
     * 保证「能写进去的，读回来一定还在」。返回 { ok, error }，不抛。
     */
    function checkSchemeCapacity(config) {
      const tooBig = '这张图片太大，无法保存（超过 ' + Math.round(SCHEME_MAX_STRING_CHARS / 1024 / 1024) + 'M 字符）：请换更小的图片，或改用图片 URL。';
      for (const key of SCHEME_STRING_KEYS) {
        const value = config[key];
        if (typeof value === 'string' && value.length > SCHEME_MAX_STRING_CHARS) return rejectedResult(tooBig);
      }
      for (const key of Object.keys(DEFAULT_CATEGORY_AVATARS)) {
        const value = config.toolCategoryAvatars && config.toolCategoryAvatars[key];
        if (typeof value === 'string' && value.length > SCHEME_MAX_STRING_CHARS) return rejectedResult(tooBig);
      }
      if (Array.isArray(config.toolRules)) {
        for (const rule of config.toolRules) {
          if (rule && typeof rule.avatar === 'string' && rule.avatar.length > SCHEME_MAX_STRING_CHARS) {
            return rejectedResult(tooBig);
          }
        }
      }
      return okResult();
    }
    /** 整库体积闸门（序列化后字符数）。 */
    function checkStoreCapacity(store) {
      let text = '';
      try { text = JSON.stringify(store); } catch (_err) { return rejectedResult('方案数据无法序列化'); }
      if (text.length > SCHEME_MAX_STORE_CHARS) {
        return rejectedResult('方案数据总量过大，无法保存：请删掉一些方案或改用更小的图片。');
      }
      return okResult();
    }

    function readSchemeStore() {
      if (schemeCache !== null) return schemeCache;
      try {
        const raw = localStorage.getItem(SCHEMES_KEY);
        schemeCache = raw ? normalizeSchemeStore(JSON.parse(raw)) : normalizeSchemeStore(null);
      } catch (err) {
        reportStorageError('read', err);
        schemeCache = normalizeSchemeStore(null);
      }
      return schemeCache;
    }
    /** 整库一次写；失败时保留内存新值（本窗继续可用）并上报。 */
    function persistSchemeStore(next) {
      // 写入前先过容量闸门：绝不允许写进一份「读回来会被判定为坏方案」的数据
      const capacity = checkStoreCapacity(next);
      if (!capacity.ok) {
        // 整库体积超限：提交前拒绝，内存与磁盘都不动
        for (const fn of schemeListeners) {
          try { fn(schemeCache || readSchemeStore(), capacity); } catch (_err) { /* 忽略 */ }
        }
        return capacity;
      }
      let result = okResult();
      try {
        localStorage.setItem(SCHEMES_KEY, JSON.stringify(next));
      } catch (err) {
        reportStorageError('write', err);
        result = writeFailureResult(String((err && err.message) || err || ''));
      }
      schemeCache = next;
      normalizeEditingTarget();
      for (const fn of schemeListeners) {
        try { fn(next, result); } catch (_err) { /* 监听器自身异常不影响主流程 */ }
      }
      return result;
    }
    function onSchemeChange(fn) {
      schemeListeners.add(fn);
      return () => schemeListeners.delete(fn);
    }
    /**
     * 编辑目标（ghost）回落：方案被**别的窗口**删除、或 localStorage 被清空后，
     * 界面必须回到一个有效的默认编辑目标，否则会一直显示「正在编辑：默认」却拿旧 id 拒绝所有操作。
     */
    function normalizeEditingTarget() {
      if (editingScheme === DEFAULT_SCHEME_ID) return;
      if (getScheme(editingScheme)) return;
      editingScheme = DEFAULT_SCHEME_ID;
      for (const fn of editingSchemeListeners) {
        try { fn(editingScheme); } catch (_err) { /* 监听器自身异常不影响主流程 */ }
      }
    }
    function notifySchemes(next, result) {
      schemeCache = next === undefined ? (schemeCache = null, readSchemeStore()) : next;
      normalizeEditingTarget();
      for (const fn of schemeListeners) {
        try { fn(schemeCache, result || { ok: true, error: '' }); } catch (_err) { /* 同上 */ }
      }
    }
    /** 读失败/写失败都记在这里，供界面区分「保存失败」与「读取失败」。 */
    function lastSchemeFailure() {
      return lastSchemeError;
    }

    // 「正在编辑的方案」：配置面板与外观预览弹窗共用同一个编辑目标。
    // 只存内存（不落盘）：它是界面状态，不是用户数据；被删的方案会自动回落默认。
    let editingScheme = DEFAULT_SCHEME_ID;
    const editingSchemeListeners = new Set();
    function editingSchemeId() {
      if (editingScheme !== DEFAULT_SCHEME_ID && !getScheme(editingScheme)) editingScheme = DEFAULT_SCHEME_ID;
      return editingScheme;
    }
    function setEditingScheme(schemeId) {
      const next = schemeId && getScheme(schemeId) ? schemeId : DEFAULT_SCHEME_ID;
      if (next === editingScheme) return next;
      editingScheme = next;
      for (const fn of editingSchemeListeners) {
        try { fn(next); } catch (_err) { /* 监听器自身异常不影响主流程 */ }
      }
      return next;
    }
    function onEditingSchemeChange(fn) {
      editingSchemeListeners.add(fn);
      return () => editingSchemeListeners.delete(fn);
    }

    function listSchemes() {
      const store = readSchemeStore();
      const named = Object.values(store.schemes)
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
        .map((scheme) => ({ id: scheme.id, name: scheme.name, builtin: false }));
      return [{ id: DEFAULT_SCHEME_ID, name: DEFAULT_SCHEME_NAME, builtin: true }].concat(named);
    }
    function getScheme(schemeId) {
      if (schemeId === DEFAULT_SCHEME_ID || !schemeId) {
        return { id: DEFAULT_SCHEME_ID, name: DEFAULT_SCHEME_NAME, builtin: true };
      }
      const schemes = readSchemeStore().schemes;
      // 只认自有属性：'constructor' / '__proto__' 这类继承键绝不能变成「有效方案」
      if (!hasOwn(schemes, schemeId)) return null;
      const scheme = schemes[schemeId];
      return scheme ? { id: scheme.id, name: scheme.name, builtin: false } : null;
    }
    /** 某方案的完整配置：默认方案走 config-v1（兼容），具名方案读方案库。 */
    function schemeConfigOf(schemeId) {
      if (!schemeId || schemeId === DEFAULT_SCHEME_ID) return configSnapshot();
      const schemes = readSchemeStore().schemes;
      if (!hasOwn(schemes, schemeId)) return configSnapshot();
      const scheme = schemes[schemeId];
      return scheme ? scheme.config : configSnapshot();
    }
    /** 该会话的**显式覆盖**（本会话手动选的那个方案），没有覆盖时返回 ''。 */
    function sessionOverrideId(sessionId) {
      if (!sessionId) return '';
      const bindings = readSchemeStore().bindings;
      const key = String(sessionId);
      if (!hasOwn(bindings, key)) return '';
      const bound = String(bindings[key]);
      if (!isStorableId(bound)) return '';
      if (bound !== DEFAULT_SCHEME_ID && !hasOwn(readSchemeStore().schemes, bound)) return '';  // 已删 → 视为没有覆盖
      return bound;
    }
    /** 某智能体预设绑定的方案 id，没有有效绑定返回 ''。 */
    function presetSchemeId(presetId) {
      if (!isPresetId(presetId)) return '';
      const presetBindings = readSchemeStore().presetBindings;
      if (!hasOwn(presetBindings, String(presetId))) return '';
      const bound = String(presetBindings[String(presetId)]);
      if (bound === DEFAULT_SCHEME_ID || !hasOwn(readSchemeStore().schemes, bound)) return '';
      return bound;
    }
    /**
     * 生效方案的解析（唯一权威入口）：
     *   本会话显式覆盖 > 本会话实际智能体预设的绑定 > 旧默认方案。
     * @returns { schemeId, source: 'session' | 'preset' | 'default' }
     */
    function resolveScheme(sessionId, presetId) {
      const override = sessionOverrideId(sessionId);
      if (override) return { schemeId: override, source: 'session' };
      const fromPreset = presetSchemeId(presetId);
      if (fromPreset) return { schemeId: fromPreset, source: 'preset' };
      return { schemeId: DEFAULT_SCHEME_ID, source: 'default' };
    }
    /** 兼容旧调用：只按会话解析（不带预设信息）。 */
    function sessionSchemeId(sessionId) {
      return resolveScheme(sessionId, '').schemeId;
    }
    /** 该会话当前生效的配置（所有渲染/上传/预览都必须用它，而不是全局 configSnapshot）。 */
    function effectiveConfig(sessionId, presetId) {
      return schemeConfigOf(resolveScheme(sessionId, presetId).schemeId);
    }
    /** 显式覆盖到某方案；schemeId 可以是 'default'（= 明确用默认方案，与「跟随预设」不同）。 */
    function setSessionScheme(sessionId, schemeId) {
      if (!sessionId || isUnsafeKey(sessionId)) return rejectedResult('没有会话上下文');
      const target = String(schemeId == null ? '' : schemeId);
      // 兼容旧语义：传 null/'' = 清除覆盖（回到跟随预设），与传 'default'（显式覆盖成默认方案）区分
      if (!target) return clearSessionScheme(sessionId);
      if (!isSchemeId(target)) return rejectedResult('这个方案不能用于会话');
      if (target !== DEFAULT_SCHEME_ID && !getScheme(target)) return rejectedResult('这个方案已经不存在了');
      const store = readSchemeStore();
      const bindings = Object.assign(Object.create(null), store.bindings);
      bindings[String(sessionId)] = target;
      return persistSchemeStore({ ...store, bindings });
    }
    /** 清除显式覆盖 → 该会话回到「跟随预设 / 默认」。 */
    function clearSessionScheme(sessionId) {
      if (!sessionId) return rejectedResult('没有会话上下文');
      const store = readSchemeStore();
      const key = String(sessionId);
      if (!hasOwn(store.bindings, key)) return okResult();
      const bindings = Object.assign(Object.create(null), store.bindings);
      delete bindings[key];
      return persistSchemeStore({ ...store, bindings });
    }
    /** 预设 → 方案绑定；schemeId 传 '' / 'default' 表示取消该预设的绑定。 */
    function setPresetScheme(presetId, schemeId) {
      if (!isPresetId(presetId)) return rejectedResult('这个智能体预设无法绑定');
      const target = String(schemeId == null ? '' : schemeId);
      const store = readSchemeStore();
      const presetBindings = Object.assign(Object.create(null), store.presetBindings);
      if (!target || target === DEFAULT_SCHEME_ID) {
        delete presetBindings[String(presetId)];
        return persistSchemeStore({ ...store, presetBindings });
      }
      if (!getScheme(target)) return rejectedResult('这个方案已经不存在了');
      presetBindings[String(presetId)] = target;
      return persistSchemeStore({ ...store, presetBindings });
    }
    function presetBindingsSnapshot() {
      const presetBindings = readSchemeStore().presetBindings;
      const out = {};
      for (const key of Object.keys(presetBindings)) out[key] = presetBindings[key];
      return out;
    }
    /** 按方案提交配置：默认方案写 config-v1（旧 API），具名方案整库写。 */
    function commitSchemeConfig(schemeId, patch) {
      if (!schemeId || schemeId === DEFAULT_SCHEME_ID) return commitConfig(patch);
      const store = readSchemeStore();
      if (!hasOwn(store.schemes, schemeId)) return rejectedResult('这个方案已经不存在了');
      const scheme = store.schemes[schemeId];
      const prev = scheme.config;
      const next = normalizeConfig(mergeConfigPatch(prev, patch));
      // 与读/导入同一套规则：字段不合法或写不进去就拒绝，绝不先写后丢
      const gate = checkConfigPatch(typeof patch === 'function' ? null : patch);
      if (!gate.ok) return gate;
      const capacity = checkSchemeCapacity(next);
      if (!capacity.ok) return capacity;
      const result = persistSchemeStore({
        ...store,
        schemes: Object.assign(Object.create(null), store.schemes, { [schemeId]: { ...scheme, config: next } }),
      });
      return result;
    }
    function createScheme(name, basedOnSchemeId) {
      const store = readSchemeStore();
      if (Object.keys(store.schemes).length >= SCHEME_MAX_COUNT) {
        return rejectedResult('方案数量已达上限（' + SCHEME_MAX_COUNT + ' 个）');
      }
      const base = schemeConfigOf(basedOnSchemeId || DEFAULT_SCHEME_ID);
      const id = newSchemeId();
      const scheme = { id, name: normalizeSchemeName(name, '新方案'), config: deepCopy(base) };
      const result = persistSchemeStore({
        ...store,
        schemes: Object.assign(Object.create(null), store.schemes, { [id]: scheme }),
      });
      return { ...result, id };
    }
    function copyScheme(fromSchemeId, name) {
      const source = getScheme(fromSchemeId);
      if (!source) return rejectedResult('找不到要复制的方案');
      return createScheme(name || (source.name + ' 副本'), fromSchemeId);
    }
    function renameScheme(schemeId, name) {
      if (!schemeId || schemeId === DEFAULT_SCHEME_ID) return rejectedResult('默认方案不能改名');
      const store = readSchemeStore();
      const scheme = store.schemes[schemeId];
      if (!scheme) return rejectedResult('找不到这个方案');
      const nextName = normalizeSchemeName(name, scheme.name);
      const result = persistSchemeStore({
        ...store,
        schemes: Object.assign(Object.create(null), store.schemes, { [schemeId]: { ...scheme, name: nextName } }),
      });
      return { ...result, name: nextName };
    }
    /** 删除具名方案：同时清掉指向它的会话绑定（那些会话回落默认）。默认方案不可删。 */
    /**
     * 删除具名方案：同时清掉引用它的**会话显式覆盖**与**预设绑定**，
     * 这些会话/预设按优先级回落（预设绑定被清 → 跟随默认）。默认方案不可删。
     */
    function deleteScheme(schemeId) {
      if (!schemeId || schemeId === DEFAULT_SCHEME_ID) return rejectedResult('默认方案不能删除');
      const store = readSchemeStore();
      if (!hasOwn(store.schemes, schemeId)) return rejectedResult('找不到这个方案');
      const schemes = Object.assign(Object.create(null), store.schemes);
      delete schemes[schemeId];
      const bindings = Object.create(null);
      let affectedSessions = 0;
      for (const [sessionId, bound] of Object.entries(store.bindings)) {
        if (bound === schemeId) affectedSessions += 1;
        else bindings[sessionId] = bound;
      }
      const presetBindings = Object.create(null);
      let affectedPresets = 0;
      for (const [presetId, bound] of Object.entries(store.presetBindings)) {
        if (bound === schemeId) affectedPresets += 1;
        else presetBindings[presetId] = bound;
      }
      const result = persistSchemeStore({ version: 1, schemes, bindings, presetBindings });
      return { ...result, affectedSessions, affectedPresets };
    }
    /** 导出：只带 format/version/name/config，不含会话、绑定、角色模式历史。 */
    function exportScheme(schemeId) {
      const scheme = getScheme(schemeId);
      if (!scheme) return rejectedResult('找不到这个方案');
      const config = schemeConfigOf(scheme.id);
      const payload = { format: SCHEME_EXPORT_FORMAT, version: SCHEME_EXPORT_VERSION, name: scheme.name, config: {} };
      for (const key of SCHEME_CONFIG_KEYS) payload.config[key] = deepCopy(config[key]);
      return { ok: true, payload };
    }
    /** 导入：完整校验后才提交，默认“新建方案”，重名自动加后缀，不覆盖任何现有方案。 */
    function importScheme(payload) {
      let text = '';
      if (typeof payload === 'string') {
        text = payload;
        // 与写/读同一套容量规则：整个方案文件的上限
        if (text.length > SCHEME_MAX_STORE_CHARS) return rejectedResult('这份文件太大了，无法导入');
        try {
          payload = JSON.parse(text);
        } catch (_err) {
          return rejectedResult('这个文件不是有效的 JSON，无法导入');
        }
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return rejectedResult('这个文件不是头像方案，无法导入');
      }
      if (payload.format !== SCHEME_EXPORT_FORMAT) return rejectedResult('这不是本插件导出的头像方案文件');
      if (payload.version !== SCHEME_EXPORT_VERSION) {
        return rejectedResult('方案文件版本不受支持（文件 ' + String(payload.version) + '，当前 ' + SCHEME_EXPORT_VERSION + '）');
      }
      // 名称必须是字符串（缺失才允许回落默认名）
      if (payload.name !== undefined && typeof payload.name !== 'string') {
        return rejectedResult('方案名称格式不正确');
      }
      // 对象字面量 / JSON 都能产出 Infinity（例如 1e309）：数值合法性由
      // validateSchemeConfig 的 Number.isFinite 逐字段兜住（不要用文本正则猜，
      // 否则 base64 头像里偶然出现 "NaN" 三个字母就会被误判）。
      let config;
      try {
        config = validateSchemeConfig(payload.config);
      } catch (err) {
        return rejectedResult((err && err.message) || err || '方案内容不合法');
      }
      const store = readSchemeStore();
      if (Object.keys(store.schemes).length >= SCHEME_MAX_COUNT) {
        return rejectedResult('方案数量已达上限（' + SCHEME_MAX_COUNT + ' 个）');
      }
      const wanted = normalizeSchemeName(payload.name, '导入的方案');
      const taken = new Set(Object.values(store.schemes).map((scheme) => scheme.name));
      let name = wanted;
      let index = 2;
      while (taken.has(name)) { name = wanted + ' (' + index + ')'; index += 1; }
      const id = newSchemeId();
      const scheme = { id, name, config: deepCopy(config) };
      // 导入只新增方案：bindings / presetBindings 原样带过去，绝不动用户的绑定
      const result = persistSchemeStore({
        version: 1,
        schemes: Object.assign(Object.create(null), store.schemes, { [id]: scheme }),
        bindings: store.bindings,
        presetBindings: store.presetBindings,
      });
      return { ...result, id, name };
    }

    // ── WX-M27 会话配置作用域 ─────────────────────────────────────────────
    // 一个页面里可能同时有多个会话。外观变量不能只写到 documentElement（那样所有会话会互相盖），
    // 所以要按「会话 scope 元素」写一份独立的变量 + dataset，并在卸载/切换时完整撤掉。
    // scope 元素由 AvatarDriver 解析（最近的 [data-conversation-content]），本模块只负责写/清。
    /** 把某方案的配置写到会话 scope 上（派生变量由 CSS 里同一组选择器负责）。 */
    /**
     * 某元素上「当前实际的宿主主题」。`system` 方案不能用「不写主题」来表示：
     * 根上可能因为**另一个方案**强制了 dark/light，作用域留空就会继承那份强制配色。
     * 所以作用域/弹窗宿主上的 system 一律翻译成宿主此刻的真实主题，并跟随宿主变化重写。
     */
    function hostThemeNow() {
      if (typeof document === 'undefined') return 'light';
      try {
        // 只认宿主自己的标记：DSH 在暗色时会给 <body>/<html> 加 data-ds-dark-theme。
        // 不查 prefers-color-scheme——宿主可能忽略系统偏好，查了反而会跟宿主不一致。
        const body = document.body;
        const rootEl = document.documentElement;
        if (body && body.hasAttribute('data-ds-dark-theme')) return 'dark';
        if (rootEl && rootEl.hasAttribute('data-ds-dark-theme')) return 'dark';
      } catch (_err) { /* 拿不到就按亮色 */ }
      return 'light';
    }
    const hostThemeListeners = new Set();
    let hostThemeObserver = null;
    let lastHostTheme = null;
    /** 订阅「宿主亮/暗切换」：作用是让 system 方案的会话在宿主切主题时立刻跟上。 */
    function onHostThemeChange(fn) {
      hostThemeListeners.add(fn);
      if (!hostThemeObserver && typeof MutationObserver !== 'undefined' && typeof document !== 'undefined' && document.body) {
        lastHostTheme = hostThemeNow();
        hostThemeObserver = new MutationObserver(() => {
          const next = hostThemeNow();
          if (next === lastHostTheme) return;
          lastHostTheme = next;
          for (const listener of hostThemeListeners) {
            try { listener(next); } catch (_err) { /* 监听器自身异常不影响主流程 */ }
          }
        });
        try {
          hostThemeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
          hostThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ds-dark-theme'] });
        } catch (_err) { /* 观察失败只是不跟随，不影响渲染 */ }
      }
      return () => {
        hostThemeListeners.delete(fn);
        if (!hostThemeListeners.size && hostThemeObserver) {
          hostThemeObserver.disconnect();
          hostThemeObserver = null;
          lastHostTheme = null;
        }
      };
    }
    /** 把某方案的配置写到会话 scope 上（派生变量由 CSS 里同一组选择器负责）。 */
    function applyScopeConfig(scopeEl, cfg) {
      if (!scopeEl || !scopeEl.style) return;
      applyConfig(scopeEl, cfg);
      // system → 写宿主此刻的真实主题，避免继承 root 上另一个方案的强制配色
      scopeEl.dataset.wxTheme = cfg.theme === 'system' ? hostThemeNow() : cfg.theme;
    }
    function clearScopeConfig(scopeEl) {
      if (!scopeEl || !scopeEl.style) return;
      clearAppliedConfig(scopeEl);
    }
    /**
     * 弹窗宿主（portal 到 body）与配置面板容器会脱离会话 scope，
     * 需要把「编辑目标方案」的外观变量与主题写到自己身上，否则会继承成别的方案的外观。
     */
    function applyHostConfig(hostEl, cfg) {
      if (!hostEl || !hostEl.style) return;
      applyConfig(hostEl, cfg);
      hostEl.dataset.wxTheme = cfg.theme === 'system' ? hostThemeNow() : cfg.theme;
    }

    // ── WX-M06 每会话角色模式边界 ─────────────────────────────────────────
    let roleStateCache = null;
    const roleStateListeners = new Set();
    function normalizeRoleState(value) {
      if (typeof value === 'string') {
        return ROLE_MODES.indexOf(value) >= 0 ? { entries: [], legacyMode: value } : null;
      }
      if (!value || typeof value !== 'object') return null;
      let rawEntries = Array.isArray(value.entries) ? value.entries : [];
      const entries = rawEntries
        .filter((entry) => entry && typeof entry === 'object' && ROLE_MODES.indexOf(entry.mode) >= 0)
        .map((entry) => ({ mode: entry.mode, fromTurn: clampNumber(entry.fromTurn, 1, Number.MAX_SAFE_INTEGER, 1) }))
        .sort((a, b) => a.fromTurn - b.fromTurn);
      const legacyMode = ROLE_MODES.indexOf(value.legacyMode) >= 0 ? value.legacyMode : undefined;
      return legacyMode ? { entries, legacyMode } : { entries };
    }
    function readRoleStates() {
      if (roleStateCache !== null) return roleStateCache;
      try {
        const raw = localStorage.getItem(ROLE_MODE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        const out = {};
        if (parsed && typeof parsed === 'object') {
          for (const key of Object.keys(parsed)) {
            const state = normalizeRoleState(parsed[key]);
            if (state) out[key] = state;
          }
        }
        roleStateCache = out;
      } catch (err) {
        reportStorageError('read', err);
        roleStateCache = {};
      }
      return roleStateCache;
    }
    function roleStateOf(sessionId) {
      if (!sessionId) return null;
      return readRoleStates()[String(sessionId)] || null;
    }
    function persistRoleStates(next) {
      // 与配置/方案库同一套结果协议：写盘失败但本窗缓存已更新 → applied:true
      let result = okResult();
      try {
        localStorage.setItem(ROLE_MODE_KEY, JSON.stringify(next));
      } catch (err) {
        reportStorageError('write', err);
        result = writeFailureResult(String((err && err.message) || err || ''));
      }
      roleStateCache = next;
      for (const fn of roleStateListeners) {
        try { fn(next, result); } catch (_err) { /* 空实现 */ }
      }
      return result;
    }
    // 读模式时按轮次取，而不是按「当前设置」——这是历史消息不被倒灌的关键。
    /** 该轮生效的角色模式：取 fromTurn <= turn 的最后一条边界记录，没有则 auto。 */
    function modeForTurn(state, turn) {
      if (!state || !Array.isArray(state.entries)) return DEFAULT_ROLE_MODE;
      const at = typeof turn === 'number' && Number.isFinite(turn) ? turn : Number.MAX_SAFE_INTEGER;
      let mode = DEFAULT_ROLE_MODE;
      for (const entry of state.entries) {
        if (entry.fromTurn <= at) mode = entry.mode;
      }
      return mode;
    }
    /**
     * 手动切模式应该作用到哪一轮：会话正在跑就用当前未结束轮，空闲就用下一轮。
     * 控件的「已选模式」显示与写入都用它，避免空闲时点了却还高亮旧模式。
     * @param info - summarizeSession 的结果（可能为 undefined）
     * @returns 边界轮次（>=1）
     */
    function roleplayTargetTurn(info) {
      if (!info) return 1;
      if (info.openTurn !== null && info.openTurn !== undefined) return info.openTurn;
      const last = Number.isFinite(info.lastTurn) ? info.lastTurn : 0;
      return last + 1;
    }
    // 一轮只保留一条边界：同一轮再点一次是覆盖，不是追加。
    /** 从 fromTurn 这一轮起写入一条模式边界。 */
    function setRoleModeFrom(sessionId, mode, fromTurn) {
      if (!sessionId || ROLE_MODES.indexOf(mode) < 0) return { ok: true, error: '' };
      const key = String(sessionId);
      const next = { ...readRoleStates() };
      const prev = next[key] || { entries: [] };
      const at = clampNumber(fromTurn, 1, Number.MAX_SAFE_INTEGER, 1);
      const entries = prev.entries.filter((entry) => entry.fromTurn !== at).concat([{ mode, fromTurn: at }])
        .sort((a, b) => a.fromTurn - b.fromTurn);
      next[key] = { entries };
      return persistRoleStates(next);
    }
    /** 旧格式惰性迁移：把 legacyMode 钉在 fromTurn 这一轮，历史仍然 auto。 */
    function resolveLegacyRoleMode(sessionId, fromTurn) {
      const key = sessionId ? String(sessionId) : '';
      if (!key) return;
      const state = roleStateOf(key);
      if (!state || !state.legacyMode || state.entries.length > 0) return;
      setRoleModeFrom(key, state.legacyMode, fromTurn);
    }
    function onRoleStateChange(fn) {
      roleStateListeners.add(fn);
      return () => roleStateListeners.delete(fn);
    }

    // ------------------------------------------------------------------
    // 配置 -> CSS 变量 / dataset
    // ------------------------------------------------------------------
    /** 本插件写在根元素上的 CSS 变量与 dataset（卸载时只清这些）。 */
    // ── WX-M07 配置 -> 根变量/dataset ─────────────────────────────────────
    const ROOT_STYLE_PROPS = [
      '--wx-avatar-size-base', '--wx-avatar-size', '--wx-avatar-gap-base', '--wx-avatar-gap',
      '--wx-avatar-round', '--wx-avatar-bg', '--wx-avatar-fg',
      '--wx-avatar-user-img', '--wx-avatar-user-text', '--wx-avatar-user-fallback',
      '--wx-avatar-ai-img', '--wx-avatar-ai-text', '--wx-avatar-role-img', '--wx-avatar-ring',
      '--wx-bubble-user', '--wx-bubble-ai', '--wx-bubble-user-text', '--wx-bubble-ai-text', '--wx-radius', '--wx-max',
    ];
    const ROOT_DATASETS = ['wxTheme', 'wxTimestamps', 'wxMergeAvatars', 'wxToolAvatars'];

    function avatarSizeOf(cfg) {
      return clampNumber(cfg && cfg.avatarSize, AVATAR_SIZE_MIN, AVATAR_SIZE_MAX, AVATAR_SIZE_DEFAULT);
    }
    /** 头像间距随尺寸联动（36px -> 10px）。 */
    function avatarGapOf(cfg) {
      const size = avatarSizeOf(cfg);
      return Math.min(20, Math.max(6, Math.round(size * 0.28)));
    }
    /** 头像圆角：roundness/2 %，0 -> 0%，50 -> 25%，100 -> 50%（圆形）。 */
    function avatarRoundOf(cfg) {
      const round = clampNumber(cfg && cfg.avatarRoundness, 0, 100, AVATAR_ROUNDNESS_DEFAULT);
      return (round / 2) + '%';
    }

    // 输入 cfg，副作用：把通用外观配置写成根 CSS 变量/dataset；每轮动态头像另由 decorateScope 写到消息行。
    function applyConfig(root, cfg) {
      const s = root.style;
      const img = (v) => (v ? 'url("' + v + '")' : 'none');
      const size = avatarSizeOf(cfg);
      // 只写「基准」尺寸：实际尺寸由 CSS 决定（窄屏 media query 才能生效）
      s.setProperty('--wx-avatar-size-base', size + 'px');
      s.setProperty('--wx-avatar-gap-base', avatarGapOf(cfg) + 'px');
      s.setProperty('--wx-avatar-round', avatarRoundOf(cfg));
      s.setProperty('--wx-avatar-bg', avatarBgOf(cfg));
      s.setProperty('--wx-avatar-fg', avatarFgOf(cfg));
      s.setProperty('--wx-avatar-user-img', img(cfg.userAvatar));
      s.setProperty('--wx-avatar-user-text', cfg.userAvatar ? '""' : JSON.stringify(cfg.userLetter || '我'));
      // 自定义用户头像下面不再垫鲸鱼图：透明区域应该露出所选背景/聊天底色
      s.setProperty('--wx-avatar-user-fallback', 'none');
      s.setProperty('--wx-avatar-ai-img', img(cfg.aiAvatar || DS_LOGO_URL));
      s.setProperty('--wx-avatar-ai-text', '""');
      s.setProperty('--wx-avatar-ring', cfg.ringColor ? cfg.ringColor : 'transparent');
      s.setProperty('--wx-avatar-role-img', img(cfg.roleAvatar));
      // 空值表示本方案的默认配色。移除变量会继承根上另一方案的自定义色；
      // initial 阻断这种继承，让 var() 使用当前作用域自己的主题回落色。
      s.setProperty('--wx-bubble-user', cfg.userBubble || 'initial');
      s.setProperty('--wx-bubble-ai', cfg.aiBubble || 'initial');
      // 自定义气泡色 → 按亮度给文字挑对比色；没自定义 → initial（回落到本主题的 --wx-*-text）
      s.setProperty('--wx-bubble-user-text', bubbleTextOn(cfg.userBubble) || 'initial');
      s.setProperty('--wx-bubble-ai-text', bubbleTextOn(cfg.aiBubble) || 'initial');
      s.setProperty('--wx-radius', String(cfg.radius) + 'px');
      s.setProperty('--wx-max', String(cfg.maxWidth) + '%');
      if (cfg.theme === 'system') delete root.dataset.wxTheme;
      else root.dataset.wxTheme = cfg.theme;
      root.dataset.wxTimestamps = cfg.showTimestamps ? '1' : '0';
      root.dataset.wxMergeAvatars = cfg.mergeAvatars ? '1' : '0';
      root.dataset.wxToolAvatars = cfg.toolAvatars ? '1' : '0';
    }
    // 清理边界：只撤上面 ROOT_STYLE_PROPS / ROOT_DATASETS 里自己写过的那份。
    /** 卸载时只撤销本插件写过的根变量/dataset，别人写的一律不动。 */
    function clearAppliedConfig(root) {
      for (const prop of ROOT_STYLE_PROPS) root.style.removeProperty(prop);
      for (const key of ROOT_DATASETS) delete root.dataset[key];
    }

    // ------------------------------------------------------------------
    // GIF 识别（MIME / 扩展名 / data URL / 文件头）
    // ------------------------------------------------------------------
    // ── WX-M08 GIF 识别与 data URL 规范化 ─────────────────────────────────
    // 三路判定：data URL/URL 特征、File 的 MIME 与扩展名、文件头 "GIF8"。
    // 只改 data URL 的 media type 前缀（错 MIME 也能存成 image/gif），base64 字节一字不动。
    const GIF_HEADER = [0x47, 0x49, 0x46, 0x38];   // "GIF8"
    /** 由 URL / data URL 判断是不是 GIF。 */
    function isGifSource(src) {
      const text = String(src == null ? '' : src).trim();
      if (!text) return false;
      if (/^data:image\/gif[;,]/i.test(text)) return true;
      if (/^data:image\/[a-z0-9.+-]+[;,]/i.test(text)) return false; // 其它 data: MIME 直接判定
      const withoutQuery = text.split('#')[0].split('?')[0];
      return /\.gif$/i.test(withoutQuery);
    }
    /** 由 File 对象判断是不是 GIF（MIME / 扩展名 / 文件头字节）。 */
    function isGifFile(file) {
      if (!file) return false;
      if (typeof file.type === 'string' && /^image\/gif$/i.test(file.type)) return true;
      if (typeof file.name === 'string' && /\.gif$/i.test(file.name)) return true;
      return false;
    }
    /** 读文件头确认真的是 GIF（兜底：MIME 不可靠时用）。 */
    function fileLooksLikeGif(file, callback) {
      if (!file || typeof FileReader === 'undefined') { callback(isGifFile(file)); return; }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const buffer = new Uint8Array(reader.result || []);
          const headerOk = buffer.length >= 4 && GIF_HEADER.every((byte, index) => buffer[index] === byte);
          callback(headerOk || isGifFile(file));
        } catch (_err) {
          callback(isGifFile(file));
        }
      };
      reader.onerror = () => callback(isGifFile(file));
      try {
        reader.readAsArrayBuffer(file.slice(0, 8));
      } catch (_err) {
        callback(isGifFile(file));
      }
    }
    /**
     * 已确认是 GIF 的数据，把 data URL 的 MIME 规范成 image/gif。
     * 有些系统给的 `File.type` 是空的或 application/octet-stream，FileReader 会照着写成
     * `data:application/octet-stream;base64,...`，之后的 isGifSource / 按钮判断就认不出来。
     * 只改 media type 前缀，`;base64` 标志与后面的原始字节（含所有帧）一字不动。
     * @param dataUrl - FileReader 读出来的 data URL
     * @returns 规范化后的 data URL（本来就不是 data URL 时原样返回）
     */
    function normalizeGifDataUrl(dataUrl) {
      const text = String(dataUrl == null ? '' : dataUrl);
      if (!text.toLowerCase().startsWith('data:')) return text;
      const comma = text.indexOf(',');
      if (comma < 0) return text;
      const head = text.slice(0, comma);
      const payload = text.slice(comma);
      const mimeMatch = /^data:([^;,]*)/i.exec(head);
      const mime = mimeMatch ? mimeMatch[1] : '';
      if (mime.toLowerCase() === 'image/gif') return text;
      const isBase64 = /;base64$/i.test(head);
      return 'data:image/gif' + (isBase64 ? ';base64' : '') + payload;
    }

    // ------------------------------------------------------------------
    // 头像规则（纯函数，可独立测试）
    // ------------------------------------------------------------------
    /** 类型识别的内置关键字表；按段（snake_case / kebab-case 切分）精确匹配，顺序即优先级。 */
    // ── WX-M09 工具名 -> 头像解析 ─────────────────────────────────────────
    // 优先级：具体工具名规则 > 类型关键字 > 默认头像（空头像视为未配置）。
    const CATEGORY_KEYWORDS = [
      ['search', ['web', 'search', 'grep', 'glob', 'find', 'browse', 'browser', 'fetch', 'http', 'url', 'crawl', 'oast', 'screenshot']],
      ['read', ['read', 'view', 'inspect', 'open', 'attach', 'image', 'cat', 'head', 'tail', 'stat', 'peek', 'load']],
      ['write', ['write', 'edit', 'patch', 'apply', 'replace', 'create', 'delete', 'remove', 'move', 'rename', 'mkdir', 'insert', 'save', 'todo']],
      ['command', ['bash', 'pwsh', 'powershell', 'shell', 'cmd', 'exec', 'run', 'command', 'terminal', 'test', 'node', 'python', 'npm', 'pnpm', 'git', 'make', 'build', 'job', 'jobs']],
    ];
    /**
     * 判断工具名所属的内置类型。
     * 工具名按非字母数字切成段（`ops_inspect_local_file` -> ops/inspect/local/file），
     * 段名精确命中关键字才算；不猜前缀、不做子串匹配，避免误伤。
     * @returns 类型名，未归类返回 ''。
     */
    function categoryOfToolName(name) {
      const text = String(name == null ? '' : name).toLowerCase();
      if (!text) return '';
      const segments = text.split(/[^a-z0-9]+/).filter(Boolean);
      if (segments.length === 0) return '';
      for (const [category, keywords] of CATEGORY_KEYWORDS) {
        for (const segment of segments) {
          if (keywords.indexOf(segment) >= 0) return category;
        }
      }
      return '';
    }
    /**
     * 解析一个工具名应使用的头像。
     * 优先级：具体工具名规则（精确、忽略大小写） > 类型头像 > 未配置（''）。
     * 空头像一律视为未配置。
     * @returns {{ avatar: string, source: 'rule'|'category'|'none', category: string }}
     */
    function resolveToolAvatar(name, cfg) {
      const text = String(name == null ? '' : name);
      const key = text.trim().toLowerCase();
      const rules = (cfg && cfg.toolRules) || [];
      if (key) {
        for (const rule of rules) {
          if (!rule || !rule.avatar) continue;
          if (String(rule.name == null ? '' : rule.name).trim().toLowerCase() === key) {
            return { avatar: rule.avatar, source: 'rule', category: '' };
          }
        }
      }
      const category = categoryOfToolName(text);
      const avatar = category ? ((cfg && cfg.toolCategoryAvatars && cfg.toolCategoryAvatars[category]) || '') : '';
      if (avatar) return { avatar, source: 'category', category };
      return { avatar: '', source: 'none', category };
    }

    // ------------------------------------------------------------------
    // 角色扮演标记（纯函数，可独立测试）
    // ------------------------------------------------------------------
    // 1) link reference definition：DSH 的 mdast→React 渲染器对 definition 节点渲染 null，
    //    原生 Markdown 本身就把它吃掉，是推荐写法。
    // ── WX-M10 角色标记解析 ───────────────────────────────────────────────
    // 只解析助手正文里「自己占一整行」的标记；reasoning/工具输出/代码块/引用不算。
    // 两种写法：推荐 [//]: # (wx-roleplay:on)（原生 Markdown 会隐藏），兼容 <!-- wx-roleplay:on -->（会显示成文字）。
    const MARKER_DEFINITION = new RegExp('^\\[//\\]:\\s*#?\\s*\\(\\s*wx-roleplay\\s*:\\s*(on|off)\\s*\\)$');
    // 2) HTML 注释形式：兼容写法。注意 DSH 把裸 HTML 当纯文本渲染，这行会显示出来。
    const MARKER_COMMENT = /^<!--\s*wx-roleplay\s*:\s*(on|off)\s*-->$/;
    const FENCE_OPEN = /^(`{3,}|~{3,})/;

    /** @returns 整行标记的开关值，非标记行返回 null（不完整标记也返回 null）。 */
    function markerOfLine(line) {
      const text = String(line == null ? '' : line).trim();
      if (!text) return null;
      const definition = MARKER_DEFINITION.exec(text);
      if (definition) return definition[1];
      const comment = MARKER_COMMENT.exec(text);
      if (comment) return comment[1];
      return null;
    }
    /**
     * 扫描助手正文，返回最后一个有效标记的开关值。
     * 只认独立行；跳过围栏代码块、缩进代码块与引用行；不完整标记不切换。
     * @returns {'on'|'off'|null}
     */
    function parseRoleplayMarker(text) {
      const source = String(text == null ? '' : text);
      let state = null;
      let fence = null;
      for (const raw of source.split(/\r?\n/)) {
        const trimmed = raw.trim();
        const open = FENCE_OPEN.exec(trimmed);
        if (fence !== null) {
          if (open && open[1][0] === fence[0] && open[1].length >= fence[0].length && open[1].length >= fence.length) fence = null;
          continue;
        }
        if (open) {
          fence = open[1];
          continue;
        }
        if (trimmed === '') continue;
        if (trimmed.startsWith('>')) continue;          // 引用中的示例
        if (/^( {4,}|\t)/.test(raw)) continue;          // 缩进代码块
        const marker = markerOfLine(raw);
        if (marker !== null) state = marker;
      }
      return state;
    }

    // ------------------------------------------------------------------
    // 轮次头像索引（纯函数，可独立测试）
    // ------------------------------------------------------------------
    /** 从 Chat 节点取所属 turn；无轮次归属返回 undefined。 */
    // ── WX-M11 轮次索引与头像决策 ─────────────────────────────────────────
    // 数据来源只有 ChatSnapshot（session 作用域 slot 的标准 prop useChat），不猜 DOM 文字。
    function turnOfChatNode(node) {
      const location = node && node.location;
      if (!location) return undefined;
      if (location.kind === 'turn' || location.kind === 'step') {
        const turn = location.turn && location.turn.turn;
        return typeof turn === 'number' ? turn : undefined;
      }
      return undefined;
    }
    /** 取工具调用根节点的工具名（运行中取 name，已结算取 call.name）。 */
    function toolNameOfRoot(root) {
      if (!root || typeof root !== 'object') return '';
      if (typeof root.name === 'string' && root.name) return root.name;
      if (root.call && typeof root.call.name === 'string') return root.call.name;
      return '';
    }
    /** 取助手节点的正文（只含文本块，不含思考/工具调用）。 */
    function assistantTextOf(data) {
      const blocks = (data && data.blocks) || [];
      const parts = [];
      for (const block of blocks) {
        if (block && block.kind === 'text' && typeof block.text === 'string') parts.push(block.text);
      }
      return parts.join('\n');
    }
    /** 缺省快照，避免 ui-chat 未装配时空转。 */
    const EMPTY_CHAT = { order: [], nodes: { values: () => [] }, timeline: { turnOrder: [], turns: new Map() } };

    /**
     * 该轮是否已经终止（原生 timeline 的 turn.end 优先，legacy.turnEnds 兜底）。
     * 终止意味着这一轮不可能再有工具在跑：即使留下未结算的 tool 节点也必须释放运行态。
     */
    function turnIsClosed(snapshot, turn) {
      const timeline = snapshot && snapshot.timeline;
      if (timeline && timeline.turns && typeof timeline.turns.get === 'function') {
        const location = timeline.turns.get(turn);
        if (location && location.status === 'closed') return true;
        if (location && location.status === 'open') return false;
      }
      const legacy = snapshot && snapshot.legacy;
      const ends = legacy && legacy.turnEnds;
      if (ends && typeof ends.has === 'function' && ends.has(turn)) return true;
      return false;
    }

    /**
     * 由 ChatSnapshot 构建「turn -> 头像」索引。
     * 排序一律用 `anchorSeq`（工具调用开始 seq），不使用完成先后或 DOM 顺序。
     * 每轮独立结算：本轮内未匹配的调用沿用本轮最近一次匹配的头像；
     * 本轮完全没有匹配则回落默认头像（不继承上一轮的工具头像）。
     * 运行态只在「该轮未终止」时才算运行中。
     * 角色模式：手动按 fromTurn 边界；auto 由助手正文标记「累计」得到（本轮之前出现过 on 就一直算 on）。
     * 角色模式下运行工具会临时显示工具头像，跑完回到角色头像；本轮无匹配工具则直接用角色头像。
     * 没有配置角色图时走普通规则（工具头像 / 默认头像）。
     * @param snapshot - ChatSnapshot（可能为 undefined）
     * @param cfg - 当前配置
     * @param roleState - 本会话的角色模式边界状态（{entries:[{mode,fromTurn}]}）
     */
    function buildTurnIndex(snapshot, cfg, roleState, configFor) {
      const index = new Map();
      if (!snapshot || !snapshot.nodes || typeof snapshot.nodes.values !== 'function') return index;
      const toolsByTurn = new Map();
      const markerByTurn = new Map();
      // 所有原生节点的轮号都要进集合：用户先发出、timeline/tools 还没就绪时也不能漏掉首次头像捕获
      const allNodeTurns = new Set();
      let nodes = [];
      try { nodes = snapshot.nodes.values() || []; } catch (_err) { nodes = []; }
      for (const node of nodes) {
        if (!node) continue;
        const turn = turnOfChatNode(node);
        if (turn === undefined) continue;
        allNodeTurns.add(turn);
        if (node.kind === 'tool-call') {
          const root = node.data && node.data.root;
          const bucket = toolsByTurn.get(turn) || [];
          bucket.push({
            seq: typeof node.anchorSeq === 'number' ? node.anchorSeq : 0,
            name: toolNameOfRoot(root),
            settled: !!(root && root.kind === 'tool-result'),
          });
          toolsByTurn.set(turn, bucket);
        } else if (node.kind === 'assistant-step') {
          const marker = parseRoleplayMarker(assistantTextOf(node.data));
          if (marker !== null) {
            // 快照的节点迭代顺序不保证升序：按 anchorSeq 取「最后一个有效标记」
            const seq = typeof node.anchorSeq === 'number' ? node.anchorSeq : 0;
            const prev = markerByTurn.get(turn);
            if (!prev || seq >= prev.seq) markerByTurn.set(turn, { seq, value: marker });
          }
        }
      }
      const turnSet = new Set();
      const timeline = snapshot.timeline;
      if (timeline && Array.isArray(timeline.turnOrder)) {
        for (const turn of timeline.turnOrder) if (typeof turn === 'number') turnSet.add(turn);
      }
      for (const turn of allNodeTurns) turnSet.add(turn);
      for (const turn of toolsByTurn.keys()) turnSet.add(turn);
      for (const turn of markerByTurn.keys()) turnSet.add(turn);
      const turns = [...turnSet].sort((a, b) => a - b);

      // 注意：工具开关**逐轮**判定（rowCfg.toolAvatars），不能用当前 cfg 的全局开关，
      // 否则"现在关掉工具头像"会把历史轮次的工具头像一起抹掉。
      let roleState_ = 'off';     // auto 模式下的累计标记状态（跨轮累计，但每轮独立结算头像）

      for (const turn of turns) {
        // 每轮用**它自己那份**头像身份（有历史就用历史，没有就用当前配置）：
        // 外观仍来自当前 cfg（不冻结），所以换尺寸/圆角/主题对旧轮次照常生效。
        const rowCfg = typeof configFor === 'function' ? (configFor(turn) || cfg) : cfg;
        // 逐轮开关：工具头像 / 角色标记都按**该轮保存的身份**判定（当前 cfg 只影响还没有历史的轮次）
        const rowToolOn = !!(rowCfg && rowCfg.toolAvatars);
        const rowMarkerOn = !(rowCfg && rowCfg.roleMarkerEnabled === false);
        const markerEntry = markerByTurn.get(turn);
        // 累计标记只采信"该轮启用角色标记时"出现的标记：关掉当前开关不会抹掉旧轮的角色图
        if (markerEntry && rowMarkerOn) roleState_ = markerEntry.value;
        const closed = turnIsClosed(snapshot, turn);
        const calls = (toolsByTurn.get(turn) || []).slice().sort((a, b) => a.seq - b.seq);
        let lastMatched = '';
        let anyRunning = false;
        for (const call of calls) {
          // 轮次已终止 => 不可能再运行中；未结算的节点按终态处理
          if (!call.settled && !closed) anyRunning = true;
          if (!rowToolOn) continue;
          const resolved = resolveToolAvatar(call.name, rowCfg);
          // 未匹配的调用不清空 lastMatched：本轮保留最近一次匹配的头像
          if (resolved.avatar) lastMatched = resolved.avatar;
        }
        // auto 模式在该轮禁用标记时一律按"本轮没有角色标记"结算；手动 on/off 不受影响
        const turnMode = modeForTurn(roleState, turn);
        const roleOn = turnMode === 'on' ? true : turnMode === 'off' ? false : (rowMarkerOn && roleState_ === 'on');

        let avatar = '';
        let source = 'default';
        if (roleOn && rowCfg.roleAvatar) {
          // 角色模式下：有工具正在运行则临时显示本轮最后匹配的工具头像；
          // 全部结束（或本轮没有匹配工具）则回到角色头像。
          if (anyRunning && lastMatched) {
            avatar = lastMatched;
            source = 'tool';
          } else {
            avatar = rowCfg.roleAvatar;
            source = 'role';
          }
        } else if (rowToolOn && lastMatched) {
          avatar = lastMatched;
          source = 'tool';
        }
        if (!avatar) {
          // 该轮既没有匹配的工具、也没有角色头像 → 用**这一轮保存下来的**默认 AI 头像。
          // 漏掉这一步会让 entry.avatar 为空、行变量被删掉，头像退化成继承作用域（= 当前配置），
          // 于是"换图后旧轮次也跟着变"——这正是本功能要解决的问题。
          avatar = rowCfg.aiAvatar || '';   // 空 = 官方鲸鱼 logo，由 decorateScope 解析
          source = 'default';
        }
        // identity 是「本轮实际使用的头像身份」：装饰时由调用方按它落盘（首次写入后不再覆盖）
        index.set(turn, {
          avatar, source, role: roleOn, running: anyRunning, closed,
          identity: avatarIdentityOf(rowCfg),
          userAvatar: rowCfg.userAvatar || '',
          userLetter: rowCfg.userLetter || '',
        });
      }
      return index;
    }

    /** 汇总会话当前状态：开放轮、最后轮、该轮角色态、调试串。 */
    function summarizeSession(snapshot, index) {
      const timeline = snapshot && snapshot.timeline;
      let lastTurn = 0;
      let openTurn = null;
      const order = timeline && Array.isArray(timeline.turnOrder) ? timeline.turnOrder : [];
      for (const turn of order) {
        if (typeof turn !== 'number') continue;
        if (turn > lastTurn) lastTurn = turn;
        if (!turnIsClosed(snapshot, turn) && (openTurn === null || turn > openTurn)) openTurn = turn;
      }
      for (const turn of index.keys()) {
        if (turn > lastTurn) lastTurn = turn;
      }
      const currentTurn = openTurn !== null ? openTurn : lastTurn;
      const entry = currentTurn > 0 ? index.get(currentTurn) : undefined;
      // 只带最近 12 轮，避免调试属性过大
      const recent = [...index.entries()].slice(-12).map(([turn, value]) => ({
        t: turn, s: value.source, r: value.running ? 1 : 0, c: value.closed ? 1 : 0, x: value.role ? 1 : 0,
      }));
      return {
        openTurn,
        lastTurn,
        currentTurn,
        roleOn: entry ? entry.role : false,
        running: entry ? entry.running : false,
        debug: JSON.stringify({ v: VERSION, o: openTurn, l: lastTurn, n: recent }),
      };
    }

    // ------------------------------------------------------------------
    // ── WX-M30 每轮头像历史（IndexedDB） ──────────────────────────────────
    // ------------------------------------------------------------------
    // 目标：**同一个聊天里，已见过轮次的头像身份不再被后来的设置改动重画**。
    // 「头像身份」= 图片与字母 + 决定头像的身份类配置（工具规则/分类头像/角色头像/角色标记开关）；
    // 「外观」= 大小/圆角/头像背景/描边/气泡/主题/时间戳 —— 这些**不冻结**，永远按当前方案即时生效。
    //
    // 存储用插件自己的 IndexedDB（不进 config-v1，也不进 6MiB 方案库）：
    //   assets    : 去重后的图片资产，key = 内容哈希；同一张图跨多轮只存一份
    //   snapshots : 头像身份子集（图片字段用资产 key 引用）
    //   turns     : `${sessionId}\u0000${turnKey}` → snapshot key；**首次写入后不再覆盖**
    // 生命周期：activate()/load() 先读取历史 → 驱动按已保存身份装饰 → dispose() 关连接/清订阅。
    // 同一工厂可再次 activate；异步操作用 generation 隔离，迟到结果不会写入新一轮挂载。
    // 失败（无 IDB / quota / blocked / 读写错误）：内存缓存照常工作、本窗口显示不受影响，
    // 只在设置页给一次诚实提示；绝不把失败当成功，不阻塞消息，不抛未捕获异常。
    const AVATAR_IDENTITY_KEYS = [
      'userAvatar', 'userLetter', 'aiAvatar', 'roleAvatar',
      'toolCategoryAvatars', 'toolRules', 'toolAvatars', 'roleMarkerEnabled',
    ];

    /** 从完整配置里取出「头像身份」子集（纯函数，可独立测试）。 */
    function avatarIdentityOf(cfg) {
      const out = {};
      const src = cfg || {};
      for (const key of AVATAR_IDENTITY_KEYS) {
        const value = src[key];
        if (key === 'toolCategoryAvatars') {
          const list = {};
          const from = value && typeof value === 'object' ? value : {};
          for (const cat of Object.keys(from)) list[cat] = String(from[cat] == null ? '' : from[cat]);
          out[key] = list;
        } else if (key === 'toolRules') {
          out[key] = Array.isArray(value)
            ? value.filter((rule) => rule && typeof rule === 'object')
              .map((rule) => ({ name: String(rule.name == null ? '' : rule.name), avatar: String(rule.avatar == null ? '' : rule.avatar) }))
            : [];
        } else if (key === 'roleMarkerEnabled' || key === 'toolAvatars') {
          out[key] = value !== false;
        } else {
          out[key] = String(value == null ? '' : value);
        }
      }
      return out;
    }

    /** 身份子集里所有出现的图片（去重后返回 [值]）。 */
    function identityImages(identity) {
      const seen = [];
      const push = (value) => {
        const text = String(value == null ? '' : value);
        if (text && seen.indexOf(text) < 0) seen.push(text);
      };
      push(identity.userAvatar);
      push(identity.aiAvatar);
      push(identity.roleAvatar);
      const cats = identity.toolCategoryAvatars || {};
      for (const cat of Object.keys(cats)) push(cats[cat]);
      for (const rule of identity.toolRules || []) push(rule && rule.avatar);
      return seen;
    }

    /**
     * 32 位 FNV-1a：**不依赖 crypto.subtle**（宿主/沙箱不一定有）。
     * 只用于分桶，命中后仍要按内容校验，绝不因为哈希相同就覆盖旧图。
     */
    function smallHash(text) {
      let hash = 0x811c9dc5;
      const source = String(text);
      for (let i = 0; i < source.length; i += 1) {
        hash ^= source.charCodeAt(i);
        hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
      }
      return hash.toString(16).padStart(8, '0');
    }

    /**
     * 深复制 + 冻结一份「头像身份」：捕获之后调用方再改自己那份配置/规则，
     * 也不能改到旧轮次已经记下来的头像（嵌套 toolRules / toolCategoryAvatars 都要复制）。
     */
    function freezeIdentity(identity) {
      const copy = (value) => {
        if (Array.isArray(value)) return Object.freeze(value.map(copy));
        if (value && typeof value === 'object') {
          const out = {};
          for (const key of Object.keys(value)) out[key] = copy(value[key]);
          return Object.freeze(out);
        }
        return value;
      };
      return copy(avatarIdentityOf(identity));
    }

    const AVATAR_HISTORY_DB = 'dsh-wx-chat/avatar-history';
    const AVATAR_HISTORY_VERSION = 1;

    function createAvatarHistory() {
      const cache = new Map();                  // session + turn → shared, frozen identity
      const pending = new Map();                // same turn's callers await the same first write
      const volatile = new Set();               // memory only; never imply these records were saved
      const damaged = new Set();
      const listeners = new Set();
      const transactions = new Set();
      const profiles = [];
      const hashes = new WeakMap();
      let db = null, dbPromise = null, loadPromise = null, cancelOpen = null;
      let writeTail = Promise.resolve();
      let generation = 0, disposed = false, loaded = false;
      let failed = false, notice = '', written = 0;
      const TIMEOUT = 5000;
      const turnKeyOf = (sessionId, turn) => {
        const sid = typeof sessionId === 'string' ? sessionId.trim() : '';
        return sid && !sid.includes('\u0000') && Number.isSafeInteger(turn) && turn >= 0
          ? sid + '\u0000' + turn : '';
      };
      const live = (stamp) => !disposed && generation === stamp;
      const notify = () => {
        if (disposed) return;
        for (const fn of listeners) { try { fn(notice); } catch (_err) { /* independent subscribers */ } }
      };
      const fail = (message) => {
        if (disposed || failed) return;
        failed = true;
        notice = message || '头像历史没能完整保存到本地数据库：本次打开期间显示照常，重开可能丢失。';
        notify();
      };
      // Compare references/values directly, rather than hashing megabytes of data URLs for every turn.
      const sameIdentity = (a, b) => AVATAR_IDENTITY_KEYS.every((key) => {
        if (key === 'toolRules') return a[key].length === b[key].length &&
          a[key].every((rule, i) => rule.name === b[key][i].name && rule.avatar === b[key][i].avatar);
        if (key === 'toolCategoryAvatars') {
          const keys = Object.keys(a[key]);
          return keys.length === Object.keys(b[key]).length &&
            keys.every((cat) => Object.prototype.hasOwnProperty.call(b[key], cat) && a[key][cat] === b[key][cat]);
        }
        return a[key] === b[key];
      });
      const share = (input) => {
        const identity = avatarIdentityOf(input);
        const existing = profiles.find((profile) => sameIdentity(profile, identity));
        if (existing) return existing;
        const frozen = freezeIdentity(identity);
        profiles.push(frozen);
        return frozen;
      };
      const profileHash = (identity) => {
        if (!hashes.has(identity)) hashes.set(identity, smallHash(JSON.stringify(identity)));
        return hashes.get(identity);
      };
      const req = (request) => new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('avatar-history/request'));
      });

      // All awaited work here must consist of requests in this transaction; no network/crypto waits.
      const transact = (handle, names, mode, work) => new Promise((resolve, reject) => {
        let tx, timer, settled = false, value;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          transactions.delete(tx);
          error ? reject(error) : resolve(value);
        };
        const abort = (error) => {
          try { if (tx) tx.abort(); } catch (_err) { /* already aborted/closed */ }
          finish(error || new Error('avatar-history/abort'));
        };
        try {
          tx = handle.transaction(names, mode);
          transactions.add(tx);
          tx.oncomplete = () => finish();
          tx.onabort = () => finish(tx.error || new Error('avatar-history/abort'));
          tx.onerror = () => abort(tx.error || new Error('avatar-history/transaction'));
          timer = setTimeout(() => abort(new Error('avatar-history/timeout')), TIMEOUT);
          Promise.resolve(work(tx)).then((result) => { value = result; }, abort);
        } catch (error) { abort(error); }
      });
      function openDb() {
        if (disposed) return Promise.resolve(null);
        if (dbPromise) return dbPromise;
        const stamp = generation;
        dbPromise = new Promise((resolve) => {
          let request, timer, finished = false;
          const finish = (handle, message) => {
            if (finished) { try { if (handle) handle.close(); } catch (_err) {} return; }
            finished = true;
            clearTimeout(timer);
            cancelOpen = null;
            if (!live(stamp)) { try { if (handle) handle.close(); } catch (_err) {} resolve(null); return; }
            if (!handle) fail(message);
            else {
              db = handle;
              handle.onversionchange = () => {
                handle.close();
                if (!live(stamp)) return;
                if (db === handle) { db = null; dbPromise = null; }
                fail('头像历史数据库的连接已更新：当前窗口显示照常，重开可能丢失未保存的头像。');
              };
            }
            resolve(handle);
          };
          cancelOpen = () => finish(null);
          timer = setTimeout(() => finish(null, '头像历史数据库响应超时：本次打开期间显示照常，重开可能丢失。'), TIMEOUT);
          try {
            request = indexedDB.open(AVATAR_HISTORY_DB, AVATAR_HISTORY_VERSION);
            request.onupgradeneeded = () => {
              try {
                if (!live(stamp) || finished) { request.transaction.abort(); return; }
                const target = request.result;
                for (const name of ['assets', 'snapshots', 'turns']) {
                  if (!target.objectStoreNames.contains(name)) target.createObjectStore(name, { keyPath: 'id' });
                }
              } catch (_err) { try { request.transaction.abort(); } catch (_ignored) {} finish(null); }
            };
            request.onsuccess = () => finish(request.result);
            request.onerror = () => finish(null);
            request.onblocked = () => finish(null, '头像历史数据库被另一个窗口占用：本次打开期间显示照常，重开可能丢失。');
          } catch (_err) { finish(null); }
        });
        return dbPromise;
      }

      // v1 keeps string fields (including the short userLetter) as asset references.
      // Read each asset/snapshot once per load; turns share the decoded frozen object.
      const decode = (fields, asset) => {
        if (!fields || typeof fields !== 'object') throw new Error('avatar-history/missing-snapshot');
        const identity = {};
        for (const key of AVATAR_IDENTITY_KEYS) {
          const raw = fields[key];
          if (key === 'toolCategoryAvatars') {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('avatar-history/category');
            identity[key] = Object.fromEntries(Object.keys(raw).map((cat) => [cat, asset(raw[cat])]));
          } else if (key === 'toolRules') {
            if (!Array.isArray(raw)) throw new Error('avatar-history/rules');
            identity[key] = raw.map((rule) => ({ name: String(rule.name || ''), avatar: asset(rule.avatar) }));
          } else if (key === 'toolAvatars' || key === 'roleMarkerEnabled') {
            if (typeof raw !== 'boolean') throw new Error('avatar-history/flag');
            identity[key] = raw;
          } else identity[key] = asset(raw);
        }
        return share(identity);
      };
      const assetValue = (assets, id) => {
        if (id === '') return '';
        const record = assets.get(id);
        if (typeof id !== 'string' || !record || typeof record.data !== 'string') throw new Error('avatar-history/missing-asset');
        return record.data;
      };
      function load() {
        if (disposed) return Promise.resolve();
        if (loadPromise) return loadPromise;
        const stamp = generation;
        // Keep the synchronous memory-only path usable in SSR and restricted webviews.
        if (typeof indexedDB === 'undefined' || !indexedDB) {
          loaded = true; fail(); notify();
          loadPromise = Promise.resolve();
          return loadPromise;
        }
        loadPromise = (async () => {
          try {
            const handle = await openDb();
            if (!handle || !live(stamp)) return;
            const [assets, snapshots, turns] = await transact(handle, ['assets', 'snapshots', 'turns'], 'readonly',
              (tx) => Promise.all(['assets', 'snapshots', 'turns'].map((name) => req(tx.objectStore(name).getAll()))));
            if (!live(stamp)) return;
            const byAsset = new Map(assets.map((record) => [record.id, record]));
            const bySnapshot = new Map(snapshots.map((record) => [record.id, record]));
            const decoded = new Map();
            for (const record of turns) {
              try {
                if (!record.id || record.id !== turnKeyOf(record.sessionId, record.turn)) throw new Error('avatar-history/turn');
                if (!decoded.has(record.snapshotId)) {
                  const snapshot = bySnapshot.get(record.snapshotId);
                  decoded.set(record.snapshotId, decode(snapshot && snapshot.fields, (id) => assetValue(byAsset, id)));
                }
                cache.set(record.id, decoded.get(record.snapshotId)); // persisted first write wins over memory
                volatile.delete(record.id);
                damaged.delete(record.id);
              } catch (_err) {
                if (record && record.id) damaged.add(record.id);
                fail('部分头像历史无法完整读取：当前窗口使用可取得的头像，原有记录不会被覆盖，重开可能丢失。');
              }
            }
          } catch (_err) { if (live(stamp)) fail(); }
          finally { if (live(stamp)) { loaded = true; notify(); } }
        })();
        return loadPromise;
      }

      /** Hashes select buckets only; compare content at every slot, with no timestamp fallback. */
      async function unique(tx, storeName, base, data, same) {
        const store = tx.objectStore(storeName);
        for (let salt = 0; ; salt += 1) {
          const id = base + (salt ? '~' + salt : '');
          const existing = await req(store.get(id));
          if (existing) { if (same(existing)) return id; }
          else { await req(store.add(Object.assign({ id }, data))); return id; }
        }
      }
      async function write(tx, id, sessionId, turn, identity) {
        const existing = await req(tx.objectStore('turns').get(id));
        if (existing) {
          const snapshot = await req(tx.objectStore('snapshots').get(existing.snapshotId));
          if (!snapshot) throw new Error('avatar-history/missing-snapshot');
          const ids = new Set();
          const fields = snapshot.fields || {};
          for (const key of AVATAR_IDENTITY_KEYS) {
            if (key === 'toolCategoryAvatars') Object.values(fields[key] || {}).forEach((value) => ids.add(value));
            else if (key === 'toolRules') (fields[key] || []).forEach((rule) => ids.add(rule.avatar));
            else if (key !== 'toolAvatars' && key !== 'roleMarkerEnabled') ids.add(fields[key]);
          }
          const assets = new Map();
          for (const key of ids) if (key) assets.set(key, await req(tx.objectStore('assets').get(key)));
          return { identity: decode(snapshot.fields, (key) => assetValue(assets, key)), created: false };
        }
        const refs = new Map();
        const storeString = async (value) => {
          if (!value) return '';
          if (!refs.has(value)) refs.set(value, await unique(tx, 'assets', 'a' + smallHash(value), { data: value }, (old) => old.data === value));
          return refs.get(value);
        };
        const fields = {};
        for (const key of AVATAR_IDENTITY_KEYS) {
          if (key === 'toolCategoryAvatars') {
            fields[key] = {};
            for (const cat of Object.keys(identity[key])) fields[key][cat] = await storeString(identity[key][cat]);
          } else if (key === 'toolRules') {
            fields[key] = [];
            for (const rule of identity[key]) fields[key].push({ name: rule.name, avatar: await storeString(rule.avatar) });
          } else if (key === 'toolAvatars' || key === 'roleMarkerEnabled') fields[key] = identity[key];
          else fields[key] = await storeString(identity[key]);
        }
        const serialized = JSON.stringify(fields);
        const snapshotId = await unique(tx, 'snapshots', 's' + profileHash(identity), { fields },
          (old) => JSON.stringify(old.fields) === serialized);
        await req(tx.objectStore('turns').add({ id, sessionId, turn, snapshotId, at: Date.now() }));
        return { identity, created: true };
      }
      function remember(sessionId, turn, input) {
        const id = turnKeyOf(sessionId, turn);
        if (!id || !input || disposed) return Promise.resolve(null);
        const identity = share(input);             // clone now, even while loading is still pending
        if (!loaded) {
          const stamp = generation;
          const ready = load();
          if (!loaded) return ready.then(() => live(stamp) ? remember(sessionId, turn, identity) : null);
        }
        if (pending.has(id)) return pending.get(id);
        if (cache.has(id)) return Promise.resolve(cache.get(id));
        cache.set(id, identity);
        volatile.add(id);
        notify();
        const stamp = generation;
        const previous = writeTail;
        const task = (async () => {
          try {
            await previous;                      // bound active write transactions, even for long chats
            if (!live(stamp)) return identity;
            if (damaged.has(id)) return identity;   // never overwrite an unreadable existing record
            const handle = db || await openDb();
            if (!handle || !live(stamp)) return identity;
            const result = await transact(handle, ['assets', 'snapshots', 'turns'], 'readwrite',
              (tx) => write(tx, id, String(sessionId).trim(), turn, identity));
            if (live(stamp)) {
              cache.set(id, result.identity);
              volatile.delete(id);
              if (result.created) written += 1;     // only after the transaction actually commits
            }
          } catch (_err) { if (live(stamp)) fail(); }
          finally { if (live(stamp)) { pending.delete(id); notify(); } }
          return cache.get(id) || identity;
        })();
        writeTail = task.catch(() => {});
        pending.set(id, task);
        return task;
      }
      return {
        IDENTITY_KEYS: AVATAR_IDENTITY_KEYS, load, remember, turnKeyOf,
        ready: () => loaded && !disposed,
        identityFor: (sessionId, turn) => cache.get(turnKeyOf(sessionId, turn)) || null,
        configFor: (sessionId, turn, cfg) => {
          const identity = cache.get(turnKeyOf(sessionId, turn));
          return identity ? Object.assign({}, cfg, identity) : cfg;
        },
        notice: () => notice, hasFailed: () => failed,
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        stats: () => ({ cached: cache.size, written, failed, loaded, profiles: profiles.length, volatile: volatile.size }),
        activate() {
          if (disposed) {
            disposed = false;
            loaded = false;
            if (!volatile.size) { failed = false; notice = ''; }
          }
          return load();
        },
        dispose() {
          disposed = true;
          generation += 1;
          loaded = false;
          if (cancelOpen) cancelOpen();
          for (const tx of transactions) { try { tx.abort(); } catch (_err) {} }
          transactions.clear(); pending.clear(); listeners.clear();
          writeTail = Promise.resolve();
          try { if (db) db.close(); } catch (_err) {}
          db = null; dbPromise = null; loadPromise = null;
        },
      };
    }

    const avatarHistory = createAvatarHistory();

    // ------------------------------------------------------------------
    // DOM 装饰引擎
    // ------------------------------------------------------------------
    // ── WX-M12 DOM 装饰引擎 ───────────────────────────────────────────────
    // 只往「行内变量」和 data-wx-avatar-source 上写，不动气泡里的任何节点，
    // 因此不会拦截链接/复制/工具控件；虚拟化或折叠造成的行增删由 MutationObserver 兜住。
    const ROW_SELECTOR = '[data-chat-flow-kind="assistant-step"], [data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]';
    const AVATAR_VAR = '--wx-avatar-ai-img';
    const AVATAR_SOURCE_ATTR = 'data-wx-avatar-source';
    // 每轮头像历史用：行级覆盖用户头像的图/字母（没有历史时不写，回落作用域变量）
    const AVATAR_USER_VAR = '--wx-avatar-user-img-row';
    const AVATAR_USER_TEXT_VAR = '--wx-avatar-user-text-row';

    /** 把索引写到一个作用域里的所有 flow 行；值没变就不碰 DOM。 */
    function decorateScope(scope, index) {
      const root = scope && scope.isConnected === false ? null : scope;
      if (!root || typeof root.querySelectorAll !== 'function') return 0;
      const rows = root.querySelectorAll(ROW_SELECTOR);
      let touched = 0;
      for (const row of rows) {
        const raw = row.getAttribute('data-chat-turn');
        const turn = raw === null || raw === '' ? NaN : Number(raw);
        const entry = Number.isFinite(turn) ? index.get(turn) : undefined;
        const kind = row.getAttribute('data-chat-flow-kind');
        if (kind === 'assistant-step') {
          // 有该轮记录时**永远写行变量**（哪怕解析成官方鲸鱼 logo）：写成"删掉"就会回落到
          // 作用域的当前配置，旧轮次的头像就会被后来的换图改掉。
          if (!entry) {
            if (row.style.getPropertyValue(AVATAR_VAR)) { row.style.removeProperty(AVATAR_VAR); touched += 1; }
          } else {
            // 明确的行值挡回落：工具/角色图 → 该轮默认 AI 图 → 官方鲸鱼 logo（原生默认图也要固定）
            const resolved = entry.avatar || (entry.identity && entry.identity.aiAvatar) || DS_LOGO_URL;
            const next = 'url("' + resolved + '")';
            if (row.style.getPropertyValue(AVATAR_VAR) !== next) {
              row.style.setProperty(AVATAR_VAR, next);
              touched += 1;
            }
          }
          const source = entry ? entry.source : '';
          const current = row.getAttribute(AVATAR_SOURCE_ATTR) || '';
          if (current !== source) {
            if (source) row.setAttribute(AVATAR_SOURCE_ATTR, source);
            else row.removeAttribute(AVATAR_SOURCE_ATTR);
          }
        } else {
          // 用户/引导行：把该轮保存的用户头像身份写到行上（点击预览也读这里）。
          // 关键：**有身份记录**时即使这张图是空的，也要写成 none 挡住作用域回落 ——
          // 否则"历史上是字母头像"的旧轮次会被后来的新图覆盖。
          if (!entry) {
            if (row.style.getPropertyValue(AVATAR_USER_VAR)) row.style.removeProperty(AVATAR_USER_VAR);
            if (row.style.getPropertyValue(AVATAR_USER_TEXT_VAR)) row.style.removeProperty(AVATAR_USER_TEXT_VAR);
          } else {
            const img = entry.userAvatar ? 'url("' + entry.userAvatar + '")' : 'none';
            if (row.style.getPropertyValue(AVATAR_USER_VAR) !== img) {
              row.style.setProperty(AVATAR_USER_VAR, img);
              touched += 1;
            }
            // 图片身份也要显式写空文本，防止后来改成字母头像时文字叠到旧图上。
            const letter = entry.userAvatar ? '""' : JSON.stringify(entry.userLetter || '我');
            if (letter) {
              if (row.style.getPropertyValue(AVATAR_USER_TEXT_VAR) !== letter) row.style.setProperty(AVATAR_USER_TEXT_VAR, letter);
            } else if (row.style.getPropertyValue(AVATAR_USER_TEXT_VAR)) {
              row.style.removeProperty(AVATAR_USER_TEXT_VAR);
            }
          }
        }
      }
      return touched;
    }

    /** 撤销一个作用域里由本插件写入的行内样式/属性。 */
    function resetScope(scope) {
      if (!scope || typeof scope.querySelectorAll !== 'function') return;
      for (const row of scope.querySelectorAll(ROW_SELECTOR)) {
        row.style.removeProperty(AVATAR_VAR);
        row.style.removeProperty(AVATAR_USER_VAR);
        row.style.removeProperty(AVATAR_USER_TEXT_VAR);
        row.removeAttribute(AVATAR_SOURCE_ATTR);
      }
    }

    /**
     * 装饰运行时：按作用域保存索引，用单个 MutationObserver 处理行增删。
     * 只对「新增/移除的节点里含 flow 行」或「flow 行的识别属性变化」重排，
     * 流式新增的文本/内联元素不触发重排，避免每 token 全历史重算。
     */
    function createAvatarRuntime() {
      const scopes = new Map();
      let observer = null;
      let rafId = 0;

      const requestFrame = (fn) => {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') return window.requestAnimationFrame(fn);
        return setTimeout(fn, 16);
      };
      const cancelFrame = (id) => {
        if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(id);
        else clearTimeout(id);
      };

      function applyAll() {
        for (const [scope, index] of scopes) decorateScope(scope, index);
      }
      function schedule() {
        if (rafId) return;
        rafId = requestFrame(() => {
          rafId = 0;
          applyAll();
        });
      }
      function relevantMutation(mutations) {
        for (const mutation of mutations) {
          if (mutation.type === 'attributes') return true;
          for (const list of [mutation.addedNodes, mutation.removedNodes]) {
            for (const node of list) {
              if (!node || node.nodeType !== 1) continue;   // 文本节点（流式 token）不算
              if (node.matches(ROW_SELECTOR)) return true;
              if (typeof node.querySelector === 'function' && node.querySelector(ROW_SELECTOR)) return true;
            }
          }
        }
        return false;
      }
      function ensureObserver() {
        if (observer) return;
        if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
        observer = new MutationObserver((mutations) => {
          if (relevantMutation(mutations)) schedule();
        });
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          // 只关心行身份属性；本插件自己写的 style / data-wx-avatar-source 不在其中，不会自激
          attributeFilter: ['data-chat-flow-kind', 'data-chat-turn', 'data-chat-group-part'],
        });
      }
      // 没有作用域时释放观察器，避免卸载后还在跑。
    function releaseObserverIfIdle() {
        if (scopes.size > 0 || !observer) return;
        observer.disconnect();
        observer = null;
        if (rafId) { cancelFrame(rafId); rafId = 0; }
      }

      return {
        update(scope, index) {
          if (!scope) return;
          const had = scopes.has(scope);
          scopes.set(scope, index);
          if (!had) ensureObserver();
          decorateScope(scope, index);
        },
        release(scope) {
          if (!scope) return;
          scopes.delete(scope);
          resetScope(scope);
          releaseObserverIfIdle();
        },
        applyAll,
        dispose() {
          for (const scope of scopes.keys()) {
            resetScope(scope);
            // 同时撤掉该会话作用域上的外观变量与 dataset（2.3：变量按 scope 写）
            clearScopeConfig(scope);
          }
          scopes.clear();
          releaseObserverIfIdle();
          if (observer) { observer.disconnect(); observer = null; }
          if (rafId) { cancelFrame(rafId); rafId = 0; }
        },
        get scopeCount() { return scopes.size; },
      };
    }

    // ------------------------------------------------------------------
    // 每会话状态发布（控件读它，避免跨会话混用；也作为原生接入的调试证据）
    // ------------------------------------------------------------------
    // ── WX-M13 会话状态广播 ───────────────────────────────────────────────
    // 驱动组件发布、控件订阅；按 sessionId 分键，A 会话的状态不会影响 B。
    function createSessionInfoStore() {
      const values = new Map();
      const listeners = new Map();
      function notify(sessionId) {
        const set = listeners.get(sessionId);
        if (!set) return;
        const value = values.get(sessionId);
        for (const fn of set) {
          try { fn(value); } catch (_err) { /* 空实现 */ }
        }
      }
      return {
        set(sessionId, info) {
          if (!sessionId) return;
          const prev = values.get(sessionId);
          if (prev && prev.debug === info.debug && prev.roleOn === info.roleOn && prev.running === info.running) return;
          values.set(sessionId, info);
          notify(sessionId);
        },
        get(sessionId) { return sessionId ? values.get(sessionId) : undefined; },
        subscribe(sessionId, fn) {
          if (!sessionId) return () => {};
          const set = listeners.get(sessionId) || new Set();
          set.add(fn);
          listeners.set(sessionId, set);
          return () => { set.delete(fn); if (set.size === 0) listeners.delete(sessionId); };
        },
        clear(sessionId) {
          if (sessionId) {
            values.delete(sessionId);
            notify(sessionId);
          } else {
            const ids = [...values.keys()];
            values.clear();
            for (const id of ids) notify(id);
          }
        },
        dispose() {
          values.clear();
          listeners.clear();
        },
      };
    }

    // ------------------------------------------------------------------
    // 头像大图预览（命令式，不进 React 树；卸载时整体移除）
    // ------------------------------------------------------------------
    // ── WX-M14 头像大图预览层 + 点击命中 ───────────────────────────────────
    // 命令式 DOM 弹层（不进 React 树）：打开时记住焦点，关闭时还原；dispose 时整体移除。
    function extractCssUrl(value) {
      const text = String(value == null ? '' : value).trim();
      if (!text || text === 'none') return '';
      const match = /^url\((.*)\)$/s.exec(text);
      if (!match) return '';
      let inner = match[1].trim();
      if ((inner.startsWith('"') && inner.endsWith('"')) || (inner.startsWith("'") && inner.endsWith("'"))) {
        inner = inner.slice(1, -1);
      }
      return inner;
    }
    function createAvatarPreview() {
      // 预览层在 body 里，会脱离会话作用域，所以打开时把该行**自己算出来**的圆角/背景/主题抄过来

      let overlay = null;
      let keyHandler = null;
      let restoreFocus = null;
      let onClosed = null;

      function close() {
        if (!overlay) return;
        if (keyHandler) { document.removeEventListener('keydown', keyHandler, true); keyHandler = null; }
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        overlay = null;
        const target = restoreFocus;
        restoreFocus = null;
        if (target && typeof target.focus === 'function' && target.isConnected) {
          try { target.focus(); } catch (_err) { /* 焦点恢复失败不影响关闭 */ }
        }
        if (onClosed) { const fn = onClosed; onClosed = null; fn(); }
      }

      function open(payload) {
        if (!payload || typeof document === 'undefined') return;
        close();
        restoreFocus = document.activeElement;
        onClosed = payload.onClose || null;
        const wrap = document.createElement('div');
        wrap.className = 'wxpv';
        wrap.dataset.wxPreview = '';
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'true');
        wrap.setAttribute('aria-label', payload.label || '头像预览');
        const backdrop = document.createElement('div');
        backdrop.className = 'wxpv-backdrop';
        backdrop.addEventListener('click', close);
        wrap.appendChild(backdrop);
        const body = document.createElement('div');
        body.className = 'wxpv-body';
        // 视觉参数由调用方（attachAvatarClick）从被点击的那一行读出来，保证大图跟该行所属会话一致
        if (payload.round) body.style.setProperty('--wx-avatar-round', payload.round);
        if (payload.background) body.style.setProperty('--wx-avatar-bg', payload.background);
        if (payload.theme) body.setAttribute('data-wx-theme', payload.theme);
        if (payload.src) {
          const img = document.createElement('img');
          img.className = 'wxpv-img';
          img.dataset.wxPreviewImg = '';
          img.alt = payload.label || '';
          img.src = payload.src;
          body.appendChild(img);
        } else {
          const letter = document.createElement('div');
          letter.className = 'wxpv-letter';
          letter.style.borderRadius = 'var(--wx-avatar-round, 50%)';
          letter.textContent = payload.letter || '我';
          body.appendChild(letter);
        }
        const caption = document.createElement('div');
        caption.className = 'wxpv-caption';
        caption.textContent = payload.caption || '点击遮罩、按 Esc 或点右上角关闭';
        body.appendChild(caption);
        wrap.appendChild(body);
        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'wxpv-close';
        closeButton.dataset.wxPreviewClose = '';
        closeButton.setAttribute('aria-label', '关闭预览');
        closeButton.textContent = '✕';
        closeButton.addEventListener('click', close);
        wrap.appendChild(closeButton);
        document.body.appendChild(wrap);
        overlay = wrap;
        keyHandler = (event) => {
          if (!overlay) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        };
        document.addEventListener('keydown', keyHandler, true);
        try { closeButton.focus(); } catch (_err) { /* 聚焦失败不影响打开 */ }
      }

      return {
        open,
        close,
        dispose() { close(); },
        get isOpen() { return !!overlay; },
        get element() { return overlay; },
      };
    }

    /**
     * 头像区域点击 -> 预览。
     * 用 document 捕获阶段的坐标命中判定，不向 React 管理的行里注入节点，
     * 因此不会拦截气泡链接 / 代码复制 / 工具控件。
     */
    // 命中判定用文档级捕获监听 + 真实像素尺寸，不向 React 管理的行里注入节点。
    function attachAvatarClick(preview) {
      if (typeof document === 'undefined') return () => {};
      const handler = (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest('a,button,input,textarea,select,summary,[contenteditable="true"]')) return;
        const row = target.closest('[data-chat-flow-kind]');
        if (!row) return;
        const kind = row.getAttribute('data-chat-flow-kind');
        const isUser = kind === 'user' || kind === 'steering';
        if (!isUser && kind !== 'assistant-step') return;
        if (kind === 'assistant-step' && row.getAttribute('data-chat-group-part') === 'reasoning') return;
        const rect = row.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        // 真实像素从伪元素的计算样式拿：custom property 里可能是 min(...) 这类表达式，
        // parseFloat 会得到错的值（窄屏封顶时会误判点击区域）。
        const pseudo = getComputedStyle(row, '::before');
        if (pseudo.visibility === 'hidden' || pseudo.display === 'none') return;   // 合并头像 / 空行：没有可见头像
        let size = parseFloat(pseudo.width);
        if (!Number.isFinite(size) || size <= 0) size = avatarSizeOf(configSnapshot());
        const left = isUser ? rect.right - size : rect.left;
        const top = rect.top + 2;
        const x = event.clientX;
        const y = event.clientY;
        if (x < left || x > left + size || y < top || y > top + size) return;
        const cfg = configSnapshot();
        // 外观参数一律从**这一行自己**的计算样式 + 最近的会话作用域读，
        // 不要用全局配置：同页不同会话可能用不同方案（大小/圆角/背景/主题都不一样）。
        const scope = row.closest('[data-conversation-content]');
        const scopeStyle = scope ? getComputedStyle(scope) : getComputedStyle(document.documentElement);
        const round = pseudo.borderTopLeftRadius || scopeStyle.getPropertyValue('--wx-avatar-round');
        const background = pseudo.backgroundColor;
        const themeAttr = scope && scope.dataset ? scope.dataset.wxTheme : '';
        let src = '';
        let letter = '';
        let caption = '';
        if (isUser) {
          // 优先读**这一行**保存下来的头像身份（2.4.0 每轮头像历史）：
          // 否则会出现「小头像是旧图、点开却是新图」。
          const rowImgRaw = row.style.getPropertyValue(AVATAR_USER_VAR);
          const rowText = row.style.getPropertyValue(AVATAR_USER_TEXT_VAR).trim();
          if (rowImgRaw) {
            // 行上有身份记录：它是权威的（可能是 none = 该轮是字母头像），不再回落作用域
            src = extractCssUrl(rowImgRaw);
            if (!src) letter = rowText && rowText !== '""' ? rowText.replace(/^"|"$/g, '') : '我';
          } else {
            const scopeUserImg = scopeStyle.getPropertyValue('--wx-avatar-user-img');
            src = extractCssUrl(scopeUserImg || document.documentElement.style.getPropertyValue('--wx-avatar-user-img'));
            if (!src) {
              // 字母：其次读作用域的 --wx-avatar-user-text（applyConfig 写的是带引号的 JSON 字符串）
              const raw = scopeStyle.getPropertyValue('--wx-avatar-user-text').trim();
              letter = raw && raw !== '""' ? raw.replace(/^"|"$/g, '') : (cfg.userLetter || '我');
            }
          }
          caption = '用户头像';
        } else {
          const inline = row.style.getPropertyValue(AVATAR_VAR);
          src = extractCssUrl(inline || scopeStyle.getPropertyValue('--wx-avatar-ai-img'));
          const source = row.getAttribute(AVATAR_SOURCE_ATTR) || 'default';
          caption = source === 'role' ? '角色头像' : source === 'tool' ? '工具头像' : 'AI 头像';
        }
        if (!src && !letter) return;
        event.preventDefault();
        event.stopPropagation();
        preview.open({
          src, letter, caption, label: caption, round, background, theme: themeAttr || '',
        });
      };
      document.addEventListener('click', handler, true);
      return () => document.removeEventListener('click', handler, true);
    }

    // ------------------------------------------------------------------
    // 样式层
    // ------------------------------------------------------------------
    // ── WX-M24 样式表 ─────────────────────────────────────────────────────
    // 全插件唯一的 CSS 注入点（模板字符串，运行时按配置取变量）。
    // 选择器构成：data-chat-flow-kind/data-chat-turn 等 data-* 钩子 + 少量宿主原生
    // content-hash 类名 + 本插件自己的 --wx-* 变量；升级宿主请按导读末尾清单核对。
    // 配色在 :root 定义浅色默认值，再由 body[data-ds-dark-theme] / html[data-wx-theme] 覆盖。
    function buildCss() {
      const logoUrl = 'url("' + DS_LOGO_URL + '")';
      return String.raw`
/* ===== dsh-wx-chat 微信风聊天气泡（presentation-only） ===== */
/* 历史载入期间只暂缓头像，正文照常可读；写完行变量后由驱动解除。 */
[data-wx-avatar-history-pending] .xz4KEq_flowItem::before { visibility: hidden; }
/* 变量分两层：
   1) 基数与默认值写在 :root（--wx-avatar-size-base / --wx-avatar-gap-base / --wx-avatar-round …），
      运行时由 applyConfig 以内联变量覆盖「根」或「某个会话作用域」。
   2) 派生变量（--wx-avatar-size = var(--wx-avatar-size-base)）要在**每个会话作用域**重新声明：
      var() 在声明它的元素上就完成了替换，根上算出来的长度会作为定值继承下去，
      光改作用域的 --wx-avatar-size-base 是没用的。见下面的 :root,[data-conversation-content] 规则。 */
:root {
  --wx-avatar-size-base: 36px;
  --wx-avatar-gap-base: 10px;
  --wx-avatar-round: 50%;
  --wx-radius: 12px;
  --wx-max: 76%;
  /* 深海女仆工坊色系：柔金 + 瓷白 + 深海蓝 */
  --wx-user-bg: rgba(232, 237, 249, 0.95);
  --wx-user-border: rgba(197, 164, 104, 0.48);
  --wx-user-text: #172347;
  --wx-user-shadow: 0 6px 20px rgba(19, 38, 87, 0.10);
  --wx-ai-bg: rgba(248, 250, 255, 0.94);
  --wx-ai-border: rgba(197, 164, 104, 0.42);
  --wx-ai-shadow: 0 4px 14px rgba(19, 38, 87, 0.08);
  --wx-ai-text: #172347;
}
/* 派生变量：在**根**和**每个会话作用域**各声明一次。
   只把「基数」留给出配置写入（内联变量），作用域没有内联值时自然继承根上的默认方案值，
   因此没挂驱动的会话也不会掉回 CSS 硬编码默认。 */
:root,
[data-conversation-content] {
  --wx-avatar-size: var(--wx-avatar-size-base);
  --wx-avatar-gap: var(--wx-avatar-gap-base);
}
body[data-ds-dark-theme] {
  --wx-user-bg: rgba(30, 47, 90, 0.97);
  --wx-user-border: rgba(211, 180, 119, 0.40);
  --wx-user-text: #edf1fa;
  --wx-user-shadow: 0 6px 20px rgba(0, 0, 0, 0.22);
  --wx-ai-bg: rgba(18, 31, 67, 0.94);
  --wx-ai-border: rgba(211, 180, 119, 0.40);
  --wx-ai-shadow: 0 4px 16px rgba(0, 0, 0, 0.22);
  --wx-ai-text: #edf1fa;
}
/* 强制主题：既要作用于根（默认方案/面板外），也要作用于**会话作用域元素**与弹窗宿主。
   裸 [data-wx-theme] 选择器就是给后者用的：变量写在最近的祖先上，作用域内的元素自然就近继承。 */
html[data-wx-theme='dark'],
[data-wx-theme='dark'] {
  --wx-user-bg: rgba(30, 47, 90, 0.97);
  --wx-user-border: rgba(211, 180, 119, 0.40);
  --wx-user-text: #edf1fa;
  --wx-ai-bg: rgba(18, 31, 67, 0.94);
  --wx-ai-border: rgba(211, 180, 119, 0.40);
  --wx-ai-text: #edf1fa;
  --wx-panel-bg: var(--dsw-alias-bg-layer-1, #111a30);
  --wx-panel-fg: var(--dsw-alias-label-primary, #edf1fa);
  --wx-panel-sub: var(--dsw-alias-label-secondary, #b9c4dc);
  --wx-panel-field-bg: var(--dsw-alias-bg-layer-2, #182446);
}
html[data-wx-theme='light'],
[data-wx-theme='light'] {
  --wx-user-bg: rgba(232, 237, 249, 0.95);
  --wx-user-border: rgba(197, 164, 104, 0.48);
  --wx-user-text: #172347;
  --wx-ai-bg: rgba(248, 250, 255, 0.94);
  --wx-ai-border: rgba(197, 164, 104, 0.42);
  --wx-ai-text: #172347;
  /* 面板在「暗色宿主 + 强制浅色方案」下也要有亮底，避免深字叠深底 */
  --wx-panel-bg: var(--dsw-alias-bg-layer-1, #ffffff);
  --wx-panel-fg: var(--dsw-alias-label-primary, #172347);
  --wx-panel-sub: var(--dsw-alias-label-secondary, #4d5d7f);
  --wx-panel-field-bg: var(--dsw-alias-bg-layer-2, #f4f6fb);
}

/* ---- 微信行布局：原生块级布局不变，头像用绝对定位 + 内边距让位，
      不引入 flex 收缩路径，避免短消息气泡被压窄成竖排 ---- */
.xz4KEq_flowItem[data-chat-flow-kind='user'],
.xz4KEq_flowItem[data-chat-flow-kind='steering'],
.xz4KEq_flowItem[data-chat-flow-kind='assistant-step']:not([data-chat-group-part='reasoning']) {
  position: relative;
  /* 行高至少容下头像，避免放大头像后压到相邻消息 */
  min-height: calc(var(--wx-avatar-size) + 4px);
}
.xz4KEq_flowItem[data-chat-flow-kind='user'],
.xz4KEq_flowItem[data-chat-flow-kind='steering'] {
  padding-right: calc(var(--wx-avatar-size) + var(--wx-avatar-gap));
}
.xz4KEq_flowItem[data-chat-flow-kind='assistant-step']:not([data-chat-group-part='reasoning']) {
  padding-left: calc(var(--wx-avatar-size) + var(--wx-avatar-gap));
}

/* 头像：::before 绝对定位在气泡外侧（用户右侧 / DeepSeek 左侧）
   形状由 --wx-avatar-round 决定：0% 直角 / 25% 圆角方形 / 50% 圆形。
   动态头像：行内 --wx-avatar-ai-img 覆盖（工具/类型/角色），
   data-wx-avatar-source 只作调试与 CSS 钩子。 */
.xz4KEq_flowItem[data-chat-flow-kind='user']::before,
.xz4KEq_flowItem[data-chat-flow-kind='steering']::before,
.xz4KEq_flowItem[data-chat-flow-kind='assistant-step']:not([data-chat-group-part='reasoning'])::before {
  content: var(--wx-avatar-text, '');
  position: absolute;
  top: 2px;
  box-sizing: border-box;
  width: var(--wx-avatar-size);
  height: var(--wx-avatar-size);
  border-radius: var(--wx-avatar-round, 50%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: calc(var(--wx-avatar-size) * 0.42);
  font-weight: 600;
  color: var(--wx-avatar-fg, #ffffff);
  background-color: var(--wx-avatar-bg, #4d6bfe);
  background-image: var(--wx-avatar-img, none), var(--wx-avatar-fallback, none);
  background-size: cover, cover;
  background-position: center, center;
  background-repeat: no-repeat, no-repeat;
  box-shadow: 0 0 0 2px var(--wx-avatar-ring, #4d6bfe), 0 1px 4px rgba(19, 38, 87, 0.18);
  overflow: hidden;
  cursor: zoom-in;
}
.xz4KEq_flowItem[data-chat-flow-kind='user']::before,
.xz4KEq_flowItem[data-chat-flow-kind='steering']::before {
  right: 0;
  /* 行级变量优先：那是「这一轮保存下来的头像身份」（2.4.0），没有才回落到作用域/当前方案 */
  --wx-avatar-img: var(--wx-avatar-user-img-row, var(--wx-avatar-user-img, none));
  --wx-avatar-text: var(--wx-avatar-user-text-row, var(--wx-avatar-user-text, ''));
  --wx-avatar-fallback: var(--wx-avatar-user-fallback, none);
}
.xz4KEq_flowItem[data-chat-flow-kind='assistant-step']:not([data-chat-group-part='reasoning'])::before {
  left: 0;
  --wx-avatar-img: var(--wx-avatar-ai-img, ${logoUrl});
  --wx-avatar-text: var(--wx-avatar-ai-text, '');
  --wx-avatar-fallback: none;
}
/* 角色扮演轮次：头像外圈换成角色色，和工具轮次一眼可分 */
.xz4KEq_flowItem[data-chat-flow-kind='assistant-step'][data-wx-avatar-source='role']::before {
  box-shadow: 0 0 0 2px var(--dsw-alias-brand-primary, #4d6bfe), 0 0 0 4px rgba(197, 164, 104, 0.45), 0 1px 4px rgba(19, 38, 87, 0.18);
}
/* 空节点行不渲染头像 */
.xz4KEq_flowItem:is(:empty, :has(> [data-slot='conversation.chat.node']:empty))::before {
  display: none !important;
}

/* ---- 用户气泡 ---- */
.xz4KEq_flowItem[data-chat-flow-kind='user'] [class*='userRow'] [class*='bubble'],
.xz4KEq_flowItem[data-chat-flow-kind='steering'] [class*='userRow'] [class*='bubble'] {
  background: var(--wx-bubble-user, var(--wx-user-bg));
  border: 1px solid var(--wx-user-border);
  border-radius: var(--wx-radius) var(--wx-radius) 7px var(--wx-radius);
  box-shadow: var(--wx-user-shadow);
  /* 自定义气泡色时用按背景亮度算出的对比色（未自定义则为 initial → 走本主题的 --wx-user-text） */
  color: var(--wx-bubble-user-text, var(--wx-user-text));
}
.xz4KEq_flowItem[data-chat-flow-kind='user'] [class*='userStack'],
.xz4KEq_flowItem[data-chat-flow-kind='steering'] [class*='userStack'] {
  max-width: min(var(--wx-max), 100%);
}

/* ---- DeepSeek 气泡（文本块卡片；思考行不气泡化） ---- */
.xz4KEq_flowItem[data-chat-flow-kind='assistant-step']:not([data-chat-group-part='reasoning']) > [data-slot] > * > * > div[class*='markdown'] {
  box-sizing: border-box;
  align-self: flex-start;
  width: fit-content;
  max-width: min(var(--wx-max), 100%);
  padding: 10px 14px;
  border: 1px solid var(--wx-ai-border);
  border-radius: var(--wx-radius) var(--wx-radius) var(--wx-radius) 7px;
  background: var(--wx-bubble-ai, var(--wx-ai-bg));
  box-shadow: var(--wx-ai-shadow);
  overflow-wrap: anywhere;
  /* 同上：自定义 AI 气泡色时用对比色，未自定义时走本主题的 --wx-ai-text */
  color: var(--wx-bubble-ai-text, var(--wx-ai-text));
}
/* 气泡内宽表格横向滚动，不出气泡。
   宿主 .v5IAXa_body .md-table-wide 会按聊天列计算跨栏 width / 负 margin / padding，
   只改 max-width 会保留跨栏偏移、使可见区域错位；这里一并还原为气泡内的正常宽度。
   注意必须覆盖 **user / steering**：宿主对 ≥4 列的表格给 md-table-wide，
   默认 overflow-x:hidden（只在 :hover/:focus-visible 才 scroll），
   只覆盖 assistant-step 会让用户气泡里的宽表被裁且滚不动。 */
.xz4KEq_flowItem[data-chat-flow-kind='user'] [class*='userRow'] .md-table-wide,
.xz4KEq_flowItem[data-chat-flow-kind='steering'] [class*='userRow'] .md-table-wide,
.xz4KEq_flowItem[data-chat-flow-kind='assistant-step']:not([data-chat-group-part='reasoning']) .md-table-wide {
  width: 100%;
  max-width: 100%;
  margin-left: 0;
  padding-left: 0;
  overflow-x: auto;
}

/* 气泡内行内代码：宿主那条 :not(pre)>code 用的是全局固定浅底
   （--dsw-alias-markdown-inline-code = #fafafa，不随主题也不随气泡配色变），自定义气泡里就变成
   「纯白小方块 + 继承来的浅色文字」。这里只改三件事：底色透明、文字用当前气泡文字色、
   边框用 currentColor 的柔和透明色（先给 rgba 回退，再给 color-mix）。
   等宽字体、圆角、内边距、边框宽度、选中与复制行为全部沿用宿主；
   选择器排除**所有 pre 子树与 .md-code-block 子树**（不能只靠父元素 :not(pre)），
   所以多行代码块、代码高亮 token 与代码工具栏都不受影响。 */
.xz4KEq_flowItem[data-chat-flow-kind='assistant-step']:not([data-chat-group-part='reasoning']) > [data-slot] > * > * > div[class*='markdown'] code:not(pre code):not(.md-code-block code) {
  background-color: transparent;
  color: var(--wx-bubble-ai-text, var(--wx-ai-text));
  border-color: rgba(127, 127, 127, 0.35);
  border-color: color-mix(in srgb, currentColor 25%, transparent);
}
.xz4KEq_flowItem[data-chat-flow-kind='user'] [class*='userRow'] [class*='bubble'] code:not(pre code):not(.md-code-block code),
.xz4KEq_flowItem[data-chat-flow-kind='steering'] [class*='userRow'] [class*='bubble'] code:not(pre code):not(.md-code-block code) {
  background-color: transparent;
  color: var(--wx-bubble-user-text, var(--wx-user-text));
  border-color: rgba(127, 127, 127, 0.35);
  border-color: color-mix(in srgb, currentColor 25%, transparent);
}

/* ---- 流式光标（挂在 data-streaming 气泡的最后文本块尾部） ---- */
.xz4KEq_flowItem[data-chat-flow-kind='assistant-step']:not([data-chat-group-part='reasoning']) .v5IAXa_root[data-streaming] > .v5IAXa_body > div[class*='markdown']::after {
  content: '';
  display: inline-block;
  width: 2px;
  height: 1.05em;
  margin-left: 2px;
  vertical-align: -0.2em;
  border-radius: 1px;
  background: var(--dsw-alias-brand-primary, #4d6bfe);
  animation: wx-caret-blink 1s steps(2, start) infinite;
}
@keyframes wx-caret-blink {
  50% { opacity: 0; }
}

/* ---- 连续同角色消息：间距收紧；可选合并头像（思考行不参与） ---- */
.xz4KEq_column .xz4KEq_flowItem[data-chat-flow-kind='user'] + .xz4KEq_flowItem[data-chat-flow-kind='user'],
.xz4KEq_column .xz4KEq_flowItem[data-chat-flow-kind='assistant-step']:not([data-chat-group-part='reasoning']) + .xz4KEq_flowItem[data-chat-flow-kind='assistant-step']:not([data-chat-group-part='reasoning']) {
  margin-top: 2px !important;
}
/* 合并头像由**自定义属性**驱动：变量在行上解析，作用域的内联值天然优先于根上的值，
   所以「根上开着合并、某个会话关掉」不会互相打架（用两条 visibility 声明会打成平手，
   根上的 html[...] 选择器还多一个元素选择器，反而会赢）。 */
:root {
  --wx-merge-vis: visible;
}
:root[data-wx-merge-avatars='1'],
[data-wx-merge-avatars='1'] {
  --wx-merge-vis: hidden;
}
:root[data-wx-merge-avatars='0'],
[data-wx-merge-avatars='0'] {
  --wx-merge-vis: visible;
}
.xz4KEq_flowItem[data-chat-flow-kind='user'] + .xz4KEq_flowItem[data-chat-flow-kind='user']::before,
.xz4KEq_flowItem[data-chat-flow-kind='assistant-step']:not([data-chat-group-part='reasoning']) + .xz4KEq_flowItem[data-chat-flow-kind='assistant-step']:not([data-chat-group-part='reasoning'])::before {
  visibility: var(--wx-merge-vis);
}

/* ---- 系统/工具/进程类消息：保持 DSH 原生样式（不做气泡、不限制宽度，
      以免挤压原生按钮与折叠控件） ---- */

/* ---- 时间戳装饰（由装饰层注入的 time.wx-ts；块级居中，微信风格） ---- */
:root {
  --wx-ts-display: block;
}
/* 时间戳按**方案**显示：装饰器只在有方案需要时挂载，
   每个会话用自己 scope 上的 dataset 决定显示/隐藏（变量在行上解析，就近生效）。 */
:root[data-wx-timestamps='0'],
[data-wx-timestamps='0'] {
  --wx-ts-display: none;
}
:root[data-wx-timestamps='1'],
[data-wx-timestamps='1'] {
  --wx-ts-display: block;
}
.xz4KEq_flowItem .wx-ts {
  display: var(--wx-ts-display);
  display: block;
  margin-top: 2px;
  text-align: center;
  font-size: 11px;
  line-height: 14px;
  color: var(--dsw-alias-label-tertiary, #6f7c99);
  white-space: nowrap;
  user-select: none;
}

/* ---- 移动端：头像显示尺寸封顶，保住气泡宽度 ---- */
@media (width <= 480px) {
  :root,
  [data-conversation-content] {
    --wx-avatar-size: min(var(--wx-avatar-size-base), 32px);
    --wx-avatar-gap: 8px;
    --wx-max: 85%;
  }
}

/* ---- 头像大图预览 ---- */
.wxpv {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.wxpv-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(6, 12, 28, 0.72);
  backdrop-filter: blur(2px);
}
.wxpv-body {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  max-width: 90vw;
  max-height: 90vh;
}
.wxpv-img {
  display: block;
  width: min(48vmin, 420px);
  height: min(48vmin, 420px);
  object-fit: contain;
  border-radius: var(--wx-avatar-round, 50%);
  background: var(--wx-avatar-bg, #0d1730);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}
.wxpv-letter {
  display: flex;
  align-items: center;
  justify-content: center;
  width: min(48vmin, 420px);
  height: min(48vmin, 420px);
  background: var(--wx-avatar-bg, #4d6bfe);
  color: var(--wx-avatar-fg, #ffffff);
  font-size: min(20vmin, 180px);
  font-weight: 600;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
}
.wxpv-caption {
  color: rgba(255, 255, 255, 0.86);
  font-size: 13px;
  line-height: 18px;
}
.wxpv-close {
  position: absolute;
  top: 18px;
  right: 20px;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.wxpv-close:hover {
  background: rgba(255, 255, 255, 0.24);
}

/* ---- 会话内角色扮演模式控件 ---- */
.wxrp {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  line-height: 18px;
}
.wxrp-group {
  display: inline-flex;
  border: 1px solid var(--dsw-alias-border-l2, #ccd4e4);
  border-radius: 8px;
  overflow: hidden;
}
.wxrp-btn {
  font: inherit;
  padding: 2px 7px;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #4d5d7f);
  cursor: pointer;
}
.wxrp-btn + .wxrp-btn {
  border-left: 1px solid var(--dsw-alias-border-l2, #ccd4e4);
}
.wxrp-btn[aria-pressed='true'] {
  background: var(--dsw-alias-button-primary-fill, #4d6bfe);
  color: var(--dsw-alias-label-primary-foreground, #ffffff);
}
.wxrp-btn:hover[aria-pressed='false'] {
  background: var(--dsw-alias-interactive-bg-hover, rgba(197, 164, 104, 0.18));
}
.wxrp-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--dsw-alias-border-l2, #ccd4e4);
}
.wxrp-dot[data-on='1'] {
  background: var(--dsw-alias-brand-primary, #4d6bfe);
  box-shadow: 0 0 0 2px rgba(77, 107, 254, 0.25);
}
.wxrp-hint {
  color: var(--dsw-alias-label-tertiary, #6f7c99);
}
.wxrp-entry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  padding: 2px 8px;
  border: 1px solid var(--dsw-alias-border-l2, #ccd4e4);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2, #ffffff);
  color: var(--dsw-alias-label-secondary, #4d5d7f);
  cursor: pointer;
}
.wxrp-entry:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(197, 164, 104, 0.18));
}
.wxrp-entry-name {
  font-weight: 600;
  color: var(--dsw-alias-label-primary, #172347);
}

/* ---- 通用弹窗（裁剪 / 外观预览 / 角色头像设置） ----
   弹窗挂在 body 层，可能脱离宿主主题作用域，所以每个颜色变量都是「宿主 alias 优先 +
   成对回落」：浅色回落给默认值，深色回落由 body[data-ds-dark-theme] / 插件强制主题覆盖。
   声明顺序即优先级：默认浅色 -> 系统深色 -> 插件强制深色 -> 插件强制浅色。 */
:root {
  --wx-modal-scrim: rgba(6, 12, 28, 0.55);
  --wx-modal-bg: var(--dsw-alias-bg-layer-1, #ffffff);
  --wx-modal-fg: var(--dsw-alias-label-primary, #172347);
  --wx-modal-sub: var(--dsw-alias-label-secondary, #4d5d7f);
  --wx-modal-hint: var(--dsw-alias-label-tertiary, #6f7c99);
  --wx-modal-border: var(--dsw-alias-border-l1, rgba(197, 164, 104, 0.45));
  --wx-modal-field-bg: var(--dsw-alias-bg-layer-2, #f4f6fb);
  --wx-modal-field-border: var(--dsw-alias-border-l2, #ccd4e4);
  --wx-modal-danger: var(--dsw-alias-state-error-primary, #c0392b);
  --wx-modal-warn: var(--dsw-alias-state-warning-primary, #8a6100);
  --wx-modal-primary-bg: var(--dsw-alias-button-primary-fill, #4d6bfe);
  --wx-modal-primary-fg: var(--dsw-alias-label-primary-foreground, #ffffff);
  --wx-modal-canvas-bg: var(--dsw-alias-bg-layer-2, #f2f4f8);
  /* 配置面板自己的表面：面板也会带上 data-wx-theme（强制方案主题），
     必须有自己的底色/文字色，否则暗色宿主 + 强制浅色方案会出现深字叠深底 */
  --wx-panel-bg: var(--dsw-alias-bg-layer-1, #ffffff);
  --wx-panel-fg: var(--dsw-alias-label-primary, #172347);
  --wx-panel-sub: var(--dsw-alias-label-secondary, #4d5d7f);
  --wx-panel-field-bg: var(--dsw-alias-bg-layer-2, #f4f6fb);
}
body[data-ds-dark-theme] {
  --wx-modal-scrim: rgba(4, 8, 20, 0.72);
  --wx-modal-bg: var(--dsw-alias-bg-layer-1, #111a30);
  --wx-modal-fg: var(--dsw-alias-label-primary, #edf1fa);
  --wx-modal-sub: var(--dsw-alias-label-secondary, #b9c4dc);
  --wx-modal-hint: var(--dsw-alias-label-tertiary, #93a1c4);
  --wx-modal-border: var(--dsw-alias-border-l1, rgba(211, 180, 119, 0.40));
  --wx-modal-field-bg: var(--dsw-alias-bg-layer-2, #182446);
  --wx-modal-field-border: var(--dsw-alias-border-l2, #2c3a63);
  --wx-modal-danger: var(--dsw-alias-state-error-primary, #ff8a80);
  --wx-modal-warn: var(--dsw-alias-state-warning-primary, #ffcc66);
  --wx-modal-canvas-bg: var(--dsw-alias-bg-layer-2, #182446);
  --wx-panel-bg: var(--dsw-alias-bg-layer-1, #111a30);
  --wx-panel-fg: var(--dsw-alias-label-primary, #edf1fa);
  --wx-panel-sub: var(--dsw-alias-label-secondary, #b9c4dc);
  --wx-panel-field-bg: var(--dsw-alias-bg-layer-2, #182446);
}
/* 插件强制深色：同时落在 body 上，才能盖过宿主写在 body 上的深色值
   （只写在 html 上的话，body 的继承值会赢，跟 CSS 顺序无关）。 */
html[data-wx-theme='dark'],
:root[data-wx-theme='dark'] body,
[data-wx-theme='dark'] {
  --wx-modal-scrim: rgba(4, 8, 20, 0.72);
  --wx-modal-bg: var(--dsw-alias-bg-layer-1, #111a30);
  --wx-modal-fg: var(--dsw-alias-label-primary, #edf1fa);
  --wx-modal-sub: var(--dsw-alias-label-secondary, #b9c4dc);
  --wx-modal-hint: var(--dsw-alias-label-tertiary, #93a1c4);
  --wx-modal-border: var(--dsw-alias-border-l1, rgba(211, 180, 119, 0.40));
  --wx-modal-field-bg: var(--dsw-alias-bg-layer-2, #182446);
  --wx-modal-field-border: var(--dsw-alias-border-l2, #2c3a63);
  --wx-modal-danger: var(--dsw-alias-state-error-primary, #ff8a80);
  --wx-modal-warn: var(--dsw-alias-state-warning-primary, #ffcc66);
  --wx-modal-canvas-bg: var(--dsw-alias-bg-layer-2, #182446);
}
/* 插件强制浅色：同理要写在 body 上、且特异性要高于 body[data-ds-dark-theme]。 */
html[data-wx-theme='light'],
:root[data-wx-theme='light'] body,
[data-wx-theme='light'] {
  --wx-modal-scrim: rgba(6, 12, 28, 0.55);
  --wx-modal-bg: var(--dsw-alias-bg-layer-1, #ffffff);
  --wx-modal-fg: var(--dsw-alias-label-primary, #172347);
  --wx-modal-sub: var(--dsw-alias-label-secondary, #4d5d7f);
  --wx-modal-hint: var(--dsw-alias-label-tertiary, #6f7c99);
  --wx-modal-border: var(--dsw-alias-border-l1, rgba(197, 164, 104, 0.45));
  --wx-modal-field-bg: var(--dsw-alias-bg-layer-2, #f4f6fb);
  --wx-modal-field-border: var(--dsw-alias-border-l2, #ccd4e4);
  --wx-modal-danger: var(--dsw-alias-state-error-primary, #c0392b);
  --wx-modal-warn: var(--dsw-alias-state-warning-primary, #8a6100);
  --wx-modal-canvas-bg: var(--dsw-alias-bg-layer-2, #f2f4f8);
  /* 配置面板自己的表面：面板也会带上 data-wx-theme（强制方案主题），
     必须有自己的底色/文字色，否则暗色宿主 + 强制浅色方案会出现深字叠深底 */
  --wx-panel-bg: var(--dsw-alias-bg-layer-1, #ffffff);
  --wx-panel-fg: var(--dsw-alias-label-primary, #172347);
  --wx-panel-sub: var(--dsw-alias-label-secondary, #4d5d7f);
  --wx-panel-field-bg: var(--dsw-alias-bg-layer-2, #f4f6fb);
}
.wxmodal {
  position: fixed;
  inset: 0;
  z-index: 2147483100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.wxmodal-backdrop {
  position: absolute;
  inset: 0;
  background: var(--wx-modal-scrim);
  backdrop-filter: blur(2px);
}
.wxmodal-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(560px, 96vw);
  max-height: min(86vh, 900px);
  overflow: auto;
  padding: 16px 18px;
  border-radius: 14px;
  background: var(--wx-modal-bg);
  border: 1px solid var(--wx-modal-border);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.45);
  color: var(--wx-modal-fg);
  font-size: 13px;
  line-height: 20px;
}
.wxmodal-card--small {
  width: min(420px, 96vw);
}
.wxmodal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.wxmodal-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--wx-modal-fg);
}
.wxmodal-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.wxmodal-label {
  flex: none;
  width: 88px;
  color: var(--wx-modal-sub);
}
.wxmodal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.wxmodal-hint {
  font-size: 11px;
  line-height: 17px;
  color: var(--wx-modal-hint);
}
.wxmodal-notice {
  font-size: 12px;
  color: var(--wx-modal-danger);
}
.wxmodal-warn {
  font-size: 12px;
  color: var(--wx-modal-warn);
}
.wxmodal button {
  font: inherit;
  color: var(--wx-modal-fg);
  background: var(--wx-modal-field-bg);
  border: 1px solid var(--wx-modal-field-border);
  border-radius: 8px;
  padding: 5px 10px;
  cursor: pointer;
  flex: none;
}
.wxmodal button:hover {
  filter: brightness(1.06);
}
.wxmodal input[type='text'] {
  flex: 1 1 auto;
  min-width: 0;
  font: inherit;
  color: inherit;
  background: var(--wx-modal-field-bg);
  border: 1px solid var(--wx-modal-field-border);
  border-radius: 8px;
  padding: 5px 8px;
}
.wxmodal input[type='range'] {
  flex: 1 1 auto;
}
.wxmodal input[type='color'] {
  width: 44px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--wx-modal-field-border);
  border-radius: 6px;
  background: none;
  cursor: pointer;
}
.wxmodal-primary {
  background: var(--wx-modal-primary-bg);
  color: var(--wx-modal-primary-fg);
  border-color: transparent;
}
.wxmodal-close {
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 50%;
}
/* 标记约定方框在弹窗里要跟随弹窗主题（.wxcfg-marker 的基础样式是给配置面板用的浅色底，
   在深色弹窗里会变成「白底浅字」）。作用域限制在 .wxmodal，配置面板本体不受影响。 */
.wxmodal /* ---- 页签与方案栏（WX-M22） ---- */
.wxcfg-schemebar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(197, 164, 104, 0.35));
}
.wxcfg-schemebar select {
  max-width: 220px;
}
.wxcfg-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.wxcfg-tab {
  font: inherit;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l2, #ccd4e4);
  background: var(--dsw-alias-bg-layer-2, transparent);
  color: var(--dsw-alias-label-secondary, #4d5d7f);
  cursor: pointer;
}
.wxcfg-tab[aria-selected='true'] {
  background: var(--dsw-alias-button-primary-fill, #4d6bfe);
  border-color: transparent;
  color: var(--dsw-alias-label-primary-foreground, #ffffff);
}
.wxcfg-panel {
  flex-direction: column;
  gap: 14px;
}
/* 页签隐藏必须真的生效：作者样式里的 display 会盖掉 [hidden] 的 UA 规则，
   所以只对 :not([hidden]) 设 display，而不是无条件设 flex。 */
.wxcfg-panel:not([hidden]) {
  display: flex;
}
.wxcfg-details {
  border: 1px dashed var(--dsw-alias-border-l2, #ccd4e4);
  border-radius: 10px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wxcfg-details > summary {
  cursor: pointer;
  font-weight: 600;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary, #4d5d7f);
}
.wxcfg-schemes {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wxcfg-schemes input[type='text'] {
  flex: 1 1 140px;
  min-width: 0;
}
/* 方案管理行里的按钮组也要能换行，避免 320px 下挤压 */
.wxcfg-schemes .wxcfg-row {
  flex-wrap: wrap;
}
[data-wx-preset-rows] select {
  max-width: 100%;
}
.wxmodal-status {
  font-size: 12px;
  line-height: 18px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--wx-modal-field-bg);
  color: var(--wx-modal-fg);
  border: 1px solid var(--wx-modal-field-border);
}
.wxcfg-warn {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}
.wxcfg-warn button {
  margin-left: 8px;
}
.wxmodal-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 40vh;
  overflow: auto;
}
.wxmodal-list-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 8px;
  border: 1px solid var(--wx-modal-field-border);
  cursor: pointer;
}
.wxmodal-list-item:hover {
  background: var(--wx-modal-field-bg);
}
.wxmodal .wxcfg-marker {
  background: var(--wx-modal-field-bg);
  color: var(--wx-modal-fg);
  border-color: var(--wx-modal-field-border);
}

/* 外观预览里的样例消息 */
.wxprev {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-radius: 10px;
  border: 1px dashed var(--dsw-alias-border-l2, #ccd4e4);
  background: var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, 0.04));
}
.wxprev-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.wxprev-row--user {
  justify-content: flex-end;
}
.wxprev-avatar {
  flex: none;
  width: var(--wx-prev-size, 36px);
  height: var(--wx-prev-size, 36px);
  border-radius: var(--wx-avatar-round, 50%);
  background-color: var(--wx-avatar-bg, #4d6bfe);
  background-image: var(--wx-prev-img, none);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  box-shadow: 0 0 0 2px var(--wx-avatar-ring, #4d6bfe), 0 1px 4px rgba(19, 38, 87, 0.18);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: calc(var(--wx-prev-size, 36px) * 0.42);
  color: var(--wx-avatar-fg, #ffffff);
  box-sizing: border-box;
  overflow: hidden;
}
.wxprev-bubble {
  max-width: 62%;
  padding: 8px 12px;
  border-radius: 12px 12px 12px 7px;
  background: var(--wx-bubble-ai, var(--wx-ai-bg, rgba(248, 250, 255, 0.94)));
  border: 1px solid var(--wx-ai-border, rgba(197, 164, 104, 0.42));
  box-shadow: var(--wx-ai-shadow, none);
  color: var(--wx-bubble-ai-text, var(--wx-ai-text, #172347));
  font-size: 13px;
}
.wxprev-row--user .wxprev-bubble {
  border-radius: 12px 12px 7px 12px;
  background: var(--wx-bubble-user, var(--wx-user-bg, rgba(232, 237, 249, 0.95)));
  border-color: var(--wx-user-border, rgba(197, 164, 104, 0.48));
  color: var(--wx-bubble-user-text, var(--wx-user-text, inherit));
}
.wxprev-facts {
  font-size: 11px;
  line-height: 17px;
  color: var(--dsw-alias-label-tertiary, #6f7c99);
}

/* ---- 配置面板 ---- */
.wxcfg {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 560px;
  font-size: 13px;
  line-height: 20px;
  /* 面板自己带主题属性（强制深/浅），所以底色与文字色都要用**同一套**令牌：
     暗色宿主 + 强制浅色方案时，若只把文字切成深色而底色仍透明，就会出现深字叠深底。 */
  color: var(--wx-panel-fg);
  background: var(--wx-panel-bg);
  border-radius: 12px;
}
.wxcfg-panel {
  background: var(--wx-panel-bg);
}
.wxcfg .wxcfg-hint {
  color: var(--wx-panel-sub);
}
.wxcfg-section {
  border: 1px solid var(--dsw-alias-border-l1, rgba(197, 164, 104, 0.4));
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--dsw-alias-bg-layer-1, transparent);
}
.wxcfg-title {
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.4px;
  color: var(--dsw-alias-label-secondary, #4d5d7f);
}
.wxcfg-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  /* 窄窗（320px）时 <select> 放不下就换行，不要横向溢出把下拉裁掉 */
  flex-wrap: wrap;
}
.wxcfg-label {
  flex: none;
  width: 96px;
  max-width: 100%;
  color: var(--dsw-alias-label-secondary, #4d5d7f);
}
/* 预设绑定行：下拉可以收缩并可换行占满一行（窄窗不能溢出） */
[data-wx-preset-bind] {
  flex: 1 1 120px;
  min-width: 0;
  max-width: 100%;
}
.wxcfg input[type='text'] {
  flex: 1 1 auto;
  min-width: 0;
  font: inherit;
  color: inherit;
  background: var(--dsw-alias-bg-layer-2, #ffffff);
  border: 1px solid var(--dsw-alias-border-l2, #ccd4e4);
  border-radius: 8px;
  padding: 5px 8px;
}
.wxcfg input[type='color'] {
  width: 44px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l2, #ccd4e4);
  border-radius: 6px;
  background: none;
  cursor: pointer;
}
.wxcfg input[type='range'] {
  flex: 1 1 auto;
}
.wxcfg input[type='checkbox'] {
  width: 16px;
  height: 16px;
}
.wxcfg select {
  font: inherit;
  color: inherit;
  background: var(--dsw-alias-bg-layer-2, #ffffff);
  border: 1px solid var(--dsw-alias-border-l2, #ccd4e4);
  border-radius: 8px;
  padding: 5px 8px;
}
.wxcfg button {
  font: inherit;
  color: var(--dsw-alias-label-primary, #172347);
  background: var(--dsw-alias-bg-layer-2, #ffffff);
  border: 1px solid var(--dsw-alias-border-l2, #ccd4e4);
  border-radius: 8px;
  padding: 5px 10px;
  cursor: pointer;
  flex: none;
}
.wxcfg button:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(197, 164, 104, 0.18));
}
.wxcfg-avatar {
  width: 36px;
  height: 36px;
  border-radius: var(--wx-avatar-round, 50%);
  object-fit: cover;
  border: 1px solid var(--dsw-alias-border-l2, #ccd4e4);
  /* 透明背景用棋盘衬底，方便看出图片本身有没有底色 */
  background-color: var(--wx-avatar-bg, #4d6bfe);
  background-image: linear-gradient(45deg, rgba(255, 255, 255, 0.28) 25%, transparent 25%, transparent 50%, rgba(255, 255, 255, 0.28) 50%, rgba(255, 255, 255, 0.28) 75%, transparent 75%);
  background-size: 8px 8px;
  flex: none;
}
.wxcfg-crop {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: flex-start;
}
.wxcfg-crop-canvas {
  display: block;
  border-radius: var(--wx-avatar-round, 50%);
  background: var(--wx-modal-canvas-bg);
  cursor: grab;
  touch-action: none;
  box-shadow: 0 2px 10px rgba(19, 38, 87, 0.18);
}
.wxcfg-crop-canvas:active {
  cursor: grabbing;
}
.wxcfg-primary {
  background: var(--dsw-alias-button-primary-fill, #4d6bfe);
  color: var(--dsw-alias-label-primary-foreground, #ffffff);
  border-color: transparent;
}
.wxcfg-notice {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-error-primary, #d9534f);
}
.wxcfg-warn {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-state-warning-primary, #b8860b);
}
.wxcfg-hint {
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, #6f7c99);
}
.wxcfg-marker {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 16px;
  background: var(--dsw-alias-bg-layer-2, #f2f4f8);
  border: 1px solid var(--dsw-alias-border-l2, #ccd4e4);
  border-radius: 6px;
  padding: 6px 8px;
  white-space: pre-wrap;
  user-select: all;
}
.wxcfg-rules {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
`;
    }

    // ------------------------------------------------------------------
    // 时间戳装饰层（可选，默认关闭；时间为近似渲染时刻）
    // ------------------------------------------------------------------
    // ── WX-M15 时间戳装饰 ─────────────────────────────────────────────────
    // 显示的是「本地近似渲染时间」，不是服务器给出的消息时间；默认关闭。
    function mountTimestampDecorator() {
      if (typeof MutationObserver === 'undefined') return () => {};
      const KIND_SEL = '[data-chat-flow-kind="user"],[data-chat-flow-kind="steering"],[data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"])';
      const seen = new WeakMap(); // flowItem -> { el, ts }
      const labelOf = (el) => {
        const item = seen.get(el);
        if (!item || item.ts === 0) return null;
        // 与上一个同角色可见消息比较：>5min 或跨天才显示
        let prev = el.previousElementSibling;
        while (prev && !(prev instanceof HTMLElement && prev.matches(KIND_SEL) && prev.offsetParent !== null)) {
          prev = prev.previousElementSibling;
        }
        if (prev) {
          const p = seen.get(prev);
          if (p && p.ts !== 0) {
            const gap = item.ts - p.ts;
            const sameDay = new Date(item.ts).toDateString() === new Date(p.ts).toDateString();
            if (gap < 5 * 60 * 1000 && sameDay) return null;
          }
        }
        const d = new Date(item.ts);
        const pad = (n) => String(n).padStart(2, '0');
        const today = new Date().toDateString();
        if (d.toDateString() === today) return pad(d.getHours()) + ':' + pad(d.getMinutes());
        return d.getMonth() + 1 + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      };
      const ensure = (el) => {
        if (!(el instanceof HTMLElement) || !el.matches(KIND_SEL)) return;
        if (seen.has(el)) return;
        const timeEl = document.createElement('time');
        timeEl.className = 'wx-ts';
        el.appendChild(timeEl);
        const streaming = el.querySelector('[data-streaming]') !== null;
        seen.set(el, { el: timeEl, ts: streaming ? 0 : Date.now() });
      };
      const refresh = () => {
        // 流式结束（data-streaming 消失）才定稿时间
        for (const el of [...document.querySelectorAll(KIND_SEL)]) {
          const item = seen.get(el);
          if (!item) continue;
          if (item.ts === 0 && el.querySelector('[data-streaming]') === null) {
            item.ts = Date.now();
          }
          item.el.textContent = labelOf(el) || '';
        }
      };
      const observer = new MutationObserver((muts) => {
        let touched = false;
        for (const m of muts) {
          for (const node of m.addedNodes) {
            if (node instanceof HTMLElement) {
              if (node.matches(KIND_SEL)) ensure(node);
              else if (node.querySelector) for (const el of node.querySelectorAll(KIND_SEL)) ensure(el);
              touched = true;
            }
          }
        }
        if (touched) refresh();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      refresh();
      const timer = setInterval(refresh, 30000);
      return () => {
        clearInterval(timer);
        observer.disconnect();
        for (const el of [...document.querySelectorAll(KIND_SEL)]) {
          const item = seen.get(el);
          if (item && item.el.parentNode) item.el.parentNode.removeChild(item.el);
        }
      };
    }

    // ------------------------------------------------------------------
    // 通用弹窗层：挂到 body（可用时走 react-dom.createPortal），
    // 只有最上层弹窗响应 Escape，带焦点约束与滚动/焦点恢复。
    // ------------------------------------------------------------------
    // ── WX-M16 通用弹窗层 ─────────────────────────────────────────────────
    // 挂到 body（能用 react-dom.createPortal 就用），不被面板 overflow/transform 裁掉；
    // 层栈决定「Esc 只关最上层」；关闭时还焦点并还原设置页内部滚动位置。
    const modalStack = [];
    let modalSeq = 0;
    function isTopModal(id) {
      return modalStack.length > 0 && modalStack[modalStack.length - 1] === id;
    }
    function activeModalCount() {
      return modalStack.length;
    }
    const FOCUSABLE_SELECTOR = 'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
    function focusablesIn(card) {
      if (!card) return [];
      return [...card.querySelectorAll(FOCUSABLE_SELECTOR)].filter((el) => !el.disabled);
    }
    /** 从某个元素往上找最近的滚动容器（用于弹窗关闭后还原设置页内部滚动位置）。 */
    // 只还原「触发元素所在的那个滚动容器」，不碰页面别处的滚动。
    function scrollableAncestor(el) {
      let node = el && el.parentElement;
      while (node && node !== document.body && node !== document.documentElement) {
        if (node.scrollHeight > node.clientHeight + 1) return node;
        node = node.parentElement;
      }
      return null;
    }

    function ModalShell({ title, onClose, small, body, appearance }) {
      const idRef = useRef(null);
      if (idRef.current === null) idRef.current = 'wxmodal-' + (++modalSeq);
      const id = idRef.current;
      const cardRef = useRef(null);
      const closeRef = useRef(onClose);
      closeRef.current = onClose;
      const [host, setHost] = useState(null);
      // 外观指纹：只有真正变了才重写宿主变量，避免每次渲染都重设一遍
      const appearanceRef = useRef(appearance);
      appearanceRef.current = appearance;
      const APPEARANCE_KEYS = ['avatarSize', 'avatarRoundness', 'avatarBg', 'ringColor', 'theme', 'userAvatar', 'aiAvatar', 'roleAvatar', 'userLetter', 'userBubble', 'aiBubble', 'radius', 'maxWidth', 'mergeAvatars', 'showTimestamps', 'toolAvatars'];
      const appearanceKey = appearance
        ? APPEARANCE_KEYS.map((key) => String(appearance[key])).join('|')
        : '';

      useEffect(() => {
        if (!CAN_PORTAL) return undefined;
        const node = document.createElement('div');
        node.className = 'wxlayer';
        node.setAttribute('data-wx-modal-host', id);
        document.body.appendChild(node);
        setHost(node);
        // 卸载时只摘掉宿主节点：不再 setHost(null)，避免卸载后多余的 setState
        return () => {
          if (node.parentNode) node.parentNode.removeChild(node);
        };
      }, [id]);

      useEffect(() => {
        modalStack.push(id);
        const scrollY = typeof window !== 'undefined' ? window.scrollY : 0;
        const prevFocus = document.activeElement;
        // 触发元素所在的滚动容器（通常是设置页内部滚动区）：关闭时要还原
        const scroller = scrollableAncestor(prevFocus);
        const scrollerTop = scroller ? scroller.scrollTop : 0;
        const onKey = (event) => {
          if (!isTopModal(id)) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closeRef.current();
            return;
          }
          if (event.key === 'Tab') {
            const items = focusablesIn(cardRef.current);
            if (items.length === 0) return;
            const at = items.indexOf(document.activeElement);
            const next = event.shiftKey
              ? (at <= 0 ? items.length - 1 : at - 1)
              : (at === -1 || at === items.length - 1 ? 0 : at + 1);
            event.preventDefault();
            try { items[next].focus({ preventScroll: true }); } catch (_err) { /* 同上 */ }
          }
        };
        document.addEventListener('keydown', onKey, true);
        return () => {
          document.removeEventListener('keydown', onKey, true);
          const at = modalStack.lastIndexOf(id);
          if (at >= 0) modalStack.splice(at, 1);
          // 顺序很重要：先把焦点还给触发元素（浏览器可能为了露出它而滚动），
          // 再恢复滚动位置，否则恢复会被焦点滚动覆盖。
          if (prevFocus && typeof prevFocus.focus === 'function' && prevFocus.isConnected) {
            try { prevFocus.focus({ preventScroll: true }); } catch (_err) { /* 同上 */ }
          }
          if (scroller && scroller.isConnected) {
            // 条件不能是「当前值 != 基准值」：闭合瞬间可能恰好相等，而随后的重排
            // 会触发浏览器滚动锚定再挪一次，所以无条件补两次（一帧 + 一个宏任务，不循环）。
            const restoreScroll = () => {
              if (scroller.isConnected) {
                try { scroller.scrollTop = scrollerTop; } catch (_err) { /* 忽略 */ }
              }
            };
            restoreScroll();
            if (typeof requestAnimationFrame === 'function') {
              try { requestAnimationFrame(restoreScroll); } catch (_err) { /* 忽略 */ }
            }
            try { setTimeout(restoreScroll, 0); } catch (_err) { /* 忽略 */ }
          }
          if (typeof window !== 'undefined' && window.scrollY !== scrollY) {
            try { window.scrollTo(0, scrollY); } catch (_err) { /* 忽略 */ }
          }
        };
      }, [id]);

      // 弹窗在 body 层，脱离了会话作用域：把「编辑目标方案」的外观写到自己身上，
      // 否则会继承到别的方案的头像/大小/圆角/背景/主题。
      useEffect(() => {
        if (!host || !appearance) return undefined;
        applyHostConfig(host, appearance);
        return () => clearAppliedConfig(host);
      }, [host, appearanceKey]);

      // 初始焦点单独一个 effect：portal 宿主是异步挂上的，第一帧时 cardRef 还是 null，
      // 必须等 host 就绪（依赖里带上 host）再聚焦，否则永远聚焦不到对话框。
      useEffect(() => {
        const card = cardRef.current;
        if (!card) return;
        const items = focusablesIn(card);
        const target = items.length > 0 ? items[0] : card;
        try { target.focus({ preventScroll: true }); } catch (_err) { /* 聚焦失败不影响打开 */ }
      }, [host, id]);

      const tree = h('div', { className: 'wxmodal', 'data-wx-modal': id, role: 'presentation' },
        h('div', { className: 'wxmodal-backdrop', 'data-wx-modal-backdrop': '', onClick: () => closeRef.current() }),
        h('div', {
          className: 'wxmodal-card' + (small ? ' wxmodal-card--small' : ''),
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': title,
          tabIndex: -1,
          ref: cardRef,
        },
          h('div', { className: 'wxmodal-head' },
            h('div', { className: 'wxmodal-title' }, title),
            h('button', {
              type: 'button', className: 'wxmodal-close', 'data-wx-modal-close': '', 'aria-label': '关闭',
              onClick: () => closeRef.current(),
            }, '✕')),
          body));
      if (!CAN_PORTAL) return tree;
      return host ? ReactDOM.createPortal(tree, host) : null;
    }

    // ------------------------------------------------------------------
    // 圆形/圆角裁剪器：拖动平移 + 滑块缩放，所见即所得，输出 PNG dataURL
    // 输出始终是完整方形像素，形状交给 CSS，避免切换圆角时出现透明角。
    // ------------------------------------------------------------------
    // ── WX-M17 裁剪器 ─────────────────────────────────────────────────────
    // 导出始终是完整方形像素（形状交给 CSS），所以换圆角不会露透明角；
    // 跨域图片会让 toDataURL 抛错，这里要如实报错而不是静默失败。
    //
    // **预览尺寸与导出分辨率分离**（2.3.2）：
    // - 裁剪 UI 仍按 CROP_SIZE(240 CSSpx) 布局、拖动 offset 也记在 240 坐标系里（不改交互）；
    // - 导出时按「当前 crop 几何」**从原图重画**到高分辨率方形画布（上限 CROP_EXPORT_MAX），
    //   绝不把 240 的预览画布放大冒充高清；
    // - 导出尺寸 = min(上限, 原图有效裁剪像素 min(naturalWidth,naturalHeight)/zoom)，源图小就不上采样；
    // - 若某个尺寸的 PNG data URL 超过单头像预算，按阶梯**重新从原图**降尺寸重画。
    const CROP_SIZE = 240;
    const CROP_EXPORT_MAX = 1024;
    const CROP_EXPORT_MIN = 512;
    // 单个头像 data URL 的字符预算（约 2MiB）：常规照片远小于它；超了才逐级降尺寸。
    const CROP_EXPORT_BUDGET = 2 * 1024 * 1024;
    const CROP_EXPORT_LADDER = [CROP_EXPORT_MAX, 896, 768, 640, CROP_EXPORT_MIN];

    /**
     * 这个已加载的 img 是不是**矢量源**（SVG）？
     * 只看当前加载的 src / currentSrc 字符串，**不做任何跨域探测或凭据请求**：
     * - `data:image/svg+xml` 开头的 data URL（utf8 / 带 charset / base64 都会命中前缀）；
     * - 路径以 `.svg` 结尾的 URL（查询串/锚点先剥掉）。
     * 其余（PNG/JPEG/GIF/WebP…）都按位图处理。
     */
    function isVectorImage(img) {
      if (!img) return false;
      const candidates = [img.currentSrc, img.src];
      for (const raw of candidates) {
        const url = String(raw == null ? '' : raw);
        if (!url) continue;
        if (/^data:image\/svg\+xml/i.test(url)) return true;
        const path = url.split('#')[0].split('?')[0];
        if (/\.svg$/i.test(path)) return true;
      }
      return false;
    }

    function roundRectPath(ctx, size, radius) {
      const r = Math.max(0, Math.min(size / 2, radius));
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(size - r, 0);
      ctx.arcTo(size, 0, size, r, r);
      ctx.lineTo(size, size - r);
      ctx.arcTo(size, size, size - r, size, r);
      ctx.lineTo(r, size);
      ctx.arcTo(0, size, 0, size - r, r);
      ctx.lineTo(0, r);
      ctx.arcTo(0, 0, r, 0, r);
      ctx.closePath();
    }

    function AvatarCropper({ src, title, roundness, onCancel, onApply, onError }) {
      const canvasRef = useRef(null);
      const imgRef = useRef(null);
      const dragRef = useRef(null);
      const [zoom, setZoom] = useState(1);
      const [offset, setOffset] = useState({ x: 0, y: 0 });
      const [ready, setReady] = useState(false);

      /**
       * 当前 zoom 下，方形裁剪区覆盖的**位图**原图像素数（短边）——导出分辨率的上限来源。
       * 例：2048² 图 zoom=1 → 2048；zoom=2 → 1024；100² 图 → 100。
       * **矢量源（SVG）不走这条**：它没有"原生像素"概念，标称 32×32 的 SVG 也能无损画到 1024，
       * 按 naturalWidth 当上限反而会比旧版 240 还糊。
       */
      const sourceCropPixels = useCallback((imgRefValue) => {
        // 每次都读**当前已加载的那个 img**（以及它此刻的 currentSrc/src），不用闭包里缓存的 src
        const img = imgRefValue || imgRef.current;
        if (!img || !img.naturalWidth) return 0;
        if (isVectorImage(img)) return CROP_EXPORT_MAX;   // 矢量：允许画到上限，只受字节预算约束
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        return Math.max(1, Math.floor(side / (zoom || 1)));
      }, [zoom]);


      /**
       * 同一套几何：size 变化时按比例缩放，**offset 也要同比缩放**
       * （offset 记在 CROP_SIZE 坐标系里，导出尺寸不同必须换算，否则内容会偏）。
       */
      const geom = useCallback((size, ox, oy) => {
        const img = imgRef.current;
        const base = Math.max(size / img.naturalWidth, size / img.naturalHeight);
        const scale = base * zoom;
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        const k = size / CROP_SIZE;
        const dx = (ox === undefined ? offset.x : ox) * k;
        const dy = (oy === undefined ? offset.y : oy) * k;
        return { x: (size - w) / 2 + dx, y: (size - h) / 2 + dy, w, h };
      }, [zoom, offset]);

      const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const img = imgRef.current;
        if (!canvas || !img || !img.naturalWidth) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = CROP_SIZE * dpr;
        canvas.height = CROP_SIZE * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
        ctx.clearRect(0, 0, CROP_SIZE, CROP_SIZE);
        const g = geom(CROP_SIZE);
        const radius = CROP_SIZE * ((clampNumber(roundness, 0, 100, AVATAR_ROUNDNESS_DEFAULT) / 2) / 100);
        ctx.save();
        roundRectPath(ctx, CROP_SIZE, radius);
        ctx.clip();
        ctx.drawImage(img, g.x, g.y, g.w, g.h);
        ctx.restore();
        // 形状外压暗
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, CROP_SIZE, CROP_SIZE);
        roundRectPath(ctx, CROP_SIZE, radius);
        ctx.fillStyle = 'rgba(10, 18, 40, 0.5)';
        ctx.fill('evenodd');
        ctx.restore();
        roundRectPath(ctx, CROP_SIZE, radius);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }, [geom, roundness]);

      useEffect(() => {
        const img = document.createElement('img');
        img.decoding = 'async';
        img.onload = () => {
          imgRef.current = img;
          setReady(true);
        };
        img.onerror = () => {
          if (onError) onError('图片加载失败（可能是无效链接或跨域图片），建议用「上传」选本地图片。');
        };
        img.src = src;
      }, [src]);

      useEffect(() => {
        if (ready) draw();
      }, [ready, draw]);

      const onDown = (e) => {
        dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
        try {
          if (e.currentTarget.setPointerCapture && e.pointerId !== undefined) {
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        } catch (_err) {
          /* 指针捕获失败不影响拖动 */
        }
      };
      const onMove = (e) => {
        const d = dragRef.current;
        if (!d) return;
        setOffset({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) });
      };
      const onUp = () => {
        dragRef.current = null;
      };

      const apply = () => {
        const img = imgRef.current;
        if (!img || !img.naturalWidth) return;
        // 从**原图**按当前 crop 几何画到高分辨率输出（不是放大预览画布）。
        // 尺寸阶梯 + 单头像预算：常规图一次成功；高熵图逐级降尺寸，每一步都重新从原图画。
        // 阶梯**从真实 cap 开始**（例如 cap=853 就先试 853，而不是跳到 768），
        // 后面只接比 cap 小的预设档位 → 严格降序、无重复（cap=1024 时不会出现两个 1024）。
        const cap = Math.min(CROP_EXPORT_MAX, sourceCropPixels());
        const ladder = [cap].concat(CROP_EXPORT_LADDER.filter((s) => s < cap));
        let lastUrl = '';
        for (const size of ladder) {
          if (!size || size < 1) continue;
          const out = document.createElement('canvas');
          out.width = size;
          out.height = size;
          const ctx = out.getContext('2d');
          if (!ctx) continue;
          // 高质量平滑：缩小（常见情况）时靠它避免摩尔纹/锯齿
          ctx.imageSmoothingEnabled = true;
          if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
          const g = geom(size);
          // 输出整张方形（不裁圆、不裁圆角）：形状由 CSS 负责，
          // 切换圆角时不会露出透明角，也不会丢像素；alpha 原样保留。
          ctx.drawImage(img, g.x, g.y, g.w, g.h);
          let url = '';
          try {
            url = out.toDataURL('image/png');
          } catch (_err) {
            if (onError) onError('这张图片无法裁剪（跨域图片会被画布拒绝），请用「上传」选本地图片。');
            return;
          }
          lastUrl = url;
          if (url.length <= CROP_EXPORT_BUDGET) break;      // 常规路径：第一个（最大）尺寸就够小
        }
        if (!lastUrl) return;
        onApply(lastUrl);
      };

      return h('div', { className: 'wxcfg-crop' },
        title ? h('div', { className: 'wxcfg-title' }, title) : null,
        h('canvas', {
          ref: canvasRef,
          className: 'wxcfg-crop-canvas',
          style: { width: CROP_SIZE + 'px', height: CROP_SIZE + 'px' },
          onPointerDown: onDown,
          onPointerMove: onMove,
          onPointerUp: onUp,
          onPointerCancel: onUp,
        }),
        h('div', { className: 'wxcfg-row' },
          h('span', { className: 'wxcfg-label' }, '缩放'),
          h('input', {
            type: 'range', min: 1, max: 3, step: 0.01, value: zoom,
            onChange: (e) => setZoom(Number(e.target.value)),
          }),
          h('button', { onClick: () => { setZoom(1); setOffset({ x: 0, y: 0 }); } }, '复位'),
        ),
        h('div', { className: 'wxcfg-row' },
          h('button', { className: 'wxcfg-primary', onClick: apply }, '应用裁剪'),
          h('button', { onClick: onCancel }, '取消'),
          h('span', { className: 'wxcfg-hint' }, '拖动图片调位置，滑块缩放；框内就是头像最终效果（形状跟随头像圆角设置，输出是完整方形）。'),
        ),
      );
    }

    // ------------------------------------------------------------------
    // 头像选择行（缩略图 + URL + 上传 + 裁剪/转静态 + 清除）——配置面板复用
    // ------------------------------------------------------------------
    // ── WX-M18 头像选择行 ─────────────────────────────────────────────────
    // 一行搞定一个头像入口：预览图（点=选文件）/ URL 输入 / 上传 / 裁剪或转静态 / 清除。
    function AvatarField({ label, value, placeholder, preview, isGif, isDisabled,
      onCommit, onCrop, onClear, fileRef, onPickFile }) {
      return h('div', { className: 'wxcfg-row' },
        h('span', { className: 'wxcfg-label' }, label),
        h('img', {
          className: 'wxcfg-avatar',
          'data-wx-gif': isGif ? '1' : undefined,
          src: (value && !isDisabled) ? value : preview,
          alt: '',
          title: isGif ? 'GIF 头像（保留动画）' : '点击选择本地图片',
          style: { cursor: 'pointer', opacity: isDisabled ? 0.35 : 1 },
          onClick: () => { const input = fileRef.current; if (input) input.click(); },
        }),
        h('input', {
          type: 'text',
          placeholder: placeholder || '图片 URL；留空 = 未配置',
          value: isDisabled ? '' : value,
          disabled: !!isDisabled,
          onChange: (e) => onCommit(e.target.value),
        }),
        h('button', { onClick: () => { const input = fileRef.current; if (input) input.click(); } }, '上传'),
        h('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, ref: fileRef, onChange: onPickFile }),
        (!isDisabled && value) ? h('button', {
          title: isGif ? 'GIF 会保留动画；这里会输出一张静态 PNG 版本' : '调整裁剪',
          onClick: () => onCrop(value),
        }, isGif ? '转静态裁剪' : '裁剪') : null,
        (!isDisabled && value) ? h('button', { onClick: onClear }, '清除') : null,
      );
    }

    const MARKER_CONVENTION =
      '[//]: # (wx-roleplay:on)\n' +
      '[//]: # (wx-roleplay:off)';

    const GIF_HINT = 'GIF 会原样保存并保留动画（以圆形/圆角方形遮罩显示），不经过静态裁剪；需要静态版请点「转静态裁剪」。';

    /**
     * 上传读取的取消/失效令牌。
     * 用途：读图是异步的（FileReader + 二次 GIF 头识别），期间用户可能取消、关弹窗、
     * 切会话或重新选图。所有回调必须先用 isCurrent(token) 校验，晚到的结果一律丢弃，
     * 不允许重新弹窗、更不允许写入配置。begin() 会让之前所有在飞的读取失效（多次上传只有最后一次有效）。
     */
    // ── WX-M19 上传读取与取消令牌 ─────────────────────────────────────────
    function createUploadGuard() {
      let current = 0;
      let reader = null;
      return {
        begin() {
          current += 1;
          reader = null;
          return current;
        },
        attach(next) {
          reader = next;
        },
        cancel() {
          current += 1;
          const pending = reader;
          reader = null;
          if (pending && typeof pending.abort === 'function') {
            try { pending.abort(); } catch (_err) { /* abort 失败不影响取消语义 */ }
          }
        },
        isCurrent(token) {
          return token === current;
        },
        get token() {
          return current;
        },
        get pending() {
          return !!reader;
        },
      };
    }

    /**
     * 读一个头像文件：GIF 直接给原始数据（MIME 规范化），静态图交给调用方决定是否进裁剪。
     * @param handlers - { onGif(dataUrl), onStatic(dataUrl, title), onError(message) }
     * @param guard    - createUploadGuard() 的实例；配合 token 丢弃晚到的结果
     * @param token    - guard.begin() 的返回值
     * 调用方（配置面板 / 角色设置弹窗）负责在取消、关弹窗、切会话、卸载时 guard.cancel()。
     * 读到的 GIF 直接交给 onGif（原样保留动画）；静态图交给 onStatic 由调用方决定是否进裁剪。
     */
    function readAvatarFile(file, title, handlers, guard, token) {
      if (!file) return;
      const alive = () => !guard || guard.isCurrent(token);
      let reader;
      try {
        reader = new FileReader();
      } catch (_err) {
        if (alive()) handlers.onError('当前环境不支持读取本地文件。');
        return;
      }
      if (guard && guard.attach) guard.attach(reader);
      reader.onload = () => {
        if (!alive()) return;
        const dataUrl = String(reader.result);
        // 二次异步（GIF 头识别）之后再校验一次：这中间用户可能已经取消/重选
        fileLooksLikeGif(file, (isGif) => {
          if (!alive()) return;
          if (isGif) handlers.onGif(normalizeGifDataUrl(dataUrl));
          else handlers.onStatic(dataUrl, title);
        });
      };
      reader.onerror = () => {
        if (!alive()) return;
        handlers.onError('读取本地文件失败，请重试。');
      };
      reader.onabort = () => { /* 主动取消，不算失败 */ };
      try {
        reader.readAsDataURL(file);
      } catch (_err) {
        if (alive()) handlers.onError('读取本地文件失败，请重试。');
      }
    }

    /** 当前窗口宽度（用于说明窄窗口下头像尺寸会被封顶）。 */
    // ── WX-M20 外观预览弹窗 ───────────────────────────────────────────────
    // 用当前真实头像（含 GIF）、圆角、背景、描边画样例，并就地调大小/圆角；
    // 同时说明「配置值 vs 窄窗口实际显示值」，避免以为拉了没反应。
    function useWindowWidth() {
      const [width, setWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1280));
      useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const onResize = () => setWidth(window.innerWidth);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
      }, []);
      return width;
    }
    /** 窄窗口下头像的真实显示尺寸（CSS media query 的同一规则）。 */
    // 必须和 buildCss 里 @media (width <= 480px) 的封顶值保持一致。
    function avatarDisplaySize(cfg, viewportWidth) {
      const size = avatarSizeOf(cfg);
      return viewportWidth <= 480 ? Math.min(size, 32) : size;
    }

    /** 外观预览里的一行样例（气泡 + 头像）。 */
    function PreviewRow({ side, src, letter, text, size }) {
      const avatar = h('div', {
        className: 'wxprev-avatar',
        style: { '--wx-prev-img': src ? 'url("' + src + '")' : 'none', '--wx-prev-size': size + 'px' },
      }, src ? null : (letter || ''));
      const bubble = h('div', { className: 'wxprev-bubble' }, text);
      return h('div', { className: 'wxprev-row' + (side === 'user' ? ' wxprev-row--user' : '') },
        side === 'user' ? bubble : avatar,
        side === 'user' ? avatar : bubble);
    }

    /** 大小 / 外观预览弹窗：按当前真实头像、圆角、背景、描边显示样例，并可就地调大小与圆角。 */
    function AvatarAppearanceModal({ cfg, onCommit, onClose }) {
      const width = useWindowWidth();
      const [error, setError] = useState('');
      // 打开时的外观快照：只包含本弹窗能编辑的 4 项，撤销时也只还原这 4 项
      const snapshotRef = useRef(null);
      if (snapshotRef.current === null) {
        snapshotRef.current = {
          avatarSize: cfg.avatarSize,
          avatarRoundness: cfg.avatarRoundness,
          avatarBg: cfg.avatarBg,
          ringColor: cfg.ringColor,
        };
      }
      const size = avatarSizeOf(cfg);
      const shown = avatarDisplaySize(cfg, width);
      const capped = shown !== size;
      const aiSrc = cfg.aiAvatar || DS_LOGO_URL;
      const roleSrc = cfg.roleAvatar || '';
      // 保存失败必须留在当前这个弹窗里；成功才清掉上一次的错误
      const commit = (patch) => {
        const result = onCommit(patch);
        const notice = resultNotice(result);
        setError(notice.failed ? notice.text : '');
        return result;
      };
      const restoreOpened = () => {
        const snapshot = snapshotRef.current;
        const result = commit({ ...snapshot });
        const ok = !result || result.ok !== false;
        return ok;
      };
      const body = h('div', null,
        h('div', { className: 'wxprev' },
          h(PreviewRow, { side: 'user', src: cfg.userAvatar, letter: cfg.userLetter || '我', text: '头像调好了吗？', size }),
          h(PreviewRow, { side: 'ai', src: aiSrc, letter: '', text: '这是当前大小。', size }),
          roleSrc ? h(PreviewRow, { side: 'ai', src: roleSrc, letter: '', text: '这是角色头像。', size }) : null,
        ),
        h('div', { className: 'wxmodal-row' },
          h('span', { className: 'wxmodal-label' }, '大小 ' + size + 'px'),
          h('input', {
            type: 'range', min: AVATAR_SIZE_MIN, max: AVATAR_SIZE_MAX, step: 1, value: size,
            'data-wx-preview-size': '',
            onChange: (e) => commit({ avatarSize: Number(e.target.value) }),
          }),
          h('button', { type: 'button', onClick: () => commit({ avatarSize: AVATAR_SIZE_DEFAULT }) }, '36px'),
          h('button', { type: 'button', onClick: () => commit({ avatarSize: AVATAR_SIZE_MAX }) }, '96px'),
        ),
        h('div', { className: 'wxmodal-row' },
          h('span', { className: 'wxmodal-label' }, '圆角 ' + cfg.avatarRoundness + '%'),
          h('input', {
            type: 'range', min: 0, max: 100, step: 1, value: cfg.avatarRoundness,
            'data-wx-preview-round': '',
            onChange: (e) => commit({ avatarRoundness: Number(e.target.value) }),
          }),
        ),
        h('div', { className: 'wxmodal-row' },
          h('span', { className: 'wxmodal-label' }, '背景'),
          h('input', {
            type: 'color', 'data-wx-preview-bg': '',
            value: avatarBgOf(cfg) === AVATAR_BG_TRANSPARENT ? AVATAR_BG_DEFAULT : avatarBgOf(cfg),
            onChange: (e) => commit({ avatarBg: e.target.value }),
          }),
          h('button', { type: 'button', 'data-wx-preview-bg-default': '', onClick: () => commit({ avatarBg: '' }) }, '默认蓝'),
          h('button', { type: 'button', 'data-wx-preview-bg-transparent': '', onClick: () => commit({ avatarBg: AVATAR_BG_TRANSPARENT }) }, '透明'),
        ),
        h('div', { className: 'wxmodal-row' },
          h('span', { className: 'wxmodal-label' }, '描边'),
          h('input', {
            type: 'color', 'data-wx-preview-ring': '',
            value: cfg.ringColor || '#4d6bfe',
            onChange: (e) => commit({ ringColor: e.target.value }),
          }),
          h('button', { type: 'button', 'data-wx-preview-ring-none': '', onClick: () => commit({ ringColor: '' }) }, '无描边'),
        ),
        h('div', { className: 'wxprev-facts', 'data-wx-preview-facts': '' },
          '配置值：' + size + 'px ｜ 当前窗口（' + width + 'px 宽）实际显示：' + shown + 'px'
          + (capped ? '（窗口 ≤480px 时头像封顶 32px，给气泡留空间）' : '（窗口缩窄到 480px 以下时会自动封顶到 32px）')),
        error ? h('div', { className: 'wxmodal-notice', 'data-wx-modal-error': '' }, error) : null,
        h('div', { className: 'wxmodal-actions' },
          h('button', {
            type: 'button', 'data-wx-preview-restore': '', onClick: restoreOpened,
          }, '恢复到打开时'),
          h('span', { className: 'wxmodal-hint' }, '撤销本次在这个弹窗里对大小/圆角/背景/描边做的调整；关闭弹窗会保留改动。')),
        h('div', { className: 'wxmodal-hint' },
          '「恢复到打开时」只还原这 4 项外观，不会动头像图片、工具规则、角色开关或方案绑定；'
          + '想全部回到出厂值请到配置面板点「把当前方案恢复默认」。'),
        h('div', { className: 'wxmodal-hint' }, '样例用的是当前真实头像（含 GIF）、圆角、背景与描边；改动即时生效并与其他窗口同步。'),
      );
      return h(ModalShell, { title: '预览头像大小与外观', onClose, appearance: cfg, body });
    }

    // ── WX-M21 角色头像设置弹窗 ───────────────────────────────────────────
    // 只控制头像：不猜角色、不改提示词。模式按钮的显示与写入都用同一个「目标轮」。
    const ROLE_MODE_LABELS = [
      ['auto', '自动', '跟随助手回复里的标记（原生隐藏写法）'],
      ['on', '开启', '从当前未结束轮起强制使用角色头像'],
      ['off', '关闭', '从当前未结束轮起停用角色头像'],
    ];

    /**
     * 角色头像设置弹窗：模式 + 角色头像上传/裁剪/清除 + 状态说明。
     * 只控制头像，不猜角色、不改提示词。
     */
    function RoleplaySettingsModal({ sessionId, infoStore, presetId, onClose }) {
      // 角色图片取本会话**生效方案**的（显式覆盖 > 预设绑定 > 默认）
      const cfg = useSessionConfig(sessionId, presetId);
      const schemeId = resolveScheme(sessionId, presetId).schemeId;
      const [state, setState] = useState(() => roleStateOf(sessionId));
      const [info, setInfo] = useState(() => infoStore.get(sessionId));
      const [notice, setNotice] = useState('');
      const [warn, setWarn] = useState('');
      const [copied, setCopied] = useState(false);
      const [cropTask, setCropTask] = useState(null);
      const fileRef = useRef(null);
      const uploadGuardRef = useRef(null);
      if (!uploadGuardRef.current) uploadGuardRef.current = createUploadGuard();
      const uploadGuard = uploadGuardRef.current;
      // 生效方案一旦变化（手动切方案 / 预设绑定被改 / 方案被删），在飞的文件读取立刻作废：
      // 否则晚到的 onload 会把图片写到「已经不是当前方案」的那一份上。
      // 注意必须放在 uploadGuard 声明之后（否则会读未初始化的绑定）。
      useEffect(() => () => uploadGuard.cancel(), [schemeId, uploadGuard]);
      /** 关裁剪子层：让在飞的读取失效，晚到的结果不许再弹窗 */
      const closeCropTask = useCallback(() => {
        uploadGuard.cancel();
        setCropTask(null);
      }, [uploadGuard]);

      useEffect(() => {
        setState(roleStateOf(sessionId));
        setInfo(infoStore.get(sessionId));
        const offMode = onRoleStateChange(() => setState(roleStateOf(sessionId)));
        const offInfo = infoStore.subscribe(sessionId, setInfo);
        return () => { offMode(); offInfo(); };
      }, [infoStore, sessionId]);

      // 切会话：不留 reading/crop 子层，也不让旧会话的在飞读取写进来
      useEffect(() => {
        uploadGuard.cancel();
        setCropTask(null);
      }, [sessionId, uploadGuard]);

      // 整个设置弹窗卸载：连在飞的读取一起作废
      useEffect(() => () => uploadGuard.cancel(), [uploadGuard]);

      const commit = useCallback((patch) => {
        const result = commitSchemeConfig(schemeId, patch);
        const shown = resultNotice(result);
        setNotice(shown.failed ? shown.text : '');
        return result;
      }, [schemeId]);

      const targetTurn = roleplayTargetTurn(info);
      const mode = modeForTurn(state, targetTurn);
      const running = !!(info && info.openTurn !== null && info.roleOn);
      const hasAvatar = !!cfg.roleAvatar;

      const statusText = mode === 'off'
        ? '已关闭：继续用普通头像，历史消息保持原样'
        : mode === 'on'
          ? (info && info.openTurn !== null
            ? '已开启，本轮即时生效' + (running ? '（工具运行期间临时显示工具头像）' : '')
            : '已开启，下条回复生效；历史消息保持原样')
          : (cfg.roleMarkerEnabled === false
            ? '自动标记识别已关闭：助手回复里的标记不会被解析。请在下面直接选「开启」/「关闭」，或到配置面板打开「自动标记识别」。'
            : '自动：跟随助手回复里的标记（下面这段可直接复制给鱼鱼）');

      const pickFile = (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        setNotice('');
        setWarn('');
        setCropTask(null);
        const token = uploadGuard.begin();
        setCropTask({ stage: 'reading', title: '裁剪角色头像' });
        readAvatarFile(file, '裁剪角色头像', {
          onGif: (dataUrl) => {
            const applied = commit({ roleAvatar: dataUrl });
            setCropTask(null);
            // 提交前被拒绝时不能同时说「已应用」；只有写盘失败才说「当前窗口有效」
            const shown = resultNotice(applied, '已应用 GIF 角色头像（保留动画）。');
            setWarn(shown.text);
          },
          onStatic: (dataUrl) => setCropTask({ stage: 'ready', src: dataUrl, title: '裁剪角色头像' }),
          onError: (message) => setCropTask({ stage: 'error', title: '裁剪角色头像', message }),
        }, uploadGuard, token);
      };
      const copyMarker = () => {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(MARKER_CONVENTION);
          }
        } catch (_err) { /* 复制失败不阻断 */ }
        setCopied(true);
      };

      const body = h('div', null,
        h('div', { className: 'wxmodal-row' },
          h('span', { className: 'wxmodal-label' }, '角色头像'),
          h('span', { className: 'wxrp-group', 'data-wx-role-modes': '' }, ...ROLE_MODE_LABELS.map(([value, label, hint]) =>
            h('button', {
              key: value,
              type: 'button',
              className: 'wxrp-btn',
              'aria-pressed': mode === value ? 'true' : 'false',
              title: hint,
              onClick: () => {
                // 模式按钮以前直接丢弃返回值：写失败时用户以为已经保存了，必须显式反馈
                const result = setRoleModeFrom(sessionId, value, roleplayTargetTurn(info));
                const shown = resultNotice(result);
                setNotice(shown.failed ? shown.text : '');
              },
            }, label))),
        ),
        h('div', { className: 'wxmodal-hint', 'data-wx-role-status': '' }, statusText),
        hasAvatar ? null : h('div', { className: 'wxmodal-warn', 'data-wx-role-noavatar': '' },
          '尚未设置角色头像，仍显示默认头像 —— 在下面「角色图片」里上传一张即可。'),
        h(AvatarField, {
          label: '角色图片',
          value: cfg.roleAvatar,
          preview: DS_LOGO_URL,
          isGif: isGifSource(cfg.roleAvatar),
          placeholder: '留空 = 角色模式沿用普通头像逻辑',
          onCommit: (v) => commit({ roleAvatar: v }),
          onCrop: (v) => setCropTask({ stage: 'ready', src: v, title: '裁剪角色头像' }),
          onClear: () => commit({ roleAvatar: '' }),
          fileRef,
          onPickFile: pickFile,
        }),
        mode === 'auto' && cfg.roleMarkerEnabled !== false
          ? h('div', null,
              h('div', { className: 'wxmodal-hint' }, '可复制的标记约定（整行、只认助手正文；原生 Markdown 会把它隐藏）：'),
              h('div', { className: 'wxcfg-marker' }, MARKER_CONVENTION),
              h('div', { className: 'wxmodal-actions' },
                h('button', { type: 'button', onClick: copyMarker }, copied ? '已复制' : '复制标记约定')))
          : null,
        h('div', { className: 'wxmodal-hint' }, '此开关只控制头像；角色设定请在聊天中告诉鱼鱼（插件不会替你改提示词，也不猜角色）。'),
        notice ? h('div', { className: 'wxmodal-notice', 'data-wx-role-notice': '' }, notice) : null,
        warn ? h('div', { className: 'wxmodal-warn', 'data-wx-role-warn': '' }, warn) : null,
        h('div', { className: 'wxmodal-actions' },
          h('button', { type: 'button', className: 'wxmodal-primary', onClick: onClose }, '完成')),
      );

      return h('div', null,
        h(ModalShell, { title: '角色头像设置', onClose, small: true, body, appearance: cfg }),
        cropTask ? h(ModalShell, {
          title: cropTask.title || '裁剪头像',
          onClose: closeCropTask,
          appearance: cfg,
          body: cropTask.stage === 'reading'
            ? h('div', { className: 'wxmodal-hint', 'data-wx-crop-reading': '' }, '正在读取图片…')
            : cropTask.stage === 'error'
              ? h('div', null,
                  h('div', { className: 'wxmodal-notice', 'data-wx-crop-error': '' }, cropTask.message),
                  h('div', { className: 'wxmodal-actions' }, h('button', { type: 'button', onClick: closeCropTask }, '关闭')))
              : h('div', null,
                  // 保存失败 / 读图解码失败 / CORS 失败都显示在这个最上层弹窗里
                  cropTask.error ? h('div', { className: 'wxmodal-notice', 'data-wx-crop-error': '' }, cropTask.error) : null,
                  h(AvatarCropper, {
                    src: cropTask.src,
                    title: '',
                    roundness: cfg.avatarRoundness,
                    onCancel: closeCropTask,
                    onError: (msg) => {
                      setCropTask((prev) => (prev ? { ...prev, error: msg } : prev));
                      setNotice(msg);
                    },
                    onApply: (url) => {
                      const result = commit({ roleAvatar: url });
                      if (!result || result.ok !== false) {
                        setCropTask(null);
                        setNotice('');
                      } else {
                        // 提交前被拒绝 ≠ 已生效：文案必须跟着 applied 走
                        setCropTask({ ...cropTask, error: resultNotice(result).text });
                      }
                    },
                  })),
        }) : null,
      );
    }

    // 裁剪弹窗体：集中处理「读取中 / 读取失败 / 可裁剪」三态，以及写失败的红字（留在本层）。
    /** 裁剪弹窗体：读取中 / 读取失败 / 可裁剪三种状态。 */
    function cropModalBody(task, helpers) {
      if (task.stage === 'reading') {
        return h('div', { className: 'wxmodal-hint', 'data-wx-crop-reading': '' }, '正在读取图片…');
      }
      if (task.stage === 'error') {
        return h('div', null,
          h('div', { className: 'wxmodal-notice', 'data-wx-crop-error': '' }, task.message || '读取失败'),
          h('div', { className: 'wxmodal-actions' }, h('button', { type: 'button', onClick: helpers.onClose }, '关闭')));
      }
      return h('div', null,
        task.error ? h('div', { className: 'wxmodal-notice', 'data-wx-crop-error': '' }, task.error) : null,
        h(AvatarCropper, {
          src: task.src,
          title: '',
          roundness: task.roundness,
          onCancel: helpers.onClose,
          onError: helpers.onError,
          onApply: helpers.onApply,
        }));
    }

    // ------------------------------------------------------------------
    // 配置面板（渲染在插件管理器 Bundle 页面）
    // ------------------------------------------------------------------
    // ── WX-M22 配置面板 ───────────────────────────────────────────────────
    // 渲染在插件详情页；所有写操作走 update()/commitConfig，失败时在这里和弹窗里显示红字。
    // 上传相关状态（在飞的读取、裁剪任务）都在组件内，卸载时随组件一起作废。
    function ConfigPanel() {
      // 编辑目标：「正在编辑：方案」选择器决定；所有写操作都固定到当时的这个方案
      const editScheme = useEditingScheme();
      const globalCfg = useConfigValue();
      const [schemeVersion, setSchemeVersion] = useState(0);
      useEffect(() => onSchemeChange(() => setSchemeVersion((value) => value + 1)), []);
      const [tab, setTab] = useState('avatar');
      const [cfg, setCfg] = useState(() => schemeConfigOf(editScheme));
      const [crop, setCrop] = useState(null);
      const [appearance, setAppearance] = useState(null);
      const [notice, setNotice] = useState('');
      const [warn, setWarn] = useState('');
      const [ruleDraft, setRuleDraft] = useState('');
      // 头像历史落盘失败时的**一次**诚实提示（失败不当成已保存，也不阻塞消息）
      const [historyNotice, setHistoryNotice] = useState(() => avatarHistory.notice());
      useEffect(() => avatarHistory.subscribe((message) => setHistoryNotice(message || '')), []);
      const [schemeDraft, setSchemeDraft] = useState('');
      // 智能体预设名单（只读）：状态 + 行 + 每个预设当前绑定的方案
      const [presetTick, setPresetTick] = useState(0);
      useEffect(() => onPresetChange(() => setPresetTick((value) => value + 1)), []);
      const presetState = useMemo(() => presetListSnapshot(), [presetTick]);
      const presetRows = presetState.presets;
      const presetStatus = presetState.status;
      const presetError = presetState.error;
      const presetBindings = useMemo(() => presetBindingsSnapshot(), [presetTick, schemeVersion]);
      // 名单里没有、但已经被绑定过的预设也要出现（服务缺失/名单失败时仍可查看与取消）
      const presetExtraIds = Object.keys(presetBindings).filter((id) => !presetRows.some((row) => row.id === id));
      const presetDisplay = presetRows.concat(presetExtraIds.map((id) => ({ id, name: id })));
      const fileRef = useRef(null);
      const aiFileRef = useRef(null);
      const roleFileRef = useRef(null);
      const categoryFileRefs = useRef({});
      const ruleFileRefs = useRef([]);
      const schemeFileRef = useRef(null);
      const uploadGuardRef = useRef(null);
      if (!uploadGuardRef.current) uploadGuardRef.current = createUploadGuard();
      const uploadGuard = uploadGuardRef.current;
      // 取消读取的公共入口：关弹窗 / 点取消 / Escape / 点遮罩 / 卸载 / 重新选图都走它
      const closeCrop = useCallback(() => {
        uploadGuard.cancel();
        setCrop(null);
      }, [uploadGuard]);

      // 当前编辑目标的配置（默认方案 = config-v1；具名方案 = 方案库里的那一份）
      useEffect(() => {
        setCfg(schemeConfigOf(editScheme));
      }, [editScheme, globalCfg, schemeVersion]);

      const update = useCallback((patch) => {
        const target = editScheme;
        if (target !== DEFAULT_SCHEME_ID && !getScheme(target)) {
          const gone = rejectedResult('这个方案已经被删除了');
          setNotice(resultNotice(gone).text);
          return gone;
        }
        const result = commitSchemeConfig(target, patch);
        const shown = resultNotice(result);
        setNotice(shown.failed ? shown.text : '');
        return result;
      }, [editScheme]);

      /**
       * 延迟回调（读图 / GIF 识别 / 裁剪确认）专用：如果编辑目标已经被切走或方案已被删，
       * 就丢弃这次结果，绝不写到另一个方案上。
       */
      const updateFromTask = useCallback((targetScheme, patch) => {
        if (targetScheme !== editingSchemeId()) {
          setNotice('编辑目标已经切换，这次改动没有保存（请回到当前正在编辑的方案重试）。');
          return { ok: false, error: '编辑目标已切换' };
        }
        if (targetScheme !== DEFAULT_SCHEME_ID && !getScheme(targetScheme)) {
          setNotice('这个方案已经被删除了，这次改动没有保存。');
          return { ok: false, error: '方案不存在' };
        }
        return update(patch);
      }, [update]);

      useEffect(() => onStorageError((info) => {
        // 读盘失败与写盘失败要分开说，别让用户以为是保存问题
        setNotice(info && info.scope === 'read'
          ? '读取本地配置失败（' + info.message + '）：当前显示的是默认值，可能是浏览器存储被禁用。'
          : '保存到 localStorage 失败（' + info.message + '）：本次修改在当前窗口有效，但刷新后会丢失。');
      }), []);
      // 配置面板卸载 / 编辑目标切换：让在飞的读取失效，晚到的 onload 不再写配置
      useEffect(() => () => uploadGuard.cancel(), [uploadGuard, editScheme]);

      /** 打开裁剪弹窗（固定居中、body 层，不受面板滚动位置影响）。 */
      const openCrop = useCallback((src, title, apply, extra) => {
        uploadGuard.cancel();   // 在飞的读取不许再抢弹窗
        setNotice('');
        setWarn('');
        const roundness = (extra && extra.roundness) || schemeConfigOf(editScheme).avatarRoundness;
        setCrop({ stage: 'ready', src, title, onApply: apply, roundness });
      }, [uploadGuard, editScheme]);

      const applyGif = useCallback((dataUrl, apply) => {
        // 结果要如实说：提交前被拒绝时**不能**同时说「已应用」；只有写盘失败才说「当前窗口有效」
        const result = apply(dataUrl);
        const shown = resultNotice(result, '已应用 GIF 原图（保留动画，不走静态裁剪）。' + GIF_HINT);
        setWarn(shown.text);
        if (shown.failed) setNotice(shown.text);
      }, []);

      const readFile = useCallback((file, title, apply) => {
        if (!file) return;
        setWarn('');
        // 先开弹窗给出「正在读取」反馈，避免重复上传
        const token = uploadGuard.begin();
        setCrop({ stage: 'reading', title });
        readAvatarFile(file, title, {
          onGif: (dataUrl) => { setCrop(null); applyGif(dataUrl, apply); },
          onStatic: (dataUrl, taskTitle) => setCrop({
            stage: 'ready',
            src: dataUrl,
            title: taskTitle,
            onApply: apply,
            roundness: schemeConfigOf(editingSchemeId()).avatarRoundness,
          }),
          onError: (message) => setCrop({ stage: 'error', title, message }),
        }, uploadGuard, token);
      }, [applyGif, uploadGuard]);

      const pickImage = (title, apply) => (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        readFile(file, title, apply);
      };

      /** 把「当前编辑目标」绑进延迟回调：目标被切走/方案被删时丢弃这次结果。 */
      const bindTarget = (makePatch) => {
        const targetScheme = editScheme;
        return (value) => updateFromTask(targetScheme, makePatch(value));
      };

      const categoryRow = (key, label) => {
        const ref = categoryFileRefs.current[key] || (categoryFileRefs.current[key] = { current: null });
        const patchOf = (v) => ({ toolCategoryAvatars: { ...cfg.toolCategoryAvatars, [key]: v } });
        const commit = (v) => update(patchOf(v));
        const commitLater = bindTarget(patchOf);
        const value = cfg.toolCategoryAvatars[key] || '';
        return h(AvatarField, {
          key,
          label,
          value,
          preview: DS_LOGO_URL,
          isGif: isGifSource(value),
          isDisabled: !cfg.toolAvatars,
          placeholder: cfg.toolAvatars ? '未配置（留空 = 本类不加头像）' : '工具头像已关闭',
          onCommit: commit,
          onCrop: (v) => openCrop(v, '裁剪「' + label + '」头像', commitLater),
          onClear: () => commit(''),
          fileRef: ref,
          onPickFile: pickImage('裁剪「' + label + '」头像', commitLater),
        });
      };

      const commitRules = (rules) => update({ toolRules: rules });
      const addRule = () => {
        const name = ruleDraft.trim();
        if (!name) return;
        if (cfg.toolRules.some((r) => r.name.trim().toLowerCase() === name.toLowerCase())) {
          setNotice('已存在同名的工具名规则：' + name);
          return;
        }
        setNotice('');
        commitRules([...cfg.toolRules, { name, avatar: '' }]);
        setRuleDraft('');
      };
      const patchRule = (index, patch) => {
        const rules = cfg.toolRules.map((r, i) => (i === index ? { ...r, ...patch } : r));
        commitRules(rules);
      };
      const removeRule = (index) => {
        commitRules(cfg.toolRules.filter((_r, i) => i !== index));
      };

      const reset = useCallback(() => update({
        ...DEFAULTS,
        toolCategoryAvatars: { ...DEFAULT_CATEGORY_AVATARS },
        toolRules: [],
      }), [update]);

      const row = (label, ...controls) =>
        h('div', { className: 'wxcfg-row' }, h('span', { className: 'wxcfg-label' }, label), ...controls);
      const section = (title, ...children) =>
        h('div', { className: 'wxcfg-section' }, h('div', { className: 'wxcfg-title' }, title), ...children);

      const roundnessHint = cfg.avatarRoundness === 0 ? '方形' : cfg.avatarRoundness === 100 ? '圆形' : '圆角方形';

      /** 页签容器：非当前页签用 hidden 隐藏（字段仍在 DOM 里，切回来立刻可用）。 */
      const panel = (id, ...children) =>
        h('div', { className: 'wxcfg-panel', 'data-wx-panel': id, hidden: tab !== id }, ...children);
      const tabs = [
        ['avatar', '头像'],
        ['look', '聊天外观'],
        ['tools', '工具规则'],
        ['schemes', '头像方案'],
      ];
      const schemeList = listSchemes();
      const editingName = (schemeList.find((item) => item.id === editScheme) || schemeList[0]).name;

      const downloadJson = (filename, payload) => {
        try {
          const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          // 释放对象 URL，避免长期占用内存
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          return true;
        } catch (_err) {
          return false;
        }
      };
      const schemeAction = (fn, okText) => () => {
        const shown = resultNotice(fn(), okText || '已保存。');
        setNotice(shown.text);
        setSchemeDraft('');
      };
      const onSchemeImport = async (event) => {
        const file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (!file) return;
        let text = '';
        try {
          text = await file.text();
        } catch (_err) {
          setNotice('读取这个文件失败了，请重试。');
          return;
        }
        const result = importScheme(text);
        if (!result.ok) { setNotice(resultNotice(result).text); return; }
        setEditingScheme(result.id);
        setNotice('已导入方案「' + result.name + '」（作为新方案，原有的都没变）。');
      };

      const panelRef = useRef(null);
      // 面板自己的预览图（.wxcfg-avatar）读的是同一条 CSS 变量链：
      // 把「正在编辑的方案」写到面板根节点上，预览才会显示你正在改的那一份，而不是默认方案。
      useEffect(() => {
        const node = panelRef.current;
        if (!node) return undefined;
        applyHostConfig(node, cfg);
        return () => clearScopeConfig(node);
      }, [cfg]);

      return h('div', { className: 'wxcfg', ref: panelRef },
        notice ? h('div', { className: 'wxcfg-notice' }, notice) : null,
        warn ? h('div', { className: 'wxcfg-warn' }, warn) : null,
        crop
          ? h(ModalShell, {
              title: crop.title || '裁剪头像',
              onClose: closeCrop,
              appearance: cfg,
              body: cropModalBody(crop, {
                onClose: closeCrop,
                // 读图/解码/CORS 失败：显示在当前最上层弹窗里（面板也留一份）
                onError: (msg) => {
                  setCrop((prev) => (prev ? { ...prev, error: msg } : prev));
                  setNotice(msg);
                },
                onApply: (url) => {
                  // 写失败不能吞：保留弹窗并把它自己的红字提示留在弹窗里（面板提示同时给一份）
                  const result = crop.onApply(url);
                  const ok = !result || result.ok !== false;
                  if (ok) {
                    setCrop(null);
                    setNotice('');
                  } else {
                    const message = resultNotice(result).text;
                    setCrop({ ...crop, error: message });
                    setNotice(message);
                  }
                },
              }),
            })
          : null,
        appearance
          ? h(AvatarAppearanceModal, {
              cfg,
              onCommit: (patch) => updateFromTask(appearance.schemeId, patch),
              onClose: () => setAppearance(null),
            })
          : null,
        // ── 编辑目标 + 页签（先见常用项；工具名高级规则在「工具规则」页里折叠） ──
        h('div', { className: 'wxcfg-schemebar' },
          h('span', { className: 'wxcfg-label' }, '正在编辑'),
          h('select', {
            'data-wx-edit-scheme': '',
            value: editScheme,
            onChange: (e) => setEditingScheme(e.target.value),
          }, ...schemeList.map((item) => h('option', { key: item.id, value: item.id }, item.name))),
          h('span', { className: 'wxcfg-hint', 'data-wx-edit-hint': '' },
            editScheme === DEFAULT_SCHEME_ID
              ? '默认方案：既没有临时覆盖、预设也未绑定的会话都跟随这里（等同于旧版全局设置）。'
              : '自建方案「' + editingName + '」：只有选择了它的会话会跟着变。'),
        ),
        h('div', { className: 'wxcfg-tabs', role: 'tablist', 'data-wx-tabs': '' },
          ...tabs.map(([id, label]) => h('button', {
            key: id,
            type: 'button',
            role: 'tab',
            className: 'wxcfg-tab',
            'data-wx-tab': id,
            'aria-selected': tab === id ? 'true' : 'false',
            onClick: () => setTab(id),
          }, label))),
        panel('avatar', section('头像', ...[
          // 每轮头像历史说明（2.4.0）：默认按轮保留，不需要开关
          h('div', { className: 'wxcfg-hint', 'data-wx-avatar-history-hint': '' },
            '头像图片、字母和规则的修改从下一轮开始生效，历史轮次保留当时的头像；大小、圆角、背景、描边、气泡和主题仍然即时生效。'),
          historyNotice ? h('div', { className: 'wxcfg-warn', 'data-wx-avatar-history-warn': '' }, historyNotice) : null,
          row('用户头像', ...[
            h('img', {
              className: 'wxcfg-avatar',
              'data-wx-gif': isGifSource(cfg.userAvatar) ? '1' : undefined,
              src: cfg.userAvatar || undefined,
              alt: '',
              title: isGifSource(cfg.userAvatar) ? 'GIF 头像（保留动画）' : '点击选择本地图片',
              style: { cursor: 'pointer' },
              onClick: () => fileRef.current && fileRef.current.click(),
            }),
            h('input', {
              type: 'text',
              placeholder: '头像 URL（留空 = 字母头像）',
              value: cfg.userAvatar,
              onChange: (e) => update({ userAvatar: e.target.value }),
            }),
            h('button', { onClick: () => fileRef.current && fileRef.current.click() }, '上传'),
            h('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, ref: fileRef, onChange: pickImage('裁剪用户头像', bindTarget((v) => ({ userAvatar: v }))) }),
            cfg.userAvatar ? h('button', {
              title: isGifSource(cfg.userAvatar) ? 'GIF 会保留动画；这里会输出一张静态 PNG 版本' : '调整裁剪',
              onClick: () => openCrop(cfg.userAvatar, '裁剪用户头像', bindTarget((v) => ({ userAvatar: v }))),
            }, isGifSource(cfg.userAvatar) ? '转静态裁剪' : '裁剪') : null,
            cfg.userAvatar ? h('button', { onClick: () => update({ userAvatar: '' }) }, '清除') : null,
          ]),
          row('字母', h('input', {
            type: 'text',
            maxLength: 2,
            value: cfg.userLetter,
            onChange: (e) => update({ userLetter: e.target.value }),
          })),
          row('AI 头像', ...[
            h('img', {
              className: 'wxcfg-avatar',
              'data-wx-gif': isGifSource(cfg.aiAvatar) ? '1' : undefined,
              src: cfg.aiAvatar || DS_LOGO_URL,
              alt: '',
              title: isGifSource(cfg.aiAvatar) ? 'GIF 头像（保留动画）' : '点击选择本地图片',
              style: { cursor: 'pointer' },
              onClick: () => aiFileRef.current && aiFileRef.current.click(),
            }),
            h('input', {
              type: 'text',
              placeholder: '留空 = 官方鲸鱼 logo',
              value: cfg.aiAvatar,
              onChange: (e) => update({ aiAvatar: e.target.value }),
            }),
            h('button', { onClick: () => aiFileRef.current && aiFileRef.current.click() }, '上传'),
            h('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, ref: aiFileRef, onChange: pickImage('裁剪 DeepSeek 头像', bindTarget((v) => ({ aiAvatar: v }))) }),
            cfg.aiAvatar ? h('button', {
              title: isGifSource(cfg.aiAvatar) ? 'GIF 会保留动画；这里会输出一张静态 PNG 版本' : '调整裁剪',
              onClick: () => openCrop(cfg.aiAvatar, '裁剪 DeepSeek 头像', bindTarget((v) => ({ aiAvatar: v }))),
            }, isGifSource(cfg.aiAvatar) ? '转静态裁剪' : '裁剪') : null,
            cfg.aiAvatar ? h('button', { onClick: () => update({ aiAvatar: '' }) }, '用官方 logo') : null,
          ]),
          row('大小 ' + cfg.avatarSize + 'px', h('input', {
            type: 'range', min: AVATAR_SIZE_MIN, max: AVATAR_SIZE_MAX, step: 1,
            value: cfg.avatarSize,
            onChange: (e) => update({ avatarSize: Number(e.target.value) }),
          }), h('button', { onClick: () => update({ avatarSize: AVATAR_SIZE_DEFAULT }) }, '36px'),
            h('button', {
              className: 'wxcfg-primary',
              'data-wx-open-appearance': '',
              onClick: () => setAppearance({ schemeId: editScheme }),
            }, '预览大小')),
          row('圆角 ' + cfg.avatarRoundness + '%', h('input', {
            type: 'range', min: 0, max: 100, step: 1,
            value: cfg.avatarRoundness,
            onChange: (e) => update({ avatarRoundness: Number(e.target.value) }),
          }), h('button', { onClick: () => update({ avatarRoundness: AVATAR_ROUNDNESS_DEFAULT }) }, '圆形')),
          h('div', { className: 'wxcfg-hint' },
            '圆角滑条：左端「方形」（0% = 直角）→ 右端「圆形」（100%）。当前：' + cfg.avatarRoundness + '% = ' + roundnessHint + '，头像圆角半径 = 边长的 ' + (cfg.avatarRoundness / 2) + '%。'),
          row('头像背景', ...[
            h('input', {
              type: 'color',
              'data-wx-avatar-bg-color': '',
              value: avatarBgOf(cfg) === AVATAR_BG_TRANSPARENT ? AVATAR_BG_DEFAULT : avatarBgOf(cfg),
              onChange: (e) => update({ avatarBg: e.target.value }),
            }),
            h('button', {
              'data-wx-avatar-bg-default': '',
              onClick: () => update({ avatarBg: '' }),
            }, '默认蓝'),
            h('button', {
              'data-wx-avatar-bg-transparent': '',
              'aria-pressed': normalizeAvatarBg(cfg.avatarBg) === AVATAR_BG_TRANSPARENT ? 'true' : 'false',
              onClick: () => update({ avatarBg: AVATAR_BG_TRANSPARENT }),
            }, '透明'),
          ]),
          h('div', { className: 'wxcfg-hint' }, '头像背景是纯色（作用于图片/字母的透明区域，不会去掉图片自带的底色）；默认蓝 = 旧版行为。'),
          row('头像描边', ...[
            h('input', {
              type: 'color',
              value: cfg.ringColor || '#4d6bfe',
              onChange: (e) => update({ ringColor: e.target.value }),
            }),
            h('button', { onClick: () => update({ ringColor: '#4d6bfe' }) }, '默认蓝'),
            h('button', { onClick: () => update({ ringColor: '' }) }, '无描边'),
          ]),
          h('div', { className: 'wxcfg-hint' }, '点圆形预览或「上传」选图：静图进入裁剪（拖动 + 缩放），GIF 原样保存保留动画；也可直接填图片 URL。点击聊天里的头像可以看大图。'),
          h('div', { className: 'wxcfg-hint' }, GIF_HINT),
        ])),
        panel('tools', section('工具头像', ...[
          row('启用', h('input', {
            type: 'checkbox',
            checked: !!cfg.toolAvatars,
            onChange: (e) => update({ toolAvatars: e.target.checked }),
          }), h('span', { className: 'wxcfg-hint' }, '按本轮工具调用切换 AI 头像；关闭后只区分普通/角色头像')),
          categoryRow('search', '搜索/浏览'),
          categoryRow('read', '读文件'),
          categoryRow('write', '写文件'),
          categoryRow('command', '命令/测试'),
          h('div', { className: 'wxcfg-hint' }, '类型识别用内置关键字（web/search/browse/fetch…、read/view/inspect…、write/edit/apply_patch…、bash/pwsh/test…），空头像视为未配置。'),
          h('details', { className: 'wxcfg-details', 'data-wx-advanced': '' },
            h('summary', null, '高级规则：按精确工具名指定头像（优先于类型）'),
            h('div', { className: 'wxcfg-hint' }, '给单个工具名指定头像，优先级高于上面的类型。例如 browser_run、apply_patch、web_search。'),
          cfg.toolRules.length === 0
            ? h('div', { className: 'wxcfg-hint' }, '还没有规则。输入精确工具名（如 browser_run / apply_patch）再添加。')
            : h('div', { className: 'wxcfg-rules' }, ...cfg.toolRules.map((rule, index) =>
                h('div', { className: 'wxcfg-row', key: 'rule-' + index },
                  h('input', {
                    type: 'text',
                    style: { flex: '0 0 150px' },
                    value: rule.name,
                    placeholder: '工具名',
                    onChange: (e) => patchRule(index, { name: e.target.value }),
                  }),
                  h('img', {
                    className: 'wxcfg-avatar',
                    'data-wx-gif': isGifSource(rule.avatar) ? '1' : undefined,
                    src: rule.avatar || DS_LOGO_URL,
                    alt: '',
                    title: isGifSource(rule.avatar) ? 'GIF 头像（保留动画）' : '点击选择本地图片',
                    style: { cursor: 'pointer' },
                    onClick: () => {
                      const input = ruleFileRefs.current[index];
                      if (input) input.click();
                    },
                  }),
                  h('input', {
                    type: 'text',
                    placeholder: '头像 URL；留空 = 未配置',
                    value: rule.avatar,
                    onChange: (e) => patchRule(index, { avatar: e.target.value }),
                  }),
                  h('button', { onClick: () => { const input = ruleFileRefs.current[index]; if (input) input.click(); } }, '上传'),
                  h('input', {
                    type: 'file',
                    accept: 'image/*',
                    style: { display: 'none' },
                    ref: (node) => { ruleFileRefs.current[index] = node; },
                    onChange: pickImage('裁剪「' + rule.name + '」头像', bindTarget((v) => ({ toolRules: cfg.toolRules.map((r, i) => (i === index ? { ...r, avatar: v } : r)) }))),
                  }),
                  rule.avatar ? h('button', {
                    title: isGifSource(rule.avatar) ? 'GIF 会保留动画；这里会输出一张静态 PNG 版本' : '调整裁剪',
                    onClick: () => openCrop(rule.avatar, '裁剪「' + rule.name + '」头像', bindTarget((v) => ({ toolRules: cfg.toolRules.map((r, i) => (i === index ? { ...r, avatar: v } : r)) }))),
                  }, isGifSource(rule.avatar) ? '转静态裁剪' : '裁剪') : null,
                  h('button', { onClick: () => removeRule(index) }, '删除'),
                ))),
          h('div', { className: 'wxcfg-row' },
            h('span', { className: 'wxcfg-label' }, '新增规则'),
            h('input', {
              type: 'text',
              placeholder: '精确工具名，如 browser_run',
              value: ruleDraft,
              onChange: (e) => setRuleDraft(e.target.value),
              onKeyDown: (e) => { if (e.key === 'Enter') addRule(); },
            }),
            h('button', { onClick: addRule }, '添加'),
          ),
          ),
        ])),
        panel('avatar', section('角色扮演', ...[
          h(AvatarField, {
            label: '角色头像',
            value: cfg.roleAvatar,
            preview: DS_LOGO_URL,
            isGif: isGifSource(cfg.roleAvatar),
            placeholder: '留空 = 角色模式沿用普通头像逻辑',
            onCommit: (v) => update({ roleAvatar: v }),
            onCrop: (v) => openCrop(v, '裁剪角色头像', bindTarget((url) => ({ roleAvatar: url }))),
            onClear: () => update({ roleAvatar: '' }),
            fileRef: roleFileRef,
            onPickFile: pickImage('裁剪角色头像', bindTarget((v) => ({ roleAvatar: v }))),
          }),
          h('div', { className: 'wxcfg-hint', 'data-wx-manual-hint': '' },
            '手动开启：回到聊天 → 输入框旁「角色头像」→ 点「开启」。那里也能直接上传/裁剪角色图片，不用再回到这里。'),
          row('自动标记识别', h('input', {
            type: 'checkbox',
            checked: !!cfg.roleMarkerEnabled,
            onChange: (e) => update({ roleMarkerEnabled: e.target.checked }),
          }), h('span', { className: 'wxcfg-hint' }, '自动模式：解析助手正文里的独立行标记切换角色扮演；关掉后弹窗里的「自动」会说明已关闭，请手动选开启/关闭')),
          h('div', { className: 'wxcfg-hint' }, '可复制的标记约定（整行、只认助手正文；代码块/引用里的示例不算；原生 Markdown 会把它隐藏）：'),
          h('div', { className: 'wxcfg-marker' }, MARKER_CONVENTION),
          h('div', { className: 'wxcfg-hint' }, '手动「开启/关闭」只影响当前未结束轮和后续轮，已经聊完的历史保持它当时的模式。注：HTML 注释写法 <!-- wx-roleplay:on --> 也能识别，但 DSH 会把裸 HTML 当文字显示出来，不推荐。'),
        ])),
        panel('look', section('气泡', ...[
          row('用户气泡色', h('input', {
            type: 'color',
            value: cfg.userBubble || '#e8edf9',
            onChange: (e) => update({ userBubble: e.target.value }),
          })),
          row('AI 气泡色', h('input', {
            type: 'color',
            value: cfg.aiBubble || '#f8faff',
            onChange: (e) => update({ aiBubble: e.target.value }),
          })),
          row('圆角 ' + cfg.radius + 'px', h('input', {
            type: 'range', min: 4, max: 20, step: 1,
            value: cfg.radius,
            onChange: (e) => update({ radius: Number(e.target.value) }),
          })),
          row('最大宽度 ' + cfg.maxWidth + '%', h('input', {
            type: 'range', min: 50, max: 90, step: 1,
            value: cfg.maxWidth,
            onChange: (e) => update({ maxWidth: Number(e.target.value) }),
          })),
        ])),
        panel('look', section('行为', ...[
          row('时间戳', h('input', {
            type: 'checkbox',
            checked: !!cfg.showTimestamps,
            onChange: (e) => update({ showTimestamps: e.target.checked }),
          })),
          row('合并头像', h('input', {
            type: 'checkbox',
            checked: !!cfg.mergeAvatars,
            onChange: (e) => update({ mergeAvatars: e.target.checked }),
          })),
          row('主题', h('select', {
            value: cfg.theme,
            onChange: (e) => update({ theme: e.target.value }),
          }, ...[
            h('option', { value: 'system' }, '跟随系统'),
            h('option', { value: 'light' }, '亮色'),
            h('option', { value: 'dark' }, '暗色'),
          ])),
        ])),
        panel('schemes', section('智能体预设 → 头像方案', ...[
          h('div', { className: 'wxcfg-hint' },
            '默认按这里的绑定生效：某个会话用的智能体预设绑定了哪个方案，那个会话就用哪个方案。'
            + '会话级的临时选择优先于这里；想全局生效就在这里绑定。'),
          h('div', { className: 'wxcfg-hint' },
            '只读取预设的 ID 与名称，用来做绑定；不会改动 DSH 的预设、模型或提示词，也不会切换会话实际使用的智能体。'
            + '预设重命名后按 ID 仍然有效。'),
          presetStatus === 'loading' ? h('div', { className: 'wxcfg-hint', 'data-wx-preset-status': 'loading' }, '正在读取智能体预设名单…') : null,
          presetStatus === 'ready' && presetRows.length === 0
            ? h('div', { className: 'wxcfg-hint', 'data-wx-preset-status': 'empty' }, '宿主里还没有可用的智能体预设。')
            : null,
          presetStatus === 'unavailable' || presetStatus === 'error'
            ? h('div', { className: 'wxcfg-warn', 'data-wx-preset-status': presetStatus },
              (presetStatus === 'unavailable' ? '读不到智能体预设服务：' : '读取预设名单失败：')
              + (presetError || '未知原因')
              + ' 已保存的绑定仍然按 ID 生效，上面的名单只是暂时无法显示或修改。',
              h('button', {
                type: 'button', 'data-wx-preset-retry': '',
                onClick: () => { refreshPresetList(); },
              }, '重试'))
            : null,
          h('div', { className: 'wxcfg-schemes', 'data-wx-preset-rows': '' },
            ...presetDisplay.map((preset) => h('div', {
              className: 'wxcfg-row',
              key: preset.id,
              'data-wx-preset-row': preset.id,
            },
              h('span', { className: 'wxcfg-label', 'data-wx-preset-name': preset.id }, preset.name),
              h('select', {
                'data-wx-preset-bind': preset.id,
                value: presetBindings[preset.id] || '',
                onChange: (e) => {
                  const value = e.target.value;
                  const result = setPresetScheme(preset.id, value);
                  if (!result || result.ok === false) { setNotice(resultNotice(result, '').text); return; }
                  setNotice(value
                    ? '预设「' + preset.name + '」现在使用「' + schemeConfigName(value, schemeList) + '」；跟随它的会话会立刻更新（本会话若临时覆盖过，则不变）。'
                    : '预设「' + preset.name + '」已取消绑定，跟随它的会话回到默认方案。');
                },
              },
                h('option', { value: '' }, '跟随默认方案（不绑定）'),
                ...schemeList.filter((item) => !item.builtin)
                  .map((item) => h('option', { key: item.id, value: item.id }, item.name))))),
          ),
          h('div', { className: 'wxcfg-hint' },
            '列不出名单时（服务缺失 / 临时失败）不会清掉已保存的绑定：只要会话仍能提供稳定的预设 ID，就继续按 ID 生效，'
            + '这里的名称会临时显示成 ID 本身。'),
        ])),
        panel('schemes', section('头像方案', ...[
          h('div', { className: 'wxcfg-hint' },
            '一个方案 = 一整套头像与外观设置（用户/助手/角色/工具头像 + 大小圆角背景描边 + 气泡与主题等）。'),
          h('div', { className: 'wxcfg-hint' },
            '默认在上方给智能体预设绑定方案；聊天输入框旁的「头像方案」可以给单个会话做临时覆盖。'
          + '修改同一个方案会影响所有使用它的会话/预设，想互不影响就用不同方案。'),
          h('div', { className: 'wxcfg-hint' },
            '会话的角色模式（自动/开启/关闭）不属于方案，仍然按轮次边界单独记录。'),
          row('新建方案', h('input', {
            type: 'text',
            placeholder: '新方案名字',
            'data-wx-scheme-name': '',
            value: schemeDraft,
            onChange: (e) => setSchemeDraft(e.target.value),
          }), h('button', {
            'data-wx-scheme-create': '',
            onClick: schemeAction(() => createScheme(schemeDraft.trim() || '新方案', editScheme)),
          }, '从当前方案创建')),
          h('div', { className: 'wxcfg-schemes', 'data-wx-scheme-rows': '' },
            ...schemeList.map((item) => h('div', {
              className: 'wxcfg-row',
              key: item.id,
              'data-wx-scheme-row': item.id,
            },
              h('input', {
                type: 'text',
                'data-wx-scheme-rename-input': item.id,
                defaultValue: item.name,
                disabled: !!item.builtin,
                onKeyDown: (e) => {
                  if (e.key !== 'Enter') return;
                  const value = e.target.value;
                  const result = renameScheme(item.id, value);
                  if (result.ok) { e.target.value = result.name; setNotice('已保存。'); }
                  else setNotice(resultNotice(result).text);
                },
              }),
              h('button', {
                'data-wx-scheme-rename': item.id,
                disabled: !!item.builtin,
                onClick: (e) => {
                  const input = e.currentTarget.parentElement.querySelector('[data-wx-scheme-rename-input]');
                  const result = renameScheme(item.id, input ? input.value : '');
                  if (result.ok) { if (input) input.value = result.name; setNotice('已保存。'); }
                  else setNotice(resultNotice(result).text);
                },
              }, '改名'),
              h('button', {
                'data-wx-scheme-copy': item.id,
                onClick: schemeAction(() => copyScheme(item.id)),
              }, '复制'),
              h('button', {
                'data-wx-scheme-export': item.id,
                onClick: () => {
                  const result = exportScheme(item.id);
                  if (!result.ok) { setNotice(result.error || '导出失败'); return; }
                  const ok = downloadJson('wx-avatar-scheme-' + item.name + '.json', result.payload);
                  setNotice(ok ? '已导出「' + item.name + '」。' : '导出失败：当前环境不允许下载文件。');
                },
              }, '导出'),
              h('button', {
                'data-wx-scheme-delete': item.id,
                disabled: !!item.builtin,
                onClick: () => {
                  const result = deleteScheme(item.id);
                  if (!result || result.ok === false) { setNotice(resultNotice(result, '').text); return; }
                  const parts = [];
                  if (result.affectedSessions > 0) parts.push(result.affectedSessions + ' 个会话的临时选择');
                  if (result.affectedPresets > 0) parts.push(result.affectedPresets + ' 个智能体预设的绑定');
                  setNotice(parts.length
                    ? '已删除「' + item.name + '」：同时清理了 ' + parts.join('、')
                      + '，它们会按优先级回落（预设绑定被清理后回到默认方案）。'
                    : '已删除「' + item.name + '」。');
                },
              }, '删除'),
              item.builtin
                ? h('span', { className: 'wxcfg-hint' }, '默认方案不能改名/删除，可以复制或导出')
                : null)),
          ),
          row('导入方案', h('button', {
            'data-wx-scheme-import': '',
            onClick: () => schemeFileRef.current && schemeFileRef.current.click(),
          }, '选择 JSON 文件…'), h('input', {
            type: 'file',
            accept: '.json,application/json',
            style: { display: 'none' },
            ref: schemeFileRef,
            onChange: onSchemeImport,
          })),
          h('div', { className: 'wxcfg-hint' },
            '导出内容只有方案名和这套外观设置（含头像原图数据，GIF 保留原字节），不含聊天记录、会话 ID、会话绑定或角色模式历史。'
            + '导入一律作为新方案加入，不会覆盖已有方案；重名会自动加序号。'),
        ])),
        h('div', { className: 'wxcfg-row' }, ...[
          h('button', { onClick: reset }, '把当前方案恢复默认'),
          h('span', { className: 'wxcfg-hint' }, '只重置「正在编辑」的这一份方案；不会清空方案库，也不会改会话绑定。时间戳为近似渲染时刻。'),
        ]),
      );
    }

    // ------------------------------------------------------------------
    // 会话内控件 + 头像引擎的两半
    // ------------------------------------------------------------------
    // ── WX-M23 会话内组件（驱动 + 角色入口） ───────────────────────────────
    function useChatSnapshot(useChat) {
      // useChat 是 session 作用域 slot 的标准 prop；ui-chat 未装配时降级为空快照
      if (typeof useChat !== 'function') return EMPTY_CHAT;
      return useChat((value) => value);
    }

    // 只渲染一个 display:none 的标记元素；真正的副作用是装饰 DOM 与发布会话状态。
    /** 头像驱动：只挂一个隐藏标记元素，订阅快照 -> 装饰 DOM + 发布会话状态。 */
    function AvatarDriver(props) {
      const runtime = props.runtime;
      const infoStore = props.infoStore;
      const scopeRef = useRef(null);
      const nodeRef = useRef(null);
      const sessionId = props.sessionId;
      const globalCfg = useConfigValue();
      // 方案库变化（本窗/跨窗）也要重算：会话可能被绑到别的方案，或绑定方案被编辑
      const [schemeVersion, setSchemeVersion] = useState(0);
      useEffect(() => onSchemeChange(() => setSchemeVersion((value) => value + 1)), []);
      // 宿主亮/暗切换：system 方案要立刻跟上（用 tick 触发重新写 scope 变量）
      const [hostThemeTick, setHostThemeTick] = useState(0);
      useEffect(() => onHostThemeChange(() => setHostThemeTick((value) => value + 1)), []);
      // 本会话实际使用的智能体预设（只读；拿不到就是 ''，走默认方案）
      const presetId = useSessionPresetId(props.useSessions, sessionId);
      const snapshot = useChatSnapshot(props.useChat);
      // 角色模式边界变化（点控件 / 跨窗同步）要重算索引
      const [roleVersion, setRoleVersion] = useState(0);
      useEffect(() => onRoleStateChange(() => setRoleVersion((value) => value + 1)), []);

      // 本会话**生效配置**：显式覆盖 > 预设绑定 > 默认方案（config-v1）。
      // 所有渲染/索引都必须用它，不能用全局 configSnapshot，否则 A 会话会跟着 B 的方案变。
      const resolution = useMemo(
        () => resolveScheme(sessionId, presetId),
        [sessionId, presetId, globalCfg, schemeVersion],
      );
      const cfg = useMemo(
        () => schemeConfigOf(resolution.schemeId),
        [resolution, globalCfg, schemeVersion],
      );

      // 头像历史缓存就绪/写入后要重算一次索引（hook 必须在 index 之前声明，否则 TZD）
      const [historyVersion, setHistoryVersion] = useState(0);
      useEffect(() => {
        const unsubscribe = avatarHistory.subscribe(() => setHistoryVersion((value) => value + 1));
        // A fast initial load can finish between render and effect subscription.
        setHistoryVersion((value) => value + 1);
        return unsubscribe;
      }, []);
      const historyReady = avatarHistory.ready();
      const index = useMemo(() => {
        // 旧格式角色模式惰性迁移：钉在当前/下一轮，历史保持 auto
        const state = roleStateOf(sessionId);
        // 每轮头像身份：有历史用历史，没有就用当前方案（2.4.0 WX-M30）
        return buildTurnIndex(snapshot, cfg, state, (turn) => avatarHistory.configFor(sessionId, turn, cfg));
      }, [snapshot, cfg, sessionId, roleVersion, historyVersion]);

      // 记录每轮实际用到的头像身份（首写不可覆盖；落盘失败只提示、不影响本窗口显示）
      useEffect(() => {
        if (!sessionId || !historyReady) return;
        for (const [turn, entry] of index) {
          if (!entry || !entry.identity) continue;
          if (avatarHistory.identityFor(sessionId, turn)) continue;
          avatarHistory.remember(sessionId, turn, entry.identity);
        }
      }, [index, sessionId, historyReady]);

      const info = useMemo(() => summarizeSession(snapshot, index), [snapshot, index]);

      // 会话状态发布（控件/指示点读它，按 sessionId 隔离）
      useEffect(() => {
        if (!sessionId) return undefined;
        const state = roleStateOf(sessionId);
        if (state && state.legacyMode && state.entries.length === 0) {
          resolveLegacyRoleMode(sessionId, info.openTurn !== null ? info.openTurn : info.lastTurn + 1);
        }
        infoStore.set(sessionId, info);
        return () => infoStore.clear(sessionId);
      }, [infoStore, sessionId, info]);

      // 挂载/卸载：只解析一次作用域，避免每次索引更新都撤销再重画（会闪默认头像）
      useEffect(() => {
        const node = nodeRef.current;
        const scope = (node && typeof node.closest === 'function' && node.closest('[data-conversation-content]')) || document;
        scopeRef.current = scope;
        if (!avatarHistory.ready() && typeof scope.setAttribute === 'function') {
          scope.setAttribute('data-wx-avatar-history-pending', '');
        }
        // 作用域上先写一份本会话的外观变量（派生尺寸/间距由 CSS 的同一组选择器负责）
        applyScopeConfig(scope, effectiveConfig(sessionId, presetId));
        return () => {
          scopeRef.current = null;
          if (typeof scope.removeAttribute === 'function') scope.removeAttribute('data-wx-avatar-history-pending');
          runtime.release(scope);
          clearScopeConfig(scope);
        };
      }, [runtime, sessionId]);

      // 生效配置变化（切方案 / 编辑方案 / 跨窗同步）：立刻重写作用域变量，不需要新的 token
      useEffect(() => {
        const scope = scopeRef.current;
        if (scope) applyScopeConfig(scope, cfg);
      }, [cfg, hostThemeTick]);

      // 索引更新
      useEffect(() => {
        const scope = scopeRef.current;
        if (!scope || !historyReady) return;
        runtime.update(scope, index);
        // Reveal only after the historical row variables have actually been written.
        if (typeof scope.removeAttribute === 'function') scope.removeAttribute('data-wx-avatar-history-pending');
      }, [runtime, index, historyReady]);

      return h('span', {
        ref: nodeRef,
        'data-wx-avatar-driver': '',
        'data-wx-avatar-debug': info.debug,
        'data-wx-scheme': resolution.schemeId,
        'data-wx-scheme-source': resolution.source,
        'data-wx-agent-preset': presetId || '',
        style: { display: 'none' },
        'aria-hidden': 'true',
      });
    }

    // ── WX-M28 方案入口（会话级） ─────────────────────────────────────────
    /**
     * 头像方案选择弹窗（会话级）：给**当前会话**挑一个方案。
     * 只改本会话的绑定，不动别的会话，也不改任何方案的配置内容。
     */
    function SchemePickerModal({ sessionId, presetId, onClose, appearance }) {
      const cfgForHost = appearance || effectiveConfig(sessionId, presetId);
      const [version, setVersion] = useState(0);
      const [presetVersion, setPresetVersion] = useState(0);
      const [notice, setNotice] = useState('');
      const [busy, setBusy] = useState(false);
      const fileRef = useRef(null);
      useEffect(() => onSchemeChange(() => setVersion((value) => value + 1)), []);
      useEffect(() => onPresetChange(() => setPresetVersion((value) => value + 1)), []);
      const schemes = useMemo(() => listSchemes(), [version]);
      // 本会话的解析结果：显式覆盖 > 预设绑定 > 默认
      const resolution = useMemo(
        () => resolveScheme(sessionId, presetId),
        [sessionId, presetId, version, presetVersion],
      );
      const bound = sessionOverrideId(sessionId);          // 只表示「显式覆盖」，'' = 没有覆盖
      const presetName = presetId ? presetNameOf(presetId) : '';

      const applyResult = (result, okText) => {
        const shown = resultNotice(result, okText);
        setNotice(shown.text);
        return !shown.failed;
      };
      const pick = (schemeId) => {
        // 选「默认方案」= 写一条显式覆盖（和「跟随预设」不是一回事）
        applyResult(setSessionScheme(sessionId, schemeId), '本会话已临时使用这个方案。');
      };
      const followPreset = () => {
        applyResult(clearSessionScheme(sessionId), '已取消本会话的临时覆盖，回到跟随预设。');
      };
      const onImport = async (event) => {
        const file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (!file) return;
        setBusy(true);
        let text = '';
        try {
          text = await file.text();
        } catch (_err) {
          setBusy(false);
          setNotice('读取这个文件失败了，请重试。');
          return;
        }
        const result = importScheme(text);
        setBusy(false);
        if (!result.ok) { setNotice(resultNotice(result).text); return; }
        setNotice('已导入方案「' + result.name + '」（新建，不影响原有方案）。');
      };

      const body = h('div', null,
        h('div', { className: 'wxmodal-hint' },
          '默认按智能体预设生效：本会话用的预设绑定了哪个方案，就用哪个方案。'
          + '这里手动选一个只影响本会话（临时覆盖），取消后回到跟随预设。'),
        h('div', { className: 'wxmodal-status', 'data-wx-session-scheme-source': resolution.source },
          resolution.source === 'session'
            ? '本会话临时使用：' + schemeConfigName(resolution.schemeId, schemes)
            : resolution.source === 'preset'
              ? '跟随预设：' + (presetName || presetId) + ' → ' + schemeConfigName(resolution.schemeId, schemes)
              : '跟随默认方案（本会话还没有预设信息，或该预设没有绑定方案）'),
        h('div', { className: 'wxmodal-list', 'data-wx-scheme-list': '' },
          ...schemes.map((scheme) => h('label', {
            key: scheme.id,
            className: 'wxmodal-list-item',
            'data-wx-scheme-option': scheme.id,
          },
            h('input', {
              type: 'radio',
              name: 'wx-scheme-' + (sessionId || 'x'),
              checked: bound === scheme.id,
              onChange: () => pick(scheme.id),
            }),
            h('span', null, scheme.name + (scheme.builtin ? '（默认方案；选中它会成为本会话的明确覆盖）' : ''))))),
        h('div', { className: 'wxmodal-actions' },
          h('button', {
            type: 'button', 'data-wx-scheme-follow': '',
            disabled: !bound,
            onClick: followPreset,
          }, '跟随预设（取消临时覆盖）'),
          h('button', { type: 'button', onClick: () => setEditingScheme(bound || resolution.schemeId) }, '去配置面板编辑'),
          h('button', { type: 'button', disabled: busy, onClick: () => fileRef.current && fileRef.current.click() }, busy ? '正在导入…' : '导入方案…'),
          h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' }, ref: fileRef, onChange: onImport })),
        h('div', { className: 'wxmodal-hint' }, '导出与管理（创建/复制/改名/删除、预设绑定）在「设置 → 插件 → 微信风聊天 → 头像方案」页里。'),
        h('div', { className: 'wxmodal-hint' }, '这里只改头像外观，不会切换本会话实际使用的智能体。'),
        notice ? h('div', { className: 'wxmodal-warn', 'data-wx-scheme-notice': '' }, notice) : null,
      );
      return h(ModalShell, { title: '头像方案', onClose, small: true, body, appearance: cfgForHost });
    }
    /** 方案 id → 显示名（查不到就显示 id，不猜）。 */
    function schemeConfigName(schemeId, list) {
      const found = (list || listSchemes()).find((scheme) => scheme.id === schemeId);
      return found ? found.name : String(schemeId);
    }

    // ── WX-M29 智能体预设（只读元数据） ───────────────────────────────────
    // 只做两件事：① 从宿主公开的 remote 拿「预设 id/name」名单（给绑定下拉用）；
    // ② 从标准 prop useSessions 读「某个会话实际用的是哪个预设 id」。
    // 明确不做：不调用 select/makeDefault/settings.update，不读预设的组合/提示词，不改任何 DSH 预设或模型配置。
    // 服务缺失/名单失败都只影响「显示与新增绑定」：已保存的绑定仍按稳定 ID 生效。
    let presetRemote = null;
    const presetListeners = new Set();
    let presetDisposers = [];
    // 服务代的代号：detach 时 +1，用来让「已经在飞的」list 结果失效（不能复活名单）
    let presetGeneration = 0;
    // 只接受最新一次请求的结果：重试 / connection reset 同时触发时，旧请求不能盖过新请求
    let presetRequestSeq = 0;
    // status: idle（还没问过）| loading | ready | error（名单失败，可重试）| unavailable（宿主没这个服务）
    let presetListState = { status: 'idle', presets: [], error: '' };

    function presetListSnapshot() {
      return presetListState;
    }
    function onPresetChange(fn) {
      presetListeners.add(fn);
      return () => presetListeners.delete(fn);
    }
    function notifyPresets() {
      for (const fn of presetListeners) {
        try { fn(presetListState); } catch (_err) { /* 监听器自身异常不影响主流程 */ }
      }
    }
    /**
     * 接入宿主的只读预设服务。
     * **必须用 ctx.inject 声明依赖**：真实 Cordis 里未 inject 就访问 ctx.remote 会抛
     * `cannot get property "remote" without inject`，被 catch 吞掉就会伪装成「服务缺失」，
     * 功能静默失效。所以这里走动态注入（`ctx.inject(keys, scope => cleanup)`），
     * 服务缺席时只是这一段子 fiber 不激活，主插件照常保持 Active。
     */
    let presetFiber = null;
    function bindPresetService(ctx) {
      if (presetFiber) return presetFiber;
      if (ctx && typeof ctx.inject === 'function') {
        try {
          presetFiber = ctx.inject(['remote', 'remote.agentPresets'], (scope) => {
            attachPresetService(scope);
            return () => { detachPresetService(); };
          });
          return presetFiber;
        } catch (_err) {
          presetFiber = null;
        }
      }
      // 没有 inject 能力（离线夹具 / 更老的宿主）：直接读，读不到就降级为 unavailable
      attachPresetService(ctx);
      return null;
    }
    function unbindPresetService() {
      const fiber = presetFiber;
      presetFiber = null;
      detachPresetService();
      if (fiber && typeof fiber.dispose === 'function') {
        try { fiber.dispose(); } catch (_err) { /* 已释放或由父 fiber 管理 */ }
      }
      presetRemote = null;
      presetListeners.clear();
      presetListState = { status: 'idle', presets: [], error: '' };
    }
    /** 子 fiber 内调用：接住 scope 上可用的服务并订阅它的更新事件。 */
    function attachPresetService(ctx) {
      if (presetDisposers.length) return;                       // 已经接上了，别重复订阅
      try {
        presetRemote = ctx && ctx.remote && ctx.remote.agentPresets ? ctx.remote.agentPresets : null;
      } catch (_err) {
        // 未声明 inject 时这里会抛；仍然降级，但不再假装「宿主没有这个服务」
        presetRemote = null;
      }
      if (!presetRemote || typeof presetRemote.list !== 'function') {
        presetListState = { status: 'unavailable', presets: [], error: '没有可用的智能体预设服务（已保存的绑定仍按 ID 生效）。' };
        notifyPresets();
        return;
      }
      const refresh = () => { refreshPresetList(); };
      // 官方客户端也是监听这两类事件来刷新自己的预设列表
      try {
        if (ctx.remote && typeof ctx.remote.$on === 'function') {
          presetDisposers.push(ctx.remote.$on('settings/document-updated', (ns) => {
            if (ns === 'agent-preset-registry') refresh();
          }));
        }
      } catch (_err) { /* 事件订阅失败不影响只读名单 */ }
      try {
        if (typeof ctx.on === 'function') {
          presetDisposers.push(ctx.on('connection/reset', () => { refresh(); }));
        }
      } catch (_err) { /* 同上 */ }
      refreshPresetList();
    }
    /**
     * 服务子 fiber 退出 / 插件卸载时调用。
     * **不清 React 订阅**（组件还挂着的订阅要留着，服务重新提供时应能更新同一个面板），
     * 只让在途结果失效并把名单状态降级。
     */
    function detachPresetService() {
      presetGeneration += 1;
      for (const dispose of presetDisposers) {
        try { dispose(); } catch (_err) { /* 忽略 */ }
      }
      presetDisposers = [];
      presetRemote = null;
      if (presetListState.status !== 'idle') {
        presetListState = { status: 'idle', presets: [], error: '' };
        notifyPresets();
      }
    }
    /** 拉一次名单（只读）。失败只改 status/error，**绝不动任何绑定**。 */
    function refreshPresetList() {
      const generation = presetGeneration;
      if (!presetRemote || typeof presetRemote.list !== 'function') {
        presetListState = { status: 'unavailable', presets: [], error: '没有可用的智能体预设服务（已保存的绑定仍按 ID 生效）。' };
        notifyPresets();
        return Promise.resolve(presetListState);
      }
      presetRequestSeq += 1;
      const seq = presetRequestSeq;
      const isCurrent = () => seq === presetRequestSeq && generation === presetGeneration;
      presetListState = { status: 'loading', presets: presetListState.presets, error: '' };
      notifyPresets();
      return Promise.resolve()
        .then(() => presetRemote.list())
        .then((response) => {
          if (!isCurrent()) return presetListState;             // 过期/已卸载：直接丢弃
          if (!response || response.ok !== true || !response.value || !Array.isArray(response.value.presets)) {
            const message = (response && response.error && (response.error.message || response.error.code)) || '读取预设名单失败';
            presetListState = { status: 'error', presets: [], error: String(message) };
          } else {
            // 只要 id/name 元数据；broken 有值（官方类型是 broken?: string，不是布尔）就不给选
            const presets = response.value.presets
              .filter((item) => item && typeof item.id === 'string' && item.broken === undefined)
              .map((item) => ({ id: item.id, name: typeof item.name === 'string' && item.name ? item.name : item.id }))
              .filter((item) => isPresetId(item.id));
            presetListState = { status: 'ready', presets, error: '' };
          }
          notifyPresets();
          return presetListState;
        })
        .catch((err) => {
          if (!isCurrent()) return presetListState;
          presetListState = { status: 'error', presets: [], error: String((err && err.message) || err || '读取预设名单失败') };
          notifyPresets();
          return presetListState;
        });
    }
    /** 名单里查名字；查不到（名单失败/预设被删）就用 id 本身显示，不猜名字。 */
    function presetNameOf(presetId) {
      if (!presetId) return '';
      const found = presetListState.presets.find((item) => item.id === presetId);
      return found ? found.name : String(presetId);
    }

    /**
     * 某个会话实际使用的智能体预设 id（只读）。
     * 用宿主的标准 prop useSessions + 官方 AgentPresetLabel 的同一投影路径：
     *   state.byId[sessionId].projectionValues.agentPreset，仅接受 string。
     * SessionSnapshot 上没有 agentPreset 字段，所以不用 useSession 猜路径。
     */
    function useSessionPresetId(useSessions, sessionId) {
      if (typeof useSessions !== 'function' || !sessionId) return '';
      const value = useSessions((state) => {
        const entry = state && state.byId ? state.byId[sessionId] : undefined;
        const preset = entry && entry.projectionValues ? entry.projectionValues.agentPreset : undefined;
        return typeof preset === 'string' ? preset : '';
      });
      return typeof value === 'string' ? value : '';
    }

    /** 订阅某会话的生效配置（显式覆盖 > 预设绑定 > 默认方案）＋方案库/默认配置版本。 */
    function useSessionConfig(sessionId, presetId) {
      const globalCfg = useConfigValue();
      const [schemeVersion, setSchemeVersion] = useState(0);
      useEffect(() => onSchemeChange(() => setSchemeVersion((value) => value + 1)), []);
      return useMemo(
        () => effectiveConfig(sessionId, presetId),
        [sessionId, presetId, globalCfg, schemeVersion],
      );
    }
    /** 订阅「正在编辑的方案」——配置面板与预览弹窗共用。 */
    function useEditingScheme() {
      const [schemeId, setSchemeId] = useState(() => editingSchemeId());
      useEffect(() => onEditingSchemeChange((next) => setSchemeId(next)), []);
      return schemeId;
    }

    /** 角色头像入口：输入框按钮区里一个明确的紧凑入口，点开是小设置弹窗。 */
    // 放在输入框按钮区（conversation.input.right），不是会话头：那里才是用户顺手能点到的地方。
    function RoleplayControl(props) {
      const infoStore = props.infoStore;
      const sessionId = props.sessionId;
      const presetId = useSessionPresetId(props.useSessions, sessionId);
      // 角色图片取「本会话生效方案」的，而不是全局默认方案
      const cfg = useSessionConfig(sessionId, presetId);
      const [state, setState] = useState(() => roleStateOf(sessionId));
      const [info, setInfo] = useState(() => infoStore.get(sessionId));
      const [open, setOpen] = useState(false);

      useEffect(() => {
        setState(roleStateOf(sessionId));
        setInfo(infoStore.get(sessionId));
        const offMode = onRoleStateChange(() => setState(roleStateOf(sessionId)));
        const offInfo = infoStore.subscribe(sessionId, setInfo);
        return () => { offMode(); offInfo(); setOpen(false); };
      }, [infoStore, sessionId]);

      const targetTurn = roleplayTargetTurn(info);
      const mode = modeForTurn(state, targetTurn);
      // 指示灯以「目标轮」为准，避免拿最后已完成轮显示成矛盾矛盾的「角色中」
      const roleOn = mode === 'on'
        ? true
        : mode === 'off'
          ? false
          : !!(info && info.openTurn !== null && info.roleOn);
      const modeWord = mode === 'on' ? '开启' : mode === 'off' ? '关闭' : '自动';
      const avatarWord = cfg.roleAvatar ? '' : '（未设图）';

      return h('div', { className: 'wxrp' },
        h('button', {
          type: 'button',
          className: 'wxrp-entry',
          'data-wx-role-entry': '',
          'aria-haspopup': 'dialog',
          title: '点击设置角色头像（只影响头像，不影响角色设定）',
          onClick: () => setOpen(true),
        },
          h('span', { className: 'wxrp-dot', 'data-on': roleOn ? '1' : '0' }),
          h('span', { className: 'wxrp-entry-name' }, '角色头像'),
          h('span', null, '：' + modeWord + avatarWord)),
        open ? h(RoleplaySettingsModal, { sessionId, infoStore, presetId, onClose: () => setOpen(false) }) : null,
      );
    }

    /**
     * 头像方案入口：显示本会话当前用的方案名，点开可以换方案 / 快速管理。
     * 与「角色头像」分开：一个管外观方案，一个管角色模式，互不干扰。
     */
    function SchemeControl(props) {
      const sessionId = props.sessionId;
      const [version, setVersion] = useState(0);
      const [open, setOpen] = useState(false);
      // hook 必须在顶层无条件调用，不能写在 JSX/条件表达式里
      const presetId = useSessionPresetId(props.useSessions, sessionId);
      const pickerAppearance = useSessionConfig(sessionId, presetId);
      useEffect(() => onSchemeChange(() => setVersion((value) => value + 1)), []);
      useEffect(() => { setOpen(false); }, [sessionId]);
      const schemeId = useMemo(
        () => resolveScheme(sessionId, presetId).schemeId,
        [sessionId, presetId, version],
      );
      const source = useMemo(
        () => resolveScheme(sessionId, presetId).source,
        [sessionId, presetId, version],
      );
      const override = sessionOverrideId(sessionId);
      const scheme = getScheme(schemeId);
      const name = scheme ? scheme.name : DEFAULT_SCHEME_NAME;
      const presetLabel = presetId ? (presetNameOf(presetId) || presetId) : '';
      return h('div', { className: 'wxrp' },
        h('button', {
          type: 'button',
          className: 'wxrp-entry',
          'data-wx-scheme-entry': '',
          'data-wx-scheme-source': source,
          'aria-haspopup': 'dialog',
          title: source === 'session'
            ? '本会话临时使用「' + name + '」（点击可改回跟随预设）'
            : source === 'preset'
              ? '跟随智能体预设「' + presetLabel + '」→「' + name + '」'
              : '跟随默认方案（这个会话没有可用的预设绑定）',
          onClick: () => setOpen(true),
        },
          h('span', { className: 'wxrp-entry-name' }, '头像方案'),
          h('span', null, '：'
            + (source === 'session' ? '临时 ' + name
              : source === 'preset' ? '跟随预设 ' + presetLabel
                : name))),
        open ? h(SchemePickerModal, {
          sessionId, presetId, onClose: () => setOpen(false), appearance: pickerAppearance,
        }) : null,
      );
    }

    /** 订阅同窗配置。 */
    // 与配置面板共用同一个内存快照；跨窗由 storage 事件触发 notifyConfig。
    function useConfigValue() {
      const [cfg, setCfg] = useState(configSnapshot);
      useEffect(() => onConfigChange((next) => setCfg(next)), []);
      return cfg;
    }

    // ------------------------------------------------------------------
    // apply
    // ------------------------------------------------------------------
    /** 手动注入 <style>（bundle client 环境无 styles 全局；用 data 属性标记归属） */
    // ── WX-M25 装配与销毁 ─────────────────────────────────────────────────
    // injectCss 手动插 <style>（bundle 里没有 styles 全局），带 data-plugin 标记归属。
    function injectCss(css) {
      const tag = document.createElement('style');
      tag.dataset.plugin = PACKAGE_NAME;
      tag.dataset.wxCss = 'wx-chat';
      tag.textContent = css;
      document.head.appendChild(tag);
      return () => {
        if (tag.parentNode) tag.parentNode.removeChild(tag);
      };
    }

    // 模块级单例：三份状态分别给「DOM 装饰 / 会话状态 / 大图预览」用，apply 的返回值里统一销毁。
    const runtime = createAvatarRuntime();
    const infoStore = createSessionInfoStore();
    const preview = createAvatarPreview();

    return {
      inject: ['slots'],
      /** 仅用于本地隔离测试夹具；运行时不依赖。 */
      __test: {
        VERSION,
        DEFAULTS,
        DEFAULT_CATEGORY_AVATARS,
        AVATAR_SIZE_MIN,
        AVATAR_SIZE_MAX,
        AVATAR_ROUNDNESS_DEFAULT,
        normalizeConfig,
        mergeConfigPatch,
        CONFIG_KEY,
        ROLE_MODE_KEY,
        readConfig,
        writeConfig,
        configSnapshot,
        commitConfig,
        onConfigChange,
        normalizeAvatarBg,
        avatarBgOf,
        avatarFgOf,
        avatarDisplaySize,
        hexToRgb,
        AVATAR_BG_DEFAULT,
        AVATAR_BG_TRANSPARENT,
        CAN_PORTAL,
        modalStack,
        activeModalCount,
        isTopModal,
        ModalShell,
        AvatarAppearanceModal,
        RoleplaySettingsModal,
        readAvatarFile,
        createUploadGuard,
        scrollableAncestor,
        ROLE_MODE_LABELS,
        avatarSizeOf,
        avatarGapOf,
        avatarRoundOf,
        applyConfig,
        clearAppliedConfig,
        ROOT_STYLE_PROPS,
        ROOT_DATASETS,
        resolveToolAvatar,
        categoryOfToolName,
        parseRoleplayMarker,
        markerOfLine,
        buildTurnIndex,
        summarizeSession,
        turnIsClosed,
        turnOfChatNode,
        toolNameOfRoot,
        assistantTextOf,
        decorateScope,
        resetScope,
        createAvatarRuntime,
        createSessionInfoStore,
        createAvatarPreview,
        attachAvatarClick,
        extractCssUrl,
        isGifSource,
        isGifFile,
        fileLooksLikeGif,
        normalizeGifDataUrl,
        normalizeRoleState,
        modeForTurn,
        roleplayTargetTurn,
        setRoleModeFrom,
        resolveLegacyRoleMode,
        roleStateOf,
        // ── WX-M26 方案库 ──
        SCHEMES_KEY,
        SCHEME_EXPORT_FORMAT,
        SCHEME_EXPORT_VERSION,
        DEFAULT_SCHEME_ID,
        DEFAULT_SCHEME_NAME,
        SCHEME_CONFIG_KEYS,
        deepCopy,
        normalizeSchemeStore,
        validateSchemeConfig,
        readSchemeStore,
        onSchemeChange,
        listSchemes,
        getScheme,
        schemeConfigOf,
        sessionSchemeId,
        effectiveConfig,
        setSessionScheme,
        clearSessionScheme,
        setPresetScheme,
        presetBindingsSnapshot,
        sessionOverrideId,
        presetSchemeId,
        resolveScheme,
        attachPresetService,
        bindPresetService,
        unbindPresetService,
        detachPresetService,
        refreshPresetList,
        presetListSnapshot,
        presetNameOf,
        onPresetChange,
        checkSchemeCapacity,
        checkConfigPatch,
        sanitizeSchemeConfig,
        validateConfigField,
        isStorableId,
        checkStoreCapacity,
        isSchemeId,
        isPresetId,
        SCHEME_MAX_STRING_CHARS,
        SCHEME_MAX_STORE_CHARS,
        commitSchemeConfig,
        createScheme,
        copyScheme,
        renameScheme,
        deleteScheme,
        exportScheme,
        importScheme,
        editingSchemeId,
        setEditingScheme,
        onEditingSchemeChange,
        // ── WX-M27 会话配置作用域 ──
        applyScopeConfig,
        clearScopeConfig,
        applyHostConfig,
        // ── WX-M28 方案入口 ──
        SchemeControl,
        SchemePickerModal,
        useSessionConfig,
        AvatarDriver,
        RoleplayControl,
        ConfigPanel,
        AvatarCropper,
        runtime,
        infoStore,
        preview,
        // 每轮头像历史（2.4.0）
        avatarHistory,
        avatarIdentityOf,
        smallHash,
        AVATAR_IDENTITY_KEYS,
        AVATAR_USER_VAR,
        AVATAR_USER_TEXT_VAR,
      },
      apply(ctx) {
        const root = document.documentElement;
        const disposeCss = injectCss(buildCss());

        let cfg = configSnapshot();
        applyConfig(root, cfg);
        // 接入宿主的只读智能体预设服务：用动态 inject 声明依赖（服务缺席只影响这一段，主插件保持 Active）
        bindPresetService(ctx);

        let disposeTs = () => {};
        let tsMounted = false;
        // 是否有**任何**方案需要时间戳：默认方案或某个具名方案开着就要挂装饰器，
        // 具体某个会话显不显示由它 scope 上的 data-wx-timestamps 决定（CSS 变量 --wx-ts-display）。
        const anyTimestampsWanted = () => {
          if (configSnapshot().showTimestamps) return true;
          const schemes = readSchemeStore().schemes;
          for (const id of Object.keys(schemes)) {
            const scheme = schemes[id];
            if (scheme && scheme.config && scheme.config.showTimestamps) return true;
          }
          return false;
        };
        // 只在「需不需要」真的变化时启停：无关字段/绑定的变化不要反复重建装饰器
        // （重建会把每行的近似渲染时间重新记一遍）。
        const rearmTimestamps = () => {
          const wanted = anyTimestampsWanted();
          if (wanted === tsMounted) return;
          if (wanted) {
            disposeTs = mountTimestampDecorator();
            tsMounted = true;
          } else {
            disposeTs();
            disposeTs = () => {};
            tsMounted = false;
          }
        };
        // 启动时与「启动后在当前窗口开启」必须得到同样的结果
        if (anyTimestampsWanted()) {
          disposeTs = mountTimestampDecorator();
          tsMounted = true;
        }
        // 默认方案配置变化（同窗 commitConfig）与方案库变化（新建/编辑/删除/跨窗）都要重判
        const disposeTsConfigWatch = onConfigChange(() => rearmTimestamps());
        const disposeTsSchemeWatch = onSchemeChange(() => rearmTimestamps());

        const disposePreviewClick = attachAvatarClick(preview);

        // 每轮头像历史：先读取已有身份，驱动就绪后再写行变量；不阻塞正文。
        // 失败只标记提示，本窗口照常工作。
        avatarHistory.activate();

        const onStorage = (e) => {
          // localStorage.clear() 会以 key === null 通知，需要整体回到默认
          if (e.key === CONFIG_KEY || e.key === null) {
            configCache = null;
            // 根上写的是「默认方案」的配置；具名方案由各自的会话 scope 与弹窗宿主负责
            applyConfig(root, configSnapshot());
            notifyConfig(undefined, { ok: true, error: '' });
            rearmTimestamps();
          }
          if (e.key === ROLE_MODE_KEY || e.key === null) {
            roleStateCache = null;
            const states = readRoleStates();
            for (const fn of roleStateListeners) {
              try { fn(states, { ok: true, error: '' }); } catch (_err) { /* 空实现 */ }
            }
          }
          if (e.key === SCHEMES_KEY || e.key === null) {
            // 方案库变了（别的窗口改的）：重读并广播，驱动/面板/会话入口各自刷新
            notifySchemes(undefined, { ok: true, error: '' });
            rearmTimestamps();
          }
        };
        window.addEventListener('storage', onStorage);

        const disposeConfigPanel = ctx.slots.inject('plugins.bundle.config', () =>
          ctx.slots.register({ name: 'plugins.bundle.config', key: PACKAGE_NAME }, ConfigPanel),
        );
        // 输入框按钮区三个独立注册项：driver（隐藏标记元素）、角色头像、头像方案
        const disposeDriver = ctx.slots.inject('conversation.input.right', () =>
          ctx.slots.register({ name: 'conversation.input.right', id: PACKAGE_NAME + '/driver', order: 5 },
            (props) => h(AvatarDriver, { ...props, runtime, infoStore })),
        );
        const disposeControl = ctx.slots.inject('conversation.input.right', () =>
          ctx.slots.register({ name: 'conversation.input.right', id: PACKAGE_NAME + '/roleplay', order: 10 },
            (props) => h(RoleplayControl, { ...props, infoStore })),
        );
        const disposeScheme = ctx.slots.inject('conversation.input.right', () =>
          ctx.slots.register({ name: 'conversation.input.right', id: PACKAGE_NAME + '/scheme', order: 12 },
            (props) => h(SchemeControl, { ...props })),
        );

        return () => {
          disposeTsConfigWatch();
          disposeTsSchemeWatch();
          unbindPresetService();
          disposeScheme();
          disposeControl();
          disposeDriver();
          disposeConfigPanel();
          window.removeEventListener('storage', onStorage);
          disposeTs();
          disposePreviewClick();
          preview.dispose();
          infoStore.dispose();
          runtime.dispose();
          // 头像历史：只关自己的连接/订阅，**不删除已存记录**
          avatarHistory.dispose();
          clearAppliedConfig(root);
          disposeCss();
        };
      },
    };
  },
});
