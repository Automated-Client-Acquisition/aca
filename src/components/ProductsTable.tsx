import { useState, useMemo, useEffect } from "react";
import { useProducts } from "@/hooks/useProducts";
import { Skeleton } from "@/components/ui/skeleton";
import { ContentToolbar } from "./ContentToolbar";
import { DataTable, DataTableColumn } from "./DataTable";
import { ProductDetailsDialog } from "./ProductDetailsDialog";
import { TablePagination } from "./TablePagination";
import { BulkActionsToolbar } from "./BulkActionsToolbar";
import { AssetEmptyState } from "./assets/AssetEmptyState";
import type { SortConfig } from "@/lib/tableUtils";
import { sortData, loadColumnConfig, saveColumnConfig, formatDate } from "@/lib/tableUtils";
import { useTablePagination } from "@/hooks/useTablePagination";
import type { ColumnConfig } from "./ColumnSelector";
import type { ExportColumn } from "@/lib/exportUtils";
import { Image as ImageIcon } from "lucide-react";

interface Product {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  brand: string | null;
  logo: string | null;
  sku: string | null;
  price: number | null;
  currency: string | null;
  images: string[] | null;
  videos: string[] | null;
  features: string[] | null;
  specifications: any;
  affiliate_links: any;
  tags: string[] | null;
  
  // ICP Fields (flat)
  icp_age_range: string | null;
  icp_gender: string | null;
  icp_income: string | null;
  icp_location: string | null;
  icp_job_titles: string[] | null;
  icp_psychographics: string[] | null;
  icp_pain_points: string[] | null;
  icp_desires: string[] | null;
  icp_buying_motivations: string[] | null;
  
  // Marketing Fields (flat)
  marketing_primary_angle: string | null;
  marketing_hooks: string[] | null;
  marketing_urgency_factors: string[] | null;
  marketing_alternative_angles: string[] | null;
  marketing_emotional_triggers: string[] | null;
  
  // Affiliate Fields (flat)
  affiliate_key_messages: string[] | null;
  affiliate_content_ideas: string[] | null;
  affiliate_calls_to_action: string[] | null;
  affiliate_target_platforms: string[] | null;
  affiliate_recommended_approach: string | null;
  
  organization_id: string;
  created_at: string | null;
  updated_at: string | null;
}

interface ProductsTableProps {
  onAdd?: () => void;
}

export function ProductsTable({ onAdd }: ProductsTableProps) {
  const { products, isLoading, updateProduct, deleteProduct, deleteBulkProducts, isUpdating, isDeletingBulk } = useProducts();
  const [searchQuery, setSearchQuery] = useState("");
  const [sortConfig, setSortConfig] = useState<SortConfig>({ column: null, direction: null });
  const [visibleColumns, setVisibleColumns] = useState<string[]>(["name", "category", "brand", "price", "created_at"]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const { currentPage, pageSize, setCurrentPage, handlePageSizeChange, resetPage } = useTablePagination("products");

  useEffect(() => {
    const saved = loadColumnConfig("products");
    if (saved) setVisibleColumns(saved.visible);
  }, []);

  useEffect(() => {
    resetPage();
  }, [searchQuery, resetPage]);

  const columnConfigs: ColumnConfig[] = [
    { key: "name", label: "Name", alwaysVisible: true },
    { key: "category", label: "Category" },
    { key: "brand", label: "Brand" },
    { key: "price", label: "Price" },
    { key: "created_at", label: "Created" },
  ];

  const tableColumns: DataTableColumn[] = [
    { 
      key: "name", 
      label: "Product", 
      sortable: true, 
      visible: visibleColumns.includes("name"), 
      render: (v, row) => (
        <div className="flex items-center gap-3 py-1">
          <div className="w-10 h-10 rounded-lg overflow-hidden bg-muted flex items-center justify-center flex-shrink-0 border">
            {row.images?.[0] ? (
              <img src={row.images[0]} alt={v} className="w-full h-full object-cover" />
            ) : (
              <ImageIcon className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-semibold text-foreground truncate group-hover:text-primary transition-colors duration-200">
              {v}
            </span>
            {row.description && (
              <span className="text-sm text-muted-foreground truncate max-w-[300px] group-hover:text-foreground transition-colors duration-200">
                {row.description}
              </span>
            )}
          </div>
        </div>
      )
    },
    { 
      key: "category", 
      label: "Category", 
      sortable: true, 
      visible: visibleColumns.includes("category"), 
      render: (v) => v ? (
        <span className="text-sm text-muted-foreground line-clamp-2 max-w-[260px]">{v}</span>
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      )
    },
    { 
      key: "brand", 
      label: "Brand", 
      sortable: true, 
      visible: visibleColumns.includes("brand"), 
      render: (v) => v ? (
        <span className="text-sm text-muted-foreground line-clamp-2 max-w-[200px]">{v}</span>
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      )
    },
    { 
      key: "price", 
      label: "Price", 
      sortable: true, 
      visible: visibleColumns.includes("price"), 
      render: (v, row) => v ? (
        <span className="text-sm font-medium tabular-nums whitespace-nowrap">
          {row.currency || "USD"} {v.toFixed(2)}
        </span>
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      ),
      className: "text-right"
    },
    { 
      key: "created_at", 
      label: "Created", 
      sortable: true, 
      visible: visibleColumns.includes("created_at"), 
      render: (v) => (
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {formatDate(v)}
        </span>
      )
    },
  ];

  const filteredData = useMemo(() => {
    let result = products;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((item) => item.name?.toLowerCase().includes(query) || item.brand?.toLowerCase().includes(query));
    }
    return result;
  }, [products, searchQuery]);

  const sortedData = useMemo(() => sortData(filteredData, sortConfig), [filteredData, sortConfig]);

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return sortedData.slice(startIndex, endIndex);
  }, [sortedData, currentPage, pageSize]);

  const totalPages = Math.ceil(sortedData.length / pageSize);

  const handleBulkDelete = () => {
    deleteBulkProducts(selectedIds);
    setSelectedIds([]);
  };

  const exportColumns: ExportColumn[] = [
    { key: "name", label: "Name" },
    { key: "category", label: "Category" },
    { key: "brand", label: "Brand" },
    { key: "price", label: "Price" },
    { key: "currency", label: "Currency" },
    { key: "created_at", label: "Created", exportFormat: formatDate },
  ];

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-[600px] w-full" /></div>;

  return (
    <div className="space-y-4">
      <ContentToolbar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        columns={columnConfigs}
        visibleColumns={visibleColumns}
        onColumnVisibilityChange={(cols) => { setVisibleColumns(cols); saveColumnConfig("products", cols, cols); }}
        exportData={sortedData}
        exportColumns={exportColumns}
        exportFilename="products"
      />
      <DataTable
        data={paginatedData}
        columns={tableColumns}
        sortConfig={sortConfig}
        onSort={(col) => setSortConfig({ column: col, direction: sortConfig.column === col && sortConfig.direction === "asc" ? "desc" : "asc" })}
        onRowClick={(row) => {
          setSelectedProduct(row as Product);
          setDetailsDialogOpen(true);
        }}
        emptyMessage="No products found. Create your first product to get started."
        emptyState={onAdd ? <AssetEmptyState type="products" onAdd={onAdd} /> : undefined}
        selectable={true}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
      />
      <TablePagination
        currentPage={currentPage}
        totalPages={totalPages}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
        onPageSizeChange={handlePageSizeChange}
        totalItems={sortedData.length}
      />
      <BulkActionsToolbar
        selectedCount={selectedIds.length}
        onDeleteSelected={handleBulkDelete}
        onDeselectAll={() => setSelectedIds([])}
        isDeleting={isDeletingBulk}
      />
      <ProductDetailsDialog
        product={selectedProduct}
        open={detailsDialogOpen}
        onOpenChange={setDetailsDialogOpen}
        onSave={updateProduct}
        onDelete={deleteProduct}
        isUpdating={isUpdating}
      />
    </div>
  );
}
