"use client";

import { BackLink } from "@/components/BackLink";
import { useSettings } from "@/lib/queries";

// Mock page: billing is out of scope in the brief. Nothing here changes the plan.
export default function UpgradePage() {
  const { data: settings } = useSettings();
  const limit = settings?.monthlyReviewLimit;
  const included = limit ? `${limit} AI reviews` : "a set number of AI reviews";
  // Demo offers, sized from the plan: one more month's worth now, or three times the plan.
  const offers = [
    { name: "Extra pack", detail: limit ? `${limit} more reviews this month` : "More reviews this month" },
    { name: "Larger plan", detail: limit ? `${limit * 3} reviews every month` : "More reviews every month" },
  ];
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <BackLink />
        <h1 className="text-2xl font-semibold">Get more reviews</h1>
        <p className="text-stone-600">
          Your plan includes {included} per calendar month for the whole workspace. When they are used up, new
          requests are refused until the plan resets — they are never queued.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {offers.map((option) => (
          <div key={option.name} className="rounded-xl border border-stone-200 bg-white p-4">
            <h2 className="font-semibold">{option.name}</h2>
            <p className="text-sm text-stone-600">{option.detail}</p>
            <button
              type="button"
              disabled
              className="mt-4 rounded-lg bg-stone-300 px-4 py-2 text-sm font-medium text-stone-600"
            >
              Contact sales (demo)
            </button>
          </div>
        ))}
      </div>
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Demo page: billing is not part of this exercise. Nothing is charged and the plan does not change.
      </p>
    </div>
  );
}
