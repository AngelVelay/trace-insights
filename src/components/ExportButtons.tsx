import { Button } from '@/components/ui/button';
import { FileDown, FileText } from 'lucide-react';
import type { MetricRow, ClassifiedTraces, NormalizedSpan } from '@/types/bbva';
import { metricsToCSV, tracesToTXT, downloadFile } from '@/services/exportService';

interface ExportButtonsProps {
  rows: MetricRow[];
  classified: ClassifiedTraces | null;
  allSpans: NormalizedSpan[];
}

export default function ExportButtons({ rows, classified, allSpans }: ExportButtonsProps) {
  const handleCSV = () => {
    if (rows.length === 0) return;
    const csv = metricsToCSV(rows);
    downloadFile(csv, `bbva-metrics-${Date.now()}.csv`, 'text/csv');
  };

  const handleTXT = () => {
    if (!classified) return;
    const txt = tracesToTXT(classified, allSpans);
    downloadFile(txt, `bbva-traces-${Date.now()}.txt`);
  };

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleCSV}
        disabled={rows.length === 0}
      >
        <FileDown className="mr-1.5 h-3.5 w-3.5" />
        CSV
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={handleTXT}
        disabled={!classified}
      >
        <FileText className="mr-1.5 h-3.5 w-3.5" />
        TXT
      </Button>
    </div>
  );
}
