import { useState } from "react";
import { Building2, KeyRound, Shield, UserCog } from "lucide-react";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { ControlPlaneCard, ControlPlanePageHeader, PaginationControls } from "@/components/superAdmin/ControlPlanePrimitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useLibraries } from "@/hooks/superAdmin";
import { formatDateTime, formatInr, formatNumber, toBadgeVariant } from "@/lib/superAdmin/presentation";

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

const SuperAdminLibraries = () => {
  const { toast } = useToast();
  const { startImpersonation } = useAuth();
  const [libraryPage, setLibraryPage] = useState(1);
  const [userPage, setUserPage] = useState(1);
  const [librarySearch, setLibrarySearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [actionDialog, setActionDialog] = useState<LibraryActionDialogState>(null);
  const [actionType, setActionType] = useState("suspend");
  const [actionNote, setActionNote] = useState("");
  const [impersonationReason, setImpersonationReason] = useState("");

  const {
    libraries,
    librariesPagination,
    librariesQuery,
    libraryAction,
    recentActivity,
    userAction,
    users,
    usersPagination,
    usersQuery,
  } = useLibraries({
    query: {
      page: libraryPage,
      pageSize: 10,
      search: librarySearch,
    },
    userQuery: {
      page: userPage,
      pageSize: 10,
      search: userSearch,
    },
  });

  const activeLibraryCount = libraries.filter((library) => library.enabled).length;
  const controlledLibraryCount = libraries.filter((library) => library.controlStatus !== "active").length;
  const controlledUserCount = users.filter((user) => user.controlStatus !== "active").length;

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
                <p className="text-2xl font-bold font-display text-foreground">{formatNumber(activeLibraryCount)}</p>
                <p className="text-xs text-muted-foreground">of {formatNumber(librariesPagination?.totalCount ?? 0)} currently visible</p>
              </div>
            </div>
          </ControlPlaneCard>
          <ControlPlaneCard title="Controlled libraries">
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-primary" />
              <div>
                <p className="text-2xl font-bold font-display text-foreground">{formatNumber(controlledLibraryCount)}</p>
                <p className="text-xs text-muted-foreground">Suspended or banned libraries in this result set.</p>
              </div>
            </div>
          </ControlPlaneCard>
          <ControlPlaneCard title="Controlled users">
            <div className="flex items-center gap-3">
              <UserCog className="h-5 w-5 text-primary" />
              <div>
                <p className="text-2xl font-bold font-display text-foreground">{formatNumber(controlledUserCount)}</p>
                <p className="text-xs text-muted-foreground">Users with active controls or session resets pending.</p>
              </div>
            </div>
          </ControlPlaneCard>
        </div>

        <Tabs defaultValue="libraries" className="space-y-6">
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
                          {libraries.map((library) => (
                            <TableRow key={library.id}>
                              <TableCell>
                                <div>
                                  <p className="font-medium text-foreground">{library.name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {library.city || "Unknown city"} • {library.ownerEmail || "No owner email"}
                                  </p>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-2">
                                  <Badge variant={library.enabled ? "default" : "outline"}>
                                    {library.enabled ? "Enabled" : "Disabled"}
                                  </Badge>
                                  <Badge variant={toBadgeVariant(library.controlStatus)}>{library.controlStatus}</Badge>
                                </div>
                              </TableCell>
                              <TableCell>
                                {formatNumber(library.activeStudents)} / {formatNumber(library.totalSeats)}
                              </TableCell>
                              <TableCell>{formatInr(library.monthlyRevenue)}</TableCell>
                              <TableCell>{formatDateTime(library.lastActivityAt)}</TableCell>
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
                                    {library.enabled ? "Disable" : "Enable"}
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
                                    {library.controlStatus === "active" ? "Control" : "Clear"}
                                  </Button>
                                  <Button
                                    onClick={() => handleImpersonation(library.ownerId, library.id)}
                                    size="sm"
                                  >
                                    <KeyRound className="mr-2 h-4 w-4" />
                                    Impersonate
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
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

                {usersQuery.isLoading ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Loading users...</p>
                ) : (
                  <>
                    <div className="overflow-x-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>User</TableHead>
                            <TableHead>Role</TableHead>
                            <TableHead>Library</TableHead>
                            <TableHead>Last Login</TableHead>
                            <TableHead>Failures</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {users.map((user) => (
                            <TableRow key={user.userId}>
                              <TableCell>
                                <div>
                                  <p className="font-medium text-foreground">{user.fullName || "Unknown user"}</p>
                                  <p className="text-xs text-muted-foreground">{user.email || "No email"}</p>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-wrap gap-2">
                                  <Badge variant="outline">{user.primaryRole || "unknown"}</Badge>
                                  <Badge variant={toBadgeVariant(user.controlStatus)}>{user.controlStatus}</Badge>
                                </div>
                              </TableCell>
                              <TableCell>{user.libraryName || "—"}</TableCell>
                              <TableCell>{formatDateTime(user.lastLoginAt)}</TableCell>
                              <TableCell>{formatNumber(user.loginFailures24h)}</TableCell>
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
                                    Control
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
                                    Clear Sessions
                                  </Button>
                                  <Button
                                    onClick={() => handleImpersonation(user.userId, user.libraryId)}
                                    size="sm"
                                  >
                                    Impersonate
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
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
                  <p className="text-sm text-muted-foreground">No recent platform activity is available for this slice yet.</p>
                ) : (
                  recentActivity.map((activity) => (
                    <div key={activity.id} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground">{activity.activityType}</p>
                        <p className="text-xs text-muted-foreground">{formatDateTime(activity.createdAt)}</p>
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
