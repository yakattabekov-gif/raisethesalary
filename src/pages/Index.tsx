import { ArrowLeft } from "lucide-react";

const tickets = [
  {
    id: 1,
    type: "Автобус",
    city: "Алматы",
    route: "141",
    plate: "877GL02",
    date: "29.03.26 13:25",
    price: "120 ₸",
    code: "E36F5",
  },
  {
    id: 2,
    type: "Автобус",
    city: "Алматы",
    route: "76",
    plate: "305GA02",
    date: "29.03.26 12:56",
    price: "120 ₸",
    code: "DF833",
  },
];

const BusLogo = () => (
  <div className="w-[52px] h-[52px] rounded-xl bg-white flex items-center justify-center"
    style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
    <svg width="40" height="28" viewBox="0 0 40 28" fill="none">
      {/* Arrow line through */}
      <line x1="0" y1="14" x2="40" y2="14" stroke="#F5A623" strokeWidth="2.5" />
      {/* Arrow head */}
      <polyline points="33,9 39,14 33,19" stroke="#F5A623" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* Bus body */}
      <rect x="10" y="6" width="18" height="16" rx="3" fill="#F5A623" />
      {/* Windows */}
      <rect x="12.5" y="8.5" width="5.5" height="5" rx="1" fill="white" />
      <rect x="20" y="8.5" width="5.5" height="5" rx="1" fill="white" />
      {/* Wheels */}
      <circle cx="15" cy="23" r="2" fill="#F5A623" />
      <circle cx="23" cy="23" r="2" fill="#F5A623" />
      {/* Wheel inner */}
      <circle cx="15" cy="23" r="0.8" fill="white" />
      <circle cx="23" cy="23" r="0.8" fill="white" />
    </svg>
  </div>
);

const BusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <rect x="2" y="1" width="12" height="11" rx="2" fill="#333" />
    <rect x="3.5" y="2.5" width="4" height="3.5" rx="0.5" fill="white" />
    <rect x="8.5" y="2.5" width="4" height="3.5" rx="0.5" fill="white" />
    <circle cx="5" cy="13.5" r="1.2" fill="#333" />
    <circle cx="11" cy="13.5" r="1.2" fill="#333" />
  </svg>
);

const TicketCard = ({ ticket }: { ticket: (typeof tickets)[0] }) => (
  <div className="bg-white rounded-2xl overflow-hidden flex"
    style={{ boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}>
    {/* Left red line + gray ONAY strip */}
    <div className="flex flex-shrink-0">
      {/* Thin red border */}
      <div className="w-[3px] bg-[#D93843]" />
      {/* Gray strip with ONAY! */}
      <div className="w-[28px] bg-[#f0eeeb] flex items-center justify-center relative">
        <span
          className="text-[#2d2d2d] font-black text-[10px] tracking-[1.5px] select-none"
          style={{
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
          }}
        >
          ONAY!
        </span>
      </div>
    </div>

    {/* Card content */}
    <div className="flex-1 py-4 pl-4 pr-4">
      {/* Header: type + city + bus logo */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-[17px] font-bold text-[#1a1a1a] leading-tight">{ticket.type}</h3>
          <p className="text-[13px] text-[#a0a0a0] mt-0.5">{ticket.city}</p>
        </div>
        <BusLogo />
      </div>

      {/* Details table */}
      <div className="space-y-[10px]">
        <div className="flex items-center">
          <span className="text-[14px] text-[#888] w-[110px]">Маршрут:</span>
          <div className="flex items-center gap-2.5">
            <BusIcon />
            <span className="text-[15px] font-semibold text-[#1a1a1a]">{ticket.route}</span>
            <span className="bg-[#f2f1ee] text-[#1a1a1a] px-2.5 py-[2px] rounded-md text-[13px] font-semibold tracking-wide border border-[#e5e3df]">
              {ticket.plate}
            </span>
          </div>
        </div>
        <div className="flex items-center">
          <span className="text-[14px] text-[#888] w-[110px]">Время:</span>
          <span className="text-[15px] font-bold text-[#1a1a1a]">{ticket.date}</span>
        </div>
        <div className="flex items-center">
          <span className="text-[14px] text-[#888] w-[110px]">Цена:</span>
          <span className="text-[15px] font-bold text-[#1a1a1a]">{ticket.price}</span>
        </div>
        <div className="flex items-center">
          <span className="text-[14px] text-[#888] w-[110px]">Код проверки:</span>
          <span className="text-[15px] font-extrabold text-[#1a1a1a] tracking-wide">{ticket.code}</span>
        </div>
      </div>
    </div>
  </div>
);

const AdBanner = () => (
  <div className="w-full rounded-2xl overflow-hidden"
    style={{ boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}>
    <div className="bg-[#CC0000] flex items-stretch h-[100px]">
      {/* Left side - bottle image area */}
      <div className="w-[40%] relative bg-gradient-to-r from-[#8B0000] to-[#CC0000] flex items-end justify-center p-2">
        <div className="text-white text-center">
          <p className="text-[11px] font-bold leading-tight">СӘТІ</p>
          <p className="text-[22px] font-black leading-tight">КЕЛДІ</p>
        </div>
      </div>
      {/* Right side - text */}
      <div className="flex-1 flex flex-col justify-center items-end pr-5 py-3">
        <p className="text-white text-[11px] font-bold uppercase tracking-wide">Самое</p>
        <p className="text-white text-[18px] font-extrabold uppercase leading-tight">время для</p>
        <p className="text-white text-[22px] font-extrabold italic leading-tight" style={{ fontFamily: "Georgia, serif" }}>
          Coca-Cola
        </p>
        <p className="text-white/50 text-[6px] mt-1 text-right leading-tight">
          ТАУАР ДЕКЛАРАЦИЯЛЫНҒАН ЖӘ,<br />
          ТОВАР ЗАДЕКЛАРИРОВАН.
        </p>
      </div>
    </div>
  </div>
);

const Index = () => {
  return (
    <div className="min-h-screen bg-[#f5f0ea]" style={{ maxWidth: 430, margin: "0 auto" }}>
      {/* iOS Status bar area */}
      <div className="flex items-center justify-between px-6 pt-3 pb-1">
        <span className="text-[15px] font-semibold text-[#1a1a1a]">16:51</span>
        <div className="bg-[#E53935] text-white text-[11px] font-extrabold px-3 py-[3px] rounded-full">
          ONAY!
        </div>
        <div className="flex items-center gap-1">
          <div className="flex gap-[2px]">
            {[1,2,3,4].map(i => (
              <div key={i} className="w-[3px] rounded-sm bg-[#1a1a1a]" style={{ height: 4 + i * 2 }} />
            ))}
          </div>
          <svg width="16" height="12" viewBox="0 0 16 12" fill="#1a1a1a">
            <path d="M8 3.5C9.7 3.5 11.2 4.2 12.3 5.3L13.7 3.9C12.3 2.5 10.3 1.5 8 1.5C5.7 1.5 3.7 2.5 2.3 3.9L3.7 5.3C4.8 4.2 6.3 3.5 8 3.5ZM8 7C8.8 7 9.6 7.3 10.2 7.9L11.6 6.5C10.6 5.5 9.4 5 8 5C6.6 5 5.4 5.5 4.4 6.5L5.8 7.9C6.4 7.3 7.2 7 8 7ZM8 9.5L9.5 11L11 9.5C10.2 8.7 9.2 8.2 8 8.2C6.8 8.2 5.8 8.7 5 9.5L6.5 11L8 9.5Z" />
          </svg>
          <svg width="22" height="12" viewBox="0 0 22 12" fill="none">
            <rect x="0" y="1" width="18" height="10" rx="2" stroke="#1a1a1a" strokeWidth="1.2" />
            <rect x="2" y="3" width="14" height="6" rx="1" fill="#1a1a1a" />
            <rect x="19" y="4" width="2" height="4" rx="0.5" fill="#1a1a1a" />
          </svg>
        </div>
      </div>

      {/* Navigation header */}
      <div className="flex items-center px-4 py-3 relative">
        <button className="z-10">
          <ArrowLeft size={26} strokeWidth={2.2} className="text-[#1a1a1a]" />
        </button>
        <h1 className="text-[18px] font-bold text-[#1a1a1a] absolute left-0 right-0 text-center">
          Мои билеты
        </h1>
      </div>

      {/* Scrollable content area with light blue-gray tint */}
      <div className="mx-3 rounded-t-3xl bg-[#ecedf2] min-h-[calc(100vh-100px)] pt-5 pb-8">
        {/* Date pill */}
        <div className="flex justify-center mb-4">
          <span className="bg-white text-[#1a1a1a] text-[13px] font-medium px-5 py-[6px] rounded-full border border-[#e0dfe3]"
            style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            Вчера
          </span>
        </div>

        {/* Cards */}
        <div className="px-3 space-y-3">
          <TicketCard ticket={tickets[0]} />
          <AdBanner />
          <TicketCard ticket={tickets[1]} />
        </div>
      </div>

      {/* Bottom home indicator */}
      <div className="flex justify-center py-4 bg-[#ecedf2]">
        <div className="w-[134px] h-[5px] bg-[#c8c8cc] rounded-full" />
      </div>
    </div>
  );
};

export default Index;
