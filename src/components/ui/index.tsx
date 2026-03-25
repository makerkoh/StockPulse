import { cn } from "@/lib/utils";

// ─── Button ──────────────────────────────────────────────────────────
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
}

export function Button({ variant = "primary", size = "md", className, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
        size === "sm" && "text-xs px-3 py-1.5",
        size === "md" && "text-sm px-4 py-2.5",
        variant === "primary" && "bg-accent hover:bg-accent-hover text-white",
        variant === "secondary" && "bg-surface-2 hover:bg-surface-3 text-text-primary border border-border",
        variant === "ghost" && "hover:bg-surface-2 text-text-secondary hover:text-text-primary",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

// ─── Card ────────────────────────────────────────────────────────────
interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  style?: React.CSSProperties;
}

export function Card({ children, className, hover, style }: CardProps) {
  return (
    <div
      style={style}
      className={cn(
        "bg-surface-1 border border-border rounded-xl",
        hover && "card-glow cursor-pointer",
        className
      )}
    >
      {children}
    </div>
  );
}

// ─── Badge ───────────────────────────────────────────────────────────
interface BadgeProps {
  children: React.ReactNode;
  variant?: "default" | "positive" | "negative" | "warning" | "accent";
  className?: string;
}

export function Badge({ children, variant = "default", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 text-2xs font-medium rounded-md",
        variant === "default" && "bg-surface-3 text-text-secondary",
        variant === "positive" && "bg-emerald-500/15 text-emerald-400",
        variant === "negative" && "bg-red-500/15 text-red-400",
        variant === "warning" && "bg-amber-500/15 text-amber-400",
        variant === "accent" && "bg-accent/15 text-accent",
        className
      )}
    >
      {children}
    </span>
  );
}

// ─── Select ──────────────────────────────────────────────────────────
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: { value: string; label: string }[];
}

export function Select({ label, options, className, ...props }: SelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-2xs font-medium text-text-tertiary uppercase tracking-wider">
          {label}
        </label>
      )}
      <select
        className={cn(
          "bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary appearance-none cursor-pointer hover:border-accent/30 transition-colors",
          className
        )}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Spinner ─────────────────────────────────────────────────────────
export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg className="animate-spin text-accent" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

export function SkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 items-center">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

// ─── Empty State ─────────────────────────────────────────────────────
interface EmptyStateProps {
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mb-4">
        <svg className="w-6 h-6 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
      </div>
      <h3 className="text-sm font-medium text-text-primary mb-1">{title}</h3>
      <p className="text-xs text-text-tertiary max-w-xs mb-4">{description}</p>
      {action}
    </div>
  );
}

// ─── Status Dot ──────────────────────────────────────────────────────
export function StatusDot({ status }: { status: "positive" | "negative" | "warning" | "neutral" }) {
  return (
    <span
      className={cn(
        "inline-block w-1.5 h-1.5 rounded-full",
        status === "positive" && "bg-positive",
        status === "negative" && "bg-negative",
        status === "warning" && "bg-warning",
        status === "neutral" && "bg-text-tertiary"
      )}
    />
  );
}
