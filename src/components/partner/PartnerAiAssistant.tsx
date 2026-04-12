import { useState } from "react";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type AiTask = "whatsapp" | "call_script" | "objection" | "demo_pitch";

const taskLabels: Record<AiTask, string> = {
  whatsapp: "WhatsApp Message",
  call_script: "Call Script",
  objection: "Objection Handling",
  demo_pitch: "Demo Pitch",
};

const PartnerAiAssistant = () => {
  const [task, setTask] = useState<AiTask>("whatsapp");
  const [customerType, setCustomerType] = useState("library_owner");
  const [objection, setObjection] = useState("");
  const [goal, setGoal] = useState("schedule_demo");
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState("");

  const runAssistant = async () => {
    setLoading(true);
    setOutput("");
    try {
      const response = await fetch("/api/ai/partner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task,
          customerType,
          objection: objection.trim() || null,
          goal,
          context: context.trim() || null,
        }),
      });

      const payload = await response.json();
      if (!payload.success) {
        setOutput(payload.message || "Unable to generate response.");
        return;
      }

      setOutput(payload.output || "No response generated.");
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Unable to generate response.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex items-center justify-between flex-row">
        <CardTitle className="text-lg font-display flex items-center gap-2">
          <Wand2 className="h-4 w-4" /> AI Sales Assistant
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Task</Label>
            <Select value={task} onValueChange={(value) => setTask(value as AiTask)}>
              <SelectTrigger>
                <SelectValue placeholder="Select task" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(taskLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Customer Type</Label>
            <Select value={customerType} onValueChange={setCustomerType}>
              <SelectTrigger>
                <SelectValue placeholder="Select customer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="library_owner">Library Owner</SelectItem>
                <SelectItem value="franchise_owner">Franchise Owner</SelectItem>
                <SelectItem value="budget_conscious">Budget Conscious</SelectItem>
                <SelectItem value="premium">Premium Buyer</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Goal</Label>
            <Select value={goal} onValueChange={setGoal}>
              <SelectTrigger>
                <SelectValue placeholder="Select goal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="schedule_demo">Schedule Demo</SelectItem>
                <SelectItem value="share_pricing">Share Pricing</SelectItem>
                <SelectItem value="close_signup">Close Signup</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Objection (optional)</Label>
            <Input value={objection} onChange={(event) => setObjection(event.target.value)} placeholder="e.g., Too expensive" />
          </div>
        </div>
        <div className="space-y-2">
          <Label>Context (optional)</Label>
          <Input value={context} onChange={(event) => setContext(event.target.value)} placeholder="City, seats, urgency, etc." />
        </div>
        <Button onClick={runAssistant} disabled={loading}>
          {loading ? "Generating..." : "Generate"}
        </Button>
        {output ? (
          <div className="rounded-lg border bg-muted/40 p-4 text-sm text-foreground whitespace-pre-wrap">
            {output}
            <div className="mt-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigator.clipboard.writeText(output)}
              >
                Copy to clipboard
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};

export default PartnerAiAssistant;
