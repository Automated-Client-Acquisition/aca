import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useState } from "react";
import { useICPs } from "@/hooks/useICPs";
import { Users, Check } from "lucide-react";
import { IcpBasicsFields, IcpBasicsValue } from "./IcpBasicsFields";
import { IcpTargetingFields, IcpTargetingValue } from "./IcpTargetingFields";

interface AddICPDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EMPTY_BASICS: IcpBasicsValue = { name: "", summary: "", description: "" };

const EMPTY_TARGETING: IcpTargetingValue = {
  pain_points: [],
  desires: [],
  objections: [],
  language_style: "",
  tags: [],
  target_locations: [],
  target_employee_bands: [],
  target_revenue_bands: [],
  target_industries: [],
  target_seniorities: [],
  target_departments: [],
  target_title_keywords: [],
  decision_maker_notes: "",
};

export function AddICPDialog({ open, onOpenChange }: AddICPDialogProps) {
  const { createICP, isCreating } = useICPs();
  const [basics, setBasics] = useState<IcpBasicsValue>(EMPTY_BASICS);
  const [targeting, setTargeting] = useState<IcpTargetingValue>(EMPTY_TARGETING);
  const [dmSectionOpen, setDmSectionOpen] = useState(false);

  const handleBasicsChange = <K extends keyof IcpBasicsValue>(field: K, value: IcpBasicsValue[K]) => {
    setBasics((prev) => ({ ...prev, [field]: value }));
  };

  const handleTargetingChange = <K extends keyof IcpTargetingValue>(field: K, value: IcpTargetingValue[K]) => {
    setTargeting((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    await createICP({
      name: basics.name,
      summary: basics.summary || null,
      description: basics.description || null,
      pain_points: targeting.pain_points.length > 0 ? targeting.pain_points : null,
      desires: targeting.desires.length > 0 ? targeting.desires : null,
      objections: targeting.objections.length > 0 ? targeting.objections : null,
      language_style: targeting.language_style || null,
      tags: targeting.tags.length > 0 ? targeting.tags : null,
      target_locations: targeting.target_locations.length > 0 ? targeting.target_locations : null,
      target_employee_bands: targeting.target_employee_bands,
      target_revenue_bands: targeting.target_revenue_bands,
      target_industries: targeting.target_industries,
      target_seniorities: targeting.target_seniorities.length > 0 ? targeting.target_seniorities : null,
      target_departments: targeting.target_departments.length > 0 ? targeting.target_departments : null,
      target_title_keywords: targeting.target_title_keywords.length > 0 ? targeting.target_title_keywords : null,
      decision_maker_notes: targeting.decision_maker_notes || null,
    });
    resetForm();
    onOpenChange(false);
  };

  const resetForm = () => {
    setBasics(EMPTY_BASICS);
    setTargeting(EMPTY_TARGETING);
    setDmSectionOpen(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm();
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex flex-col h-[90vh] overflow-hidden max-w-4xl p-0">
        <form className="flex flex-col flex-1 min-h-0" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
          {/* Header with gradient background */}
          <div className="shrink-0 px-6 pt-6 pb-4 bg-gradient-to-br from-blue-500/10 via-cyan-500/5 to-transparent relative">
            <div className="absolute top-4 right-8">
              <Badge className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white border-0">
                <Users className="w-3 h-3 mr-1" />
                New Audience
              </Badge>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg">
                <Users className="w-6 h-6 text-white" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold">Create Target Audience</DialogTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Define your ideal customer profile with pain points and desires
                </p>
              </div>
            </div>
          </div>

          <ScrollArea className="flex-1 min-h-0">
            <div className="space-y-6 px-8 py-6">
              <Card className="border-2 border-blue-500/20 bg-gradient-to-br from-blue-500/5 to-transparent overflow-hidden">
                <div className="h-1.5 bg-gradient-to-r from-blue-500 to-cyan-500" />
                <CardContent className="pt-6">
                  <IcpBasicsFields value={basics} onChange={handleBasicsChange} />
                </CardContent>
              </Card>

              <Separator className="my-6" />

              <IcpTargetingFields
                value={targeting}
                onChange={handleTargetingChange}
                dmSectionOpen={dmSectionOpen}
                onDmSectionOpenChange={setDmSectionOpen}
              />
            </div>
          </ScrollArea>

          {/* Footer */}
          <div className="shrink-0 px-6 py-4 border-t bg-background flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {basics.name.trim() ? "Ready to create" : "Fill in audience details"}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isCreating || !basics.name.trim()}
                variant="cta"
                className="min-w-[160px]"
              >
                {isCreating ? (
                  <>Creating...</>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Create Audience
                  </>
                )}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
