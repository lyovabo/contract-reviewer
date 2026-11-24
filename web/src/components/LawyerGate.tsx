"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ApiError, api } from "@/lib/api";
import { setCurrentSession, setCurrentWorkspaceId, useSessionNotice } from "@/lib/current-lawyer";
import { queryKeys, useCurrentLawyer, useCurrentWorkspace, useLawyers, useSettings } from "@/lib/queries";
import { releaseCurrentSession, useKeepSessionAlive } from "@/lib/session-keeper";
import type { Lawyer } from "@/lib/types";

/**
 * Choosing who you are is the first step: nothing in the workspace is shown until this browser
 * holds a session for a lawyer. Only one browser at a time can use a given lawyer. A lawyer who
 * belongs to several workspaces then picks one (with the sample data every lawyer has exactly
 * one, so it is picked for them). There is no authentication (per the brief): this stops two
 * people using the same lawyer at once, but anyone can still pick a lawyer nobody is using.
 */
export function LawyerGate({ children }: { children: ReactNode }) {
  const { isPending, error } = useLawyers();
  const lawyer = useCurrentLawyer();
  const workspace = useCurrentWorkspace();
  const { data: settings } = useSettings();
  useKeepSessionAlive(lawyer, settings?.sessionTtlMs ?? null);

  if (isPending) return <p className="text-stone-500">Loading…</p>;
  if (error) return <p className="text-red-700">Could not load the lawyers: {error.message}</p>;
  if (!lawyer) return <LawyerPicker />;
  if (lawyer.workspaces.length === 0) {
    return (
      <Step title={`${lawyer.name} is not a member of any workspace`}>
        <p className="text-sm text-stone-600">Ask a colleague to add you to their workspace.</p>
        <button type="button" className="text-sm underline" onClick={releaseCurrentSession}>
          Choose someone else
        </button>
      </Step>
    );
  }
  if (!workspace) return <WorkspacePicker lawyer={lawyer} />;
  return <>{children}</>;
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-labelledby="gate-step" className="mx-auto max-w-md space-y-4 py-6">
      <h1 id="gate-step" className="text-2xl font-semibold">
        {title}
      </h1>
      {children}
    </section>
  );
}

const CHOICE =
  "w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-left enabled:hover:border-stone-400 enabled:hover:bg-stone-50 disabled:cursor-not-allowed disabled:bg-stone-100";

function LawyerPicker() {
  const queryClient = useQueryClient();
  const notice = useSessionNotice();
  const { data: settings } = useSettings();
  // Who is in use elsewhere changes as colleagues come and go: refresh it while picking.
  const { data: lawyers = [] } = useQuery({ queryKey: queryKeys.lawyers, queryFn: api.lawyers, refetchInterval: 5_000 });

  const claim = useMutation({
    mutationFn: (lawyer: Lawyer) => api.claimSession(lawyer.id),
    onSuccess: (session) => setCurrentSession(session.lawyerId, session.token),
    // Taken by someone else a moment ago: refresh, so the picker shows them as in use.
    onError: () => void queryClient.invalidateQueries({ queryKey: queryKeys.lawyers }),
  });
  const refusedNow = claim.error instanceof ApiError && claim.error.code === "lawyer_in_use";

  return (
    <Step title="Who is using Contract Reviewer?">
      <p className="text-sm text-stone-600">
        Choose yourself to open your workspace. Reviews you request are recorded under your name. Only one browser at a
        time can work as a given lawyer. There is no login: your choice is remembered on this browser.
      </p>
      {(notice || refusedNow) && (
        <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {refusedNow ? "Someone started working as that lawyer a moment ago. Choose someone else." : notice}
        </p>
      )}
      <ul className="space-y-2">
        {lawyers.map((lawyer) => {
          const inUse = lawyer.inUse;
          return (
            <li key={lawyer.id}>
              <button
                type="button"
                disabled={inUse || claim.isPending}
                onClick={() => claim.mutate(lawyer)}
                className={CHOICE}
                aria-describedby={inUse ? `in-use-${lawyer.id}` : undefined}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">{lawyer.name}</span>
                  {inUse && (
                    <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-700">
                      In use
                    </span>
                  )}
                </span>
                <span className="block text-sm text-stone-500">
                  {lawyer.title} · {lawyer.workspaces.map((w) => w.name).join(", ") || "no workspace"}
                </span>
                {inUse && (
                  <span id={`in-use-${lawyer.id}`} className="mt-1 block text-xs text-stone-600">
                    Someone is working as {lawyer.name} in another browser. It frees up{" "}
                    {settings ? `${Math.round(settings.sessionTtlMs / 1000)} seconds` : "shortly"} after they leave.
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </Step>
  );
}

function WorkspacePicker({ lawyer }: { lawyer: Lawyer }) {
  return (
    <Step title="Which workspace?">
      <p className="text-sm text-stone-600">
        {lawyer.name}, you are a member of {lawyer.workspaces.length} workspaces. Each has its own documents and its
        own monthly plan.
      </p>
      <ul className="space-y-2">
        {lawyer.workspaces.map((workspace) => (
          <li key={workspace.id}>
            <button type="button" onClick={() => setCurrentWorkspaceId(workspace.id)} className={CHOICE}>
              <span className="block font-medium">{workspace.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </Step>
  );
}
