import { useDeferredValue, useState } from "react";
import { AlertCircle, Building2, KeyRound, Shield, UserCog } from "lucide-react";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { ControlPlaneCard, ControlPlanePageHeader, PaginationControls } from "@/components/superAdmin/ControlPlanePrimitives";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { AdminLibraryControlRow, AdminUserControlRow } from "@/lib/superAdmin/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useLibraries } from "@/hooks/superAdmin";
import { formatInr, formatNumber, formatOperationalTimestamp, toBadgeVariant } from "@/lib/superAdmin/presentation";

type LibraryActionDialogState =
  | {
      kind: "library";
      libraryId: string;
      name: string;
    }
  | {
      kind: "user";
      name: string;
      userId: string;
    }
  | null;

const resolveLibraryOperationalStatus = (library: Pick<
  AdminLibraryControlRow,
  "controlStatus" | "enabled" | "ownerEmail" | "paymentStatus" | "subscriptionStatus"
>) => {
  if (!library.enabled) {
    return "Disabled";
  }

  if (library.controlStatus === "banned") {
    return "Blocked";
  }

  if (library.controlStatus === "suspended") {
    return "Suspended";
  }

  const subscriptionStatus = String(library.subscriptionStatus ?? "").trim().toLowerCase();
  const paymentStatus = String(library.paymentStatus ?? "").trim().toLowerCase();

  if (["trial", "trialing"].includes(subscriptionStatus) || ["trial", "trialing"].includes(paymentStatus)) {
    return "Trial";
  }

  if (
    ["failed", "incomplete", "incomplete_expired", "past_due", "pending", "unpaid"].includes(subscriptionStatus) ||
    ["failed", "pending", "unpaid"].includes(paymentStatus)
  ) {
    return "Pending";
  }

  if (!library.ownerEmail) {
    return "Verification Required";
  }

  return "Active";
};

const renderLibraryLocation = (library: Pick<AdminLibraryControlRow, "city" | "state">) =>
  [library.city, library.state].filter(Boolean).join(", ") || "Location pending";

const renderLibraryOwner = (library: Pick<AdminLibraryControlRow, "ownerEmail" | "ownerName">) =>
  library.ownerName || library.ownerEmail || "Owner record pending";

const renderSeatUsage = (library: Pick<AdminLibraryControlRow, "activeStudents" | "totalSeats">) => {
  if (library.totalSeats > 0) {
    return {
      detail: `${Math.min(100, Math.round((library.activeStudents / library.totalSeats) * 100))}% utilization`,
      summary: `${formatNumber(library.activeStudents)} active of ${formatNumber(library.totalSeats)} seats`,
    };
  }

  return {
    detail: "Seat capacity has not been configured yet.",
    summary: `${formatNumber(library.activeStudents)} active students`,
  };
};

const renderUserStatusBadges = (user: Pick<
  AdminUserControlRow,
  "activeImpersonationId" | "clearSessionsAfter" | "controlStatus" | "passwordResetRequired"
>) => (
  <div className="flex flex-wrap gap-2">
    <Badge variant={toBadgeVariant(user.controlStatus)}>{user.controlStatus}</Badge>
    {user.clearSessionsAfter ? <Badge variant="secondary">Session reset</Badge> : null}
    {user.passwordResetRequired ? <Badge variant="secondary">Password reset</Badge> : null}
    {user.activeImpersonationId ? <Badge variant="outline">Impersonating</Badge> : null}
  </div>
);

const SuperAdminLibraries = () => {
  const { toast } = useToast();
  const { startImpersonation } = useAuth();
  const [activeTab, setActiveTab] = useState("libraries");
  const [libraryPage, setLibraryPage] = useState(1);
  const [userPage, setUserPage] = useState(1);
  const [librarySearch, setLibrarySearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [actionDialog, setActionDialog] = useState<LibraryActionDialogState>(null);
  const [actionType, setActionType] = useState("suspend");
  const [actionNote, setActionNote] = useState("");
  const [impersonationReason, setImpersonationReason] = useState("");
  const deferredLibrarySearch = useDeferredValue(librarySearch.trim());
  const deferredUserSearch = useDeferredValue(userSearch.trim());

  const {
    libraries,
    librariesPagination,
    librariesQuery,
    libraryAction,
    recentActivity,
    summary,
    userAction,
    users,
    usersPagination,
    usersQuery,
  } = useLibraries({
    enableUsers: activeTab === "users",
    query: {
      page: libraryPage,
      pageSize: 10,
      search: deferredLibrarySearch,
    },
    userQuery: {
      page: userPage,
      pageSize: 10,
      search: deferredUserSearch,
    },
  });

  const librariesErrorMessage = librariesQuery.error instanceof Error ? librariesQuery.error.message : null;
  const usersErrorMessage = usersQuery.error instanceof Error ? usersQuery.error.message : null;

  const handleLibraryAction = async () => {
    if (!actionDialog || actionDialog.kind !== "library") {
      return;
    }

    try {
      await libraryAction.mutateAsync({
        action: actionType as "ban" | "clear_control" | "disable" | "enable" | "suspend",
        libraryId: actionDialog.libraryId,
        note: actionNote || undefined,
      });
      toast({ title: "Library control updated" });
      setActionDialog(null);
      setActionNote("");
    } catch (error) {
      toast({
        description: error instanceof Error ? error.message : "Unable to update library controls.",
        title: "Action failed",
        variant: "destructive",
      });
    }
  };

  const handleUserAction = async () => {
    if (!actionDialog || actionDialog.kind !== "user") {
      return;
    }

    try {
      await userAction.mutateAsync({
        action: actionType as "ban" | "clear_control" | "clear_sessions" | "reset_password" | "suspend",
        note: actionNote || undefined,
        userId: actionDialog.userId,
      });
      toast({ title: "User control updated" });
      setActionDialog(null);
      setActionNote("");
    } catch (error) {
      toast({
        description: error instanceof Error ? error.message : "Unable to update user controls.",
        title: "Action failed",
        variant: "destructive",
      });
    }
  };

  const handleImpersonation = async (targetUserId: string, libraryId?: string | null) => {
    try {
      await startImpersonation({
        libraryId,
        reason: impersonationReason || null,
        targetUserId,
      });

      toast({ title: "Impersonation started" });
      setImpersonationReason("");
    } catch (error) {
      toast({
        description: error instanceof Error ? error.message : "Unable to start impersonation.",
        title: "Impersonation failed",
        variant: "destructive",
      });
    }
  };

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <ControlPlanePageHeader
          description="Operate the library fleet and its users through centralized RBAC, audit, and impersonation workflows."
          title="Libraries"
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ControlPlaneCard title="Enabled libraries">
            <div className="flex items-center gap-3">
              <Building2 className="h-5 w-5 text-primary" />
              <div>
                <p className="font-display text-2xl font-bold text-foreground">{formatNumber(summary.activeLibraryCount)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatNumber(summary.totalLibraryCount)} onboarded libraries are visible to the control plane.
                </p>
              </div>
            </div>
          </ControlPlaneCard>
          <ControlPlaneCard title="Controlled libraries">
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-primary" />
              <div>
                <p className="font-display text-2xl font-bold text-foreground">{formatNumber(summary.controlledLibraryCount)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatNumber(summary.disabledLibraryCount)} disabled, {formatNumber(summary.pendingLibraryCount)} pending, {formatNumber(summary.trialLibraryCount)} trial.
                </p>
              </div>
            </div>
          </ControlPlaneCard>
          <ControlPlaneCard title="Controlled users">
            <div className="flex items-center gap-3">
              <UserCog className="h-5 w-5 text-primary" />
              <div>
                <p className="font-display text-2xl font-bold text-foreground">{formatNumber(summary.controlledUserCount)}</p>
                <p className="text-xs text-muted-foreground">
                  {formatNumber(summary.forcedLogoutCount)} session resets, {formatNumber(summary.passwordResetCount)} password resets, {formatNumber(summary.activeImpersonationCount)} live impersonations.
                </p>
              </div>
            </div>
          </ControlPlaneCard>
        </div>

        {librariesErrorMessage ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Library telemetry is temporarily unavailable</AlertTitle>
            <AlertDescription>{librariesErrorMessage}</AlertDescription>
          </Alert>
        ) : null}

        <Tabs className="space-y-6" onValueChange={setActiveTab} value={activeTab}>
          <TabsList>
            <TabsTrigger value="libraries">Libraries</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="activity">Recent Activity</TabsTrigger>
          </TabsList>

          <TabsContent value="libraries">
            <ControlPlaneCard title="Library controls">
              <div className="space-y-4">
                <Input
                  onChange={(event) => {
                    setLibraryPage(1);
                    setLibrarySearch(event.target.value);
                  }}
                  placeholder="Search by library, city, owner, or state"
                  value={librarySearch}
                />

                {librariesQuery.isLoading ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Loading libraries...</p>
                ) : (
                  <>
                    <div className="overflow-x-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Library</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Seats</TableHead>
                            <TableHead>Revenue</TableHead>
                            <TableHead>Last Activity</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {libraries.length === 0 ? (
                            <TableRow>
                              <TableCell className="py-10 text-center text-sm text-muted-foreground" colSpan={6}>
                                {deferredLibrarySearch
                                  ? "No libraries match this search yet. Try library name, city, owner email, or state."
                                  : "No libraries have been onboarded yet. Libraries created through Libriofy onboarding will appear here automatically."}
                              </TableCell>
                            </TableRow>
                          ) : (
                            libraries.map((library) => {
                              const operationalStatus = resolveLibraryOperationalStatus(library);
                              const seats = renderSeatUsage(library);

                              return (
                                <TableRow key={library.id}>
                                  <TableCell>
                                    <div>
                                      <p className="font-medium text-foreground">{library.name}</p>
                                      <p className="text-xs text-muted-foreground">{renderLibraryLocation(library)}</p>
                                      <p className="text-xs text-muted-foreground">Owner: {renderLibraryOwner(library)}</p>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex flex-wrap gap-2">
                                      <Badge variant={toBadgeVariant(operationalStatus)}>{operationalStatus}</Badge>
                                      {library.paymentStatus ? (
                                        <Badge variant={toBadgeVariant(library.paymentStatus)}>{library.paymentStatus}</Badge>
                                      ) : null}
                                      {library.controlStatus !== "active" ? (
                                        <Badge variant={toBadgeVariant(library.controlStatus)}>{library.controlStatus}</Badge>
                                      ) : null}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <div>
                                      <p className="text-sm font-medium text-foreground">{seats.summary}</p>
                                      <p className="text-xs text-muted-foreground">{seats.detail}</p>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    {library.monthlyRevenue > 0 ? (
                                      <div>
                                        <p className="text-sm font-medium text-foreground">{formatInr(library.monthlyRevenue)}</p>
                                        <p className="text-xs text-muted-foreground">Current monthly recognized revenue.</p>
                                      </div>
                                    ) : (
                                      <div>
                                        <p className="text-sm font-medium text-muted-foreground">No billed revenue yet</p>
                                        <p className="text-xs text-muted-foreground">Subscription charges will appear here after the first paid cycle.</p>
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell>{formatOperationalTimestamp(library.lastActivityAt)}</TableCell>
                                  <TableCell className="text-right">
                                    <div className="flex flex-wrap justify-end gap-2">
                                      <Button
                                        onClick={() =>
                                          libraryAction.mutate({
                                            action: library.enabled ? "disable" : "enable",
                                            libraryId: library.id,
                                          })
                                        }
                                        size="sm"
                                        variant="outline"
                                      >
                                        {library.enabled ? "Disable" : "Activate"}
                                      </Button>
                                      <Button
                                        onClick={() => {
                                          setActionDialog({ kind: "library", libraryId: library.id, name: library.name });
                                          setActionType(library.controlStatus === "active" ? "suspend" : "clear_control");
                                          setActionNote(library.controlReason || "");
                                        }}
                                        size="sm"
                                        variant="outline"
                                      >
                                        {library.controlStatus === "active" ? "Moderate" : "Clear"}
                                      </Button>
                                      <Button
                                        disabled={!library.ownerId}
                                        onClick={() => handleImpersonation(library.ownerId, library.id)}
                                        size="sm"
                                      >
                                        <KeyRound className="mr-2 h-4 w-4" />
                                        Impersonate
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                            })
                          )}
                        </TableBody>
                      </Table>
                    </div>

                    <PaginationControls
                      onNext={() => setLibraryPage((current) => Math.min(librariesPagination?.pageCount ?? current, current + 1))}
                      onPrevious={() => setLibraryPage((current) => Math.max(1, current - 1))}
                      page={librariesPagination?.page ?? 1}
                      pageCount={librariesPagination?.pageCount ?? 1}
                    />
                  </>
                )}
              </div>
            </ControlPlaneCard>
          </TabsContent>

          <TabsContent value="users">
            <ControlPlaneCard title="User controls">
              <div className="space-y-4">
                <Input
                  onChange={(event) => {
                    setUserPage(1);
                    setUserSearch(event.target.value);
                  }}
                  placeholder="Search by name, email, phone, or library"
                  value={userSearch}
                />

                {usersErrorMessage ? (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>User control data is temporarily unavailable</AlertTitle>
                    <AlertDescription>{usersErrorMessage}</AlertDescription>
                  </Alert>
                ) : null}

                {usersQuery.isLoading ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Loading users...</p>
                ) : (
                  <>
                    <div className="overflow-x-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>User</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Library</TableHead>
                            <TableHead>Last Login</TableHead>
                            <TableHead>Failures</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {users.length === 0 ? (
                            <TableRow>
                              <TableCell className="py-10 text-center text-sm text-muted-foreground" colSpan={6}>
                                {deferredUserSearch
                                  ? "No operators or controlled accounts match this search yet."
                                  : "No recent operational user activity detected. Owners, administrators, and controlled accounts will appear here automatically."}
                              </TableCell>
                            </TableRow>
                          ) : (
                            users.map((user) => (
                              <TableRow key={user.userId}>
                                <TableCell>
                                  <div>
                                    <p className="font-medium text-foreground">{user.fullName || user.email || user.userId}</p>
                                    <p className="text-xs text-muted-foreground">{user.email || "Email pending"}</p>
                                    <p className="text-xs text-muted-foreground">{user.primaryRole || "Operational user"}</p>
                                  </div>
                                </TableCell>
                                <TableCell>{renderUserStatusBadges(user)}</TableCell>
                                <TableCell>{user.libraryName || "No direct library binding"}</TableCell>
                                <TableCell>{formatOperationalTimestamp(user.lastLoginAt)}</TableCell>
                                <TableCell>
                                  {user.loginFailures24h > 0 ? `${formatNumber(user.loginFailures24h)} recent failures` : "No recent failures"}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex flex-wrap justify-end gap-2">
                                    <Button
                                      onClick={() => {
                                        setActionDialog({
                                          kind: "user",
                                          name: user.fullName || user.email || user.userId,
                                          userId: user.userId,
                                        });
                                        setActionType(user.controlStatus === "active" ? "suspend" : "clear_control");
                                        setActionNote(user.controlReason || "");
                                      }}
                                      size="sm"
                                      variant="outline"
                                    >
                                      {user.controlStatus === "active" ? "Moderate" : "Clear"}
                                    </Button>
                                    <Button
                                      onClick={() =>
                                        userAction.mutate({
                                          action: "clear_sessions",
                                          userId: user.userId,
                                        })
                                      }
                                      size="sm"
                                      variant="outline"
                                    >
                                      Reset Session
                                    </Button>
                                    <Button onClick={() => handleImpersonation(user.userId, user.libraryId)} size="sm">
                                      Impersonate
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>

                    <PaginationControls
                      onNext={() => setUserPage((current) => Math.min(usersPagination?.pageCount ?? current, current + 1))}
                      onPrevious={() => setUserPage((current) => Math.max(1, current - 1))}
                      page={usersPagination?.page ?? 1}
                      pageCount={usersPagination?.pageCount ?? 1}
                    />
                  </>
                )}
              </div>
            </ControlPlaneCard>
          </TabsContent>

          <TabsContent value="activity">
            <ControlPlaneCard title="Recent platform activity">
              <div className="space-y-3">
                {recentActivity.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {summary.totalLibraryCount > 0
                      ? "Waiting for first attendance activity or control-plane event in this window."
                      : "No recent operational activity detected. Platform events will appear here once libraries begin onboarding."}
                  </p>
                ) : (
                  recentActivity.map((activity) => (
                    <div key={activity.id} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">{activity.activityType}</p>
                        <p className="text-xs text-muted-foreground">{formatOperationalTimestamp(activity.createdAt)}</p>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{activity.message}</p>
                    </div>
                  ))
                )}
              </div>
            </ControlPlaneCard>
          </TabsContent>
        </Tabs>

        <Dialog open={!!actionDialog} onOpenChange={(open) => !open && setActionDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display">
                {actionDialog?.kind === "library" ? "Update library control" : "Update user control"}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 pt-2">
              <div>
                <p className="text-sm text-muted-foreground">Target</p>
                <p className="text-sm font-medium text-foreground">{actionDialog?.name}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-action-type">Action</Label>
                <Input
                  id="admin-action-type"
                  onChange={(event) => setActionType(event.target.value)}
                  placeholder="suspend, clear_control, ban, reset_password, clear_sessions"
                  value={actionType}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-action-note">Reason / audit note</Label>
                <Textarea
                  id="admin-action-note"
                  onChange={(event) => setActionNote(event.target.value)}
                  rows={3}
                  value={actionNote}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-impersonation-reason">Impersonation note</Label>
                <Textarea
                  id="admin-impersonation-reason"
                  onChange={(event) => setImpersonationReason(event.target.value)}
                  rows={2}
                  value={impersonationReason}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button onClick={() => setActionDialog(null)} variant="outline">
                  Cancel
                </Button>
                <Button
                  disabled={libraryAction.isPending || userAction.isPending}
                  onClick={actionDialog?.kind === "library" ? handleLibraryAction : handleUserAction}
                >
                  Save control
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminLibraries;
