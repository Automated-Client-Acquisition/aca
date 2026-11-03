import { formatDistanceToNow, isValid } from "date-fns";
import { cn } from "@/lib/utils";

function formatDateSafe(dateString: string | null | undefined): string | null {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (!isValid(date)) return null;
  return formatDistanceToNow(date, { addSuffix: true });
}
import { ContactAvatar } from "@/components/inbox/ContactAvatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { ChannelIndicator, getChannelLabel } from "@/components/inbox/ChannelIndicator";
import { useContactConversations, type ConversationWithContact } from "@/hooks/crm/useConversations";
import { type CrmContact, type CrmActivity, useContact, useUpdateContactOwner } from "@/hooks/crm/useContacts";
import {
  X,
  Mail,
  Phone,
  Building,
  Briefcase,
  MapPin,
  Globe,
  Tag,
  Calendar,
  ExternalLink,
  MessageSquare,
  Clock,
  User,
  Star,
  Activity,
} from "lucide-react";
import { Link } from "react-router-dom";
import { AccountOwnerPicker } from "@/components/accounts/AccountOwnerPicker";

interface ContactDetailsProps {
  contact: CrmContact | null;
  conversation: ConversationWithContact | null;
  onClose: () => void;
}

export function ContactDetails({
  contact: conversationContact,
  conversation,
  onClose,
}: ContactDetailsProps) {
  // The list embeds only summary fields. Load the selected profile and its
  // contact-scoped activity through the existing organization-scoped hook.
  const { data: fullContact, isLoading: activitiesLoading } = useContact(conversationContact?.id);
  const contact = fullContact ?? conversationContact;
  const activities = fullContact?.activities.slice(0, 10);
  const { data: conversations } = useContactConversations(contact?.id || null);
  const updateOwner = useUpdateContactOwner();

  if (!contact) {
    return (
      <div className="h-full flex items-center justify-center bg-muted/10 p-4">
        <div className="text-center">
          <User className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No contact selected</p>
        </div>
      </div>
    );
  }

  const location = [contact.city, contact.state, contact.country].filter(Boolean).join(", ");
  const initials =
    contact.display_name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2) || "?";

  return (
    <div className="h-full min-h-0 flex flex-col bg-muted/10">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b">
        <h3 className="font-medium text-sm">Contact Details</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Close contact details" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {/* Profile Section */}
        <div className="p-4">
          <div className="flex flex-col items-center text-center">
            <ContactAvatar
              contactId={contact.id}
              avatarUrl={contact.avatar_url}
              initials={initials}
              className="h-16 w-16 mb-3"
              fallbackClassName="text-lg"
            />
            <h4 className="font-medium">{contact.display_name || "Unknown"}</h4>
            {(contact.job_title || contact.company) && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {contact.job_title}
                {contact.job_title && contact.company && " at "}
                {contact.company}
              </p>
            )}

            {/* Status & Score */}
            <div className="flex items-center gap-2 mt-3">
              <Badge
                variant="secondary"
                className={cn("capitalize", contact.status === "active" ? "bg-green-100 text-green-700 border-green-200 hover:bg-green-100" : "")}
              >
                {contact.status || "lead"}
              </Badge>
              {contact.lead_score !== null && contact.lead_score > 0 && (
                <Badge variant="outline" className="gap-1">
                  <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                  {contact.lead_score}
                </Badge>
              )}
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-2 mt-4">
              <Button size="sm" variant="outline" className="h-8" asChild>
                <Link to={`/people/${contact.id}`}>
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  Full Profile
                </Link>
              </Button>
            </div>
          </div>
        </div>

        <Separator />

        {/* Tabs */}
        <Tabs defaultValue="info" className="p-4">
          <TabsList className="w-full grid grid-cols-3 h-8">
            <TabsTrigger value="info" className="text-xs">
              Info
            </TabsTrigger>
            <TabsTrigger value="channels" className="text-xs">
              Channels
            </TabsTrigger>
            <TabsTrigger value="activity" className="text-xs">
              Activity
            </TabsTrigger>
          </TabsList>

          {/* Info Tab */}
          <TabsContent value="info" className="mt-4 space-y-4">
            {/* Contact Info */}
            <div className="space-y-3">
              {contact.primary_email && (
                <InfoRow
                  icon={<Mail className="h-4 w-4" />}
                  label="Email"
                  value={contact.primary_email}
                  href={`mailto:${contact.primary_email}`}
                />
              )}
              {contact.primary_phone && (
                <InfoRow
                  icon={<Phone className="h-4 w-4" />}
                  label="Phone"
                  value={contact.primary_phone}
                  href={`tel:${contact.primary_phone}`}
                />
              )}
              {contact.company && (
                <InfoRow
                  icon={<Building className="h-4 w-4" />}
                  label="Company"
                  value={contact.company}
                />
              )}
              {contact.job_title && (
                <InfoRow
                  icon={<Briefcase className="h-4 w-4" />}
                  label="Title"
                  value={contact.job_title}
                />
              )}
              {location && (
                <InfoRow
                  icon={<MapPin className="h-4 w-4" />}
                  label="Location"
                  value={location}
                />
              )}
              {contact.company_website && (
                <InfoRow
                  icon={<Globe className="h-4 w-4" />}
                  label="Website"
                  value={contact.company_website}
                  href={contact.company_website}
                />
              )}
            </div>

            {/* Tags */}
            {contact.tags && contact.tags.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5" /> Tags
                </p>
                <div className="flex flex-wrap gap-1">
                  {contact.tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="outline"
                      className="text-xs"
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Owner */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" /> Owner
              </p>
              <AccountOwnerPicker
                value={contact.owner_user_id ?? null}
                onChange={(userId) =>
                  updateOwner.mutate({ contactId: contact.id, userId })
                }
              />
            </div>

            {/* Dates */}
            <div className="space-y-2 pt-2">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" /> Timeline
              </p>
              <div className="text-xs text-muted-foreground space-y-1">
                {formatDateSafe(contact.created_at) && (
                  <p>Created {formatDateSafe(contact.created_at)}</p>
                )}
                {formatDateSafe(contact.last_activity_at) && (
                  <p>Last activity {formatDateSafe(contact.last_activity_at)}</p>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Channels Tab */}
          <TabsContent value="channels" className="mt-4">
            {conversations && conversations.length > 0 ? (
              <div className="space-y-2">
                {conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={cn(
                      "flex items-center gap-3 p-2 rounded-lg border",
                      conv.id === conversation?.id && "border-primary bg-primary/5"
                    )}
                  >
                    <ChannelIndicator
                      channel={conv.channel}
                      className="h-8 w-8 rounded-md"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">
                        {getChannelLabel(conv.channel)}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {conv.message_count} messages
                        {conv.unread_count > 0 && (
                          <span className="text-blue-500 ml-1">
                            ({conv.unread_count} unread)
                          </span>
                        )}
                      </p>
                    </div>
                    {conv.status === "open" && (
                      <Badge variant="outline" className="text-xs">
                        Active
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <MessageSquare className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  No channels connected
                </p>
              </div>
            )}
          </TabsContent>

          {/* Activity Tab */}
          <TabsContent value="activity" className="mt-4">
            {activitiesLoading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <ActivitySkeleton key={i} />
                ))}
              </div>
            ) : activities && activities.length > 0 ? (
              <div className="space-y-3">
                {activities.map((activity) => (
                  <ActivityItem key={activity.id} activity={activity} />
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <Activity className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No activity yet</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </ScrollArea>
    </div>
  );
}

interface InfoRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
}

function InfoRow({ icon, label, value, href }: InfoRowProps) {
  const content = (
    <div className="flex items-start gap-3">
      <div className="text-muted-foreground mt-0.5">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm truncate">{value}</p>
      </div>
    </div>
  );

  if (href) {
    return (
      <a
        href={href}
        target={href.startsWith("http") ? "_blank" : undefined}
        rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
        className="block hover:bg-muted/50 -mx-2 px-2 py-1 rounded-md transition-colors"
      >
        {content}
      </a>
    );
  }

  return content;
}

interface ActivityItemProps {
  activity: CrmActivity;
}

function ActivityItem({ activity }: ActivityItemProps) {
  const getActivityIcon = (type: string) => {
    switch (type) {
      case "message_sent":
      case "message_received":
        return <MessageSquare className="h-3.5 w-3.5" />;
      case "email_opened":
      case "email_clicked":
        return <Mail className="h-3.5 w-3.5" />;
      case "note_added":
        return <Clock className="h-3.5 w-3.5" />;
      default:
        return <Activity className="h-3.5 w-3.5" />;
    }
  };

  return (
    <div className="flex items-start gap-2">
      <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
        {getActivityIcon(activity.activity_type)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm">{activity.title}</p>
        {formatDateSafe(activity.created_at) && (
          <p className="text-xs text-muted-foreground">
            {formatDateSafe(activity.created_at)}
          </p>
        )}
      </div>
    </div>
  );
}

function ActivitySkeleton() {
  return (
    <div className="flex items-start gap-2">
      <Skeleton className="w-6 h-6 rounded-full" />
      <div className="flex-1 space-y-1">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/3" />
      </div>
    </div>
  );
}
