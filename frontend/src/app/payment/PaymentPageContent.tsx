'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import VbucksIcon from '@/components/ui/VbucksIcon';
import { ordersApi, paymentsApi } from '@/lib/api';

const TRY_RATE = 1.63;

export default function PaymentPageContent() {
  const searchParams = useSearchParams();
  const amount = Number(searchParams.get('amount'));
  const price = Number(searchParams.get('price'));
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'confirm' | 'creating' | 'redirecting'>('confirm');
  const [error, setError] = useState('');

  const isValidOrder = Number.isFinite(amount) && amount > 0 && Number.isFinite(price) && price > 0;
  const priceTRY = useMemo(() => Number((price / TRY_RATE).toFixed(2)), [price]);

  const handleContinue = async () => {
    if (!isValidOrder) return;

    setLoading(true);
    setError('');
    setStep('creating');

    try {
      // 1. Создаём заказ
      const orderResponse = await ordersApi.create({
        vbucksAmount: amount,
        priceTRY,
      });

      if (!orderResponse?.success || !orderResponse?.data?.orderId) {
        throw new Error('Не удалось создать заказ');
      }

      const { orderId, shortUrl } = orderResponse.data;

      // 2. Создаём инвойс AntiLav
      let paymentUrl: string | null = null;
      try {
        const invoiceResponse = await paymentsApi.createInvoice({
          orderId,
          amount: price,
          currency: 'RUB',
        });

        if (invoiceResponse?.success && invoiceResponse?.data?.paymentUrl) {
          paymentUrl = invoiceResponse.data.paymentUrl;
        }
      } catch (invoiceErr) {
        console.warn('Invoice creation failed, falling back to buyer page:', invoiceErr);
      }

      setStep('redirecting');

      // 3. Редиректим: на оплату если есть URL, иначе на buyer page
      if (paymentUrl) {
        window.location.href = paymentUrl;
      } else if (shortUrl) {
        window.location.href = shortUrl;
      } else {
        window.location.href = `/buyer?slug=${orderResponse.data.slug}`;
      }
    } catch (err) {
      console.error('Failed to create order:', err);
      setError('Ошибка создания заказа. Попробуйте позже.');
      setStep('confirm');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#050507] text-[#f7f5ff] relative overflow-hidden font-[var(--font-manrope)]">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_8%,rgba(143,92,255,0.18),transparent_34%),radial-gradient(circle_at_82%_42%,rgba(39,232,244,0.08),transparent_30%),linear-gradient(180deg,#07070a_0%,#050507_52%,#08070c_100%)]" />
      <div className="fixed inset-0 pointer-events-none opacity-70 [background-image:linear-gradient(rgba(255,255,255,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.035)_1px,transparent_1px)] [background-size:34px_34px]" />

      <div className="relative z-10 w-[min(1120px,calc(100%-32px))] mx-auto py-5 md:py-8">
        <nav className="w-[min(840px,100%)] mx-auto flex items-center justify-between gap-4 rounded-full border border-white/10 bg-[#0d0c12]/80 px-3 py-2 shadow-[0_18px_80px_rgba(0,0,0,.34)] backdrop-blur-xl">
          <Link href="/" className="flex items-center gap-2 text-sm font-extrabold tracking-[-.02em]">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-[#8f5cff] to-[#6d42e8] shadow-[0_0_24px_rgba(143,92,255,.42)]">
              <VbucksIcon size={18} />
            </span>
            Bag1V-Bucks
          </Link>
          <Link href="/" className="rounded-full border border-white/10 px-3 py-2 text-xs font-bold text-[#aaa5b9] hover:text-[#f7f5ff]">
            Вернуться назад
          </Link>
        </nav>

        <section className="grid min-h-[calc(100vh-120px)] items-center gap-8 py-14 lg:grid-cols-[1fr_.86fr]">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#8f5cff]/25 bg-[#8f5cff]/10 px-3 py-2 text-xs font-extrabold text-[#dcd3ff]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#41e59d] shadow-[0_0_14px_rgba(65,229,157,.9)]" />
              Экран оплаты заказа
            </div>
            <h1 className="max-w-2xl text-[clamp(48px,8vw,96px)] font-extrabold leading-[.86] tracking-[-.085em]">
              Оплата <span className="text-[#b79dff] drop-shadow-[0_0_36px_rgba(143,92,255,.42)]">V-Bucks</span>
            </h1>
            <p className="mt-5 max-w-xl text-[15px] leading-7 text-[#aaa5b9]">
              После выбора пакета вы будете перенаправлены на страницу оплаты АнтилопаPay. После успешной оплаты авторизуйтесь через Epic Games — бот автоматически зачислит V-Bucks на ваш аккаунт за 5–15 минут.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/[.026] p-4">
                <span className="font-[var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[.08em] text-[#706b80]">Epic Auth</span>
                <b className="mt-1 block text-sm">работает</b>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[.026] p-4">
                <span className="font-[var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[.08em] text-[#706b80]">Оплата</span>
                <b className="mt-1 block text-sm">АнтилопаPay</b>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[.026] p-4">
                <span className="font-[var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[.08em] text-[#706b80]">Выдача</span>
                <b className="mt-1 block text-sm">5-15 минут</b>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-8 rounded-[32px] bg-[#8f5cff]/25 blur-3xl" />
            <div className="relative overflow-hidden rounded-[28px] border border-white/15 bg-[linear-gradient(180deg,rgba(24,23,31,.96),rgba(10,10,14,.96))] p-5 shadow-[0_34px_110px_rgba(0,0,0,.62)]">
              {isValidOrder ? (
                <>
                  <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
                    <div>
                      <span className="font-[var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[.08em] text-[#706b80]">Выбранный пакет</span>
                      <h2 className="mt-1 text-2xl font-extrabold tracking-[-.05em]">{amount.toLocaleString('ru-RU')} V-Bucks</h2>
                    </div>
                    <div className="grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_50%_40%,rgba(39,232,244,.18),rgba(143,92,255,.12))]">
                      <VbucksIcon size={52} />
                    </div>
                  </div>

                  <div className="grid gap-3 py-5">
                    <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/10 p-4">
                      <span className="text-[#aaa5b9]">Сумма к оплате</span>
                      <b className="font-[var(--font-jetbrains-mono)] text-xl tracking-[-.05em]">{price.toLocaleString('ru-RU')} ₽</b>
                    </div>
                    <div className="rounded-2xl border border-[#8f5cff]/25 bg-[#8f5cff]/10 p-4">
                      <b className="block">Оплата через АнтилопаPay</b>
                      <span className="mt-1 block text-sm leading-6 text-[#aaa5b9]">После нажатия кнопки вы будете перенаправлены на страницу оплаты. V-Bucks будут зачислены автоматически после подтверждения платежа.</span>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-white/[.026] p-4">
                        <b className="block text-sm">Мы не храним пароль</b>
                        <span className="mt-1 block text-xs leading-5 text-[#aaa5b9]">Авторизация проходит отдельно через Epic Games.</span>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/[.026] p-4">
                        <b className="block text-sm">Живой статус заказа</b>
                        <span className="mt-1 block text-xs leading-5 text-[#aaa5b9]">После оплаты вы увидите таймер и этапы выдачи.</span>
                      </div>
                    </div>
                  </div>

                  {error && <div className="mb-4 rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}

                  {step === 'redirecting' && (
                    <div className="mb-4 rounded-2xl border border-[#41e59d]/20 bg-[#41e59d]/10 p-4 text-sm text-[#41e59d]">
                      Перенаправляем на страницу оплаты...
                    </div>
                  )}

                  <button
                    className="w-full rounded-2xl bg-gradient-to-br from-[#8f5cff] to-[#6d42e8] px-5 py-4 text-sm font-extrabold shadow-[0_12px_42px_rgba(143,92,255,.32)] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                    disabled={loading}
                    onClick={handleContinue}
                    type="button"
                  >
                    {step === 'creating' ? 'Создаём заказ...' : step === 'redirecting' ? 'Перенаправляем...' : 'Перейти к оплате'}
                  </button>
                </>
              ) : (
                <div className="py-8 text-center">
                  <h2 className="text-2xl font-extrabold tracking-[-.04em]">Пакет не выбран</h2>
                  <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-[#aaa5b9]">Вернитесь на главную страницу и выберите пакет V-Bucks для оплаты.</p>
                  <Link href="/#packages" className="mt-6 inline-flex rounded-2xl bg-gradient-to-br from-[#8f5cff] to-[#6d42e8] px-5 py-3 text-sm font-extrabold">
                    Выбрать пакет
                  </Link>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
