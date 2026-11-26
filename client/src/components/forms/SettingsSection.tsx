import { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";

interface SettingsSectionProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function SettingsSection({
  icon: Icon,
  title,
  description,
  children,
  className = "",
}: SettingsSectionProps) {
  return (
    <Card className={`border-border/50 bg-card/50 ${className}`}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-4 text-sm font-medium text-muted-foreground">
          <Icon className="w-4 h-4" />
          <span>{title}</span>
        </div>
        <div className="space-y-4">
          {children}
        </div>
      </CardContent>
    </Card>
  );
}
