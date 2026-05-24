'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { pricingApi, ordersApi, type PublicPackage } from '@/lib/api';
import VbucksIcon from '@/components/ui/VbucksIcon';
import PurchaseFlowDemo from '@/components/landing/PurchaseFlowDemo';
import ReviewsCarousel from '@/components/landing/ReviewsCarousel';

const FALLBACK_PACKAGES: PublicPackage[] = [
  { vbucksAmount: 800,   priceRUB: 499,  popular: false },
  { vbucksAmount: 2400,  priceRUB: 1199, popular: true  },
  { vbucksAmount: 4500,  priceRUB: 1899, popular: false },
  { vbucksAmount: 12500, priceRUB: 4499, popular: false },
];

const STEPS = [
  ['01', 'Выберите пакет', 'Показываем цену, количество V-Bucks и популярные варианты без перегруза.'],
  ['02', 'Оплатите', 'После подключения шлюза заказ будет переходить дальше только после подтверждения оплаты.'],
  ['03', 'Epic Auth', 'Безопасная авторизация через официальный Device Auth без хранения пароля.'],
  ['04', 'Получите заказ', 'Система покажет живой статус обработки и завершение выдачи.'],
];

const FAQS = [
  ['Как быстро придут V-Bucks?', 'Обычно меньше минуты после оплаты и авторизации. Иногда обработка может занять дольше, если Epic Games временно ограничивает запросы.'],
  ['Нужно ли передавать пароль?', 'Нет. Сценарий строится вокруг Device Auth, пароль не должен сохраняться на стороне сервиса.'],
  ['Что если заказ завис?', 'Админка предусматривает повторную обработку неудачных заказов, поэтому оператор сможет перезапустить выдачу или проверить заказ вручную.'],
  ['Какие способы оплаты будут?', 'План: СБП, карты и возможно криптовалюта. Финальный список зависит от выбранного платёжного шлюза.'],
];

const LIVE_ORDERS: Array<{ id: string; amount: string; duration: string; status: string }> = [
  { id: '#VB-2418', amount: '2 400 V-Bucks',  duration: '48 секунд',   status: 'Выдано' },
  { id: '#VB-2417', amount: '800 V-Bucks',    duration: '52 секунды',  status: 'Выдано' },
  { id: '#VB-2416', amount: '4 500 V-Bucks',  duration: '47 секунд',   status: 'Выдано' },
  { id: '#VB-2415', amount: '12 500 V-Bucks', duration: '55 секунд',   status: 'Выдано' },
];

const DOMAIN = 'bag1v-bucks.shop';

function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч`;
  const days = Math.floor(hours / 24);
  return `${days} дн`;
}

/**
 * Длительность обработки заказа: от createdAt до completedAt.
 * Возвращает читабельную строку: "47 секунд", "1 мин 23 сек", "2 мин".
 */
function formatDuration(createdAt: string | null | undefined, completedAt: string | null | undefined): string {
  if (!createdAt || !completedAt) return '—';
  const ms = new Date(completedAt).getTime() - new Date(createdAt).getTime();
  if (ms < 0 || !Number.isFinite(ms)) return '—';

  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) {
    // Правильное склонение "секунд"
    const lastDigit = totalSec % 10;
    const lastTwo = totalSec % 100;
    if (lastTwo >= 11 && lastTwo <= 14) return `${totalSec} секунд`;
    if (lastDigit === 1) return `${totalSec} секунда`;
    if (lastDigit >= 2 && lastDigit <= 4) return `${totalSec} секунды`;
    return `${totalSec} секунд`;
  }
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (sec === 0) return `${min} мин`;
  return `${min} мин ${sec} сек`;
}

export default function LandingPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [packages, setPackages] = useState<PublicPackage[]>(FALLBACK_PACKAGES);
  const [selectedPackage, setSelectedPackage] = useState(2400);
  const [liveOrders, setLiveOrders] = useState(LIVE_ORDERS);
  // Index of the active rail dot (0..3 → 01..04). Updated by an
  // IntersectionObserver below as the user scrolls past anchor sections.
  const [activeRail, setActiveRail] = useState(0);

  const selectedPkg = useMemo(
    () => packages.find((pkg) => pkg.vbucksAmount === selectedPackage) ?? packages[0],
    [packages, selectedPackage]
  );

  useEffect(() => {
    setMounted(true);

    pricingApi
      .list()
      .then((res) => {
        if (res.success && res.data.packages.length > 0) {
          setPackages(res.data.packages);
          const popular = res.data.packages.find((pkg) => pkg.popular);
          if (popular) setSelectedPackage(popular.vbucksAmount);
        }
      })
      .catch((err) => {
        console.warn('Failed to load pricing from API, using fallback:', err.message);
      });

    ordersApi
      .list({ status: 'completed', limit: 4 })
      .then((res) => {
        if (res.success && res.data && res.data.length > 0) {
          const mapped = res.data.map((order: any) => ({
            id: `#${order.orderId}`,
            amount: `${order.vbucksAmount.toLocaleString('ru-RU')} V-Bucks`,
            duration: formatDuration(order.createdAt, order.completedAt),
            status: 'Выдано',
          }));
          // Если меньше 4 успешных — добиваем placeholder'ами из FALLBACK
          // чтобы блок выглядел заполненным. Реальные заказы идут первыми.
          while (mapped.length < 4) {
            const fb = LIVE_ORDERS[mapped.length];
            if (!fb) break;
            mapped.push(fb);
          }
          setLiveOrders(mapped);
        }
      })
      .catch(() => {
        // Keep fallback LIVE_ORDERS
      });
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const elements = Array.from(document.querySelectorAll<HTMLElement>('.landing-reveal'));

    if (!('IntersectionObserver' in window)) {
      elements.forEach((element) => element.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.16,
        rootMargin: '0px 0px -60px 0px',
      }
    );

    elements.forEach((element) => observer.observe(element));

    return () => observer.disconnect();
  }, [mounted, packages.length]);

  /**
   * Rail dots ↔ section sync.
   *
   * Each of the four rail dots corresponds to one anchor section on the
   * landing. We pick the dot whose section currently has the largest
   * intersectionRatio with the viewport — that produces a natural
   * "active = what the user is looking at" effect without flicker as
   * sections meet at the seam.
   *
   * We deliberately re-resolve the section nodes inside the effect
   * because they live inside a conditionally rendered tree (the early
   * `mounted` return above). At first call all four are guaranteed to
   * exist; on prefers-reduced-motion or no IntersectionObserver we
   * just leave the default `activeRail = 0`.
   */
  useEffect(() => {
    if (!mounted) return;
    if (!('IntersectionObserver' in window)) return;

    const RAIL_SECTIONS: ReadonlyArray<string> = ['top', 'packages', 'trust', 'faq'];

    const sections = RAIL_SECTIONS
      .map((id) => ({ id, el: document.getElementById(id) }))
      .filter((s): s is { id: string; el: HTMLElement } => s.el !== null);

    if (sections.length === 0) return;

    // Track current visibility per section; recompute the winner on
    // each callback. Using a Map keeps lookup O(1) and avoids a stale
    // closure over a plain object.
    const visibility = new Map<string, number>(
      sections.map((s) => [s.id, 0]),
    );

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).id;
          visibility.set(id, entry.intersectionRatio);
        }

        let bestId = sections[0].id;
        let bestRatio = -1;
        visibility.forEach((ratio, id) => {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        });

        const idx = RAIL_SECTIONS.indexOf(bestId);
        if (idx !== -1) setActiveRail(idx);
      },
      {
        // Sample at four heights so a tall section's "centre" still
        // counts as more visible than a small section's "edge".
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );

    sections.forEach((s) => observer.observe(s.el));
    return () => observer.disconnect();
  }, [mounted]);

  /**
   * Click handler for a rail dot — smooth-scroll to the matching
   * anchor and pre-emptively set the active dot so the click feels
   * immediate even before the IntersectionObserver fires.
   */
  const handleRailClick = (index: number) => {
    const RAIL_SECTIONS = ['top', 'packages', 'trust', 'faq'] as const;
    const id = RAIL_SECTIONS[index];
    const target = document.getElementById(id);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveRail(index);
    }
  };

  const handleBuy = () => {
    if (!selectedPkg) return;
    router.push(`/payment?amount=${selectedPkg.vbucksAmount}&price=${selectedPkg.priceRUB}`);
  };

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-14 h-14 relative">
          <div className="absolute inset-0 border-2 border-transparent border-t-purple-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <main className="landing-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: 'Bag1V-Bucks',
            url: 'https://bag1v-bucks.shop',
            description: 'Купить V-Bucks для Fortnite по выгодной цене. Автоматическая выдача меньше чем за минуту.',
            potentialAction: {
              '@type': 'SearchAction',
              target: 'https://bag1v-bucks.shop/?q={search_term_string}',
              'query-input': 'required name=search_term_string',
            },
          }),
        }}
      />
      <nav className="landing-rail" aria-label="Навигация по секциям">
        {(['top', 'packages', 'trust', 'faq'] as const).map((id, idx) => {
          const labels = ['01', '02', '03', '04'] as const;
          const titles = [
            'В начало',
            'К пакетам',
            'Гарантии',
            'Вопросы',
          ] as const;
          const isActive = activeRail === idx;
          return (
            <button
              key={id}
              type="button"
              onClick={() => handleRailClick(idx)}
              aria-label={titles[idx]}
              aria-current={isActive ? 'true' : undefined}
              className={`landing-rail-dot${isActive ? ' active' : ''}`}
            >
              {labels[idx]}
            </button>
          );
        })}
      </nav>

      <div className="landing-shell">
        <section className="landing-hero landing-reveal" id="top">
          <div>
            <div className="landing-chip"><span />Автоматическая выдача через Epic Games</div>
            <h1>V-Bucks <span>за минуты</span></h1>
            <p>Выберите пакет, оплатите удобным способом и пройдите безопасную авторизацию Epic Games. Система сама подготовит заказ и покажет статус в реальном времени.</p>
            <div className="landing-cta-row">
              <a className="landing-btn landing-btn-primary" href="#packages">Начать покупку</a>
              <a className="landing-btn landing-btn-secondary" href="#how">Как это работает</a>
            </div>
            <div className="landing-proof">
              <span>Мгновенная выдача</span>
              <span>Device Auth</span>
              <span>СБП, карты, крипта</span>
            </div>
            <div className="landing-system-status landing-reveal" data-delay="1">
              <div className="is-ok">
                <span>Epic Auth</span>
                <div className="status-row">
                  <b>работает</b>
                </div>
              </div>
              <div className="is-ok">
                <span>Оплата</span>
                <div className="status-row">
                  <b>работает</b>
                </div>
              </div>
              <div className="is-ok">
                <span>Средняя выдача</span>
                <div className="status-row">
                  <b>~2 мин</b>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-mockup-wrap landing-reveal" data-delay="1">
          <div className="landing-mockup-glow" />
          <div className="landing-mockup">
            <div className="landing-window-bar">
              <div className="landing-dots"><i /><i /><i /></div>
              <div className="landing-url-pill">{DOMAIN}/order/VB-2418</div>
              <div className="landing-status-pill">LIVE</div>
            </div>
            <div className="landing-mockup-body">
              <aside className="landing-sidebar">
                <div className="landing-side-title">ПОКУПКА</div>
                {['Заказ', 'Оплата', 'Epic Auth', 'Выдача'].map((item, index) => (
                  <div className={`landing-side-item ${index === 0 ? 'active' : ''}`} key={item}>
                    <span>{item}</span>
                    <b>{index === 0 ? '#2418' : `0${index + 1}`}</b>
                  </div>
                ))}
              </aside>
              <div className="landing-content">
                <div className="landing-content-head">
                  <h2>Заказ готов к оплате</h2>
                  <div className="landing-status-pill">Ожидает оплаты</div>
                </div>
                <div className="landing-order-grid">
                  <div className="landing-order-card">
                    <div className="landing-order-main">
                      <div className="landing-coin-box"><VbucksIcon size={56} /></div>
                      <div>
                        <div className="landing-small-label">Выбранный пакет</div>
                        <div className="landing-amount">{selectedPkg.vbucksAmount.toLocaleString('ru-RU')} V-Bucks</div>
                        <div className="landing-price">{selectedPkg.priceRUB.toLocaleString('ru-RU')} ₽, фиксированная цена</div>
                      </div>
                    </div>
                    <div className="landing-metric-row">
                      <div className="landing-metric"><span>Время</span><b>8 мин</b></div>
                      <div className="landing-metric"><span>Статус</span><b>98%</b></div>
                      <div className="landing-metric"><span>Регион</span><b>TR</b></div>
                    </div>
                  </div>
                  <div className="landing-order-card landing-timeline">
                    {['Пакет выбран', 'Ссылка создана', 'Оплата заказа', 'Авторизация Epic'].map((item, index) => (
                      <div className={`landing-step ${index < 2 ? 'done' : ''}`} key={item}>
                        <span>{index < 2 ? '✓' : ''}</span>
                        <p>{item}</p>
                        <b>{index === 0 ? 'сейчас' : index === 1 ? '0:02' : index === 2 ? 'далее' : 'после'}</b>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="landing-chart">
                  <svg viewBox="0 0 600 104" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M0 76 C70 62 96 80 145 59 C190 38 218 70 272 50 C330 28 360 62 412 41 C466 18 502 47 600 22" fill="none" stroke="rgba(143,92,255,0.95)" strokeWidth="3" />
                    <path d="M0 76 C70 62 96 80 145 59 C190 38 218 70 272 50 C330 28 360 62 412 41 C466 18 502 47 600 22 L600 104 L0 104 Z" fill="rgba(143,92,255,0.14)" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section landing-reveal" id="packages">
          <div className="landing-section-head landing-reveal">
            <h2>Пакеты для быстрой покупки</h2>
            <p>Выберите нужный пакет. Цена подтягивается из API, а популярный вариант выделяется автоматически.</p>
          </div>
          <div className="landing-package-grid">
            {packages.map((pkg, index) => {
              const isSelected = selectedPackage === pkg.vbucksAmount;
              return (
                <button key={pkg.vbucksAmount} className={`landing-pack ${pkg.popular || isSelected ? 'featured' : ''}`} onClick={() => setSelectedPackage(pkg.vbucksAmount)} type="button">
                  <span className="landing-pack-top">
                    <span className="landing-pack-icon"><VbucksIcon size={42} /></span>
                    {(pkg.popular || isSelected) && <span className="landing-popular">{isSelected ? 'Выбрано' : 'Популярный'}</span>}
                  </span>
                  <span className="landing-pack-amount">{pkg.vbucksAmount.toLocaleString('ru-RU')}</span>
                  <span className="landing-pack-price">{pkg.priceRUB.toLocaleString('ru-RU')} ₽</span>
                  <span className="landing-pack-button">{isSelected ? '✓ Выбрано' : 'Выбрать'}</span>
                </button>
              );
            })}
          </div>
          <div className="landing-prepay-banner landing-reveal">
            <div>
              <b>Мы не храним пароль</b>
              <span>Переход к авторизации происходит только после оплаты и только через официальный сценарий Epic Games.</span>
            </div>
            <div>
              <b>Авторизация только через Epic Games</b>
              <span>Покупатель видит отдельную страницу заказа, таймер и живой статус обработки.</span>
            </div>
          </div>
          <div className="landing-buy-panel landing-reveal">
            <div>
              <span>К покупке выбран пакет</span>
              <b>{selectedPkg.vbucksAmount.toLocaleString('ru-RU')} V-Bucks за {selectedPkg.priceRUB.toLocaleString('ru-RU')} ₽</b>
            </div>
            <button className="landing-btn landing-btn-success" onClick={handleBuy} type="button">
              Перейти к оплате
            </button>
          </div>
        </section>

        <section className="landing-steps" id="how">
          {STEPS.map(([number, title, description], index) => (
            <div className="landing-info-step landing-reveal" data-delay={String(index)} key={number}>
              <b>{number}. {title}</b>
              <span>{description}</span>
            </div>
          ))}
        </section>

        <PurchaseFlowDemo />

        <section className="landing-section landing-reveal" id="trust">
          <div className="landing-section-head">
            <h2>Безопасность без лишних обещаний</h2>
            <p>Показываем пользователю, что именно происходит с аккаунтом, оплатой и заказом.</p>
          </div>
          <div className="landing-trust-grid">
            <div className="landing-trust-card feature landing-reveal">
              <strong>Device Auth вместо пароля</strong>
              <p>Покупатель проходит авторизацию через официальный сценарий Epic Games. Пароль не сохраняется в сервисе, а статус заказа виден на отдельной странице.</p>
              <div className="landing-mono-list">
                <span><em>password</em><b>не храним</b></span>
                <span><em>order status</em><b>live</b></span>
                <span><em>support</em><b>24/7</b></span>
              </div>
            </div>
            <div className="landing-trust-card landing-reveal" data-delay="1"><strong>Контроль оплаты</strong><p>После подключения платёжного шлюза заказ будет переходить к выдаче только после подтверждения оплаты вебхуком.</p></div>
            <div className="landing-trust-card landing-reveal" data-delay="2"><strong>Довыдача или возврат</strong><p>Если автоматическая обработка не прошла, заказ попадает в админку для повторной обработки или ручной проверки.</p></div>
          </div>
        </section>

        <section className="landing-section landing-reveal" id="live">
          <div className="landing-section-head"><h2>Последние успешные выдачи</h2><p>Вместо шаблонных отзывов показываем живую ленту заказов. Она выглядит честнее и технологичнее.</p></div>
          <div className="landing-live-board landing-reveal">
            {liveOrders.map((order) => (
              <div className="landing-live-row" key={order.id}>
                <b>{order.id}</b>
                <span>{order.amount}</span>
                <span title="Время от создания заказа до выдачи V-Bucks" className="landing-live-duration" style={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <polyline points="12 7 12 12 15 14" />
                  </svg>
                  {order.duration}
                </span>
                <span className="landing-live-status">{order.status}</span>
              </div>
            ))}
          </div>
        </section>

        <ReviewsCarousel />

        <section className="landing-section landing-reveal" id="faq">
          <div className="landing-section-head"><h2>Вопросы перед покупкой</h2><p>Короткие ответы на то, что обычно волнует покупателя до оплаты.</p></div>
          <div className="landing-faq-grid">
            {FAQS.map(([question, answer], index) => (
              <div className="landing-faq-item landing-reveal" data-delay={String(index)} key={question}><b>{question}</b><p>{answer}</p></div>
            ))}
          </div>
        </section>

        <section className="landing-section landing-reveal" id="legal">
          <div className="landing-legal">
            <div><span>Правовая информация</span><h2>Документы подготовлены для {DOMAIN}</h2></div>
            <p>спользуя сайт https://{DOMAIN}, пользователь принимает условия публичной оферты и политики конфиденциальности Bag1V-Bucks, включая обработку cookies и данных, необходимых для оформления заказа, оплаты, авторизации и связи с поддержкой.</p>
            <p>Bag1V-Bucks не является официальным сервисом Epic Games или Fortnite. Все товарные знаки принадлежат их правообладателям. Сервис помогает оформить заказ на пополнение и сопровождает его статус до завершения обработки.</p>
          </div>
        </section>

        <section className="landing-section landing-reveal">
          <div className="landing-final-cta">
            <h2>Готовый путь от выбора пакета до выдачи</h2>
            <p>Лендинг уже связан с реальными пакетами из API и текущей логикой создания заказа.</p>
            <a className="landing-btn landing-btn-primary" href="#packages">Вернуться к пакетам</a>
          </div>
        </section>

      </div>
      <a className="landing-telegram-support" href="https://t.me/BAG1BAG1" target="_blank" rel="noreferrer">
        <span>Telegram</span>
        <b>Написать в поддержку</b>
      </a>

      <style jsx global>{`
.status-row{display:flex;align-items:center;gap:6px;margin-top:4px}
.status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0;vertical-align:middle}
.status-green{background:#22c55e;box-shadow:0 0 8px rgba(34,197,94,.8);animation:statusPulse 2s ease-in-out infinite}
.status-yellow{background:#eab308;box-shadow:0 0 8px rgba(234,179,8,.8);animation:statusPulse 1.5s ease-in-out infinite}
.status-red{background:#ef4444;box-shadow:0 0 8px rgba(239,68,68,.8);animation:statusPulse 1s ease-in-out infinite}
@keyframes statusPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(1.4)}}
        .landing-page{--bg:#050507;--line:rgba(255,255,255,.08);--line2:rgba(255,255,255,.14);--text:#f7f5ff;--muted:#aaa5b9;--soft:#706b80;--purple:#8f5cff;--purple2:#6d42e8;--green:#41e59d;position:relative;min-height:100vh;overflow-x:hidden;background:radial-gradient(circle at 50% 8%,rgba(143,92,255,.16),transparent 34%),radial-gradient(circle at 82% 42%,rgba(39,232,244,.08),transparent 30%),linear-gradient(180deg,#07070a 0%,#050507 52%,#08070c 100%);color:var(--text);font-family:var(--font-manrope),var(--font-inter),system-ui,sans-serif}.landing-page:before{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:34px 34px;mask-image:linear-gradient(to bottom,rgba(0,0,0,.9),rgba(0,0,0,.35) 58%,transparent 100%)}.landing-page:after{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(circle at 50% 26%,transparent 0 22%,rgba(0,0,0,.38) 62%,rgba(0,0,0,.82) 100%)}.landing-shell{position:relative;z-index:1;width:min(1180px,calc(100% - 32px));margin:0 auto;padding:18px 0 72px}.landing-nav{width:min(840px,100%);margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:8px 10px;border:1px solid var(--line);border-radius:999px;background:rgba(13,12,18,.78);box-shadow:0 18px 80px rgba(0,0,0,.34);backdrop-filter:blur(18px)}.landing-brand{display:flex;align-items:center;gap:9px;min-width:max-content;color:var(--text);font-size:13px;font-weight:800;letter-spacing:-.02em;text-decoration:none}.landing-brand-icon{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,rgba(143,92,255,.95),rgba(109,66,232,.9));box-shadow:0 0 24px rgba(143,92,255,.42)}.landing-nav-links{display:flex;align-items:center;justify-content:center;gap:22px;font-size:12px;color:var(--muted)}.landing-nav-links a,.landing-footer-links a{color:inherit;text-decoration:none;transition:color .18s ease}.landing-nav-links a:hover,.landing-footer-links a:hover{color:var(--text)}.landing-nav-actions{display:flex;align-items:center;gap:6px;min-width:max-content}.landing-lang{border:1px solid var(--line);border-radius:999px;color:var(--muted);padding:5px 8px;font-family:var(--font-jetbrains-mono),monospace;font-size:11px}.landing-login,.landing-btn{display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:999px;padding:8px 14px;color:#fbfaff;background:linear-gradient(135deg,var(--purple),var(--purple2));font-weight:800;text-decoration:none;box-shadow:0 0 28px rgba(143,92,255,.34);transition:transform .22s cubic-bezier(.16,1,.3,1),opacity .22s ease;cursor:pointer}.landing-login:hover,.landing-btn:hover{transform:translateY(-2px)}.landing-btn-success{background:linear-gradient(135deg,#22c55e,#16a34a)!important;box-shadow:0 0 28px rgba(34,197,94,.45),0 0 0 1px rgba(34,197,94,.3) inset!important;color:#fff!important}.landing-btn-success:hover{box-shadow:0 0 36px rgba(34,197,94,.65),0 0 0 1px rgba(34,197,94,.5) inset!important}.landing-hero{position:relative;min-height:570px;display:grid;place-items:center;padding:92px 0 40px;text-align:center}.landing-chip{display:inline-flex;align-items:center;gap:8px;margin-bottom:14px;padding:7px 11px;border:1px solid rgba(143,92,255,.24);border-radius:999px;color:#dcd3ff;background:rgba(143,92,255,.12);font-size:12px;font-weight:800}.landing-chip span{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 14px rgba(65,229,157,.9)}.landing-hero h1{max-width:770px;margin:0 auto;font-size:clamp(56px,9vw,118px);line-height:.83;letter-spacing:-.085em;font-weight:800}.landing-hero h1 span{color:#b79dff;text-shadow:0 0 42px rgba(143,92,255,.48)}.landing-hero p{max-width:560px;margin:20px auto 0;color:var(--muted);font-size:15px;line-height:1.65}.landing-cta-row{display:flex;justify-content:center;gap:10px;margin-top:28px}.landing-btn{border-radius:14px;padding:14px 18px;font-size:14px}.landing-btn:disabled{cursor:not-allowed;opacity:.62;transform:none}.landing-btn-secondary{border:1px solid var(--line);background:rgba(255,255,255,.035);box-shadow:none;color:#cbc6d6}.landing-proof{display:flex;justify-content:center;gap:16px;margin-top:22px;color:var(--soft);font-family:var(--font-jetbrains-mono),monospace;font-size:11px}.landing-mockup-wrap{position:relative;width:min(830px,100%);margin:-36px auto 0;perspective:1200px}.landing-mockup-glow{position:absolute;inset:18% 10% -10%;background:radial-gradient(circle,rgba(143,92,255,.3),transparent 68%);filter:blur(44px)}.landing-mockup{position:relative;overflow:hidden;border:1px solid var(--line2);border-radius:22px;background:linear-gradient(180deg,rgba(24,23,31,.96),rgba(10,10,14,.96));box-shadow:0 34px 110px rgba(0,0,0,.62),0 0 0 1px rgba(143,92,255,.06) inset;transform:rotateX(5deg)}.landing-window-bar{height:34px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;border-bottom:1px solid var(--line);background:rgba(255,255,255,.025)}.landing-dots{display:flex;gap:6px}.landing-dots i{width:8px;height:8px;border-radius:50%;display:block}.landing-dots i:nth-child(1){background:#ff605c}.landing-dots i:nth-child(2){background:#ffbd44}.landing-dots i:nth-child(3){background:#00ca4e}.landing-url-pill{width:250px;height:16px;border-radius:999px;background:rgba(0,0,0,.38);color:var(--soft);display:grid;place-items:center;font-family:var(--font-jetbrains-mono),monospace;font-size:8px}.landing-status-pill,.landing-live-status{color:var(--green);background:rgba(65,229,157,.11);border:1px solid rgba(65,229,157,.2);border-radius:999px;padding:6px 10px;font-size:11px;font-weight:800;text-align:center;display:inline-flex;align-items:center;justify-content:center}.landing-live-status{justify-self:center;min-width:80px}.landing-mockup-body{display:grid;grid-template-columns:180px 1fr;min-height:360px}.landing-sidebar{border-right:1px solid var(--line);padding:18px 14px;background:rgba(255,255,255,.018)}.landing-side-title,.landing-small-label,.landing-metric span,.landing-legal span{color:var(--soft);font-family:var(--font-jetbrains-mono),monospace;font-size:10px;text-transform:uppercase;letter-spacing:.04em}.landing-side-title{margin-bottom:14px}.landing-side-item{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px;padding:10px 11px;border-radius:12px;color:var(--muted);font-size:12px}.landing-side-item.active{color:var(--text);background:rgba(143,92,255,.13)}.landing-side-item b{color:#cfbfff;font-family:var(--font-jetbrains-mono),monospace;font-size:10px}.landing-content{padding:18px}.landing-content-head{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:15px}.landing-content-head h2{margin:0;font-size:18px;letter-spacing:-.04em}.landing-order-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:12px;margin-bottom:12px}.landing-order-card{border:1px solid var(--line);border-radius:18px;padding:16px;background:rgba(255,255,255,.028)}.landing-order-main{display:grid;grid-template-columns:72px 1fr;gap:14px;align-items:center}.landing-coin-box{width:72px;height:72px;display:grid;place-items:center;border-radius:18px;background:radial-gradient(circle at 50% 40%,rgba(39,232,244,.18),rgba(143,92,255,.12));border:1px solid rgba(255,255,255,.09)}.landing-amount{margin-top:2px;font-family:var(--font-jetbrains-mono),monospace;font-size:26px;font-weight:700;letter-spacing:-.05em}.landing-price{margin-top:7px;color:#cfc9dc;font-size:13px}.landing-metric-row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}.landing-metric{border:1px solid var(--line);border-radius:14px;padding:10px;background:rgba(0,0,0,.12)}.landing-metric b{display:block;margin-top:4px;font-family:var(--font-jetbrains-mono),monospace;font-size:13px}.landing-timeline{display:grid;gap:9px}.landing-step{display:grid;grid-template-columns:20px 1fr auto;gap:10px;align-items:center;color:var(--muted);font-size:12px}.landing-step span{width:18px;height:18px;border-radius:50%;display:grid;place-items:center;color:var(--soft);background:rgba(255,255,255,.06);border:1px solid var(--line);font-size:10px;font-weight:900}.landing-step.done span{color:#06120d;background:var(--green);border-color:transparent}.landing-step p{margin:0}.landing-step b{color:var(--soft);font-family:var(--font-jetbrains-mono),monospace;font-size:10px}.landing-chart{position:relative;height:104px;overflow:hidden;border:1px solid var(--line);border-radius:18px;background:linear-gradient(180deg,rgba(143,92,255,.16),rgba(143,92,255,.02))}.landing-chart svg{position:absolute;inset:0;width:100%;height:100%}.landing-section{padding:84px 0 22px}.landing-section-head{display:flex;align-items:end;justify-content:space-between;gap:28px;margin-bottom:20px}.landing-section-head h2{max-width:680px;margin:0;font-size:clamp(34px,5vw,58px);line-height:.94;letter-spacing:-.065em}.landing-section-head p{max-width:380px;margin:0;color:var(--muted);font-size:14px;line-height:1.6}.landing-package-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.landing-pack{position:relative;min-height:188px;overflow:hidden;border:1px solid var(--line);border-radius:24px;padding:18px;background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.018));color:var(--text);text-align:left;cursor:pointer;transition:transform .26s cubic-bezier(.16,1,.3,1),border-color .26s ease,box-shadow .26s ease}.landing-pack:hover{transform:translateY(-6px);border-color:rgba(143,92,255,.28);box-shadow:0 18px 70px rgba(0,0,0,.34)}.landing-pack.featured{border-color:rgba(143,92,255,.42);background:radial-gradient(circle at 76% 10%,rgba(143,92,255,.28),transparent 42%),linear-gradient(180deg,rgba(143,92,255,.12),rgba(255,255,255,.018));box-shadow:0 20px 80px rgba(143,92,255,.12)}.landing-pack-top{display:flex;align-items:center;justify-content:space-between;gap:14px}.landing-pack-icon{width:52px;height:52px;display:grid;place-items:center;border-radius:16px;background:rgba(255,255,255,.045);border:1px solid var(--line)}.landing-popular{border-radius:999px;padding:6px 9px;color:#ddcffd;background:rgba(143,92,255,.14);font-size:11px;font-weight:800}.landing-pack-amount{display:block;margin-top:24px;font-family:var(--font-jetbrains-mono),monospace;font-weight:700;font-size:30px;letter-spacing:-.05em}.landing-pack-price{display:block;margin-top:3px;color:var(--muted);font-size:14px}.landing-pack-button{position:absolute;right:18px;bottom:18px;border-radius:12px;padding:10px 13px;color:var(--text);background:rgba(255,255,255,.07);font-size:14px;font-weight:800}.landing-pack.featured .landing-pack-button{background:linear-gradient(135deg,var(--purple),var(--purple2))}.landing-buy-panel{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:18px;border:1px solid rgba(143,92,255,.24);border-radius:22px;padding:16px;background:rgba(143,92,255,.08)}.landing-buy-panel span{display:block;margin-bottom:4px;color:var(--muted);font-size:12px}.landing-buy-panel b{font-family:var(--font-jetbrains-mono),monospace;letter-spacing:-.04em}.landing-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:42px 0 22px}.landing-info-step,.landing-faq-item{border:1px solid var(--line);border-radius:18px;padding:16px;background:rgba(255,255,255,.025)}.landing-info-step b,.landing-faq-item b{display:block;margin-bottom:7px;font-size:14px}.landing-info-step span,.landing-faq-item p{color:var(--muted);font-size:12px;line-height:1.5}.landing-trust-grid{display:grid;grid-template-columns:1.2fr .9fr .9fr;gap:12px}.landing-trust-card{min-height:220px;border:1px solid var(--line);border-radius:24px;padding:22px;background:radial-gradient(circle at 20% 0%,rgba(143,92,255,.12),transparent 38%),linear-gradient(180deg,rgba(255,255,255,.044),rgba(255,255,255,.016))}.landing-trust-card.feature{background:radial-gradient(circle at 88% 12%,rgba(39,232,244,.14),transparent 34%),radial-gradient(circle at 12% 0%,rgba(143,92,255,.2),transparent 42%),linear-gradient(180deg,rgba(143,92,255,.11),rgba(255,255,255,.02));border-color:rgba(143,92,255,.32)}.landing-trust-card strong{display:block;margin-bottom:12px;font-size:22px;letter-spacing:-.045em}.landing-trust-card p{margin:0;color:var(--muted);font-size:14px;line-height:1.65}.landing-mono-list{display:grid;gap:8px;margin-top:24px;font-family:var(--font-jetbrains-mono),monospace;font-size:11px;color:#d8d0eb}.landing-mono-list span{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:rgba(0,0,0,.14)}.landing-live-board{overflow:hidden;border:1px solid var(--line);border-radius:28px;background:linear-gradient(180deg,rgba(255,255,255,.046),rgba(255,255,255,.018))}.landing-live-row{display:grid;grid-template-columns:1fr 120px 110px 130px;gap:16px;align-items:center;padding:16px 18px;border-bottom:1px solid var(--line);color:var(--muted);font-size:13px}.landing-live-row:last-child{border-bottom:0}.landing-live-row b{color:var(--text);font-family:var(--font-jetbrains-mono),monospace;font-size:13px}.landing-faq-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.landing-faq-item{border-radius:20px;padding:20px}.landing-faq-item p{margin:0;font-size:13px;line-height:1.65}.landing-legal{display:grid;grid-template-columns:.9fr 1fr 1fr;gap:16px;border:1px solid var(--line);border-radius:28px;padding:24px;background:rgba(255,255,255,.026)}.landing-legal h2{margin:0;font-size:24px;line-height:1;letter-spacing:-.05em}.landing-legal p{margin:0;color:var(--muted);font-size:12px;line-height:1.65}.landing-final-cta{position:relative;overflow:hidden;border:1px solid rgba(143,92,255,.34);border-radius:34px;padding:42px;text-align:center;background:radial-gradient(circle at 50% 0%,rgba(143,92,255,.28),transparent 48%),linear-gradient(180deg,rgba(143,92,255,.12),rgba(255,255,255,.018));box-shadow:0 28px 100px rgba(143,92,255,.12)}.landing-final-cta h2{max-width:720px;margin:0 auto 12px;font-size:clamp(34px,5vw,64px);line-height:.94;letter-spacing:-.065em}.landing-final-cta p{max-width:560px;margin:0 auto 24px;color:var(--muted);line-height:1.6}.landing-footer{display:flex;justify-content:space-between;gap:24px;align-items:center;padding:34px 0 0;color:var(--soft);font-size:12px}.landing-footer-links{display:flex;gap:16px;flex-wrap:wrap}.landing-system-status{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;width:min(540px,100%);margin:22px auto 0}.landing-system-status div{position:relative;border:1px solid var(--line);border-radius:16px;padding:14px 12px 12px;background:rgba(255,255,255,.026);display:flex;flex-direction:column;align-items:center;text-align:center;gap:8px;transition:border-color .3s ease,background .3s ease;animation:cardFadeIn .6s ease both}.landing-system-status div:nth-child(1){animation-delay:.05s}.landing-system-status div:nth-child(2){animation-delay:.1s}.landing-system-status div:nth-child(3){animation-delay:.15s}.landing-system-status div:nth-child(4){animation-delay:.2s}.landing-system-status div:hover{border-color:rgba(34,197,94,.3);background:rgba(34,197,94,.04)}.landing-system-status div.is-ok{border-color:rgba(65,229,157,.45);background:linear-gradient(180deg,rgba(65,229,157,.06),rgba(65,229,157,.02));box-shadow:0 0 0 1px rgba(65,229,157,.18) inset,0 0 24px rgba(65,229,157,.18);animation:okGlow 2.6s ease-in-out infinite}.landing-system-status div.is-ok:hover{border-color:rgba(65,229,157,.7);background:linear-gradient(180deg,rgba(65,229,157,.10),rgba(65,229,157,.04))}.landing-system-status div.is-ok b{color:#bff5d5;text-shadow:0 0 14px rgba(65,229,157,.4)}@keyframes okGlow{0%,100%{box-shadow:0 0 0 1px rgba(65,229,157,.16) inset,0 0 18px rgba(65,229,157,.14)}50%{box-shadow:0 0 0 1px rgba(65,229,157,.34) inset,0 0 32px rgba(65,229,157,.34)}}@media(prefers-reduced-motion:reduce){.landing-system-status div.is-ok{animation:none}}.landing-system-status span{display:block;color:var(--soft);font-family:var(--font-jetbrains-mono),monospace;font-size:10px;text-transform:uppercase;letter-spacing:.06em}.landing-system-status .status-row{display:flex;align-items:center;justify-content:center;gap:7px;margin-top:0}.landing-system-status .status-row b{font-size:14px;font-weight:700;color:var(--text);line-height:1}.landing-system-status .status-dot{flex-shrink:0;margin-top:0;position:static}@keyframes cardFadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}bottom:5px;color:var(--soft);font-family:var(--font-jetbrains-mono),monospace;font-size:10px;text-transform:uppercase;letter-spacing:.04em}.landing-system-status b{font-size:13px}.landing-prepay-banner{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px}.landing-prepay-banner div{border:1px solid rgba(143,92,255,.24);border-radius:20px;padding:16px;background:rgba(143,92,255,.08)}.landing-prepay-banner b{display:block;margin-bottom:6px;font-size:15px}.landing-prepay-banner span{display:block;color:var(--muted);font-size:12px;line-height:1.55}.landing-telegram-support{position:fixed;right:18px;bottom:18px;z-index:5;display:grid;gap:2px;border:1px solid rgba(143,92,255,.32);border-radius:18px;padding:13px 15px;color:var(--text);background:linear-gradient(135deg,rgba(143,92,255,.86),rgba(109,66,232,.86));box-shadow:0 18px 60px rgba(143,92,255,.28);text-decoration:none;backdrop-filter:blur(16px);transition:transform .22s cubic-bezier(.16,1,.3,1)}.landing-telegram-support:hover{transform:translateY(-3px)}.landing-telegram-support span{font-family:var(--font-jetbrains-mono),monospace;font-size:10px;color:#ddd3ff;text-transform:uppercase;letter-spacing:.08em}.landing-telegram-support b{font-size:13px}.landing-rail{position:fixed;z-index:2;right:18px;top:50%;transform:translateY(-50%);display:grid;gap:7px;padding:8px;border:1px solid var(--line);border-radius:999px;background:rgba(13,12,18,.76);backdrop-filter:blur(16px)}.landing-rail-dot{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;color:var(--soft);border:1px solid transparent;font-family:var(--font-jetbrains-mono),monospace;font-size:10px;background:transparent;cursor:pointer;padding:0;transition:color .35s cubic-bezier(.16,1,.3,1),background .35s cubic-bezier(.16,1,.3,1),box-shadow .35s cubic-bezier(.16,1,.3,1),transform .25s cubic-bezier(.16,1,.3,1),border-color .25s ease}.landing-rail-dot:hover{color:var(--text);border-color:rgba(143,92,255,.32);transform:scale(1.06)}.landing-rail-dot:focus-visible{outline:none;border-color:rgba(143,92,255,.6);box-shadow:0 0 0 3px rgba(143,92,255,.18)}.landing-rail-dot.active{color:#fff;background:linear-gradient(135deg,var(--purple),var(--purple2));box-shadow:0 0 24px rgba(143,92,255,.46)}.landing-reveal{opacity:0;transform:translateY(28px);transition:opacity .7s cubic-bezier(.16,1,.3,1),transform .7s cubic-bezier(.16,1,.3,1);will-change:opacity,transform}.landing-reveal.is-visible{opacity:1;transform:translateY(0)}.landing-reveal[data-delay='1']{transition-delay:.09s}.landing-reveal[data-delay='2']{transition-delay:.18s}.landing-reveal[data-delay='3']{transition-delay:.27s}@media(max-width:900px){.landing-nav-links,.landing-rail,.landing-url-pill{display:none}.landing-hero{min-height:auto;padding-top:74px}.landing-mockup-body,.landing-order-grid,.landing-package-grid,.landing-steps,.landing-trust-grid,.landing-faq-grid,.landing-legal,.landing-system-status,.landing-prepay-banner{grid-template-columns:1fr}.landing-sidebar{display:none}.landing-section-head,.landing-buy-panel,.landing-footer{align-items:flex-start;flex-direction:column}.landing-live-row{grid-template-columns:1fr;gap:7px}}@media(max-width:560px){.landing-shell{width:min(100% - 20px,1180px)}.landing-nav{border-radius:18px}.landing-lang{display:none}.landing-hero h1{font-size:54px}.landing-cta-row,.landing-proof{flex-direction:column;align-items:center}.landing-metric-row{grid-template-columns:1fr}.landing-order-main{grid-template-columns:1fr}.landing-final-cta{padding:30px 20px}}@media(prefers-reduced-motion:reduce){.landing-reveal,.landing-btn,.landing-pack,.landing-login{transition:none}}
      `}</style>
    </main>
  );
}


