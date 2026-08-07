export default function DashboardLoading() {
  return (
    <div role="status" aria-label="Carregando dashboard" className="space-y-4">
      <div className="h-12 w-2/3 animate-pulse rounded-lg bg-card" />
      <div className="h-32 animate-pulse rounded-xl border border-border bg-card" />
      <div className="h-32 animate-pulse rounded-xl border border-border bg-card" />
    </div>
  );
}
