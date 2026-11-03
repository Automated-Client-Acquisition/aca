import { useState } from "react";
import { useSkills, type Skill } from "@/hooks/useSkills";
import { useAuth } from "@/contexts/AuthContext";
import { SkillDetailsDialog } from "./SkillDetailsDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getSkillInstallCommand, slugify } from "@/lib/skillUtils";
import { Copy, Check, Globe, Lock, Terminal, Plus } from "lucide-react";
import { toast } from "sonner";

interface SkillsTableProps {
  onAdd: () => void;
}

export function SkillsTable({ onAdd }: SkillsTableProps) {
  const { data: skills, isLoading } = useSkills();
  const { currentOrganization } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const orgSlug = slugify(currentOrganization?.name ?? "org");

  const filtered = (skills ?? []).filter(
    (s) =>
      !searchQuery ||
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.description ?? "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCopy = async (skill: Skill, e: React.MouseEvent) => {
    e.stopPropagation();
    const cmd = getSkillInstallCommand(orgSlug, skill.slug);
    await navigator.clipboard.writeText(cmd);
    setCopiedId(skill.id);
    toast.success("Install command copied");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleRowClick = (skill: Skill) => {
    setSelectedSkill(skill);
    setDetailsOpen(true);
  };

  if (isLoading) {
    return (
      <div className="space-y-3 mt-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (!skills?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-14 h-14 rounded-2xl bg-gradient-aca flex items-center justify-center shadow-lg mb-4">
          <Terminal className="w-7 h-7 text-white" />
        </div>
        <h3 className="text-lg font-semibold mb-2">No skills yet</h3>
        <p className="text-muted-foreground text-sm mb-6 max-w-sm">
          Upload a <code>.md</code> skill file to teach AI coding assistants how to use your
          tools. Share them publicly for the community to discover.
        </p>
        <Button variant="cta" onClick={onAdd}>
          <Plus className="h-4 w-4 mr-2" />
          Add your first skill
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-4">
      <Input
        placeholder="Search skills..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="max-w-sm"
      />

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-3 font-semibold">Name</th>
              <th className="text-left p-3 font-semibold hidden md:table-cell">Description</th>
              <th className="text-left p-3 font-semibold">Visibility</th>
              <th className="text-left p-3 font-semibold hidden sm:table-cell">Installs</th>
              <th className="text-right p-3 font-semibold">Install</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((skill) => (
              <tr
                key={skill.id}
                className="hover:bg-muted/30 cursor-pointer group"
                onClick={() => handleRowClick(skill)}
              >
                <td className="p-3 font-medium group-hover:text-primary transition-colors">
                  {skill.name}
                </td>
                <td className="p-3 text-muted-foreground hidden md:table-cell max-w-xs truncate">
                  {skill.description ?? "-"}
                </td>
                <td className="p-3">
                  <Badge variant={skill.is_public ? "default" : "outline"} className="text-xs">
                    {skill.is_public ? (
                      <><Globe className="h-3 w-3 mr-1" />Public</>
                    ) : (
                      <><Lock className="h-3 w-3 mr-1" />Private</>
                    )}
                  </Badge>
                </td>
                <td className="p-3 text-muted-foreground hidden sm:table-cell">
                  {skill.install_count}
                </td>
                <td className="p-3 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => handleCopy(skill, e)}
                    title={`npx add-skill ${orgSlug}/${skill.slug}`}
                  >
                    {copiedId === skill.id ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SkillDetailsDialog
        skill={selectedSkill}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </div>
  );
}
