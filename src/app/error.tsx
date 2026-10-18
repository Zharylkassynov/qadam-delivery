'use client';

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="boot-screen"><div className="panel"><h1>Не удалось открыть приложение</h1><p>Попробуйте загрузить страницу ещё раз.</p><button className="button primary" onClick={reset}>Повторить</button></div></main>;
}
