import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { ProxyPoolManager } from "@/components/list-building/ProxyPoolManager";

export default function ListBuildingProxiesPage() {
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
          <ProxyPoolManager />
        </div>
      </div>
    </AppLayout>
  );
}
