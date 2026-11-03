import { useState } from "react";
import { usePublicSkills, useIncrementSkillInstall, type SkillWithOrg } from "@/hooks/useSkills";
import { getSkillInstallCommand, slugify } from "@/lib/skillUtils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, Check, Download, Search } from "lucide-react";
import { toast } from "sonner";

export function SkillsMarketplace() {
  const [searchQuery, setSearchQuery] = useState("");
  const { data: skills, isLoading } = usePublicSkills(searchQuery);
  const { mutate: incrementInstall } = useIncrementSkillInstall();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (skill: SkillWithOrg) => {
    const orgSlug = slugify(skill.organizations?.slug ?? skill.organizations?.name ?? "org");
    const cmd = getSkillInstallCommand(orgSlug, skill.slug);
    await navigator.clipboard.writeText(cmd);
    setCopiedId(skill.id);
    toast.success("Install command copied");
    incrementInstall(skill.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-4 mt-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search community skills..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : !skills?.length ? (
        <div className="text-center py-16 text-muted-foreground">
          {searchQuery
            ? "No skills found for that search."
            : "No public skills yet. Be the first to share one!"}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {skills.map((skill) => {
            const orgSlug = slugify(skill.organizations?.slug ?? skill.organizations?.name ?? "org");
            const installCmd = getSkillInstallCommand(orgSlug, skill.slug);
            return (
              <div
                key={skill.id}
                className="border rounded-lg p-4 flex flex-col gap-3 hover:border-primary/50 transition-colors"
              >
                <div className="flex-1">
                  <h3 className="font-semibold leading-tight">{skill.name}</h3>
                  {skill.description && (
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                      {skill.description}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {skill.organizations?.name && (
                      <Badge variant="outline" className="text-xs">
                        {skill.organizations.name}
                      </Badge>
                    )}
                    {skill.tags.slice(0, 2).map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono bg-muted px-2 py-1.5 rounded truncate">
                    {installCmd}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Download className="h-3 w-3" />
                      {skill.install_count} installs
                    </span>
                    <Button size="sm" variant="outline" onClick={() => handleCopy(skill)}>
                      {copiedId === skill.id ? (
                        <><Check className="h-3.5 w-3.5 mr-1.5 text-green-500" />Copied</>
                      ) : (
                        <><Copy className="h-3.5 w-3.5 mr-1.5" />Copy</>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
