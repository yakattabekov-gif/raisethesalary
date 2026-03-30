import { ArrowLeft } from "lucide-react";

type Ticket = {
  id: number;
  route: string;
  plate: string;
  time: string;
  price: string;
  code: string;
};

const tickets: Ticket[] = [
  {
    id: 1,
    route: "141",
    plate: "877GL02",
    time: "29.03.26 13:25",
    price: "120 ₸",
    code: "E36F5",
  },
  {
    id: 2,
    route: "76",
    plate: "305GA02",
    time: "29.03.26 12:56",
    price: "120 ₸",
    code: "DF833",
  },
];

const LocationArrow = () => (
  <svg width="12" height="14" viewBox="0 0 12 14" fill="none" aria-hidden="true">
    <path d="M10.56 1.15L8.24 11.4C8.06 12.18 7.32 12.56 6.67 12.24L4.16 10.98L2.89 13.39C2.71 13.74 2.21 13.72 2.05 13.35L1.18 11.26C1.09 11.06 1.1 10.82 1.22 10.63L2.68 8.39L0.45 7.27C0.08 7.08 0.11 6.55 0.51 6.42L10.1 0.29C10.53 0.15 10.66 0.7 10.56 1.15Z" fill="currentColor" />
  </svg>
);

const SignalBars = () => (
  <svg width="19" height="14" viewBox="0 0 19 14" fill="none" aria-hidden="true">
    <rect x="0" y="7" width="3" height="7" rx="1.1" fill="currentColor" />
    <rect x="5" y="5" width="3" height="9" rx="1.1" fill="currentColor" />
    <rect x="10" y="3" width="3" height="11" rx="1.1" fill="currentColor" />
    <rect x="15" y="1" width="3" height="13" rx="1.1" fill="currentColor" />
  </svg>
);

const WifiIcon = () => (
  <svg width="18" height="14" viewBox="0 0 18 14" fill="none" aria-hidden="true">
    <path d="M9 10.8C9.83 10.8 10.5 11.47 10.5 12.3C10.5 13.13 9.83 13.8 9 13.8C8.17 13.8 7.5 13.13 7.5 12.3C7.5 11.47 8.17 10.8 9 10.8Z" fill="currentColor" />
    <path d="M14.63 8.23C13.12 6.72 11.11 5.9 9 5.9C6.89 5.9 4.88 6.72 3.37 8.23" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M17.05 5.48C14.85 3.28 11.98 2.07 9 2.07C6.02 2.07 3.15 3.28 0.95 5.48" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const BatteryIcon = () => (
  <svg width="27" height="14" viewBox="0 0 27 14" fill="none" aria-hidden="true">
    <rect x="0.75" y="1" width="22.5" height="12" rx="3" stroke="currentColor" strokeWidth="1.5" />
    <rect x="2.8" y="3.05" width="18.3" height="7.9" rx="1.8" fill="currentColor" />
    <rect x="24.3" y="4.3" width="2" height="5.4" rx="1" fill="currentColor" />
  </svg>
);

const TicketStamp = () => (
  <svg width="52" height="52" viewBox="0 0 52 52" fill="none" aria-hidden="true" style={{ width: 52, height: 52, flexShrink: 0 }}>
    <rect width="52" height="52" rx="12" fill="hsl(226 43% 97%)" />
    <path d="M2 13C12 11 21 13 26 18C31 23 39 25 50 22" stroke="hsl(235 28% 90%)" strokeWidth="1" />
    <path d="M1 28C12 26 22 28 27 33C32 38 39 40 51 37" stroke="hsl(235 28% 90%)" strokeWidth="1" />
    <path d="M8 1C13 9 14 18 12 26C10 34 11 43 16 51" stroke="hsl(235 28% 90%)" strokeWidth="1" />
    <path d="M27 1C31 10 31 18 29 26C27 34 27 43 31 51" stroke="hsl(235 28% 90%)" strokeWidth="1" />
    <path d="M0 25.5H19.8" stroke="hsl(41 100% 52%)" strokeWidth="4" strokeLinecap="round" />
    <path d="M32.2 25.5H52" stroke="hsl(41 100% 52%)" strokeWidth="4" strokeLinecap="round" />
    <circle cx="26" cy="26" r="9" fill="hsl(41 100% 52%)" />
    <path d="M21.6 23.2C21.6 21.76 22.76 20.6 24.2 20.6H27.8C29.24 20.6 30.4 21.76 30.4 23.2V27.2C30.4 28.64 29.24 29.8 27.8 29.8H24.2C22.76 29.8 21.6 28.64 21.6 27.2V23.2Z" stroke="white" strokeWidth="1.6" />
    <path d="M22.7 23.8H29.3" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M24.3 30.2V32.2" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M27.7 30.2V32.2" stroke="white" strokeWidth="1.4" strokeLinecap="round" />
    <circle cx="23.9" cy="27" r="0.9" fill="white" />
    <circle cx="28.1" cy="27" r="0.9" fill="white" />
  </svg>
);

const RouteBusIcon = () => (
  <svg width="19" height="19" viewBox="0 0 19 19" fill="none" aria-hidden="true">
    <path d="M4.5 2.8C4.5 2.03 5.13 1.4 5.9 1.4H13.1C13.87 1.4 14.5 2.03 14.5 2.8V11.7C14.5 12.47 13.87 13.1 13.1 13.1H5.9C5.13 13.1 4.5 12.47 4.5 11.7V2.8Z" stroke="currentColor" strokeWidth="1.8" />
    <path d="M6.1 4.2H8.7V7H6.1V4.2Z" fill="currentColor" />
    <path d="M10.3 4.2H12.9V7H10.3V4.2Z" fill="currentColor" />
    <path d="M3.6 8.8H15.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M6.25 14.4V16.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M12.75 14.4V16.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="6.25" cy="12.3" r="1.35" fill="currentColor" />
    <circle cx="12.75" cy="12.3" r="1.35" fill="currentColor" />
  </svg>
);

const TicketCard = ({ ticket }: { ticket: Ticket }) => (
  <article className="onay-ticket">
    <div className="onay-ticket-strip">
      <span className="onay-ticket-brand">ONAY!</span>
    </div>

    <div className="onay-ticket-body">
      <div className="onay-ticket-head">
        <div>
          <h2 className="onay-ticket-type">Автобус</h2>
          <p className="onay-ticket-city">Алматы</p>
        </div>
        <TicketStamp />
      </div>

      <div className="onay-ticket-rows">
        <div className="onay-ticket-row">
          <span className="onay-ticket-label">Маршрут:</span>
          <div className="onay-route-inline">
            <div className="text-[hsl(var(--onay-text))]">
              <RouteBusIcon />
            </div>
            <span className="onay-route-id">{ticket.route}</span>
            <span className="onay-route-badge">{ticket.plate}</span>
          </div>
        </div>

        <div className="onay-ticket-row">
          <span className="onay-ticket-label">Время:</span>
          <span className="onay-ticket-value">{ticket.time}</span>
        </div>

        <div className="onay-ticket-row">
          <span className="onay-ticket-label">Цена:</span>
          <span className="onay-ticket-value">{ticket.price}</span>
        </div>

        <div className="onay-ticket-row">
          <span className="onay-ticket-label">Код проверки:</span>
          <span className="onay-ticket-value">{ticket.code}</span>
        </div>
      </div>
    </div>
  </article>
);

const ColaBanner = () => (
  <section className="onay-banner" aria-label="Advertisement banner">
    <div className="onay-banner-left">
      <div className="onay-bottle" />
      <div className="onay-banner-kz">
        СӘТІ
        <br />
        КЕЛДІ
      </div>
    </div>

    <div className="onay-banner-right">
      <div className="onay-banner-over">САМОЕ</div>
      <div className="onay-banner-main">
        ВРЕМЯ ДЛЯ
      </div>
      <div className="onay-banner-script">Coca-Cola</div>
      <div className="onay-banner-footnote">
        ТАУАР ДЕКЛАРАЦИЯЛАНҒАН ЖӘ,
        <br />
        ТОВАР ЗАДЕКЛАРИРОВАН.
      </div>
    </div>
  </section>
);

const BottomFoodSheet = () => (
  <div className="onay-bottom-sheet" aria-hidden="true">
    <div className="onay-grabber" />
    <div className="onay-food-banner">
      <div className="onay-food-copy">
        ДОМ
        <br />
        ВСЕГДА
        <br />
        РЯДОМ.
      </div>
      <div className="onay-food-visual" />
    </div>
  </div>
);

const Index = () => {
  return (
    <main className="onay-stage">
      <section className="onay-phone" aria-label="ONAY mobile ticket screen mockup">
        <header className="onay-top">
          <div className="onay-logo-pill">ONAY!</div>

          <div className="onay-status-bar">
            <div className="onay-status-left text-[hsl(var(--onay-text))]">
              <span>16:51</span>
              <LocationArrow />
            </div>

            <div className="onay-status-right text-[hsl(var(--onay-text))]">
              <SignalBars />
              <WifiIcon />
              <BatteryIcon />
            </div>
          </div>

          <div className="onay-nav">
            <button className="onay-back-button" aria-label="Назад">
              <ArrowLeft size={33} strokeWidth={2.1} />
            </button>
            <h1 className="onay-title">Мои билеты</h1>
          </div>
        </header>

        <section className="onay-surface">
          <div className="onay-day-pill-wrap">
            <div className="onay-day-pill">Вчера</div>
          </div>

          <div className="onay-list">
            <TicketCard ticket={tickets[0]} />
            <ColaBanner />
            <TicketCard ticket={tickets[1]} />
          </div>

          <BottomFoodSheet />
        </section>
      </section>
    </main>
  );
};

export default Index;
