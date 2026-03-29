import { memo } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

interface StudentQRCardProps {
  studentName: string;
  qrCode: string;
  seatNumber?: string;
  plan?: string;
  status: string;
}

const StudentQRCard = ({ studentName, qrCode, seatNumber, plan, status }: StudentQRCardProps) => {
  const handleDownload = () => {
    const svg = document.getElementById(`qr-${qrCode}`);
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      ctx?.drawImage(img, 0, 0);
      const a = document.createElement("a");
      a.download = `${studentName.replace(/\s+/g, "-")}-qr.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    };
    img.src = "data:image/svg+xml;base64," + btoa(svgData);
  };

  return (
    <Card className="h-full text-center">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-display">{studentName}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-center p-4 bg-secondary rounded-lg">
          <QRCodeSVG
            id={`qr-${qrCode}`}
            value={qrCode}
            size={160}
            level="H"
            includeMargin
            bgColor="transparent"
            fgColor="hsl(200, 50%, 10%)"
          />
        </div>
        <div className="flex items-center justify-center gap-2">
          {seatNumber && <Badge variant="outline">Seat {seatNumber}</Badge>}
          {plan && <Badge variant="secondary">{plan}</Badge>}
          <Badge variant={status === "active" ? "default" : "destructive"}>
            {status}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground font-mono break-all">{qrCode}</p>
        <Button variant="outline" size="sm" onClick={handleDownload} className="w-full">
          <Download className="w-3.5 h-3.5 mr-1.5" /> Download QR
        </Button>
      </CardContent>
    </Card>
  );
};

export default memo(StudentQRCard);
