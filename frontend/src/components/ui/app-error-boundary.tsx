import { Component, type ReactNode } from "react";

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) {
      return this.props.children;
    }

    return (
      <main className="app-loading app-loading--failed">
        <div className="app-loading__layout">
          <header className="app-loading__intro">
            <div>
              <p className="app-loading__eyebrow">PELAGIA-9</p>
              <h1>화면을 불러오지 못했습니다</h1>
            </div>
            <p className="app-loading__status" role="alert">
              연결 상태를 확인하고 다시 불러와 주세요.
            </p>
            <button
              type="button"
              className="app-loading__retry"
              onClick={() => window.location.reload()}
            >
              다시 불러오기
            </button>
          </header>
        </div>
      </main>
    );
  }
}
