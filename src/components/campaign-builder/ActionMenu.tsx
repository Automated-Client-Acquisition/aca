import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, MessageSquare, Mail, GitBranch, Clock, Flag, Search, Sparkles, Database, FileText, Brain, ListPlus } from "lucide-react";
import { NODE_TYPE_CONFIGS, type SequenceNodeType, type SequenceNode } from "@/lib/sequence-utils";
import { NODE_ICONS, getFilteredNodeGroups, getEmailToolColorClass } from "@/lib/node-menu-shared";

interface ActionMenuProps {
  existingNodes: SequenceNode[];
  onAddNode: (type: SequenceNodeType) => void;
  disabled?: boolean;
}

export function ActionMenu({
  existingNodes,
  onAddNode,
  disabled,
}: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const groups = getFilteredNodeGroups(existingNodes);

  const handleAddNode = (type: SequenceNodeType) => {
    onAddNode(type);
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="cta" size="sm" className="h-9 shrink-0" disabled={disabled}>
          <Plus className="h-4 w-4 mr-2" />
          Add step
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60 max-h-[70vh] overflow-y-auto" align="start">
        {groups.linkedInActions.length > 0 && (
          <>
            <DropdownMenuLabel className="text-blue-600">
              LinkedIn Actions
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              {groups.linkedInActions.map((type) => {
                const config = NODE_TYPE_CONFIGS[type];
                const Icon = NODE_ICONS[type] || MessageSquare;
                return (
                  <DropdownMenuItem
                    key={type}
                    onClick={() => handleAddNode(type)}
                  >
                    <Icon className="h-4 w-4 mr-2" />
                    {config.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </>
        )}

        {groups.linkedInConditions.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>LinkedIn Conditions</DropdownMenuLabel>
            <DropdownMenuGroup>
              {groups.linkedInConditions.map((type) => {
                const config = NODE_TYPE_CONFIGS[type];
                const Icon = NODE_ICONS[type] || GitBranch;
                return (
                  <DropdownMenuItem
                    key={type}
                    onClick={() => handleAddNode(type)}
                  >
                    <Icon className="h-4 w-4 mr-2" />
                    {config.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </>
        )}

        {groups.emailActions.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              <div className="flex items-center gap-1 text-red-500">
                <Mail className="h-3 w-3" />
                Email
              </div>
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              {groups.emailActions.map((type) => {
                const config = NODE_TYPE_CONFIGS[type];
                const Icon = NODE_ICONS[type] || Mail;
                return (
                  <DropdownMenuItem
                    key={type}
                    onClick={() => handleAddNode(type)}
                  >
                    <Icon className="h-4 w-4 mr-2 text-red-500" />
                    {config.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </>
        )}

        {groups.emailConditions.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Email Conditions</DropdownMenuLabel>
            <DropdownMenuGroup>
              {groups.emailConditions.map((type) => {
                const config = NODE_TYPE_CONFIGS[type];
                const Icon = NODE_ICONS[type] || GitBranch;
                return (
                  <DropdownMenuItem
                    key={type}
                    onClick={() => handleAddNode(type)}
                  >
                    <Icon className="h-4 w-4 mr-2 text-red-500" />
                    {config.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </>
        )}

        {groups.channelActions.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Channel Actions</DropdownMenuLabel>
            <DropdownMenuGroup>
              {groups.channelActions.map((type) => {
                const config = NODE_TYPE_CONFIGS[type];
                const Icon = NODE_ICONS[type] || MessageSquare;
                return (
                  <DropdownMenuItem
                    key={type}
                    onClick={() => handleAddNode(type)}
                  >
                    <Icon className="h-4 w-4 mr-2" />
                    {config.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </>
        )}

        {groups.channelConditions.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Channel Conditions</DropdownMenuLabel>
            <DropdownMenuGroup>
              {groups.channelConditions.map((type) => {
                const config = NODE_TYPE_CONFIGS[type];
                const Icon = NODE_ICONS[type] || GitBranch;
                return (
                  <DropdownMenuItem
                    key={type}
                    onClick={() => handleAddNode(type)}
                  >
                    <Icon className="h-4 w-4 mr-2" />
                    {config.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </>
        )}

        {groups.enrichmentNodes.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              <div className="flex items-center gap-1">
                <Database className="h-3 w-3" />
                Enrichment
              </div>
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              {groups.enrichmentNodes.map((type) => {
                const config = NODE_TYPE_CONFIGS[type];
                const Icon = NODE_ICONS[type] || Search;
                return (
                  <DropdownMenuItem
                    key={type}
                    onClick={() => handleAddNode(type)}
                  >
                    <Icon className="h-4 w-4 mr-2 text-amber-500" />
                    {config.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </>
        )}

        {groups.enrichmentConditions.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Enrichment Conditions</DropdownMenuLabel>
            <DropdownMenuGroup>
              {groups.enrichmentConditions.map((type) => {
                const config = NODE_TYPE_CONFIGS[type];
                const Icon = NODE_ICONS[type] || GitBranch;
                return (
                  <DropdownMenuItem
                    key={type}
                    onClick={() => handleAddNode(type)}
                  >
                    <Icon className="h-4 w-4 mr-2 text-violet-500" />
                    {config.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </>
        )}

        {groups.routingNodes.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              <div className="flex items-center gap-1 text-emerald-600">
                <ListPlus className="h-3 w-3" />
                Routing
              </div>
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              {groups.routingNodes.map((type) => {
                const config = NODE_TYPE_CONFIGS[type];
                const Icon = NODE_ICONS[type] || ListPlus;
                return (
                  <DropdownMenuItem
                    key={type}
                    onClick={() => handleAddNode(type)}
                  >
                    <Icon className="h-4 w-4 mr-2 text-emerald-600" />
                    {config.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </>
        )}

        {groups.notionNodes.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              <div className="flex items-center gap-1">
                <FileText className="h-3 w-3" />
                Notion
              </div>
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              {groups.notionNodes.map((type) => {
                const config = NODE_TYPE_CONFIGS[type];
                const Icon = NODE_ICONS[type] || FileText;
                return (
                  <DropdownMenuItem
                    key={type}
                    onClick={() => handleAddNode(type)}
                  >
                    <Icon className="h-4 w-4 mr-2 text-neutral-600" />
                    {config.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </>
        )}

        {groups.emailToolNodes.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              <div className="flex items-center gap-1">
                <Sparkles className="h-3 w-3" />
                Email Tools
              </div>
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              {groups.emailToolNodes.map((type) => {
                const config = NODE_TYPE_CONFIGS[type];
                const Icon = NODE_ICONS[type] || Sparkles;
                return (
                  <DropdownMenuItem
                    key={type}
                    onClick={() => handleAddNode(type)}
                  >
                    <Icon className={`h-4 w-4 mr-2 ${getEmailToolColorClass(type)}`} />
                    {config.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </>
        )}

        {groups.controlNodes.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Control</DropdownMenuLabel>
            <DropdownMenuGroup>
              {groups.controlNodes.map((type) => {
                const config = NODE_TYPE_CONFIGS[type];
                const Icon = NODE_ICONS[type] || Clock;
                return (
                  <DropdownMenuItem
                    key={type}
                    onClick={() => handleAddNode(type)}
                  >
                    <Icon className="h-4 w-4 mr-2" />
                    {config.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </>
        )}

        {groups.terminalNodes.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {groups.terminalNodes.map((type) => {
                const config = NODE_TYPE_CONFIGS[type];
                const Icon = NODE_ICONS[type] || Flag;
                return (
                  <DropdownMenuItem
                    key={type}
                    onClick={() => handleAddNode(type)}
                  >
                    <Icon className="h-4 w-4 mr-2" />
                    {config.label}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
