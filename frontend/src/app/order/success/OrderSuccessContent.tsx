'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import VbucksIcon from '@/components/ui/VbucksIcon';

export default function OrderSuccessContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const orderId = searchParams.get('orderId') ?? '';
  const [countdown, setCountdown] = useState(5);

  // Автоматически редиректим на страницу заказа через 5 секунд
  useEffect(() => {
    if (!orderId) return;

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          router.push(`/order/${orderId}`);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [orderId, router]);

  return (
    <main className="min-h-screen bg-[#050507] text-[#f7f5ff] flex items-center justify-center p-6">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_8%,rgba(34,197,94,0.12),transparent_40%),linear-gradient(180deg,#07070a_0%,#050507_52%,#08070c_100%)]" />
      <div className="fixed inset-0 pointer-events-none opacity-50 [background-image:linear-gradient(rgba(255,255,255,.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.03)_1px,transparent_1px)] [background-size:34px_34px]" />

      <div className="relative z-10 w-full max-w-md text-center">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-10">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-[#8f5cff] to-[#6d42e8] shadow-[0_0_24px_rgba(143,92,255,.42)]">
            <VbucksIcon size={20} />
          </span>
          <span className="text-base font-extrabold tracking-[-.02em]">Bag1V-Bucks</span>
        </div>

        {/* Success icon */}
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6"
          style={{
            background: 'linear-gradient(135deg, #22c55e, #16a34a)',
            boxShadow: '0 8px 60px rgba(34, 197, 94, 0.5)',
          }}
        >
          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h1 className="text-3xl font-extrabold tracking-[-.05em] mb-3">
          Оплата прошла!
        </h1>
        <p className="text-[#aaa5b9] text-sm leading-7 mb-8">
          Платёж подтверждён. Теперь нужно авторизоваться через Epic Games — система автоматически зачислит V-Bucks на ваш аккаунт.
        </p>

        {orderId && (
          <div className="mb-6 rounded-2xl border border-white/10 bg-white/[.026] p-4 text-left">
            <span className="font-[var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[.08em] text-[#706b80]">ID заказа</span>
            <p className="mt-1 font-mono text-sm font-bold">#{orderId}</p>
          </div>
        )}

        {orderId ? (
          <>
            <Link
              href={`/order/${orderId}`}
              className="block w-full rounded-2xl bg-gradient-to-br from-[#8f5cff] to-[#6d42e8] px-5 py-4 text-sm font-extrabold shadow-[0_12px_42px_rgba(143,92,255,.32)] transition hover:-translate-y-0.5 text-center"
            >
              Перейти к авторизации Epic Games
            </Link>
            <p className="mt-4 text-xs text-[#706b80]">
              Автоматический переход через {countdown} сек...
            </p>
          </>
        ) : (
          <Link
            href="/"
            className="block w-full rounded-2xl bg-gradient-to-br from-[#8f5cff] to-[#6d42e8] px-5 py-4 text-sm font-extrabold text-center"
          >
            На главную
          </Link>
        )}
      </div>
    </main>
  );
}
