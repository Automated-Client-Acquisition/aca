import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { UserProfileMenu } from "@/components/UserProfileMenu";
import { AssetsHeader } from "@/components/AssetsHeader";
import { AssetsTabs } from "@/components/AssetsTabs";
import { TabsContent } from "@/components/ui/tabs";
import { BrandVoicesTable } from "@/components/BrandVoicesTable";
import { CharactersTable } from "@/components/CharactersTable";
import { ProductsTable } from "@/components/ProductsTable";
import { LibraryImagesTable } from "@/components/LibraryImagesTable";
import { ICPsTable } from "@/components/ICPsTable";
import { BlocksTable } from "@/components/BlocksTable";
import { StrategiesTable, AddStrategyDialog } from "@/components/strategies";
import { KnowledgeDocumentsTable } from "@/components/knowledge-base/KnowledgeDocumentsTable";
import { UploadDocumentDialog } from "@/components/knowledge-base/UploadDocumentDialog";
import { AddBrandVoiceDialog } from "@/components/AddBrandVoiceDialog";
import { AddCharacterDialog } from "@/components/AddCharacterDialog";
import { AddProductDialog } from "@/components/AddProductDialog";
import { AddLibraryImageDialog } from "@/components/AddLibraryImageDialog";
import { AddICPDialog } from "@/components/AddICPDialog";
import { AddBlockDialog } from "@/components/AddBlockDialog";
import { StarterPackDialog } from "@/components/StarterPackDialog";
import { BrandKitDefaultsCard } from "@/components/brand-kit/BrandKitDefaultsCard";

const validTabs = ["brands", "characters", "products", "images", "icps", "blocks", "strategies", "knowledge"];

const Assets = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : "brands";
  const tabsRef = useRef<HTMLDivElement>(null);
  // In the URL so links like /assets?tab=images (from Ideas, Research) keep working.
  const setActiveTab = (tab: string) => setSearchParams(tab === "brands" ? {} : { tab }, { replace: true });
  const openTabFromCard = (tab: string) => {
    setActiveTab(tab);
    tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const [brandVoiceDialogOpen, setBrandVoiceDialogOpen] = useState(false);
  const [characterDialogOpen, setCharacterDialogOpen] = useState(false);
  const [productDialogOpen, setProductDialogOpen] = useState(false);
  const [libraryImageDialogOpen, setLibraryImageDialogOpen] = useState(false);
  const [icpDialogOpen, setIcpDialogOpen] = useState(false);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [strategyDialogOpen, setStrategyDialogOpen] = useState(false);
  const [knowledgeDialogOpen, setKnowledgeDialogOpen] = useState(false);
  const [starterPackDialogOpen, setStarterPackDialogOpen] = useState(false);

  const openAddDialog = (tab: string) => {
    switch (tab) {
      case "brands":
        setBrandVoiceDialogOpen(true);
        break;
      case "characters":
        setCharacterDialogOpen(true);
        break;
      case "products":
        setProductDialogOpen(true);
        break;
      case "images":
        setLibraryImageDialogOpen(true);
        break;
      case "icps":
        setIcpDialogOpen(true);
        break;
      case "blocks":
        setBlockDialogOpen(true);
        break;
      case "strategies":
        setStrategyDialogOpen(true);
        break;
      case "knowledge":
        setKnowledgeDialogOpen(true);
        break;
    }
  };

  return (
    <AppLayout
      header={
        <div className="ml-auto">
          <UserProfileMenu />
        </div>
      }
    >
      <div className="flex-1 p-4 sm:p-8">
        <div className="max-w-[1600px] mx-auto">
          <AssetsHeader onStarterPackClick={() => setStarterPackDialogOpen(true)} />
          <BrandKitDefaultsCard
            activeTab={activeTab}
            onOpenTab={openTabFromCard}
            onAdd={(tab) => {
              setActiveTab(tab);
              openAddDialog(tab);
            }}
          />
          <div ref={tabsRef} className="scroll-mt-4" />
          <AssetsTabs value={activeTab} onTabChange={setActiveTab} onAdd={() => openAddDialog(activeTab)}>
            <TabsContent value="brands" className="mt-0">
              <BrandVoicesTable onAdd={() => setBrandVoiceDialogOpen(true)} />
            </TabsContent>

            <TabsContent value="characters" className="mt-0">
              <CharactersTable onAdd={() => setCharacterDialogOpen(true)} />
            </TabsContent>

            <TabsContent value="products" className="mt-0">
              <ProductsTable onAdd={() => setProductDialogOpen(true)} />
            </TabsContent>

            <TabsContent value="images" className="mt-0">
              <LibraryImagesTable onAdd={() => setLibraryImageDialogOpen(true)} />
            </TabsContent>

            <TabsContent value="icps" className="mt-0">
              <ICPsTable onAdd={() => setIcpDialogOpen(true)} />
            </TabsContent>

            <TabsContent value="blocks" className="mt-0">
              <BlocksTable onAdd={() => setBlockDialogOpen(true)} />
            </TabsContent>

            <TabsContent value="strategies" className="mt-0">
              <StrategiesTable onAdd={() => setStrategyDialogOpen(true)} />
            </TabsContent>

            <TabsContent value="knowledge" className="mt-0">
              <KnowledgeDocumentsTable onUploadClick={() => setKnowledgeDialogOpen(true)} />
            </TabsContent>
          </AssetsTabs>
        </div>
      </div>

      <AddBrandVoiceDialog open={brandVoiceDialogOpen} onOpenChange={setBrandVoiceDialogOpen} />
      <AddCharacterDialog open={characterDialogOpen} onOpenChange={setCharacterDialogOpen} />
      <AddProductDialog open={productDialogOpen} onOpenChange={setProductDialogOpen} />
      <AddLibraryImageDialog open={libraryImageDialogOpen} onOpenChange={setLibraryImageDialogOpen} />
      <AddICPDialog open={icpDialogOpen} onOpenChange={setIcpDialogOpen} />
      <AddBlockDialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen} />
      <AddStrategyDialog open={strategyDialogOpen} onOpenChange={setStrategyDialogOpen} />
      <UploadDocumentDialog open={knowledgeDialogOpen} onOpenChange={setKnowledgeDialogOpen} />
      <StarterPackDialog open={starterPackDialogOpen} onOpenChange={setStarterPackDialogOpen} />
    </AppLayout>
  );
};

export default Assets;
