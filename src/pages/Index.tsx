import { ArrowLeft, Bus } from "lucide-react";

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

const TicketCard = ({ ticket }: { ticket: (typeof tickets)[0] }) => (
  <div className="relative bg-white rounded-2xl overflow-hidden shadow-sm">
    {/* Yellow left strip with ONAY! text */}
    <div className="absolute left-0 top-0 bottom-0 w-8 bg-[#F5A623] flex items-center justify-center">
      <span
        className="text-white font-extrabold text-xs tracking-widest"
        style={{
          writingMode: "vertical-rl",
          transform: "rotate(180deg)",
          letterSpacing: "2px",
        }}
      >
        ONAY!
      </span>
    </div>

    <div className="ml-8 p-4">
      {/* Header row */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-lg font-bold text-[#1a1a1a]">{ticket.type}</h3>
          <p className="text-sm text-[#888]">{ticket.city}</p>
        </div>
        {/* Bus icon */}
        <div className="w-12 h-12 flex items-center justify-center">
          <svg viewBox="0 0 48 48" width="48" height="48" fill="none">
            <circle cx="24" cy="24" r="20" stroke="#F5A623" strokeWidth="2" strokeDasharray="6 4" fill="none" />
            <g transform="translate(12, 14)">
              <rect x="2" y="2" width="20" height="14" rx="3" fill="#F5A623" />
              <rect x="4" y="4" width="7" height="6" rx="1" fill="white" />
              <rect x="13" y="4" width="7" height="6" rx="1" fill="white" />
              <circle cx="7" cy="18" r="2" fill="#F5A623" />
              <circle cx="17" cy="18" r="2" fill="#F5A623" />
              <line x1="22" y1="8" x2="24" y2="8" stroke="#F5A623" strokeWidth="2" strokeLinecap="round" />
            </g>
          </svg>
        </div>
      </div>

      {/* Details */}
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-[#888] w-24">Маршрут:</span>
          <div className="flex items-center gap-2">
            <Bus size={16} className="text-[#1a1a1a]" />
            <span className="font-semibold text-[#1a1a1a]">{ticket.route}</span>
            <span className="bg-[#f0f0f0] text-[#1a1a1a] px-2 py-0.5 rounded text-xs font-mono font-semibold">
              {ticket.plate}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[#888] w-24">Время:</span>
          <span className="font-bold text-[#1a1a1a]">{ticket.date}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[#888] w-24">Цена:</span>
          <span className="font-bold text-[#1a1a1a]">{ticket.price}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[#888] w-24">Код проверки:</span>
          <span className="font-extrabold text-[#1a1a1a] tracking-wide">{ticket.code}</span>
        </div>
      </div>
    </div>
  </div>
);

const AdBanner = () => (
  <div className="w-full rounded-2xl overflow-hidden shadow-sm">
    <div className="bg-[#D32F2F] flex items-center justify-between p-4 h-28">
      <div className="flex items-center gap-3">
        <div className="w-20 h-20 rounded-lg bg-[#B71C1C] flex items-center justify-center overflow-hidden">
          <div className="text-white text-center">
            <div className="text-xs font-bold leading-tight">СӘТІ</div>
            <div className="text-lg font-extrabold leading-tight">КЕЛДІ</div>
          </div>
        </div>
      </div>
      <div className="text-right text-white">
        <p className="text-xs font-bold uppercase">Самое</p>
        <p className="text-xl font-extrabold uppercase leading-tight">время для</p>
        <p className="text-2xl font-extrabold italic" style={{ fontFamily: "serif" }}>
          Coca-Cola
        </p>
        <p className="text-[8px] mt-1 text-white/70 leading-tight">
          ТАУАР ДЕКЛАРАЦИЯЛЫНҒАН ЖӘ,
          <br />
          ТОВАР ЗАДЕКЛАРИРОВАН.
        </p>
      </div>
    </div>
  </div>
);

const Index = () => {
  return (
    <div className="min-h-screen bg-[#f5f0eb] max-w-md mx-auto">
      {/* Status bar placeholder */}
      <div className="h-12" />

      {/* Header */}
      <div className="flex items-center px-4 pb-4 relative">
        <button className="absolute left-4">
          <ArrowLeft size={24} className="text-[#1a1a1a]" />
        </button>
        <h1 className="text-lg font-bold text-[#1a1a1a] w-full text-center">Мои билеты</h1>
        {/* ONAY logo */}
        <div className="absolute right-1/2 translate-x-1/2 -top-1">
          {/* We already have the title centered, logo goes top center */}
        </div>
      </div>

      {/* ONAY! badge - top center like the original */}
      <div className="flex justify-center -mt-14">
        <div className="bg-[#E53935] text-white text-xs font-extrabold px-3 py-1 rounded-full shadow-md tracking-wide">
          ONAY!
        </div>
      </div>
      <div className="h-6" />

      {/* Date separator */}
      <div className="flex justify-center mb-4">
        <span className="bg-white text-[#1a1a1a] text-sm font-medium px-5 py-1.5 rounded-full shadow-sm border border-[#e8e8e8]">
          Вчера
        </span>
      </div>

      {/* Ticket list */}
      <div className="px-4 space-y-4 pb-8">
        <TicketCard ticket={tickets[0]} />

        <AdBanner />

        <TicketCard ticket={tickets[1]} />
      </div>

      {/* Bottom indicator */}
      <div className="flex justify-center pb-6">
        <div className="w-32 h-1 bg-[#ccc] rounded-full" />
      </div>
    </div>
  );
};

export default Index;
