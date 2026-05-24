import { Suspense } from 'react';
import PartnerLoginForm from './PartnerLoginForm';

/**
 * /partner/login — публичный экран входа в кабинет партнёра.
 *
 * Точка входа для:
 *   - партнёра, переходящего по «Войти в кабинет партнёра» с лендинга;
 *   - партнёра, только что задавшего пароль через invite-link
 *     (попадёт сюда с `?passwordSet=1` для зелёного баннера);
 *   - middleware-редиректа из защищённого `/partner/cabinet/*`,
 *     когда `partner_token` cookie отсутствует.
 *
 * Сервер-компонент-обёртка нужен, потому что вложенная форма
 * читает query через `useSearchParams()` — Next.js требует Suspense
 * вокруг таких клиентских компонентов в App Router.
 *
 * См. Requirement 11.1, 11.3–11.4 / 11.6.
 */
export default function PartnerLoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-sm" style={{ color: '#71717a' }}>
          Загрузка…
        </div>
      }
    >
      <PartnerLoginForm />
    </Suspense>
  );
}
