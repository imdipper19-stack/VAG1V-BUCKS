import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

/**
 * Серверный layout для всех маршрутов `/partner/cabinet/*`.
 *
 * Защита базовая: убеждаемся, что в запросе присутствует cookie
 * `partner_token`. Сам JWT валидируется на бекенде в
 * `PartnerAuthGuard` при каждом обращении к `/api/partner/*`,
 * поэтому реальная безопасность держится там — здесь мы лишь
 * предотвращаем рендер UI кабинета анониму.
 *
 * Cookie ставится httpOnly из бекенда (см. `PartnerPublicController.login`),
 * клиентский JS его не видит → проверку обязательно делаем на сервере.
 *
 * Next.js 14: `cookies()` — синхронный. В Next.js 15 он становится
 * асинхронным; при апгрейде нужно будет добавить `await`.
 */
export default function PartnerCabinetLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const token = cookies().get('partner_token')?.value;

  if (!token) {
    redirect('/partner/login');
  }

  return <>{children}</>;
}
