import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { format } from "date-fns";
import { Clock, CheckCircle, XCircle, TrendingUp, Timer } from "lucide-react";
import type { GenerationMetricRecord, GenerationStatsSummary } from "@shared/schema";

export default function AnalyticsPage() {
  const { data: recentMetrics, isLoading: metricsLoading } = useQuery<GenerationMetricRecord[]>({
    queryKey: ["/api/metrics/generation/recent"],
  });

  const { data: summary, isLoading: summaryLoading } = useQuery<GenerationStatsSummary>({
    queryKey: ["/api/metrics/generation/summary"],
  });

  const chartData = summary?.byDurationBucket.map(bucket => ({
    name: bucket.bucket,
    actual: Math.round(bucket.avgActualSeconds),
    estimated: Math.round(bucket.avgEstimatedSeconds),
    count: bucket.count,
  })) || [];

  return (
    <div className="container mx-auto py-6 space-y-6" data-testid="analytics-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-analytics-title">Generation Analytics</h1>
          <p className="text-muted-foreground">Monitor podcast generation performance and timing accuracy</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card data-testid="card-total-generations">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Generations</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-total-count">{summary?.totalGenerations || 0}</div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-success-rate">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-success-rate">
                {(summary?.successRate || 0).toFixed(1)}%
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-avg-actual">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Actual Time</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-avg-actual">
                {Math.round(summary?.averageActualSeconds || 0)}s
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-accuracy">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Estimate Accuracy</CardTitle>
            <Timer className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {summaryLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold" data-testid="text-accuracy">
                {(summary?.averageAccuracyPercent || 0).toFixed(1)}%
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-duration-chart">
        <CardHeader>
          <CardTitle>Actual vs Estimated Time by Duration</CardTitle>
          <CardDescription>Compare actual generation times against estimates per duration bucket</CardDescription>
        </CardHeader>
        <CardContent>
          {summaryLoading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} data-testid="chart-duration-comparison">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis label={{ value: 'Seconds', angle: -90, position: 'insideLeft' }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="actual" fill="hsl(var(--primary))" name="Actual (s)" />
                <Bar dataKey="estimated" fill="hsl(var(--muted-foreground))" name="Estimated (s)" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-muted-foreground">
              No generation data yet. Create some podcasts to see analytics.
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-recent-generations">
        <CardHeader>
          <CardTitle>Recent Generations</CardTitle>
          <CardDescription>Last 50 podcast generation attempts with timing details</CardDescription>
        </CardHeader>
        <CardContent>
          {metricsLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : recentMetrics && recentMetrics.length > 0 ? (
            <Table data-testid="table-recent-metrics">
              <TableHeader>
                <TableRow>
                  <TableHead>Template</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Actual</TableHead>
                  <TableHead>Estimated</TableHead>
                  <TableHead>Accuracy</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentMetrics.map((metric) => {
                  const accuracy = metric.estimatedTimeSeconds > 0 
                    ? (metric.actualTimeSeconds / metric.estimatedTimeSeconds * 100).toFixed(0)
                    : "N/A";
                  return (
                    <TableRow key={metric.id} data-testid={`row-metric-${metric.id}`}>
                      <TableCell>
                        <Badge variant="outline">{metric.templateCategory}</Badge>
                      </TableCell>
                      <TableCell>{metric.durationMinutes}min</TableCell>
                      <TableCell className="font-mono">{metric.actualTimeSeconds}s</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{metric.estimatedTimeSeconds}s</TableCell>
                      <TableCell>
                        <Badge variant={parseInt(accuracy) > 120 ? "destructive" : parseInt(accuracy) < 80 ? "secondary" : "default"}>
                          {accuracy}%
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {metric.success ? (
                          <CheckCircle className="h-4 w-4 text-green-500" data-testid="icon-success" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500" data-testid="icon-failure" />
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {format(new Date(metric.completedAt), "MMM d, HH:mm")}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              No generation metrics recorded yet. Generate a podcast to see timing data.
            </div>
          )}
        </CardContent>
      </Card>

      {summary && summary.byTemplate.length > 0 && (
        <Card data-testid="card-template-stats">
          <CardHeader>
            <CardTitle>Performance by Template</CardTitle>
            <CardDescription>Generation statistics grouped by podcast template type</CardDescription>
          </CardHeader>
          <CardContent>
            <Table data-testid="table-template-stats">
              <TableHeader>
                <TableRow>
                  <TableHead>Template</TableHead>
                  <TableHead>Count</TableHead>
                  <TableHead>Avg Time</TableHead>
                  <TableHead>Success Rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.byTemplate.map((template) => (
                  <TableRow key={template.template} data-testid={`row-template-${template.template}`}>
                    <TableCell>
                      <Badge variant="outline">{template.template}</Badge>
                    </TableCell>
                    <TableCell>{template.count}</TableCell>
                    <TableCell className="font-mono">{Math.round(template.avgActualSeconds)}s</TableCell>
                    <TableCell>
                      <Badge variant={template.successRate >= 90 ? "default" : template.successRate >= 70 ? "secondary" : "destructive"}>
                        {template.successRate.toFixed(1)}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
