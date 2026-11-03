import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart3,
  FileText,
  Video,
  Image,
  Type,
  DollarSign,
  TrendingUp,
  Users,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useContentAnalytics, useAgencyAnalytics, useContentTrend } from "@/hooks/useContentAnalytics";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";

type TimeRange = "7d" | "30d" | "90d" | "all";

const COLORS = ["#8b5cf6", "#ec4899", "#06b6d4", "#f59e0b", "#10b981"];

const getContentTypeIcon = (type: string) => {
  switch (type) {
    case "video":
      return <Video className="w-4 h-4" />;
    case "image":
      return <Image className="w-4 h-4" />;
    case "text":
      return <Type className="w-4 h-4" />;
    default:
      return <FileText className="w-4 h-4" />;
  }
};

export default function Analytics() {
  const { currentOrganization, isAgency } = useAuth();
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");

  const { data: analytics, isLoading } = useContentAnalytics(timeRange);
  const { data: agencyAnalytics } = useAgencyAnalytics(timeRange);
  const { data: trendData } = useContentTrend(undefined, timeRange);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    }).format(value);
  };

  if (isLoading) {
    return (
      <div className="container max-w-6xl py-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="container max-w-6xl py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="w-6 h-6" />
            Analytics
          </h1>
          <p className="text-muted-foreground">
            Content performance for{" "}
            <span className="font-medium text-foreground">
              {currentOrganization?.name}
            </span>
          </p>
        </div>
        <Select
          value={timeRange}
          onValueChange={(value) => setTimeRange(value as TimeRange)}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Content</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics?.totals.totalContent || 0}
            </div>
            <p className="text-xs text-muted-foreground">pieces created</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Jobs</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics?.totals.totalJobs || 0}
            </div>
            <p className="text-xs text-muted-foreground">generation jobs</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(analytics?.totals.totalCost || 0)}
            </div>
            <p className="text-xs text-muted-foreground">generation costs</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Content Types</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics?.byType.length || 0}
            </div>
            <p className="text-xs text-muted-foreground">different types</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Content by Type */}
        <Card>
          <CardHeader>
            <CardTitle>Content by Type</CardTitle>
            <CardDescription>Distribution of content types</CardDescription>
          </CardHeader>
          <CardContent>
            {analytics?.byType && analytics.byType.length > 0 ? (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={analytics.byType}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) =>
                        `${name} (${(percent * 100).toFixed(0)}%)`
                      }
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="count"
                      nameKey="type"
                    >
                      {analytics.byType.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={COLORS[index % COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                No content data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Content by Pipeline */}
        <Card>
          <CardHeader>
            <CardTitle>Content by Pipeline</CardTitle>
            <CardDescription>Content generated per pipeline</CardDescription>
          </CardHeader>
          <CardContent>
            {analytics?.byPipeline && analytics.byPipeline.length > 0 ? (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.byPipeline}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="pipeline"
                      tick={{ fontSize: 12 }}
                      interval={0}
                      angle={-45}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                No pipeline data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Content Trend */}
      <Card>
        <CardHeader>
          <CardTitle>Content Over Time</CardTitle>
          <CardDescription>Daily content creation trend</CardDescription>
        </CardHeader>
        <CardContent>
          {trendData && trendData.length > 0 ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) =>
                      new Date(value).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })
                    }
                  />
                  <YAxis />
                  <Tooltip
                    labelFormatter={(value) =>
                      new Date(value).toLocaleDateString("en-US", {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-muted-foreground">
              No trend data available
            </div>
          )}
        </CardContent>
      </Card>

      {/* Agency: Client Breakdown */}
      {isAgency && agencyAnalytics && agencyAnalytics.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Client Breakdown
            </CardTitle>
            <CardDescription>
              Content metrics per client
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {agencyAnalytics.map((client) => (
                <div
                  key={client.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <div className="font-medium">{client.name}</div>
                  </div>
                  <div className="flex items-center gap-6 text-sm">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      <span>{client.totalContent} pieces</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-muted-foreground" />
                      <span>{formatCurrency(client.totalCost)}</span>
                    </div>
                    <div className="flex gap-2">
                      {Object.entries(client.byType).map(([type, count]) => (
                        <div
                          key={type}
                          className="flex items-center gap-1 text-muted-foreground"
                        >
                          {getContentTypeIcon(type)}
                          <span>{count as number}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
