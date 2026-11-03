import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Info } from "lucide-react";

interface NestedDataSelectorProps {
  elementData: any;
  elementId: string;
  selectedPaths: Record<string, { included: boolean }>; // Simplified structure
  onPathChange: (path: string, included: boolean) => void; // Simplified callback
}

// Field label mapping for display names
const FIELD_LABELS: Record<string, string> = {
  'icp_age_range': 'Age Range',
  'icp_gender': 'Gender',
  'icp_income': 'Income Level',
  'icp_location': 'Location',
  'icp_job_titles': 'Job Titles',
  'icp_psychographics': 'Psychographics',
  'icp_pain_points': 'Pain Points',
  'icp_desires': 'Desires',
  'icp_buying_motivations': 'Buying Motivations',
  'marketing_primary_angle': 'Primary Angle',
  'marketing_hooks': 'Hooks',
  'marketing_urgency_factors': 'Urgency Factors',
  'marketing_alternative_angles': 'Alternative Angles',
  'marketing_emotional_triggers': 'Emotional Triggers',
  'affiliate_key_messages': 'Key Messages',
  'affiliate_content_ideas': 'Content Ideas',
  'affiliate_calls_to_action': 'Calls to Action',
  'affiliate_target_platforms': 'Target Platforms',
  'affiliate_recommended_approach': 'Recommended Approach',
  'images': 'Images',
  'features': 'Features',
  'tags': 'Tags',
};

function formatFieldLabel(key: string): string {
  return FIELD_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function NestedDataSelector({
  elementData,
  elementId,
  selectedPaths,
  onPathChange,
}: NestedDataSelectorProps) {
  // Extract all available fields from the element data
  const fields = Object.entries(elementData)
    .filter(([key, value]) => {
      // Skip metadata fields
      if (['id', 'created_at', 'updated_at', 'organization_id', 'name', 'title', 'description'].includes(key)) {
        return false;
      }
      // Only include fields with data
      if (value === null || value === undefined || value === '') return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    })
    .map(([key, value]) => {
      const isArray = Array.isArray(value);
      const values = isArray ? value : [value];
      
      return {
        path: key,
        label: formatFieldLabel(key),
        values: values.filter(v => v != null && v !== ''),
        isArray,
        isString: !isArray && typeof value === 'string',
      };
    })
    .filter(field => field.values.length > 0);

  // Group fields by prefix
  const groupedFields = {
    icp: fields.filter(f => f.path.startsWith('icp_')),
    marketing: fields.filter(f => f.path.startsWith('marketing_')),
    affiliate: fields.filter(f => f.path.startsWith('affiliate_')),
    product: fields.filter(f => !f.path.startsWith('icp_') && 
                                !f.path.startsWith('marketing_') && 
                                !f.path.startsWith('affiliate_'))
  };

  const groupTitles = {
    icp: 'Ideal Customer Profile',
    marketing: 'Marketing Angles',
    affiliate: 'Affiliate Strategy',
    product: 'Product Details',
  };

  const renderFieldGroup = (groupKey: keyof typeof groupedFields) => {
    const groupFields = groupedFields[groupKey];
    if (groupFields.length === 0) return null;

    return (
      <Card key={groupKey} className="border-muted">
        <CardContent className="p-4">
          <h4 className="text-sm font-semibold mb-3">{groupTitles[groupKey]}</h4>
          <div className="space-y-2">
            {groupFields.map(field => {
              const isIncluded = selectedPaths[field.path]?.included ?? true; // Default to included
              const itemCount = field.isArray ? field.values.length : 1;

              return (
                <div key={field.path} className="flex items-start justify-between gap-2 py-2">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    <Checkbox
                      checked={isIncluded}
                      onCheckedChange={(checked) => onPathChange(field.path, checked as boolean)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <Label className="text-sm cursor-pointer">
                        {field.label}
                      </Label>
                      {field.isArray && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {field.values.slice(0, 2).map((val, idx) => (
                            <div key={idx}>• {String(val).substring(0, 40)}{String(val).length > 40 ? '...' : ''}</div>
                          ))}
                          {field.values.length > 2 && (
                            <div className="text-muted-foreground/70">+ {field.values.length - 2} more</div>
                          )}
                        </div>
                      )}
                      {field.isString && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {String(field.values[0]).substring(0, 60)}{String(field.values[0]).length > 60 ? '...' : ''}
                        </div>
                      )}
                    </div>
                  </div>
                  {field.isArray && (
                    <Badge variant="secondary" className="text-xs flex-shrink-0">
                      {itemCount} items
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg">
        <Info className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
        <p className="text-xs text-muted-foreground">
          Select which fields to include. All selected fields will be combined together in content generation.
        </p>
      </div>
      
      {(['icp', 'marketing', 'affiliate', 'product'] as const).map(renderFieldGroup)}
    </div>
  );
}
