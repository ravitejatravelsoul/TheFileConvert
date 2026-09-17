import type { ToolCategory } from "@/lib/tools/types";
import { IconPdf, IconImage, IconDocument, IconData, IconArchive, IconMedia } from "@/components/icons";
import type { SVGProps } from "react";

const ICONS: Record<ToolCategory, (props: SVGProps<SVGSVGElement>) => React.JSX.Element> = {
  pdf: IconPdf,
  image: IconImage,
  document: IconDocument,
  data: IconData,
  archive: IconArchive,
  media: IconMedia,
};

export function CategoryIcon({ category, className }: { category: ToolCategory; className?: string }) {
  const Icon = ICONS[category];
  return <Icon className={className} />;
}
