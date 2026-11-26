import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { 
  ChevronUp, 
  ChevronDown, 
  MessageSquare, 
  MoreHorizontal, 
  Pin, 
  Trash2,
  Loader2,
  Send,
  Pencil,
  Check,
  X
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { CommentWithUser } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

export type CommentComposerUser = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
};
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getGuestIdentity, setGuestDisplayName } from "@/lib/guestIdentity";

interface CommentsProps {
  podcastId: string;
  podcastOwnerId?: string;
  currentUser?: CommentComposerUser | null;
}

interface CommentItemProps {
  comment: CommentWithUser;
  podcastId: string;
  podcastOwnerId?: string;
  currentUser?: CommentComposerUser | null;
  onReply?: (commentId: string) => void;
  isReply?: boolean;
}

function CommentItem({ 
  comment, 
  podcastId, 
  podcastOwnerId, 
  currentUser, 
  onReply,
  isReply = false 
}: CommentItemProps) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [optimisticVote, setOptimisticVote] = useState<number | null>(null);

  const isOwner = currentUser?.id === comment.userId;
  const isPodcastOwner = currentUser?.id === podcastOwnerId;
  const currentVote = optimisticVote ?? comment.userVote ?? 0;

  const voteMutation = useMutation({
    mutationFn: async (value: 1 | -1) => {
      const response = await apiRequest("POST", `/api/comments/${comment.id}/vote`, { value });
      return response.json();
    },
    onMutate: async (value) => {
      const prevVote = comment.userVote || 0;
      if (prevVote === value) {
        setOptimisticVote(0);
      } else {
        setOptimisticVote(value);
      }
    },
    onSuccess: () => {
      setOptimisticVote(null);
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts", podcastId, "comments"] });
    },
    onError: () => {
      setOptimisticVote(null);
      toast({
        title: "Vote failed",
        description: "Could not update your vote. Please try again.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/comments/${comment.id}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts", podcastId, "comments"] });
      toast({
        title: "Comment deleted",
        description: "Your comment has been removed.",
      });
    },
    onError: () => {
      toast({
        title: "Delete failed",
        description: "Could not delete comment. Please try again.",
        variant: "destructive",
      });
    },
  });

  const pinMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/comments/${comment.id}/pin`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts", podcastId, "comments"] });
      toast({
        title: comment.isPinned ? "Comment unpinned" : "Comment pinned",
        description: comment.isPinned ? "The comment is no longer pinned." : "The comment is now pinned to the top.",
      });
    },
    onError: () => {
      toast({
        title: "Action failed",
        description: "Could not pin/unpin comment. Please try again.",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (body: string) => {
      const response = await apiRequest("PATCH", `/api/comments/${comment.id}`, { body });
      return response.json();
    },
    onSuccess: () => {
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts", podcastId, "comments"] });
      toast({
        title: "Comment updated",
        description: "Your comment has been updated.",
      });
    },
    onError: () => {
      toast({
        title: "Update failed",
        description: "Could not update comment. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleVote = (value: 1 | -1) => {
    voteMutation.mutate(value);
  };

  const score = comment.upvotes - comment.downvotes;
  const displayName = comment.user.isGuest
    ? (comment.user.guestName || 'Guest')
    : `${comment.user.firstName || ''} ${comment.user.lastName || ''}`.trim() || 'Listener';
  const nameParts = displayName.split(' ').filter(Boolean);
  const userInitials = nameParts.length >= 2
    ? `${nameParts[0][0]}${nameParts[1][0]}`.toUpperCase()
    : (nameParts[0]?.[0] || '?').toUpperCase();

  return (
    <div className={cn("flex gap-3", isReply && "ml-8 mt-3")} data-testid={`comment-${comment.id}`}>
      <Avatar className="h-8 w-8 flex-shrink-0">
        <AvatarImage src={comment.user.profileImageUrl || undefined} />
        <AvatarFallback className="text-xs">{userInitials}</AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm" data-testid={`comment-author-${comment.id}`}>
            {displayName}
          </span>
          {comment.user.isGuest && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0">Guest</Badge>
          )}
          {comment.isPinned && (
            <Badge variant="secondary" className="text-xs px-1.5 py-0">
              <Pin className="h-3 w-3 mr-1" />
              Pinned
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
          </span>
          {comment.createdAt !== comment.updatedAt && (
            <span className="text-xs text-muted-foreground">(edited)</span>
          )}
        </div>

        {isEditing ? (
          <div className="mt-2 space-y-2">
            <Textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              className="min-h-[80px] text-sm"
              data-testid={`comment-edit-input-${comment.id}`}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => updateMutation.mutate(editBody)}
                disabled={updateMutation.isPending || !editBody.trim()}
                data-testid={`button-save-edit-${comment.id}`}
              >
                {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setIsEditing(false);
                  setEditBody(comment.body);
                }}
                data-testid={`button-cancel-edit-${comment.id}`}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm mt-1 text-foreground/90 whitespace-pre-wrap" data-testid={`comment-body-${comment.id}`}>
            {comment.body}
          </p>
        )}

        <div className="flex items-center gap-3 mt-2">
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="ghost"
              className={cn(
                "h-7 w-7",
                currentVote === 1 && "text-primary"
              )}
              onClick={() => handleVote(1)}
              disabled={voteMutation.isPending}
              data-testid={`button-upvote-${comment.id}`}
              aria-label="Upvote"
            >
              <ChevronUp className={cn("h-4 w-4", currentVote === 1 && "fill-current")} />
            </Button>
            <span className={cn(
              "text-sm font-medium min-w-[1.5rem] text-center",
              score > 0 && "text-primary",
              score < 0 && "text-destructive"
            )} data-testid={`comment-score-${comment.id}`}>
              {score}
            </span>
            <Button
              size="icon"
              variant="ghost"
              className={cn(
                "h-7 w-7",
                currentVote === -1 && "text-destructive"
              )}
              onClick={() => handleVote(-1)}
              disabled={voteMutation.isPending}
              data-testid={`button-downvote-${comment.id}`}
              aria-label="Downvote"
            >
              <ChevronDown className={cn("h-4 w-4", currentVote === -1 && "fill-current")} />
            </Button>
          </div>

          {!isReply && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs gap-1"
              onClick={() => onReply?.(comment.id)}
              data-testid={`button-reply-${comment.id}`}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Reply
            </Button>
          )}

          {(isOwner || isPodcastOwner) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  data-testid={`button-comment-menu-${comment.id}`}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isOwner && (
                  <DropdownMenuItem
                    onClick={() => setIsEditing(true)}
                    data-testid={`menu-edit-${comment.id}`}
                  >
                    Edit
                  </DropdownMenuItem>
                )}
                {isPodcastOwner && (
                  <DropdownMenuItem
                    onClick={() => pinMutation.mutate()}
                    disabled={pinMutation.isPending}
                    data-testid={`menu-pin-${comment.id}`}
                  >
                    <Pin className="h-4 w-4 mr-2" />
                    {comment.isPinned ? "Unpin" : "Pin"}
                  </DropdownMenuItem>
                )}
                {isOwner && (
                  <DropdownMenuItem
                    onClick={() => deleteMutation.mutate()}
                    disabled={deleteMutation.isPending}
                    className="text-destructive"
                    data-testid={`menu-delete-${comment.id}`}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {comment.replies && comment.replies.length > 0 && (
          <div className="mt-3 space-y-3">
            {comment.replies.map((reply) => (
              <CommentItem
                key={reply.id}
                comment={reply}
                podcastId={podcastId}
                podcastOwnerId={podcastOwnerId}
                currentUser={currentUser}
                isReply
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function Comments({ podcastId, podcastOwnerId, currentUser }: CommentsProps) {
  const { toast } = useToast();
  const [sortBy, setSortBy] = useState<'best' | 'new'>('best');
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [guestIdentity, setGuestIdentity] = useState(() => getGuestIdentity());
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const { data: commentsData, isLoading } = useQuery<{ comments: CommentWithUser[] }>({
    queryKey: ["/api/podcasts", podcastId, "comments", sortBy],
    queryFn: async () => {
      const response = await fetch(`/api/podcasts/${podcastId}/comments?sort=${sortBy}`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch comments");
      }
      return response.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async ({ body, parentId }: { body: string; parentId?: string }) => {
      const payload: Record<string, string | undefined> = { body, parentId };
      if (!currentUser) {
        payload.guestId = guestIdentity.id;
        payload.guestName = guestIdentity.displayName;
      }
      const response = await apiRequest("POST", `/api/podcasts/${podcastId}/comments`, payload);
      return response.json();
    },
    onSuccess: () => {
      setNewComment('');
      setReplyText('');
      setReplyingTo(null);
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts", podcastId, "comments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/podcasts", podcastId, "engagement"] });
      toast({
        title: "Comment posted",
        description: "Your comment has been added.",
      });
    },
    onError: (error) => {
      toast({
        title: "Post failed",
        description: error instanceof Error ? error.message : "Could not post comment. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmitComment = () => {
    if (!newComment.trim()) return;
    createMutation.mutate({ body: newComment.trim() });
  };

  const handleSubmitReply = (parentId: string) => {
    if (!replyText.trim()) return;
    createMutation.mutate({ body: replyText.trim(), parentId });
  };

  const comments = commentsData?.comments || [];
  const commentCount = comments.reduce((acc, c) => acc + 1 + (c.replies?.length || 0), 0);

  return (
    <div className="space-y-6" data-testid="comments-section">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold" data-testid="comments-count">
          {commentCount} {commentCount === 1 ? 'Comment' : 'Comments'}
        </h3>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as 'best' | 'new')}>
          <SelectTrigger className="w-28" data-testid="select-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="best">Best</SelectItem>
            <SelectItem value="new">New</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-3">
        {currentUser ? (
          <Avatar className="h-8 w-8 flex-shrink-0">
            <AvatarImage src={currentUser.profileImageUrl || undefined} />
            <AvatarFallback className="text-xs">
              {`${currentUser.firstName?.[0] || ''}${currentUser.lastName?.[0] || ''}`.toUpperCase() || '?'}
            </AvatarFallback>
          </Avatar>
        ) : (
          <Avatar className="h-8 w-8 flex-shrink-0">
            <AvatarFallback className="text-xs bg-primary/10 text-primary">
              {guestIdentity.displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
            </AvatarFallback>
          </Avatar>
        )}
        <div className="flex-1 space-y-2">
          {!currentUser && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Posting as</span>
              {editingName ? (
                <>
                  <Input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    className="h-7 text-sm w-36 py-0"
                    maxLength={50}
                    autoFocus
                    data-testid="input-guest-name"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && nameDraft.trim()) {
                        setGuestDisplayName(nameDraft.trim());
                        setGuestIdentity(getGuestIdentity());
                        setEditingName(false);
                      } else if (e.key === 'Escape') {
                        setEditingName(false);
                      }
                    }}
                  />
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                    if (nameDraft.trim()) {
                      setGuestDisplayName(nameDraft.trim());
                      setGuestIdentity(getGuestIdentity());
                    }
                    setEditingName(false);
                  }} data-testid="button-confirm-guest-name">
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingName(false)} data-testid="button-cancel-guest-name">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <>
                  <span className="font-medium text-foreground">{guestIdentity.displayName}</span>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                    setNameDraft(guestIdentity.displayName);
                    setEditingName(true);
                  }} data-testid="button-edit-guest-name">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          )}
          <Textarea
            placeholder="Add a comment..."
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            className="min-h-[80px] text-sm resize-none"
            data-testid="input-new-comment"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={handleSubmitComment}
              disabled={!newComment.trim() || createMutation.isPending}
              data-testid="button-submit-comment"
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Send className="h-4 w-4 mr-1" />
                  Post
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : comments.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground" data-testid="no-comments">
          <MessageSquare className="h-12 w-12 mx-auto mb-2 opacity-50" />
          <p>No comments yet. Be the first to comment!</p>
        </div>
      ) : (
        <div className="space-y-6">
          {comments.map((comment) => (
            <div key={comment.id}>
              <CommentItem
                comment={comment}
                podcastId={podcastId}
                podcastOwnerId={podcastOwnerId}
                currentUser={currentUser}
                onReply={(id) => {
                  setReplyingTo(id);
                  setReplyText('');
                }}
              />
              {replyingTo === comment.id && (
                <div className="ml-11 mt-3 flex gap-3">
                  <Avatar className="h-7 w-7 flex-shrink-0">
                    <AvatarImage src={currentUser?.profileImageUrl || undefined} />
                    <AvatarFallback className="text-xs bg-primary/10 text-primary">
                      {currentUser
                        ? `${currentUser?.firstName?.[0] || ''}${currentUser?.lastName?.[0] || ''}`.toUpperCase() || '?'
                        : guestIdentity.displayName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
                      }
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 space-y-2">
                    <Textarea
                      placeholder="Write a reply..."
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      className="min-h-[60px] text-sm resize-none"
                      autoFocus
                      data-testid={`input-reply-${comment.id}`}
                    />
                    <div className="flex gap-2 justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setReplyingTo(null);
                          setReplyText('');
                        }}
                        data-testid={`button-cancel-reply-${comment.id}`}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleSubmitReply(comment.id)}
                        disabled={!replyText.trim() || createMutation.isPending}
                        data-testid={`button-submit-reply-${comment.id}`}
                      >
                        {createMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Reply"
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
