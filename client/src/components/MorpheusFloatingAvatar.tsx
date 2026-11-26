import { cn } from "@/lib/utils";
import morpheusAvatarUrl from "@assets/morpheus_avatar.png";

interface MorpheusFloatingAvatarProps {
  onClick: () => void;
  disabled?: boolean;
  isActive?: boolean;
  className?: string;
}

export function MorpheusFloatingAvatar({
  onClick,
  disabled = false,
  isActive = false,
  className,
}: MorpheusFloatingAvatarProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label="Open Morpheus Topic Wizard"
      data-testid="button-morpheus-floating"
      className={cn(
        "absolute z-10",
        "w-10 h-10 rounded-full",
        "overflow-hidden cursor-pointer",
        "transition-all duration-300 ease-out",
        "shadow-lg shadow-primary/20",
        "hover:scale-110 hover:shadow-xl hover:shadow-primary/40",
        "active:scale-95",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
        !disabled && !isActive && "animate-morpheus-pulse",
        isActive && "ring-2 ring-primary ring-offset-2 ring-offset-background scale-105",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
      style={{ left: '5px', bottom: '12px' }}
    >
      <div 
        className={cn(
          "absolute inset-0 rounded-full",
          "bg-gradient-to-br from-primary via-primary to-primary",
          !disabled && "animate-pulse"
        )}
      />
      <img
        src={morpheusAvatarUrl}
        alt="Morpheus - Topic Wizard"
        className="relative w-full h-full object-cover rounded-full border-2 border-primary"
        draggable={false}
      />
      {!disabled && !isActive && (
        <div className="absolute inset-0 rounded-full bg-primary animate-ping" style={{ animationDuration: '2s' }} />
      )}
    </button>
  );
}
