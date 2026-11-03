import { useNavigate } from "react-router-dom";
import {
  Search,
  Calendar,
  ThumbsUp,
  FileSpreadsheet,
  Plus,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface ImportOption {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
}

const importOptions: ImportOption[] = [
  {
    id: "linkedin_search",
    title: "LinkedIn Search",
    description: "Import from LinkedIn search results",
    icon: Search,
    iconBg: "bg-blue-100",
    iconColor: "text-blue-700",
  },
  {
    id: "post_reactors",
    title: "Post Reactors",
    description: "Import people who reacted to a post",
    icon: ThumbsUp,
    iconBg: "bg-primary/10",
    iconColor: "text-primary",
  },
  {
    id: "event_attendees",
    title: "Event Attendees",
    description: "Import attendees from an event",
    icon: Calendar,
    iconBg: "bg-green-100",
    iconColor: "text-green-700",
  },
  {
    id: "csv",
    title: "Import CSV",
    description: "Upload contacts from a CSV file",
    icon: FileSpreadsheet,
    iconBg: "bg-orange-100",
    iconColor: "text-orange-700",
  },
  {
    id: "manual",
    title: "Add Manually",
    description: "Create a single lead by hand",
    icon: UserPlus,
    iconBg: "bg-violet-100",
    iconColor: "text-violet-700",
  },
];

interface EmptyListStateProps {
  listId: string;
  listName: string;
}

export function EmptyListState({ listId, listName }: EmptyListStateProps) {
  const navigate = useNavigate();

  const handleImport = (sourceType: string) => {
    // Navigate to import page with list pre-selected
    navigate(`/leads/import?listId=${listId}&source=${sourceType}`);
  };

  return (
    <div className="py-12">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <UserPlus className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Build your list</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Start adding people to "{listName}" by importing from LinkedIn or uploading a CSV file.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl mx-auto">
        {importOptions.map((option) => {
          const Icon = option.icon;
          return (
            <Card
              key={option.id}
              className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md"
              onClick={() => handleImport(option.id)}
            >
              <CardContent className="p-4 text-center">
                <div
                  className={`w-12 h-12 rounded-xl ${option.iconBg} ${option.iconColor} flex items-center justify-center mx-auto mb-3`}
                >
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="font-medium mb-1">{option.title}</h3>
                <p className="text-xs text-muted-foreground">{option.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="text-center mt-8">
        <Button
          variant="cta"
          size="lg"
          onClick={() => navigate(`/leads/import?listId=${listId}`)}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add People to List
        </Button>
      </div>
    </div>
  );
}
