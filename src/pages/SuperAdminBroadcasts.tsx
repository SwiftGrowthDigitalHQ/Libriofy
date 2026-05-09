import { useState } from "react";
import SuperAdminLayout from "@/components/dashboard/SuperAdminLayout";
import { ControlPlaneCard, ControlPlanePageHeader } from "@/components/superAdmin/ControlPlanePrimitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useBroadcastMutations, useBroadcasts } from "@/hooks/superAdmin";
import { formatDateTime, formatPercent, formatNumber, toBadgeVariant } from "@/lib/superAdmin/presentation";

const SuperAdminBroadcasts = () => {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [broadcastForm, setBroadcastForm] = useState({
    audience: "all_libraries",
    channel: "in_app" as "email" | "in_app" | "telegram" | "whatsapp",
    message: "",
    title: "",
  });
  const [templateForm, setTemplateForm] = useState({
    body: "",
    channel: "email" as "email" | "in_app" | "telegram" | "whatsapp",
    key: "",
    name: "",
    subject: "",
    variables: "",
  });

  const overviewQuery = useBroadcasts();
  const templatesQuery = useBroadcasts({ query: { page: 1, pageSize: 10, scope: "templates", search } });
  const broadcastsQuery = useBroadcasts({ query: { page: 1, pageSize: 10, scope: "broadcasts", search } });
  const { createBroadcast, deleteTemplate, saveTemplate } = useBroadcastMutations();

  const handleBroadcastCreate = async () => {
    if (!broadcastForm.title.trim() || !broadcastForm.message.trim()) {
      toast({
        description: "Broadcast title and message are required.",
        title: "Invalid broadcast",
        variant: "destructive",
      });
      return;
    }

    try {
      await createBroadcast.mutateAsync({
        action: "create_broadcast",
        audience: broadcastForm.audience.trim() || "all_libraries",
        channel: broadcastForm.channel,
        message: broadcastForm.message.trim(),
        title: broadcastForm.title.trim(),
      });
      setBroadcastForm({
        audience: "all_libraries",
        channel: "in_app",
        message: "",
        title: "",
      });
      toast({ title: "Broadcast queued" });
    } catch (error) {
      toast({
        description: error instanceof Error ? error.message : "Unable to create the broadcast.",
        title: "Broadcast failed",
        variant: "destructive",
      });
    }
  };

  const handleTemplateSave = async () => {
    if (!templateForm.key.trim() || !templateForm.name.trim() || !templateForm.body.trim()) {
      toast({
        description: "Template key, name, and body are required.",
        title: "Invalid template",
        variant: "destructive",
      });
      return;
    }

    try {
      await saveTemplate.mutateAsync({
        action: "upsert_template",
        body: templateForm.body.trim(),
        channel: templateForm.channel,
        key: templateForm.key.trim(),
        name: templateForm.name.trim(),
        subject: templateForm.subject.trim() || null,
        variables: templateForm.variables
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      setTemplateForm({
        body: "",
        channel: "email",
        key: "",
        name: "",
        subject: "",
        variables: "",
      });
      toast({ title: "Template saved" });
    } catch (error) {
      toast({
        description: error instanceof Error ? error.message : "Unable to save the template.",
        title: "Template failed",
        variant: "destructive",
      });
    }
  };

  return (
    <SuperAdminLayout>
      <div className="space-y-6">
        <ControlPlanePageHeader
          description="Centralized broadcast templates, queued notifications, and delivery health through the admin API."
          title="Broadcasts"
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <ControlPlaneCard title="Email success rate">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatPercent(overviewQuery.data?.data.deliveryHealth.emailSuccessRate ?? 0, 2)}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Queued notifications">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatNumber(overviewQuery.data?.data.deliveryHealth.queuedNotifications ?? 0)}
            </p>
          </ControlPlaneCard>
          <ControlPlaneCard title="Failed notifications">
            <p className="text-2xl font-bold font-display text-foreground">
              {formatNumber(overviewQuery.data?.data.deliveryHealth.failedNotifications ?? 0)}
            </p>
          </ControlPlaneCard>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_1.9fr]">
          <ControlPlaneCard title="Create communication">
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="broadcast-title">Broadcast</Label>
                <Input
                  id="broadcast-title"
                  onChange={(event) => setBroadcastForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="Broadcast title"
                  value={broadcastForm.title}
                />
                <Input
                  onChange={(event) => setBroadcastForm((current) => ({ ...current, channel: event.target.value as typeof current.channel }))}
                  placeholder="Channel"
                  value={broadcastForm.channel}
                />
                <Input
                  onChange={(event) => setBroadcastForm((current) => ({ ...current, audience: event.target.value }))}
                  placeholder="Audience"
                  value={broadcastForm.audience}
                />
                <Textarea
                  onChange={(event) => setBroadcastForm((current) => ({ ...current, message: event.target.value }))}
                  placeholder="Broadcast message"
                  rows={4}
                  value={broadcastForm.message}
                />
                <Button disabled={createBroadcast.isPending} onClick={handleBroadcastCreate}>
                  Queue broadcast
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="template-key">Template</Label>
                <Input
                  id="template-key"
                  onChange={(event) => setTemplateForm((current) => ({ ...current, key: event.target.value }))}
                  placeholder="Template key"
                  value={templateForm.key}
                />
                <Input
                  onChange={(event) => setTemplateForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Template name"
                  value={templateForm.name}
                />
                <Input
                  onChange={(event) => setTemplateForm((current) => ({ ...current, channel: event.target.value as typeof current.channel }))}
                  placeholder="Channel"
                  value={templateForm.channel}
                />
                <Input
                  onChange={(event) => setTemplateForm((current) => ({ ...current, subject: event.target.value }))}
                  placeholder="Subject"
                  value={templateForm.subject}
                />
                <Input
                  onChange={(event) => setTemplateForm((current) => ({ ...current, variables: event.target.value }))}
                  placeholder="Variables (comma separated)"
                  value={templateForm.variables}
                />
                <Textarea
                  onChange={(event) => setTemplateForm((current) => ({ ...current, body: event.target.value }))}
                  placeholder="Template body"
                  rows={5}
                  value={templateForm.body}
                />
                <Button disabled={saveTemplate.isPending} onClick={handleTemplateSave}>
                  Save template
                </Button>
              </div>
            </div>
          </ControlPlaneCard>

          <ControlPlaneCard title="Broadcast state">
            <div className="space-y-4">
              <Input
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search templates or broadcasts"
                value={search}
              />

              <Tabs defaultValue="broadcasts">
                <TabsList>
                  <TabsTrigger value="broadcasts">Broadcasts</TabsTrigger>
                  <TabsTrigger value="templates">Templates</TabsTrigger>
                </TabsList>

                <TabsContent value="broadcasts">
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Title</TableHead>
                          <TableHead>Channel</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Audience</TableHead>
                          <TableHead>Sent</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {"items" in (broadcastsQuery.data ?? {}) &&
                          broadcastsQuery.data.items.items.map((broadcast) => (
                            <TableRow key={broadcast.id}>
                              <TableCell>{broadcast.title}</TableCell>
                              <TableCell>{broadcast.channel}</TableCell>
                              <TableCell>
                                <Badge variant={toBadgeVariant(broadcast.status)}>{broadcast.status}</Badge>
                              </TableCell>
                              <TableCell>{broadcast.audience}</TableCell>
                              <TableCell>{formatDateTime(broadcast.sentAt || broadcast.createdAt)}</TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="templates">
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Template</TableHead>
                          <TableHead>Channel</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Updated</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {"items" in (templatesQuery.data ?? {}) &&
                          templatesQuery.data.items.items.map((template) => (
                            <TableRow key={template.id}>
                              <TableCell>
                                <div>
                                  <p className="font-medium text-foreground">{template.name}</p>
                                  <p className="text-xs text-muted-foreground">{template.key}</p>
                                </div>
                              </TableCell>
                              <TableCell>{template.channel}</TableCell>
                              <TableCell>
                                <Badge variant={template.isActive ? "default" : "outline"}>
                                  {template.isActive ? "Active" : "Disabled"}
                                </Badge>
                              </TableCell>
                              <TableCell>{formatDateTime(template.updatedAt)}</TableCell>
                              <TableCell className="text-right">
                                <Button
                                  onClick={() => deleteTemplate.mutate({ action: "delete_template", templateId: template.id })}
                                  size="sm"
                                  variant="outline"
                                >
                                  Delete
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </ControlPlaneCard>
        </div>
      </div>
    </SuperAdminLayout>
  );
};

export default SuperAdminBroadcasts;
