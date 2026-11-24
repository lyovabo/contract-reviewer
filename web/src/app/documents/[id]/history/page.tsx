"use client";

import { useParams } from "next/navigation";
import { ReviewHistory } from "@/components/ReviewHistory";

export default function ReviewHistoryPage() {
  const { id } = useParams<{ id: string }>();
  return <ReviewHistory documentId={id} />;
}
