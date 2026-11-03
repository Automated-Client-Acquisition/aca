import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader } from "@/components/PageHeader";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { SkillsTable } from "@/components/skills/SkillsTable";
import { SkillsMarketplace } from "@/components/skills/SkillsMarketplace";
import { AddSkillDialog } from "@/components/skills/AddSkillDialog";
import { Terminal, Globe, Plus } from "lucide-react";

const Skills = () => {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("my-skills");

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="flex-1 p-8">
        <div className="max-w-[1600px] mx-auto">
          <PageHeader
            className="mb-8"
            icon={Terminal}
            title="Skills Library"
            description={
              <>
                Upload and share <code>.md</code> skill files that teach AI coding assistants
                how to use your tools
              </>
            }
            actions={
              activeTab === "my-skills" && (
                <Button variant="cta" onClick={() => setAddDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Skill
                </Button>
              )
            }
          />

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="my-skills" className="flex items-center gap-2">
                <Terminal className="h-4 w-4" />
                My Skills
              </TabsTrigger>
              <TabsTrigger value="community" className="flex items-center gap-2">
                <Globe className="h-4 w-4" />
                Community
              </TabsTrigger>
            </TabsList>

            <TabsContent value="my-skills">
              <SkillsTable onAdd={() => setAddDialogOpen(true)} />
            </TabsContent>

            <TabsContent value="community">
              <SkillsMarketplace />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <AddSkillDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
    </AppLayout>
  );
};

export default Skills;
