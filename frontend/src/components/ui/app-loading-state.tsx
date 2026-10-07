interface AppLoadingStateProps {
  title?: string;
  message?: string;
}

function LoadingBlock({ variant = "" }: { variant?: string }) {
  return (
    <span
      className={`app-loading__block${variant ? ` app-loading__block--${variant}` : ""}`}
    />
  );
}

// The critical styles live inline in index.html so this frame can paint before
// the application bundle, stylesheet, runtime config and fonts have downloaded.
export function AppLoadingState({
  title = "화면을 불러오는 중",
  message = "잠시만 기다려 주세요. 화면을 준비하고 있습니다.",
}: AppLoadingStateProps) {
  return (
    <main className="app-loading" aria-busy="true" aria-label="화면 로딩 중">
      <div className="app-loading__layout">
        <header className="app-loading__intro">
          <div>
            <p className="app-loading__eyebrow">PELAGIA-9</p>
            <h1>{title}</h1>
          </div>
          <div className="app-loading__notices">
            <p className="app-loading__status" role="status">
              <span className="app-loading__dot" aria-hidden="true" />
              {message}
            </p>
            <strong className="app-loading__cold-start">
              cold start 로 시간이 다소 소요됩니다. 첫 시작시 서버기동이 최대 약 15초, 월드 로딩에 최대 약 15초 소요가능
            </strong>
          </div>
        </header>

        <section className="app-loading__panel" aria-hidden="true">
          <LoadingBlock variant="heading" />
          <div className="app-loading__cards">
            {[0, 1, 2].map((index) => (
              <div key={index} className="app-loading__card">
                <LoadingBlock variant="short" />
                <LoadingBlock />
                <LoadingBlock variant="medium" />
              </div>
            ))}
          </div>
        </section>

        <div className="app-loading__pair" aria-hidden="true">
          <section className="app-loading__panel">
            <LoadingBlock variant="heading" />
            <LoadingBlock variant="chart" />
          </section>
          <section className="app-loading__panel">
            <LoadingBlock variant="heading" />
            {[0, 1].map((index) => (
              <div key={index} className="app-loading__row">
                <LoadingBlock variant="avatar" />
                <div className="app-loading__lines">
                  <LoadingBlock variant="medium" />
                  <LoadingBlock />
                </div>
              </div>
            ))}
          </section>
        </div>

        <div className="app-loading__pair" aria-hidden="true">
          <section className="app-loading__panel">
            <LoadingBlock variant="heading" />
            <LoadingBlock variant="message" />
            <LoadingBlock variant="reply" />
            <LoadingBlock variant="input" />
          </section>
          <section className="app-loading__panel">
            <LoadingBlock variant="heading" />
            <LoadingBlock variant="avatar" />
            <LoadingBlock />
            <LoadingBlock variant="medium" />
            <LoadingBlock />
          </section>
        </div>
      </div>
    </main>
  );
}
