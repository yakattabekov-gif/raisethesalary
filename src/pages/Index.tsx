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
  { id: 1, route: "141", plate: "877GL02", time: "29.03.26 13:25", price: "120 ₸", code: "E36F5" },
  { id: 2, route: "76", plate: "305GA02", time: "29.03.26 12:56", price: "120 ₸", code: "DF833" },
];

/* ── tiny inline SVGs ── */

const TicketStamp = () => (
  <svg width="52" height="52" viewBox="0 0 52 52" fill="none" style={{ width: 52, height: 52, flexShrink: 0 }}>
    <rect width="52" height="52" rx="12" fill="#f0f1f6" />
    <path d="M2 13C12 11 21 13 26 18C31 23 39 25 50 22" stroke="#dddee6" strokeWidth="1" />
    <path d="M1 28C12 26 22 28 27 33C32 38 39 40 51 37" stroke="#dddee6" strokeWidth="1" />
    <path d="M8 1C13 9 14 18 12 26C10 34 11 43 16 51" stroke="#dddee6" strokeWidth="1" />
    <path d="M27 1C31 10 31 18 29 26C27 34 27 43 31 51" stroke="#dddee6" strokeWidth="1" />
    <line x1="0" y1="26" x2="18" y2="26" stroke="#F5A623" strokeWidth="3.5" strokeLinecap="round" />
    <line x1="34" y1="26" x2="52" y2="26" stroke="#F5A623" strokeWidth="3.5" strokeLinecap="round" />
    <circle cx="26" cy="26" r="9" fill="#F5A623" />
    <rect x="21.5" y="20.5" width="9" height="8" rx="2" stroke="white" strokeWidth="1.5" />
    <line x1="22.5" y1="24" x2="29.5" y2="24" stroke="white" strokeWidth="1.2" />
    <line x1="24" y1="29" x2="24" y2="31.5" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
    <line x1="28" y1="29" x2="28" y2="31.5" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
    <circle cx="24" cy="27" r="0.9" fill="white" />
    <circle cx="28" cy="27" r="0.9" fill="white" />
  </svg>
);

const BusIcon = () => (
  <svg width="16" height="18" viewBox="0 0 16 18" fill="none" style={{ width: 16, height: 18 }}>
    <rect x="2" y="1" width="12" height="11" rx="2.5" stroke="#1a1a1a" strokeWidth="1.5" />
    <rect x="3.8" y="3" width="3.6" height="3" rx="0.6" fill="#1a1a1a" />
    <rect x="8.6" y="3" width="3.6" height="3" rx="0.6" fill="#1a1a1a" />
    <line x1="1" y1="8" x2="15" y2="8" stroke="#1a1a1a" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="5" cy="11" r="1" fill="#1a1a1a" />
    <circle cx="11" cy="11" r="1" fill="#1a1a1a" />
    <line x1="5" y1="13" x2="5" y2="15.5" stroke="#1a1a1a" strokeWidth="1.5" strokeLinecap="round" />
    <line x1="11" y1="13" x2="11" y2="15.5" stroke="#1a1a1a" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/* ── Ticket card ── */
const TicketCard = ({ ticket }: { ticket: Ticket }) => (
  <div style={{
    display: "flex",
    borderRadius: 16,
    overflow: "hidden",
    background: "white",
    boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
  }}>
    {/* Left strip: red edge + gray ONAY */}
    <div style={{ display: "flex", flexShrink: 0 }}>
      <div style={{ width: 3.5, background: "#d93843", borderRadius: "16px 0 0 16px" }} />
      <div style={{
        width: 32,
        background: "#e8e9ef",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
      }}>
        <span style={{
          writingMode: "vertical-rl" as const,
          transform: "rotate(180deg)",
          fontSize: 11,
          fontWeight: 900,
          color: "#2e3044",
          letterSpacing: "0.04em",
        }}>ONAY!</span>
      </div>
    </div>

    {/* Card body */}
    <div style={{ flex: 1, padding: "16px 16px 14px 14px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#1a1a2e", lineHeight: 1.1 }}>Автобус</div>
          <div style={{ fontSize: 14, color: "#9a9a9a", marginTop: 3, fontWeight: 400 }}>Алматы</div>
        </div>
        <TicketStamp />
      </div>

      {/* Details rows */}
      <div style={{ display: "grid", gap: 10 }}>
        <Row label="Маршрут:">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <BusIcon />
            <span style={{ fontSize: 17, fontWeight: 700, color: "#1a1a2e" }}>{ticket.route}</span>
            <span style={{
              fontSize: 14,
              fontWeight: 500,
              color: "#1a1a2e",
              background: "#f0f1f4",
              border: "1px solid #e4e5ea",
              borderRadius: 7,
              padding: "3px 10px",
              letterSpacing: "0.02em",
            }}>{ticket.plate}</span>
          </div>
        </Row>
        <Row label="Время:"><Val>{ticket.time}</Val></Row>
        <Row label="Цена:"><Val>{ticket.price}</Val></Row>
        <Row label="Код проверки:"><Val>{ticket.code}</Val></Row>
      </div>
    </div>
  </div>
);

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: "grid", gridTemplateColumns: "105px 1fr", alignItems: "center" }}>
    <span style={{ fontSize: 14, color: "#6b6b6b", fontWeight: 400 }}>{label}</span>
    <div>{children}</div>
  </div>
);

const Val = ({ children }: { children: React.ReactNode }) => (
  <span style={{ fontSize: 17, fontWeight: 700, color: "#1a1a2e", letterSpacing: "-0.01em" }}>{children}</span>
);

/* ── Ad banner ── */
const ColaBanner = () => (
  <div style={{
    display: "flex",
    height: 94,
    borderRadius: 16,
    overflow: "hidden",
    background: "linear-gradient(135deg, #d72638 0%, #b71c2c 100%)",
    boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
  }}>
    <div style={{
      width: 110,
      flexShrink: 0,
      position: "relative",
      background: "linear-gradient(90deg, #c62828 0%, #b71c1c 100%)",
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-end",
      padding: "0 14px 10px",
    }}>
      {/* Simplified bottle shape */}
      <div style={{
        position: "absolute",
        left: "50%",
        top: -2,
        transform: "translateX(-50%)",
        width: 40,
        height: 100,
        borderRadius: "10px 10px 12px 12px",
        background: "linear-gradient(90deg, #4a2410 0%, #6b3a20 30%, #4a2410 70%, #6b3a20 100%)",
        opacity: 0.7,
      }}>
        <div style={{
          position: "absolute",
          left: "50%",
          top: 16,
          transform: "translateX(-50%)",
          width: 32,
          height: 42,
          borderRadius: 10,
          background: "rgba(255,255,255,0.85)",
        }} />
      </div>
      <div style={{ color: "white", fontWeight: 800, fontSize: 16, lineHeight: 0.92, zIndex: 1, letterSpacing: "-0.02em" }}>
        СӘТІ<br />КЕЛДІ
      </div>
    </div>
    <div style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "flex-end",
      padding: "8px 14px",
      color: "white",
      textAlign: "right",
    }}>
      <div style={{ fontSize: 12, fontWeight: 900 }}>САМОЕ</div>
      <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 0.9, textTransform: "uppercase", letterSpacing: "-0.03em" }}>ВРЕМЯ ДЛЯ</div>
      <div style={{ fontSize: 22, fontWeight: 700, fontStyle: "italic", fontFamily: "Georgia, serif", lineHeight: 1.1, marginTop: 2 }}>Coca-Cola</div>
      <div style={{ fontSize: 6, color: "rgba(255,255,255,0.55)", marginTop: 4, lineHeight: 1.2 }}>
        ТАУАР ДЕКЛАРАЦИЯЛАНҒАН ЖӘ,<br />ТОВАР ЗАДЕКЛАРИРОВАН.
      </div>
    </div>
  </div>
);

/* ── Bottom sheet with food ad ── */
const BottomSheet = () => (
  <div style={{
    borderRadius: "28px 28px 0 0",
    background: "white",
    boxShadow: "0 -3px 12px rgba(0,0,0,0.03)",
    padding: "14px 16px 0",
    marginTop: 16,
  }}>
    <div style={{ width: 100, height: 5, borderRadius: 999, background: "#ccccd0", margin: "0 auto 16px" }} />
    <div style={{
      display: "flex",
      height: 100,
      borderRadius: 16,
      overflow: "hidden",
      background: "#d32f2f",
    }}>
      <div style={{
        width: 100,
        flexShrink: 0,
        display: "flex",
        alignItems: "flex-end",
        padding: "0 12px 12px",
        color: "white",
        fontSize: 14,
        fontWeight: 800,
        lineHeight: 0.95,
        textTransform: "uppercase",
        background: "linear-gradient(180deg, #d32f2f 0%, #b71c1c 100%)",
      }}>
        ДОМ<br />ВСЕГДА<br />РЯДОМ.<br />АРОМАТНЫЙ
      </div>
      <div style={{
        flex: 1,
        background: "linear-gradient(135deg, #e8c170 0%, #c9a55a 30%, #8b6a3a 60%, #e8c170 100%)",
      }} />
    </div>
  </div>
);

/* ── Main page ── */
const Index = () => {
  return (
    <main style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      background: "radial-gradient(ellipse at 10% 20%, #4a5e3a 0%, transparent 50%), linear-gradient(180deg, #5a4e3c 0%, #2e2820 100%)",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif",
    }}>
      {/* Phone frame */}
      <div style={{
        width: 390,
        height: 844,
        borderRadius: 44,
        overflow: "hidden",
        background: "white",
        boxShadow: "0 20px 60px rgba(20,20,40,0.35), inset 0 1px 0 rgba(255,255,255,0.4)",
        display: "flex",
        flexDirection: "column",
      }}>
        {/* Status bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 28px 0", background: "white" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 16, fontWeight: 600, color: "#1a1a2e" }}>
            <span>16:51</span>
            <svg width="10" height="12" viewBox="0 0 10 12" fill="#1a1a2e"><path d="M8.5 1L6.8 9.6c-.1.5-.5.7-.9.5L3.5 9l-1 1.9c-.1.3-.4.2-.5 0L1.2 9.3c-.1-.1-.1-.3 0-.4l1.2-1.8L.7 6.2c-.3-.1-.2-.5.1-.6L8.1.3c.3-.1.5.2.4.7z" /></svg>
          </div>
          <div style={{
            background: "#F5A623",
            color: "#1a1a2e",
            fontSize: 12,
            fontWeight: 900,
            padding: "4px 14px",
            borderRadius: 999,
          }}>ONAY!</div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, color: "#1a1a2e" }}>
            <svg width="16" height="12" viewBox="0 0 16 12" fill="#1a1a2e">
              <rect x="0" y="6" width="2.5" height="6" rx="0.8" />
              <rect x="4" y="4" width="2.5" height="8" rx="0.8" />
              <rect x="8" y="2" width="2.5" height="10" rx="0.8" />
              <rect x="12" y="0" width="2.5" height="12" rx="0.8" />
            </svg>
            <svg width="15" height="11" viewBox="0 0 15 11" fill="none">
              <path d="M7.5 8.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z" fill="#1a1a2e" />
              <path d="M12.3 6.5C11 5.2 9.3 4.5 7.5 4.5S4 5.2 2.7 6.5" stroke="#1a1a2e" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M14.5 4C12.6 2.1 10.1 1 7.5 1S2.4 2.1.5 4" stroke="#1a1a2e" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <svg width="22" height="11" viewBox="0 0 22 11" fill="none">
              <rect x="0.5" y="0.5" width="18" height="10" rx="2.5" stroke="#1a1a2e" strokeWidth="1" />
              <rect x="2" y="2" width="15" height="7" rx="1.5" fill="#1a1a2e" />
              <rect x="19.5" y="3" width="1.5" height="5" rx="0.5" fill="#1a1a2e" />
            </svg>
          </div>
        </div>

        {/* Navigation */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "14px 20px 16px", background: "white", position: "relative" }}>
          <button style={{ position: "absolute", left: 20, background: "none", border: "none", cursor: "pointer", color: "#1a1a2e" }}>
            <ArrowLeft size={28} strokeWidth={2.2} />
          </button>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#1a1a2e", margin: 0, letterSpacing: "-0.02em" }}>Мои билеты</h1>
        </div>

        {/* Scrollable content */}
        <div style={{
          flex: 1,
          background: "#edeef3",
          borderRadius: "26px 26px 0 0",
          overflowY: "auto",
          padding: "18px 14px 0",
        }}>
          {/* Day pill */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
            <div style={{
              fontSize: 14,
              fontWeight: 500,
              color: "#1a1a2e",
              background: "white",
              border: "1px solid #e0e1e6",
              borderRadius: 999,
              padding: "6px 22px",
              boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
            }}>Вчера</div>
          </div>

          {/* Cards */}
          <div style={{ display: "grid", gap: 12, paddingBottom: 20 }}>
            <TicketCard ticket={tickets[0]} />
            <ColaBanner />
            <TicketCard ticket={tickets[1]} />
          </div>

          <BottomSheet />
        </div>
      </div>
    </main>
  );
};

export default Index;
