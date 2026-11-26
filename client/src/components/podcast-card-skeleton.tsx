import { Card } from "@/components/ui/card";

export function PodcastCardSkeleton() {
  return (
    <Card className="overflow-hidden animate-pulse">
      {/* Single responsive layout - vertical on mobile, horizontal on desktop */}
      <div className="flex flex-col md:flex-row md:gap-3 md:p-3">
        {/* Cover Art Skeleton - full width 2:1 on mobile (25% shorter than 16:9), square on desktop */}
        <div className="relative w-full md:w-32 aspect-[2/1] md:aspect-square flex-shrink-0 bg-muted md:rounded-lg">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-muted-foreground/5 to-transparent shimmer" />
        </div>
        
        {/* Content Skeleton */}
        <div className="flex-1 flex flex-col justify-between min-w-0 p-3 md:p-0 space-y-2 md:space-y-1">
          {/* Title */}
          <div className="h-4 md:h-5 bg-muted rounded w-3/4" />
          
          {/* Description */}
          <div className="h-3 bg-muted rounded w-full" />
          
          {/* Metadata */}
          <div className="flex items-center gap-2">
            <div className="h-5 bg-muted rounded w-16" />
            <div className="h-3 bg-muted rounded w-24" />
          </div>
          
          {/* Actions - menu on left, play on right */}
          <div className="flex gap-1 mt-auto">
            <div className="h-8 w-8 bg-muted rounded" />
            <div className="h-8 w-8 bg-muted rounded" />
            <div className="h-8 w-8 bg-muted rounded" />
            <div className="flex-1" />
            <div className="h-8 w-8 bg-muted rounded md:hidden" />
          </div>
        </div>
      </div>
    </Card>
  );
}
