import { Suspense } from 'react';
import PartnerInviteForm from './PartnerInviteForm';

/**
 * /partner/invite?token=… — установка пароля по invite-ссылке.
 *
 * На эту страницу партнёр попадает из Telegram — Owner копирует
 * ссылку из админки после одобрения заявки или регенерации
 * приглашения и присылает её партнёру вручную.
 *
 * Сервер-компонент-обёртка нужна, потому что вложенная форма
 * читает `?token=` через `useSearchParams()` — Next.js 14 App
 * Router требует Suspense вокруг таких клиентских компонентов.
 *
 * См. Requirement 11.2.
 */
export default function PartnerInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-sm" style={{ color: '#71717a' }}>
          Загрузка…
        </div>
      }
    >
      <PartnerInviteForm />
    </Suspense>
  );
}
