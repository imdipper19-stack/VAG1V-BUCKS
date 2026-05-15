import Link from 'next/link';

const DOMAIN = 'bag1v-bucks.shop';

export default function CookiesPage() {
  return (
    <main className="min-h-screen bg-[#050507] text-[#f7f5ff] font-[var(--font-manrope)]">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_8%,rgba(143,92,255,0.16),transparent_34%),linear-gradient(180deg,#07070a_0%,#050507_52%,#08070c_100%)]" />
      <div className="relative z-10 mx-auto w-[min(920px,calc(100%-32px))] py-8 md:py-12">
        <Link href="/" className="inline-flex rounded-full border border-white/10 bg-white/[.03] px-4 py-2 text-sm text-[#aaa5b9] hover:text-[#f7f5ff]">
          ← На главную
        </Link>
        <article className="mt-8 rounded-[32px] border border-white/10 bg-white/[.025] p-6 md:p-10">
          <span className="font-[var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[.1em] text-[#706b80]">Bag1V-Bucks · {DOMAIN}</span>
          <h1 className="mt-4 text-[clamp(36px,6vw,72px)] font-extrabold leading-[.92] tracking-[-.07em]">Cookie policy</h1>
          <div className="mt-8 grid gap-6 text-sm leading-7 text-[#aaa5b9]">
            <section>
              <h2 className="mb-2 text-xl font-extrabold tracking-[-.04em] text-[#f7f5ff]">1. Что такое cookies</h2>
              <p>Cookies — небольшие технические файлы, которые сайт https://{DOMAIN} может сохранять в браузере пользователя для корректной работы интерфейса и функций заказа.</p>
            </section>
            <section>
              <h2 className="mb-2 text-xl font-extrabold tracking-[-.04em] text-[#f7f5ff]">2. Зачем используются cookies</h2>
              <p>Cookies помогают сохранять состояние интерфейса, улучшать стабильность сайта, анализировать ошибки и обеспечивать корректную работу авторизации и страницы заказа.</p>
            </section>
            <section>
              <h2 className="mb-2 text-xl font-extrabold tracking-[-.04em] text-[#f7f5ff]">3. Технические cookies</h2>
              <p>Некоторые cookies необходимы для работы сайта. Без них отдельные функции, включая оформление заказа и административный вход, могут работать некорректно.</p>
            </section>
            <section>
              <h2 className="mb-2 text-xl font-extrabold tracking-[-.04em] text-[#f7f5ff]">4. Управление cookies</h2>
              <p>Пользователь может ограничить или удалить cookies в настройках браузера. При этом часть функций сайта может быть недоступна или работать нестабильно.</p>
            </section>
            <section>
              <h2 className="mb-2 text-xl font-extrabold tracking-[-.04em] text-[#f7f5ff]">5. Обновление политики</h2>
              <p>Bag1V-Bucks может обновлять Cookie policy при изменении функциональности сайта, платёжного сценария или требований безопасности.</p>
            </section>
          </div>
        </article>
      </div>
    </main>
  );
}
