import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Comments, type CommentComposerUser } from "@/components/comments";
import { useAuth } from "@/contexts/auth-context";
import type { PodcastEngagement } from "@shared/schema";

interface CommentsDialogProps {
  podcastId: string;
  podcastTitle: string;
  podcastOwnerId?: string;
  isPublic?: boolean;
  compact?: boolean;
  showCount?: boolean;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}

export function CommentsDialog({
  podcastId,
  podcastTitle,
  podcastOwnerId,
  isPublic = true,
  compact = false,
  showCount = true,
  className,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  hideTrigger = false,
}: CommentsDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setIsOpen = controlledOnOpenChange || setInternalOpen;

  // Read the signed-in user from the AuthContext so each card doesn't fire
  // its own GET /api/auth/user just to render the composer avatar. The auth
  // provider already loads (or knows the absence of) this user once at app
  // startup, and Comments only consumes the small subset of fields described
  // by CommentComposerUser.
  const { user: authUser } = useAuth();
  const currentUser: CommentComposerUser | null = authUser
    ? {
        id: authUser.id,
        firstName: authUser.firstName,
        lastName: authUser.lastName,
        profileImageUrl: authUser.profileImageUrl,
      }
    : null;

  const { data: engagementData } = useQuery<{ engagement: PodcastEngagement }>({
    queryKey: ["/api/podcasts", podcastId, "engagement"],
    enabled: isPublic,
  });

  const commentCount = engagementData?.engagement?.commentCount || 0;

  if (!isPublic) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {!hideTrigger && (
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button
                size={compact ? "sm" : "icon"}
                variant="outline"
                data-testid={`button-comments-${podcastId}`}
                aria-label={`${commentCount} comments`}
                className={compact 
                  ? "h-8 px-2 gap-1.5" 
                  : `flex-1 md:flex-none h-10 md:h-9 w-full md:w-auto min-w-9 max-w-20 max-h-10 gap-1.5 ${className || ""}`
                }
              >
                <MessageSquare className="h-4 w-4" />
                {showCount && commentCount > 0 && (
                  <span className="text-xs font-medium">{formatCount(commentCount)}</span>
                )}
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent>
            {commentCount > 0 ? `${commentCount} ${commentCount === 1 ? 'comment' : 'comments'}` : 'Add a comment'}
          </TooltipContent>
        </Tooltip>
      )}

      <DialogContent 
        className="max-w-2xl w-[95vw] max-h-[85vh] flex flex-col p-0"
        data-testid={`dialog-comments-${podcastId}`}
      >
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle className="text-lg font-semibold line-clamp-1">
            Comments on "{podcastTitle}"
          </DialogTitle>
          <DialogDescription className="sr-only">
            View and add comments to this podcast
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <Comments
            podcastId={podcastId}
            podcastOwnerId={podcastOwnerId}
            currentUser={currentUser}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatCount(count: number): string {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
}
