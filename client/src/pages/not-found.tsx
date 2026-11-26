import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-6 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Compass className="h-8 w-8" />
          </div>

          <h1
            className="text-3xl font-semibold text-foreground mb-2"
            data-testid="text-not-found-title"
          >
            We couldn't find that page
          </h1>

          <p className="text-sm text-muted-foreground mb-6">
            The podcast or page you're looking for may have been moved, made
            private, or never existed.
          </p>

          <Button asChild className="w-full sm:w-auto" data-testid="button-not-found-discover">
            <Link href="/listen">
              <Compass className="h-4 w-4" />
              Back to Discover
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
