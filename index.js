/**
 * Host half of the WeChat-style chat bundle.
 * The Client module owns all rendering, styling, and configuration;
 * the Host side stays inert by design (presentation-only plugin).
 */
// apply 是 Host 侧的入口，由 DSH 在启用 bundle 时调用。
// 本插件是纯展示层：渲染、样式、配置、DOM 装饰全部在 client.js（Client half）里完成，
// 这里刻意留空——不注册工具、不读写会话数据、不占用任何 Host 能力。
// 维护提示：不要为了「顺手」把逻辑挪到这里，Client/ Host 的边界变了会影响插件加载顺序。
export function apply() {}
