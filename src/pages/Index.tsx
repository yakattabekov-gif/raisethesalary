import onayReference from "@/assets/onay-reference.png";

const Index = () => {
  return (
    <main className="min-h-screen bg-background flex items-start justify-center">
      <div className="w-full max-w-[616px] mx-auto">
        <img
          src={onayReference}
          alt="ONAY mobile tickets screen"
          className="block w-full h-auto"
          loading="eager"
          draggable={false}
        />
      </div>
    </main>
  );
};

export default Index;
