import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { CacheStatsDashboard } from "@/components/list-building/CacheStatsDashboard";

export default function ListBuildingCachePage() {
  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="flex-1 p-8">
        <div className="max-w-[1400px] mx-auto">
          <CacheStatsDashboard />
        </div>
      </div>
    </AppLayout>
  );
}
