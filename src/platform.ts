/** 本项目只发布 macOS，运行在 Tauri 的 WKWebView 里。 */

export function isAppleWebKit(
  currentNavigator: Pick<Navigator, "userAgent"> | undefined = globalThis.navigator,
): boolean {
  return currentNavigator?.userAgent.includes("AppleWebKit") ?? false;
}

// 仍保留运行时判断而非写死 true：`pnpm dev` 时可能用非 WebKit 浏览器
// 打开 Vite 服务做 UI 调试，终端输入修正不该在那时生效。
export const IS_MAC_WEBKIT = isAppleWebKit();
