import Link from "next/link";

/** Clearly visible way back to the documents list. */
export function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-900 hover:border-stone-500 hover:bg-stone-50"
    >
      <span aria-hidden="true">←</span> All documents
    </Link>
  );
}
