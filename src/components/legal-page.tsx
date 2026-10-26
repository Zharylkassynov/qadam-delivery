import type { ReactNode } from 'react';

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return <main className="legal-page"><header><a href="/">Вернуться в Qadam</a><h1>{title}</h1><p className="muted">Редакция от 26 октября 2026</p><p>Оператор — Команда Qadam. Поддержка, исправление и удаление данных: <a href="https://t.me/zharlkssnv">@zharlkssnv</a>.</p></header>{children}</main>;
}
