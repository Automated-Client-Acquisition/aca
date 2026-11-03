import { useState, useMemo, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ChevronDown, DollarSign, Globe, Search, Settings2, X, Building2, Users, Filter, MapPin } from 'lucide-react';
import type { ApifyLeadsSearchConfig } from '@/hooks/useApifyLeadsImport';

interface Props {
  onSubmit: (config: ApifyLeadsSearchConfig, totalRequested: number, batchSize: number) => void;
  isLoading?: boolean;
}

// ---- Exact enum values from the Apify actor ----

const JOB_TITLE_SUGGESTIONS = [
  'CEO', 'Founder', 'Co-founder', 'Owner', 'CTO', 'COO', 'CFO', 'CMO',
  'VP Sales', 'VP Marketing', 'VP Engineering', 'Head of Marketing',
  'Head of Sales', 'Head of Growth', 'Director of Marketing',
];

const SENIORITY_OPTIONS = [
  { value: 'founder', label: 'Founder' },
  { value: 'owner', label: 'Owner' },
  { value: 'c_suite', label: 'C-Suite' },
  { value: 'director', label: 'Director' },
  { value: 'partner', label: 'Partner' },
  { value: 'vp', label: 'VP' },
  { value: 'head', label: 'Head' },
  { value: 'manager', label: 'Manager' },
  { value: 'senior', label: 'Senior' },
  { value: 'entry', label: 'Entry' },
  { value: 'trainee', label: 'Trainee' },
];

const FUNCTIONAL_OPTIONS = [
  { value: 'c_suite', label: 'C-Suite' },
  { value: 'sales', label: 'Sales' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'engineering', label: 'Engineering' },
  { value: 'product_management', label: 'Product' },
  { value: 'finance', label: 'Finance' },
  { value: 'operations', label: 'Operations' },
  { value: 'human_resources', label: 'HR' },
  { value: 'information_technology', label: 'IT' },
  { value: 'design', label: 'Design' },
  { value: 'legal', label: 'Legal' },
  { value: 'education', label: 'Education' },
  { value: 'support', label: 'Support' },
];

const COMPANY_SIZE_OPTIONS = [
  '1-10', '11-20', '21-50', '51-100', '101-200', '201-500',
  '501-1000', '1001-2000', '2001-5000', '5001-10000', '10001-20000',
  '20001-50000', '50000+',
];

const EMAIL_STATUS_OPTIONS = [
  { value: 'validated', label: 'Validated', description: 'Verified deliverable emails' },
  { value: 'not_validated', label: 'Not Validated', description: 'Unverified - may bounce' },
  { value: 'unknown', label: 'Unknown', description: 'Unable to verify' },
];

const REVENUE_OPTIONS = [
  { value: '', label: 'Any' },
  { value: '100K', label: '$100K' },
  { value: '500K', label: '$500K' },
  { value: '1M', label: '$1M' },
  { value: '5M', label: '$5M' },
  { value: '10M', label: '$10M' },
  { value: '25M', label: '$25M' },
  { value: '50M', label: '$50M' },
  { value: '100M', label: '$100M' },
  { value: '500M', label: '$500M' },
  { value: '1B', label: '$1B' },
  { value: '5B', label: '$5B' },
  { value: '10B', label: '$10B' },
];

const FUNDING_OPTIONS = [
  { value: 'seed', label: 'Seed' },
  { value: 'angel', label: 'Angel' },
  { value: 'series_a', label: 'Series A' },
  { value: 'series_b', label: 'Series B' },
  { value: 'series_c', label: 'Series C' },
  { value: 'series_d', label: 'Series D' },
  { value: 'series_e', label: 'Series E' },
  { value: 'series_f', label: 'Series F' },
  { value: 'venture_round', label: 'Venture' },
  { value: 'debt_financing', label: 'Debt' },
  { value: 'convertible_note', label: 'Convertible Note' },
  { value: 'private_equity_round', label: 'Private Equity' },
  { value: 'other_round', label: 'Other' },
];

// Top locations (countries + major US states + regions)
const LOCATION_OPTIONS: string[] = [
  // Top countries
  'united states', 'united kingdom', 'canada', 'australia', 'germany', 'france',
  'india', 'netherlands', 'ireland', 'israel', 'singapore', 'sweden',
  'switzerland', 'spain', 'italy', 'brazil', 'japan', 'south korea',
  'united arab emirates', 'new zealand', 'denmark', 'norway', 'finland',
  'belgium', 'austria', 'portugal', 'poland', 'czech republic', 'mexico',
  'south africa', 'colombia', 'argentina', 'chile', 'philippines',
  'indonesia', 'thailand', 'vietnam', 'nigeria', 'kenya', 'hong kong',
  'taiwan', 'turkey', 'saudi arabia', 'qatar', 'romania', 'hungary',
  'ukraine', 'malaysia', 'egypt',
  // US states
  'california, us', 'texas, us', 'new york, us', 'florida, us',
  'illinois, us', 'pennsylvania, us', 'virginia, us', 'ohio, us',
  'massachusetts, us', 'georgia, us', 'michigan, us', 'north carolina, us',
  'maryland, us', 'new jersey, us', 'washington, us', 'colorado, us',
  'minnesota, us', 'arizona, us', 'oregon, us', 'tennessee, us',
  'connecticut, us', 'utah, us', 'indiana, us', 'missouri, us',
  // UK regions
  'england, united kingdom', 'scotland, united kingdom',
];

// Full industry list - exact Apify actor enum values
const INDUSTRY_OPTIONS: string[] = [
  'information technology & services', 'computer software', 'internet',
  'marketing & advertising', 'management consulting', 'financial services',
  'health, wellness & fitness', 'hospital & health care', 'medical devices',
  'real estate', 'commercial real estate', 'construction', 'architecture & planning',
  'retail', 'consumer goods', 'consumer services', 'consumer electronics',
  'e-learning', 'education management', 'higher education', 'primary/secondary education',
  'accounting', 'banking', 'investment management', 'investment banking', 'capital markets',
  'venture capital & private equity',
  'automotive', 'aviation & aerospace', 'defense & space',
  'biotechnology', 'pharmaceuticals', 'chemicals', 'nanotechnology',
  'design', 'graphic design', 'fine art', 'arts & crafts', 'photography',
  'entertainment', 'music', 'motion pictures & film', 'broadcast media', 'online media',
  'performing arts', 'animation', 'computer games',
  'events services', 'hospitality', 'restaurants', 'food & beverages', 'food production',
  'leisure, travel & tourism', 'airlines/aviation', 'sporting goods', 'sports',
  'recreational facilities & services', 'gambling & casinos',
  'human resources', 'staffing & recruiting', 'professional training & coaching',
  'insurance', 'legal services', 'law practice',
  'logistics & supply chain', 'transportation/trucking/railroad', 'warehousing',
  'maritime', 'package/freight delivery', 'railroad manufacture', 'shipbuilding',
  'machinery', 'mechanical or industrial engineering', 'industrial automation',
  'electrical/electronic manufacturing', 'semiconductors', 'computer hardware',
  'computer networking', 'computer & network security', 'telecommunications', 'wireless',
  'media production', 'publishing', 'printing', 'newspapers', 'writing & editing',
  'translation & localization', 'libraries',
  'mining & metals', 'oil & energy', 'renewables & environment', 'utilities',
  'environmental services', 'civil engineering', 'building materials',
  'glass, ceramics & concrete', 'paper & forest products', 'plastics',
  'nonprofit organization management', 'philanthropy', 'civic & social organization',
  'religious institutions', 'fund-raising', 'think tanks',
  'government administration', 'government relations', 'public policy',
  'public safety', 'law enforcement', 'military', 'political organization',
  'legislative office', 'executive office', 'judiciary',
  'international trade & development', 'international affairs',
  'outsourcing/offshoring', 'market research', 'program development',
  'public relations & communications', 'information services',
  'business supplies & equipment', 'facilities services',
  'furniture', 'textiles', 'apparel & fashion', 'luxury goods & jewelry',
  'cosmetics', 'wine & spirits', 'tobacco', 'dairy', 'supermarkets',
  'agriculture', 'farming', 'ranching', 'fishery',
  'research', 'medical practice', 'mental health care', 'veterinary',
  'alternative medicine', 'individual & family services',
  'museums & institutions', 'security & investigations',
  'alternative dispute resolution',
  'import & export', 'wholesale', 'packaging & containers',
];

// ---- Searchable Combobox for large lists ----

function SearchableMultiSelect({
  options,
  selected,
  onChange,
  placeholder,
  displayTransform,
}: {
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  displayTransform?: (val: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const display = displayTransform || ((v: string) =>
    v.split(/[\s,]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  );

  const filtered = useMemo(() => {
    if (!search) return options.slice(0, 50);
    const q = search.toLowerCase();
    return options.filter(o => o.includes(q)).slice(0, 50);
  }, [search, options]);

  const toggle = (val: string) => {
    if (selected.includes(val)) {
      onChange(selected.filter(v => v !== val));
    } else {
      onChange([...selected, val]);
    }
  };

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((val) => (
            <Badge key={val} variant="secondary" className="gap-1 pl-2 pr-1">
              {display(val)}
              <button
                type="button"
                onClick={() => toggle(val)}
                className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start text-muted-foreground font-normal h-9"
          >
            <Search className="mr-2 h-3.5 w-3.5 shrink-0" />
            {placeholder || 'Search...'}
            {selected.length > 0 && (
              <Badge variant="secondary" className="ml-auto">{selected.length}</Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={placeholder || 'Search...'}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList className="max-h-[250px]">
              <CommandEmpty>No results found.</CommandEmpty>
              <CommandGroup>
                {filtered.map((option) => (
                  <CommandItem
                    key={option}
                    value={option}
                    onSelect={() => toggle(option)}
                    className="cursor-pointer"
                  >
                    <Checkbox
                      checked={selected.includes(option)}
                      className="mr-2"
                    />
                    <span className="text-sm">{display(option)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ---- Tag input (for free-text fields) ----

function TagInput({
  value,
  onChange,
  placeholder,
  suggestions,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
}) {
  const [inputValue, setInputValue] = useState('');

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setInputValue('');
  };

  const removeTag = (tag: string) => {
    onChange(value.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(inputValue);
    }
    if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  };

  const unusedSuggestions = suggestions?.filter((s) => !value.includes(s)) || [];

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 pl-2 pr-1">
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (inputValue.trim()) addTag(inputValue);
        }}
        placeholder={placeholder}
      />
      {unusedSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {unusedSuggestions.slice(0, 8).map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => addTag(suggestion)}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded-md border border-dashed border-muted-foreground/30 hover:border-muted-foreground/60 transition-colors"
            >
              + {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Checkbox grid ----

function CheckboxGrid({
  options,
  selected,
  onChange,
  columns = 4,
}: {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
  columns?: number;
}) {
  const toggle = (value: string) => {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value]
    );
  };

  return (
    <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map((option) => (
        <label key={option.value} className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={selected.includes(option.value)}
            onCheckedChange={() => toggle(option.value)}
          />
          <span className="text-sm">{option.label}</span>
        </label>
      ))}
    </div>
  );
}

// ---- Main Form ----

export function ApifyLeadsFinderForm({ onSubmit, isLoading }: Props) {
  // People filters
  const [jobTitles, setJobTitles] = useState<string[]>([]);
  const [seniorityLevels, setSeniorityLevels] = useState<string[]>([]);
  const [functionalLevels, setFunctionalLevels] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [emailStatuses, setEmailStatuses] = useState<string[]>(['validated']);

  // Company filters
  const [industries, setIndustries] = useState<string[]>([]);
  const [companyKeywords, setCompanyKeywords] = useState<string[]>([]);
  const [companyDomains, setCompanyDomains] = useState<string[]>([]);
  const [companySizes, setCompanySizes] = useState<string[]>([]);
  const [minRevenue, setMinRevenue] = useState('');
  const [maxRevenue, setMaxRevenue] = useState('');
  const [fundingStages, setFundingStages] = useState<string[]>([]);

  // Exclude filters
  const [notIndustry, setNotIndustry] = useState<string[]>([]);
  const [notKeywords, setNotKeywords] = useState<string[]>([]);
  const [notJobTitle, setNotJobTitle] = useState<string[]>([]);
  const [notLocations, setNotLocations] = useState<string[]>([]);

  // Volume
  const [totalRequested, setTotalRequested] = useState(1000);
  const [batchSize, setBatchSize] = useState(2500);

  // UI state
  const [excludeOpen, setExcludeOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [companyOpen, setCompanyOpen] = useState(true);
  const [domainBulkMode, setDomainBulkMode] = useState(false);
  const [domainBulkText, setDomainBulkText] = useState('');

  const estimatedCost = (totalRequested / 1000 * 1.5).toFixed(2);

  const parseBulkDomains = () => {
    const domains = domainBulkText
      .split(/[\n,;]+/)
      .map(d => d.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, ''))
      .filter(d => d.length > 0 && d.includes('.'));
    const unique = [...new Set([...companyDomains, ...domains])];
    setCompanyDomains(unique);
    setDomainBulkText('');
    setDomainBulkMode(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const config: ApifyLeadsSearchConfig = {};
    if (jobTitles.length) config.contact_job_title = jobTitles;
    if (locations.length) config.contact_location = locations;
    if (seniorityLevels.length) config.seniority_level = seniorityLevels;
    if (functionalLevels.length) config.functional_level = functionalLevels;
    if (emailStatuses.length) config.email_status = emailStatuses;
    if (industries.length) config.company_industry = industries;
    if (companyKeywords.length) config.company_keywords = companyKeywords;
    if (companyDomains.length) config.company_domain = companyDomains;
    if (companySizes.length) config.size = companySizes;
    if (minRevenue) config.min_revenue = minRevenue;
    if (maxRevenue) config.max_revenue = maxRevenue;
    if (fundingStages.length) config.funding = fundingStages;
    if (notIndustry.length) config.company_not_industry = notIndustry;
    if (notKeywords.length) config.company_not_keywords = notKeywords;
    if (notJobTitle.length) config.contact_not_job_title = notJobTitle;
    if (notLocations.length) config.contact_not_location = notLocations;

    onSubmit(config, totalRequested, batchSize);
  };

  const hasFilters = jobTitles.length > 0 || locations.length > 0 || industries.length > 0
    || companyDomains.length > 0 || companyKeywords.length > 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* People Targeting */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" />
            People Targeting
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Job Title */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Job Title</Label>
            <TagInput
              value={jobTitles}
              onChange={setJobTitles}
              placeholder="Type a job title and press Enter..."
              suggestions={JOB_TITLE_SUGGESTIONS}
            />
          </div>

          {/* Seniority */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Seniority Level</Label>
            <CheckboxGrid
              options={SENIORITY_OPTIONS}
              selected={seniorityLevels}
              onChange={setSeniorityLevels}
              columns={4}
            />
          </div>

          {/* Functional Level */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Department / Function</Label>
            <CheckboxGrid
              options={FUNCTIONAL_OPTIONS}
              selected={functionalLevels}
              onChange={setFunctionalLevels}
              columns={4}
            />
          </div>

          {/* Location */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              Location
            </Label>
            <SearchableMultiSelect
              options={LOCATION_OPTIONS}
              selected={locations}
              onChange={setLocations}
              placeholder="Search countries, states, regions..."
            />
          </div>

          {/* Email Status */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Email Status</Label>
            <CheckboxGrid
              options={EMAIL_STATUS_OPTIONS}
              selected={emailStatuses}
              onChange={setEmailStatuses}
              columns={3}
            />
            <p className="text-xs text-muted-foreground">
              "Validated" = verified deliverable. Add "Unknown" to increase volume.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Company Targeting */}
      <Card>
        <Collapsible open={companyOpen} onOpenChange={setCompanyOpen}>
          <CardHeader className="pb-3">
            <CollapsibleTrigger className="flex items-center gap-2 w-full">
              <CardTitle className="flex items-center gap-2 text-base flex-1 text-left">
                <Building2 className="h-4 w-4" />
                Company Targeting
              </CardTitle>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${companyOpen ? '' : '-rotate-90'}`} />
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-4 pt-0">
              {/* Industry */}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Industry</Label>
                <SearchableMultiSelect
                  options={INDUSTRY_OPTIONS}
                  selected={industries}
                  onChange={setIndustries}
                  placeholder="Search industries..."
                  displayTransform={(v) =>
                    v.split(' ').map(w =>
                      ['&', 'and', 'or', 'of', 'the'].includes(w)
                        ? w
                        : w.charAt(0).toUpperCase() + w.slice(1)
                    ).join(' ')
                  }
                />
              </div>

              {/* Company Keywords */}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Company Keywords</Label>
                <TagInput
                  value={companyKeywords}
                  onChange={setCompanyKeywords}
                  placeholder="SaaS, AI, fintech, healthcare..."
                />
              </div>

              {/* Company Domains */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5" />
                    Company Domains
                  </Label>
                  <button
                    type="button"
                    onClick={() => setDomainBulkMode(!domainBulkMode)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {domainBulkMode ? 'Single mode' : 'Bulk paste'}
                  </button>
                </div>
                {domainBulkMode ? (
                  <div className="space-y-2">
                    <Textarea
                      value={domainBulkText}
                      onChange={(e) => setDomainBulkText(e.target.value)}
                      placeholder="Paste domains (one per line, or comma/semicolon separated):&#10;google.com&#10;stripe.com&#10;notion.so"
                      rows={4}
                      className="text-sm font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={parseBulkDomains}
                      disabled={!domainBulkText.trim()}
                    >
                      Add {domainBulkText.split(/[\n,;]+/).filter(d => d.trim()).length} domains
                    </Button>
                  </div>
                ) : (
                  <TagInput
                    value={companyDomains}
                    onChange={setCompanyDomains}
                    placeholder="google.com, stripe.com..."
                  />
                )}
                {companyDomains.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {companyDomains.length} domain{companyDomains.length !== 1 ? 's' : ''} - will only find leads at these companies
                  </p>
                )}
              </div>

              {/* Company Size */}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Company Size (employees)</Label>
                <div className="flex flex-wrap gap-1.5">
                  {COMPANY_SIZE_OPTIONS.map((size) => {
                    const isSelected = companySizes.includes(size);
                    return (
                      <button
                        key={size}
                        type="button"
                        onClick={() =>
                          setCompanySizes(prev =>
                            isSelected ? prev.filter(s => s !== size) : [...prev, size]
                          )
                        }
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                          isSelected
                            ? 'bg-primary/10 border-primary text-primary'
                            : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
                        }`}
                      >
                        {size}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Revenue Range */}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Annual Revenue</Label>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Select value={minRevenue} onValueChange={setMinRevenue}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Min revenue" />
                      </SelectTrigger>
                      <SelectContent>
                        {REVENUE_OPTIONS.map((opt) => (
                          <SelectItem key={`min-${opt.value}`} value={opt.value || '_none'}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Select value={maxRevenue} onValueChange={setMaxRevenue}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Max revenue" />
                      </SelectTrigger>
                      <SelectContent>
                        {REVENUE_OPTIONS.map((opt) => (
                          <SelectItem key={`max-${opt.value}`} value={opt.value || '_none'}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Funding Stage */}
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Funding Stage</Label>
                <div className="flex flex-wrap gap-1.5">
                  {FUNDING_OPTIONS.map((opt) => {
                    const isSelected = fundingStages.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() =>
                          setFundingStages(prev =>
                            isSelected ? prev.filter(s => s !== opt.value) : [...prev, opt.value]
                          )
                        }
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                          isSelected
                            ? 'bg-primary/10 border-primary text-primary'
                            : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Exclude Filters */}
      <Card>
        <Collapsible open={excludeOpen} onOpenChange={setExcludeOpen}>
          <CardHeader className="pb-3">
            <CollapsibleTrigger className="flex items-center gap-2 w-full">
              <CardTitle className="flex items-center gap-2 text-base flex-1 text-left">
                <Filter className="h-4 w-4" />
                Exclude Filters
                {(notJobTitle.length + notIndustry.length + notKeywords.length + notLocations.length) > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {notJobTitle.length + notIndustry.length + notKeywords.length + notLocations.length}
                  </Badge>
                )}
              </CardTitle>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${excludeOpen ? '' : '-rotate-90'}`} />
            </CollapsibleTrigger>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-4 pt-0">
              <div className="space-y-1.5">
                <Label className="text-sm">Exclude Job Titles</Label>
                <TagInput
                  value={notJobTitle}
                  onChange={setNotJobTitle}
                  placeholder="Titles to exclude..."
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Exclude Locations</Label>
                <SearchableMultiSelect
                  options={LOCATION_OPTIONS}
                  selected={notLocations}
                  onChange={setNotLocations}
                  placeholder="Search locations to exclude..."
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Exclude Industries</Label>
                <SearchableMultiSelect
                  options={INDUSTRY_OPTIONS}
                  selected={notIndustry}
                  onChange={setNotIndustry}
                  placeholder="Search industries to exclude..."
                  displayTransform={(v) =>
                    v.split(' ').map(w =>
                      ['&', 'and', 'or', 'of', 'the'].includes(w)
                        ? w
                        : w.charAt(0).toUpperCase() + w.slice(1)
                    ).join(' ')
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Exclude Keywords</Label>
                <TagInput
                  value={notKeywords}
                  onChange={setNotKeywords}
                  placeholder="Keywords to exclude..."
                />
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Volume & Submit */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Volume & Cost</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-sm">Total Leads</Label>
              <Input
                type="number"
                value={totalRequested}
                onChange={(e) => setTotalRequested(Math.min(100000, Math.max(1, Number(e.target.value))))}
                min={1}
                max={100000}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Estimated Cost</Label>
              <div className="flex items-center gap-1.5 h-9 px-3 rounded-md border bg-muted/50 text-sm font-medium">
                <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                ${estimatedCost}
                <span className="text-xs text-muted-foreground ml-1">($1.50/1k leads)</span>
              </div>
            </div>
          </div>

          {/* Advanced */}
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
              <Settings2 className="h-3.5 w-3.5" />
              Advanced
              <ChevronDown className={`h-3 w-3 transition-transform ${advancedOpen ? '' : '-rotate-90'}`} />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Batch Size</Label>
                <Input
                  type="number"
                  value={batchSize}
                  onChange={(e) => setBatchSize(Math.max(100, Number(e.target.value)))}
                  min={100}
                  className="h-8 text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  {Math.ceil(totalRequested / batchSize)} batch{Math.ceil(totalRequested / batchSize) !== 1 ? 'es' : ''} of {batchSize} leads each.
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      <Button
        type="submit"
        variant="cta"
        className="w-full h-11 text-base"
        disabled={isLoading || !hasFilters}
      >
        {isLoading ? 'Starting Import...' : `Start Import - Est. $${estimatedCost}`}
      </Button>
      {!hasFilters && (
        <p className="text-xs text-muted-foreground text-center">
          Add at least one filter (job title, location, industry, keyword, or domain) to start.
        </p>
      )}
    </form>
  );
}
