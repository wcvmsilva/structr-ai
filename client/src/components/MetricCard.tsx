// MetricCard — structr.ai style metric display
// Gold top-border accent, JetBrains Mono for values, hover glow effect

import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

interface MetricCardProps {
  label: string;
  value: string;
  subtitle?: string;
  variant?: "default" | "danger" | "success";
}

function useCountUp(target: string, duration: number = 600) {
  const [display, setDisplay] = useState(target);
  const prevRef = useRef(target);

  useEffect(() => {
    if (prevRef.current === target) return;
    prevRef.current = target;

    // Extract numeric part
    const numMatch = target.match(/[\d,.]+/);
    if (!numMatch) {
      setDisplay(target);
      return;
    }

    const prefix = target.slice(0, target.indexOf(numMatch[0]));
    const suffix = target.slice(target.indexOf(numMatch[0]) + numMatch[0].length);
    const endVal = parseFloat(numMatch[0].replace(/,/g, ""));
    const hasDecimals = numMatch[0].includes(".");
    const decimalPlaces = hasDecimals ? numMatch[0].split(".")[1]?.length || 0 : 0;

    const startTime = performance.now();
    const startVal = 0;

    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const current = startVal + (endVal - startVal) * eased;

      const formatted = current.toLocaleString("en-US", {
        minimumFractionDigits: decimalPlaces,
        maximumFractionDigits: decimalPlaces,
      });

      setDisplay(`${prefix}${formatted}${suffix}`);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    }

    requestAnimationFrame(animate);
  }, [target, duration]);

  return display;
}

export default function MetricCard({ label, value, subtitle, variant = "default" }: MetricCardProps) {
  const animatedValue = useCountUp(value);

  const borderGradient = {
    default: "from-gold-dark via-gold to-gold-light",
    danger: "from-red-800 via-red-500 to-red-400",
    success: "from-green-800 via-green-500 to-green-400",
  }[variant];

  const valueColor = {
    default: "text-gold",
    danger: "text-red-500",
    success: "text-green-500",
  }[variant];

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[14px] border border-border bg-card p-5 text-center",
        "transition-all duration-300 hover:-translate-y-0.5",
        variant === "danger" && "border-red-500/25 shadow-[0_0_20px_rgba(239,68,68,0.2)]",
        variant === "success" && "border-green-500/15",
        variant === "default" && "hover:border-gold/35 hover:shadow-[0_4px_24px_var(--color-gold-glow)]"
      )}
    >
      {/* Gold top stripe */}
      <div className={cn("absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r", borderGradient)} />

      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-1.5">
        {label}
      </p>
      <p className={cn("font-mono text-[1.7rem] font-bold leading-tight", valueColor)}>
        {animatedValue}
      </p>
      {subtitle && (
        <p className="mt-1 font-mono text-[0.72rem] text-muted-foreground/70">
          {subtitle}
        </p>
      )}
    </div>
  );
}
