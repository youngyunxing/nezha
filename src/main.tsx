import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import { I18nProvider } from "./i18n";

// 屏蔽 WebKit 的原生右键菜单（Copy / Paste / AutoFill / Services / 检查元素）。
// 它是系统给的，跟应用自己的右键菜单（文件树 / 项目栏 / 任务预设）混在一起很乱，而
// AutoFill 这种系统项在这个应用里没有意义；终端里尤其明显——xterm 底下那个隐藏 textarea
// 会被 WebKit 当成输入框，于是把 Paste / AutoFill 一起摆出来。
// 只在捕获阶段 preventDefault，不 stopPropagation：自己接管右键的地方（它们自己也会
// preventDefault 后弹自己的菜单）照常工作。Cmd+C/V、终端选中即复制都不受影响。
document.addEventListener("contextmenu", (event) => event.preventDefault(), true);


class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            padding: 32,
            fontFamily: "var(--font-ui)",
            color: "#666",
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Something went wrong</div>
          <pre
            style={{
              fontSize: 12,
              color: "#999",
              maxWidth: 600,
              overflow: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 16, padding: "8px 16px", cursor: "pointer" }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </I18nProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
