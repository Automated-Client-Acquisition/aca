import { FileSpreadsheet, Search, UserPlus } from "lucide-react";
import { FaLinkedin } from "react-icons/fa";

export interface ImportSource {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  available: boolean;
  requiresLinkedIn?: boolean;
  requiresPremium?: boolean;
  freeAccount?: boolean;
  hasTabs?: boolean;
}

export const IMPORT_SOURCES: ImportSource[] = [
  {
    id: "linkedin_search",
    title: "LinkedIn Search Bar",
    description: "Search and filter by position, company, industry, location and more",
    icon: FaLinkedin,
    available: true,
    requiresLinkedIn: true,
    freeAccount: true,
    hasTabs: true,
  },
  {
    id: "sales_nav_leads",
    title: "Sales Navigator (Leads)",
    description: "Advanced lead search with buyer intent filters",
    icon: FaLinkedin,
    available: true,
    requiresLinkedIn: true,
    requiresPremium: true,
  },
  {
    id: "linkedin_recruiter",
    title: "LinkedIn Recruiter",
    description: "Import candidates from Recruiter searches",
    icon: FaLinkedin,
    available: true,
    requiresLinkedIn: true,
    requiresPremium: true,
  },
  {
    id: "post_reactors",
    title: "LinkedIn Post (Reactors)",
    description: "Import people who reacted to or commented on posts",
    icon: FaLinkedin,
    available: true,
    requiresLinkedIn: true,
    freeAccount: true,
  },
  {
    id: "apify_leads_finder",
    title: "B2B Lead Finder",
    description: "Search by job title, industry, company size - get verified emails",
    icon: Search,
    available: true,
    requiresLinkedIn: false,
  },
  {
    id: "csv",
    title: "Import from CSV",
    description: "Upload a CSV with LinkedIn profile URLs and custom variables",
    icon: FileSpreadsheet,
    available: true,
    requiresLinkedIn: false,
  },
  {
    id: "manual",
    title: "Add Manually",
    description: "Create a single lead by entering their details",
    icon: UserPlus,
    available: true,
    requiresLinkedIn: false,
  },
];

export type ImportSourceId = (typeof IMPORT_SOURCES)[number]["id"];
