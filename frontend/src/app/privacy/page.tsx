import Link from 'next/link';

const DOMAIN = 'bag1v-bucks.shop';
const SITE_URL = `https://${DOMAIN}`;
const COMPANY = 'ОсОО «Глобал Бридж»';
const COMPANY_ADDRESS = 'Кыргызская Республика, г. Бишкек, Октябрьский район, улица Юнусалиева 185/1';
const COMPANY_OGRN = '309678-3301-ООО';
const COMPANY_INN = '9909704508';

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#050507] text-[#f7f5ff] font-[var(--font-manrope)]">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(circle_at_50%_8%,rgba(143,92,255,0.16),transparent_34%),linear-gradient(180deg,#07070a_0%,#050507_52%,#08070c_100%)]" />
      <div className="relative z-10 mx-auto w-[min(920px,calc(100%-32px))] py-8 md:py-12">
        <Link href="/" className="inline-flex rounded-full border border-white/10 bg-white/[.03] px-4 py-2 text-sm text-[#aaa5b9] hover:text-[#f7f5ff]">
          ← На главную
        </Link>
        <article className="mt-8 rounded-[32px] border border-white/10 bg-white/[.025] p-6 md:p-10">
          <span className="font-[var(--font-jetbrains-mono)] text-[11px] uppercase tracking-[.1em] text-[#706b80]">Bag1V-Bucks · {DOMAIN}</span>
          <h1 className="mt-4 text-[clamp(36px,6vw,72px)] font-extrabold leading-[.92] tracking-[-.07em]">Политика конфиденциальности и обработки файлов Cookie</h1>
          <div className="mt-8 grid gap-8 text-sm leading-7 text-[#aaa5b9]">

            <section>
              <h2 className="mb-3 text-lg font-extrabold tracking-[-.04em] text-[#f7f5ff]">Термины и их определения</h2>
              <div className="grid gap-3">
                <p><span className="text-[#f7f5ff] font-semibold">Политика</span> — настоящая Политика обработки персональных данных.</p>
                <p><span className="text-[#f7f5ff] font-semibold">Субъект персональных данных (Вы)</span> — физическое лицо, которое использует Сайт для получения услуг.</p>
                <p><span className="text-[#f7f5ff] font-semibold">GDPR</span> — Общий регламент ЕС о защите данных 2016/679.</p>
                <p><span className="text-[#f7f5ff] font-semibold">Персональные данные</span> — любая информация, относящаяся к идентифицированному или идентифицируемому физическому лицу.</p>
                <p><span className="text-[#f7f5ff] font-semibold">Обработка персональных данных</span> — любое действие с персональными данными, включая сбор, запись, хранение, уточнение, извлечение, использование, передачу, блокирование, удаление.</p>
                <p><span className="text-[#f7f5ff] font-semibold">Сайт</span> — <a href={SITE_URL} className="text-[#b79dff] hover:underline">{SITE_URL}</a>.</p>
                <p><span className="text-[#f7f5ff] font-semibold">Cookies</span> — небольшой текстовый файл, размещаемый Сайтом на Вашем устройстве при посещении определённых разделов Сайта.</p>
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-extrabold tracking-[-.04em] text-[#f7f5ff]">Предмет и основания обработки персональных данных</h2>
              <p>Положения настоящей Политики применяются к отношениям между нами и Вами, связанным с обработкой персональных данных в рамках использования Сайта и оказания Компанией услуг.</p>
              <p className="mt-3">Основанием обработки Ваших персональных данных всегда является Ваше согласие. Без согласия с условиями настоящей Политики мы не будем способны в полной мере обеспечить исполнение обязательств по заключаемым с Вами договорам.</p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-extrabold tracking-[-.04em] text-[#f7f5ff]">Срок Политики и обработки персональных данных</h2>
              <p>После принятия условий Политики она действует бессрочно. По общему правилу мы обрабатываем Ваши персональные данные на протяжении всего срока существования Личного кабинета, а также в течение 5 лет после его удаления.</p>
              <p className="mt-3">Политика может быть изменена нами в любой момент. После внесения изменений мы немедленно публикуем изменённую Политику на Сайте. Продолжение использования Сайта после изменений означает согласие с новой редакцией.</p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-extrabold tracking-[-.04em] text-[#f7f5ff]">Основания разработки, цели, принципы Политики</h2>
              <p>Политика разработана во исполнение требований: GDPR, CalOPPA, CCPA, PECR, ФЗ № 152-ФЗ и иных законов, определяющих особенности обработки персональных данных.</p>
              <p className="mt-3">Цели Политики: обеспечение защиты прав и свобод при обработке персональных данных; исключение несанкционированного доступа третьих лиц; обеспечение конфиденциальности и контроля Ваших данных; предоставление полного и прозрачного понимания относительно сбора и обработки данных.</p>
              <p className="mt-3">Принципы обработки: законность и справедливость; ограничение конкретными целями; соответствие объёма данных заявленным целям; точность и актуальность данных; хранение не дольше, чем требуют цели обработки.</p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-extrabold tracking-[-.04em] text-[#f7f5ff]">Состав собираемых персональных данных</h2>
              <div className="grid gap-3">
                <p><span className="text-[#f7f5ff] font-semibold">При регистрации:</span> имя (если указываете личное имя), электронная почта.</p>
                <p><span className="text-[#f7f5ff] font-semibold">Данные о Сервисе:</span> идентификатор личного кабинета пользователя на Сервисе, который может содержать персональные данные.</p>
                <p><span className="text-[#f7f5ff] font-semibold">Платёжные данные:</span> номер банковской карты, срок действия, код CVC2/CVV2. Обратите внимание: такие данные хранятся нашими платёжными партнёрами — мы НЕ собираем и НЕ храним платёжные данные.</p>
                <p><span className="text-[#f7f5ff] font-semibold">Технические данные:</span> IP-адрес, тип и версия браузера, операционная система, настройка часового пояса, информация о посещении веб-сайтов.</p>
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-extrabold tracking-[-.04em] text-[#f7f5ff]">Права субъекта персональных данных</h2>
              <div className="grid gap-3">
                <p><span className="text-[#f7f5ff] font-semibold">Получение информации.</span> Вы вправе получить сведения о наличии у нас Ваших персональных данных и ознакомиться с ними.</p>
                <p><span className="text-[#f7f5ff] font-semibold">Уточнение.</span> Вы вправе требовать уточнения, блокирования или уничтожения персональных данных, если они неполные, устаревшие или недостоверные.</p>
                <p><span className="text-[#f7f5ff] font-semibold">Порядок доступа.</span> Вы можете получить доступ к своим данным при личном обращении или путём направления письменного обращения. Мы обязаны ответить в течение 30 дней (может быть продлён до 60 дней).</p>
                <p><span className="text-[#f7f5ff] font-semibold">Отзыв согласия.</span> Вы вправе отозвать согласие на обработку персональных данных, ограничить способы и формы обработки.</p>
                <p><span className="text-[#f7f5ff] font-semibold">Право на обжалование.</span> Вы вправе обжаловать наши действия в уполномоченный орган по защите прав субъектов персональных данных или в судебном порядке.</p>
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-extrabold tracking-[-.04em] text-[#f7f5ff]">Передача персональных данных</h2>
              <p>Для достижения целей обработки нам может потребоваться предоставление Ваших персональных данных: платёжному партнёру и кредитным организациям; учреждениям по предотвращению мошенничества; государственным органам исполнительной власти.</p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-extrabold tracking-[-.04em] text-[#f7f5ff]">Хранение персональных данных</h2>
              <p>Если Вы гражданин государства-члена Европейской экономической зоны или Великобритании, Ваши данные собираются и обрабатываются на территории ЕЭЗ. Если Вы гражданин Российской Федерации, мы храним Ваши данные на серверах, расположенных на территории Российской Федерации.</p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-extrabold tracking-[-.04em] text-[#f7f5ff]">Файлы Cookies</h2>
              <p>Сайт использует файлы Cookies. При посещении Сайта Ваш браузер передаёт на наш сервер: дату и время посещения, тип браузера, языковые настройки, операционную систему.</p>
              <p className="mt-3"><span className="text-[#f7f5ff] font-semibold">Функциональные и технические Cookies</span> — позволяют серверу получить информацию о Вашей сессии, используемом языке, браузере, обеспечивают полноценную работу Сайта и персонализацию содержимого.</p>
              <p className="mt-3"><span className="text-[#f7f5ff] font-semibold">Аналитические Cookies</span> — позволяют оценить число посетителей и понять, как они перемещаются по Сайту. Вы вправе отказаться от аналитических Cookies в настройках браузера.</p>
              <p className="mt-3"><span className="text-[#f7f5ff] font-semibold">Сессионные Cookies</span> хранятся до закрытия браузера. <span className="text-[#f7f5ff] font-semibold">Постоянные Cookies</span> хранятся до окончания срока действия или до их удаления вами.</p>
              <p className="mt-3">У Вас есть возможность принять или отклонить все Cookies, изменив настройки в Вашем веб-браузере.</p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-extrabold tracking-[-.04em] text-[#f7f5ff]">Заключительные положения</h2>
              <p>Если одно или несколько положений Политики будут признаны недействительными, такие положения считаются замененными на максимально приближённые по смыслу действительные положения. Политика не может быть признана недействительной в полном объёме ни при каких обстоятельствах.</p>
            </section>

            <div className="rounded-2xl border border-white/10 bg-white/[.03] p-5">
              <p className="font-semibold text-[#f7f5ff]">{COMPANY}</p>
              <p className="mt-1">Адрес: {COMPANY_ADDRESS}</p>
              <p>Номер ОГРН: {COMPANY_OGRN}</p>
              <p>ИНН: {COMPANY_INN}</p>
              <p className="mt-2">Сайт: <a href={SITE_URL} className="text-[#b79dff] hover:underline">{SITE_URL}</a></p>
            </div>

          </div>
        </article>
      </div>
    </main>
  );
}
