/**
 * @deprecated Use useToolConnections.ts instead. This file re-exports for backwards compatibility.
 */
export {
  useToolConnections as useEmailToolConnections,
  useToolCampaigns as useEmailToolCampaigns,
  useCreateToolConnection as useCreateEmailToolConnection,
  useDeleteToolConnection as useDeleteEmailToolConnection,
  useNotionDatabases,
  type ToolConnection as EmailToolConnection,
  type ToolCampaign as EmailToolCampaign,
  type ToolType,
  type NotionDatabase,
} from "./useToolConnections";
