"use client";

import { useParams } from "next/navigation";
import { DocumentReview } from "@/components/DocumentReview";

export default function DocumentPage() {
  const { id } = useParams<{ id: string }>();
  return <DocumentReview documentId={id} />;
}
