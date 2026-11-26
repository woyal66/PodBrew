import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function HorizontalPodcastCardSkeleton() {
  return (
    <Card className="overflow-hidden" data-testid="skeleton-podcast-card">
      {/* Responsive layout - vertical on mobile, horizontal on desktop */}
      <div className="flex flex-col md:flex-row md:gap-3 md:p-3">
        {/* Cover Art Skeleton - full width 2:1 on mobile, square on desktop */}
        <Skeleton className="w-full md:w-32 aspect-[2/1] md:aspect-square shrink-0 md:rounded-lg" />

        {/* Content Skeleton */}
        <div className="flex-1 flex flex-col justify-between min-w-0 p-3 md:p-0 space-y-2 md:space-y-1">
          {/* Title */}
          <Skeleton className="h-4 md:h-5 w-3/4" />
          
          {/* Metadata */}
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-16 rounded" />
            <Skeleton className="h-3 w-24" />
          </div>
          
          {/* Actions - menu on left, play on right */}
          <div className="flex gap-1 mt-auto">
            <Skeleton className="h-8 w-8 rounded" />
            <Skeleton className="h-8 w-8 rounded" />
            <Skeleton className="h-8 w-8 rounded" />
            <div className="flex-1" />
            <Skeleton className="h-8 w-8 rounded md:hidden" />
          </div>
        </div>
      </div>
    </Card>
  );
}
