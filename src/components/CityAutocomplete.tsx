import { useState, useRef, useEffect, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { useSparkCities } from "@/hooks/useSparkCities";
import { cn } from "@/lib/utils";

interface CityAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

const CityAutocomplete = ({ value, onChange, placeholder, className, onKeyDown }: CityAutocompleteProps) => {
  const { data: cities } = useSparkCities();
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!cities || !value.trim()) return [];
    const q = value.toLowerCase();
    return cities.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8);
  }, [cities, value]);

  useEffect(() => {
    setHighlightIndex(0);
  }, [filtered]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const select = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (open && filtered.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" && filtered[highlightIndex]) {
        e.preventDefault();
        select(filtered[highlightIndex].name);
        return;
      }
    }
    onKeyDown?.(e);
  };

  return (
    <div ref={ref} className="relative">
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => value.trim() && setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn("text-sm rounded-xl", className)}
        autoComplete="off"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-popover shadow-md max-h-48 overflow-y-auto">
          {filtered.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={() => select(c.name)}
              className={cn(
                "w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors",
                i === highlightIndex && "bg-muted/50"
              )}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default CityAutocomplete;
