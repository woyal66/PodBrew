import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function PodcastCardSkeleton() {
  return (
    <Card className="overflow-hidden" data-testid="skeleton-library-card">
      <div className="flex flex-col md:flex-row gap-4 p-3 md:p-4">
        <Skeleton className="w-full md:w-20 h-20 md:h-20 flex-shrink-0 rounded-md md:order-last" />

        <div className="flex-1 flex flex-col justify-between min-w-0">
          <div className="space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <div className="flex items-center gap-2 flex-wrap">
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-3">
            <Skeleton className="h-9 w-9 rounded-md" />
            <Skeleton className="h-9 w-9 rounded-md" />
            <Skeleton className="h-9 w-9 rounded-md" />
            <Skeleton className="h-9 w-9 rounded-md" />
            <Skeleton className="h-9 w-9 rounded-md" />
          </div>
        </div>
      </div>
    </Card>
  );
}
