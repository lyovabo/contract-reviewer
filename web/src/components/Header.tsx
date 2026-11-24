"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { setCurrentWorkspaceId } from "@/lib/current-lawyer";
import { useCurrentLawyer, useCurrentWorkspace } from "@/lib/queries";
import { releaseCurrentSession } from "@/lib/session-keeper";
import { ReviewerSwitch } from "./ReviewerSwitch";

/**
 * The product, the workspace, who is working, and the AI for new reviews (simulated or Claude).
 * Always one line, whatever the lawyer's name: long text truncates, and narrow screens drop the
 * secondary labels and the AI switch, which the request box on each document page also has.
 * Usage (the plan) lives with the documents, where reviews are requested.
 */
export function Header() {
  const lawyer = useCurrentLawyer();
  const workspace = useCurrentWorkspace();
  const router = useRouter();

  // A different person (or workspace) is about to take over: start from the documents list,
  // never from the page (e.g. a running review) that was open before.
  const switchLawyer = () => {
    releaseCurrentSession(); // frees this lawyer for others at once
    router.push("/");
  };
  const switchWorkspace = () => {
    setCurrentWorkspaceId(null);
    router.push("/");
  };

  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <Link href="/" className="whitespace-nowrap text-lg font-semibold tracking-tight">
            Contract Reviewer
          </Link>
          {workspace && (
            <p className="truncate text-sm text-stone-600">
              Workspace: <strong className="font-medium text-stone-900">{workspace.name}</strong>
              {lawyer && lawyer.workspaces.length > 1 && (
                <>
                  {" "}
                  ·{" "}
                  <button type="button" className="underline" onClick={switchWorkspace}>
                    Switch workspace
                  </button>
                </>
              )}
            </p>
          )}
        </div>
        {lawyer && workspace && (
          <div className="flex min-w-0 items-center gap-2 whitespace-nowrap text-sm">
            <div className="mr-2 hidden border-r border-stone-200 pr-4 sm:block">
              <ReviewerSwitch variant="header" />
            </div>
            <span className="hidden text-stone-500 sm:inline">Working as</span>
            <strong className="truncate font-medium" title={`${lawyer.name}, ${lawyer.title}`}>
              {lawyer.name}
            </strong>
            <span className="hidden text-stone-500 md:inline">({lawyer.title})</span>
            <button
              type="button"
              aria-label="Switch lawyer"
              title="Switch lawyer"
              onClick={switchLawyer}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-stone-300 px-2 py-1 font-medium text-stone-800 hover:border-stone-500 hover:bg-stone-50"
            >
              <SwitchIcon />
              <span className="hidden sm:inline">Switch</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function SwitchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4" aria-hidden="true">
      <path d="M4 7h12m0 0-3-3m3 3-3 3M16 13H4m0 0 3-3m-3 3 3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
