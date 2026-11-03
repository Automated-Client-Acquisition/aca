import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { FeatureGate } from "@/components/UpgradePrompt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useSequence,
  useUpdateSequence,
  useDeleteSequence,
  useToggleSequenceStatus,
  useCreateStep,
  useUpdateStep,
  useDeleteStep,
  useReorderSteps,
  useSequenceEnrollments,
  useRemoveFromSequence,
  getStepTypeLabel,
  getStepIcon,
  getEnrollmentStatusLabel,
  type StepType,
  type StepInput,
  type SequenceStep,
} from "@/hooks/crm";
import {
  ArrowLeft,
  Play,
  Pause,
  MoreVertical,
  Plus,
  Trash2,
  Edit,
  Users,
  Mail,
  Clock,
  GripVertical,
  Save,
  Settings,
  BarChart3,
  MessageSquare,
  Tag,
  Webhook,
  Bell,
  Timer,
  Zap,
  UserX,
  CheckCircle,
  XCircle,
  PauseCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";
import { SequenceAnalyticsTab } from "@/components/email/SequenceAnalyticsTab";
import { DndContext, closestCenter, DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export default function SequenceDetail() {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <main className="flex-1 overflow-auto">
          <FeatureGate feature="messaging">
            <SequenceDetailContent />
          </FeatureGate>
        </main>
      </div>
    </SidebarProvider>
  );
}

function SequenceDetailContent() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("steps");
  const [editingStep, setEditingStep] = useState<SequenceStep | null>(null);
  const [showAddStep, setShowAddStep] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const { data: sequence, isLoading } = useSequence(id);
  const { data: enrollments } = useSequenceEnrollments({
    sequenceId: id || "",
    limit: 50,
  });

  const updateMutation = useUpdateSequence();
  const deleteMutation = useDeleteSequence();
  const toggleStatusMutation = useToggleSequenceStatus();
  const createStepMutation = useCreateStep();
  const updateStepMutation = useUpdateStep();
  const deleteStepMutation = useDeleteStep();
  const reorderStepsMutation = useReorderSteps();
  const removeFromSequenceMutation = useRemoveFromSequence();

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (!sequence) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <h3 className="text-lg font-semibold mb-2">Sequence not found</h3>
            <p className="text-muted-foreground mb-4">
              The sequence you're looking for doesn't exist.
            </p>
            <Button onClick={() => navigate("/sequences")}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Contact Sequences
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !sequence.steps) return;

    const oldIndex = sequence.steps.findIndex((s) => s.id === active.id);
    const newIndex = sequence.steps.findIndex((s) => s.id === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      const newOrder = [...sequence.steps];
      const [removed] = newOrder.splice(oldIndex, 1);
      newOrder.splice(newIndex, 0, removed);

      reorderStepsMutation.mutate({
        sequenceId: sequence.id,
        stepIds: newOrder.map((s) => s.id),
      });
    }
  };

  const stats = {
    enrolled: sequence.enrolled_count || 0,
    completed: sequence.completed_count || 0,
    exitedEarly: sequence.exited_early_count || 0,
    active: enrollments?.filter((e) => e.status === "active").length || 0,
    paused: enrollments?.filter((e) => e.status === "paused").length || 0,
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/sequences")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">{sequence.name}</h1>
              <Badge
                variant={
                  sequence.status === "active"
                    ? "default"
                    : sequence.status === "paused"
                    ? "secondary"
                    : "outline"
                }
              >
                {sequence.status}
              </Badge>
            </div>
            {sequence.description && (
              <p className="text-muted-foreground">{sequence.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {sequence.status !== "archived" && (
            <Button
              variant="outline"
              onClick={() =>
                toggleStatusMutation.mutate({
                  sequenceId: sequence.id,
                  status: sequence.status === "active" ? "paused" : "active",
                })
              }
              disabled={toggleStatusMutation.isPending}
            >
              {sequence.status === "active" ? (
                <>
                  <Pause className="h-4 w-4 mr-2" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2" />
                  Activate
                </>
              )}
            </Button>
          )}
          <Button variant="outline" onClick={() => setShowSettings(true)}>
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Enrolled</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats.enrolled}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Play className="h-4 w-4 text-green-500" />
              <span className="text-sm text-muted-foreground">Active</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats.active}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Pause className="h-4 w-4 text-yellow-500" />
              <span className="text-sm text-muted-foreground">Paused</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats.paused}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-blue-500" />
              <span className="text-sm text-muted-foreground">Completed</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats.completed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              <span className="text-sm text-muted-foreground">Exited Early</span>
            </div>
            <p className="text-2xl font-bold mt-1">{stats.exitedEarly}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="steps">
            <Mail className="h-4 w-4 mr-2" />
            Steps ({sequence.steps?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="enrollments">
            <Users className="h-4 w-4 mr-2" />
            Enrollments ({stats.enrolled})
          </TabsTrigger>
          <TabsTrigger value="analytics">
            <BarChart3 className="h-4 w-4 mr-2" />
            Analytics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="steps" className="mt-6">
          <StepsBuilder
            sequence={sequence}
            onAddStep={() => setShowAddStep(true)}
            onEditStep={setEditingStep}
            onDeleteStep={(stepId) => deleteStepMutation.mutate({ sequenceId: sequence.id, stepId })}
            onDragEnd={handleDragEnd}
          />
        </TabsContent>

        <TabsContent value="enrollments" className="mt-6">
          <EnrollmentsList
            enrollments={enrollments || []}
            onRemove={(enrollmentId) =>
              removeFromSequenceMutation.mutate(enrollmentId)
            }
          />
        </TabsContent>

        <TabsContent value="analytics" className="mt-6">
          <SequenceAnalyticsTab
            sequenceId={sequence.id}
            steps={sequence.steps}
          />
        </TabsContent>
      </Tabs>

      {/* Add Step Dialog */}
      <AddStepDialog
        open={showAddStep}
        onOpenChange={setShowAddStep}
        onSubmit={(step) => {
          createStepMutation.mutate(
            { sequenceId: sequence.id, step },
            { onSuccess: () => setShowAddStep(false) }
          );
        }}
        isPending={createStepMutation.isPending}
      />

      {/* Edit Step Dialog */}
      {editingStep && (
        <EditStepDialog
          step={editingStep}
          open={!!editingStep}
          onOpenChange={(open) => !open && setEditingStep(null)}
          onSubmit={(step) => {
            updateStepMutation.mutate(
              { sequenceId: sequence.id, stepId: editingStep.id, step },
              { onSuccess: () => setEditingStep(null) }
            );
          }}
          isPending={updateStepMutation.isPending}
        />
      )}

      {/* Settings Dialog */}
      <SequenceSettingsDialog
        sequence={sequence}
        open={showSettings}
        onOpenChange={setShowSettings}
        onSubmit={(data) => {
          updateMutation.mutate(
            { sequenceId: sequence.id, input: data },
            { onSuccess: () => setShowSettings(false) }
          );
        }}
        isPending={updateMutation.isPending}
      />
    </div>
  );
}

// Steps Builder Component
interface StepsBuilderProps {
  sequence: any;
  onAddStep: () => void;
  onEditStep: (step: SequenceStep) => void;
  onDeleteStep: (stepId: string) => void;
  onDragEnd: (event: DragEndEvent) => void;
}

function StepsBuilder({
  sequence,
  onAddStep,
  onEditStep,
  onDeleteStep,
  onDragEnd,
}: StepsBuilderProps) {
  const steps = sequence.steps || [];

  return (
    <div className="space-y-4">
      {steps.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="p-4 rounded-full bg-muted mb-4">
              <Mail className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No steps yet</h3>
            <p className="text-muted-foreground text-center max-w-md mb-4">
              Add your first step to start building this sequence.
            </p>
            <Button variant="cta" onClick={onAddStep}>
              <Plus className="h-4 w-4 mr-2" />
              Add First Step
            </Button>
          </CardContent>
        </Card>
      ) : (
        <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={steps.map((s: SequenceStep) => s.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {steps.map((step: SequenceStep, index: number) => (
                <SortableStepCard
                  key={step.id}
                  step={step}
                  index={index}
                  onEdit={() => onEditStep(step)}
                  onDelete={() => onDeleteStep(step.id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {steps.length > 0 && (
        <Button variant="outline" className="w-full" onClick={onAddStep}>
          <Plus className="h-4 w-4 mr-2" />
          Add Step
        </Button>
      )}
    </div>
  );
}

// Sortable Step Card
interface SortableStepCardProps {
  step: SequenceStep;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
}

function SortableStepCard({ step, index, onEdit, onDelete }: SortableStepCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const StepIcon = getStepIconComponent(step.step_type);

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative",
        isDragging && "opacity-50 border-primary"
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-center gap-4">
          {/* Drag Handle */}
          <div
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </div>

          {/* Step Number */}
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-semibold text-sm">
            {index + 1}
          </div>

          {/* Icon */}
          <div className="p-2 rounded-lg bg-muted">
            <StepIcon className="h-4 w-4" />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-medium">{step.name || getStepTypeLabel(step.step_type)}</h4>
              <Badge variant="outline" className="text-xs">
                {getStepTypeLabel(step.step_type)}
              </Badge>
            </div>
            {step.delay_value && (
              <p className="text-sm text-muted-foreground">
                Wait {step.delay_value} {step.delay_unit || "hours"} before executing
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={onEdit}>
              <Edit className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onDelete}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function getStepIconComponent(type: StepType) {
  const icons: Record<StepType, any> = {
    send_message: MessageSquare,
    wait: Timer,
    condition: Zap,
    add_tag: Tag,
    remove_tag: Tag,
    change_stage: ChevronRight,
    update_score: BarChart3,
    trigger_webhook: Webhook,
    send_notification: Bell,
    exit_sequence: XCircle,
    enroll_in_sequence: Users,
  };
  return icons[type] || Mail;
}

// Enrollments List
interface EnrollmentsListProps {
  enrollments: any[];
  onRemove: (enrollmentId: string) => void;
}

function EnrollmentsList({ enrollments, onRemove }: EnrollmentsListProps) {
  if (enrollments.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Users className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No enrollments yet</h3>
          <p className="text-muted-foreground text-center max-w-md">
            Contacts enrolled in this sequence will appear here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <ScrollArea className="h-[500px]">
          <div className="divide-y">
            {enrollments.map((enrollment) => (
              <div
                key={enrollment.id}
                className="flex items-center gap-4 p-4 hover:bg-muted/50"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">
                      {enrollment.contact?.display_name || "Unknown Contact"}
                    </span>
                    <Badge
                      variant={
                        enrollment.status === "active"
                          ? "default"
                          : enrollment.status === "completed"
                          ? "secondary"
                          : "outline"
                      }
                    >
                      {getEnrollmentStatusLabel(enrollment.status)}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Step {enrollment.current_step_index + 1} •
                    Enrolled {formatDistanceToNow(new Date(enrollment.enrolled_at), { addSuffix: true })}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemove(enrollment.id)}
                >
                  <UserX className="h-4 w-4 mr-1" />
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

// Add Step Dialog
interface AddStepDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (step: StepInput) => void;
  isPending: boolean;
}

function AddStepDialog({ open, onOpenChange, onSubmit, isPending }: AddStepDialogProps) {
  const [stepType, setStepType] = useState<StepType>("send_message");
  const [name, setName] = useState("");
  const [delayValue, setDelayValue] = useState<number>(1);
  const [delayUnit, setDelayUnit] = useState<"minutes" | "hours" | "days">("hours");
  const [messageContent, setMessageContent] = useState("");
  const [messageChannel, setMessageChannel] = useState<string>("linkedin");

  const handleSubmit = () => {
    const config: Record<string, any> = {};

    if (stepType === "send_message") {
      config.content = messageContent;
      config.channel = messageChannel;
    }

    onSubmit({
      step_type: stepType,
      name: name || undefined,
      delay_value: delayValue,
      delay_unit: delayUnit,
      config,
    });

    // Reset form
    setStepType("send_message");
    setName("");
    setDelayValue(1);
    setDelayUnit("hours");
    setMessageContent("");
    setMessageChannel("linkedin");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Step</DialogTitle>
          <DialogDescription>
            Configure the step to add to this sequence.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Step Type</Label>
            <Select value={stepType} onValueChange={(v) => setStepType(v as StepType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="send_message">Send Message</SelectItem>
                <SelectItem value="wait">Wait</SelectItem>
                <SelectItem value="add_tag">Add Tag</SelectItem>
                <SelectItem value="remove_tag">Remove Tag</SelectItem>
                <SelectItem value="change_stage">Change Stage</SelectItem>
                <SelectItem value="update_score">Update Score</SelectItem>
                <SelectItem value="trigger_webhook">Trigger Webhook</SelectItem>
                <SelectItem value="exit_sequence">Exit Sequence</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Step Name (optional)</Label>
            <Input
              placeholder="e.g., Initial outreach"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Delay</Label>
              <Input
                type="number"
                min={0}
                value={delayValue}
                onChange={(e) => setDelayValue(parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label>Unit</Label>
              <Select value={delayUnit} onValueChange={(v) => setDelayUnit(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutes">Minutes</SelectItem>
                  <SelectItem value="hours">Hours</SelectItem>
                  <SelectItem value="days">Days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {stepType === "send_message" && (
            <>
              <div className="space-y-2">
                <Label>Channel</Label>
                <Select value={messageChannel} onValueChange={setMessageChannel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="linkedin">LinkedIn</SelectItem>
                    <SelectItem value="instagram">Instagram</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Message</Label>
                <Textarea
                  placeholder="Write your message... Use {{first_name}} for personalization"
                  value={messageContent}
                  onChange={(e) => setMessageContent(e.target.value)}
                  rows={4}
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="cta" onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Adding..." : "Add Step"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Edit Step Dialog (similar to Add but pre-filled)
interface EditStepDialogProps {
  step: SequenceStep;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (step: Partial<StepInput>) => void;
  isPending: boolean;
}

function EditStepDialog({ step, open, onOpenChange, onSubmit, isPending }: EditStepDialogProps) {
  const [name, setName] = useState(step.name || "");
  const [delayValue, setDelayValue] = useState(step.delay_value || 1);
  const [delayUnit, setDelayUnit] = useState<"minutes" | "hours" | "days">(
    (step.delay_unit as any) || "hours"
  );
  const [messageContent, setMessageContent] = useState(
    (step.config as any)?.content || ""
  );
  const [messageChannel, setMessageChannel] = useState(
    (step.config as any)?.channel || "linkedin"
  );

  const handleSubmit = () => {
    const config: Record<string, any> = { ...step.config };

    if (step.step_type === "send_message") {
      config.content = messageContent;
      config.channel = messageChannel;
    }

    onSubmit({
      name: name || undefined,
      delay_value: delayValue,
      delay_unit: delayUnit,
      config,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Step</DialogTitle>
          <DialogDescription>
            Update the configuration for this step.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Step Type</Label>
            <Input value={getStepTypeLabel(step.step_type)} disabled />
          </div>

          <div className="space-y-2">
            <Label>Step Name (optional)</Label>
            <Input
              placeholder="e.g., Initial outreach"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Delay</Label>
              <Input
                type="number"
                min={0}
                value={delayValue}
                onChange={(e) => setDelayValue(parseInt(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label>Unit</Label>
              <Select value={delayUnit} onValueChange={(v) => setDelayUnit(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutes">Minutes</SelectItem>
                  <SelectItem value="hours">Hours</SelectItem>
                  <SelectItem value="days">Days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {step.step_type === "send_message" && (
            <>
              <div className="space-y-2">
                <Label>Channel</Label>
                <Select value={messageChannel} onValueChange={setMessageChannel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="linkedin">LinkedIn</SelectItem>
                    <SelectItem value="instagram">Instagram</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Message</Label>
                <Textarea
                  placeholder="Write your message... Use {{first_name}} for personalization"
                  value={messageContent}
                  onChange={(e) => setMessageContent(e.target.value)}
                  rows={4}
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="cta" onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Settings Dialog
interface SequenceSettingsDialogProps {
  sequence: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: any) => void;
  isPending: boolean;
}

function SequenceSettingsDialog({
  sequence,
  open,
  onOpenChange,
  onSubmit,
  isPending,
}: SequenceSettingsDialogProps) {
  const [name, setName] = useState(sequence.name);
  const [description, setDescription] = useState(sequence.description || "");
  const [exitOnReply, setExitOnReply] = useState(
    sequence.exit_on_reply ?? true
  );
  const [exitOnBounce, setExitOnBounce] = useState(
    sequence.exit_on_bounce ?? true
  );

  const handleSubmit = () => {
    onSubmit({
      name,
      description: description || null,
      exit_on_reply: exitOnReply,
      exit_on_bounce: exitOnBounce,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sequence Settings</DialogTitle>
          <DialogDescription>
            Configure the sequence behavior and details.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Exit on Reply</Label>
                <p className="text-sm text-muted-foreground">
                  Automatically remove contacts when they reply
                </p>
              </div>
              <input
                type="checkbox"
                checked={exitOnReply}
                onChange={(e) => setExitOnReply(e.target.checked)}
                className="h-4 w-4"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label>Exit on Bounce</Label>
                <p className="text-sm text-muted-foreground">
                  Remove contacts if messages bounce
                </p>
              </div>
              <input
                type="checkbox"
                checked={exitOnBounce}
                onChange={(e) => setExitOnBounce(e.target.checked)}
                className="h-4 w-4"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="cta" onClick={handleSubmit} disabled={isPending || !name.trim()}>
            {isPending ? "Saving..." : "Save Settings"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
