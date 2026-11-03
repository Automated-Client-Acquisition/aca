import { Settings } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

export function SettingsHeader() {
  return (
    <PageHeader
      className="mb-8"
      icon={Settings}
      title="Settings"
      description="Your workspace, sending accounts, integrations and AI preferences"
    />
  );
}
